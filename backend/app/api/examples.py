import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.example import ExampleItem
from app.schemas.example import ExampleItemCreate, ExampleItemSchema

router = APIRouter(tags=["examples"])


@router.post("/examples", response_model=ExampleItemSchema, status_code=201)
async def create_example(payload: ExampleItemCreate, db: AsyncSession = Depends(get_db)):
    example = ExampleItem(**payload.model_dump())
    db.add(example)
    await db.commit()
    await db.refresh(example)
    return ExampleItemSchema.model_validate(example)


@router.post("/examples/bulk", response_model=list[ExampleItemSchema], status_code=201)
async def create_examples_bulk(payload: list[ExampleItemCreate], db: AsyncSession = Depends(get_db)):
    examples = [ExampleItem(**item.model_dump()) for item in payload]
    db.add_all(examples)
    await db.commit()
    for e in examples:
        await db.refresh(e)
    return [ExampleItemSchema.model_validate(e) for e in examples]


@router.get("/examples", response_model=list[ExampleItemSchema])
async def list_examples(
    skill: str | None = Query(None),
    cefr_level: str | None = Query(None),
    question_type: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ExampleItem)
    if skill:
        stmt = stmt.where(ExampleItem.skill == skill)
    if cefr_level:
        stmt = stmt.where(ExampleItem.cefr_level == cefr_level)
    if question_type:
        stmt = stmt.where(ExampleItem.question_type == question_type)

    stmt = stmt.order_by(ExampleItem.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    return [ExampleItemSchema.model_validate(e) for e in result.scalars().all()]


@router.delete("/examples/{example_id}", status_code=204)
async def delete_example(example_id: str, db: AsyncSession = Depends(get_db)):
    try:
        uid = uuid.UUID(example_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid example_id format")

    example = await db.get(ExampleItem, uid)
    if not example:
        raise HTTPException(status_code=404, detail="Example not found")

    await db.delete(example)
    await db.commit()
