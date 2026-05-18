import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.generation_job import GenerationJob
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
    started_at: datetime | None = None
    completed_at: datetime | None = None


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
    asyncio.create_task(run_pipeline(job_id, request.requirement))

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

    return JobResponse(
        job_id=str(job.id),
        status=job.status,
        current_node=job.current_node,
        result=job.result,
        error_message=job.error_message,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )
