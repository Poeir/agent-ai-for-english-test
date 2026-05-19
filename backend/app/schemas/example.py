import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ExampleItemCreate(BaseModel):
    skill: Literal["reading", "listening", "grammar"]
    cefr_level: Literal["A1", "A2", "B1", "B2", "C1", "C2"]
    question_type: str | None = None
    topic: str | None = None
    passage: str | None = None
    stem: str = Field(min_length=1)
    options: dict | None = None
    correct_answer: str | None = None
    notes: str | None = None
    source: str | None = None


class ExampleItemSchema(ExampleItemCreate):
    id: uuid.UUID
    created_at: datetime

    model_config = {"from_attributes": True}
