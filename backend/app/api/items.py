import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.item import Passage, QuestionItem
from app.schemas.item import PassageWithQuestionsSchema, QuestionItemSchema

router = APIRouter(tags=["items"])


@router.get("/passages/{passage_id}", response_model=PassageWithQuestionsSchema)
async def get_passage(passage_id: str, db: AsyncSession = Depends(get_db)):
    try:
        uid = uuid.UUID(passage_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid passage_id")
    result = await db.execute(
        select(Passage).where(Passage.id == uid).options(selectinload(Passage.questions))
    )
    passage = result.scalar_one_or_none()
    if not passage:
        raise HTTPException(status_code=404, detail="Passage not found")
    return PassageWithQuestionsSchema.model_validate(passage)


@router.get("/items", response_model=list[QuestionItemSchema])
async def list_items(
    cefr: str | None = Query(None),
    skill: str | None = Query(None),
    status: str | None = Query(None),
    question_type: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(QuestionItem)

    if cefr:
        stmt = stmt.where(QuestionItem.cefr_level == cefr)
    if status:
        stmt = stmt.where(QuestionItem.status == status)
    if question_type:
        stmt = stmt.where(QuestionItem.question_type == question_type)

    stmt = stmt.order_by(QuestionItem.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    items = result.scalars().all()
    return [QuestionItemSchema.model_validate(item) for item in items]


@router.get("/passages", response_model=list[PassageWithQuestionsSchema])
async def list_passages(
    cefr: str | None = Query(None),
    skill: str | None = Query(None),
    topic: str | None = Query(None),
    limit: int = Query(20, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Passages with their questions nested — group test items by the test they belong to."""
    stmt = select(Passage).options(selectinload(Passage.questions))

    if cefr:
        stmt = stmt.where(Passage.cefr_level == cefr)
    if skill:
        stmt = stmt.where(Passage.skill == skill)
    if topic:
        stmt = stmt.where(Passage.topic.ilike(f"%{topic}%"))

    stmt = stmt.order_by(Passage.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    passages = result.scalars().all()
    return [PassageWithQuestionsSchema.model_validate(p) for p in passages]
