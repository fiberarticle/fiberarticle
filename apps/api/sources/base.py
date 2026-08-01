"""Shared paper record shape returned by every source connector."""

import html
import re
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
    # PubMed id when the index reports one; used to prove PubMed coverage.
    pmid: str | None


# Block-level markup separates words and must become a space; inline
# emphasis sits inside a word ("<em>Index</em>-<em>RAG</em>") and must not.
_BLOCK_TAG_RE = re.compile(
    r"</?(?:jats:)?(?:p|div|br|hr|li|ul|ol|sec|title|abstract|list|list-item|td|tr|th)\b[^>]*>",
    re.IGNORECASE,
)
_TAG_RE = re.compile(r"<[^>]+>")


def clean_text(value: str | None) -> str | None:
    """Plain text from an index field.

    Crossref and OpenAlex ship JATS markup inside titles and abstracts, and
    it often arrives escaped (``&lt;em&gt;``) or double escaped. Unescaping
    twice and then stripping tags turns every variant back into readable
    prose instead of leaking markup into the review matrix.
    """
    if not value:
        return None
    text = html.unescape(html.unescape(value))
    text = _BLOCK_TAG_RE.sub(" ", text)
    text = _TAG_RE.sub("", text)
    return " ".join(text.split()) or None


def normalize_doi(doi: str | None) -> str | None:
    if not doi:
        return None
    doi = doi.strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if doi.startswith(prefix):
            doi = doi[len(prefix):]
    return doi or None
