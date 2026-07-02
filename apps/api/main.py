import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from db import close_pool, open_pool
from db import execute
from routers import chats, documents, extractions, me, papers, runs, search

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await open_pool()
    # Runs execute as in-process tasks; anything still marked running after a
    # restart was interrupted and can never finish. Surface that honestly.
    await execute(
        """
        UPDATE runs SET status = 'failed',
            error = 'The run was interrupted by an API restart. Start a new run.',
            updated_at = now()
        WHERE status IN ('pending', 'running')
        """
    )
    await execute(
        """
        UPDATE documents SET status = 'failed',
            error = 'Generation was interrupted by an API restart. Generate again.',
            updated_at = now()
        WHERE status = 'generating'
        """
    )
    await execute(
        """
        UPDATE extractions SET status = 'failed',
            error = 'Extraction was interrupted by an API restart. Run it again.',
            updated_at = now()
        WHERE status = 'running'
        """
    )
    yield
    await close_pool()


app = FastAPI(
    title="Fiberarticle API",
    description=(
        "Fiberarticle is an agentic AI that discovers academic sources, reads and "
        "synthesizes the literature, tracks references, and writes publication-ready articles."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(me.router)
app.include_router(runs.router)
app.include_router(papers.router)
app.include_router(documents.router)
app.include_router(search.router)
app.include_router(chats.router)
app.include_router(extractions.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "fiberarticle-api"}
