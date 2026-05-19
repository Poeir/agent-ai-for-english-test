import asyncio
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.models.generation_job import GenerationJob
from app.models.item import QuestionItem
from app.models.paper import Paper, PaperSection
from app.schemas.paper import PaperCreateRequest, SectionSpec
from app.services import job_registry
from app.services.generation_service import run_pipeline_for_blueprint


_DEFAULT_LENGTH = {
    "reading": "120-160 words",
    "listening": "120-160 words",
    "grammar": "none",
    "vocabulary": "none",
    "writing": "none",
    "speaking": "none",
    "integrated": "120-160 words",
}


def _section_to_blueprint(s: SectionSpec) -> dict:
    return {
        "skill": s.skill,
        "cefr": s.cefr,
        "topic": s.topic or "general",
        "passage_length": s.passage_length or _DEFAULT_LENGTH.get(s.skill, "none"),
        "question_types": s.question_types,
        "difficulty": "medium",
        "difficulty_mix": s.difficulty_mix,
        "item_count": s.item_count,
        "section_score": s.section_score,
        "section_name": s.name,
    }


async def create_paper(req: PaperCreateRequest) -> Paper:
    """Insert paper + per-section rows + per-section GenerationJob, then fire orchestrator."""
    async with AsyncSessionLocal() as session:
        paper = Paper(
            name=req.name,
            description=req.description,
            time_limit_min=req.time_limit_min,
            total_score=req.total_score,
            status="pending",
            blueprint_request=req.model_dump(mode="json"),
        )
        session.add(paper)
        await session.flush()

        for s in req.sections:
            job = GenerationJob(request={"paper_id": str(paper.id), "section_name": s.name, "blueprint": _section_to_blueprint(s)})
            session.add(job)
            await session.flush()

            section = PaperSection(
                paper_id=paper.id,
                name=s.name,
                skill=s.skill,
                cefr=s.cefr,
                topic=s.topic,
                passage_length=s.passage_length,
                question_types=s.question_types,
                item_count=s.item_count,
                section_score=s.section_score,
                section_time_min=s.section_time_min,
                difficulty_mix=s.difficulty_mix,
                job_id=job.id,
                status="pending",
            )
            session.add(section)

        await session.commit()
        await session.refresh(paper)
        paper_id = paper.id

    asyncio.create_task(_orchestrate(str(paper_id)))
    return await _load_paper(str(paper_id))


async def _orchestrate(paper_id: str):
    async with AsyncSessionLocal() as session:
        paper = await session.get(Paper, uuid.UUID(paper_id))
        if not paper:
            return
        paper.status = "running"
        await session.commit()

        sections_res = await session.execute(
            select(PaperSection).where(PaperSection.paper_id == paper.id)
        )
        sections = list(sections_res.scalars().all())
        section_data = [
            (
                str(s.id),
                str(s.job_id) if s.job_id else None,
                s.name,
                _section_to_blueprint(SectionSpec(
                    name=s.name, skill=s.skill, cefr=s.cefr,
                    topic=s.topic, passage_length=s.passage_length,
                    question_types=s.question_types or [],
                    item_count=s.item_count or 1,
                    section_score=s.section_score or 1.0,
                    section_time_min=s.section_time_min,
                    difficulty_mix=s.difficulty_mix,
                )),
            )
            for s in sections
        ]

    coros = [_run_section(sid, jid, name, bp) for sid, jid, name, bp in section_data]
    await asyncio.gather(*coros, return_exceptions=True)

    # Recompute paper status from sections
    async with AsyncSessionLocal() as session:
        paper = await session.get(Paper, uuid.UUID(paper_id))
        # If the user cancelled mid-flight, don't overwrite the cancelled status.
        if paper.status == "cancelled":
            await session.commit()
            return
        sections_res = await session.execute(
            select(PaperSection).where(PaperSection.paper_id == paper.id)
        )
        all_sections = list(sections_res.scalars().all())
        completed = sum(1 for s in all_sections if s.status == "completed")
        cancelled = sum(1 for s in all_sections if s.status == "cancelled")
        if completed == len(all_sections):
            paper.status = "completed"
        elif completed == 0 and cancelled > 0:
            paper.status = "cancelled"
        elif completed == 0:
            paper.status = "failed"
        else:
            paper.status = "partial"
        paper.completed_at = datetime.now(timezone.utc)
        await session.commit()


