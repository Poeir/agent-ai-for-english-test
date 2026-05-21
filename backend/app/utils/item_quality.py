import re
from collections import Counter
from statistics import median
from typing import Any


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

LETTERS = ("A", "B", "C", "D")
ABSOLUTE_WORDS = {"only", "completely", "entirely", "immediately", "never", "always"}
EXTREME_CUE_WORDS = {
    "tallest",
    "shortest",
    "biggest",
    "smallest",
    "maximum",
    "minimum",
    "perfect",
    "impossible",
    "guaranteed",
}
STOPWORDS = {
    "about", "after", "again", "against", "because", "before", "being", "between",
    "could", "every", "from", "have", "into", "more", "most", "only", "other",
    "should", "some", "such", "than", "that", "their", "them", "then", "there",
    "these", "they", "this", "those", "through", "under", "when", "where", "which",
    "while", "with", "would",
}


def _words(text: str | None) -> list[str]:
    return re.findall(r"[A-Za-z][A-Za-z'-]*", (text or "").lower())


def _content_words(text: str | None) -> set[str]:
    return {w for w in _words(text) if len(w) > 3 and w not in STOPWORDS}


def _has_full_mcq_options(q: dict) -> bool:
    options = q.get("options") or {}
    return (
        isinstance(options, dict)
        and all(letter in options and str(options.get(letter) or "").strip() for letter in LETTERS)
        and q.get("correct_answer") in LETTERS
    )


def rebalance_correct_letters(questions: list[dict], *, seed: str = "") -> list[dict]:
    """Relabel A/B/C/D options so correct answers are distributed across letters.

    This preserves option text and correctness while avoiding repeated B/D-heavy
    answer patterns that strong test-takers can notice.
    """
    target_sequences = [
        ("A", "C", "B", "D"),
        ("B", "D", "A", "C"),
        ("C", "A", "D", "B"),
        ("D", "B", "C", "A"),
    ]
    offset = sum(ord(ch) for ch in seed) % len(target_sequences) if seed else 0
    targets = target_sequences[offset]

    out: list[dict] = []
    mcq_index = 0
    for question in questions:
        q = dict(question)
        if not _has_full_mcq_options(q) or (q.get("question_type") or "multiple_choice") not in MCQ_TYPES:
            out.append(q)
            continue

        correct = q["correct_answer"]
        desired = targets[mcq_index % len(targets)]
        mcq_index += 1
        if correct != desired:
            options = dict(q["options"])
            options[correct], options[desired] = options[desired], options[correct]
            q["options"] = options
            q["correct_answer"] = desired
        out.append(q)
    return out


def _lint_question(passage: str, q: dict) -> tuple[list[str], list[str]]:
    if not _has_full_mcq_options(q) or (q.get("question_type") or "multiple_choice") not in MCQ_TYPES:
        return [], []

    options: dict[str, Any] = q["options"]
    correct_letter = q["correct_answer"]
    correct_text = str(options.get(correct_letter) or "")
    distractors = {letter: str(text or "") for letter, text in options.items() if letter != correct_letter}
    issues: list[str] = []
    suggestions: list[str] = []

    option_lengths = {letter: max(1, len(_words(str(text)))) for letter, text in options.items()}
    med = median(option_lengths.values())
    for letter, count in option_lengths.items():
        if count > med * 1.75 or count < med * 0.45:
            issues.append(f"Option {letter} has a length imbalance ({count} words vs median {med:g}).")
            suggestions.append("Rewrite choices so all four options have comparable length and specificity.")
            break

    for letter, text in distractors.items():
        words = set(_words(text))
        absolute_hits = sorted(words & ABSOLUTE_WORDS)
        if absolute_hits:
            issues.append(f"Distractor {letter} uses absolute wording ({', '.join(absolute_hits)}), making it testwise-suspicious.")
            suggestions.append(f"Rewrite distractor {letter} as a nuanced partial-truth option without unnecessary absolute wording.")

        extreme_hits = sorted(words & EXTREME_CUE_WORDS)
        if extreme_hits:
            issues.append(f"Distractor {letter} uses extreme cue wording ({', '.join(extreme_hits)}) and may be too easy to eliminate.")
            suggestions.append(f"Replace distractor {letter} with a technically plausible but incomplete or scope-shifted reading.")

    if len(_words(correct_text)) >= 5 and correct_text.lower() in (passage or "").lower():
        issues.append("Correct answer copies a long exact phrase from the passage.")
        suggestions.append("Paraphrase the correct answer while preserving the same meaning.")

    source_terms = _content_words(passage) | _content_words(q.get("stem"))
    for letter, text in distractors.items():
        content = _content_words(text)
        if len(content) >= 3 and not (content & source_terms):
            issues.append(f"Distractor {letter} has weak lexical overlap with the passage/stem and may feel invented.")
            suggestions.append(f"Anchor distractor {letter} in a real passage detail, using scope shift, incomplete explanation, or causal confusion.")

    return issues, suggestions


def _letter_balance_issues(questions: list[dict]) -> list[str]:
    letters = [
        q.get("correct_answer")
        for q in questions
        if _has_full_mcq_options(q) and (q.get("question_type") or "multiple_choice") in MCQ_TYPES
    ]
    if len(letters) < 4:
        return []
    counts = Counter(letters)
    letter, count = counts.most_common(1)[0]
    if count / len(letters) >= 0.6:
        return [f"Correct answers are clustered on {letter} ({count}/{len(letters)} MCQ items)."]
    return []


def apply_local_quality_lint(passage: str, questions: list[dict], judge_results: list[dict]) -> list[dict]:
    balance_issues = _letter_balance_issues(questions)
    by_index = {
        int(result.get("question_index", idx)): dict(result)
        for idx, result in enumerate(judge_results or [])
        if isinstance(result, dict)
    }

    out: list[dict] = []
    for idx, question in enumerate(questions):
        result = by_index.get(idx, {"question_index": idx})
        issues, suggestions = _lint_question(passage, question)
        if idx == 0 and balance_issues:
            issues.extend(balance_issues)
            suggestions.append("Rebalance correct-answer positions across A/B/C/D before finalizing the set.")

        if issues:
            existing_issues = list(result.get("issues") or [])
            existing_suggestions = list(result.get("revision_suggestions") or [])
            result["issues"] = existing_issues + [f"Local anti-pattern check: {issue}" for issue in issues]
            result["revision_suggestions"] = existing_suggestions + suggestions
            result["distractor_quality"] = min(float(result.get("distractor_quality", 6.0)), 6.5)
            result["ambiguity_risk"] = "medium" if result.get("ambiguity_risk") == "low" else result.get("ambiguity_risk", "medium")
            result["overall_score"] = min(float(result.get("overall_score", 6.0)), 6.8)
            result["pass"] = False

        out.append(result)

    return out or judge_results
