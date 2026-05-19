import uuid

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.item import Passage
from app.schemas.item import QuestionItemSchema
from app.schemas.paper import PaperCreateRequest, PaperResponse, PaperSectionResponse
from app.services import paper_service

router = APIRouter(tags=["papers"])


async def _load_passages_map(passage_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    ids = [p for p in passage_ids if p is not None]
    if not ids:
        return {}
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Passage).where(Passage.id.in_(ids)))
        return {p.id: p.content for p in result.scalars().all()}


def _to_response(
    paper,
    item_ids_by_section: dict[str, list[uuid.UUID]] | None = None,
    passages_map: dict[uuid.UUID, str] | None = None,
) -> PaperResponse:
    sections = []
    for s in paper.sections:
        ids = (item_ids_by_section or {}).get(str(s.id), [])
        passage_content = (passages_map or {}).get(s.passage_id) if s.passage_id else None
        sections.append(PaperSectionResponse(
            id=s.id, name=s.name, skill=s.skill, cefr=s.cefr, topic=s.topic,
            item_count=s.item_count, section_score=s.section_score, section_time_min=s.section_time_min,
            status=s.status, job_id=s.job_id, error_message=s.error_message,
            passage_id=s.passage_id, passage_content=passage_content, item_ids=ids,
        ))
    return PaperResponse(
        id=paper.id, name=paper.name, description=paper.description, status=paper.status,
        total_score=paper.total_score, time_limit_min=paper.time_limit_min,
        sections=sections, created_at=paper.created_at, completed_at=paper.completed_at,
    )


@router.post("/papers", response_model=PaperResponse, status_code=202)
async def create_paper(req: PaperCreateRequest):
    paper = await paper_service.create_paper(req)
    return _to_response(paper)


@router.get("/papers", response_model=list[PaperResponse])
async def list_papers(status: str | None = Query(None), limit: int = Query(20, le=100), offset: int = Query(0, ge=0)):
    papers = await paper_service.list_papers(status=status, limit=limit, offset=offset)
    out = []
    for p in papers:
        item_map = {}
        for s in p.sections:
            item_map[str(s.id)] = await paper_service.get_section_item_ids(str(s.id))
        passages = await _load_passages_map([s.passage_id for s in p.sections])
        out.append(_to_response(p, item_map, passages))
    return out


@router.get("/papers/{paper_id}", response_model=PaperResponse)
async def get_paper(paper_id: str):
    try:
        uid = uuid.UUID(paper_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid paper_id")
    paper = await paper_service.get_paper(str(uid))
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    item_map = {}
    for s in paper.sections:
        item_map[str(s.id)] = await paper_service.get_section_item_ids(str(s.id))
    passages = await _load_passages_map([s.passage_id for s in paper.sections])
    return _to_response(paper, item_map, passages)


@router.post("/papers/{paper_id}/cancel", response_model=PaperResponse)
async def cancel_paper(paper_id: str):
    try:
        uid = uuid.UUID(paper_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid paper_id")
    try:
        paper = await paper_service.cancel_paper(str(uid))
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    return _to_response(paper)


@router.get("/papers/{paper_id}/items", response_model=list[QuestionItemSchema])
async def get_paper_items(paper_id: str):
    try:
        uid = uuid.UUID(paper_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid paper_id")
    items = await paper_service.get_paper_items(str(uid))
    return [QuestionItemSchema.model_validate(i) for i in items]
