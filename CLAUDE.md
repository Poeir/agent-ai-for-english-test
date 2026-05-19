# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Maintenance:** Whenever the project undergoes a significant structural change — new agents/nodes added to the pipeline, new services or routers, schema changes, new environment variables, new top-level folders, or a swap of major dependencies — update this file in the same change. Keep the Architecture and Configuration sections in sync with the actual code.

## Project Overview

AI-powered English test question generation system. A FastAPI backend orchestrates a 3-agent LangGraph pipeline (blueprint → generator → judge) that calls the KKU AI LLM API (OpenAI-compatible) to generate CEFR-leveled English reading/listening/grammar questions, stores them in PostgreSQL, and exposes a job-tracking REST API.

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

The core logic lives in `backend/app/agents/`. The graph defined in `graph.py` runs three agents sequentially with a conditional revision loop:

```
blueprint_agent → generator_agent → judge_agent → [pass? end : revise up to MAX_REVISION_LOOPS]
```

- **blueprint_agent.py**: Parses a free-text requirement into a structured JSON blueprint (skill, CEFR level, topic, question types, item count).
- **generator_agent.py**: Uses the blueprint to generate a passage and question stems + correct answers. Strips markdown fences and validates JSON.
- **judge_agent.py**: Scores each question on `cefr_alignment`, `distractor_quality`, `grammar_naturalness`, and `ambiguity_risk`. A question passes if `overall_score ≥ JUDGE_PASS_THRESHOLD` (default 7.0) AND `ambiguity_risk ≠ "high"`.

Shared state is typed in `agents/state.py` (`PipelineState` TypedDict). Prompts are loaded from plain-text files in `app/prompts/` (`blueprint_system.txt`, `generator_system.txt`, `judge_system.txt`).

### LLM Client

`app/utils/llm_client.py` wraps the OpenAI async client pointed at the KKU AI endpoint (`OPENAI_BASE_URL`). All agents call it via `await llm_client.complete(messages)`.

### API Layer

Routes split into three routers mounted at `/api/v1/`:
- **api/generation.py**: `POST /generate` (fires async pipeline), `GET /jobs/{job_id}`, `GET /jobs`
- **api/items.py**: `GET /items` (filtered retrieval of stored question items), `GET /passages`
- **api/examples.py**: `POST /examples`, `POST /examples/bulk`, `GET /examples`, `DELETE /examples/{id}` — curated reference questions used as few-shot examples by the generator

`POST /generate` returns immediately with a `job_id`; the pipeline runs in the background. Poll `GET /jobs/{job_id}` to check `status` (`pending → running → completed/failed`).

### Database

PostgreSQL with pgvector. Four tables managed by Alembic migrations in `backend/alembic/versions/`:
- **passages** — generated reading passages (UUID, content, CEFR, topic, skill)
- **question_items** — individual questions linked to a passage; stores `options` (JSONB), `judge_score`, `judge_detail` (JSONB), `status` (`draft`/`validated`)
- **generation_jobs** — tracks pipeline execution: `status`, `current_node`, `request` (JSONB), `result` (JSONB with `item_ids`)
- **example_items** — curated few-shot reference questions (skill, cefr_level, passage, stem, options). The generator agent pulls up to 3 matching examples and injects them into its user prompt so the LLM emulates their style/difficulty.

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
| `MAX_REVISION_LOOPS` | Max regeneration attempts (default 3) |

Copy `.env.example` to `.env` and fill in credentials before running locally.
