"""AI Search: question-aware multi-source paper discovery with an optional
research-backed synthesized answer, in the Paperguide style.
"""

import asyncio
import json
import re

from fastapi import APIRouter, HTTPException

from citations.quartiles import annotate_quartiles
from db import fetch_all
from llm.client import LlmNotConfigured, resolve_llm
from models import PaperAddIn, SearchIn, SearchResultOut
from prefs import language_instruction
from security import CurrentUser
from sources import arxiv, crossref, openalex, semantic_scholar
from sources.base import PaperRecord

router = APIRouter(prefix="/v1/search", tags=["search"])


def _parse_json_array(text: str) -> list | None:
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, list) else None
    except json.JSONDecodeError:
        return None


async def _sub_queries(llm, query: str) -> list[str]:
    try:
        text = await llm.complete(
            [
                {
                    "role": "system",
                    "content": (
                        "Break a research question into 2 to 4 short keyword "
                        "queries for scholarly search engines (3-8 words each, "
                        "no boolean operators). Respond with ONLY a JSON array "
                        "of strings."
                    ),
                },
                {"role": "user", "content": query},
            ],
            max_tokens=200,
        )
        parsed = _parse_json_array(text)
        if parsed:
            return [str(q) for q in parsed][:4]
    except Exception:
        pass
    return [query]


_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does",
    "for", "from", "has", "have", "how", "in", "is", "it", "of", "on", "or",
    "than", "that", "the", "their", "there", "this", "to", "vs", "was",
    "what", "when", "which", "why", "with",
}


def _query_terms(query: str) -> set[str]:
    return {
        w for w in re.findall(r"[a-z0-9]+", query.lower())
        if len(w) > 2 and w not in _STOPWORDS
    }


def _relevance(paper: PaperRecord, terms: set[str]) -> float:
    """Fraction of query terms present in the title/abstract. Title hits count
    double so on-topic papers beat papers that merely mention a term once."""
    if not terms:
        return 0.0
    title = (paper.get("title") or "").lower()
    abstract = (paper.get("abstract") or "").lower()
    title_hits = sum(1 for t in terms if t in title)
    abstract_hits = sum(1 for t in terms if t in abstract)
    return (2 * title_hits + abstract_hits) / (3 * len(terms))


def _dedupe_rank(
    candidates: list[PaperRecord], query: str, limit: int = 25
) -> list[PaperRecord]:
    seen: set[str] = set()
    unique: list[PaperRecord] = []
    for paper in candidates:
        key = paper.get("doi") or re.sub(r"\W+", "", (paper.get("title") or "").lower())
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(paper)

    # Relevance to the question comes first; open-access availability must
    # never outrank it (an OA paper about the wrong topic is useless).
    # Citations break ties among comparably relevant papers.
    terms = _query_terms(query)
    scored = [(_relevance(p, terms), p) for p in unique]
    if any(score > 0 for score, _ in scored):
        scored = [(score, p) for score, p in scored if score > 0]
    scored.sort(
        key=lambda item: (
            round(item[0], 2),
            min(item[1].get("cited_by_count") or 0, 100_000),
            1 if (item[1].get("is_open_access") or item[1].get("oa_pdf_url")) else 0,
        ),
        reverse=True,
    )
    return [p for _, p in scored[:limit]]


async def _synthesize_answer(
    llm, query: str, papers: list[PaperRecord], language: str = ""
) -> tuple[str, list[int]]:
    top = [p for p in papers if p.get("abstract")][:10]
    if not top:
        return "", []
    digest = "\n\n".join(
        f"[{i + 1}] {p['title']} ({p.get('year') or 'n.d.'})\n{(p.get('abstract') or '')[:700]}"
        for i, p in enumerate(top)
    )
    answer = await llm.complete(
        [
            {
                "role": "system",
                "content": (
                    "Answer the research question using ONLY the numbered paper "
                    "abstracts provided. Cite claims with bracketed numbers like "
                    "[2]. Be balanced: note agreement, disagreement, and gaps. "
                    "2 to 4 paragraphs. Plain prose only: no headings and no "
                    "markdown formatting such as ** or bullet lists. If the "
                    "abstracts cannot answer the question, say so plainly."
                    + language
                ),
            },
            {"role": "user", "content": f"Question: {query}\n\nPapers:\n{digest}"},
        ],
        max_tokens=800,
    )
    used = sorted(
        {int(n) for n in re.findall(r"\[(\d+)\]", answer) if 0 < int(n) <= len(top)}
    )
    return answer.strip(), used


