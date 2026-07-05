from typing import Any, TypedDict

from sources.base import PaperRecord


class ResearchState(TypedDict, total=False):
    run_id: str
    user_id: str
    topic: str
    papers_per_run: int
    # 'research' (default) or 'literature_review'
    mode: str
    # year_from/year_to/quartiles/open_access_only/min_citations from RunFilters
    filters: dict[str, Any]
    # User's inclusion/exclusion criteria applied during screening.
    criteria: str

    plan: list[str]
    queries: list[str]
    used_queries: list[str]
    candidates: list[PaperRecord]
    papers: list[dict[str, Any]]
    loops: int
    coverage_ok: bool
    findings: list[str]
    sections: list[dict[str, str]]
    report: str
