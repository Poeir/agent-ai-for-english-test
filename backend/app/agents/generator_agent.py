import json
import os

from app.agents.state import PipelineState
from app.utils.llm_client import LLMError, complete

_SYSTEM_PROMPT: str | None = None


def _load_system_prompt() -> str:
    global _SYSTEM_PROMPT
    if _SYSTEM_PROMPT is None:
        prompt_path = os.path.join(os.path.dirname(__file__), "..", "prompts", "generator_system.txt")
        with open(os.path.normpath(prompt_path), encoding="utf-8") as f:
            _SYSTEM_PROMPT = f.read()
    return _SYSTEM_PROMPT


async def generator_node(state: PipelineState) -> dict:
    if state.get("error"):
        return {}

    blueprint = state["blueprint"]
    system = _load_system_prompt()
    user = (
        f"Generate a passage and {blueprint['item_count']} question stems based on this blueprint:\n\n"
        f"{json.dumps(blueprint, indent=2)}"
    )

    try:
        raw = await complete(system, user)
        raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        data = json.loads(raw)
        return {
            "passage": data.get("passage", ""),
            "raw_questions": data.get("questions", []),
            "error": None,
        }
    except (LLMError, json.JSONDecodeError) as e:
        return {"error": f"generator_error: {e}"}
