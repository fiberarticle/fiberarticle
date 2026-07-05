"""Resolve a DOI to full metadata via Crossref, with OpenAlex fallback."""

import re

from config import get_settings
from sources.base import PaperRecord, normalize_doi
from sources.crossref import _TAG_RE
from util.retry import get_with_retry


async def lookup(doi: str) -> PaperRecord | None:
    doi = normalize_doi(doi) or ""
    if not doi or not re.match(r"^10\.\d{4,9}/\S+$", doi):
        return None

    res = await get_with_retry(
        f"https://api.crossref.org/works/{doi}",
        params={"mailto": get_settings().contact_email},
    )
    if res.status_code == 200:
        item = res.json().get("message", {})
        titles = item.get("title") or []
        if titles:
            authors = [
                " ".join(p for p in [a.get("given"), a.get("family")] if p)
                for a in item.get("author", [])[:20]
            ]
            issued = (item.get("issued") or {}).get("date-parts") or [[None]]
            year = issued[0][0] if issued and issued[0] else None
            abstract = item.get("abstract")
            if abstract:
                abstract = " ".join(_TAG_RE.sub(" ", abstract).split()) or None
            container = item.get("container-title") or []
            return PaperRecord(
                source="doi",
                external_id=doi,
                title=" ".join(titles[0].split()),
                authors=[a for a in authors if a],
                year=year if isinstance(year, int) else None,
                venue=container[0] if container else None,
                doi=doi,
                url=item.get("URL") or f"https://doi.org/{doi}",
                abstract=abstract,
                is_open_access=False,
                oa_pdf_url=None,
                cited_by_count=item.get("is-referenced-by-count") or 0,
                issn=(item.get("ISSN") or [None])[0],
            )

    # Fallback: OpenAlex knows most DOIs Crossref rejects (e.g. DataCite).
    res = await get_with_retry(
        f"https://api.openalex.org/works/https://doi.org/{doi}",
        params={"mailto": get_settings().contact_email},
    )
    if res.status_code != 200:
        return None
    work = res.json()
    title = work.get("display_name")
    if not title:
        return None
    oa_location = work.get("best_oa_location") or {}
    return PaperRecord(
        source="doi",
        external_id=doi,
        title=title,
        authors=[
            (a.get("author") or {}).get("display_name") or ""
            for a in work.get("authorships", [])[:20]
        ],
        year=work.get("publication_year"),
        venue=((work.get("primary_location") or {}).get("source") or {}).get(
            "display_name"
        ),
        doi=doi,
        url=f"https://doi.org/{doi}",
        abstract=None,
        is_open_access=bool((work.get("open_access") or {}).get("is_oa")),
        oa_pdf_url=oa_location.get("pdf_url"),
        cited_by_count=work.get("cited_by_count") or 0,
        issn=((work.get("primary_location") or {}).get("source") or {}).get("issn_l"),
    )
