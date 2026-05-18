from typing import Literal

from pydantic import BaseModel, Field


class JudgeResult(BaseModel):
    question_index: int
    cefr_alignment: float = Field(ge=0, le=10)
    ambiguity_risk: Literal["low", "medium", "high"]
    distractor_quality: float = Field(ge=0, le=10)
    grammar_naturalness: float = Field(ge=0, le=10)
    overall_score: float = Field(ge=0, le=10)
    pass_: bool = Field(alias="pass")
    issues: list[str] = Field(default_factory=list)
    revision_suggestions: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}
