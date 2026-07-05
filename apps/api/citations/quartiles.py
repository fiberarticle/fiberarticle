"""Scimago quartile lookup for papers: ISSN first, journal title fallback.

journal_ranks is seeded by scripts/seed_journal_ranks.py. Lookups run per
search-result batch, so both paths hit indexed columns.
"""

import re

from db import fetch_all

_QUARTILES = ("Q1", "Q2", "Q3", "Q4")


def _norm_issn(issn: str | None) -> str | None:
    if not issn:
        return None
    cleaned = re.sub(r"[^0-9Xx]", "", issn).upper()
    return cleaned if len(cleaned) == 8 else None


def _norm_title(title: str | None) -> str | None:
    if not title:
        return None
    normalized = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()
    return normalized or None


async def annotate_quartiles(papers: list[dict]) -> None:
    """Fill paper['quartile'] in place for every paper we can match."""
    issns = {n for p in papers if (n := _norm_issn(p.get("issn")))}
    titles = {t for p in papers if (t := _norm_title(p.get("venue")))}

    by_issn: dict[str, str] = {}
    if issns:
        rows = await fetch_all(
            "SELECT issn, best_quartile FROM journal_ranks WHERE issn = ANY(%s)",
            list(issns),
        )
        by_issn = {r["issn"]: r["best_quartile"] for r in rows}

    by_title: dict[str, str] = {}
    if titles:
        rows = await fetch_all(
            "SELECT norm_title, best_quartile FROM journal_ranks WHERE norm_title = ANY(%s)",
            list(titles),
        )
        by_title = {r["norm_title"]: r["best_quartile"] for r in rows}

    for paper in papers:
        quartile = by_issn.get(_norm_issn(paper.get("issn")) or "")
        if quartile is None:
            quartile = by_title.get(_norm_title(paper.get("venue")) or "")
        if quartile in _QUARTILES:
            paper["quartile"] = quartile


async def lookup(issn: str | None, venue: str | None) -> str | None:
    paper: dict = {"issn": issn, "venue": venue}
    await annotate_quartiles([paper])
    return paper.get("quartile")
