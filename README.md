# Gofive English Test — AI Question Generation System

AI-powered English test question generation system. A FastAPI backend orchestrates a 3-agent LangGraph pipeline (blueprint → generator → judge) that calls the KKU AI LLM API to generate CEFR-leveled English reading, listening, and grammar questions, stores them in PostgreSQL, and exposes a job-tracking REST API.

## Features

- **Multi-agent pipeline** built on LangGraph with a conditional revision loop
- **CEFR-aligned MCQ generation** across reading, listening, and grammar skills
- **Quality judging** with scoring on CEFR alignment, distractor quality, grammar naturalness, and ambiguity risk
- **Few-shot examples** — curated reference questions injected into the generator prompt for style consistency
- **Async job tracking** — fire-and-poll REST API for long-running generations
- **PostgreSQL + pgvector** persistence with Alembic migrations

## Architecture

```
POST /api/v1/generate
        │
        ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────┐
│ Blueprint Agent  │ ──▶ │ Generator Agent  │ ──▶ │ Judge Agent  │
│ (parse request)  │     │ (passage + Qs)   │     │ (score & QA) │
└──────────────────┘     └──────────────────┘     └──────┬───────┘
                                  ▲                      │
                                  └──── revise (≤ N) ────┘
                                                         │
                                                         ▼
                                                  PostgreSQL
```

- **Blueprint agent** — parses a free-text requirement into a structured JSON blueprint (skill, CEFR level, topic, question types, item count).
- **Generator agent** — produces a passage and question stems + correct answers using up to 3 matching few-shot examples.
- **Judge agent** — scores each question; passes if `overall_score ≥ JUDGE_PASS_THRESHOLD` and `ambiguity_risk ≠ "high"`. Otherwise the graph loops back to the generator (up to `MAX_REVISION_LOOPS`).

Shared state is typed in `backend/app/agents/state.py`. Prompts live in `backend/app/prompts/`.

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | FastAPI (Python 3.11), Poetry |
| Agent orchestration | LangGraph |
| LLM | KKU AI (OpenAI-compatible endpoint) |
| Database | PostgreSQL with pgvector |
| ORM | SQLAlchemy 2.0 async (asyncpg) |
| Migrations | Alembic |
| Frontend | Minimal HTML (`frontend/index.html`) |
| Dev tooling | Docker Compose, LangGraph Studio, pgAdmin |

## Project Structure

```
gofive-english-test/
├── backend/
│   ├── app/
│   │   ├── agents/          # LangGraph pipeline (graph.py, state.py, *_agent.py)
│   │   ├── api/             # FastAPI routers (generation, items, examples)
│   │   ├── prompts/         # Prompt templates (.txt)
│   │   ├── services/        # generation_service.py — pipeline runner
│   │   ├── utils/llm_client.py
│   │   ├── config.py        # Pydantic settings (.env loader)
│   │   ├── database.py      # Async SQLAlchemy session factory
│   │   └── main.py
│   ├── alembic/             # DB migrations
│   ├── Dockerfile
│   └── pyproject.toml
├── frontend/
│   └── index.html
├── docker-compose.yml
└── CLAUDE.md
```

## Getting Started

### 1. Configure environment

Copy `.env.example` to `.env` and fill in:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | asyncpg connection string |
| `OPENAI_API_KEY` | KKU AI API key |
| `OPENAI_BASE_URL` | KKU AI endpoint |
| `OPENAI_MODEL` | Model name (e.g. `gemini-2.5-flash-lite`) |
| `JUDGE_PASS_THRESHOLD` | Min score to pass (default `7.0`) |
| `MAX_REVISION_LOOPS` | Max regenerations (default `3`) |

### 2. Run with Docker Compose (recommended)

```bash
docker-compose up -d
docker-compose logs -f backend
```

Services:
- FastAPI backend → http://localhost:8000
- LangGraph Studio → http://localhost:8123
- pgAdmin → http://localhost:5050
- PostgreSQL → localhost:5432

### 3. Local development (without Docker)

```bash
cd backend
poetry install
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Migrations run automatically on app startup. To manage them manually:

```bash
alembic upgrade head
alembic revision --autogenerate -m "description"
alembic downgrade -1
```

### 4. Run tests

```bash
cd backend
pytest -v -s
```

## API

All routes are mounted at `/api/v1/`.

### Generation

| Method | Path | Description |
|---|---|---|
| `POST` | `/generate` | Submits a generation request, returns `job_id` immediately. Pipeline runs in the background. |
| `GET` | `/jobs/{job_id}` | Poll job status (`pending → running → completed/failed`). |
| `GET` | `/jobs` | List jobs. |

### Item bank

| Method | Path | Description |
|---|---|---|
| `GET` | `/items` | Filtered retrieval of stored question items. |
| `GET` | `/passages` | Retrieve generated passages. |

### Few-shot examples

| Method | Path | Description |
|---|---|---|
| `POST` | `/examples` | Add a curated reference question. |
| `POST` | `/examples/bulk` | Bulk insert. |
| `GET` | `/examples` | List examples. |
| `DELETE` | `/examples/{id}` | Remove an example. |

## Database Schema

- **passages** — generated reading passages (UUID, content, CEFR, topic, skill).
- **question_items** — individual questions linked to a passage; stores `options` (JSONB), `judge_score`, `judge_detail` (JSONB), `status` (`draft` / `validated`).
- **generation_jobs** — tracks pipeline execution: `status`, `current_node`, `request` (JSONB), `result` (JSONB with `item_ids`).
- **example_items** — curated few-shot reference questions consumed by the generator agent.

## Debugging the Pipeline

```bash
cd backend
langgraph dev --host 0.0.0.0 --port 8123
```

Then open LangGraph Studio at http://localhost:8123 to step through agent state transitions.

## License

Internal project — Gofive Internship.
