"""Library operations: adding papers outside of runs, full-text ingestion,
and AI paper summaries. All ingestion is real: PDFs are parsed with PyMuPDF,
chunked, and embedded into pgvector, then the binary is discarded.
"""

import asyncio
import json
import logging
import re

import httpx

from db import execute, fetch_all, fetch_one, jsonb
from llm.client import resolve_llm
from rag.chunking import chunk_text
from rag.embeddings import embed_texts
from sources import unpaywall
from sources.base import PaperRecord

logger = logging.getLogger("fiberarticle.library")

MAX_PDF_BYTES = 25 * 1024 * 1024


def _title_key(title: str) -> str:
    return re.sub(r"\W+", "", (title or "").lower())


async def find_duplicate(user_id: str, doi: str | None, title: str) -> dict | None:
    if doi:
        row = await fetch_one(
            "SELECT * FROM papers WHERE user_id = %s AND doi = %s LIMIT 1",
            user_id,
            doi,
        )
        if row:
            return row
    rows = await fetch_all(
        "SELECT * FROM papers WHERE user_id = %s AND lower(title) = lower(%s) LIMIT 1",
        user_id,
        title,
    )
    return rows[0] if rows else None


async def insert_paper(user_id: str, record: PaperRecord) -> dict:
    row = await fetch_one(
        """
        INSERT INTO papers (
            run_id, user_id, source, external_id, title, authors, year,
            venue, doi, url, abstract, is_open_access, oa_pdf_url, cited_by_count
        )
        VALUES (NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        user_id,
        record.get("source") or "manual",
        record.get("external_id"),
        record.get("title") or "Untitled",
        jsonb(record.get("authors") or []),
        record.get("year"),
        record.get("venue"),
        record.get("doi"),
        record.get("url"),
        record.get("abstract"),
        bool(record.get("is_open_access")),
        record.get("oa_pdf_url"),
        record.get("cited_by_count") or 0,
    )
    return row


async def ingest_text(paper_id: str, user_id: str, text: str) -> int:
    """Chunk and embed full text for a paper. Returns chunk count."""
    await execute(
        "DELETE FROM chunks WHERE paper_id = %s AND user_id = %s", paper_id, user_id
    )
    chunks = chunk_text(text)
    if not chunks:
        return 0
    vectors = await embed_texts(chunks)
    for content, vector in zip(chunks, vectors):
        await execute(
            """
            INSERT INTO chunks (paper_id, run_id, user_id, content, embedding)
            VALUES (%s, NULL, %s, %s, %s)
            """,
            paper_id,
            user_id,
            content,
            vector,
        )
    await execute(
        "UPDATE papers SET full_text_parsed = true WHERE id = %s", paper_id
    )
    return len(chunks)


def parse_pdf_bytes(data: bytes) -> str:
    import pymupdf
    import pymupdf4llm

    with pymupdf.open(stream=data, filetype="pdf") as doc:
        return pymupdf4llm.to_markdown(doc)


async def ingest_pdf_bytes(paper_id: str, user_id: str, data: bytes) -> int:
    text = await asyncio.to_thread(parse_pdf_bytes, data)
    if not text.strip():
        raise ValueError("The PDF contained no extractable text (it may be scanned images).")
    return await ingest_text(paper_id, user_id, text)


async def fetch_and_ingest_oa_pdf(paper_id: str, user_id: str) -> None:
    """Background: locate an open-access PDF and ingest full text if found."""
    try:
        paper = await fetch_one(
            "SELECT * FROM papers WHERE id = %s AND user_id = %s", paper_id, user_id
        )
        if paper is None or paper["full_text_parsed"]:
            return
        url = paper.get("oa_pdf_url")
        if not url and paper.get("doi"):
            url = await unpaywall.find_oa_pdf(paper["doi"])
            if url:
                await execute(
                    "UPDATE papers SET oa_pdf_url = %s, is_open_access = true WHERE id = %s",
                    url,
                    paper_id,
                )
        if not url:
            # Nothing open access: fall back to indexing the abstract so the
            # paper is still usable in chat and extraction.
            if paper.get("abstract"):
                await ingest_text(paper_id, user_id, paper["abstract"])
            return
        async with httpx.AsyncClient(timeout=40, follow_redirects=True) as client:
            res = await client.get(url, headers={"User-Agent": "Fiberarticle/0.1"})
        if (
            res.status_code == 200
            and len(res.content) <= MAX_PDF_BYTES
            and res.content[:5].startswith(b"%PDF")
        ):
            await ingest_pdf_bytes(paper_id, user_id, res.content)
        elif paper.get("abstract"):
            await ingest_text(paper_id, user_id, paper["abstract"])
    except Exception:
        logger.exception("background OA ingestion failed for paper %s", paper_id)


def _parse_json_object(text: str) -> dict | None:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


async def summarize_paper(paper_id: str, user_id: str) -> dict:
    paper = await fetch_one(
        "SELECT * FROM papers WHERE id = %s AND user_id = %s", paper_id, user_id
    )
    if paper is None:
        raise ValueError("Paper not found")

    chunks = await fetch_all(
        "SELECT content FROM chunks WHERE paper_id = %s AND user_id = %s ORDER BY id LIMIT 6",
        paper_id,
        user_id,
    )
    material = "\n\n".join(c["content"][:1200] for c in chunks) or (
        paper.get("abstract") or ""
    )
    if not material.strip():
        raise ValueError(
            "No text available for this paper. Upload its PDF to enable summaries."
        )

    llm = await resolve_llm(user_id)
    text = await llm.complete(
        [
            {
                "role": "system",
                "content": (
                    "Summarize an academic paper from the provided text. Respond "
                    "with ONLY a JSON object with keys: tldr (one sentence), "
                    "key_findings (array of 3-5 strings), methodology (one short "
                    "paragraph), limitations (array of 1-3 strings)."
                ),
            },
            {
                "role": "user",
                "content": f"Title: {paper['title']}\n\nText:\n{material[:8000]}",
            },
        ],
        max_tokens=700,
    )
    summary = _parse_json_object(text)
    if not summary or "tldr" not in summary:
        raise ValueError("The model did not return a valid summary. Try again.")

    await execute(
        "UPDATE papers SET summary = %s WHERE id = %s", jsonb(summary), paper_id
    )
    return summary
