"""Literature review analysis: the evidence matrix and the cross-paper synthesis.

Two stages sit between coverage_check and the narrative writer when a run is
in literature_review mode:

- review_matrix    reads each selected paper on its own and records what it
                   proposes, how it was built and evaluated, and what its
                   authors admit it does not answer.
- review_synthesis reads the whole matrix at once and reports the landscape:
                   trends, shared methodology, recurring datasets, strengths
                   and weaknesses, the open gaps, and where to go next.

Both degrade gracefully. A paper that cannot be analyzed becomes a row of
"Not reported" cells rather than a missing row, and a failed synthesis leaves
the matrix and the narrative review intact.
"""

import asyncio
import json
import re
from typing import Any

from citations.indexes import derive_indexes
from db import execute, fetch_all, jsonb

# Concurrency for per-paper analysis. Free-tier providers throttle hard, so
# this stays polite while still finishing 40 papers in a few minutes.
_PAPER_CONCURRENCY = 4

# Per-paper evidence budget. The opening of the paper is taken by position
# (it always holds the abstract, the claim, and the method), while the
# evaluation and limitation passages are retrieved semantically. Taking the
# last chunks by position instead would usually land in the bibliography,
# which is why full-text papers used to come back with no limitations at all.
_HEAD_CHUNKS = 4
_RESULT_CHUNKS = 3
_LIMIT_CHUNKS = 4
_HEAD_CHARS = 1200
# Marker-selected chunks are excerpted around the match rather than truncated
# from the start: a chunk is ~750 words, so head-truncating it would usually
# cut away the very sentence it was selected for.
_EXCERPT_CHARS = 1700
_MATERIAL_CHARS = 17_000

_RESULTS_QUERY = (
    "dataset, experimental setup, evaluation metrics, baselines, accuracy, "
    "and reported results of this study"
)

# Limitations are found lexically rather than by embedding. Papers announce
# them with a small, stable vocabulary, and a 384d sentence embedding of a
# long "limitations" query scores a bibliography chunk about as highly as the
# real discussion, which is exactly how full-text papers ended up with an
# empty limitations column.
# Deliberately excludes bare "external validation", "sample size", and
# "retrospective": those are routine methods and results-table vocabulary,
# and matching them pulled score tables in ahead of the real discussion.
_LIMIT_MARKERS = re.compile(
    r"limitation|shortcoming|drawback|caveat|threats? to validity"
    r"|future work|future research|further (?:stud|work|research|investigat)"
    r"|not generaliz|(?:is|are|was|were|remains|may be) limited|limited to"
    r"|small sample|single[- ](?:cent(?:er|re)|site|institution)"
    r"|class imbalance"
    r"|lack(?:s|ed|ing)? (?:of )?(?:external|independent|prospective)"
    r"|(?:was|were) not (?:evaluated|tested|assessed|explored|considered|validated|included)"
    r"|did not (?:evaluate|test|assess|explore|consider|validate|include)"
    r"|remains? (?:a )?(?:challeng|open|unclear|difficult)",
    re.IGNORECASE,
)

_RESULT_MARKERS = re.compile(
    r"\baccuracy\b|\bAUC\b|\bF1\b|precision|recall|sensitivity|specificity"
    r"|outperform|baseline|state[- ]of[- ]the[- ]art|experimental results"
    r"|we (?:evaluate|train|test)|\bTable \d|\bFig(?:ure)?\.? \d",
    re.IGNORECASE,
)

# A bibliography chunk is dense with publication years. Nothing else in a
# paper is, so this cheaply keeps reference lists out of the evidence pool.
_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")


def _looks_like_references(text: str) -> bool:
    return len(_YEAR_RE.findall(text)) >= 8


def _excerpt(text: str, pattern: re.Pattern[str], max_chars: int) -> str:
    """A window centered on the marker matches, not the start of the chunk."""
    matches = list(pattern.finditer(text))
    if not matches:
        return text[:max_chars]
    start = max(0, matches[0].start() - 400)
    end = min(len(text), matches[-1].end() + 900)
    if end - start > max_chars:
        end = start + max_chars
    return (
        ("..." if start > 0 else "")
        + text[start:end]
        + ("..." if end < len(text) else "")
    )


