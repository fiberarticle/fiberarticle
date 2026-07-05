"""Shared paper record shape returned by every source connector."""

from typing import TypedDict


class PaperRecord(TypedDict, total=False):
    source: str
    external_id: str
    title: str
    authors: list[str]
    year: int | None
    venue: str | None
    doi: str | None
    url: str | None
    abstract: str | None
    is_open_access: bool
    oa_pdf_url: str | None
    cited_by_count: int
    issn: str | None
    quartile: str | None


def normalize_doi(doi: str | None) -> str | None:
    if not doi:
        return None
    doi = doi.strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if doi.startswith(prefix):
            doi = doi[len(prefix):]
    return doi or None
