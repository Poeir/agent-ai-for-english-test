"""Free-text grader — NOT a graph node. Called directly from scoring_service."""
import json
import os

from app.utils.llm_client import LLMError, complete

_SYSTEM_PROMPT: str | None = None


def _load_system_prompt() -> str:
    global _SYSTEM_PROMPT
    if _SYSTEM_PROMPT is None:
        prompt_path = os.path.join(os.path.dirname(__file__), "..", "prompts", "grader_system.txt")
        with open(os.path.normpath(prompt_path), encoding="utf-8") as f:
            _SYSTEM_PROMPT = f.read()
    return _SYSTEM_PROMPT


async def grade_free_text(
    question_type: str,
    stem: str,
    model_answer: str | None,
    candidate_response: str,
    target_cefr: str | None,
    weight: float,
) -> dict:
    """Returns a dict with task_achievement, coherence, lexis, grammar, overall_percent, is_acceptable, feedback."""
    system = _load_system_prompt()
    user = (
        f"QUESTION_TYPE: {question_type}\n"
        f"TARGET_CEFR: {target_cefr or 'unspecified'}\n"
        f"WEIGHT: {weight}\n\n"
        f"STEM:\n{stem}\n\n"
        f"MODEL_ANSWER:\n{model_answer or '(none provided)'}\n\n"
        f"CANDIDATE_RESPONSE:\n{candidate_response}"
    )
    raw = await complete(system, user)
    raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise LLMError(f"grader returned invalid JSON: {e}") from e
