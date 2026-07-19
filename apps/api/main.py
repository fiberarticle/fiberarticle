import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from db import close_pool, open_pool
from db import execute
from rag.embeddings import _get_model
from routers import (
    chats,
    citations,
    documents,
    extractions,
    me,
    papers,
    runs,
)

logging.basicConfig(level=logging.INFO)

logger = logging.getLogger("fiberarticle.main")


async def _warm_embeddings() -> None:
    """Load the fastembed model in the background at startup.

    First use otherwise pays a ~130 MB download plus model init, stalling the
    first upload or run for tens of seconds. Failure is non-fatal: embedding
    call sites already degrade gracefully.
    """
    try:
        await _get_model()
        logger.info("embedding model warmed")
    except Exception:
        logger.exception("embedding warm-up failed; first use will retry")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await open_pool()
    asyncio.create_task(_warm_embeddings())
    # Runs execute as in-process tasks; anything still marked running after a
    # restart was interrupted and can never finish. Surface that honestly.
    await execute(
        """
        UPDATE runs SET status = 'failed',
            error = 'The run was interrupted by an API restart. Press Resume to continue it.',
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
    # Without this the browser hides the export filename (Content-Disposition)
    # from the frontend, which then falls back to a generic name.
    expose_headers=["Content-Disposition"],
)

app.include_router(me.router)
app.include_router(runs.router)
app.include_router(papers.router)
app.include_router(documents.router)
app.include_router(chats.router)
app.include_router(extractions.router)
app.include_router(citations.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "fiberarticle-api"}
