# English Test - AI Question Generation System

AI-powered English test question generation system. A FastAPI backend orchestrates a LangGraph pipeline that calls the KKU AI LLM API (OpenAI-compatible), generates CEFR-leveled English test items, stores them in PostgreSQL, and exposes APIs for job tracking, test papers, candidate sessions, scoring, and CEFR classification. The frontend is a React/Vite console served by the backend at `/ui` after build.

## Features

- LangGraph generation pipeline: blueprint, generator, distractor, judge, and revision loop.
- CEFR-aligned questions across reading, listening, grammar, vocabulary, writing, speaking, and integrated sections.
- Curated few-shot examples injected into the generator for style consistency.
- Async generation jobs with live trace and token usage progress.
- Structured multi-section paper generation with partial-complete semantics.
- Candidate session flow with hidden answers, incremental answer saving, async scoring, and CEFR verdicts.
- Job and paper cancellation for in-flight work.
- React/Vite frontend for quick generation, paper management, job monitoring, sessions, and results.
- PostgreSQL persistence with Alembic migrations.

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | FastAPI, Python 3.11, Poetry |
| Agent orchestration | LangGraph |
| LLM | KKU AI through OpenAI-compatible API |
| Database | PostgreSQL with pgvector image |
| ORM | SQLAlchemy 2.0 async with asyncpg |
| Migrations | Alembic |
| Frontend | React 19, Vite, TypeScript, React Router, TanStack Query |
| Dev tooling | Docker Compose, LangGraph Studio, pgAdmin |

## Project Structure

```text
english-test/
|-- backend/
|   |-- app/
|   |   |-- agents/          # LangGraph pipeline and LLM agents
|   |   |-- api/             # FastAPI routers
|   |   |-- models/          # SQLAlchemy models
|   |   |-- prompts/         # LLM system prompts
|   |   |-- schemas/         # Pydantic schemas
|   |   |-- services/        # Generation, papers, scoring, CEFR, cancellation
|   |   |-- utils/           # LLM client and token tracking
|   |   |-- config.py
|   |   |-- database.py
|   |   `-- main.py
|   |-- alembic/             # DB migrations
|   |-- Dockerfile
|   `-- pyproject.toml
|-- frontend/
|   |-- src/
|   |   |-- app/
|   |   |-- components/
|   |   |-- data/
|   |   |-- pages/
|   |   |-- services/
|   |   `-- utils/
|   |-- package.json
|   `-- vite.config.js
|-- docker-compose.yml
|-- AGENTS.md
`-- CLAUDE.md
```

## Getting Started

### 1. Configure Environment

Copy `.env.example` to `.env` and fill in credentials.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | asyncpg connection string |
| `OPENAI_API_KEY` | KKU AI API key |
| `OPENAI_BASE_URL` | KKU AI endpoint |
| `OPENAI_MODEL` | Model name, default `gemini-2.5-flash-lite` |
| `JUDGE_PASS_THRESHOLD` | Minimum judge score for generated questions, default `7.0` |
| `MAX_REVISION_LOOPS` | Maximum judge-triggered revision loops, default `1` |
| `CEFR_MASTERY_THRESHOLD` | Minimum mastery ratio for CEFR classification, default `0.7` |
| `LLM_JSON_REPAIR_ENABLED` | Optional fallback LLM call to repair malformed agent JSON after local repair fails, default `false` |

### 2. Run with Docker Compose

```bash
docker-compose up -d
docker-compose logs -f backend
```

Services:

- FastAPI backend: http://localhost:8000
- LangGraph Studio: http://localhost:8123
- pgAdmin: http://localhost:5050
- PostgreSQL: localhost:5432

### 3. Backend Local Development

```bash
cd backend
poetry install
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Manual migration commands:

```bash
cd backend
alembic upgrade head
alembic revision --autogenerate -m "description"
alembic downgrade -1
```

The app startup currently calls `Base.metadata.create_all` for local/dev table creation. Alembic remains the reviewable migration history.

### 4. Frontend Local Development

```bash
cd frontend
npm install
npm run dev
npm run typecheck
npm run build
```

During local development, Vite runs at http://localhost:5173/ui/. After `npm run build`, the backend serves `frontend/dist` at `/ui`.

### 5. Run Tests

```bash
cd backend
pytest -v -s
```

No committed test suite is present yet. Mock external LLM calls in new tests.

## API

All routes are mounted at `/api/v1`.

### Generation

| Method | Path | Description |
|---|---|---|
| `POST` | `/generate` | Submit a quick generation request and return `job_id`. |
| `GET` | `/jobs/{job_id}` | Poll job status and live/final trace. |
| `POST` | `/jobs/{job_id}/cancel` | Cancel an in-flight generation job. |
| `GET` | `/jobs` | List jobs, optionally filtered by status. |

### Item Bank

| Method | Path | Description |
|---|---|---|
| `GET` | `/items` | Retrieve stored question items. |
| `GET` | `/passages` | Retrieve generated passages with questions. |
| `GET` | `/passages/{passage_id}` | Retrieve one passage with questions. |

### Few-Shot Examples

| Method | Path | Description |
|---|---|---|
| `POST` | `/examples` | Add a curated reference question. |
| `POST` | `/examples/bulk` | Bulk insert examples. |
| `GET` | `/examples` | List examples. |
| `DELETE` | `/examples/{example_id}` | Remove an example. |

### Papers

| Method | Path | Description |
|---|---|---|
| `POST` | `/papers` | Create a multi-section paper and start section generation. |
| `GET` | `/papers` | List papers. |
| `GET` | `/papers/{paper_id}` | Get paper details with section status and item ids. |
| `POST` | `/papers/{paper_id}/cancel` | Cancel an in-flight paper. |
| `GET` | `/papers/{paper_id}/items` | List generated items for a paper. |

### Sessions

| Method | Path | Description |
|---|---|---|
| `POST` | `/sessions` | Start a candidate session for a completed or partial paper. |
| `POST` | `/sessions/{session_id}/answer` | Save or update one answer. |
| `POST` | `/sessions/{session_id}/submit` | Submit and schedule async grading. |
| `GET` | `/sessions/{session_id}` | Poll session progress. |
| `GET` | `/sessions/{session_id}/result` | Get score, CEFR verdict, and item breakdown. |

## Database Schema

- `passages`: generated passages with CEFR, topic, and skill metadata.
- `question_items`: generated questions, options, answers, judge detail, score metadata, paper linkage, and section name.
- `generation_jobs`: async generation status, current node, request, result trace, and errors.
- `example_items`: curated few-shot examples consumed by the generator.
- `papers`: top-level test paper metadata and status.
- `paper_sections`: section specs, linked passage/job ids, status, and errors.
- `test_sessions`: candidate attempts, responses, item order, totals, CEFR verdicts, and timestamps.
- `session_grades`: per-item grading results.

## Debugging the Pipeline

```bash
cd backend
langgraph dev --host 0.0.0.0 --port 8123
```

Open LangGraph Studio at http://localhost:8123. The backend also exposes a Mermaid graph view at http://localhost:8000/graph.

## License

Personal portfolio project.
