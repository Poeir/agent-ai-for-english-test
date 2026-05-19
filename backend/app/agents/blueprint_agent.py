import json
import os

from app.agents.state import PipelineState
from app.utils.llm_client import LLMError, complete

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
        raw = await complete(system, user)
        # Strip markdown code fences if present
        raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        blueprint = json.loads(raw)
        return {"blueprint": blueprint, "error": None}
    except (LLMError, json.JSONDecodeError) as e:
        return {"error": f"blueprint_error: {e}"}
