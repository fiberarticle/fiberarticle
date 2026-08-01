from sources.base import PaperRecord, clean_text, normalize_doi
from util.retry import get_with_retry

_FIELDS = (
    "title,abstract,year,venue,authors,externalIds,url,"
    "isOpenAccess,openAccessPdf,citationCount"
)


async def search(query: str, limit: int = 15) -> list[PaperRecord]:
    params = {"query": query, "limit": limit, "fields": _FIELDS}
    res = await get_with_retry(
        "https://api.semanticscholar.org/graph/v1/paper/search",
        params=params,
        base_delay=2.0,
    )
    # Semantic Scholar rate-limits unauthenticated clients aggressively;
    # after retries, treat 429 as an empty result rather than failing the search.
    if res.status_code == 429:
        return []
    res.raise_for_status()
    data = res.json().get("data", [])

    papers: list[PaperRecord] = []
    for item in data:
        title = clean_text(item.get("title"))
        if not title:
            continue
        external_ids = item.get("externalIds") or {}
        oa_pdf = (item.get("openAccessPdf") or {}).get("url")
        pmid = external_ids.get("PubMed")
        papers.append(
            PaperRecord(
                source="semantic_scholar",
                external_id=item.get("paperId") or "",
                title=title,
                authors=[a.get("name") or "" for a in (item.get("authors") or [])[:12]],
                year=item.get("year"),
                venue=clean_text(item.get("venue")),
                doi=normalize_doi(external_ids.get("DOI")),
                url=item.get("url"),
                abstract=clean_text(item.get("abstract")),
                is_open_access=bool(item.get("isOpenAccess")),
                oa_pdf_url=oa_pdf,
                cited_by_count=item.get("citationCount") or 0,
                pmid=str(pmid) if pmid else None,
            )
        )
    return papers
