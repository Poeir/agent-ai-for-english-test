"""Verifier agent — independent answer-key validation.

The verifier runs AFTER distractor and BEFORE judge. Unlike judge (which sees the
answer key and scores craft), the verifier independently re-solves each question
without seeing the claimed correct answer, then compares.

Three stages per pipeline run:
  1. Blind solver — k=3 LLM calls at elevated temperature; majority vote per item.
  2. Multi-answer detector — for MCQ items the solver agrees on, check whether any
     non-key option is ALSO defensibly correct (a failure mode judge cannot catch).
  3. Prompt validity — for subjective items (essay/short_answer/speaking_prompt),
     check that the prompt is answerable and gradable. No answer comparison here.

If any item ends in `disagree_strong` or has `multi_answer_risk`, the pipeline
routes directly to revision (skipping judge for that pass).
"""

import asyncio
import json
import os
import re
from collections import Counter

from app.agents.state import PipelineState
from app.config import settings
from app.utils.json_parser import parse_json_with_repair
from app.utils.llm_client import LLMError, complete

SOLVER_TEMPERATURE = 0.9  # higher temp to surface model uncertainty across samples

_LETTER_ANSWER_TYPES = {
    "multiple_choice", "main_idea", "detail", "inference", "vocabulary_in_context",
    "tone_purpose", "rhetorical_purpose", "author_attitude", "implication",
    "analogy_interpretation", "organization_logic",
    "cloze", "error_identification", "photo_description", "question_response",
    "fill_blank",
}
_DETERMINISTIC_TYPES = {"true_false_not_given", "matching", "reordering"}
_SUBJECTIVE_TYPES = {"short_answer", "essay", "speaking_prompt"}

_MCQ_LIKE = _LETTER_ANSWER_TYPES  # items the multi-answer detector applies to

# Question types where near-synonym distractor overlap is the dominant failure mode
# (vocabulary, lexical fill-in). For these we NEVER take the cheap-path skip — the
# blind solver almost always agrees on the "most common synonym" while the test author
# may have legitimately marked a different synonym as correct, and only the multi-answer
# detector exposes that.
_LEXICAL_TYPES = {"vocabulary_in_context", "fill_blank", "cloze"}

_SOLVER_PROMPT: str | None = None
_MULTIANSWER_PROMPT: str | None = None
_PROMPTVALIDITY_PROMPT: str | None = None


def _load_prompt(filename: str) -> str:
    path = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "prompts", filename))
    with open(path, encoding="utf-8") as f:
        return f.read()


def _solver_prompt() -> str:
    global _SOLVER_PROMPT
    if _SOLVER_PROMPT is None:
        _SOLVER_PROMPT = _load_prompt("verifier_solver_system.txt")
    return _SOLVER_PROMPT


def _multianswer_prompt() -> str:
    global _MULTIANSWER_PROMPT
    if _MULTIANSWER_PROMPT is None:
        _MULTIANSWER_PROMPT = _load_prompt("verifier_multianswer_system.txt")
    return _MULTIANSWER_PROMPT


def _promptvalidity_prompt() -> str:
    global _PROMPTVALIDITY_PROMPT
    if _PROMPTVALIDITY_PROMPT is None:
        _PROMPTVALIDITY_PROMPT = _load_prompt("verifier_promptvalidity_system.txt")
    return _PROMPTVALIDITY_PROMPT


def _blind_question(q: dict, idx: int) -> dict:
    """Strip the claimed correct_answer and any answer-revealing extras."""
    blinded = {k: v for k, v in q.items() if k not in {"correct_answer", "explanation"}}
    blinded["question_index"] = idx
    extras = blinded.get("extras")
    if isinstance(extras, dict):
        blinded["extras"] = {
            k: v for k, v in extras.items() if k not in {"correction", "answer", "model_answer"}
        }
    return blinded


def _normalize(value) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).strip()).upper()


def _answers_match(qtype: str, claimed, verifier_ans) -> bool:
    if claimed is None or verifier_ans is None:
        return False
    c = _normalize(claimed)
    v = _normalize(verifier_ans)
    if not c or not v:
        return False
    if c == v:
        return True
    if qtype in {"matching", "reordering"}:
        c2 = re.sub(r"[^A-Z0-9]", "", c)
        v2 = re.sub(r"[^A-Z0-9]", "", v)
        return c2 == v2
    return False


