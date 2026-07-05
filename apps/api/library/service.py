"""Paper ingestion for uploads and run seeds: PDFs are parsed with PyMuPDF,
chunked, and embedded into pgvector, then the binary is discarded.
"""

import asyncio

from db import execute, fetch_one, jsonb
from rag.chunking import chunk_text
from rag.embeddings import embed_texts
from sources.base import PaperRecord

MAX_PDF_BYTES = 25 * 1024 * 1024


async def insert_paper(user_id: str, record: PaperRecord) -> dict:
    if not record.get("quartile") and (record.get("issn") or record.get("venue")):
        from citations.quartiles import lookup as quartile_lookup

        try:
            record["quartile"] = await quartile_lookup(
                record.get("issn"), record.get("venue")
            )
        except Exception:
            pass
    row = await fetch_one(
        """
        INSERT INTO papers (
            run_id, user_id, source, external_id, title, authors, year,
            venue, doi, url, abstract, is_open_access, oa_pdf_url,
            cited_by_count, issn, quartile
        )
        VALUES (NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
        record.get("issn"),
        record.get("quartile"),
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
