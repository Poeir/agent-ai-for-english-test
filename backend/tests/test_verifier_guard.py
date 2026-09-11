import pytest

from app.agents import verifier_agent
from app.services.generation_service import _save_results


async def _no_op(*_args, **_kwargs):
    return None


@pytest.mark.asyncio
async def test_verifier_does_not_fail_pipeline_when_budget_is_spent(monkeypatch):
    # Blockers remaining after the revision budget must NOT error the pipeline:
    # items are persisted with status="flagged" (see generation_service._save_results)
    # so the operator can review them instead of losing the whole section.
    async def blocked_result(*_args, **_kwargs):
        return [{"blocking": True}]

    monkeypatch.setattr(verifier_agent, "_run_blind_solver", blocked_result)
    monkeypatch.setattr(verifier_agent, "_run_multi_answer_detector", _no_op)
    monkeypatch.setattr(verifier_agent, "_run_prompt_validity", _no_op)
    monkeypatch.setattr(verifier_agent.settings, "max_revision_loops", 1)

    result = await verifier_agent.verifier_node(
        {
            "questions_with_options": [{"stem": "Question"}],
            "passage": "",
            "revision_count": 1,
            "error": None,
        }
    )

    assert result["verifier_disagreed"] is True
    assert result["verifier_should_revise"] is False
    assert result["revision_count"] == 1
    assert result["error"] is None


@pytest.mark.asyncio
async def test_verifier_routes_to_revision_while_budget_remains(monkeypatch):
    async def blocked_result(*_args, **_kwargs):
        return [{"blocking": True}]

    monkeypatch.setattr(verifier_agent, "_run_blind_solver", blocked_result)
    monkeypatch.setattr(verifier_agent, "_run_multi_answer_detector", _no_op)
    monkeypatch.setattr(verifier_agent, "_run_prompt_validity", _no_op)
    monkeypatch.setattr(verifier_agent.settings, "max_revision_loops", 1)

    result = await verifier_agent.verifier_node(
        {
            "questions_with_options": [{"stem": "Question"}],
            "passage": "",
            "revision_count": 0,
            "error": None,
        }
    )

    assert result["verifier_should_revise"] is True
    assert result["revision_count"] == 1
    assert result["error"] is None


@pytest.mark.asyncio
async def test_save_results_rejects_under_produced_sections():
    # Item-count integrity guard: silent under-production must fail loudly
    # before anything is persisted (raises before the DB session opens).
    with pytest.raises(ValueError, match="Refusing to persist"):
        await _save_results(
            {
                "blueprint": {"item_count": 5, "cefr": "B1", "topic": "t", "skill": "reading"},
                "questions_with_options": [{"stem": "only one"}],
            }
        )
