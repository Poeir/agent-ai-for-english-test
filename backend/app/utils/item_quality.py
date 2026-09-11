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


# Patterns that reference an option letter inside explanation prose.
# Each must capture exactly one letter group so we can apply a per-letter remap.
# We deliberately match conservative contexts to avoid mangling the standalone
# article "A" or unrelated capital letters.
_LETTER_REF_PATTERNS = [
    re.compile(r"\b(Option|option|Choice|choice|Answer|answer)\s+([A-D])\b"),
    re.compile(r"\b([A-D])\s+is\s+(?:the\s+)?(?:correct|right|best|wrong|incorrect)", re.IGNORECASE),
    re.compile(r"\b(?:answer|choice|option)\s+is\s+([A-D])\b", re.IGNORECASE),
    re.compile(r"\(([A-D])\)"),
    re.compile(r"\b([A-D])\)"),
]


# Phrases that UNAMBIGUOUSLY assert "this letter is the correct answer".
# These are the ONLY contexts where it is safe to rewrite "Option X" → "the correct option".
#
# Plain verbs like "is", "captures", "answers", "states" used to be on this list but
# were too loose — they matched distractor descriptions too (e.g. "Option C is a correct
# detail instead of the main purpose" was getting rewritten to "the correct option is
# correct detail…", reversing the meaning).
#
# New rule: require the verb PLUS an adjective/object that explicitly signals correctness.
_POSITIVE_CORRECTNESS_PATTERNS = (
    r"is\s+correct\b",
    r"is\s+right\b",
    r"is\s+the\s+(?:correct|right|best|only)\s+(?:answer|choice|option)\b",
    r"is\s+the\s+answer\b",
    r"is\s+supported\s+by\s+(?:the\s+passage|paragraph|line|the\s+text)",
    r"correctly\s+(?:captures|states|describes|paraphrases|reflects|summari[sz]es|matches|identifies|answers|conveys)\b",
    r"accurately\s+(?:captures|states|describes|paraphrases|reflects|summari[sz]es|matches|identifies|answers|conveys)\b",
    r"best\s+(?:captures|describes|answers|fits|reflects|paraphrases)\b",
)
_POSITIVE_CORRECTNESS_LOOKAHEAD = "(?:" + "|".join(_POSITIVE_CORRECTNESS_PATTERNS) + ")"


def neutralize_letter_references(text: str | None, correct_letter: str | None = None) -> str | None:
    """Strip option-letter labels from explanation prose so they cannot go stale.

    The generator prompt forbids letter references in the explanation field, but the
    model occasionally still emits "Option B is correct" / "Only C captures…" patterns.
    After options get shuffled (rebalance_correct_letters, or any downstream re-order),
    those letter labels point at the wrong option and quietly mislead the candidate.

    This function rewrites ONLY assertions of correctness — descriptions of distractors
    ("Option D contradicts the passage") are LEFT ALONE because reversing their
    semantics is worse than the stale-label risk: a distractor description with the
    "wrong" letter is still semantically right because the verb itself identifies it
    as a distractor.

    `correct_letter` is reserved for a future smart-mode check; currently only the
    positive-verb context decides whether a replacement happens.
    """
    if not text or not isinstance(text, str):
        return text

    out = text

    # 1. "Option/Choice/Answer X [positive verb]" → "the correct option/choice/answer [verb]"
    #    Only fires when a positive-correctness verb follows, so distractor descriptions
    #    like "Option D contradicts the passage" are not touched.
    def _opt_replace(m: re.Match) -> str:
        label = m.group(1)
        at_start = m.start() == 0 or out[m.start() - 1] in ".!?\n"
        prefix = "The correct " if at_start else "the correct "
        return prefix + label.lower()

    out = re.sub(
        rf"\b(Option|Choice|Answer)\s+[A-D](?=\s+{_POSITIVE_CORRECTNESS_LOOKAHEAD})",
        _opt_replace,
        out,
    )

    # 2. "Only X [positive verb]" → "Only the correct option [verb]"
    out = re.sub(
        rf"\bOnly\s+[A-D](?=\s+{_POSITIVE_CORRECTNESS_LOOKAHEAD})",
        "Only the correct option",
        out,
        flags=re.IGNORECASE,
    )

    # 3. "[The] correct answer/choice/option is X" → keep "is" + tautological "correct"
    #    rather than dropping "is X" entirely (which leaves a broken "answer because…").
    out = re.sub(
        r"\b((?:The\s+)?(?:correct|right|best)\s+(?:answer|choice|option))\s+is\s+[A-D](?=[\s.,;:!?]|$)",
        r"\1 is correct",
        out,
        flags=re.IGNORECASE,
    )

    # 4. Standalone "X is correct/right/best/the answer" → "It is correct/…"
    out = re.sub(
        r"(?<![A-Za-z])([A-D])\s+(is\s+(?:the\s+)?(?:correct|right|best|the\s+answer))",
        r"It \2",
        out,
    )

    # 5a. "is (B)" / "is ( B )" — upgrade to "is correct" before stripping bare parens,
    #     otherwise we leave a dangling "The correct option is." sentence.
    out = re.sub(r"\bis\s*\(\s*[A-D]\s*\)", "is correct", out, flags=re.IGNORECASE)

    # 5b. Bare parenthesised letter labels "(B)" / "( C )" — strip
    out = re.sub(r"\s*\(\s*[A-D]\s*\)", "", out)

    # 6. Bare "B)" / "C." at sentence-leading position — drop the label, keep the rest
    out = re.sub(r"(^|[.,;]\s+)([A-D])\)\s+", r"\1", out)

    # 7. Cleanup whitespace and stray spaces before punctuation
    out = re.sub(r"\s+([.,;:!?])", r"\1", out)
    out = re.sub(r"\s{2,}", " ", out).strip()
    return out


