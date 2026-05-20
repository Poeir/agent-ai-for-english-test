import json
import os
import re

from app.agents.state import PipelineState
from app.utils.llm_client import LLMError, complete

_SYSTEM_PROMPT: str | None = None

# Question types the verifier should not gate on — answers are inherently subjective.
_SUBJECTIVE_TYPES = {"essay", "short_answer", "speaking_prompt"}


def _load_system_prompt() -> str:
    global _SYSTEM_PROMPT
    if _SYSTEM_PROMPT is None:
        prompt_path = os.path.join(os.path.dirname(__file__), "..", "prompts", "verifier_system.txt")
        with open(os.path.normpath(prompt_path), encoding="utf-8") as f:
            _SYSTEM_PROMPT = f.read()
    return _SYSTEM_PROMPT


def _blind_question(q: dict, idx: int) -> dict:
    """Strip the claimed correct_answer (and any answer-revealing extras) before the verifier sees it."""
    blinded = {k: v for k, v in q.items() if k not in {"correct_answer", "explanation"}}
    blinded["question_index"] = idx
    extras = blinded.get("extras")
    if isinstance(extras, dict):
        blinded["extras"] = {k: v for k, v in extras.items() if k not in {"correction", "answer", "model_answer"}}
    return blinded


def _normalize(value) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).strip()).upper()


def _answers_match(qtype: str, claimed, verifier_ans) -> bool:
    """Deterministic comparison of the claimed answer-key vs the verifier's independent answer."""
    if claimed is None or verifier_ans is None:
        return False
    c = _normalize(claimed)
    v = _normalize(verifier_ans)
    if not c or not v:
        return False
    if c == v:
        return True
    # For matching / reordering, accept "1-B, 2-A" == "1-B,2-A" (already normalized whitespace).
    # Strip non-alphanumeric for a forgiving compare on these.
    if qtype in {"matching", "reordering"}:
        c2 = re.sub(r"[^A-Z0-9]", "", c)
        v2 = re.sub(r"[^A-Z0-9]", "", v)
        return c2 == v2
    return False


async def verifier_node(state: PipelineState) -> dict:
    if state.get("error"):
        return {}

    questions = state.get("questions_with_options") or state.get("raw_questions") or []
    if not questions:
        return {"verifier_results": [], "error": None}

    blinded = [_blind_question(q, i) for i, q in enumerate(questions)]

    system = _load_system_prompt()
    passage = state.get("passage") or "(no passage)"
    user = (
        f"PASSAGE:\n{passage}\n\n"
        f"QUESTIONS (correct answers withheld — solve each independently):\n"
        f"{json.dumps(blinded, indent=2, ensure_ascii=False)}"
    )

    try:
        raw = await complete(system, user, agent="verifier")
        raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        solved = json.loads(raw)
        if not isinstance(solved, list):
            return {"error": f"verifier_error: expected JSON array, got {type(solved).__name__}"}

        by_idx = {s.get("question_index"): s for s in solved if isinstance(s, dict)}
        results = []
        for i, q in enumerate(questions):
            qtype = q.get("question_type") or "multiple_choice"
            claimed = q.get("correct_answer")
            solved_item = by_idx.get(i)

            if solved_item is None:
                results.append({
                    "question_index": i,
                    "claimed_answer": claimed,
                    "verifier_answer": None,
                    "agrees": False,
                    "skipped": True,
                    "reasoning": "verifier did not return a result for this question",
                    "confidence": 0.0,
                })
                continue

            verifier_ans = solved_item.get("answer")
            reasoning = solved_item.get("reasoning") or ""
            confidence = float(solved_item.get("confidence") or 0.0)

            if qtype in _SUBJECTIVE_TYPES:
                # Don't block subjective items — record for human review but treat as agreeing.
                results.append({
                    "question_index": i,
                    "claimed_answer": claimed,
                    "verifier_answer": verifier_ans,
                    "agrees": True,
                    "skipped": True,
                    "reasoning": reasoning,
                    "confidence": confidence,
                })
                continue

            agrees = _answers_match(qtype, claimed, verifier_ans)
            results.append({
                "question_index": i,
                "claimed_answer": claimed,
                "verifier_answer": verifier_ans,
                "agrees": agrees,
                "skipped": False,
                "reasoning": reasoning,
                "confidence": confidence,
            })

        return {"verifier_results": results, "error": None}
    except (LLMError, json.JSONDecodeError) as e:
        return {"error": f"verifier_error: {e}"}
