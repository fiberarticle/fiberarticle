"""CSL rendering engine on citeproc-py.

Style resolution order:
1. bundled csl/<id>.csl (the ~60 popular styles committed to the repo)
2. disk cache csl/cache/<id>.csl (anything fetched before)
3. jsDelivr CDN fetch (independent path, then dependent/), cached to disk

Dependent styles (journal aliases) contain no formatting rules; their
independent parent is resolved and used for rendering. Parsed styles are kept
in an in-process LRU because parsing a large .csl takes ~100ms.
"""

import re
import warnings
from functools import lru_cache
from pathlib import Path

import httpx
from citeproc import (
    Citation,
    CitationItem,
    CitationStylesBibliography,
    CitationStylesStyle,
    formatter,
)
from citeproc.source.json import CiteProcJSON

from citations.catalog import CSL_DIR, entry, style_format

CACHE_DIR = CSL_DIR / "cache"
_CDN = "https://cdn.jsdelivr.net/gh/citation-style-language/styles@master"
# Attribute order varies across styles; match the tag, then pull href.
_PARENT_LINK_RE = re.compile(r'<link\b[^>]*rel="independent-parent"[^>]*>')
_HREF_RE = re.compile(r'href="[^"]*/styles/([^"/]+)"')


def _parent_id(xml: str) -> str | None:
    tag = _PARENT_LINK_RE.search(xml)
    if not tag:
        return None
    href = _HREF_RE.search(tag.group(0))
    return href.group(1) if href else None


class StyleNotFound(Exception):
    pass


def _local_path(style_id: str) -> Path | None:
    bundled = CSL_DIR / f"{style_id}.csl"
    if bundled.exists():
        return bundled
    cached = CACHE_DIR / f"{style_id}.csl"
    if cached.exists():
        return cached
    return None


async def _fetch_style(style_id: str) -> Path:
    CACHE_DIR.mkdir(exist_ok=True)
    target = CACHE_DIR / f"{style_id}.csl"
    async with httpx.AsyncClient(timeout=30) as client:
        for path in (f"{style_id}.csl", f"dependent/{style_id}.csl"):
            response = await client.get(f"{_CDN}/{path}")
            if response.status_code == 200:
                target.write_bytes(response.content)
                return target
    raise StyleNotFound(f"Citation style '{style_id}' could not be fetched.")


async def resolve_style_path(style_id: str, _depth: int = 0) -> Path:
    """Path of an INDEPENDENT .csl usable for rendering."""
    if _depth > 2 or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", style_id):
        raise StyleNotFound(f"Unknown citation style '{style_id}'.")
    path = _local_path(style_id)
    if path is None:
        meta = entry(style_id)
        if meta is None:
            raise StyleNotFound(f"Unknown citation style '{style_id}'.")
        # Known dependents can skip a fetch entirely.
        if meta.get("parent"):
            return await resolve_style_path(meta["parent"], _depth + 1)
        path = await _fetch_style(style_id)
    parent = _parent_id(path.read_text(encoding="utf-8", errors="replace"))
    if parent:
        return await resolve_style_path(parent, _depth + 1)
    return path


@lru_cache(maxsize=64)
def _parsed_style(path_str: str) -> CitationStylesStyle:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return CitationStylesStyle(path_str, validate=False)


def _split_author(author: str) -> dict:
    parts = author.strip().split()
    if len(parts) >= 2:
        return {"family": parts[-1], "given": " ".join(parts[:-1])}
    return {"family": author.strip() or "Unknown"}


def to_csl_json(papers: list[dict]) -> list[dict]:
    items = []
    for i, paper in enumerate(papers):
        item: dict = {
            "id": f"ref{i + 1}",
            "type": "article-journal",
            "title": paper.get("title") or "Untitled",
        }
        authors = paper.get("authors") or []
        if authors:
            item["author"] = [_split_author(a) for a in authors[:30]]
        if paper.get("year"):
            item["issued"] = {"date-parts": [[int(paper["year"])]]}
        if paper.get("venue"):
            item["container-title"] = paper["venue"]
        if paper.get("doi"):
            item["DOI"] = paper["doi"]
        if paper.get("url"):
            item["URL"] = paper["url"]
        items.append(item)
    return items


def _clean(text: str) -> str:
    """Normalize citeproc-py plain output.

    citeproc-py occasionally drops the space around name delimiters and
    year/title affixes ("Perezand A.", "E.& Piktus", "Piktus2020"). These
    fixes are generic gluing repairs, not style rules.
    """
    text = re.sub(r"\s+", " ", str(text)).strip()
    text = re.sub(r"(?<=[a-z.])&(?=\s?[A-Z])", " &", text)
    text = re.sub(r"(?<=[a-z.])and(?= [A-Z])", " and", text)
    text = re.sub(r"(?<=[a-z])(?=\d{4})", " ", text)
    text = re.sub(r"(?<=\d)(?=[“\"'(])", " ", text)
    text = re.sub(r"(?<=[”\"])(?=[A-Z(])", " ", text)
    text = re.sub(r"\.\.(?=\s|$)", ".", text)
    return re.sub(r"\s{2,}", " ", text)


def _build_bibliography(
    style_path: Path, papers: list[dict]
) -> tuple[CitationStylesBibliography, list[Citation]]:
    source = CiteProcJSON(to_csl_json(papers))
    bibliography = CitationStylesBibliography(
        _parsed_style(str(style_path)), source, formatter.plain
    )
    citations = [
        Citation([CitationItem(f"ref{i + 1}")]) for i in range(len(papers))
    ]
    for citation in citations:
        bibliography.register(citation)
    return bibliography, citations


_LEADING_NUMBER_RE = re.compile(r"^(?:\[\d+\]|\(\d+\)|\d+\.?)\s*")


async def render_bibliography(papers: list[dict], style_id: str) -> list[str]:
    """Formatted reference-list entries, one per paper, input order.

    Numeric styles emit their own leading number ("[1] ...", "1. ..."); it is
    stripped so every consumer (UI lists, docx, copy actions) controls its own
    numbering consistently.
    """
    if not papers:
        return []
    style_path = await resolve_style_path(style_id)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        bibliography, _ = _build_bibliography(style_path, papers)
        entries = [
            _LEADING_NUMBER_RE.sub("", _clean(item))
            for item in bibliography.bibliography()
        ]
    # citeproc-py emits entries in registration order, which is input order.
    return entries


async def render_intext(
    papers: list[dict], style_id: str, groups: list[list[int]]
) -> list[str]:
    """In-text citation strings for groups of 1-based paper numbers.

    Example: groups=[[1], [2, 5]] -> ["(Lewis, 2020)", "(Perez, 2021; Wu, 2019)"]
    """
    style_path = await resolve_style_path(style_id)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        source = CiteProcJSON(to_csl_json(papers))
        bibliography = CitationStylesBibliography(
            _parsed_style(str(style_path)), source, formatter.plain
        )
        results = []
        for group in groups:
            valid = [n for n in group if 1 <= n <= len(papers)]
            if not valid:
                results.append("")
                continue
            citation = Citation([CitationItem(f"ref{n}") for n in valid])
            bibliography.register(citation)
            results.append(_clean(bibliography.cite(citation, lambda item: None)))
    return results


def is_numeric(style_id: str) -> bool:
    return (style_format(style_id) or "numeric") in ("numeric", "label")