async def _solve_once(passage: str, blinded: list[dict]) -> dict[int, dict]:
    """One blind-solve pass. Returns {question_index: solved_item}."""
    user = (
        f"PASSAGE:\n{passage}\n\n"
        f"QUESTIONS (correct answers withheld — solve each independently):\n"
        f"{json.dumps(blinded, indent=2, ensure_ascii=False)}"
    )
    raw = await complete(
        _solver_prompt(), user, agent="verifier_solver", temperature=SOLVER_TEMPERATURE
    )
    solved = await parse_json_with_repair(
        raw,
        agent="verifier_solver",
        expected='[{"question_index": 0, "answer": "B", "reasoning": "...", "confidence": 0.9, "second_best": null}]',
    )
    if not isinstance(solved, list):
        return {}
    return {s.get("question_index"): s for s in solved if isinstance(s, dict)}


def _aggregate_votes(per_sample: list[dict[int, dict]], questions: list[dict]) -> list[dict]:
    """Combine k samples into one record per question."""
    aggregated = []
    for i, q in enumerate(questions):
        qtype = q.get("question_type") or "multiple_choice"
        claimed = q.get("correct_answer")

        per_sample_items = [s.get(i) for s in per_sample if s.get(i)]
        votes = [item.get("answer") for item in per_sample_items if item.get("answer") is not None]
        confidences = [float(item.get("confidence") or 0.0) for item in per_sample_items]
        reasonings = [item.get("reasoning") or "" for item in per_sample_items]
        second_bests = [item.get("second_best") for item in per_sample_items]

        if not votes:
            aggregated.append({
                "question_index": i,
                "question_type": qtype,
                "claimed_answer": claimed,
                "verifier_votes": [],
                "majority_answer": None,
                "agreement": 0.0,
                "verdict": "uncertain",
                "confidence": 0.0,
                "reasoning": "verifier returned no usable samples",
                "second_best": [b for b in second_bests if b],
                "multi_answer_risk": [],
                "prompt_validity": None,
                "blocking": False,
            })
            continue

        # Normalize then vote
        norm_votes = [_normalize(v) for v in votes]
        counts = Counter(norm_votes)
        top_norm, top_count = counts.most_common(1)[0]
        agreement = top_count / len(votes)
        # Pull the original (non-normalized) form matching top_norm
        majority = next((v for v in votes if _normalize(v) == top_norm), top_norm)

        majority_agrees_with_key = _answers_match(qtype, claimed, majority)

        if majority_agrees_with_key and agreement >= 0.66:
            verdict = "agree"
        elif (not majority_agrees_with_key) and agreement >= 0.66:
            verdict = "disagree_strong"
        else:
            verdict = "uncertain"

        avg_conf = sum(confidences) / max(len(confidences), 1)
        # Pick the reasoning from the strongest-confidence sample that voted majority
        majority_reasoning = ""
        best_conf = -1.0
        for item, c in zip(per_sample_items, confidences):
            if _normalize(item.get("answer")) == top_norm and c > best_conf:
                majority_reasoning = item.get("reasoning") or ""
                best_conf = c
        if not majority_reasoning and reasonings:
            majority_reasoning = reasonings[0]

        aggregated.append({
            "question_index": i,
            "question_type": qtype,
            "claimed_answer": claimed,
            "verifier_votes": votes,
            "majority_answer": majority,
            "agreement": round(agreement, 2),
            "verdict": verdict,
            "confidence": round(avg_conf, 2),
            "reasoning": majority_reasoning,
            "second_best": [b for b in second_bests if b],
            "multi_answer_risk": [],
            "prompt_validity": None,
            "blocking": verdict == "disagree_strong",
        })
    return aggregated


