# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Maintenance:** Whenever the project undergoes a significant structural change, update this file in the same change. Examples include new agents or nodes in the pipeline, new services or routers, schema changes, new environment variables, new top-level folders, frontend framework changes, or major dependency swaps. Keep the Architecture and Configuration sections in sync with the actual code.

## Project Overview

AI-powered English test question generation system. A FastAPI backend orchestrates a LangGraph pipeline that calls the KKU AI LLM API (OpenAI-compatible) to generate CEFR-leveled English questions, stores them in PostgreSQL, and exposes REST APIs for generation jobs, papers, candidate sessions, scoring, CEFR classification, and curated examples. The frontend is a React/Vite single-page console served at `/ui` after build, with Vite used for local development.

## Development Commands

### Docker Compose (recommended)

```bash
docker-compose up -d
docker-compose logs -f backend
docker-compose down
```

Services:

- FastAPI backend: `http://localhost:8000`
- React/Vite dev server, when run separately: `http://localhost:5173/ui/`
- LangGraph Studio: `http://localhost:8123`
- pgAdmin: `http://localhost:5050`
- PostgreSQL: `localhost:5432`

### Backend Local Development

```bash
cd backend
poetry install
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Copy `.env.example` to `.env` first and fill in the KKU AI credentials. `app/config.py` reads `.env` through Pydantic settings.

### Frontend Local Development

```bash
cd frontend
npm install
npm run dev
npm run build
npm run typecheck
```

The backend redirects `/` to `/ui/` when `frontend/dist` exists. If the frontend has not been built, `/` redirects to the Vite dev server at `http://localhost:5173/ui/`.

### Database Migrations

```bash
cd backend
alembic upgrade head
alembic revision --autogenerate -m "description"
alembic downgrade -1
```

Alembic migrations live in `backend/alembic/versions/`. The FastAPI lifespan handler currently calls `Base.metadata.create_all` on startup, so migrations are still the source of reviewable schema history but startup can create missing tables in local/dev databases.

### Tests

```bash
cd backend
pytest
pytest -v -s
```

No committed test suite is present yet. Add tests under `backend/tests/` and mock external LLM calls instead of requiring live KKU AI credentials.

### LangGraph Studio

```bash
cd backend
langgraph dev --host 0.0.0.0 --port 8123
```

`backend/langgraph.json` points Studio at the compiled pipeline.

## Architecture

### Backend App

`backend/app/main.py` creates the FastAPI app, configures CORS, mounts the built React SPA from `frontend/dist` at `/ui`, exposes `/health`, and includes all API routers under `/api/v1`. It also exposes `/graph`, which renders a Mermaid view of the LangGraph pipeline.

The backend uses async SQLAlchemy 2.0 with asyncpg. `app/database.py` defines `Base`, the async engine, `AsyncSessionLocal`, and `get_db`.

### Frontend App

The frontend is a Vite + React + TypeScript SPA under `frontend/src/`.

- `src/main.tsx` bootstraps React Query and React Router.
- `src/app/router.tsx` defines routes for quick generation, papers, job monitoring, session taking, and session results.
- `src/app/AppLayout.tsx` provides the shared navigation.
- `src/pages/` contains feature pages.
- `src/services/` contains typed API clients.
- `src/components/domain/` and `src/components/ui/` hold reusable domain and UI components.
- `src/data/assessmentOptions.ts` centralizes frontend option lists.
- `src/utils/` contains token estimation and paper print/export helpers.

Routes support both `/ui/...` in backend-served mode and plain Vite dev paths through a dynamic router basename.

### Multi-Agent Pipeline (LangGraph)

The core generation logic lives in `backend/app/agents/`. `graph.py` runs four nodes sequentially, with a conditional revision edge after judge:

```text
run_blueprint -> run_generator -> run_distractor -> run_judge -> [revise] -> run_generator -> ... -> end
```

Revision is controlled by `settings.max_revision_loops`; the judge sets `should_revise` while `revision_count < max_revision_loops`. With the default of `1`, every successful judge pass still triggers one polish loop.