async def _run_section(section_id: str, job_id: str | None, section_name: str, blueprint: dict):
    if not job_id:
        await _mark_section(section_id, status="failed", error="no job_id assigned")
        return
    try:
        item_ids, passage_id = await run_pipeline_for_blueprint(
            job_id=job_id, blueprint=blueprint,
            paper_id=None,                 # paper_id is also set via QuestionItem.paper_id below
            section_name=section_name,
        )
        # Patch paper_id onto items (run_pipeline_for_blueprint receives paper_id=None for section flow;
        # we re-fetch and set paper_id explicitly to support orphan-detection on cascade)
        await _mark_section(
            section_id, status="completed" if item_ids else "failed",
            passage_id=passage_id,
            error=None if item_ids else "no items produced",
            item_ids=item_ids,
        )
    except asyncio.CancelledError:
        await asyncio.shield(_mark_section(section_id, status="cancelled", error="cancelled by user"))
        raise
    except Exception as e:
        await _mark_section(section_id, status="failed", error=str(e))


async def _mark_section(
    section_id: str,
    status: str,
    error: str | None = None,
    passage_id: str | None = None,
    item_ids: list[str] | None = None,
):
    async with AsyncSessionLocal() as session:
        section = await session.get(PaperSection, uuid.UUID(section_id))
        if not section:
            return
        section.status = status
        section.error_message = error
        if passage_id:
            section.passage_id = uuid.UUID(passage_id)
        await session.commit()

        # Tag created items with paper_id for the cascade relationship
        if item_ids and status == "completed":
            await session.execute(
                QuestionItem.__table__.update()
                .where(QuestionItem.id.in_([uuid.UUID(i) for i in item_ids]))
                .values(paper_id=section.paper_id)
            )
            await session.commit()


async def _load_paper(paper_id: str) -> Paper:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Paper).where(Paper.id == uuid.UUID(paper_id)).options(selectinload(Paper.sections))
        )
        return result.scalar_one()


async def get_paper(paper_id: str) -> Paper | None:
    try:
        return await _load_paper(paper_id)
    except Exception:
        return None


async def list_papers(status: str | None = None, limit: int = 20, offset: int = 0) -> list[Paper]:
    async with AsyncSessionLocal() as session:
        stmt = select(Paper).options(selectinload(Paper.sections)).order_by(Paper.created_at.desc()).limit(limit).offset(offset)
        if status:
            stmt = stmt.where(Paper.status == status)
        result = await session.execute(stmt)
        return list(result.scalars().all())


async def get_paper_items(paper_id: str) -> list[QuestionItem]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(QuestionItem)
            .where(QuestionItem.paper_id == uuid.UUID(paper_id))
            .order_by(QuestionItem.section_name, QuestionItem.created_at)
        )
        return list(result.scalars().all())


async def cancel_paper(paper_id: str) -> Paper | None:
    """Cancel all in-flight section jobs and mark the paper as cancelled.

    Returns the updated paper. Raises ValueError if already terminal.
    """
    async with AsyncSessionLocal() as session:
        paper = await session.get(Paper, uuid.UUID(paper_id))
        if not paper:
            return None
        if paper.status in ("completed", "failed", "cancelled", "partial"):
            raise ValueError(f"Paper already {paper.status}")

        sections_res = await session.execute(
            select(PaperSection).where(PaperSection.paper_id == paper.id)
        )
        sections = list(sections_res.scalars().all())

        for s in sections:
            if s.status not in ("pending", "running") or not s.job_id:
                continue
            signalled = job_registry.cancel(str(s.job_id))
            if not signalled:
                # Orphan (task isn't running on this server). Mark directly.
                s.status = "cancelled"
                s.error_message = "Cancelled by user (task not running on server)"
                job = await session.get(GenerationJob, s.job_id)
                if job and job.status in ("pending", "running"):
                    job.status = "cancelled"
                    job.error_message = "Cancelled by user (task not running on server)"
                    job.completed_at = datetime.now(timezone.utc)

        paper.status = "cancelled"
        paper.completed_at = datetime.now(timezone.utc)
        await session.commit()

    return await _load_paper(paper_id)


async def get_section_item_ids(section_id: str) -> list[uuid.UUID]:
    """Best-effort: get item_ids that belong to a section by paper_id + section_name."""
    async with AsyncSessionLocal() as session:
        section = await session.get(PaperSection, uuid.UUID(section_id))
        if not section:
            return []
        result = await session.execute(
            select(QuestionItem.id)
            .where(QuestionItem.paper_id == section.paper_id)
            .where(QuestionItem.section_name == section.name)
            .order_by(QuestionItem.created_at)
        )
        return [r[0] for r in result.all()]
