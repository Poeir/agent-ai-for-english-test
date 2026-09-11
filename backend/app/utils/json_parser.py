import json
import re
from typing import Any

from app.config import settings
from app.utils.llm_client import LLMError, complete


def strip_json_fences(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```json"):
        text = text.removeprefix("```json")
    elif text.startswith("```"):
        text = text.removeprefix("```")
    if text.endswith("```"):
        text = text.removesuffix("```")
    return text.strip()


def _extract_json_candidate(raw: str) -> str:
    text = strip_json_fences(raw)
    starts = [idx for idx in (text.find("{"), text.find("[")) if idx >= 0]
    if not starts:
        return text
    start = min(starts)

    end_obj = text.rfind("}")
    end_arr = text.rfind("]")
    end = max(end_obj, end_arr)
    if end <= start:
        return text
    return text[start:end + 1].strip()


def _escape_control_chars_in_strings(text: str) -> str:
    out: list[str] = []
    in_string = False
    escaped = False

    for ch in text:
        if in_string:
            if escaped:
                out.append(ch)
                escaped = False
                continue
            if ch == "\\":
                out.append(ch)
                escaped = True
                continue
            if ch == '"':
                out.append(ch)
                in_string = False
                continue
            if ch == "\n":
                out.append("\\n")
                continue
            if ch == "\r":
                out.append("\\r")
                continue
            if ch == "\t":
                out.append("\\t")
                continue
            out.append(ch)
            continue

        out.append(ch)
        if ch == '"':
            in_string = True

    return "".join(out)


def _apply_outside_strings(text: str, fn) -> str:
    out: list[str] = []
    chunk: list[str] = []
    in_string = False
    escaped = False

    for ch in text:
        if in_string:
            out.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            if chunk:
                out.append(fn("".join(chunk)))
                chunk = []
            out.append(ch)
            in_string = True
        else:
            chunk.append(ch)

    if chunk:
        out.append(fn("".join(chunk)))
    return "".join(out)


# A number literal followed by characters that can never appear in valid JSON
# outside a string (e.g. stray CJK tokens the LLM sampled mid-number: `8.下场`).
# The garbage class excludes JSON structural chars and quotes so we stop at the
# next delimiter. The number is an atomic group `(?>...)` so the regex cannot
# backtrack into a valid fraction/exponent and misread `8.5` as `8` + `.5`.
_NUMBER_GARBAGE_RE = re.compile(
    r"(?P<num>(?>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?))[^\s,:{}\[\]\"]+"
)


def _strip_number_garbage(chunk: str) -> str:
    return _NUMBER_GARBAGE_RE.sub(lambda m: m.group("num"), chunk)


_PYTHON_LITERAL_MAP = {"True": "true", "False": "false", "None": "null"}


def _replace_python_literals(chunk: str) -> str:
    return re.sub(
        r"\b(True|False|None)\b",
        lambda m: _PYTHON_LITERAL_MAP[m.group(1)],
        chunk,
    )


def _repair_json_locally(text: str) -> str:
    repaired = _extract_json_candidate(text)
    repaired = _escape_control_chars_in_strings(repaired)
    repaired = _apply_outside_strings(
        repaired,
        lambda chunk: re.sub(r",\s*([}\]])", r"\1", chunk),
    )
    repaired = _apply_outside_strings(repaired, _strip_number_garbage)
    repaired = _apply_outside_strings(
        repaired,
        lambda chunk: re.sub(
            r'(?P<prefix>[{,]\s*)(?P<key>[A-Za-z_][A-Za-z0-9_]*)\s*:',
            r'\g<prefix>"\g<key>":',
            chunk,
        ),
    )
    repaired = _apply_outside_strings(repaired, _replace_python_literals)
    return repaired


def parse_json(raw: str) -> Any:
    candidate = _extract_json_candidate(raw)
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return json.loads(_repair_json_locally(candidate))


def parse_json_no_llm_repair(raw: str) -> Any:
    return parse_json(raw)


def _error_snippet(raw: str, err: json.JSONDecodeError, radius: int = 40) -> str:
    candidate = _extract_json_candidate(raw)
    pos = getattr(err, "pos", None)
    if pos is None or pos < 0 or pos > len(candidate):
        pos = 0
    start = max(0, pos - radius)
    end = min(len(candidate), pos + radius)
    return repr(candidate[start:end])


async def parse_json_with_repair(
    raw: str,
    *,
    agent: str,
    expected: str,
) -> Any:
    """Parse LLM JSON output, asking the LLM to repair malformed JSON once.

    Long generated passages increase the chance of invalid JSON because one
    unescaped quote or JSON-like key breaks the whole response. The repair call
    preserves content while converting the model output back to strict JSON.
    """
    try:
        return parse_json_no_llm_repair(raw)
    except json.JSONDecodeError as original_error:
        if not settings.llm_json_repair_enabled:
            snippet = _error_snippet(raw, original_error)
            raise LLMError(
                f"invalid JSON after local repair: {original_error} | near: {snippet}"
            ) from original_error

        repair_system = (
            "You repair malformed JSON from an LLM. Return ONLY strict valid JSON. "
            "Do not add markdown, comments, explanations, or new content. "
            "Preserve all original values and structure as much as possible. "
            "All property names and string values must use double quotes."
        )
        repair_user = (
            f"Expected JSON shape: {expected}\n\n"
            f"Parser error: {original_error}\n\n"
            "Malformed JSON to repair:\n"
            f"{raw}"
        )
        repaired = await complete(repair_system, repair_user, agent=f"{agent}_json_repair")
        try:
            return parse_json(repaired)
        except json.JSONDecodeError as repair_error:
            raise LLMError(
                f"invalid JSON after repair: original={original_error}; repair={repair_error}"
            ) from repair_error