- `blueprint_agent.py`: Parses a free-text requirement into a structured blueprint. If `state["blueprint"]` is already present, it returns immediately so paper sections can skip the blueprint LLM call.
- `generator_agent.py`: Generates a passage plus question stems and correct answers from the blueprint. It fetches up to three curated examples from `example_items` and inlines judge feedback on revision passes. For `skill = "listening"`, the passage is a TTS-ready transcript: a multi-speaker dialogue (TOEIC Part 3 style) or a single-speaker monologue (TOEIC Part 4 style). When the section's `question_types` are only `photo_description` and/or `question_response` (TOEIC Parts 1-2), the passage is empty and each item is self-contained spoken text.
- `distractor_agent.py`: Completes A/B/C/D options for MCQ-shaped items that need them and passes through complete or free-text items.
- `judge_agent.py`: Scores questions on CEFR alignment, distractor quality, grammar naturalness, and ambiguity risk. A question passes when `overall_score >= JUDGE_PASS_THRESHOLD` and `ambiguity_risk != "high"`.
- `grader_agent.py`: Grades free-text session responses using `prompts/grader_system.txt`.

Shared graph state is typed in `agents/state.py` (`PipelineState`). System prompts are plain text files in `backend/app/prompts/`.

### LLM Client and Token Usage

`app/utils/llm_client.py` wraps the OpenAI async client pointed at `OPENAI_BASE_URL`. Agents call `await complete(system, user, agent="...")`.

`install_token_bucket()` stores per-pipeline token usage in a `contextvars.ContextVar`. `generation_service` writes token usage into each job's live trace so the UI can show progress and rough usage while the job is running.

### Generation Jobs

`POST /api/v1/generate` creates a `generation_jobs` row and starts `generation_service.run_pipeline` with `asyncio.create_task`. The endpoint returns immediately with a `job_id`.

During execution, `generation_service` streams LangGraph chunks, stores the current node, and writes a partial result:

```json
{
  "trace": {
    "blueprint": {},
    "passage": "...",
    "raw_questions": [],
    "questions_with_options": [],
    "judge_results": [],
    "revision_count": 0,
    "judge_passed": false,
    "token_usage": {}
  },
  "in_progress": true
}
```

Completed jobs store `item_ids`, final trace, `judge_passed`, and `revision_count`.

`services/job_registry.py` keeps an in-memory map of running `asyncio.Task` objects so job and paper cancellation endpoints can signal active work. The registry is process-local; after a backend restart, orphaned pending/running jobs may need direct status handling.

### Test Paper Flow

The structured paper workflow is implemented in `services/paper_service.py`.

1. `POST /api/v1/papers` accepts a `PaperCreateRequest` with multiple `SectionSpec` entries.
2. For each section, the service inserts a `paper_sections` row and a linked `generation_jobs` row.
3. `_orchestrate` marks the paper running and launches all sections through `asyncio.gather(..., return_exceptions=True)`, so one section can fail without failing the whole paper.
4. `_section_to_blueprint` converts each section into a pre-seeded blueprint.
5. `run_pipeline_for_blueprint` skips the blueprint agent, runs generator/distractor/judge, persists items, and returns item and passage ids.
6. `_mark_section` stores section status, passage id, errors, and tags generated items with `paper_id`.
7. Final paper status is recomputed from sections: all completed -> `completed`; completed plus failures/cancellations -> `partial`; none completed and any cancelled -> `cancelled`; none completed -> `failed`.

`POST /api/v1/papers/{paper_id}/cancel` cancels live section jobs through `job_registry` and marks orphaned work as cancelled when the task is not running in the current process.

### Candidate Session and Scoring Flow

`api/sessions.py` and `services/scoring_service.py` implement candidate attempts.

1. `POST /api/v1/sessions` starts a session for a completed or partial paper.
2. Items are loaded in section order, shuffled within each section, and stored in `test_sessions.item_order`.
3. Candidate item responses strip hidden fields such as `correct_answer`, `explanation`, judge metadata, and unsafe `_extras`.
4. `POST /api/v1/sessions/{id}/answer` saves incremental responses into `test_sessions.responses`.
5. `POST /api/v1/sessions/{id}/submit` marks the session submitted and schedules `grade_session`.
6. Objective items are graded deterministically:
   - Letter answer types: `multiple_choice`, `main_idea`, `detail`, `inference`, `vocabulary_in_context`, `tone_purpose`, `cloze`, `error_identification`, `photo_description`, `question_response`
   - Flexible deterministic types: `fill_blank`, `true_false_not_given`, `matching`, `reordering`
