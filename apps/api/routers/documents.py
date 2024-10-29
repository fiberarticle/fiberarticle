import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from citations import catalog
from citations.engine import is_numeric, render_bibliography, render_intext
from db import execute, fetch_all, fetch_one, jsonb
from export.docx_export import render_docx
from latex.render import render_project_zip
from latex.templates import TEMPLATES
from llm.client import LlmNotConfigured, resolve_llm
from prefs import LANGUAGES, get_prefs
from models import (
    DocumentCreate,
    DocumentListItem,
    DocumentOut,
    DocumentUpdate,
    PaperOut,
    SectionEditIn,
    SectionEditOut,
)
from security import CurrentUser
from writer.generate import run_edit_command, start_generation

router = APIRouter(prefix="/v1", tags=["documents"])


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


async def _get_owned_document(document_id: str, user_id: str) -> dict:
    row = await fetch_one(
        "SELECT * FROM documents WHERE id = %s AND user_id = %s",
        document_id,
        user_id,
    )
    if row is None:
        raise HTTPException(404, "Document not found")
    return row


async def _references_for(row: dict, user_id: str) -> list[PaperOut]:
    if not row["run_id"]:
        return []
    papers = await fetch_all(
        "SELECT * FROM papers WHERE run_id = %s AND user_id = %s ORDER BY created_at",
        row["run_id"],
        user_id,
    )
    return [_paper_out(p) for p in papers]


# The citation style used when neither the document nor the user chose one.
_TEMPLATE_DEFAULT_STYLE = {
    "generic": "ieee",
    "ieee": "ieee",
    "apa": "apa",
    "acm": "acm-sig-proceedings",
    "elsevier": "elsevier-harvard",
    "springer": "springer-basic-author-date",
    "neurips": "apa",
}


async def _effective_style(row: dict, user_id: str) -> str:
    if row.get("citation_style") and catalog.entry(row["citation_style"]):
        return row["citation_style"]
    preferred = (await get_prefs(user_id))["citation_style"]
    if catalog.entry(preferred):
        return preferred
    return _TEMPLATE_DEFAULT_STYLE.get(row["template"], "apa")


