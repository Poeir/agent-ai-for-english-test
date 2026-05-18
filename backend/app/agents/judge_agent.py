import json
import os

from app.agents.state import PipelineState
from app.config import settings
from app.utils.llm_client import LLMError, complete

_SYSTEM_PROMPT: str | None = None


def _load_system_prompt() -> str:
    global _SYSTEM_PROMPT
    if _SYSTEM_PROMPT is None:
        prompt_path = os.path.join(os.path.dirname(__file__), "..", "prompts", "judge_system.txt")
        with open(os.path.normpath(prompt_path), encoding="utf-8") as f:
            _SYSTEM_PROMPT = f.read()
    return _SYSTEM_PROMPT


async def judge_node(state: PipelineState) -> dict:
    if state.get("error"):
        return {}

    system = _load_system_prompt()
    questions = state.get("questions_with_options") or state.get("raw_questions", [])
    user = (
        f"Evaluate these questions from the following passage.\n\n"
        f"PASSAGE:\n{state['passage']}\n\n"
        f"QUESTIONS:\n{json.dumps(questions, indent=2)}\n\n"
        f"Target CEFR level: {state['blueprint']['cefr']}"
    )

    try:
        raw = await complete(system, user)
        raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        judge_results = json.loads(raw)

        threshold = settings.judge_pass_threshold
        all_pass = all(r.get("overall_score", 0) >= threshold and r.get("ambiguity_risk") != "high" for r in judge_results)
        revision_count = state.get("revision_count", 0)
        should_revise = not all_pass and revision_count < settings.max_revision_loops

        return {
            "judge_results": judge_results,
            "judge_passed": all_pass,
            "should_revise": should_revise,
            "error": None,
        }
    except (LLMError, json.JSONDecodeError) as e:
        return {"error": f"judge_error: {e}"}
