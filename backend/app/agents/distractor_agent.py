import json
import os

from app.agents.state import PipelineState
from app.utils.llm_client import LLMError, complete

_SYSTEM_PROMPT: str | None = None


def _load_system_prompt() -> str:
    global _SYSTEM_PROMPT
    if _SYSTEM_PROMPT is None:
        prompt_path = os.path.join(os.path.dirname(__file__), "..", "prompts", "distractor_system.txt")
        with open(os.path.normpath(prompt_path), encoding="utf-8") as f:
            _SYSTEM_PROMPT = f.read()
    return _SYSTEM_PROMPT


async def distractor_node(state: PipelineState) -> dict:
    if state.get("error"):
        return {}

    raw_questions = state.get("raw_questions") or []
    if not raw_questions:
        return {"error": "distractor_error: no raw_questions to process"}

    system = _load_system_prompt()
    user = (
        f"PASSAGE:\n{state['passage']}\n\n"
        f"TARGET CEFR LEVEL: {state['blueprint']['cefr']}\n\n"
        f"QUESTIONS:\n{json.dumps(raw_questions, indent=2)}"
    )

    try:
        raw = await complete(system, user)
        raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        items = json.loads(raw)

        if not isinstance(items, list) or len(items) != len(raw_questions):
            return {"error": f"distractor_error: expected {len(raw_questions)} items, got {len(items) if isinstance(items, list) else 'non-list'}"}

        valid_letters = {"A", "B", "C", "D"}
        for i, item in enumerate(items):
            options = item.get("options") or {}
            if set(options.keys()) != valid_letters:
                return {"error": f"distractor_error: question {i} options keys must be A/B/C/D, got {list(options.keys())}"}
            if item.get("correct_answer") not in valid_letters:
                return {"error": f"distractor_error: question {i} correct_answer must be A/B/C/D, got {item.get('correct_answer')}"}

        return {"questions_with_options": items, "error": None}
    except (LLMError, json.JSONDecodeError) as e:
        return {"error": f"distractor_error: {e}"}