async def _run_blind_solver(passage: str, questions: list[dict]) -> list[dict]:
    """Solve every solvable question k=K_SAMPLES times in parallel; aggregate votes."""
    k_samples = max(1, settings.verifier_k_samples)
    solvable_indices = [
        i for i, q in enumerate(questions)
        if (q.get("question_type") or "multiple_choice") not in _SUBJECTIVE_TYPES
    ]
    blinded = [_blind_question(questions[i], i) for i in solvable_indices]

    if not blinded:
        # All items are subjective — return placeholder records for downstream stages
        return [
            {
                "question_index": i,
                "question_type": q.get("question_type") or "multiple_choice",
                "claimed_answer": q.get("correct_answer"),
                "verifier_votes": [],
                "majority_answer": None,
                "agreement": 0.0,
                "verdict": "subjective",
                "confidence": 0.0,
                "reasoning": "subjective item — skipped blind-solve",
                "second_best": [],
                "multi_answer_risk": [],
                "prompt_validity": None,
                "blocking": False,
            }
            for i, q in enumerate(questions)
        ]

    samples = await asyncio.gather(
        *[_solve_once(passage, blinded) for _ in range(k_samples)],
        return_exceptions=True,
    )
    # Drop any sample that raised — we still aggregate over the remaining ones
    valid_samples: list[dict[int, dict]] = [s for s in samples if isinstance(s, dict)]

    # If every sample failed, surface a single error verdict per item rather than crashing the run
    if not valid_samples:
        first_err = next((s for s in samples if isinstance(s, Exception)), None)
        err_msg = str(first_err) if first_err else "all solver samples returned empty"
        return [
            {
                "question_index": i,
                "question_type": q.get("question_type") or "multiple_choice",
                "claimed_answer": q.get("correct_answer"),
                "verifier_votes": [],
                "majority_answer": None,
                "agreement": 0.0,
                "verdict": "uncertain",
                "confidence": 0.0,
                "reasoning": f"solver failed: {err_msg}",
                "second_best": [],
                "multi_answer_risk": [],
                "prompt_validity": None,
                "blocking": False,
            }
            for i, q in enumerate(questions)
        ]

    aggregated = _aggregate_votes(valid_samples, questions)

    # Mark subjective items explicitly
    for i, q in enumerate(questions):
        qtype = q.get("question_type") or "multiple_choice"
        if qtype in _SUBJECTIVE_TYPES:
            aggregated[i]["verdict"] = "subjective"
            aggregated[i]["reasoning"] = "subjective item — skipped blind-solve"

    return aggregated


async def _run_multi_answer_detector(
    passage: str, questions: list[dict], aggregated: list[dict]
) -> None:
    """Mutates `aggregated` in place: fills `multi_answer_risk` for MCQ items where the
    solver agreed with the key. We only check items the solver agrees on — for items
    the solver disagrees with, the answer-key issue is already a blocker.
    """
    skip_threshold = settings.verifier_multianswer_confidence_skip
    targets = []  # (idx, question_dict_with_key_visible)
    for i, q in enumerate(questions):
        qtype = q.get("question_type") or "multiple_choice"
        if qtype not in _MCQ_LIKE:
            continue
        if aggregated[i]["verdict"] != "agree":
            continue
        # Cheap-path: if every solver sample agreed AND average confidence is high,
        # skip the multi-answer LLM call — this item is clearly unambiguous.
        # EXCEPTION: lexical items (vocab/fill_blank/cloze) bypass the cheap-path
        # because the solver will reliably converge on the "most common synonym"
        # while a co-defensible synonym distractor still lurks in the options.
        if (
            qtype not in _LEXICAL_TYPES
            and aggregated[i].get("agreement", 0) >= 1.0
            and aggregated[i].get("confidence", 0) >= skip_threshold
            and not aggregated[i].get("second_best")
        ):
            continue
        opts = q.get("options") or {}
        if not isinstance(opts, dict) or not all(opts.get(L) for L in ("A", "B", "C", "D")):
            continue
        targets.append((i, {
            "question_index": i,
            "stem": q.get("stem"),
            "options": {L: opts.get(L) for L in ("A", "B", "C", "D")},
            "answer_key": q.get("correct_answer"),
            "question_type": qtype,
        }))

    if not targets:
        return

    user = (
        f"PASSAGE:\n{passage or '(no passage)'}\n\n"
        f"QUESTIONS WITH ANSWER KEYS:\n"
        f"{json.dumps([t[1] for t in targets], indent=2, ensure_ascii=False)}"
    )
    try:
        raw = await complete(_multianswer_prompt(), user, agent="verifier_multianswer")
        results = await parse_json_with_repair(
            raw,
            agent="verifier_multianswer",
            expected='[{"question_index": 0, "co_defensible": ["C"], "reasoning": "..."}]',
        )
    except LLMError:
        return  # multi-answer is advisory; don't fail the pipeline on its error
    if not isinstance(results, list):
        return

    by_idx = {r.get("question_index"): r for r in results if isinstance(r, dict)}
    for idx, _ in targets:
        r = by_idx.get(idx)
        if not r:
            continue
        risk = r.get("co_defensible") or []
        if not isinstance(risk, list):
            continue
        # Only count valid letters that aren't the key itself
        key = aggregated[idx]["claimed_answer"]
        clean = [L for L in risk if L in {"A", "B", "C", "D"} and L != key]
        aggregated[idx]["multi_answer_risk"] = clean
        if clean:
            aggregated[idx]["blocking"] = True
            ma_reason = r.get("reasoning") or ""
            if ma_reason:
                aggregated[idx]["reasoning"] = (
                    f"{aggregated[idx]['reasoning']} | multi-answer: {ma_reason}"
                ).strip(" |")


