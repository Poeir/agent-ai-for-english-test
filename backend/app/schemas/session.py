import uuid
from datetime import datetime

from pydantic import BaseModel


class SessionCreateRequest(BaseModel):
    paper_id: uuid.UUID
    candidate_name: str | None = None


class CandidateItemView(BaseModel):
    """Item as shown to a candidate — no correct_answer, no explanation, no judge fields."""
    id: uuid.UUID
    section_name: str | None
    skill: str | None
    question_type: str | None
    stem: str
    options: dict | None
    cefr_level: str | None
    score_weight: float | None
    passage_id: uuid.UUID | None = None
    passage_content: str | None = None


class SessionStartResponse(BaseModel):
    session_id: uuid.UUID
    paper_id: uuid.UUID
    paper_name: str
    time_limit_min: int | None
    items: list[CandidateItemView]
    started_at: datetime


class AnswerRequest(BaseModel):
    item_id: uuid.UUID
    answer: str


class GradeBreakdown(BaseModel):
    item_id: uuid.UUID
    section_name: str | None
    skill: str | None
    cefr_level: str | None
    question_type: str | None
    stem: str | None = None
    passage_content: str | None = None
    response: str | None
    correct_answer: str | None
    is_correct: bool | None
    score_earned: float | None
    score_max: float | None
    explanation: str | None
    judge_detail: dict | None = None


class SessionResultResponse(BaseModel):
    session_id: uuid.UUID
    status: str
    total_score: float | None
    max_score: float | None
    overall_cefr: str | None
    skill_cefr: dict[str, str] = {}
    verdict: str | None
    breakdown: list[GradeBreakdown] = []
    submitted_at: datetime | None
    scored_at: datetime | None


class SessionProgressResponse(BaseModel):
    session_id: uuid.UUID
    paper_id: uuid.UUID
    status: str
    answered_count: int
    total_count: int
    started_at: datetime
    submitted_at: datetime | None
