from config import get_settings
from sources.base import PaperRecord, normalize_doi
from util.retry import get_with_retry


def _reconstruct_abstract(inverted_index: dict | None) -> str | None:
    if not inverted_index:
        return None
    positions: dict[int, str] = {}
    for word, indexes in inverted_index.items():
        for i in indexes:
            positions[i] = word
    return " ".join(positions[i] for i in sorted(positions)) or None


async def search(query: str, limit: int = 15) -> list[PaperRecord]:
    params = {
        "search": query,
        "per-page": limit,
        "mailto": get_settings().contact_email,
    }
    res = await get_with_retry("https://api.openalex.org/works", params=params)
    res.raise_for_status()
    results = res.json().get("results", [])

    papers: list[PaperRecord] = []
    for work in results:
        title = work.get("display_name")
        if not title:
            continue
        oa_location = work.get("best_oa_location") or {}
        primary = work.get("primary_location") or {}
        source_info = primary.get("source") or {}
        papers.append(
            PaperRecord(
                source="openalex",
                external_id=(work.get("id") or "").rsplit("/", 1)[-1],
                title=title,
                authors=[
                    (a.get("author") or {}).get("display_name") or ""
                    for a in work.get("authorships", [])[:12]
                ],
                year=work.get("publication_year"),
                venue=source_info.get("display_name"),
                doi=normalize_doi(work.get("doi")),
                url=work.get("doi") or primary.get("landing_page_url"),
                abstract=_reconstruct_abstract(work.get("abstract_inverted_index")),
                is_open_access=bool((work.get("open_access") or {}).get("is_oa")),
                oa_pdf_url=oa_location.get("pdf_url"),
                cited_by_count=work.get("cited_by_count") or 0,
            )
        )
    return papers