def _remap_letters_in_text(text: str, mapping: dict[str, str]) -> str:
    """Apply a per-letter remap to common option-reference patterns in prose.

    We do TWO passes via a temporary marker so an A↔B swap doesn't ping-pong
    (turning A→B then B→A on the same character).
    """
    if not text or not mapping or all(k == v for k, v in mapping.items()):
        return text

    def _sub_with_marker(match: re.Match) -> str:
        # Find the letter capture group (groups vary across patterns)
        whole = match.group(0)
        for group_idx in range(1, (match.lastindex or 0) + 1):
            g = match.group(group_idx)
            if g and len(g) == 1 and g.upper() in mapping:
                target = mapping[g.upper()]
                # Preserve case of the original letter
                target_cased = target if g.isupper() else target.lower()
                # Use a marker that can't collide with another letter pass
                marker = f"\x00{target_cased}\x00"
                start = match.start(group_idx) - match.start()
                end = match.end(group_idx) - match.start()
                return whole[:start] + marker + whole[end:]
        return whole

    out = text
    for pattern in _LETTER_REF_PATTERNS:
        out = pattern.sub(_sub_with_marker, out)
    # Strip markers
    out = re.sub(r"\x00([A-Da-d])\x00", r"\1", out)
    return out


def rebalance_correct_letters(questions: list[dict], *, seed: str = "") -> list[dict]:
    """Relabel A/B/C/D options so correct answers are distributed across letters.

    This preserves option text and correctness while avoiding repeated B/D-heavy
    answer patterns that strong test-takers can notice. Letter references inside
    the explanation/objective text are also remapped so they don't go stale after
    the swap (e.g. "Option A is correct…" becoming wrong after correct moves to B).
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
            # Swap letter references in any prose fields the generator may have written
            mapping = {correct: desired, desired: correct}
            for field in ("explanation", "objective"):
                if isinstance(q.get(field), str) and q[field]:
                    q[field] = _remap_letters_in_text(q[field], mapping)
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

    # Explanation–answer consistency: catch residual cases where the explanation prose
    # asserts a letter different from correct_answer. neutralize_letter_references() at
    # save time strips most letter labels defensively; this lint runs on the pre-save
    # text and flags mismatches so judge knows to fail the item (forcing a revision).
    explanation = q.get("explanation")
    if isinstance(explanation, str) and explanation:
        claimed_letters = set()
        for pattern in (
            # "Option B is correct" / "Choice C is the right answer"
            re.compile(r"\b(?:Option|Choice|Answer)\s+([A-D])\s+(?:is|correctly|accurately|captures|states|matches|paraphrases|describes|reflects|summari[sz]es|implies|fits|works|answers)", re.IGNORECASE),
            # "The correct answer is B"
            re.compile(r"\b(?:correct|right|best)\s+(?:answer|choice|option)\s+is\s+([A-D])\b", re.IGNORECASE),
            # "B is correct/the right answer"
            re.compile(r"\b([A-D])\s+is\s+(?:the\s+)?(?:correct|right|best)(?:\s+(?:answer|choice|option))?", re.IGNORECASE),
            # "Only B captures…" — the user's feedback flagged this exact pattern
            re.compile(r"\bOnly\s+([A-D])\s+(?:captures|states|accurately|correctly|matches|paraphrases|describes|reflects|summari[sz]es|implies|fits|works|answers)", re.IGNORECASE),
            # "(B)" parenthesised label
            re.compile(r"\(\s*([A-D])\s*\)"),
        ):
            for match in pattern.finditer(explanation):
                claimed_letters.add(match.group(1).upper())
        if claimed_letters and correct_letter not in claimed_letters:
            wrong = ", ".join(sorted(claimed_letters))
            issues.append(f"Explanation claims option {wrong} is correct, but correct_answer is {correct_letter}.")
            suggestions.append("Rewrite the explanation to describe the correct answer by its CONTENT (paraphrase + cite passage evidence). Do NOT reference options by letter — letter labels go stale when options are shuffled.")

    return issues, suggestions


def _normalize_stem(text: str | None) -> str:
    """Aggressive normalization for duplicate detection — lowercase, strip punctuation,
    collapse whitespace. Two stems that differ only in punctuation/case are considered
    the same question."""
    if not text:
        return ""
    s = re.sub(r"[^\w\s]", " ", str(text).lower())
    return re.sub(r"\s+", " ", s).strip()


def _duplicate_issues(questions: list[dict]) -> dict[int, str]:
    """Return {question_index: issue_message} for items whose stem is a duplicate of
    an earlier item's stem. We flag the LATER occurrence so revision rewrites that one,
    leaving the first occurrence intact."""
    out: dict[int, str] = {}
    seen: dict[str, int] = {}
    for idx, q in enumerate(questions):
        stem = _normalize_stem(q.get("stem"))
        if not stem:
            continue
        if stem in seen:
            first_idx = seen[stem]
            out[idx] = f"Stem is an exact duplicate of question {first_idx + 1}. Rewrite this item with a different scenario/wording."
        else:
            seen[stem] = idx
    return out


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
    duplicate_issues = _duplicate_issues(questions)
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
        if idx in duplicate_issues:
            issues.append(duplicate_issues[idx])
            suggestions.append("Generate a different question on a different aspect of the topic. Do not repeat stems verbatim across items in the same section.")

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
