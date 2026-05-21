import json
import os

from sqlalchemy import select

from app.agents.state import PipelineState
from app.database import AsyncSessionLocal
from app.models.example import ExampleItem
from app.utils.llm_client import LLMError, complete
from app.utils.json_parser import parse_json_with_repair

_SYSTEM_PROMPT: str | None = None
MAX_EXAMPLES = 3


def _load_system_prompt() -> str:
    global _SYSTEM_PROMPT
    if _SYSTEM_PROMPT is None:
        prompt_path = os.path.join(os.path.dirname(__file__), "..", "prompts", "generator_system.txt")
        with open(os.path.normpath(prompt_path), encoding="utf-8") as f:
            _SYSTEM_PROMPT = f.read()
    return _SYSTEM_PROMPT


async def _fetch_examples(skill: str, cefr: str, question_types: list[str]) -> list[ExampleItem]:
    """Pull up to MAX_EXAMPLES curated examples matching the blueprint."""
    async with AsyncSessionLocal() as session:
        # Prefer examples matching skill+cefr+question_type, then fall back to skill+cefr only
        stmt = (
            select(ExampleItem)
            .where(ExampleItem.skill == skill)
            .where(ExampleItem.cefr_level == cefr)
        )
        if question_types:
            stmt = stmt.where(ExampleItem.question_type.in_(question_types))

        result = await session.execute(stmt.limit(MAX_EXAMPLES))
        examples = list(result.scalars().all())

        if len(examples) < MAX_EXAMPLES:
            fallback_stmt = (
                select(ExampleItem)
                .where(ExampleItem.skill == skill)
                .where(ExampleItem.cefr_level == cefr)
                .limit(MAX_EXAMPLES - len(examples))
            )
            existing_ids = {e.id for e in examples}
            fb_result = await session.execute(fallback_stmt)
            examples.extend(e for e in fb_result.scalars().all() if e.id not in existing_ids)

        return examples


def _format_examples(examples: list[ExampleItem]) -> str:
    if not examples:
        return ""
    blocks = []
    for i, e in enumerate(examples, 1):
        block = f"--- Example {i} ({e.cefr_level} {e.skill}"
        if e.question_type:
            block += f", {e.question_type}"
        block += ") ---\n"
        if e.passage:
            block += f"PASSAGE:\n{e.passage}\n\n"
        block += f"STEM: {e.stem}\n"
        if e.options:
            block += f"OPTIONS: {json.dumps(e.options, ensure_ascii=False)}\n"
        if e.correct_answer:
            block += f"CORRECT ANSWER: {e.correct_answer}\n"
        if e.notes:
            block += f"NOTES: {e.notes}\n"
        blocks.append(block)
    return (
        "Below are reference examples of high-quality questions at this CEFR level. "
        "Match their style, difficulty, phrasing conventions, and question framing. "
        "Do NOT copy content — only emulate the style and rigor.\n\n"
        + "\n".join(blocks)
        + "\n"
    )


def _format_revision_feedback(state: PipelineState) -> str:
    """When this is a revision pass, inline the judge's previous critique so the LLM addresses it."""
    if state.get("revision_count", 0) <= 0:
        return ""
    judge_results = state.get("judge_results") or []
    if not judge_results:
        return ""

    passed = state.get("judge_passed", False)
    verdict = "passed" if passed else "failed"
    header = (
        "## REVISION FEEDBACK (refine using judge feedback below)"
        if passed
        else "## REVISION FEEDBACK (previous attempt FAILED — fix every issue below)"
    )

    lines = [
        header,
        f"Previous overall verdict: {verdict} (revision attempt #{state.get('revision_count', 0)}).",
        "",
    ]
    for r in judge_results:
        idx = r.get("question_index")
        score = r.get("overall_score")
        issues = r.get("issues") or []
        suggestions = r.get("revision_suggestions") or []
        lines.append(f"- Question {idx} (score {score}):")
        for issue in issues:
            lines.append(f"    ISSUE: {issue}")
        for s in suggestions:
            lines.append(f"    FIX:   {s}")
    lines.append("")
    if passed:
        lines.append("All questions already meet the threshold, but apply every FIX above to further polish quality. Keep what already works.")
    else:
        lines.append("Rewrite the passage and questions to specifically address every ISSUE above. Do NOT repeat the same mistakes.")
    lines.append("")
    return "\n".join(lines) + "\n"


async def generator_node(state: PipelineState) -> dict:
    if state.get("error"):
        return {}

    blueprint = state["blueprint"]
    system = _load_system_prompt()

    examples = await _fetch_examples(
        skill=blueprint["skill"],
        cefr=blueprint["cefr"],
        question_types=blueprint.get("question_types", []),
    )
    examples_block = _format_examples(examples)
    revision_block = _format_revision_feedback(state)

    user = (
        f"{revision_block}"
        f"{examples_block}"
        f"Generate a passage and {blueprint['item_count']} question stems based on this blueprint:\n\n"
        f"{json.dumps(blueprint, indent=2)}"
    )

    try:
        raw = await complete(system, user, agent="generator")
        data = await parse_json_with_repair(
            raw,
            agent="generator",
            expected='{"passage": "...", "questions": [{"question_type": "...", "stem": "...", "options": null, "correct_answer": "...", "extras": null, "difficulty_band": "...", "score_weight": 1, "objective": "...", "explanation": "...", "tags": []}]}',
        )
        return {
            "passage": data.get("passage", ""),
            "raw_questions": data.get("questions", []),
            "error": None,
        }
    except LLMError as e:
        return {"error": f"generator_error: {e}"}
