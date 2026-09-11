import asyncio
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.graph import pipeline
from app.agents.state import PipelineState
from app.database import AsyncSessionLocal
from app.models.generation_job import GenerationJob
from app.models.item import Passage, QuestionItem
from app.services import job_registry
from app.utils.item_quality import neutralize_letter_references
from app.utils.llm_client import install_token_bucket


async def _update_job(job_id: str, **kwargs):
    async with AsyncSessionLocal() as session:
        job = await session.get(GenerationJob, uuid.UUID(job_id))
        if job:
            for k, v in kwargs.items():
                setattr(job, k, v)
            await session.commit()


def _verifier_map(state: PipelineState) -> dict[int, dict]:
    """Index verifier results by question_index for per-item persistence."""
    results = state.get("verifier_results") or []
    return {
        r["question_index"]: r
        for r in results
        if isinstance(r, dict) and isinstance(r.get("question_index"), int)
    }


async def _save_results(
    state: PipelineState,
    paper_id: str | None = None,
    section_name: str | None = None,
) -> tuple[list[str], str | None]:
    """Persist passage and question items to DB.
    Returns (item_ids, passage_id_str). When paper_id/section_name are passed, items are tagged with them.
    """
    # Item-count integrity: the pipeline must produce roughly as many questions as the
    # blueprint requested. Silent under-production (e.g. judge rejected most items, or
    # the generator returned a malformed array that the parser only partially recovered)
    # would otherwise persist a "successful" section with empty/short items, which the
    # UI then shows as a blank panel. Fail loudly so the operator sees the problem.
    bp_for_check = state.get("blueprint") or {}
    expected_items = int(bp_for_check.get("item_count") or 0)
    actual_items = len(state.get("questions_with_options") or state.get("raw_questions") or [])
    if expected_items > 0 and actual_items < expected_items:
        raise ValueError(
            f"Refusing to persist: pipeline produced {actual_items} items but blueprint "
            f"requested {expected_items}. Section is incomplete and would render as a "
            f"blank/short panel in the UI."
        )

    async with AsyncSessionLocal() as session:
        passage = Passage(
            content=state["passage"] or "",
            word_count=len((state["passage"] or "").split()),
            cefr_level=state["blueprint"]["cefr"],
            topic=state["blueprint"]["topic"],
            skill=state["blueprint"]["skill"],
        )
        session.add(passage)
        await session.flush()

        item_ids: list[str] = []
        questions = state.get("questions_with_options") or state.get("raw_questions") or []
        judge_results = state.get("judge_results") or []
        judge_map = {r["question_index"]: r for r in judge_results}
        verifier_map = _verifier_map(state)
        revision_count = state.get("revision_count", 0)

        bp = state["blueprint"]
        bp_types = bp.get("question_types") or []
        # Default score_weight if generator didn't provide one
        section_score = bp.get("section_score")
        item_count = bp.get("item_count") or len(questions) or 1
        default_weight = (section_score / item_count) if section_score else 1.0

        paper_uuid = uuid.UUID(paper_id) if paper_id else None

        for i, q in enumerate(questions):
            judge = judge_map.get(i, {})
            overall_score = judge.get("overall_score")
            passed = judge.get("pass", False)
            status = "validated" if passed else "draft"

            # Verifier feedback travels with the item. An item the verifier still
            # blocks after the revision budget (wrong/ambiguous answer key, or an
            # ungradable free-text prompt) is saved anyway but marked "flagged"
            # so the operator can review it instead of losing the whole section.
            verifier = verifier_map.get(i)
            judge_detail = dict(judge)
            if verifier:
                judge_detail["verifier"] = verifier
                if verifier.get("blocking"):
                    status = "flagged"

            qtype = q.get("question_type") or (bp_types[i % len(bp_types)] if bp_types else None)
            options = q.get("options")
            extras = q.get("extras")
            if extras and isinstance(options, dict):
                options = {**options, "_extras": extras}
            elif extras:
                options = {"_extras": extras}

            # Final safety pass on the rationale text: defensively strip any remaining
            # option-letter references ("Option B is correct"). Even with the updated
            # generator prompt forbidding letter labels and rebalance_correct_letters
            # remapping them, this catches anything the model still slips in.
            safe_explanation = neutralize_letter_references(q.get("explanation"))
            safe_objective = neutralize_letter_references(q.get("objective"))

            item = QuestionItem(
                passage_id=passage.id,
                stem=q.get("stem") or q.get("question", ""),
                question_type=qtype,
                correct_answer=q.get("answer") or q.get("correct_answer", ""),
                options=options,
                cefr_level=bp["cefr"],
                judge_score=overall_score,
                judge_detail=judge_detail,
                status=status,
                revision_count=revision_count,
                difficulty_band=q.get("difficulty_band"),
                score_weight=q.get("score_weight") or default_weight,
                objective=safe_objective,
                explanation=safe_explanation,
                tags=q.get("tags"),
                paper_id=paper_uuid,
                section_name=section_name,
            )
            session.add(item)
            await session.flush()
            item_ids.append(str(item.id))

        await session.commit()
        return item_ids, str(passage.id)


