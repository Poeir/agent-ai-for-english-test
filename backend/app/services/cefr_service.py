"""CEFR classification using Highest Mastered Level algorithm.

For each skill, find the highest CEFR level where mastery >= threshold AND every
lower level present also has mastery >= threshold. Overall = min across skills.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.item import Passage, QuestionItem
from app.models.paper import PaperSection
from app.models.session import SessionGrade, TestSession

CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"]
CEFR_INDEX = {c: i for i, c in enumerate(CEFR_ORDER)}


def _next_level(level: str) -> str | None:
    idx = CEFR_INDEX.get(level)
    if idx is None or idx >= len(CEFR_ORDER) - 1:
        return None
    return CEFR_ORDER[idx + 1]


def classify(grade_rows: list[dict]) -> dict:
    """grade_rows: [{skill, cefr_level, score_earned, score_max}, ...]
    Returns {overall_cefr, skill_cefr: {skill: level}, verdict, mastery_breakdown}.
    """
    threshold = getattr(settings, "cefr_mastery_threshold", 0.7)

    # Bucket: mastery[skill][cefr_level] = (sum_earned, sum_max)
    buckets: dict[str, dict[str, list[float]]] = {}
    for r in grade_rows:
        skill = (r.get("skill") or "unknown")
        level = (r.get("cefr_level") or "").upper()
        if level not in CEFR_INDEX:
            continue
        earned = float(r.get("score_earned") or 0.0)
        mx = float(r.get("score_max") or 0.0)
        if mx <= 0:
            continue
        buckets.setdefault(skill, {}).setdefault(level, [0.0, 0.0])
        buckets[skill][level][0] += earned
        buckets[skill][level][1] += mx

    skill_cefr: dict[str, str] = {}
    mastery_breakdown: dict[str, dict[str, float]] = {}

    for skill, by_level in buckets.items():
        mastery = {lvl: (earned / mx if mx > 0 else 0.0) for lvl, (earned, mx) in by_level.items()}
        mastery_breakdown[skill] = mastery

        # Highest level L where mastery[L] >= threshold AND every present lower level >= threshold
        levels_present_sorted = sorted(by_level.keys(), key=lambda x: CEFR_INDEX[x])
        achieved: str | None = None
        for lvl in levels_present_sorted:
            if mastery[lvl] >= threshold:
                achieved = lvl
            else:
                break

        skill_cefr[skill] = achieved or "below A1"

    # Overall = min of skill levels; ANY "below A1" pulls overall to "below A1"
    if not skill_cefr:
        overall = "below A1"
    elif any(c not in CEFR_INDEX for c in skill_cefr.values()):
        overall = "below A1"
    else:
        overall = min(skill_cefr.values(), key=lambda c: CEFR_INDEX[c])

    verdict = _make_verdict(skill_cefr, overall, mastery_breakdown)

    return {
        "overall_cefr": overall,
        "skill_cefr": skill_cefr,
        "verdict": verdict,
        "mastery_breakdown": mastery_breakdown,
    }


def _make_verdict(skill_cefr: dict[str, str], overall: str, mastery: dict[str, dict[str, float]]) -> str:
    if not skill_cefr:
        return "No graded items were found."

    valid_pairs = [(s, c) for s, c in skill_cefr.items() if c in CEFR_INDEX]
    below_skills = [s for s, c in skill_cefr.items() if c not in CEFR_INDEX]

    if not valid_pairs:
        return f"Overall: {overall}. The candidate did not reach A1 mastery in any tested skill."

    top_skill, top_lvl = max(valid_pairs, key=lambda p: CEFR_INDEX[p[1]])
    bot_skill, bot_lvl = min(valid_pairs, key=lambda p: CEFR_INDEX[p[1]])

    # If any skill is below A1, that's the weakest — overall is dragged down regardless of others.
    if below_skills:
        bot_skill = below_skills[0]
        return (
            f"Overall: {overall}. Strongest skill: {top_skill} ({top_lvl}). "
            f"Weakest: {bot_skill} (below A1). Focus on building foundational competence in {bot_skill} before improving other skills."
        )

    nxt = _next_level(bot_lvl) or bot_lvl
    if top_lvl == bot_lvl:
        return f"Overall: {overall}. Performance is consistent across all skills at {top_lvl}."

    return (
        f"Overall: {overall}. Strongest skill: {top_skill} ({top_lvl}). "
        f"Weakest: {bot_skill} ({bot_lvl}). To raise the overall level, focus on improving {bot_skill} toward {nxt}."
    )


async def classify_session(session_id: str) -> None:
    """Pull grades + item metadata, run classify(), persist to test_sessions."""
    async with AsyncSessionLocal() as session:
        ts = await session.get(TestSession, uuid.UUID(session_id))
        if not ts:
            return

        result = await session.execute(
            select(SessionGrade, QuestionItem, Passage, PaperSection)
            .join(QuestionItem, SessionGrade.item_id == QuestionItem.id)
            .outerjoin(Passage, QuestionItem.passage_id == Passage.id)
            .outerjoin(
                PaperSection,
                (PaperSection.paper_id == QuestionItem.paper_id)
                & (PaperSection.name == QuestionItem.section_name),
            )
            .where(SessionGrade.session_id == ts.id)
        )
        grade_rows = []
        for grade, item, passage, section in result.all():
            # Prefer paper_sections.skill (authoritative, lowercase, consistent across
            # multi-level placement papers where each section has a unique display name
            # like "Grammar A2" / "Grammar B1" but they all share skill="grammar").
            # Fall back to passage.skill, then to section_name for legacy items.
            skill = (
                (section.skill if section and section.skill else None)
                or (passage.skill if passage else None)
                or (item.section_name or "unknown")
            )
            grade_rows.append({
                "skill": skill,
                "cefr_level": item.cefr_level,
                "score_earned": grade.score_earned,
                "score_max": grade.score_max,
            })

        verdict = classify(grade_rows)
        ts.overall_cefr = verdict["overall_cefr"]
        ts.skill_cefr = verdict["skill_cefr"]
        ts.verdict = verdict["verdict"]
        await session.commit()
