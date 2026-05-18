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


async def _update_job(job_id: str, **kwargs):
    async with AsyncSessionLocal() as session:
        job = await session.get(GenerationJob, uuid.UUID(job_id))
        if job:
            for k, v in kwargs.items():
                setattr(job, k, v)
            await session.commit()


async def _save_results(state: PipelineState) -> list[str]:
    """Persist passage and question items to DB, return list of item IDs."""
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

        for i, q in enumerate(questions):
            judge = judge_map.get(i, {})
            overall_score = judge.get("overall_score")
            passed = judge.get("pass", False)
            status = "validated" if passed else "draft"

            item = QuestionItem(
                passage_id=passage.id,
                stem=q.get("stem") or q.get("question", ""),
                question_type=state["blueprint"]["question_types"][i % len(state["blueprint"]["question_types"])],
                correct_answer=q.get("answer") or q.get("correct_answer", ""),
                options=q.get("options"),
                cefr_level=state["blueprint"]["cefr"],
                judge_score=overall_score,
                judge_detail=judge,
                status=status,
            )
            session.add(item)
            await session.flush()
            item_ids.append(str(item.id))

        await session.commit()
        return item_ids


async def run_pipeline(job_id: str, requirement: str):
    await _update_job(job_id, status="running", started_at=datetime.now(timezone.utc), current_node="blueprint")

    initial_state: PipelineState = {
        "raw_requirement": requirement,
        "job_id": job_id,
        "blueprint": None,
        "passage": None,
        "raw_questions": None,
        "questions_with_options": None,
        "judge_results": None,
        "judge_passed": False,
        "revision_count": 0,
        "should_revise": False,
        "error": None,
    }

    try:
        final_state = await pipeline.ainvoke(initial_state)

        if final_state.get("error"):
            await _update_job(
                job_id,
                status="failed",
                error_message=final_state["error"],
                completed_at=datetime.now(timezone.utc),
            )
            return

        item_ids = await _save_results(final_state)
        await _update_job(
            job_id,
            status="completed",
            result={"item_ids": item_ids, "judge_passed": final_state.get("judge_passed", False)},
            completed_at=datetime.now(timezone.utc),
            current_node="done",
        )

    except Exception as e:
        await _update_job(
            job_id,
            status="failed",
            error_message=str(e),
            completed_at=datetime.now(timezone.utc),
        )
