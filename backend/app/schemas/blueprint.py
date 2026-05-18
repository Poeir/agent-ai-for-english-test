from typing import Literal

from pydantic import BaseModel, Field


class BlueprintSpec(BaseModel):
    skill: Literal["reading", "listening", "grammar"]
    cefr: Literal["A1", "A2", "B1", "B2", "C1", "C2"]
    topic: str
    passage_length: str = Field(description="e.g. '120-160 words'")
    question_types: list[str] = Field(description="e.g. ['main_idea', 'detail', 'inference']")
    difficulty: Literal["easy", "medium", "hard"]
    item_count: int = Field(ge=1, le=50)
