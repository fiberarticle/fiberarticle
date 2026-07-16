"""Citation style catalog search for the style picker."""

from fastapi import APIRouter, Query
from pydantic import BaseModel

from citations import catalog
from security import CurrentUser

router = APIRouter(prefix="/v1/citations", tags=["citations"])


class StyleOut(BaseModel):
    id: str
    title: str
    format: str | None = None


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
