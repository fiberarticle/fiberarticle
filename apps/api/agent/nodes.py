"""Research graph nodes.

Each node is a small, deterministic stage. LLM calls happen through the
ResolvedLlm bound at graph build time. Every node narrates its work through
the run event log so the UI can show real transparency, not just stage markers.
"""

import asyncio
import json
import re
from typing import Any

import httpx

from agent.events import emit, set_stage
from agent.state import ResearchState
from db import execute, fetch_all, jsonb
from llm.client import ResolvedLlm
from rag.chunking import chunk_text
from rag.embeddings import embed_query, embed_texts
from sources import arxiv, crossref, openalex, semantic_scholar, unpaywall
from sources.base import PaperRecord

_MAX_PDF_BYTES = 15 * 1024 * 1024
_PDF_CONCURRENCY = 4


def _parse_json_array(text: str) -> list | None:
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, list) else None
    except json.JSONDecodeError:
        return None


class ResearchNodes:
    def __init__(self, run_id: str, user_id: str, llm: ResolvedLlm):
        self.run_id = run_id
        self.user_id = user_id
        self.llm = llm

    async def _emit(self, stage: str, message: str, type: str = "info", data: dict | None = None):
        await emit(self.run_id, self.user_id, stage, message, type, data)

    async def _stage(self, stage: str):
        await set_stage(self.run_id, stage)

    # ------------------------------------------------------------- plan
    async def plan(self, state: ResearchState) -> dict:
        await self._stage("plan")
        topic = state["topic"]
        await self._emit("plan", f"Reading the topic and drafting a research plan: \"{topic}\"")
        text = await self.llm.complete(
            [
                {
                    "role": "system",
                    "content": (
                        "You are a research planner. Given a topic, produce 3 to 5 focused "
                        "research questions that a literature review must answer. "
                        "Respond with ONLY a JSON array of strings."
                    ),
                },
                {"role": "user", "content": topic},
            ],
            max_tokens=500,
        )
        plan = _parse_json_array(text)
        if not plan:
            plan = [topic]
            await self._emit(
                "plan",
                "The model reply was not valid JSON; falling back to the topic as a single research question.",
                type="warning",
            )
        plan = [str(q) for q in plan][:5]
        for i, question in enumerate(plan, 1):
            await self._emit("plan", f"Research question {i}: {question}")
        return {"plan": plan, "loops": 0, "used_queries": [], "candidates": []}

    # -------------------------------------------------- generate_queries
    async def generate_queries(self, state: ResearchState) -> dict:
        await self._stage("generate_queries")
        used = state.get("used_queries", [])
        note = (
            f" Avoid repeating these earlier queries: {json.dumps(used)}." if used else ""
        )
        await self._emit(
            "generate_queries",
            "Turning the research plan into scholarly search queries."
            + (" This is a follow-up pass to fill coverage gaps." if used else ""),
        )
        text = await self.llm.complete(
            [
                {
                    "role": "system",
                    "content": (
                        "You write search queries for scholarly indexes (arXiv, OpenAlex, "
                        "Semantic Scholar, Crossref). Given a topic and research questions, "
                        "produce 4 to 6 short keyword queries (3-8 words each), no boolean "
                        f"operators.{note} Respond with ONLY a JSON array of strings."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Topic: {state['topic']}\nResearch questions: {json.dumps(state.get('plan', []))}",
                },
            ],
            max_tokens=400,
        )
        queries = _parse_json_array(text)
        if not queries:
            queries = [state["topic"]]
            await self._emit(
                "generate_queries",
                "The model reply was not valid JSON; searching with the raw topic instead.",
                type="warning",
            )
        queries = [str(q) for q in queries][:6]
        for q in queries:
            await self._emit("generate_queries", f"Search query: \"{q}\"")
        return {"queries": queries, "used_queries": used + queries}

    # -------------------------------------------------------------- search
    async def search(self, state: ResearchState) -> dict:
        await self._stage("search")
        queries = state.get("queries", [state["topic"]])
        connectors = [
            ("arXiv", arxiv.search),
            ("OpenAlex", openalex.search),
            ("Semantic Scholar", semantic_scholar.search),
            ("Crossref", crossref.search),
        ]
        await self._emit(
            "search",
            f"Fanning out {len(queries)} queries across arXiv, OpenAlex, Semantic Scholar, and Crossref in parallel.",
        )

        # A single rate-limited source (Semantic Scholar and arXiv throttle
        # unauthenticated clients hard, sometimes with long Retry-After waits)
        # must never stall the whole fan-out. Bound each source by an overall
        # time budget and each query by its own timeout, keeping whatever
        # partial results arrived before the budget ran out.
        per_query_timeout = 25.0
        source_budget = 45.0

        async def run_source(name: str, fn) -> list[PaperRecord]:
            found: list[PaperRecord] = []
            loop = asyncio.get_event_loop()
            deadline = loop.time() + source_budget
            for query in queries:
                if loop.time() >= deadline:
                    await self._emit(
                        "search",
                        f"{name} hit its {source_budget:.0f}s budget; continuing with {len(found)} results so far.",
                        type="warning",
                    )
                    break
                try:
                    results = await asyncio.wait_for(
                        fn(query, limit=10),
                        timeout=min(per_query_timeout, max(1.0, deadline - loop.time())),
                    )
                    found.extend(results)
                except asyncio.TimeoutError:
                    await self._emit(
                        "search",
                        f"{name} timed out on \"{query}\"; skipping it.",
                        type="warning",
                    )
                except Exception as exc:
                    await self._emit(
                        "search",
                        f"{name} failed for \"{query}\": {exc}",
                        type="warning",
                    )
            sample = ", ".join(f"\"{p['title'][:70]}\"" for p in found[:2])
            await self._emit(
                "search",
                f"{name} returned {len(found)} results." + (f" First hits: {sample}" if sample else ""),
                data={"source": name, "count": len(found)},
            )
            return found

        results = await asyncio.gather(*(run_source(n, f) for n, f in connectors))
        new_candidates = [p for source_results in results for p in source_results]
        candidates = state.get("candidates", []) + new_candidates
        await self._emit(
            "search",
            f"Search pass complete: {len(new_candidates)} new records, {len(candidates)} total candidates.",
        )
        return {"candidates": candidates}

    # -------------------------------------------------------- dedupe_rank
    async def dedupe_rank(self, state: ResearchState) -> dict:
        await self._stage("dedupe_rank")
        candidates = state.get("candidates", [])
        await self._emit(
            "dedupe_rank",
            f"Deduplicating {len(candidates)} candidates by DOI and normalized title.",
        )
        seen: set[str] = set()
        unique: list[PaperRecord] = []
        for paper in candidates:
            key = paper.get("doi") or re.sub(r"\W+", "", (paper.get("title") or "").lower())
            if not key or key in seen:
                continue
            seen.add(key)
            unique.append(paper)

        # Rank by topical relevance first so the screening budget is spent on
        # on-topic papers; open access and citations only break ties.
        terms = {
            w
            for w in re.findall(r"[a-z0-9]+", state["topic"].lower())
            if len(w) > 2
        }

        def score(p: PaperRecord) -> tuple:
            text = ((p.get("title") or "") + " " + (p.get("abstract") or "")).lower()
            hits = sum(1 for t in terms if t in text)
            return (
                round(hits / len(terms), 2) if terms else 0,
                min(p.get("cited_by_count") or 0, 100_000),
                1 if (p.get("is_open_access") or p.get("oa_pdf_url")) else 0,
            )

        unique.sort(key=score, reverse=True)
        cap = state["papers_per_run"] * 3
        kept = unique[:cap]
        await self._emit(
            "dedupe_rank",
            f"{len(unique)} unique papers after deduplication; keeping the top {len(kept)} "
            "ranked by open-access availability and citation count.",
        )
        return {"candidates": kept}

    # -------------------------------------------------------------- screen
    async def screen(self, state: ResearchState) -> dict:
        await self._stage("screen")
        existing = state.get("papers", [])
        existing_keys = {
            (p.get("doi") or re.sub(r"\W+", "", (p.get("title") or "").lower()))
            for p in existing
        }
        candidates = [
            c
            for c in state.get("candidates", [])
            if (c.get("doi") or re.sub(r"\W+", "", (c.get("title") or "").lower()))
            not in existing_keys
        ]
        limit = max(0, state["papers_per_run"] - len(existing))
        if limit == 0:
            await self._emit("screen", "Paper budget already met; skipping screening.")
            return {"papers": existing}
        await self._emit(
            "screen",
            f"Screening {len(candidates)} candidates for relevance; keeping at most {limit}.",
        )
        catalog = "\n".join(
            f"{i}. {p['title']}" + (f" ({(p.get('abstract') or '')[:200]})" if p.get("abstract") else "")
            for i, p in enumerate(candidates)
        )
        kept_indexes: list[int] | None = None
        try:
            text = await self.llm.complete(
                [
                    {
                        "role": "system",
                        "content": (
                            "You screen papers for a literature review. Given a topic, research "
                            "questions, and a numbered candidate list, return the indexes of papers "
                            f"directly relevant to the topic, best first, at most {limit}. "
                            "Respond with ONLY a JSON array of integers."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Topic: {state['topic']}\n"
                            f"Research questions: {json.dumps(state.get('plan', []))}\n\n"
                            f"Candidates:\n{catalog}"
                        ),
                    },
                ],
                max_tokens=600,
            )
            parsed = _parse_json_array(text)
            if parsed:
                kept_indexes = [i for i in parsed if isinstance(i, int) and 0 <= i < len(candidates)]
        except Exception as exc:
            await self._emit("screen", f"Screening model call failed: {exc}", type="warning")

        if not kept_indexes:
            kept_indexes = list(range(min(limit, len(candidates))))
            await self._emit(
                "screen",
                "Falling back to citation-ranked order for screening.",
                type="warning",
            )

        kept = [candidates[i] for i in kept_indexes[:limit]]
        dropped = len(candidates) - len(kept)
        await self._emit(
            "screen",
            f"Kept {len(kept)} papers, set aside {dropped}.",
        )

        papers: list[dict[str, Any]] = []
        for record in kept:
            row = await fetch_all(
                """
                INSERT INTO papers (
                    run_id, user_id, source, external_id, title, authors, year,
                    venue, doi, url, abstract, is_open_access, oa_pdf_url
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                self.run_id,
                self.user_id,
                record.get("source") or "unknown",
                record.get("external_id"),
                record.get("title") or "Untitled",
                jsonb(record.get("authors") or []),
                record.get("year"),
                record.get("venue"),
                record.get("doi"),
                record.get("url"),
                record.get("abstract"),
                bool(record.get("is_open_access")),
                record.get("oa_pdf_url"),
            )
            paper = dict(record)
            paper["id"] = str(row[0]["id"])
            papers.append(paper)

        for i, paper in enumerate(papers, 1):
            await self._emit("screen", f"Selected {i}: {paper['title']}")
        return {"papers": existing + papers}

    # ------------------------------------------------------ fetch_oa_pdfs
    async def fetch_oa_pdfs(self, state: ResearchState) -> dict:
        await self._stage("fetch_oa_pdfs")
        papers = state.get("papers", [])
        await self._emit(
            "fetch_oa_pdfs",
            "Locating open-access PDFs (arXiv, OpenAlex best OA location, Unpaywall). "
            "Paywalled papers stay abstract-only; Fiberarticle never circumvents paywalls.",
        )
        semaphore = asyncio.Semaphore(_PDF_CONCURRENCY)

        async def fetch(paper: dict) -> None:
            if paper.get("_done"):
                return
            url = paper.get("oa_pdf_url")
            if not url and paper.get("doi"):
                url = await unpaywall.find_oa_pdf(paper["doi"])
                if url:
                    await self._emit(
                        "fetch_oa_pdfs",
                        f"Unpaywall found an open-access PDF for \"{paper['title'][:80]}\".",
                    )
            if not url:
                await self._emit(
                    "fetch_oa_pdfs",
                    f"No open-access PDF for \"{paper['title'][:80]}\"; using the abstract only.",
                )
                return
            async with semaphore:
                try:
                    async with httpx.AsyncClient(timeout=40, follow_redirects=True) as client:
                        res = await client.get(url, headers={"User-Agent": "Fiberarticle/0.1"})
                        if res.status_code != 200 or len(res.content) > _MAX_PDF_BYTES:
                            raise ValueError(f"status {res.status_code}, {len(res.content)} bytes")
                        if not res.content[:5].startswith(b"%PDF"):
                            raise ValueError("response is not a PDF")
                        paper["_pdf_bytes"] = res.content
                        await self._emit(
                            "fetch_oa_pdfs",
                            f"Fetched PDF ({len(res.content) / 1_048_576:.1f} MB) for \"{paper['title'][:80]}\".",
                        )
                except Exception as exc:
                    await self._emit(
                        "fetch_oa_pdfs",
                        f"Could not fetch the PDF for \"{paper['title'][:80]}\": {exc}. Using the abstract only.",
                        type="warning",
                    )

        await asyncio.gather(*(fetch(p) for p in papers))
        fetched = sum(1 for p in papers if p.get("_pdf_bytes"))
        await self._emit(
            "fetch_oa_pdfs",
            f"{fetched} of {len(papers)} papers have full-text PDFs; the rest are abstract-only.",
        )
        return {"papers": papers}

    # --------------------------------------------------------------- parse
    async def parse(self, state: ResearchState) -> dict:
        await self._stage("parse")
        papers = state.get("papers", [])

        def parse_pdf(data: bytes) -> str:
            import pymupdf
            import pymupdf4llm

            with pymupdf.open(stream=data, filetype="pdf") as doc:
                return pymupdf4llm.to_markdown(doc)

        for paper in papers:
            if paper.get("_done"):
                continue
            data = paper.pop("_pdf_bytes", None)
            if data is None:
                paper["_text"] = paper.get("abstract") or ""
                continue
            await self._emit("parse", f"Reading \"{paper['title'][:80]}\"...")
            try:
                text = await asyncio.to_thread(parse_pdf, data)
                paper["_text"] = text
                paper["full_text_parsed"] = True
                await execute(
                    "UPDATE papers SET full_text_parsed = true WHERE id = %s",
                    paper["id"],
                )
                await self._emit(
                    "parse",
                    f"Parsed {len(text):,} characters of markdown from \"{paper['title'][:80]}\". "
                    "PDF binary discarded.",
                )
            except Exception as exc:
                paper["_text"] = paper.get("abstract") or ""
                await self._emit(
                    "parse",
                    f"Failed to parse the PDF for \"{paper['title'][:80]}\": {exc}. Using the abstract.",
                    type="warning",
                )
            finally:
                del data
        return {"papers": papers}

    # --------------------------------------------------------- chunk_embed
    async def chunk_embed(self, state: ResearchState) -> dict:
        await self._stage("chunk_embed")
        papers = state.get("papers", [])
        total_chunks = 0
        await self._emit(
            "chunk_embed",
            "Chunking texts (~800-1200 tokens, 15% overlap) and embedding with "
            "bge-small-en-v1.5 (384d) on the server CPU.",
        )
        for paper in papers:
            if paper.get("_done"):
                continue
            paper["_done"] = True
            text = paper.get("_text") or ""
            if not text.strip():
                continue
            chunks = chunk_text(text)
            if not chunks:
                continue
            vectors = await embed_texts(chunks)
            for content, vector in zip(chunks, vectors):
                await execute(
                    """
                    INSERT INTO chunks (paper_id, run_id, user_id, content, embedding)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    paper["id"],
                    self.run_id,
                    self.user_id,
                    content,
                    vector,
                )
            total_chunks += len(chunks)
            await self._emit(
                "chunk_embed",
                f"\"{paper['title'][:70]}\": {len(chunks)} chunks embedded.",
            )
        await self._emit("chunk_embed", f"Vector store ready: {total_chunks} chunks indexed.")
        return {}

    # ------------------------------------------------------------- extract
    async def extract(self, state: ResearchState) -> dict:
        await self._stage("extract")
        papers = state.get("papers", [])
        await self._emit(
            "extract",
            f"Extracting key findings from {min(len(papers), 12)} papers.",
        )
        digest = "\n\n".join(
            f"[{i + 1}] {p['title']}\n{(p.get('abstract') or (p.get('_text') or '')[:600])[:600]}"
            for i, p in enumerate(papers[:12])
        )
        findings: list[str] = []
        try:
            text = await self.llm.complete(
                [
                    {
                        "role": "system",
                        "content": (
                            "Extract the single most important finding from each numbered paper "
                            "as it relates to the topic. Respond with ONLY a JSON array of strings, "
                            "each string formatted as '[n] finding'."
                        ),
                    },
                    {"role": "user", "content": f"Topic: {state['topic']}\n\n{digest}"},
                ],
                max_tokens=900,
            )
            parsed = _parse_json_array(text)
            if parsed:
                findings = [str(f) for f in parsed]
        except Exception as exc:
            await self._emit("extract", f"Finding extraction failed: {exc}", type="warning")
        for finding in findings:
            await self._emit("extract", f"Finding: {finding}")
        return {"findings": findings}

    # ------------------------------------------------------ coverage_check
    async def coverage_check(self, state: ResearchState) -> dict:
        await self._stage("coverage_check")
        papers = state.get("papers", [])
        loops = state.get("loops", 0)
        full_text = sum(1 for p in papers if p.get("full_text_parsed"))
        enough = len(papers) >= 5
        await self._emit(
            "coverage_check",
            f"Coverage check: {len(papers)} papers selected, {full_text} with full text, "
            f"loop {loops + 1} of at most 2 extra passes.",
        )
        if enough or loops >= 2:
            await self._emit(
                "coverage_check",
                "Coverage is sufficient. Moving on to synthesis."
                if enough
                else "Loop budget exhausted; synthesizing with what was found.",
            )
            return {"coverage_ok": True, "loops": loops}
        await self._emit(
            "coverage_check",
            "Coverage is thin. Generating fresh queries for another search pass.",
            type="warning",
        )
        return {"coverage_ok": False, "loops": loops + 1}

    # ---------------------------------------------------------- synthesize
    async def synthesize(self, state: ResearchState) -> dict:
        await self._stage("synthesize")
        papers = state.get("papers", [])
        plan = state.get("plan", [state["topic"]])
        reference_key = "\n".join(
            f"[{i + 1}] {p['title']} ({p.get('year') or 'n.d.'})" for i, p in enumerate(papers)
        )
        paper_index = {p["id"]: i + 1 for i, p in enumerate(papers)}
        sections: list[dict[str, str]] = []

        for question in plan:
            await self._emit("synthesize", f"Writing section: {question}")
            vector = await embed_query(question)
            rows = await fetch_all(
                """
                SELECT paper_id, content
                FROM chunks
                WHERE run_id = %s AND user_id = %s
                ORDER BY embedding <=> %s::vector
                LIMIT 6
                """,
                self.run_id,
                self.user_id,
                str(vector),
            )
            evidence = "\n\n".join(
                f"[{paper_index.get(str(r['paper_id']), '?')}] {r['content'][:900]}" for r in rows
            )
            if not evidence:
                evidence = "\n".join(
                    f"[{i + 1}] {p.get('abstract') or ''}" for i, p in enumerate(papers[:8])
                )
            try:
                body = await self.llm.complete(
                    [
                        {
                            "role": "system",
                            "content": (
                                "You write one section of an academic literature review. "
                                "Use ONLY the provided evidence excerpts. Cite with bracketed "
                                "numbers like [3] matching the reference key. 2-4 paragraphs, "
                                "measured academic tone, no headings."
                            ),
                        },
                        {
                            "role": "user",
                            "content": (
                                f"Section question: {question}\n\n"
                                f"Reference key:\n{reference_key}\n\n"
                                f"Evidence excerpts:\n{evidence}"
                            ),
                        },
                    ],
                    max_tokens=900,
                )
                sections.append({"heading": question, "body": body.strip()})
                await self._emit(
                    "synthesize",
                    f"Section drafted ({len(body):,} characters) with evidence from {len(rows)} chunks.",
                )
            except Exception as exc:
                await self._emit("synthesize", f"Section failed: {exc}", type="warning")
        return {"sections": sections}

    # -------------------------------------------------------------- report
    async def report(self, state: ResearchState) -> dict:
        await self._stage("report")
        papers = state.get("papers", [])
        sections = state.get("sections", [])
        await self._emit("report", "Assembling the final report and reference list.")

        lines: list[str] = [f"# {state['topic']}", ""]
        for section in sections:
            lines.append(f"## {section['heading']}")
            lines.append("")
            lines.append(section["body"])
            lines.append("")
        lines.append("## References")
        lines.append("")
        for i, paper in enumerate(papers, 1):
            authors = ", ".join((paper.get("authors") or [])[:6]) or "Unknown authors"
            venue = f" {paper['venue']}." if paper.get("venue") else ""
            doi = f" https://doi.org/{paper['doi']}" if paper.get("doi") else (
                f" {paper['url']}" if paper.get("url") else ""
            )
            lines.append(
                f"[{i}] {authors} ({paper.get('year') or 'n.d.'}). {paper['title']}.{venue}{doi}"
            )
        report_text = "\n".join(lines)

        await execute(
            "UPDATE runs SET report = %s, updated_at = now() WHERE id = %s",
            report_text,
            self.run_id,
        )
        await self._emit(
            "report",
            f"Report complete: {len(sections)} sections, {len(papers)} references.",
            type="success",
        )
        return {"report": report_text}