def _rank_chunks(
    contents: list[str], pattern: re.Pattern[str], limit: int, exclude: set[str]
) -> list[str]:
    """Chunks richest in a marker vocabulary, latest first on a tie.

    Later chunks win ties because discussion, limitations, and future work
    sit near the end of a paper.
    """
    scored: list[tuple[int, int, str]] = []
    for index, content in enumerate(contents):
        if content in exclude or _looks_like_references(content):
            continue
        hits = len(pattern.findall(content))
        if hits:
            scored.append((hits, index, content))
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [content for _, _, content in scored[:limit]]

# Cell budget: long enough to be a real answer, short enough to scan.
_CELL_CHARS = 700

NOT_REPORTED = "Not reported"

# Implementation group, then limitations and research gaps group. The order
# here drives the prompt, the table, the CSV, and the markdown report, so
# they can never drift apart.
IMPLEMENTATION_FIELDS: list[tuple[str, str]] = [
    ("contribution", "What the paper proposes: its central claim or artifact."),
    ("methodology", "The methodology or study design actually used."),
    ("models", "Algorithms, models, or architectures used or introduced."),
    ("dataset", "Datasets, corpora, or study populations used, with sizes if stated."),
    ("tools", "Tools, frameworks, libraries, or hardware used."),
    ("metrics", "Evaluation metrics and how the work was validated."),
    ("results", "The key quantitative or qualitative results reported."),
]

LIMITATION_FIELDS: list[tuple[str, str]] = [
    (
        "limitations",
        "Limitations the authors state themselves. Look in any limitations, "
        "threats to validity, discussion, or conclusion section.",
    ),
    (
        "unresolved",
        "Problems, failure cases, or weaknesses the paper reports but does "
        "not solve.",
    ),
    (
        "assumptions",
        "Assumptions or scope conditions the work depends on, including the "
        "domain, language, or setting it was tested in.",
    ),
    (
        "missing_evaluations",
        "Evaluations, baselines, ablations, datasets, or settings the paper "
        "did not test.",
    ),
    (
        "opportunities",
        "Future work the paper points to, or concrete research opportunities "
        "that follow directly from its stated limitations.",
    ),
]

ANALYSIS_FIELDS = IMPLEMENTATION_FIELDS + LIMITATION_FIELDS

_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


def parse_json_object(text: str) -> dict | None:
    match = _JSON_OBJECT_RE.search(text or "")
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


# Every way a model says "the paper does not say". Normalized to one value
# so the table and the report can drop the cell instead of printing filler.
_EMPTY_VALUES = {
    "",
    "-",
    "na",
    "n/a",
    "none",
    "null",
    "unknown",
    "not reported",
    "not specified",
    "not stated",
    "not mentioned",
    "not applicable",
    "not available",
    "not discussed",
    "not provided",
    "no information",
    "nothing reported",
}


def is_reported(value: str | None) -> bool:
    """True when a cell holds a real answer rather than a "not stated" filler."""
    return bool(value) and value.strip(" .!;:").lower() not in _EMPTY_VALUES


def _clean_cell(value: Any) -> str:
    if value is None:
        return NOT_REPORTED
    if isinstance(value, (list, tuple)):
        value = "; ".join(str(v) for v in value if v)
    text = " ".join(str(value).split())
    if text.strip(" .!;:").lower() in _EMPTY_VALUES:
        return NOT_REPORTED
    return text[:_CELL_CHARS]


