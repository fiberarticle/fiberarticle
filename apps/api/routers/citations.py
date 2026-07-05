"""Citation style catalog search, bibliography rendering, and previews."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from citations import catalog
from citations.engine import StyleNotFound, render_bibliography
from db import fetch_all
from security import CurrentUser

router = APIRouter(prefix="/v1/citations", tags=["citations"])


class StyleOut(BaseModel):
    id: str
    title: str
    format: str | None = None


class BibliographyIn(BaseModel):
    paper_ids: list[str] = Field(min_length=1, max_length=200)
    style: str = Field(min_length=1, max_length=120)


class PreviewIn(BaseModel):
    style: str = Field(min_length=1, max_length=120)


# A recognizable sample so users can judge a style at a glance.
_SAMPLE_PAPER = {
    "title": "Attention is all you need",
    "authors": ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
    "year": 2017,
    "venue": "Advances in Neural Information Processing Systems",
    "doi": "10.48550/arXiv.1706.03762",
}


def _style_out(entry: dict) -> StyleOut:
    return StyleOut(
        id=entry["id"],
        title=entry["title"],
        format=catalog.style_format(entry["id"]),
    )


@router.get("/styles", response_model=list[StyleOut])
async def search_styles(
    q: str = Query(default="", max_length=200),
    user_id: str = CurrentUser,
) -> list[StyleOut]:
    return [_style_out(e) for e in catalog.search(q, limit=50)]


@router.post("/preview")
async def preview_style(body: PreviewIn, user_id: str = CurrentUser) -> dict:
    if catalog.entry(body.style) is None:
        raise HTTPException(422, "Unknown citation style.")
    try:
        entries = await render_bibliography([_SAMPLE_PAPER], body.style)
    except StyleNotFound as exc:
        raise HTTPException(422, str(exc))
    except Exception:
        raise HTTPException(502, "That style could not be rendered.")
    return {"style": body.style, "preview": entries[0] if entries else ""}


@router.post("/bibliography")
async def bibliography(body: BibliographyIn, user_id: str = CurrentUser) -> dict:
    if catalog.entry(body.style) is None:
        raise HTTPException(422, "Unknown citation style.")
    rows = await fetch_all(
        "SELECT * FROM papers WHERE user_id = %s AND id = ANY(%s::uuid[]) ORDER BY created_at",
        user_id,
        body.paper_ids,
    )
    if not rows:
        raise HTTPException(404, "No matching papers.")
    try:
        entries = await render_bibliography([dict(r) for r in rows], body.style)
    except StyleNotFound as exc:
        raise HTTPException(422, str(exc))
    return {
        "style": body.style,
        "entries": [
            {"paper_id": str(row["id"]), "citation": entry}
            for row, entry in zip(rows, entries)
        ],
    }
