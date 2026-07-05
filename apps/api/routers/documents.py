import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from citations import catalog
from citations.engine import is_numeric, render_bibliography, render_intext
from db import execute, fetch_all, fetch_one, jsonb
from export.docx_export import render_docx
from export.html_export import render_html
from export.pdf_export import render_pdf
from latex.render import render_project_zip
from latex.templates import TEMPLATES
from llm.client import LlmNotConfigured, resolve_llm
from prefs import LANGUAGES, get_prefs
from models import (
    BibliographyOut,
    DocumentChatIn,
    DocumentChatOut,
    DocumentCreate,
    DocumentListItem,
    DocumentOut,
    DocumentUpdate,
    PaperOut,
    SectionEditIn,
    SectionEditOut,
)
from security import CurrentUser
from writer.generate import (
    PLANNED_SECTION_COUNT,
    cancel_generation,
    run_document_agent,
    run_edit_command,
    start_generation,
)

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
    sections = row["sections"] or []
    return DocumentOut(
        id=str(row["id"]),
        run_id=str(row["run_id"]) if row["run_id"] else None,
        title=row["title"],
        template=row["template"],
        status=row["status"],
        total_sections=(
            PLANNED_SECTION_COUNT if row["status"] == "generating" else len(sections)
        ),
        sections=sections,
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


@router.post("/documents/{document_id}/cancel", response_model=DocumentOut)
async def cancel_document_generation(
    document_id: str, user_id: str = CurrentUser
) -> DocumentOut:
    """Stop generation without destroying anything: sections written so far
    are kept and the document becomes editable."""
    row = await _get_owned_document(document_id, user_id)
    if row["status"] != "generating":
        raise HTTPException(409, "The document is not generating.")
    cancel_generation(document_id)
    await execute(
        "UPDATE documents SET status = 'ready', updated_at = now() WHERE id = %s AND status = 'generating'",
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


def _slug(row: dict) -> str:
    return (
        re.sub(r"[^a-zA-Z0-9]+", "-", row["title"]).strip("-").lower()[:60]
        or "article"
    )


def _doc_payload(row: dict) -> dict:
    return {
        "title": row["title"],
        "template": row["template"],
        "authors": row["authors"] or [],
        "sections": row["sections"] or [],
    }


async def _export_bundle(
    row: dict, user_id: str
) -> tuple[list[dict], str, bool, list[str] | None, dict[str, str] | None]:
    """(papers, style, numeric, references, intext) shared by every export."""
    papers = [
        dict(p)
        for p in await fetch_all(
            "SELECT * FROM papers WHERE run_id = %s AND user_id = %s ORDER BY created_at",
            row["run_id"],
            user_id,
        )
    ]
    style = await _effective_style(row, user_id)
    numeric = is_numeric(style)
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
    return papers, style, numeric, references, intext


async def _exportable(document_id: str, user_id: str) -> dict:
    row = await _get_owned_document(document_id, user_id)
    if row["status"] != "ready":
        raise HTTPException(409, "The document is not ready to export yet.")
    return row


@router.get("/documents/{document_id}/export")
async def export_document(document_id: str, user_id: str = CurrentUser) -> Response:
    row = await _exportable(document_id, user_id)
    papers, _, numeric, references, intext = await _export_bundle(row, user_id)
    data = render_docx(
        _doc_payload(row),
        papers,
        references=references,
        intext=intext,
        numeric=numeric,
    )
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f'attachment; filename="{_slug(row)}.docx"',
        },
    )


@router.get("/documents/{document_id}/export-pdf")
async def export_document_pdf(
    document_id: str, user_id: str = CurrentUser
) -> Response:
    row = await _exportable(document_id, user_id)
    papers, _, numeric, references, intext = await _export_bundle(row, user_id)
    data = render_pdf(
        _doc_payload(row),
        papers,
        references=references,
        intext=intext,
        numeric=numeric,
    )
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{_slug(row)}.pdf"',
        },
    )