def _string_list(value: Any, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if isinstance(item, dict):
            item = item.get("text") or item.get("title") or item.get("name")
        text = " ".join(str(item or "").split())
        if text:
            out.append(text[:400])
    return out[:limit]


def _facet_list(value: Any, limit: int) -> list[dict]:
    """[{name, papers: [n], note}] from whatever shape the model returned."""
    if not isinstance(value, list):
        return []
    out: list[dict] = []
    for item in value:
        if isinstance(item, str):
            name, papers, note = item, [], ""
        elif isinstance(item, dict):
            name = item.get("name") or item.get("title") or ""
            raw = item.get("papers") or item.get("refs") or []
            papers = [
                int(n)
                for n in (raw if isinstance(raw, list) else [])
                if isinstance(n, (int, str)) and str(n).strip().isdigit()
            ]
            note = item.get("note") or item.get("description") or ""
        else:
            continue
        name = " ".join(str(name).split())[:160]
        if not name:
            continue
        out.append(
            {
                "name": name,
                "papers": papers[:40],
                "note": " ".join(str(note).split())[:400],
            }
        )
    return out[:limit]


def _future_work(value: Any, limit: int) -> list[dict]:
    if not isinstance(value, list):
        return []
    out: list[dict] = []
    for item in value:
        if isinstance(item, str):
            title, rationale, addresses = item, "", ""
        elif isinstance(item, dict):
            title = item.get("title") or item.get("direction") or item.get("name") or ""
            rationale = item.get("rationale") or item.get("why") or ""
            addresses = item.get("addresses") or item.get("gap") or ""
        else:
            continue
        title = " ".join(str(title).split())[:220]
        if not title:
            continue
        out.append(
            {
                "title": title,
                "rationale": " ".join(str(rationale).split())[:600],
                "addresses": " ".join(str(addresses).split())[:300],
            }
        )
    return out[:limit]


def empty_synthesis() -> dict:
    return {
        "themes": [],
        "trends": [],
        "methodologies": [],
        "datasets": [],
        "strengths": [],
        "weaknesses": [],
        "gaps": [],
        "future_work": [],
    }


class ReviewNodes:
    """Mixin for ResearchNodes: the two literature-review-only stages.

    Relies on the host class for run_id, user_id, llm, _emit, and _stage.
    """

    # ------------------------------------------------------- evidence pool
    async def _retrieve(self, paper_id: str, vector, limit: int) -> list[str]:
        try:
            rows = await fetch_all(
                """
                SELECT content
                FROM chunks
                WHERE paper_id = %s AND user_id = %s
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                """,
                paper_id,
                self.user_id,
                str(vector),
                limit,
            )
        except Exception:
            return []
        return [r["content"] for r in rows if (r.get("content") or "").strip()]

    async def _paper_material(
        self, paper: dict, vectors: dict[str, list[float]] | None = None
    ) -> tuple[str, str]:
        """(material, provenance) for one paper.

        The opening is taken by position because it always carries the claim,
        the method, and the data. The evaluation and the limitations are
        retrieved semantically instead, since in a real paper they sit
        somewhere in the middle and the final chunks are the bibliography.
        """
        paper_id = paper.get("id")
        rows: list[dict] = []
        if paper_id:
            try:
                rows = await fetch_all(
                    "SELECT content FROM chunks WHERE paper_id = %s AND user_id = %s ORDER BY id",
                    paper_id,
                    self.user_id,
                )
            except Exception:
                rows = []
        contents = [r["content"] for r in rows if (r.get("content") or "").strip()]
        if not contents:
            abstract = (paper.get("abstract") or "").strip()
            return abstract, "abstract" if abstract else "none"


        head = contents[:_HEAD_CHUNKS]
        seen = set(head)
        blocks: list[tuple[str, list[str]]] = [
            ("Opening of the paper", [c[:_HEAD_CHARS] for c in head])
        ]

        # Limitations are picked first. They are the scarce signal in a paper
        # and often live in the same chunk as the results discussion; letting
        # the results block claim that chunk first is what left the
        # limitations column empty.
        #
        # Head chunks are eligible too, on purpose. A short paper states its
        # limitations inside its opening chunks, and the head block is
        # truncated from the front, so the sentence would otherwise be cut
        # away with no second chance to reach the model. Re-excerpting it
        # here costs a little duplication and buys the whole column.
        limits = _rank_chunks(contents, _LIMIT_MARKERS, _LIMIT_CHUNKS, set())
        seen.update(limits)

        # Results: retrieved semantically when embeddings are available, with
        # a marker scan as the fallback so the pool never collapses to the
        # opening alone.
        results: list[str] = []
        vector = (vectors or {}).get("results")
        if vector is not None and paper_id:
            results = [
                c
                for c in await self._retrieve(
                    paper_id, vector, _RESULT_CHUNKS + len(head) + len(limits)
                )
                if c not in seen and not _looks_like_references(c)
            ][:_RESULT_CHUNKS]
        if not results:
            results = _rank_chunks(contents, _RESULT_MARKERS, _RESULT_CHUNKS, seen)
        if results:
            seen.update(results)
            blocks.append(
                (
                    "Passages about the data, the experiments, and the results",
                    [_excerpt(c, _RESULT_MARKERS, _EXCERPT_CHARS) for c in results],
                )
            )

        if limits:
            blocks.append(
                (
                    "Passages about limitations, assumptions, and future work",
                    [_excerpt(c, _LIMIT_MARKERS, _EXCERPT_CHARS) for c in limits],
                )
            )

        material = "\n\n".join(
            f"--- {label} ---\n" + "\n\n".join(chunks)
            for label, chunks in blocks
            if chunks
        )[:_MATERIAL_CHARS]
        return material, "full_text"

    def _blank_cells(self) -> dict[str, str]:
        return {name: NOT_REPORTED for name, _ in ANALYSIS_FIELDS}

    async def _analyze_paper(
        self, paper: dict, vectors: dict[str, list[float]] | None = None
    ) -> tuple[dict[str, str], str]:
        """(cells, evidence level) for one paper.

        The evidence level travels with the row so the table can say why a
        cell is empty instead of leaving the reader to guess.
        """
        material, evidence = await self._paper_material(paper, vectors)
        if evidence == "none":
            return self._blank_cells(), evidence

        spec = "\n".join(f'- "{name}": {desc}' for name, desc in ANALYSIS_FIELDS)
        scope = (
            "You are reading passages selected from the paper's full text."
            if evidence == "full_text"
            else (
                "You are reading only the abstract, so most implementation "
                "details will be absent. Do not guess them."
            )
        )
        try:
            text = await self.llm.complete(
                [
                    {
                        "role": "system",
                        "content": (
                            "You extract a structured record of one research paper for "
                            "a literature review evidence table. " + scope + " Use ONLY "
                            "what the provided text states. Never invent numbers, "
                            "datasets, or findings. If the text does not state a field, "
                            f'return exactly "{NOT_REPORTED}" for it. '
                            "Limitations are often not labeled as limitations: a small "
                            "or single-center dataset, missing external validation, a "
                            "narrow population, reliance on one imaging device or one "
                            "language, unaddressed class imbalance, or a sentence "
                            "beginning \"future work\" all count and should be reported. "
                            "Write each value as one or two compact sentences, no bullet "
                            "points, no markdown. Respond with ONLY a JSON object with "
                            "exactly these keys:\n" + spec
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Paper: {paper.get('title') or 'Untitled'}\n"
                            f"Venue: {paper.get('venue') or 'unknown'}\n"
                            f"Year: {paper.get('year') or 'unknown'}\n\n"
                            f"Text:\n{material}"
                        ),
                    },
                ],
                max_tokens=1400,
            )
        except Exception as exc:
            await self._emit(
                "review_matrix",
                f"Could not analyze \"{(paper.get('title') or '')[:70]}\": {exc}. "
                "Recording it with empty cells.",
                type="warning",
            )
            return self._blank_cells(), evidence

        parsed = parse_json_object(text) or {}
        return (
            {name: _clean_cell(parsed.get(name)) for name, _ in ANALYSIS_FIELDS},
            evidence,
        )

    # ------------------------------------------------------- review_matrix
    async def review_matrix(self, state: dict) -> dict:
        await self._stage("review_matrix")
        papers = state.get("papers", [])
        if not papers:
            await self._emit(
                "review_matrix",
                "No papers survived screening, so there is nothing to tabulate.",
                type="warning",
            )
            return {"review": {"matrix": [], "synthesis": empty_synthesis()}}

        await self._emit(
            "review_matrix",
            f"Building the evidence matrix: reading {len(papers)} papers one by one for "
            "what each proposes, how it was built and evaluated, and what its authors "
            "say it does not settle.",
        )

        # One retrieval probe, embedded once and reused for every paper, to
        # find each paper's evaluation passages. Limitations are located
        # lexically instead, so they keep working without embeddings.
        vectors: dict[str, list[float]] = {}
        try:
            from rag.embeddings import embed_query

            vectors["results"] = await embed_query(_RESULTS_QUERY)
        except Exception:
            await self._emit(
                "review_matrix",
                "Retrieval is unavailable; each paper is read from its opening and "
                "from the passages that name results and limitations directly.",
                type="warning",
            )

        rows: list[dict | None] = [None] * len(papers)
        semaphore = asyncio.Semaphore(_PAPER_CONCURRENCY)
        done = 0

        async def analyze(index: int, paper: dict) -> None:
            nonlocal done
            async with semaphore:
                cells, evidence = await self._analyze_paper(paper, vectors)
            rows[index] = {
                "n": index + 1,
                "paper_id": str(paper.get("id") or ""),
                "title": paper.get("title") or "Untitled",
                "authors": paper.get("authors") or [],
                "venue": paper.get("venue"),
                "year": paper.get("year"),
                "doi": paper.get("doi"),
                "url": paper.get("url"),
                "indexed_in": derive_indexes(paper),
                "quartile": paper.get("quartile"),
                "cited_by_count": paper.get("cited_by_count") or 0,
                "full_text": bool(paper.get("full_text_parsed")),
                # "full_text" | "abstract" | "none": what the agent actually
                # had to read, so an empty cell can be explained honestly.
                "evidence": evidence,
                **cells,
            }
            done += 1
            await self._emit(
                "review_matrix",
                f"[{index + 1}/{len(papers)}] {(paper.get('title') or 'Untitled')[:80]}: "
                f"{rows[index]['contribution'][:130]}",
            )

        await asyncio.gather(
            *(analyze(i, paper) for i, paper in enumerate(papers))
        )
        matrix = [row for row in rows if row is not None]
        analyzed = sum(1 for row in matrix if is_reported(row["contribution"]))
        with_limits = sum(
            1
            for row in matrix
            if any(is_reported(row.get(name)) for name, _ in LIMITATION_FIELDS)
        )
        await self._emit(
            "review_matrix",
            f"Evidence matrix ready: {len(matrix)} papers tabulated, {analyzed} with a "
            f"recoverable contribution statement and {with_limits} with stated "
            "limitations or research gaps.",
        )

        review = {"matrix": matrix, "synthesis": empty_synthesis()}
        await self._save(review)
        return {"review": review}

    # ---------------------------------------------------- review_synthesis
    def _digest(self, matrix: list[dict], field_chars: int = 220) -> str:
        lines: list[str] = []
        for row in matrix:
            parts = [
                f"[{row['n']}] {row['title'][:150]} ({row.get('year') or 'n.d.'})"
                + (f" - {row['venue'][:70]}" if row.get("venue") else "")
            ]
            for name, _ in ANALYSIS_FIELDS:
                value = row.get(name) or ""
                if not is_reported(value):
                    continue
                parts.append(f"  {name}: {value[:field_chars]}")
            lines.append("\n".join(parts))
        return "\n\n".join(lines)

    async def review_synthesis(self, state: dict) -> dict:
        await self._stage("review_synthesis")
        review = dict(state.get("review") or {})
        matrix = review.get("matrix") or []
        if not matrix:
            review.setdefault("synthesis", empty_synthesis())
            return {"review": review}

        await self._emit(
            "review_synthesis",
            f"Reading all {len(matrix)} records together to work out the trends, the "
            "shared methodology, the recurring datasets, and the gaps nobody has closed.",
        )

        from prefs import language_instruction

        language = await language_instruction(self.user_id)
        digest = self._digest(matrix)
        # Keep the whole matrix in one call when it fits; otherwise shorten
        # each field rather than dropping papers, so no paper goes unread.
        if len(digest) > 60_000:
            digest = self._digest(matrix, field_chars=110)[:60_000]

        schema = (
            "{\n"
            '  "themes": [3 to 5 short noun phrases that group the literature],\n'
            '  "trends": [4 to 7 sentences on how the field has moved: what is '
            "growing, what is fading, how methods and scale changed over the years "
            "covered],\n"
            '  "methodologies": [{"name": "...", "papers": [reference numbers], '
            '"note": "how it is applied and where it falls short"}],\n'
            '  "datasets": [{"name": "...", "papers": [reference numbers], '
            '"note": "what it is used for and its known caveats"}],\n'
            '  "strengths": [what the literature as a body does well],\n'
            '  "weaknesses": [what the literature as a body does badly, including '
            "recurring methodological flaws],\n"
            '  "gaps": [specific open research gaps, each a self contained '
            "statement of what is not yet known or tested],\n"
            '  "future_work": [{"title": "a concrete, novel study or system worth '
            'building", "rationale": "why it follows from the evidence", '
            '"addresses": "which gap it closes"}]\n'
            "}"
        )
        try:
            text = await self.llm.complete(
                [
                    {
                        "role": "system",
                        "content": (
                            "You are an experienced researcher synthesizing a body of "
                            "literature. You are given a structured record of every "
                            "reviewed paper. Compare them against each other: what "
                            "converges, what conflicts, what is missing. Ground every "
                            "claim in the records and cite papers by their reference "
                            "numbers where relevant. Do not invent papers, datasets, or "
                            "results. Give 5 to 8 items for methodologies, datasets, "
                            "strengths, weaknesses, gaps, and future_work where the "
                            "evidence supports that many. Respond with ONLY a JSON "
                            "object in exactly this shape:\n" + schema + language
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Review topic: {state.get('topic') or ''}\n\n"
                            f"Reviewed papers ({len(matrix)}):\n{digest}"
                        ),
                    },
                ],
                max_tokens=3200,
            )
            parsed = parse_json_object(text)
        except Exception as exc:
            await self._emit(
                "review_synthesis",
                f"The cross-paper synthesis call failed: {exc}. The evidence matrix and "
                "the written review are unaffected.",
                type="warning",
            )
            parsed = None

        if not parsed:
            await self._emit(
                "review_synthesis",
                "The synthesis reply was not valid JSON; keeping the evidence matrix "
                "without the aggregate panels.",
                type="warning",
            )
            review["synthesis"] = empty_synthesis()
            await self._save(review, "review_synthesis")
            return {"review": review}

        synthesis = {
            "themes": _string_list(parsed.get("themes"), 5),
            "trends": _string_list(parsed.get("trends"), 8),
            "methodologies": _facet_list(parsed.get("methodologies"), 10),
            "datasets": _facet_list(parsed.get("datasets"), 10),
            "strengths": _string_list(parsed.get("strengths"), 8),
            "weaknesses": _string_list(parsed.get("weaknesses"), 8),
            "gaps": _string_list(parsed.get("gaps"), 10),
            "future_work": _future_work(parsed.get("future_work"), 8),
        }
        review["synthesis"] = synthesis
        await self._save(review, "review_synthesis")

        for label, count in (
            ("cross-cutting themes", len(synthesis["themes"])),
            ("trend statements", len(synthesis["trends"])),
            ("shared methodologies", len(synthesis["methodologies"])),
            ("recurring datasets", len(synthesis["datasets"])),
            ("research gaps", len(synthesis["gaps"])),
            ("future directions", len(synthesis["future_work"])),
        ):
            await self._emit("review_synthesis", f"{count} {label} identified.")
        for gap in synthesis["gaps"]:
            await self._emit("review_synthesis", f"Gap: {gap}")
        return {"review": review}

    # --------------------------------------------------------- persistence
    async def _save(self, review: dict, stage: str = "review_matrix") -> None:
        """Write the review to the run as soon as it exists.

        The run row is the single source of truth for the UI, so persisting
        here means a run cancelled or interrupted after this stage still
        shows everything that was already worked out.
        """
        try:
            await execute(
                "UPDATE runs SET review = %s, updated_at = now() WHERE id = %s",
                jsonb(review),
                self.run_id,
            )
        except Exception:
            await self._emit(
                stage,
                "The review data could not be saved to the run; it will still appear "
                "in the written report.",
                type="warning",
            )
