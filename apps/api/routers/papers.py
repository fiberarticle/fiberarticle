import asyncio

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import Response

from citations import catalog
from citations.engine import StyleNotFound, render_citation
from db import execute, fetch_all, fetch_one
from export.citations import parse_bibtex, to_bibtex, to_ris
from prefs import get_prefs
from library.service import (
    MAX_PDF_BYTES,
    fetch_and_ingest_oa_pdf,
    find_duplicate,
    ingest_pdf_bytes,
    ingest_text,
    insert_paper,
    summarize_paper,
)
from models import (
    CollectionIn,
    CollectionOut,
    PaperAddByDoiIn,
    PaperAddIn,
    PaperDetailOut,
    PaperOut,
    PaperUpdateIn,
)
from security import CurrentUser
from sources import doi as doi_source

router = APIRouter(prefix="/v1", tags=["library"])


def _paper_out(p: dict) -> PaperOut:
    return PaperOut(
        id=str(p["id"]),
        title=p["title"],
        authors=p["authors"] or [],
        year=p["year"],
        venue=p["venue"],
        doi=p["doi"],
        url=p["url"],
        source=p["source"],
        is_open_access=p["is_open_access"],
        abstract=p["abstract"],
        quartile=p.get("quartile"),
    )


async def _paper_detail(p: dict, user_id: str) -> PaperDetailOut:
    collections = await fetch_all(
        "SELECT collection_id FROM paper_collections WHERE paper_id = %s", p["id"]
    )
    chunk_count = await fetch_one(
        "SELECT count(*) AS n FROM chunks WHERE paper_id = %s AND user_id = %s",
        p["id"],
        user_id,
    )
    return PaperDetailOut(
        **_paper_out(p).model_dump(),
        notes=p.get("notes"),
        summary=p.get("summary"),
        cited_by_count=p.get("cited_by_count") or 0,
        full_text_parsed=p.get("full_text_parsed") or False,
        collection_ids=[str(c["collection_id"]) for c in collections],
        chunk_count=chunk_count["n"] if chunk_count else 0,
        run_id=str(p["run_id"]) if p.get("run_id") else None,
        created_at=p["created_at"],
    )


async def _get_owned_paper(paper_id: str, user_id: str) -> dict:
    row = await fetch_one(
        "SELECT * FROM papers WHERE id = %s AND user_id = %s", paper_id, user_id
    )
    if row is None:
        raise HTTPException(404, "Paper not found")
    return row


@router.get("/papers", response_model=list[PaperDetailOut])
async def list_papers(
    collection_id: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=300),
    user_id: str = CurrentUser,
) -> list[PaperDetailOut]:
    if collection_id:
        rows = await fetch_all(
            """
            SELECT p.* FROM papers p
            JOIN paper_collections pc ON pc.paper_id = p.id
            WHERE p.user_id = %s AND pc.collection_id = %s
            ORDER BY p.created_at DESC LIMIT 300
            """,
            user_id,
            collection_id,
        )
    elif q:
        rows = await fetch_all(
            """
            SELECT * FROM papers
            WHERE user_id = %s AND (title ILIKE %s OR authors::text ILIKE %s)
            ORDER BY created_at DESC LIMIT 300
            """,
            user_id,
            f"%{q}%",
            f"%{q}%",
        )
    else:
        rows = await fetch_all(
            "SELECT * FROM papers WHERE user_id = %s ORDER BY created_at DESC LIMIT 300",
            user_id,
        )
    return [await _paper_detail(r, user_id) for r in rows]


@router.post("/papers", response_model=PaperDetailOut, status_code=201)
async def add_paper(body: PaperAddIn, user_id: str = CurrentUser) -> PaperDetailOut:
    duplicate = await find_duplicate(user_id, body.doi, body.title)
    if duplicate:
        raise HTTPException(409, "This paper is already in your library.")
    row = await insert_paper(user_id, body.model_dump())
    # Try to pull full text in the background so chat and extraction work.
    asyncio.create_task(fetch_and_ingest_oa_pdf(str(row["id"]), user_id))
    return await _paper_detail(row, user_id)


@router.post("/papers/doi", response_model=PaperDetailOut, status_code=201)
async def add_paper_by_doi(
    body: PaperAddByDoiIn, user_id: str = CurrentUser
) -> PaperDetailOut:
    record = await doi_source.lookup(body.doi)
    if record is None:
        raise HTTPException(
            404, "Could not resolve that DOI. Check it and try again."
        )
    duplicate = await find_duplicate(user_id, record.get("doi"), record["title"])
    if duplicate:
        raise HTTPException(409, "This paper is already in your library.")
    row = await insert_paper(user_id, record)
    asyncio.create_task(fetch_and_ingest_oa_pdf(str(row["id"]), user_id))
    return await _paper_detail(row, user_id)