async def _run_prompt_validity(
    questions: list[dict], aggregated: list[dict]
) -> None:
    """For subjective items: check the prompt is well-formed. Mutates `aggregated`."""
    targets = []
    for i, q in enumerate(questions):
        qtype = q.get("question_type") or "multiple_choice"
        if qtype in _SUBJECTIVE_TYPES:
            targets.append((i, {
                "question_index": i,
                "question_type": qtype,
                "stem": q.get("stem"),
                "extras": q.get("extras"),
            }))

    if not targets:
        return

    user = f"PROMPTS:\n{json.dumps([t[1] for t in targets], indent=2, ensure_ascii=False)}"
    try:
        raw = await complete(_promptvalidity_prompt(), user, agent="verifier_promptvalidity")
        results = await parse_json_with_repair(
            raw,
            agent="verifier_promptvalidity",
            expected='[{"question_index": 0, "valid": true, "issues": [], "suggestions": []}]',
        )
    except LLMError:
        return
    if not isinstance(results, list):
        return

    by_idx = {r.get("question_index"): r for r in results if isinstance(r, dict)}
    for idx, _ in targets:
        r = by_idx.get(idx)
        if not r:
            continue
        valid = bool(r.get("valid"))
        issues = r.get("issues") or []
        suggestions = r.get("suggestions") or []
        aggregated[idx]["prompt_validity"] = {
            "valid": valid,
            "issues": issues if isinstance(issues, list) else [],
            "suggestions": suggestions if isinstance(suggestions, list) else [],
        }
        if not valid:
            aggregated[idx]["blocking"] = True


async def verifier_node(state: PipelineState) -> dict:
    if state.get("error"):
        return {}

    questions = state.get("questions_with_options") or state.get("raw_questions") or []
    if not questions:
        return {"verifier_results": [], "verifier_disagreed": False, "error": None}

    passage = state.get("passage") or ""

    try:
        aggregated = await _run_blind_solver(passage, questions)
        await _run_multi_answer_detector(passage, questions, aggregated)
        await _run_prompt_validity(questions, aggregated)
    except LLMError as e:
        return {"error": f"verifier_error: {e}"}

    disagreed = any(r.get("blocking") for r in aggregated)

    # Mirror judge's pattern: pre-increment revision_count when we will route back to
    # generator, and expose a separate routing flag so the post-update routing function
    # reads a stable signal (revision_count is already bumped by the time it runs).
    revision_count = state.get("revision_count", 0)
    will_revise = disagreed and revision_count < settings.max_revision_loops
    next_revision_count = revision_count + 1 if will_revise else revision_count

    # When blockers remain after the revision budget is spent, do NOT fail the
    # pipeline. Items are persisted anyway with status="flagged" and the verifier
    # feedback attached (see generation_service._save_results), so the operator
    # can review exactly which questions have answer-key/ambiguity problems.

    return {
        "verifier_results": aggregated,
        "verifier_disagreed": disagreed,
        "verifier_should_revise": will_revise,
        "revision_count": next_revision_count,
        "error": None,
    }
