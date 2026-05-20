import json
import os

from app.agents.state import PipelineState
from app.config import settings
from app.utils.llm_client import LLMError, complete

_SYSTEM_PROMPT: str | None = None

# When the verifier disagrees with the claimed correct answer, the judge score is capped to
# this value so that the question cannot pass on rubric scores alone — the answer key MUST be fixed.
_VERIFIER_FAIL_CAP = 3.0


def _load_system_prompt() -> str:
    global _SYSTEM_PROMPT
    if _SYSTEM_PROMPT is None:
        prompt_path = os.path.join(os.path.dirname(__file__), "..", "prompts", "judge_system.txt")
        with open(os.path.normpath(prompt_path), encoding="utf-8") as f:
            _SYSTEM_PROMPT = f.read()
    return _SYSTEM_PROMPT


def _merge_verifier_disagreement(judge_results: list, verifier_results: list) -> list:
    """For any question whose answer key the verifier disagrees with, cap its overall_score
    to a failing value, force-set pass=false, and append the mismatch to issues/suggestions
    so the next generator revision will see it."""
    if not verifier_results:
        return judge_results

    by_idx = {v.get("question_index"): v for v in verifier_results}
    out = []
    for r in judge_results:
        idx = r.get("question_index")
        v = by_idx.get(idx)
        if not v or v.get("skipped") or v.get("agrees", True):
            out.append(r)
            continue

        merged = dict(r)
        claimed = v.get("claimed_answer")
        verifier_ans = v.get("verifier_answer")
        reasoning = v.get("reasoning") or ""
        issues = list(merged.get("issues") or [])
        suggestions = list(merged.get("revision_suggestions") or [])

        issues.append(
            f"ANSWER-KEY MISMATCH: independent verifier solved this as '{verifier_ans}' "
            f"but the claimed correct answer is '{claimed}'. Verifier reasoning: {reasoning}"
        )
        suggestions.append(
            f"Re-derive the correct answer from the passage. Either change the answer key to "
            f"'{verifier_ans}' (if the verifier is right) or rewrite the passage/options so that "
            f"'{claimed}' is unambiguously correct."
        )

        merged["issues"] = issues
        merged["revision_suggestions"] = suggestions
        merged["pass"] = False
        merged["verifier_mismatch"] = True
        # Cap the score so the question fails the pass threshold no matter what.
        if (merged.get("overall_score") or 10) > _VERIFIER_FAIL_CAP:
            merged["overall_score"] = _VERIFIER_FAIL_CAP
        merged["ambiguity_risk"] = "high"
        out.append(merged)

    return out


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
        raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        judge_results = json.loads(raw)

        # Merge in answer-key verifier results — force-fail items the verifier flagged.
        judge_results = _merge_verifier_disagreement(judge_results, state.get("verifier_results") or [])

        threshold = settings.judge_pass_threshold
        all_pass = all(r.get("overall_score", 0) >= threshold and r.get("ambiguity_risk") != "high" for r in judge_results)
        revision_count = state.get("revision_count", 0)
        should_revise = revision_count < settings.max_revision_loops

        return {
            "judge_results": judge_results,
            "judge_passed": all_pass,
            "should_revise": should_revise,
            "revision_count": revision_count + 1 if should_revise else revision_count,
            "error": None,
        }
    except (LLMError, json.JSONDecodeError) as e:
        return {"error": f"judge_error: {e}"}
