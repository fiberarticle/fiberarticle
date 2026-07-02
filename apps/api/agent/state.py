from typing import Any, TypedDict

from sources.base import PaperRecord


class ResearchState(TypedDict, total=False):
    run_id: str
    user_id: str
    topic: str
    papers_per_run: int

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