async def _document_out(row: dict, user_id: str) -> DocumentOut:
    return DocumentOut(
        id=str(row["id"]),
        run_id=str(row["run_id"]) if row["run_id"] else None,
        title=row["title"],
        template=row["template"],
        status=row["status"],
        sections=row["sections"] or [],
        authors=row["authors"] or [],
        citation_style=row.get("citation_style"),
        error=row["error"],
        references=await _references_for(row, user_id),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.post("/runs/{run_id}/document", response_model=DocumentOut, status_code=201)
async def create_document(
    run_id: str, body: DocumentCreate, user_id: str = CurrentUser
) -> DocumentOut:
    run = await fetch_one(
        "SELECT * FROM runs WHERE id = %s AND user_id = %s", run_id, user_id
    )
    if run is None:
        raise HTTPException(404, "Run not found")
    if run["status"] != "completed":
        raise HTTPException(409, "The run must complete before generating an article.")
    paper_count = await fetch_one(
        "SELECT count(*) AS n FROM papers WHERE run_id = %s", run_id
    )
    if not paper_count or paper_count["n"] == 0:
        raise HTTPException(409, "This run found no papers to cite.")
    try:
        await resolve_llm(user_id)
    except LlmNotConfigured as exc:
        raise HTTPException(409, str(exc))

    row = await fetch_one(
        """
        INSERT INTO documents (run_id, user_id, title, template, status, sections)
        VALUES (%s, %s, %s, %s, 'generating', %s)
        RETURNING *
        """,
        run_id,
        user_id,
        run["topic"],
        body.template,
        jsonb([]),
    )
    start_generation(str(row["id"]), run_id, user_id)
    return await _document_out(row, user_id)


@router.get("/documents", response_model=list[DocumentListItem])
async def list_documents(user_id: str = CurrentUser) -> list[DocumentListItem]:
    rows = await fetch_all(
        "SELECT * FROM documents WHERE user_id = %s ORDER BY created_at DESC LIMIT 100",
        user_id,
    )
    return [
        DocumentListItem(
            id=str(r["id"]),
            title=r["title"],
            template=r["template"],
            status=r["status"],
            pinned=bool(r.get("pinned")),
            section_count=len(r["sections"] or []),
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )
        for r in rows
    ]


@router.get("/documents/{document_id}", response_model=DocumentOut)
async def get_document(document_id: str, user_id: str = CurrentUser) -> DocumentOut:
    row = await _get_owned_document(document_id, user_id)
    return await _document_out(row, user_id)


@router.put("/documents/{document_id}", response_model=DocumentOut)
async def update_document(
    document_id: str, body: DocumentUpdate, user_id: str = CurrentUser
) -> DocumentOut:
    row = await _get_owned_document(document_id, user_id)
    # Content edits must wait for generation (the writer owns the sections),
    # but sidebar rename/pin is metadata-only and always safe.
    if row["status"] == "generating" and body.sections is not None:
        raise HTTPException(409, "Wait for generation to finish before editing.")

    title = body.title if body.title is not None else row["title"]
    template = body.template if body.template is not None else row["template"]
    sections = (
        [s.model_dump() for s in body.sections]
        if body.sections is not None
        else row["sections"]
    )
    authors = body.authors if body.authors is not None else (row["authors"] or [])
    citation_style = (
        body.citation_style
        if body.citation_style is not None
        else row.get("citation_style")
    )
    if citation_style and catalog.entry(citation_style) is None:
        raise HTTPException(422, "Unknown citation style.")
    pinned = body.pinned if body.pinned is not None else bool(row.get("pinned"))

    await execute(
        """
        UPDATE documents
        SET title = %s, template = %s, sections = %s, authors = %s,
            citation_style = %s, pinned = %s, updated_at = now()
        WHERE id = %s
        """,
        title.strip() or row["title"],
        template,
        jsonb(sections),
        jsonb(authors),
        citation_style,
        pinned,
        document_id,
    )
    updated = await _get_owned_document(document_id, user_id)
    return await _document_out(updated, user_id)


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(document_id: str, user_id: str = CurrentUser) -> None:
    await _get_owned_document(document_id, user_id)
    await execute("DELETE FROM documents WHERE id = %s", document_id)


@router.post("/documents/{document_id}/edit", response_model=SectionEditOut)
async def edit_section(
    document_id: str, body: SectionEditIn, user_id: str = CurrentUser
) -> SectionEditOut:
    row = await _get_owned_document(document_id, user_id)
    sections = row["sections"] or []
    section = next((s for s in sections if s["id"] == body.section_id), None)
    if section is None:
        raise HTTPException(404, "Section not found")

    if body.command == "custom" and not (body.instruction or "").strip():
        raise HTTPException(422, "Describe how you want this text edited.")
    if body.command == "tone" and not body.tone:
        raise HTTPException(422, "Choose a tone.")
    target_language = None
    if body.command == "translate":
        if body.language not in LANGUAGES:
            raise HTTPException(422, "Choose a language to translate into.")
        target_language = LANGUAGES[body.language]

    original = section["content"] or ""

    try:
        revised = await run_edit_command(
            user_id,
            body.command,
            section["heading"],
            original,
            instruction=body.instruction,
            tone=body.tone,
            target_language=target_language,
            selected_text=body.selected_text,
            context_before=body.context_before,
            context_after=body.context_after,
        )
    except LlmNotConfigured as exc:
        raise HTTPException(409, str(exc))
    if not revised:
        raise HTTPException(502, "The model returned an empty revision.")

    if body.selected_text is not None:
        # Selection mode: return only the replacement passage. The editor
        # splices it into the rich-text document and autosaves.
        return SectionEditOut(section_id=body.section_id, content=revised)

    for s in sections:
        if s["id"] == body.section_id:
            s["content"] = revised
    await execute(
        "UPDATE documents SET sections = %s, updated_at = now() WHERE id = %s",
        jsonb(sections),
        document_id,
    )
    return SectionEditOut(section_id=body.section_id, content=revised)


_CITE_GROUP_RE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")


async def _intext_replacements(
    sections: list[dict], papers: list[dict], style: str
) -> dict[str, str]:
    """Map every bracketed marker group in the text to a rendered cite."""
    markers: list[str] = []
    for section in sections:
        markers.extend(
            m.group(0) for m in _CITE_GROUP_RE.finditer(section.get("content") or "")
        )
    unique = list(dict.fromkeys(markers))
    if not unique:
        return {}
    groups = [
        [int(n) for n in marker.strip("[]").replace(" ", "").split(",")]
        for marker in unique
    ]
    rendered = await render_intext(papers, style, groups)
    return {
        marker: text for marker, text in zip(unique, rendered) if text
    }


@router.get("/documents/{document_id}/export")
async def export_document(document_id: str, user_id: str = CurrentUser) -> Response:
    row = await _get_owned_document(document_id, user_id)
    if row["status"] != "ready":
        raise HTTPException(409, "The document is not ready to export yet.")
    papers = await fetch_all(
        "SELECT * FROM papers WHERE run_id = %s AND user_id = %s ORDER BY created_at",
        row["run_id"],
        user_id,
    )
    style = await _effective_style(row, user_id)
    numeric = is_numeric(style)
    papers = [dict(p) for p in papers]
    try:
        references = await render_bibliography(papers, style)
    except Exception:
        references = None
    intext = None
    if not numeric and papers:
        try:
            intext = await _intext_replacements(row["sections"] or [], papers, style)
        except Exception:
            numeric = True  # keep [n] markers rather than fail the export
    data = render_docx(
        {
            "title": row["title"],
            "template": row["template"],
            "authors": row["authors"] or [],
            "sections": row["sections"] or [],
        },
        papers,
        references=references,
        intext=intext,
        numeric=numeric,
    )
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", row["title"]).strip("-").lower()[:60] or "article"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f'attachment; filename="{slug}.docx"',
        },
    )


@router.get("/documents/{document_id}/export-latex")
async def export_document_latex(
    document_id: str, user_id: str = CurrentUser
) -> Response:
    row = await _get_owned_document(document_id, user_id)
    if row["status"] != "ready":
        raise HTTPException(409, "The document is not ready to export yet.")
    papers = await fetch_all(
        "SELECT * FROM papers WHERE run_id = %s AND user_id = %s ORDER BY created_at",
        row["run_id"],
        user_id,
    )
    data = render_project_zip(
        {
            "title": row["title"],
            "template": row["template"],
            "authors": row["authors"] or [],
            "sections": row["sections"] or [],
        },
        [dict(p) for p in papers],
    )
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", row["title"]).strip("-").lower()[:60] or "article"
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{slug}-latex.zip"',
        },
    )


@router.get("/templates")
async def list_templates() -> list[dict]:
    return [
        {
            "id": t.id,
            "label": t.label,
            "description": t.description,
            "latex": True,
        }
        for t in TEMPLATES.values()
    ]