@router.get("/documents/{document_id}/export-html")
async def export_document_html(
    document_id: str, user_id: str = CurrentUser
) -> Response:
    row = await _exportable(document_id, user_id)
    papers, _, numeric, references, intext = await _export_bundle(row, user_id)
    data = render_html(
        _doc_payload(row),
        papers,
        references=references,
        intext=intext,
        numeric=numeric,
    )
    return Response(
        content=data,
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{_slug(row)}.html"',
        },
    )


@router.get("/documents/{document_id}/export-doc")
async def export_document_doc(
    document_id: str, user_id: str = CurrentUser
) -> Response:
    """Legacy Word .doc: Word opens HTML documents natively, so this serves
    the HTML render (single-column variant) with the msword content type."""
    row = await _exportable(document_id, user_id)
    papers, _, numeric, references, intext = await _export_bundle(row, user_id)
    data = render_html(
        _doc_payload(row),
        papers,
        references=references,
        intext=intext,
        numeric=numeric,
        word=True,
    )
    return Response(
        content=data,
        media_type="application/msword",
        headers={
            "Content-Disposition": f'attachment; filename="{_slug(row)}.doc"',
        },
    )


@router.get("/documents/{document_id}/bibliography", response_model=BibliographyOut)
async def document_bibliography(
    document_id: str, user_id: str = CurrentUser
) -> BibliographyOut:
    """Rendered reference entries in the document's effective citation style,
    so the editor page can show the reference list exactly as exported."""
    row = await _get_owned_document(document_id, user_id)
    papers, style, numeric, references, _ = await _export_bundle(row, user_id)
    if references is None:
        references = [
            f"{', '.join((p.get('authors') or [])[:6])} "
            f"({p.get('year') or 'n.d.'}). {p['title']}.".strip()
            for p in papers
        ]
    entries = (
        list(references) if numeric else sorted(references, key=str.lower)
    )
    return BibliographyOut(style=style, numeric=numeric, entries=entries)


@router.post("/documents/{document_id}/chat", response_model=DocumentChatOut)
async def document_chat(
    document_id: str, body: DocumentChatIn, user_id: str = CurrentUser
) -> DocumentChatOut:
    """One AI side-panel turn: answer the user and, when asked, edit the
    document (rewrite/insert/delete sections) server-side in the same turn."""
    row = await _get_owned_document(document_id, user_id)
    if row["status"] == "generating":
        raise HTTPException(409, "Wait for generation to finish first.")
    papers = await fetch_all(
        "SELECT * FROM papers WHERE run_id = %s AND user_id = %s ORDER BY created_at",
        row["run_id"],
        user_id,
    )

    # Attached files: pull each owned paper's indexed text (or abstract) as
    # reference material for the agent.
    attachments: list[dict] = []
    for paper_id in body.attachment_paper_ids[:5]:
        paper = await fetch_one(
            "SELECT * FROM papers WHERE id = %s AND user_id = %s",
            paper_id,
            user_id,
        )
        if paper is None:
            continue
        chunks = await fetch_all(
            "SELECT content FROM chunks WHERE paper_id = %s AND user_id = %s ORDER BY id LIMIT 6",
            paper_id,
            user_id,
        )
        text = "\n\n".join(c["content"] for c in chunks) or (
            paper.get("abstract") or ""
        )
        if text.strip():
            attachments.append({"title": paper["title"], "text": text[:6000]})

    try:
        reply, new_sections = await run_document_agent(
            user_id,
            dict(row),
            [dict(p) for p in papers],
            body.message,
            [turn.model_dump() for turn in body.history],
            attachments,
        )
    except LlmNotConfigured as exc:
        raise HTTPException(409, str(exc))

    changed = new_sections is not None
    if changed:
        await execute(
            "UPDATE documents SET sections = %s, updated_at = now() WHERE id = %s",
            jsonb(new_sections),
            document_id,
        )
    updated = await _get_owned_document(document_id, user_id)
    return DocumentChatOut(
        reply=reply,
        changed=changed,
        document=await _document_out(updated, user_id),
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