def _extract_docx_text(data: bytes) -> str:
    import io

    from docx import Document as DocxDocument

    doc = DocxDocument(io.BytesIO(data))
    return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())


_TEXT_EXTENSIONS = {".txt", ".md"}


@router.post("/papers/upload", response_model=PaperDetailOut, status_code=201)
async def upload_paper(
    file: UploadFile = File(...), user_id: str = CurrentUser
) -> PaperDetailOut:
    name = (file.filename or "").lower()
    extension = "." + name.rsplit(".", 1)[-1] if "." in name else ""
    if extension not in {".pdf", ".docx", *_TEXT_EXTENSIONS}:
        raise HTTPException(
            422, "Supported files: PDF, Word (.docx), and plain text (.txt, .md)."
        )
    data = await file.read()
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(413, "The file is larger than the 25 MB limit.")
    if extension == ".pdf" and not data[:5].startswith(b"%PDF"):
        raise HTTPException(422, "That file is not a valid PDF.")

    title = (file.filename or "Uploaded document").rsplit(".", 1)[0].replace("_", " ")
    row = await insert_paper(
        user_id,
        {
            "source": "upload",
            "title": title[:500],
            "authors": [],
            "is_open_access": False,
        },
    )
    try:
        if extension == ".pdf":
            chunks = await ingest_pdf_bytes(str(row["id"]), user_id, data)
        elif extension == ".docx":
            text = _extract_docx_text(data)
            chunks = await ingest_text(str(row["id"]), user_id, text)
        else:
            text = data.decode("utf-8", errors="replace")
            chunks = await ingest_text(str(row["id"]), user_id, text)
    except ValueError as exc:
        await execute("DELETE FROM papers WHERE id = %s", row["id"])
        raise HTTPException(422, str(exc))
    except Exception:
        await execute("DELETE FROM papers WHERE id = %s", row["id"])
        raise HTTPException(422, "The file could not be read. Is it valid?")
    if chunks == 0:
        await execute("DELETE FROM papers WHERE id = %s", row["id"])
        raise HTTPException(422, "No text could be extracted from that file.")
    fresh = await _get_owned_paper(str(row["id"]), user_id)
    return await _paper_detail(fresh, user_id)


@router.post("/papers/import/bibtex", response_model=list[PaperDetailOut])
async def import_bibtex(
    file: UploadFile = File(...), user_id: str = CurrentUser
) -> list[PaperDetailOut]:
    text = (await file.read()).decode("utf-8", errors="replace")
    records = parse_bibtex(text)
    if not records:
        raise HTTPException(422, "No entries could be parsed from that BibTeX file.")
    added: list[PaperDetailOut] = []
    for record in records[:200]:
        if await find_duplicate(user_id, record.get("doi"), record["title"]):
            continue
        record["source"] = "bibtex"
        row = await insert_paper(user_id, record)
        asyncio.create_task(fetch_and_ingest_oa_pdf(str(row["id"]), user_id))
        added.append(await _paper_detail(row, user_id))
    return added


@router.get("/papers/export")
async def export_library(
    format: str = Query(default="bibtex", pattern="^(bibtex|ris)$"),
    collection_id: str | None = Query(default=None),
    user_id: str = CurrentUser,
) -> Response:
    if collection_id:
        rows = await fetch_all(
            """
            SELECT p.* FROM papers p
            JOIN paper_collections pc ON pc.paper_id = p.id
            WHERE p.user_id = %s AND pc.collection_id = %s
            ORDER BY p.created_at
            """,
            user_id,
            collection_id,
        )
    else:
        rows = await fetch_all(
            "SELECT * FROM papers WHERE user_id = %s ORDER BY created_at", user_id
        )
    if not rows:
        raise HTTPException(404, "Nothing to export yet.")
    if format == "bibtex":
        return Response(
            content=to_bibtex(rows),
            media_type="application/x-bibtex",
            headers={"Content-Disposition": 'attachment; filename="fiberarticle-library.bib"'},
        )
    return Response(
        content=to_ris(rows),
        media_type="application/x-research-info-systems",
        headers={"Content-Disposition": 'attachment; filename="fiberarticle-library.ris"'},
    )


@router.get("/papers/{paper_id}", response_model=PaperDetailOut)
async def get_paper(paper_id: str, user_id: str = CurrentUser) -> PaperDetailOut:
    row = await _get_owned_paper(paper_id, user_id)
    return await _paper_detail(row, user_id)


