from typing import Optional
from typing_extensions import TypedDict


class PipelineState(TypedDict):
    raw_requirement: str
    job_id: str

    blueprint: Optional[dict]
    passage: Optional[str]
    raw_questions: Optional[list]
    questions_with_options: Optional[list]

    judge_results: Optional[list]
    judge_passed: bool
    revision_count: int
    should_revise: bool

    error: Optional[str]
