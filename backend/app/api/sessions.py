import asyncio
import random
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.item import Passage, QuestionItem
from app.models.paper import Paper, PaperSection
from app.models.session import SessionGrade, TestSession
from app.schemas.session import (
    AnswerRequest,
    CandidateItemView,
    GradeBreakdown,
    SessionCreateRequest,
    SessionProgressResponse,
    SessionResultResponse,
    SessionStartResponse,
)
from app.services.scoring_service import grade_session, load_session_breakdown

router = APIRouter(tags=["sessions"])


def _strip_options_for_candidate(options: dict | None) -> dict | None:
    """Remove _extras section that may contain answer hints (e.g., error_identification 'correction')."""
    if not options:
        return options
    cleaned = {k: v for k, v in options.items() if k != "_extras"}
    # Preserve extras subset that's safe for candidates (e.g., gapped_text, items list)
    extras = options.get("_extras") or {}
    safe_extras = {k: v for k, v in extras.items() if k in {"gapped_text", "items", "left", "right", "blank_count", "max_words", "min_words", "prep_seconds", "response_seconds"}}
    if safe_extras:
        cleaned["_extras"] = safe_extras
    return cleaned or None


@router.post("/sessions", response_model=SessionStartResponse, status_code=201)
async def start_session(req: SessionCreateRequest, db: AsyncSession = Depends(get_db)):
    paper = await db.get(Paper, req.paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    if paper.status not in ("completed", "partial"):
        raise HTTPException(status_code=400, detail=f"Paper not ready (status={paper.status})")

    # Load items in paper, grouped by section. Join PaperSection so we can carry
    # the authoritative skill on each item (non-passage items like Grammar have
    # no passage to derive skill from).
    result = await db.execute(
        select(QuestionItem, Passage, PaperSection)
        .outerjoin(Passage, QuestionItem.passage_id == Passage.id)
        .outerjoin(
            PaperSection,
            (PaperSection.paper_id == QuestionItem.paper_id)
            & (PaperSection.name == QuestionItem.section_name),
        )
        .where(QuestionItem.paper_id == paper.id)
        .order_by(QuestionItem.section_name, QuestionItem.created_at)
    )
    rows = result.all()
    if not rows:
        raise HTTPException(status_code=400, detail="No items in this paper")

    # Shuffle within each section, preserve section order
    by_section: dict[str | None, list[tuple[QuestionItem, Passage | None, PaperSection | None]]] = {}
    for item, passage, section in rows:
        by_section.setdefault(item.section_name, []).append((item, passage, section))
    for k in by_section:
        random.shuffle(by_section[k])

    ordered: list[tuple[QuestionItem, Passage | None, PaperSection | None]] = []
    for section_name, triples in by_section.items():
        ordered.extend(triples)

    item_order = [str(i.id) for i, _, _ in ordered]

    session = TestSession(
        paper_id=paper.id,
        candidate_name=req.candidate_name,
        item_order=item_order,
        responses={},
        status="in_progress",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    candidate_items = [
        CandidateItemView(
            id=item.id,
            section_name=item.section_name,
            skill=(
                (section.skill if section and section.skill else None)
                or (passage.skill if passage else None)
            ),
            question_type=item.question_type,
            stem=item.stem,
            options=_strip_options_for_candidate(item.options),
            cefr_level=item.cefr_level,
            score_weight=item.score_weight,
            passage_id=item.passage_id,
            passage_content=(passage.content if passage and passage.content else None),
        )
        for item, passage, section in ordered
    ]

    return SessionStartResponse(
        session_id=session.id,
        paper_id=paper.id,
        paper_name=paper.name,
        time_limit_min=paper.time_limit_min,
        items=candidate_items,
        started_at=session.started_at,
    )


@router.post("/sessions/{session_id}/answer")
async def submit_answer(session_id: str, req: AnswerRequest, db: AsyncSession = Depends(get_db)):
    try:
        uid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")

    session = await db.get(TestSession, uid)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != "in_progress":
        raise HTTPException(status_code=400, detail=f"Session not in progress (status={session.status})")

    responses = dict(session.responses or {})
    responses[str(req.item_id)] = req.answer
    session.responses = responses
    await db.commit()

    return {"ok": True, "answered_count": len(responses), "total_count": len(session.item_order or [])}


@router.post("/sessions/{session_id}/submit")
async def submit_session(session_id: str, db: AsyncSession = Depends(get_db)):
    try:
        uid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")

    session = await db.get(TestSession, uid)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status not in ("in_progress",):
        raise HTTPException(status_code=400, detail=f"Cannot submit (status={session.status})")

    session.status = "submitted"
    session.submitted_at = datetime.now(timezone.utc)
    await db.commit()

    asyncio.create_task(grade_session(session_id))
    return {"session_id": session_id, "status": "submitted"}


@router.get("/sessions/{session_id}", response_model=SessionProgressResponse)
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    try:
        uid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")
    session = await db.get(TestSession, uid)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionProgressResponse(
        session_id=session.id, paper_id=session.paper_id, status=session.status,
        answered_count=len(session.responses or {}),
        total_count=len(session.item_order or []),
        started_at=session.started_at, submitted_at=session.submitted_at,
    )


@router.get("/sessions/{session_id}/result", response_model=SessionResultResponse)
async def get_session_result(session_id: str, db: AsyncSession = Depends(get_db)):
    try:
        uid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")
    session = await db.get(TestSession, uid)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    breakdown: list[GradeBreakdown] = []
    if session.status == "scored":
        rows = await load_session_breakdown(session_id)
        breakdown = [GradeBreakdown(**r) for r in rows]

    return SessionResultResponse(
        session_id=session.id, status=session.status,
        total_score=session.total_score, max_score=session.max_score,
        overall_cefr=session.overall_cefr, skill_cefr=session.skill_cefr or {},
        verdict=session.verdict, breakdown=breakdown,
        submitted_at=session.submitted_at, scored_at=session.scored_at,
    )
