import re

from config import get_settings
from sources.base import PaperRecord, normalize_doi
from util.retry import get_with_retry

_TAG_RE = re.compile(r"<[^>]+>")


async def search(query: str, limit: int = 15) -> list[PaperRecord]:
    params = {
        "query": query,
        "rows": limit,
        "select": "DOI,title,author,issued,container-title,URL,abstract,is-referenced-by-count",
        "mailto": get_settings().contact_email,
    }
    res = await get_with_retry("https://api.crossref.org/works", params=params)
    res.raise_for_status()
    items = res.json().get("message", {}).get("items", [])

    papers: list[PaperRecord] = []
    for item in items:
        titles = item.get("title") or []
        if not titles:
            continue
        authors = [
            " ".join(part for part in [a.get("given"), a.get("family")] if part)
            for a in item.get("author", [])[:12]
        ]
        issued = (item.get("issued") or {}).get("date-parts") or [[None]]
        year = issued[0][0] if issued and issued[0] else None
        abstract = item.get("abstract")
        if abstract:
            abstract = " ".join(_TAG_RE.sub(" ", abstract).split()) or None
        container = item.get("container-title") or []
        papers.append(
            PaperRecord(
                source="crossref",
                external_id=item.get("DOI") or "",
                title=" ".join(titles[0].split()),
                authors=[a for a in authors if a],
                year=year if isinstance(year, int) else None,
                venue=container[0] if container else None,
                doi=normalize_doi(item.get("DOI")),
                url=item.get("URL"),
                abstract=abstract,
                is_open_access=False,
                oa_pdf_url=None,
                cited_by_count=item.get("is-referenced-by-count") or 0,
            )
        )
    return papers
