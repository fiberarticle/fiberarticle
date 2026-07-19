from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from db import execute, fetch_all, fetch_one
from ingest.service import (
    MAX_PDF_BYTES,
    ingest_pdf_bytes,
    ingest_text,
    insert_paper,
)
from models import PaperDetailOut, PaperOut
from security import CurrentUser

router = APIRouter(prefix="/v1", tags=["papers"])


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


def _paper_detail(p: dict) -> PaperDetailOut:
    return PaperDetailOut(
        **_paper_out(p).model_dump(),
        cited_by_count=p.get("cited_by_count") or 0,
        full_text_parsed=p.get("full_text_parsed") or False,
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
    q: str | None = Query(default=None, max_length=300),
    user_id: str = CurrentUser,
) -> list[PaperDetailOut]:
    if q:
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
    return [_paper_detail(r) for r in rows]


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
    return _paper_detail(fresh)
