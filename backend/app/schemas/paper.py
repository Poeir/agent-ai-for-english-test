import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SectionSpec(BaseModel):
    name: str
    skill: Literal["reading", "listening", "grammar", "vocabulary", "writing", "speaking", "integrated"]
    cefr: Literal["A1", "A2", "B1", "B2", "C1", "C2"]
    topic: str | None = None
    passage_length: str | None = None
    question_types: list[str] = Field(min_length=1)
    item_count: int = Field(ge=1, le=50)
    section_score: float = Field(gt=0)
    section_time_min: int | None = None
    difficulty_mix: dict[str, float] | None = None


class PaperCreateRequest(BaseModel):
    name: str
    description: str | None = None
    time_limit_min: int | None = None
    total_score: float | None = None
    sections: list[SectionSpec] = Field(min_length=1)


class PaperSectionResponse(BaseModel):
    id: uuid.UUID
    name: str
    skill: str | None
    cefr: str | None
    topic: str | None
    item_count: int | None
    section_score: float | None
    section_time_min: int | None
    status: str
    job_id: uuid.UUID | None
    error_message: str | None
    passage_id: uuid.UUID | None
    passage_content: str | None = None
    item_ids: list[uuid.UUID] = []

    model_config = {"from_attributes": True}


class PaperResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    status: str
    total_score: float | None
    time_limit_min: int | None
    sections: list[PaperSectionResponse]
    created_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}
