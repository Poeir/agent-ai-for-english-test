import os

from app.agents.state import PipelineState
from app.utils.llm_client import LLMError, complete
from app.utils.json_parser import parse_json_with_repair

_SYSTEM_PROMPT: str | None = None


def _load_system_prompt() -> str:
    global _SYSTEM_PROMPT
    if _SYSTEM_PROMPT is None:
        prompt_path = os.path.join(os.path.dirname(__file__), "..", "prompts", "blueprint_system.txt")
        with open(os.path.normpath(prompt_path), encoding="utf-8") as f:
            _SYSTEM_PROMPT = f.read()
    return _SYSTEM_PROMPT


async def blueprint_node(state: PipelineState) -> dict:
    # Paper flow pre-seeds blueprint directly; skip the LLM in that case.
    if state.get("blueprint"):
        return {}

    system = _load_system_prompt()
    user = f"Convert this requirement into a test blueprint:\n\n{state['raw_requirement']}"

    try:
        raw = await complete(system, user, agent="blueprint")
        blueprint = await parse_json_with_repair(
            raw,
            agent="blueprint",
            expected='{"skill": "...", "cefr": "...", "topic": "...", "passage_length": "...", "question_types": [], "difficulty": "...", "item_count": 1}',
        )
        return {"blueprint": blueprint, "error": None}
    except LLMError as e:
        return {"error": f"blueprint_error: {e}"}