@router.post("", response_model=SearchResultOut)
async def search_papers(body: SearchIn, user_id: str = CurrentUser) -> SearchResultOut:
    try:
        llm = await resolve_llm(user_id)
    except LlmNotConfigured as exc:
        raise HTTPException(409, str(exc))

    queries = await _sub_queries(llm, body.query)

    # A rate-limited source (arXiv and Semantic Scholar throttle hard) must
    # not stall the whole search; bound each source by a time budget and
    # keep whatever partial results arrived.
    _SOURCE_BUDGET = 30.0
    _PER_QUERY_TIMEOUT = 20.0

    async def run_source(fn) -> list[PaperRecord]:
        found: list[PaperRecord] = []
        loop = asyncio.get_event_loop()
        deadline = loop.time() + _SOURCE_BUDGET
        for q in queries:
            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            try:
                found.extend(
                    await asyncio.wait_for(
                        fn(q, limit=8),
                        timeout=min(_PER_QUERY_TIMEOUT, remaining),
                    )
                )
            except Exception:
                continue
        return found

    results = await asyncio.gather(
        run_source(arxiv.search),
        run_source(openalex.search),
        run_source(semantic_scholar.search),
        run_source(crossref.search),
    )
    candidates = [p for source_results in results for p in source_results]

    if body.year_from:
        candidates = [
            p for p in candidates if (p.get("year") or 0) >= body.year_from
        ]
    if body.year_to:
        candidates = [
            p for p in candidates if (p.get("year") or 9999) <= body.year_to
        ]
    if body.open_access_only:
        candidates = [
            p for p in candidates if p.get("is_open_access") or p.get("oa_pdf_url")
        ]
    if body.full_text_only:
        # A reachable open-access PDF is what makes full-text reading possible.
        candidates = [p for p in candidates if p.get("oa_pdf_url")]
    if body.min_citations:
        candidates = [
            p for p in candidates if (p.get("cited_by_count") or 0) >= body.min_citations
        ]

    if body.quartiles:
        # Quartile filtering needs journal ranks before ranking; papers from
        # unranked venues are excluded when the filter is active.
        await annotate_quartiles(candidates)
        wanted = set(body.quartiles)
        candidates = [p for p in candidates if p.get("quartile") in wanted]

    ranked = _dedupe_rank(candidates, body.query)
    await annotate_quartiles(ranked)
    if not ranked:
        return SearchResultOut(
            results=[],
            answer=None,
            answer_sources=[],
            sub_queries=queries,
            in_library_dois=[],
        )

    answer = None
    answer_sources: list[int] = []
    if body.answer:
        try:
            language = await language_instruction(user_id)
            answer, answer_sources = await _synthesize_answer(
                llm, body.query, ranked, language
            )
            answer = answer or None
        except Exception:
            answer = None

    dois = [p["doi"] for p in ranked if p.get("doi")]
    in_library = []
    if dois:
        rows = await fetch_all(
            "SELECT doi FROM papers WHERE user_id = %s AND doi = ANY(%s)",
            user_id,
            dois,
        )
        in_library = [r["doi"] for r in rows]

    return SearchResultOut(
        results=[PaperAddIn(**{**p, "source": p.get("source") or "search"}) for p in ranked],
        answer=answer,
        answer_sources=answer_sources,
        sub_queries=queries,
        in_library_dois=in_library,
    )
