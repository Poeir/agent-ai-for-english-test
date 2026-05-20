# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Maintenance:** Whenever the project undergoes a significant structural change — new agents/nodes added to the pipeline, new services or routers, schema changes, new environment variables, new top-level folders, or a swap of major dependencies — update this file in the same change. Keep the Architecture and Configuration sections in sync with the actual code.

## Project Overview

AI-powered English test question generation system. A FastAPI backend orchestrates a 4-agent LangGraph pipeline (blueprint → generator → distractor → judge) that calls the KKU AI LLM API (OpenAI-compatible) to generate CEFR-leveled English reading/listening/grammar questions, stores them in PostgreSQL, and exposes a job-tracking REST API.

## Development Commands

### Docker Compose (recommended)

```bash
docker-compose up -d          # Start all services
docker-compose logs -f backend  # Follow backend logs
docker-compose down           # Stop all services
```

Services: FastAPI backend at `http://localhost:8000`, LangGraph Studio at `http://localhost:8123`, pgAdmin at `http://localhost:5050`, PostgreSQL at `localhost:5432`.

### Local Development

```bash
cd backend
poetry install
# Set env vars from ../.env before running:
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Database Migrations

```bash
cd backend
alembic upgrade head                              # Apply migrations
alembic revision --autogenerate -m "description"  # Generate new migration
alembic downgrade -1                              # Rollback one
```

Migrations also run automatically on app startup via the FastAPI lifespan handler.

### Tests

```bash
cd backend
pytest
pytest -v -s   # verbose with stdout
```

### LangGraph Studio (pipeline debugging)

```bash
cd backend
langgraph dev --host 0.0.0.0 --port 8123
```

## Architecture

### Multi-Agent Pipeline (LangGraph)

The core logic lives in `backend/app/agents/`. The graph defined in `graph.py` runs four agents sequentially with a forced revision loop that always fires exactly once (controlled by `MAX_REVISION_LOOPS`):

```
blueprint_agent → generator_agent → distractor_agent → judge_agent → [revise once] → end
```

- **blueprint_agent.py**: Parses a free-text requirement into a structured JSON blueprint (skill, CEFR level, topic, question types, item count). Early-returns when `state["blueprint"]` is pre-seeded (paper-section path).
- **generator_agent.py**: Uses the blueprint to generate a passage and question stems + correct answers. Strips markdown fences and validates JSON. On a revision pass, inlines the judge's previous `issues`/`revision_suggestions` directly into its user prompt.
- **distractor_agent.py**: For MCQ-shape items lacking complete A/B/C/D options, calls the LLM to finalize options and re-mark the correct letter; pass-through for items that are already complete or are free-text.
- **judge_agent.py**: Scores each question on `cefr_alignment`, `distractor_quality`, `grammar_naturalness`, and `ambiguity_risk`. A question passes if `overall_score ≥ JUDGE_PASS_THRESHOLD` (default 7.0) AND `ambiguity_risk ≠ "high"`. Revision is forced to happen exactly `MAX_REVISION_LOOPS` times (default 1) regardless of pass/fail — the loop is for polish, not just failure recovery.

Shared state is typed in `agents/state.py` (`PipelineState` TypedDict). Prompts are loaded from plain-text files in `app/prompts/` (`blueprint_system.txt`, `generator_system.txt`, `distractor_system.txt`, `judge_system.txt`).

### LLM Client

`app/utils/llm_client.py` wraps the OpenAI async client pointed at the KKU AI endpoint (`OPENAI_BASE_URL`). All agents call it via `await llm_client.complete(messages)`.

### Test Paper + Session Flow

Beyond the single-pipeline `POST /generate`, the system supports a structured multi-section "test paper" workflow:

1. **`POST /api/v1/papers`** — accepts a list of `SectionSpec` (skill, CEFR, topic, question_types, item_count, section_score, optional `difficulty_mix`). For each section it inserts a `paper_sections` row and a `generation_jobs` row, then `asyncio.create_task` runs `paper_service._orchestrate` which calls `asyncio.gather(*[_run_section(...)], return_exceptions=True)` so one section's failure cannot fail the whole paper. Final paper status: all completed → `completed`, some failed → `partial`, all failed → `failed`.
2. **Skip-blueprint pipeline path** — `generation_service.run_pipeline_for_blueprint(job_id, blueprint, paper_id, section_name)` pre-seeds `state["blueprint"]`. `blueprint_agent.blueprint_node` early-returns if the blueprint is already set, so paper sections bypass the LLM blueprint step.
3. **`POST /api/v1/sessions`** — starts a test session for a paper, loads its items, shuffles within section (preserving section order), strips `correct_answer`/`explanation`/`judge_*`, and stores the item order in `test_sessions.item_order`.
4. **`POST /sessions/{id}/answer`** — incremental save into `test_sessions.responses` JSONB.
5. **`POST /sessions/{id}/submit`** — schedules `scoring_service.grade_session` via `asyncio.create_task`.
6. **`scoring_service.grade_session`** — dispatches by `question_type`:
   - DETERMINISTIC (multiple_choice, main_idea, detail, inference, vocab_in_context, tone_purpose, cloze, error_identification, fill_blank, true_false_not_given, matching, reordering) → pure Python rule check
   - FREE_TEXT (short_answer, essay) → `grader_agent.grade_free_text` LLM call with the rubric in `prompts/grader_system.txt`
   - SKIPPED (speaking_prompt) → recorded with `score_earned=None`
7. **`cefr_service.classify_session`** — after grades persist, computes per-skill mastery by CEFR level, picks the highest level where mastery ≥ `CEFR_MASTERY_THRESHOLD` (with all lower levels also passing), and sets `overall_cefr = min(skill_cefrs)`.
8. **`GET /sessions/{id}/result`** — returns `total_score`, `max_score`, `overall_cefr`, `skill_cefr`, `verdict`, and full per-item breakdown.

### API Layer

Routes split into five routers mounted at `/api/v1/`:
- **api/generation.py**: `POST /generate` (fires async pipeline), `GET /jobs/{job_id}`, `GET /jobs`
- **api/items.py**: `GET /items` (filtered retrieval of stored question items), `GET /passages`, `GET /passages/{id}` (single passage with its questions — used by the PDF export)
- **api/examples.py**: `POST /examples`, `POST /examples/bulk`, `GET /examples`, `DELETE /examples/{id}` — curated reference questions used as few-shot examples by the generator
- **api/papers.py**: `POST /papers` (structured multi-section test paper, runs sections in parallel via `asyncio.gather` with partial-complete semantics), `GET /papers`, `GET /papers/{id}`, `GET /papers/{id}/items`
- **api/sessions.py**: `POST /sessions` (start a test session for a paper, returns shuffled candidate-view items), `POST /sessions/{id}/answer`, `POST /sessions/{id}/submit` (triggers async grading + CEFR classification), `GET /sessions/{id}`, `GET /sessions/{id}/result`

`POST /generate` returns immediately with a `job_id`; the pipeline runs in the background. Poll `GET /jobs/{job_id}` to check `status` (`pending → running → completed/failed`).

### Database

PostgreSQL with pgvector. Eight tables managed by Alembic migrations in `backend/alembic/versions/`:
- **passages** — generated reading passages (UUID, content, CEFR, topic, skill)
- **question_items** — individual questions linked to a passage; stores `options` (JSONB), `judge_score`, `judge_detail` (JSONB), `status` (`draft`/`validated`), plus per-item metadata: `difficulty_band`, `score_weight`, `objective`, `explanation`, `tags`, `paper_id`, `section_name`
- **generation_jobs** — tracks pipeline execution: `status`, `current_node`, `request` (JSONB), `result` (JSONB with `item_ids`)
- **example_items** — curated few-shot reference questions injected into the generator prompt
- **papers** — top-level test papers with `name`, `total_score`, `time_limit_min`, `status` (`pending/running/completed/partial/failed`), `blueprint_request` JSONB
- **paper_sections** — one row per section within a paper, links to its own `passage_id` and `job_id`; tracks `status` per section so partial-complete is supported
- **test_sessions** — candidate test attempts: `paper_id`, `candidate_name`, `responses` (JSONB `{item_id: answer}`), `item_order`, `total_score`, `max_score`, `overall_cefr`, `skill_cefr` (JSONB), `verdict`
- **session_grades** — per-item grading results: `is_correct`, `score_earned`, `score_max`, `judge_detail` (JSONB; populated for free-text items only)

Async SQLAlchemy 2.0 with asyncpg driver. Session factory in `app/database.py`.

### Configuration

`app/config.py` uses Pydantic `BaseSettings` loading from `.env`. Key variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | asyncpg connection string |
| `OPENAI_API_KEY` | KKU AI API key |
| `OPENAI_BASE_URL` | KKU AI endpoint |
| `OPENAI_MODEL` | Model name (e.g. `gemini-2.5-flash-lite`) |
| `JUDGE_PASS_THRESHOLD` | Min score for a question to pass (default 7.0) |
| `MAX_REVISION_LOOPS` | Max regeneration attempts (default 1 — set to limit LLM quota usage) |
| `CEFR_MASTERY_THRESHOLD` | Min mastery ratio per CEFR level to consider it "achieved" (default 0.7) |

Copy `.env.example` to `.env` and fill in credentials before running locally.