7. Free-text types `short_answer` and `essay` use `grader_agent.grade_free_text`.
8. `speaking_prompt` is recorded with `score_earned=None` and skipped for Phase 1 grading.
9. After grades are saved, `cefr_service.classify_session` computes per-skill CEFR and overall CEFR.
10. `GET /api/v1/sessions/{id}/result` returns totals, CEFR verdict, and per-item breakdown once scored.

### CEFR Classification

`services/cefr_service.py` groups grade rows by skill and CEFR level. For each skill, it chooses the highest present CEFR level where mastery is at least `CEFR_MASTERY_THRESHOLD` and all lower present levels also pass. Overall CEFR is the minimum across skills; any skill below A1 pulls the overall result to `below A1`.

## API Layer

Routers are mounted at `/api/v1`.

- `api/generation.py`
  - `POST /generate`
  - `GET /jobs/{job_id}`
  - `POST /jobs/{job_id}/cancel`
  - `GET /jobs`
- `api/items.py`
  - `GET /items`
  - `GET /passages`
  - `GET /passages/{passage_id}`
- `api/examples.py`
  - `POST /examples`
  - `POST /examples/bulk`
  - `GET /examples`
  - `DELETE /examples/{example_id}`
- `api/papers.py`
  - `POST /papers`
  - `GET /papers`
  - `GET /papers/{paper_id}`
  - `POST /papers/{paper_id}/cancel`
  - `GET /papers/{paper_id}/items`
- `api/sessions.py`
  - `POST /sessions`
  - `POST /sessions/{session_id}/answer`
  - `POST /sessions/{session_id}/submit`
  - `GET /sessions/{session_id}`
  - `GET /sessions/{session_id}/result`

## Database

PostgreSQL with pgvector image in Docker Compose. Current SQLAlchemy models define these tables:

- `passages`: generated passages with content, word count, CEFR, topic, and skill.
- `question_items`: generated questions; links to optional passage and paper; stores stem, type, options JSONB, correct answer, judge data, revision count, score weight, objective, explanation, tags, difficulty metadata, and section name.
- `generation_jobs`: background generation status, request JSONB, result JSONB, current node, error message, and timestamps.
- `example_items`: curated few-shot reference questions used by the generator.
- `papers`: top-level test papers with status, timing, total score, and original blueprint request.
- `paper_sections`: paper section specs, linked passage/job ids, section status, and error messages.
- `test_sessions`: candidate attempts with responses JSONB, item order, scoring totals, CEFR results, verdict, and timestamps.
- `session_grades`: per-item grading results with response, correctness, score, and optional judge detail.

## Configuration

`app/config.py` uses Pydantic `BaseSettings` with `.env` loading and ignores extra variables. Key settings:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | asyncpg connection string |
| `OPENAI_API_KEY` | KKU AI API key |
| `OPENAI_BASE_URL` | KKU AI endpoint |
| `OPENAI_MODEL` | Model name, default `gemini-2.5-flash-lite` |
| `ENVIRONMENT` | App environment label |
| `SECRET_KEY` | Application secret placeholder for future use |
| `JUDGE_PASS_THRESHOLD` | Minimum judge score for a generated question to pass, default `7.0` |
| `MAX_REVISION_LOOPS` | Maximum judge-triggered revision loops, default `1` in code |
| `CEFR_MASTERY_THRESHOLD` | Minimum mastery ratio per CEFR level, default `0.7` |
| `LLM_JSON_REPAIR_ENABLED` | Optional fallback LLM call to repair malformed agent JSON after local repair fails, default `false` |

When adding or changing configuration, update `app/config.py`, `.env.example`, Docker Compose defaults, README notes, and this file together.

## Coding Notes

- Keep API modules thin; put reusable domain logic in `services/`.
- Keep prompt changes explicit and reviewable under `backend/app/prompts/`.
- Use Pydantic schemas in `backend/app/schemas/` for request and response contracts.
- Prefer focused service and API tests for new behavior.
- Mock LLM calls in tests.
- Do not commit real API keys, database passwords, or generated secrets.
