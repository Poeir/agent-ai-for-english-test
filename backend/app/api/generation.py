import asyncio
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.generation_job import GenerationJob
from app.services import job_registry
from app.services.generation_service import run_pipeline

router = APIRouter(tags=["generation"])


class GenerationRequest(BaseModel):
    requirement: str
    item_count: int = 5


class JobResponse(BaseModel):
    job_id: str
    status: str
    current_node: str | None = None
    result: dict | None = None
    error_message: str | None = None
    request: dict | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime | None = None


@router.post("/generate", response_model=JobResponse)
async def generate(request: GenerationRequest, db: AsyncSession = Depends(get_db)):
    job = GenerationJob(
        request={"requirement": request.requirement, "item_count": request.item_count},
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    job_id = str(job.id)
    # Fire-and-forget — does not block the response
    task = asyncio.create_task(run_pipeline(job_id, request.requirement))
    job_registry.register(job_id, task)

    return JobResponse(job_id=job_id, status="pending")


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str, db: AsyncSession = Depends(get_db)):
    try:
        uid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job_id format")

    job = await db.get(GenerationJob, uid)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return _to_response(job)


@router.post("/jobs/{job_id}/cancel", response_model=JobResponse)
async def cancel_job(job_id: str, db: AsyncSession = Depends(get_db)):
    try:
        uid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job_id format")

    job = await db.get(GenerationJob, uid)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status in ("completed", "failed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Job already {job.status}")

    signalled = job_registry.cancel(job_id)
    if not signalled:
        # Task isn't running on this server (e.g., restart, or job was orphaned).
        # Mark cancelled directly — no runner will follow up.
        job.status = "cancelled"
        job.error_message = "Cancelled by user (task was not running on this server)"
        job.completed_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(job)
    # Otherwise: the pipeline runner's CancelledError handler will set the final
    # cancelled state in the DB. The client will see it on the next poll.
    return _to_response(job)


@router.get("/jobs", response_model=list[JobResponse])
async def list_jobs(
    status: str | None = Query(None, description="Filter by status: pending, running, completed, failed"),
    limit: int = Query(20, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(GenerationJob).order_by(GenerationJob.created_at.desc()).limit(limit).offset(offset)
    if status:
        stmt = stmt.where(GenerationJob.status == status)
    result = await db.execute(stmt)
    jobs = result.scalars().all()
    return [_to_response(j) for j in jobs]


def _to_response(job: GenerationJob) -> JobResponse:
    return JobResponse(
        job_id=str(job.id),
        status=job.status,
        current_node=job.current_node,
        result=job.result,
        error_message=job.error_message,
        request=job.request,
        started_at=job.started_at,
        completed_at=job.completed_at,
        created_at=job.created_at,
    )
