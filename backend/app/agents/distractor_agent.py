import json
import os

from app.agents.state import PipelineState
from app.utils.llm_client import LLMError, complete
from app.utils.json_parser import parse_json_with_repair
from app.utils.item_quality import rebalance_correct_letters

_SYSTEM_PROMPT: str | None = None


def _load_system_prompt() -> str:
    global _SYSTEM_PROMPT
    if _SYSTEM_PROMPT is None:
        prompt_path = os.path.join(os.path.dirname(__file__), "..", "prompts", "distractor_system.txt")
        with open(os.path.normpath(prompt_path), encoding="utf-8") as f:
            _SYSTEM_PROMPT = f.read()
    return _SYSTEM_PROMPT


MCQ_TYPES = {
    "multiple_choice",
    "main_idea",
    "detail",
    "inference",
    "vocabulary_in_context",
    "tone_purpose",
    "rhetorical_purpose",
    "author_attitude",
    "implication",
    "analogy_interpretation",
    "organization_logic",
    "fill_blank",
    "cloze",
}

LETTERS = {"A", "B", "C", "D"}


def _format_distractor_feedback(state: PipelineState) -> str:
    """During a revision pass, surface ONLY judge issues that relate to distractor quality."""
    if state.get("revision_count", 0) <= 0:
        return ""
    judge_results = state.get("judge_results") or []
    if not judge_results:
        return ""

    lines = [
        "## REVISION FEEDBACK — distractor problems in the previous attempt",
        "Fix every issue below; do NOT repeat these patterns.",
        "",
    ]
    any_distractor_feedback = False
    for r in judge_results:
        idx = r.get("question_index")
        # Only forward feedback when distractor_quality was weak OR issues mention distractors/options
        weak_dq = (r.get("distractor_quality") or 10) < 8
        issues = r.get("issues") or []
        suggestions = r.get("revision_suggestions") or []
        relevant_issues = [i for i in issues if any(k in i.lower() for k in ("distractor", "option", "length", "absurd", "extreme", "parallel"))]
        relevant_suggestions = [s for s in suggestions if any(k in s.lower() for k in ("distractor", "option", "replace"))]
        if not (weak_dq or relevant_issues or relevant_suggestions):
            continue
        any_distractor_feedback = True
        lines.append(f"- Question {idx} (distractor_quality {r.get('distractor_quality')}):")
        for i in relevant_issues or issues:
            lines.append(f"    ISSUE: {i}")
        for s in relevant_suggestions or suggestions:
            lines.append(f"    FIX:   {s}")

    if not any_distractor_feedback:
        return ""

    lines.append("")
    return "\n".join(lines) + "\n"


def _has_full_options(q: dict) -> bool:
    """A question already has complete MCQ options if its `options` dict contains all of A,B,C,D with non-empty text and `correct_answer` is one of those letters."""
    opts = q.get("options") or {}
    if not isinstance(opts, dict):
        return False
    if not LETTERS.issubset(opts.keys()):
        return False
    if any(not (opts.get(L) or "").strip() for L in LETTERS):
        return False
    return q.get("correct_answer") in LETTERS


async def distractor_node(state: PipelineState) -> dict:
    if state.get("error"):
        return {}

    raw_questions = state.get("raw_questions") or []
    if not raw_questions:
        return {"error": "distractor_error: no raw_questions to process"}

    # Only run the LLM for MCQ-shape items that DON'T already have full A/B/C/D options.
    # Everything else (free-text types, or MCQ items the generator already completed) is passed through.
    mcq_indices = [
        i for i, q in enumerate(raw_questions)
        if (q.get("question_type") or "multiple_choice") in MCQ_TYPES and not _has_full_options(q)
    ]
    mcq_questions = [raw_questions[i] for i in mcq_indices]

    finalized: list = list(raw_questions)  # default: pass everything through

    if not mcq_questions:
        return {"questions_with_options": rebalance_correct_letters(finalized, seed=state.get("job_id", "")), "error": None}

    system = _load_system_prompt()
    revision_block = _format_distractor_feedback(state)
    user = (
        f"{revision_block}"
        f"PASSAGE:\n{state['passage']}\n\n"
        f"TARGET CEFR LEVEL: {state['blueprint']['cefr']}\n\n"
        f"QUESTIONS:\n{json.dumps(mcq_questions, indent=2)}"
    )

    try:
        raw = await complete(system, user, agent="distractor")
        items = await parse_json_with_repair(
            raw,
            agent="distractor",
            expected='[{"stem": "...", "options": {"A": "...", "B": "...", "C": "...", "D": "..."}, "correct_answer": "A"}]',
        )

        if not isinstance(items, list) or len(items) != len(mcq_questions):
            return {"error": f"distractor_error: expected {len(mcq_questions)} items, got {len(items) if isinstance(items, list) else 'non-list'}"}

        valid_letters = {"A", "B", "C", "D"}
        for i, item in enumerate(items):
            options = item.get("options") or {}
            if set(options.keys()) != valid_letters:
                return {"error": f"distractor_error: question {i} options keys must be A/B/C/D, got {list(options.keys())}"}
            if item.get("correct_answer") not in valid_letters:
                return {"error": f"distractor_error: question {i} correct_answer must be A/B/C/D, got {item.get('correct_answer')}"}
            # Preserve generator-authored metadata that the distractor LLM doesn't return.
            # Without this carry-forward, explanation/objective/tags etc. silently vanish
            # when an item passes through the distractor — leading to "missing why" cards
            # in the UI and mismatched explanations after letter rebalancing.
            src = mcq_questions[i]
            item["question_type"] = src.get("question_type") or "multiple_choice"
            for field in ("explanation", "objective", "tags", "difficulty_band", "score_weight"):
                if src.get(field) is not None:
                    item.setdefault(field, src[field])
            if src.get("extras") is not None:
                item["extras"] = src["extras"]
            finalized[mcq_indices[i]] = item

        return {"questions_with_options": rebalance_correct_letters(finalized, seed=state.get("job_id", "")), "error": None}
    except LLMError as e:
        return {"error": f"distractor_error: {e}"}
