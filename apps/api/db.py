import json
from typing import Any

from pgvector.psycopg import register_vector_async
from psycopg.rows import dict_row
from psycopg.types.json import Json
from psycopg_pool import AsyncConnectionPool

from config import get_settings

_pool: AsyncConnectionPool | None = None


async def _configure(conn) -> None:
    await conn.set_autocommit(True)
    # The extension must exist before the vector type can be registered on
    # this connection. IF NOT EXISTS makes this a no-op after the first time.
    await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    await register_vector_async(conn)


def get_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        _pool = AsyncConnectionPool(
            get_settings().database_url,
            min_size=1,
            max_size=10,
            kwargs={"row_factory": dict_row},
            configure=_configure,
            open=False,
        )
    return _pool


async def open_pool() -> None:
    pool = get_pool()
    await pool.open()
    async with pool.connection() as conn:
        await _create_schema(conn)


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def fetch_all(query: str, *args: Any) -> list[dict]:
    async with get_pool().connection() as conn:
        cur = await conn.execute(query, args)
        return await cur.fetchall()


async def fetch_one(query: str, *args: Any) -> dict | None:
    async with get_pool().connection() as conn:
        cur = await conn.execute(query, args)
        return await cur.fetchone()


async def execute(query: str, *args: Any) -> None:
    async with get_pool().connection() as conn:
        await conn.execute(query, args)


def jsonb(value: Any) -> Json:
    return Json(value, dumps=lambda v: json.dumps(v, ensure_ascii=False))


async def _create_schema(conn) -> None:
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS llm_config (
            user_id TEXT PRIMARY KEY,
            mode TEXT NOT NULL,
            provider TEXT,
            model TEXT,
            base_url TEXT,
            encrypted_key BYTEA,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id TEXT NOT NULL,
            topic TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            stage TEXT,
            error TEXT,
            report TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS runs_user_idx ON runs (user_id, created_at DESC)"
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS run_events (
            id BIGSERIAL PRIMARY KEY,
            run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL,
            stage TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'info',
            message TEXT NOT NULL,
            data JSONB,
            ts TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS run_events_run_idx ON run_events (run_id, id)"
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS papers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL,
            source TEXT NOT NULL,
            external_id TEXT,
            title TEXT NOT NULL,
            authors JSONB NOT NULL DEFAULT '[]',
            year INT,
            venue TEXT,
            doi TEXT,
            url TEXT,
            abstract TEXT,
            is_open_access BOOLEAN NOT NULL DEFAULT false,
            oa_pdf_url TEXT,
            full_text_parsed BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS papers_user_idx ON papers (user_id, created_at DESC)"
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chunks (
            id BIGSERIAL PRIMARY KEY,
            paper_id UUID NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
            run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL,
            content TEXT NOT NULL,
            embedding vector(384)
        )
        """
    )
    await conn.execute(
        """
        CREATE INDEX IF NOT EXISTS chunks_embedding_idx
        ON chunks USING hnsw (embedding vector_cosine_ops)
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS documents (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            template TEXT NOT NULL DEFAULT 'generic',
            status TEXT NOT NULL DEFAULT 'generating',
            sections JSONB NOT NULL DEFAULT '[]',
            authors JSONB NOT NULL DEFAULT '[]',
            error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS documents_user_idx ON documents (user_id, created_at DESC)"
    )
    # Library papers can exist without a run (uploads, DOI adds, search adds).
    await conn.execute("ALTER TABLE papers ALTER COLUMN run_id DROP NOT NULL")
    await conn.execute("ALTER TABLE chunks ALTER COLUMN run_id DROP NOT NULL")
    # Fiberarticle AI managed mode: per-user toggle between a max-reasoning
    # model (slow, thorough) and a fast non-reasoning model. Defaults on.
    await conn.execute(
        "ALTER TABLE llm_config ADD COLUMN IF NOT EXISTS reasoning BOOLEAN NOT NULL DEFAULT true"
    )
    await conn.execute("ALTER TABLE papers ADD COLUMN IF NOT EXISTS notes TEXT")
    await conn.execute("ALTER TABLE papers ADD COLUMN IF NOT EXISTS summary JSONB")
    await conn.execute(
        "ALTER TABLE papers ADD COLUMN IF NOT EXISTS cited_by_count INT NOT NULL DEFAULT 0"
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS collections (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (user_id, name)
        )
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS paper_collections (
            paper_id UUID NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
            collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            PRIMARY KEY (paper_id, collection_id)
        )
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS conversations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'library',
            paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
            title TEXT NOT NULL DEFAULT 'New conversation',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_messages (
            id BIGSERIAL PRIMARY KEY,
            conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            citations JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # Per-user preferences: global citation style (any CSL id) and the
    # language Fiberarticle AI writes in.
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_prefs (
            user_id TEXT PRIMARY KEY,
            citation_style TEXT NOT NULL DEFAULT 'apa',
            ai_language TEXT NOT NULL DEFAULT 'en-US',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # Journal identity and Scimago rank, denormalized onto papers at insert.
    await conn.execute("ALTER TABLE papers ADD COLUMN IF NOT EXISTS issn TEXT")
    await conn.execute("ALTER TABLE papers ADD COLUMN IF NOT EXISTS quartile TEXT")
    # Research runs double as literature reviews; filters/criteria shape the
    # search and screening stages.
    await conn.execute(
        "ALTER TABLE runs ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'research'"
    )
    await conn.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS filters JSONB")
    await conn.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS criteria TEXT")
    await conn.execute(
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS citation_style TEXT"
    )
    # Scimago SJR journal ranks (seeded by scripts/seed_journal_ranks.py).
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS journal_ranks (
            issn TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            norm_title TEXT NOT NULL,
            sjr REAL,
            best_quartile TEXT,
            h_index INT,
            areas TEXT
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS journal_ranks_title_idx ON journal_ranks (norm_title)"
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS extractions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            columns JSONB NOT NULL,
            paper_ids JSONB NOT NULL,
            rows JSONB NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'running',
            error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
