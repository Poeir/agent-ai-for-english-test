import uuid
from datetime import datetime

from pydantic import BaseModel


class QuestionItemSchema(BaseModel):
    id: uuid.UUID
    passage_id: uuid.UUID | None
    stem: str
    question_type: str | None
    correct_answer: str | None
    options: dict | None
    cefr_level: str | None
    difficulty: float | None
    judge_score: float | None
    status: str
    revision_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class GenerationRequest(BaseModel):
    requirement: str
    item_count: int = 5
