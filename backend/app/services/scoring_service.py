import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.models.item import QuestionItem, Passage
from app.models.session import SessionGrade, TestSession

DETERMINISTIC_LETTER_TYPES = {
    "multiple_choice", "main_idea", "detail", "inference",
    "vocabulary_in_context", "tone_purpose", "cloze", "error_identification",
    "rhetorical_purpose", "author_attitude", "implication",
    "analogy_interpretation", "organization_logic",
}
DETERMINISTIC_FLEX_TYPES = {"fill_blank", "true_false_not_given", "matching", "reordering"}
FREE_TEXT_TYPES = {"short_answer", "essay"}
SKIPPED_TYPES = {"speaking_prompt"}


def _normalize_text(s: str | None) -> str:
    if not s:
        return ""
    return re.sub(r"\s+", " ", s.strip().lower())


def _normalize_tfng(s: str | None) -> str:
    n = _normalize_text(s)
    mapping = {"t": "true", "f": "false", "ng": "not given", "n": "not given", "a": "true", "b": "false", "c": "not given"}
    return mapping.get(n, n)


def _normalize_pairs(s: str | None) -> set[tuple[str, str]]:
    if not s:
        return set()
    pairs = re.findall(r"([A-Za-z0-9]+)\s*[-:=]\s*([A-Za-z0-9]+)", s)
    return {(a.strip().upper(), b.strip().upper()) for a, b in pairs}


def _normalize_seq(s: str | None) -> tuple[str, ...]:
    if not s:
        return ()
    return tuple(p.strip().upper() for p in re.split(r"[,\s]+", s) if p.strip())


def _grade_objective(item: QuestionItem, response: str | None) -> tuple[bool, float, float]:
    """Return (is_correct, score_earned, score_max)."""
    weight = float(item.score_weight or 1.0)
    if response is None or response == "":
        return False, 0.0, weight

    qtype = item.question_type or "multiple_choice"
    correct = item.correct_answer or ""

    if qtype in DETERMINISTIC_LETTER_TYPES:
        ok = response.strip().upper() == correct.strip().upper()
    elif qtype == "fill_blank":
        ok = _normalize_text(response) == _normalize_text(correct)
    elif qtype == "true_false_not_given":
        ok = _normalize_tfng(response) == _normalize_tfng(correct)
    elif qtype == "matching":
        ok = _normalize_pairs(response) == _normalize_pairs(correct)
    elif qtype == "reordering":
        ok = _normalize_seq(response) == _normalize_seq(correct)
    else:
        ok = False

    return ok, weight if ok else 0.0, weight


async def _grade_free_text(item: QuestionItem, response: str | None) -> tuple[bool | None, float, float, dict | None]:
    """Call the LLM-based grader (Cambridge-style 4-criterion rubric)."""
    from app.agents.grader_agent import grade_free_text as _grader

    weight = float(item.score_weight or 1.0)
    if response is None or response.strip() == "":
        return False, 0.0, weight, {"reason": "no response"}

    try:
        result = await _grader(
            question_type=item.question_type or "essay",
            stem=item.stem,
            model_answer=item.correct_answer,
            candidate_response=response,
            target_cefr=item.cefr_level,
            weight=weight,
        )
        overall_pct = float(result.get("overall_percent", 0))
        is_acceptable = bool(result.get("is_acceptable", False))
        earned = weight * (overall_pct / 100.0)
        return is_acceptable, earned, weight, result
    except Exception as e:
        return None, 0.0, weight, {"error": f"grader failed: {e}"}


async def grade_session(session_id: str) -> None:
    """Grade every response in the session, persist SessionGrade rows, then classify CEFR."""
    async with AsyncSessionLocal() as session:
        ts = await session.get(TestSession, uuid.UUID(session_id))
        if not ts:
            return

        # Load items by ids in responses (order doesn't matter for grading)
        responses: dict = ts.responses or {}
        item_ids = [uuid.UUID(i) for i in responses.keys()]

        # ALSO load any items in item_order that have no response (so we can score them as 0)
        all_item_ids = list({*item_ids, *[uuid.UUID(i) for i in (ts.item_order or [])]})

        result = await session.execute(
            select(QuestionItem)
            .options(selectinload(QuestionItem.passage))
            .where(QuestionItem.id.in_(all_item_ids))
        )
        items = {i.id: i for i in result.scalars().all()}

        total_score = 0.0
        max_score = 0.0
        grade_rows: list[SessionGrade] = []

        for item_id, item in items.items():
            response = responses.get(str(item_id))
            qtype = item.question_type or ""

            if qtype in SKIPPED_TYPES:
                weight = float(item.score_weight or 1.0)
                grade = SessionGrade(
                    session_id=ts.id, item_id=item.id, response=response,
                    is_correct=None, score_earned=None, score_max=weight,
                    judge_detail={"skipped": True, "reason": "speaking not graded in Phase 1"},
                )
                grade_rows.append(grade)
                max_score += weight
                continue

            if qtype in FREE_TEXT_TYPES:
                is_correct, earned, mx, detail = await _grade_free_text(item, response)
                grade = SessionGrade(
                    session_id=ts.id, item_id=item.id, response=response,
                    is_correct=is_correct, score_earned=earned, score_max=mx,
                    judge_detail=detail,
                )
            else:
                is_correct, earned, mx = _grade_objective(item, response)
                grade = SessionGrade(
                    session_id=ts.id, item_id=item.id, response=response,
                    is_correct=is_correct, score_earned=earned, score_max=mx,
                    judge_detail=None,
                )

            grade_rows.append(grade)
            total_score += earned
            max_score += mx

        for g in grade_rows:
            session.add(g)

        ts.total_score = total_score
        ts.max_score = max_score
        ts.status = "scored"
        ts.scored_at = datetime.now(timezone.utc)

        await session.commit()

        # CEFR classification (Sprint 6) — wired here after grades saved
        try:
            from app.services.cefr_service import classify_session
            await classify_session(session_id)
        except Exception:
            # Don't fail grading if CEFR classification errors
            pass


async def load_session_breakdown(session_id: str) -> list[dict]:
    """Return enriched grade rows for the result endpoint."""
    async with AsyncSessionLocal() as session:
        ts = await session.get(TestSession, uuid.UUID(session_id))
        if not ts:
            return []
        result = await session.execute(
            select(SessionGrade, QuestionItem, Passage)
            .join(QuestionItem, SessionGrade.item_id == QuestionItem.id)
            .outerjoin(Passage, QuestionItem.passage_id == Passage.id)
            .where(SessionGrade.session_id == ts.id)
            .order_by(SessionGrade.created_at)
        )
        rows = []
        for grade, item, passage in result.all():
            rows.append({
                "item_id": item.id,
                "section_name": item.section_name,
                "skill": passage.skill if passage else None,
                "cefr_level": item.cefr_level,
                "question_type": item.question_type,
                "stem": item.stem,
                "passage_content": passage.content if passage and passage.content else None,
                "response": grade.response,
                "correct_answer": item.correct_answer,
                "is_correct": grade.is_correct,
                "score_earned": grade.score_earned,
                "score_max": grade.score_max,
                "explanation": item.explanation,
                "judge_detail": grade.judge_detail,
            })
        return rows
