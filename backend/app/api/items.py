from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.item import QuestionItem
from app.schemas.item import QuestionItemSchema

router = APIRouter(tags=["items"])


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