@router.put("/papers/{paper_id}", response_model=PaperDetailOut)
async def update_paper(
    paper_id: str, body: PaperUpdateIn, user_id: str = CurrentUser
) -> PaperDetailOut:
    row = await _get_owned_paper(paper_id, user_id)
    if body.notes is not None:
        await execute(
            "UPDATE papers SET notes = %s WHERE id = %s", body.notes[:20000], paper_id
        )
    if body.collection_ids is not None:
        owned = await fetch_all(
            "SELECT id FROM collections WHERE user_id = %s", user_id
        )
        owned_ids = {str(c["id"]) for c in owned}
        invalid = [c for c in body.collection_ids if c not in owned_ids]
        if invalid:
            raise HTTPException(422, "Unknown collection.")
        await execute(
            "DELETE FROM paper_collections WHERE paper_id = %s", paper_id
        )
        for collection_id in set(body.collection_ids):
            await execute(
                "INSERT INTO paper_collections (paper_id, collection_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                paper_id,
                collection_id,
            )
    fresh = await _get_owned_paper(paper_id, user_id)
    return await _paper_detail(fresh, user_id)


@router.delete("/papers/{paper_id}", status_code=204)
async def delete_paper(paper_id: str, user_id: str = CurrentUser) -> None:
    await _get_owned_paper(paper_id, user_id)
    await execute("DELETE FROM papers WHERE id = %s", paper_id)


@router.post("/papers/{paper_id}/summarize", response_model=PaperDetailOut)
async def summarize(paper_id: str, user_id: str = CurrentUser) -> PaperDetailOut:
    await _get_owned_paper(paper_id, user_id)
    try:
        await summarize_paper(paper_id, user_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    fresh = await _get_owned_paper(paper_id, user_id)
    return await _paper_detail(fresh, user_id)


# Legacy short names from the first citation implementation.
_LEGACY_STYLES = {
    "mla": "modern-language-association",
    "chicago": "chicago-author-date",
    "vancouver": "vancouver-nlm",
    "harvard": "harvard-cite-them-right",
}


@router.get("/papers/{paper_id}/citation")
async def get_citation(
    paper_id: str,
    style: str | None = Query(default=None, max_length=120),
    user_id: str = CurrentUser,
) -> dict:
    if style is None:
        style = (await get_prefs(user_id))["citation_style"]
    style = _LEGACY_STYLES.get(style, style)
    if catalog.entry(style) is None:
        raise HTTPException(422, "Unknown citation style.")
    row = await _get_owned_paper(paper_id, user_id)
    try:
        citation = await render_citation(dict(row), style)
    except StyleNotFound as exc:
        raise HTTPException(422, str(exc))
    return {
        "style": style,
        "style_title": catalog.style_title(style),
        "citation": citation,
    }


# ------------------------------------------------------------- collections


@router.get("/collections", response_model=list[CollectionOut])
async def list_collections(user_id: str = CurrentUser) -> list[CollectionOut]:
    rows = await fetch_all(
        """
        SELECT c.*, (SELECT count(*) FROM paper_collections pc WHERE pc.collection_id = c.id) AS paper_count
        FROM collections c WHERE c.user_id = %s ORDER BY c.name
        """,
        user_id,
    )
    return [
        CollectionOut(
            id=str(r["id"]),
            name=r["name"],
            paper_count=r["paper_count"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


@router.post("/collections", response_model=CollectionOut, status_code=201)
async def create_collection(
    body: CollectionIn, user_id: str = CurrentUser
) -> CollectionOut:
    existing = await fetch_one(
        "SELECT id FROM collections WHERE user_id = %s AND lower(name) = lower(%s)",
        user_id,
        body.name.strip(),
    )
    if existing:
        raise HTTPException(409, "A collection with that name already exists.")
    row = await fetch_one(
        "INSERT INTO collections (user_id, name) VALUES (%s, %s) RETURNING *",
        user_id,
        body.name.strip(),
    )
    return CollectionOut(
        id=str(row["id"]), name=row["name"], paper_count=0, created_at=row["created_at"]
    )


@router.delete("/collections/{collection_id}", status_code=204)
async def delete_collection(collection_id: str, user_id: str = CurrentUser) -> None:
    row = await fetch_one(
        "SELECT id FROM collections WHERE id = %s AND user_id = %s",
        collection_id,
        user_id,
    )
    if row is None:
        raise HTTPException(404, "Collection not found")
    await execute("DELETE FROM collections WHERE id = %s", collection_id)
