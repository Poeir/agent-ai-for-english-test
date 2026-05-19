import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.database import AsyncSessionLocal, engine
from app.models import GenerationJob, Passage, QuestionItem  # noqa: F401 — ensure models are imported for create_all


class SPAStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 404 and "." not in path:
            return await super().get_response("index.html", scope)
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.database import Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(title="English Test Generation API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



# Mount the built React frontend at /ui. During development, run Vite on :5173.
_FRONTEND_ROOT = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "frontend")
)
_FRONTEND_DIST = os.path.join(_FRONTEND_ROOT, "dist")
if os.path.isdir(_FRONTEND_DIST):
    app.mount("/ui", SPAStaticFiles(directory=_FRONTEND_DIST, html=True), name="ui")


@app.get("/", include_in_schema=False)
async def root():
    if not os.path.isdir(_FRONTEND_DIST):
        return RedirectResponse(url="http://localhost:5173/ui/")
    return RedirectResponse(url="/ui/")


@app.get("/health")
async def health():
    async with AsyncSessionLocal() as session:
        await session.execute(text("SELECT 1"))
    return {"status": "ok", "db": "connected"}


from app.api import examples, generation, items, papers, sessions  # noqa: E402

app.include_router(generation.router, prefix="/api/v1")
app.include_router(items.router, prefix="/api/v1")
app.include_router(examples.router, prefix="/api/v1")
app.include_router(papers.router, prefix="/api/v1")
app.include_router(sessions.router, prefix="/api/v1")


@app.get("/graph", response_class=HTMLResponse, include_in_schema=False)
async def graph_view():
    from app.agents.graph import pipeline
    mermaid_code = pipeline.get_graph().draw_mermaid()
    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Pipeline Graph</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
  <style>
    body {{ font-family: sans-serif; display: flex; flex-direction: column; align-items: center; padding: 40px; background: #f8f9fa; }}
    h2 {{ color: #333; margin-bottom: 24px; }}
    .mermaid {{ background: white; padding: 32px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }}
  </style>
</head>
<body>
  <h2>English Test Generation Pipeline</h2>
  <div class="mermaid">
{mermaid_code}
  </div>
  <script>mermaid.initialize({{ startOnLoad: true, theme: 'default' }});</script>
</body>
</html>"""
    return HTMLResponse(content=html)