def _trace_from_state(state: dict) -> dict:
    return {
        "blueprint": state.get("blueprint"),
        "passage": state.get("passage"),
        "raw_questions": state.get("raw_questions"),
        "questions_with_options": state.get("questions_with_options"),
        "verifier_results": state.get("verifier_results"),
        "verifier_disagreed": state.get("verifier_disagreed", False),
        "judge_results": state.get("judge_results"),
        "revision_count": state.get("revision_count", 0),
        "judge_passed": state.get("judge_passed", False),
        "token_usage": state.get("token_usage"),
    }


async def _write_progress(job_id: str, current_node: str, accumulated: dict):
    """Persist a partial pipeline trace so the UI can render per-node output live."""
    await _update_job(
        job_id,
        current_node=current_node,
        result={"trace": _trace_from_state(accumulated), "in_progress": True},
    )


async def run_pipeline(job_id: str, requirement: str):
    current = asyncio.current_task()
    if current is not None:
        job_registry.register(job_id, current)

    await _update_job(job_id, status="running", started_at=datetime.now(timezone.utc), current_node="run_blueprint")

    token_bucket = install_token_bucket()

    initial_state: PipelineState = {
        "raw_requirement": requirement,
        "job_id": job_id,
        "blueprint": None,
        "passage": None,
        "raw_questions": None,
        "questions_with_options": None,
        "verifier_results": None,
        "verifier_disagreed": False,
        "verifier_should_revise": False,
        "judge_results": None,
        "judge_passed": False,
        "revision_count": 0,
        "should_revise": False,
        "error": None,
    }

    try:
        accumulated: dict = dict(initial_state)
        final_state: dict = dict(initial_state)
        async for chunk in pipeline.astream(initial_state):
            # Each chunk is {node_name: partial_state_update}
            for node_name, partial in chunk.items():
                if isinstance(partial, dict):
                    accumulated.update(partial)
                    accumulated["token_usage"] = dict(token_bucket)
                    final_state = accumulated
                    await _write_progress(job_id, node_name, accumulated)

        if final_state.get("error"):
            await _update_job(
                job_id,
                status="failed",
                error_message=final_state["error"],
                completed_at=datetime.now(timezone.utc),
            )
            return

        item_ids, _ = await _save_results(final_state)
        await _update_job(
            job_id,
            status="completed",
            result={
                "item_ids": item_ids,
                "judge_passed": final_state.get("judge_passed", False),
                "revision_count": final_state.get("revision_count", 0),
                "trace": _trace_from_state(final_state),
            },
            completed_at=datetime.now(timezone.utc),
            current_node="done",
        )

    except asyncio.CancelledError:
        await asyncio.shield(_update_job(
            job_id,
            status="cancelled",
            error_message="Cancelled by user",
            completed_at=datetime.now(timezone.utc),
        ))
        raise
    except Exception as e:
        await _update_job(
            job_id,
            status="failed",
            error_message=str(e),
            completed_at=datetime.now(timezone.utc),
        )
    finally:
        job_registry.unregister(job_id)


async def run_pipeline_for_blueprint(
    job_id: str,
    blueprint: dict,
    paper_id: str | None = None,
    section_name: str | None = None,
) -> tuple[list[str], str | None]:
    """Skip the blueprint agent — caller supplies a fully-formed blueprint dict.
    Returns (item_ids, passage_id_str). Raises on hard failure so caller can mark section failed.
    """
    current = asyncio.current_task()
    if current is not None:
        job_registry.register(job_id, current)

    await _update_job(job_id, status="running", started_at=datetime.now(timezone.utc), current_node="run_generator")

    token_bucket = install_token_bucket()

    initial_state: PipelineState = {
        "raw_requirement": "",
        "job_id": job_id,
        "blueprint": blueprint,    # pre-seeded → blueprint_node returns {}
        "passage": None,
        "raw_questions": None,
        "questions_with_options": None,
        "verifier_results": None,
        "verifier_disagreed": False,
        "verifier_should_revise": False,
        "judge_results": None,
        "judge_passed": False,
        "revision_count": 0,
        "should_revise": False,
        "error": None,
    }

    try:
        accumulated: dict = dict(initial_state)
        final_state: dict = dict(initial_state)
        async for chunk in pipeline.astream(initial_state):
            for node_name, partial in chunk.items():
                if isinstance(partial, dict):
                    accumulated.update(partial)
                    accumulated["token_usage"] = dict(token_bucket)
                    final_state = accumulated
                    await _write_progress(job_id, node_name, accumulated)

        if final_state.get("error"):
            await _update_job(
                job_id, status="failed",
                error_message=final_state["error"],
                completed_at=datetime.now(timezone.utc),
            )
            raise RuntimeError(final_state["error"])

        item_ids, passage_id = await _save_results(final_state, paper_id=paper_id, section_name=section_name)
        await _update_job(
            job_id, status="completed",
            result={
                "item_ids": item_ids,
                "passage_id": passage_id,
                "judge_passed": final_state.get("judge_passed", False),
                "revision_count": final_state.get("revision_count", 0),
                "trace": _trace_from_state(final_state),
            },
            completed_at=datetime.now(timezone.utc),
            current_node="done",
        )
        return item_ids, passage_id
    except asyncio.CancelledError:
        await asyncio.shield(_update_job(
            job_id,
            status="cancelled",
            error_message="Cancelled by user",
            completed_at=datetime.now(timezone.utc),
        ))
        raise
    finally:
        job_registry.unregister(job_id)
