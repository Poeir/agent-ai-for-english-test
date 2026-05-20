# Repository Guidelines

## Project Structure & Module Organization

This repository contains a FastAPI backend and a React/Vite frontend for AI-assisted English test generation.

- `backend/app/main.py` creates the FastAPI app, mounts the built frontend at `/ui`, exposes `/health` and `/graph`, and registers API routers.
- `backend/app/api/` contains route modules for generation jobs, items/passages, examples, papers, and sessions.
- `backend/app/agents/` contains the LangGraph pipeline, generation/judge/grader agents, and shared agent state.
- `backend/app/services/` holds orchestration and domain logic for generation, papers, scoring, CEFR classification, and job cancellation.
- `backend/app/models/` and `backend/app/schemas/` define SQLAlchemy models and Pydantic request/response shapes.
- `backend/app/prompts/` stores LLM system prompts; keep prompt changes explicit and reviewable.
- `backend/alembic/` contains database migrations.
- `frontend/src/` contains the React application, with pages, services, shared UI/domain components, data constants, and utilities.

## Build, Test, and Development Commands

- `docker-compose up -d` starts PostgreSQL, backend, LangGraph Studio, and pgAdmin.
- `docker-compose logs -f backend` tails backend logs during local development.
- `cd backend; poetry install` installs Python dependencies.
- `cd backend; uvicorn app.main:app --reload --host 0.0.0.0 --port 8000` runs the API locally.
- `cd backend; alembic upgrade head` applies migrations manually.
- `cd backend; alembic revision --autogenerate -m "description"` creates a migration after model changes.
- `cd backend; pytest -v -s` runs the backend test suite.
- `cd frontend; npm install` installs frontend dependencies.
- `cd frontend; npm run dev` runs the Vite dev server on port 5173.
- `cd frontend; npm run build` type-checks and builds the frontend into `frontend/dist`.
- `cd frontend; npm run typecheck` runs the TypeScript type check only.

## Coding Style & Naming Conventions

Use Python 3.11 syntax and four-space indentation. Follow the existing package style: snake_case modules and functions, PascalCase Pydantic and SQLAlchemy classes, and explicit type hints for request/response data. Keep API modules thin; place reusable business logic in `services/`. Use prompt filenames ending in `_system.txt` for system prompts.

Frontend code uses TypeScript, React function components, and PascalCase component/page filenames. Keep API access in `frontend/src/services/`, shared visual primitives in `frontend/src/components/ui/`, and domain-specific reusable components in `frontend/src/components/domain/`.

## Testing Guidelines

No test directory is currently committed, but `pytest` and `pytest-asyncio` are available. Add backend tests under `backend/tests/` with names like `test_generation_api.py` or `test_scoring_service.py`. Prefer focused tests around services, API responses, migrations, and agent state transitions. Mock external LLM calls instead of requiring live KKU AI credentials.

For frontend changes, run `npm run typecheck` and `npm run build` from `frontend/`. Add component or integration tests only after a test harness is introduced.

## Commit & Pull Request Guidelines

Recent history uses short imperative commits such as `update readme`, `Refactor code structure...`, and `Add .gitignore...`. Keep commits concise and scoped to one concern. Pull requests should include a summary, affected API or database changes, test results, linked issues when applicable, and screenshots for frontend changes. Call out new environment variables or migration steps.

## Security & Configuration Tips

Copy `.env.example` to `.env` for local setup. Do not commit real API keys, database passwords, or generated secrets. When changing configuration, update `.env.example`, README notes, Docker Compose defaults, and `CLAUDE.md` together.
