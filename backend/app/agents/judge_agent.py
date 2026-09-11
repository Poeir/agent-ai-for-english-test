import json
import os

from app.agents.state import PipelineState
from app.config import settings
from app.utils.llm_client import LLMError, complete
from app.utils.json_parser import parse_json_with_repair
from app.utils.item_quality import apply_local_quality_lint

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
        raw = await complete(system, user, agent="judge")
        judge_results = await parse_json_with_repair(
            raw,
            agent="judge",
            expected='[{"question_index": 0, "overall_score": 0, "ambiguity_risk": "low", "pass": false, "issues": [], "revision_suggestions": []}]',
        )
        if not isinstance(judge_results, list):
            return {"error": "judge_error: expected a JSON array of per-question results"}
        judge_results = apply_local_quality_lint(state.get("passage") or "", questions, judge_results)

        threshold = settings.judge_pass_threshold
        all_pass = all(
            r.get("pass", False)
            and r.get("overall_score", 0) >= threshold
            and r.get("ambiguity_risk") != "high"
            for r in judge_results
        )
        revision_count = state.get("revision_count", 0)
        # Revise only when at least one question failed AND we still have budget.
        # Previously this was unconditional ("always polish once") which doubled cost
        # even when the first pass was already good. See verifier_agent for the other
        # revise trigger (answer-key disagreement).
        should_revise = (not all_pass) and revision_count < settings.max_revision_loops

        return {
            "judge_results": judge_results,
            "judge_passed": all_pass,
            "should_revise": should_revise,
            "revision_count": revision_count + 1 if should_revise else revision_count,
            "error": None,
        }
    except LLMError as e:
        return {"error": f"judge_error: {e}"}
