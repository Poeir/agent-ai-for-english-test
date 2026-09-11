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
    judge_detail: dict | None = None
    status: str
    revision_count: int
    difficulty_band: str | None = None
    score_weight: float | None = None
    objective: str | None = None
    explanation: str | None = None
    tags: list | None = None
    paper_id: uuid.UUID | None = None
    section_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PassageWithQuestionsSchema(BaseModel):
    id: uuid.UUID
    content: str
    word_count: int | None
    cefr_level: str | None
    topic: str | None
    skill: str | None
    created_at: datetime
    questions: list[QuestionItemSchema]

    model_config = {"from_attributes": True}


class GenerationRequest(BaseModel):
    requirement: str
    item_count: int = 5
