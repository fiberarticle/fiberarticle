"""RQ2 done properly: citation support with and without retrieval grounding.

This replaces the citation stage of run_eval.py and the judging half of
ungrounded_control.py. Three things were wrong with those and are fixed here.

First, the sample was far too small. The earlier run judged two cited sentences
per section, which gave 50 and 56 sentences and a difference that missed
significance at p = 0.052. The documents already contain 233 cited sentences,
so the sample was a setting, not a limit. This script judges all of them by
default.

Second, the judge was shown the wrong passage. It received the first three
chunks of the cited paper in insertion order, which is normally the title page
and the opening of the introduction, so a claim drawn from the results section
was judged against front matter. Support was therefore understated in both
arms. This script shows the judge the passages of the cited paper that are
closest to the claim, which is the same standard for both arms and is generous
to both.

Third, the ungrounded control was never saved. It was generated, judged and
thrown away, so it could not be re-judged without paying to write it again.
This script writes it to data/ungrounded/ before judging it.

There is also a new measurement that the old harness could not produce. The
writer sees six chunks per section and nothing else, retrieved with a fixed
query template per section against a local embedding model. That is
deterministic, so it can be replayed exactly, which lets us ask a question the
paper could not previously answer: when the system cites a paper, was that
paper even in the evidence window at the time? A citation to a paper that was
never in context did not come from evidence. It came from the reference key.

    apps\\api\\venv\\Scripts\\python.exe evaluations/citation_support.py --user <id>
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parent / "apps" / "api"
sys.path.insert(0, str(API))
sys.path.insert(0, str(HERE))
os.chdir(API)

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# Gemini 3 warns once per call that temperature is deprecated. Several hundred
# copies of that buries the progress output.
import logging  # noqa: E402

logging.getLogger("LiteLLM").setLevel(logging.ERROR)

from metrics import (  # noqa: E402
    cited_sentences,
    marker_validity,
    permutation_p,
    split_sentences,
    wilson_interval,
)
from run_eval import complete_with_retry  # noqa: E402

# Overridable so a smoke test on one document cannot overwrite the real file.
RESULTS = Path(os.environ.get("EVAL_RESULTS") or (HERE / "results.json"))
SAVED = HERE / "data" / "ungrounded"

# heading -> retrieval query template, taken from the writer itself so that a
# change to the section plan cannot silently invalidate the replay below.
from writer.generate import _SECTION_PLAN  # noqa: E402

SECTION_QUERY = {heading: query for heading, query, _instr in _SECTION_PLAN}

# Same wording as before, so the verdicts stay comparable with the earlier run.
_JUDGE = (
    "You check whether a claim is supported by an evidence passage. Answer "
    "with ONLY one word: SUPPORTED if the passage states or directly implies "
    "the claim, PARTIAL if it is related but does not establish the claim, "
    "NOT_SUPPORTED if the passage does not support it at all."
)

# The shipped writing prompt with the evidence block removed, and with the
# instruction to use only the excerpts dropped because there are none.
_UNGROUNDED_SYSTEM = (
    "You write one section of an academic research article in a measured "
    "scholarly tone. Cite sources with bracketed numbers like [3] that match "
    "the reference key. Do not include the section heading in your output. "
    "Plain paragraphs only, no markdown headings. "
)

# How many chunks the writer sees per section. Mirrors the limit default in
# writer.generate._retrieve_evidence; the in-context diagnostic is only correct
# while the two agree.
CONTEXT_CHUNKS = 6
# Passages of the cited paper shown to the judge, nearest the claim.
JUDGE_CHUNKS = 3
# Consecutive provider failures that mean "stop, come back later".
CIRCUIT_BREAK = 8


async def judge_support(llm, claim: str, evidence: str) -> str:
    # complete_with_retry, not llm.complete. The free tier returns 429 often
    # enough that a run of several hundred calls will meet one, and a bare
    # call turns that into a lost run.
    out = await complete_with_retry(
        llm,
        [{"role": "system", "content": _JUDGE},
         {"role": "user",
          "content": f"Claim:\n{claim}\n\nEvidence passage:\n{evidence[:2500]}"}],
        max_tokens=12, temperature=0.0, attempts=4)
    up = (out or "").strip().upper()
    for label in ("NOT_SUPPORTED", "SUPPORTED", "PARTIAL"):
        if label in up:
            return label
    # Empty string means the call failed after every retry. Returning
    # NOT_SUPPORTED here, as the earlier harness did, would quietly convert a
    # rate limit into evidence against the system. Return nothing instead and
    # let the caller drop the sentence.
    return ""


async def nearest_chunks(fetch_all, user_id, paper_id, vector, limit):
    """Passages of one paper closest to a claim, ranked exactly.

    The obvious query, filtering by paper and ordering by distance, is wrong
    here. chunks carries an HNSW index, which is approximate: it collects a
    fixed number of globally nearest candidates and only then applies the
    WHERE clause. When none of those candidates belong to this paper the query
    returns nothing at all, even though the paper plainly has passages. Papers
    with only one or two chunks lose almost every time, and the failure is
    silent, so it reads as missing data rather than a missed index.

    Filtering inside a materialized CTE forces the filter to run first and the
    ranking to be exact over what survives. The filtered set is one paper's
    worth of chunks, so the cost of an exact scan is irrelevant.
    """
    return await fetch_all(
        "WITH c AS MATERIALIZED ("
        "  SELECT content, embedding FROM chunks "
        "  WHERE paper_id = %s AND user_id = %s"
        ") SELECT content FROM c ORDER BY embedding <=> %s::vector LIMIT %s",
        paper_id, user_id, str(vector), limit)


class RotatingLlm:
    """One judge spread over several API keys.

    Each key carries its own quota, so calls are dealt round robin and a key
    that answers with a rate limit is stepped over rather than waited on. The
    interface matches ResolvedLlm, so the judge does not know the difference.

    This is only ever the judge. The ungrounded control is written by the same
    model that wrote the real documents, because a control written by a
    different model would compare two things at once.
    """

    def __init__(self, model: str, keys: list[str]):
        from llm.client import ResolvedLlm

        self.model = model
        self._arms = [ResolvedLlm(model=model, api_key=k, api_base=None,
                                  mode="byok") for k in keys]
        self._next = 0

    async def complete(self, messages, max_tokens=1200, temperature=0.3):
        last = None
        for _ in range(len(self._arms) * 2):
            arm = self._arms[self._next % len(self._arms)]
            self._next += 1
            try:
                return await arm.complete(messages, max_tokens=max_tokens,
                                          temperature=temperature)
            except Exception as exc:                       # noqa: BLE001
                last = exc
                if "ratelimit" not in type(exc).__name__.lower():
                    await asyncio.sleep(1.0)
        raise last


def load_keys(path: Path) -> list[str]:
    """Read API keys, one per line. Kept outside the repository on purpose."""
    keys = [ln.strip() for ln in path.read_text(encoding="utf-8").splitlines()
            if ln.strip() and not ln.startswith("#")]
    if not keys:
        raise SystemExit(f"no keys found in {path}")
    return keys


def _item_key(item) -> str:
    """Stable identity for one judged sentence, used by the checkpoint."""
    raw = f"{item['row'].get('doc')}|{item['row'].get('section')}|" \
          f"{item['row'].get('marker')}|{item['claim']}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


async def judge_all(llm, items, concurrency, cache_path: Path):
    """Run the judge over prepared items, several calls in flight at once.

    Everything local, meaning the embedding and the passage lookup, is already
    done by the time an item arrives here, so this stage is purely waiting on
    the provider and is the only part worth overlapping. Verdicts are written
    into fixed slots rather than appended, so the output order does not depend
    on which call happened to return first and the seeded statistics downstream
    stay reproducible.

    Each verdict is appended to a checkpoint file as soon as it lands, and a
    rerun picks up whatever is already there. Several hundred provider calls
    take long enough that something will eventually interrupt them, and losing
    the lot to one rate limit at call 210 is not an acceptable failure mode.
    """
    done_already: dict[str, str] = {}
    if cache_path.exists():
        for line in cache_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            done_already[rec["key"]] = rec["verdict"]
        print(f"    resuming with {len(done_already)} verdicts already on disk",
              flush=True)

    slots: list[dict | None] = [None] * len(items)
    pending = []
    for i, item in enumerate(items):
        key = _item_key(item)
        if key in done_already:
            slots[i] = {**item["row"], "verdict": done_already[key]}
        else:
            pending.append((i, item, key))

    gate = asyncio.Semaphore(concurrency)
    counter = {"done": 0, "failed": 0, "consecutive": 0}
    # When the provider is refusing everything, grinding through every
    # remaining sentence at four minutes of backoff apiece takes hours and
    # achieves nothing. Give up quickly instead and let the caller retry later.
    give_up = asyncio.Event()
    t0 = time.perf_counter()
    handle = cache_path.open("a", encoding="utf-8")

    async def one(i, item, key):
        if give_up.is_set():
            counter["failed"] += 1
            return
        async with gate:
            verdict = await judge_support(llm, item["claim"], item["evidence"])
        if verdict:
            counter["consecutive"] = 0
        else:
            counter["consecutive"] += 1
            if counter["consecutive"] >= CIRCUIT_BREAK and not give_up.is_set():
                give_up.set()
                print(f"    {CIRCUIT_BREAK} calls failed in a row; the provider "
                      f"is down or out of quota. Stopping early.", flush=True)
        if not verdict:
            # Not checkpointed, so a later rerun tries this sentence again
            # rather than baking a provider failure into the results.
            counter["failed"] += 1
            return
        slots[i] = {**item["row"], "verdict": verdict}
        handle.write(json.dumps({"key": key, "verdict": verdict}) + "\n")
        handle.flush()
        counter["done"] += 1
        done = counter["done"]
        if done % 10 == 0 or done == len(pending):
            per_min = done / max(time.perf_counter() - t0, 1e-9) * 60
            left = (len(pending) - done) / per_min if per_min else 0
            print(f"    judged {done}/{len(pending)}  "
                  f"{per_min:.1f}/min  about {left:.1f} min left", flush=True)

    try:
        await asyncio.gather(*(one(i, it, k) for i, it, k in pending))
    finally:
        handle.close()
    if counter["failed"]:
        print(f"    {counter['failed']} sentences dropped: the provider never "
              f"answered. Rerun to pick them up.", flush=True)
    return [s for s in slots if s], counter["failed"]


async def section_context(fetch_all, user_id, run_id, heading, topic):
    """Replay the retrieval the writer actually had for one section.

    The writer does not search on the heading. Every section carries its own
    query template in _SECTION_PLAN, so "Related Work" is retrieved with
    "prior work and existing approaches for <topic>" and not with the words
    "Related Work". Getting this wrong silently produces nonsense, because
    embedding a bare heading still returns six chunks, just unrelated ones.

    The template is imported from the application rather than copied here, so
    the replay cannot drift away from what the writer does. Embedding is local
    and the model is fixed, so this is exact rather than an approximation.

    Returns None when the section cannot be replayed, which keeps those
    sentences out of the diagnostic instead of scoring them as a miss.
    """
    from rag.embeddings import embed_query

    template = SECTION_QUERY.get(heading)
    if template is None:
        return None
    vector = await embed_query(template.format(topic=topic))
    rows = await fetch_all(
        "SELECT paper_id, content FROM chunks "
        "WHERE run_id = %s AND user_id = %s "
        "ORDER BY embedding <=> %s::vector LIMIT %s",
        run_id, user_id, str(vector), CONTEXT_CHUNKS)
    if not rows:
        return None
    by_paper: dict[str, list[str]] = {}
    for r in rows:
        by_paper.setdefault(str(r["paper_id"]), []).append(r["content"])
    return by_paper


def summarise(rows, arm):
    """Counts, rates and intervals for one arm."""
    judged = len(rows)
    supported = sum(r["verdict"] == "SUPPORTED" for r in rows)
    partial = sum(r["verdict"] == "PARTIAL" for r in rows)
    unsupported = sum(r["verdict"] == "NOT_SUPPORTED" for r in rows)
    slo, shi = wilson_interval(supported, judged) if judged else (0.0, 0.0)
    ulo, uhi = wilson_interval(unsupported, judged) if judged else (0.0, 0.0)
    out = {
        "arm": arm,
        "judged": judged,
        "supported": supported,
        "partial": partial,
        "unsupported": unsupported,
        "support_rate": round(supported / judged, 4) if judged else 0.0,
        "support_rate_ci95": [round(slo, 4), round(shi, 4)],
        "partial_rate": round(partial / judged, 4) if judged else 0.0,
        "unsupported_rate": round(unsupported / judged, 4) if judged else 0.0,
        "unsupported_rate_ci95": [round(ulo, 4), round(uhi, 4)],
    }
    in_ctx = [r for r in rows if r.get("cited_paper_in_context") is not None]
    if in_ctx:
        hits = sum(bool(r["cited_paper_in_context"]) for r in in_ctx)
        clo, chi = wilson_interval(hits, len(in_ctx))
        out["in_context_checked"] = len(in_ctx)
        out["cited_paper_in_context"] = hits
        out["in_context_rate"] = round(hits / len(in_ctx), 4)
        out["in_context_rate_ci95"] = [round(clo, 4), round(chi, 4)]
        # Support split by whether the cited paper was in the evidence window.
        for label, subset in (("when_in_context", [r for r in in_ctx if r["cited_paper_in_context"]]),
                              ("when_not_in_context", [r for r in in_ctx if not r["cited_paper_in_context"]])):
            if subset:
                s = sum(r["verdict"] == "SUPPORTED" for r in subset)
                out[f"support_rate_{label}"] = round(s / len(subset), 4)
                out[f"n_{label}"] = len(subset)
    return out


async def grounded_arm(fetch_all, user_id, docs, per_section):
    """Prepare the documents the shipped pipeline actually produced."""
    from collections import Counter

    from rag.embeddings import embed_query

    # Every sentence that does not reach the judge is counted with a reason,
    # so the sample size in the paper can be explained rather than asserted.
    skipped: Counter[str] = Counter()
    items = []
    markers_total = markers_valid = 0
    sentences_total = sentences_cited = 0

    for dn, doc in enumerate(docs, 1):
        # Same ordering the writer used to number the reference key, so marker
        # [n] resolves to the paper the writer meant by [n].
        papers = await fetch_all(
            "SELECT id FROM papers WHERE run_id = %s AND user_id = %s "
            "ORDER BY created_at", doc["run_id"], user_id)
        index_to_paper = {i + 1: str(p["id"]) for i, p in enumerate(papers)}
        run = await fetch_all("SELECT topic FROM runs WHERE id = %s",
                              doc["run_id"])
        topic = run[0]["topic"] if run else ""
        print(f"  grounded doc {dn}/{len(docs)}  {str(doc['title'])[:46]}",
              flush=True)

        for section in doc["sections"] or []:
            heading = section.get("heading") or "Section"
            body = section.get("content") or ""
            total, valid, _bad = marker_validity(body, len(papers))
            markers_total += total
            markers_valid += valid
            sents = cited_sentences(body)
            sentences_total += len(split_sentences(body))
            sentences_cited += len(sents)

            context = await section_context(fetch_all, user_id,
                                            doc["run_id"], heading, topic)

            considered = (sents[:per_section] if per_section else sents)
            if per_section and len(sents) > per_section:
                skipped["beyond the per section cap"] += len(sents) - per_section
            for claim, marks in considered:
                pid = index_to_paper.get(marks[0]) if marks else None
                if not pid:
                    skipped["marker did not resolve to a paper"] += 1
                    continue
                vector = await embed_query(claim)
                near = await nearest_chunks(fetch_all, user_id, pid, vector,
                                            JUDGE_CHUNKS)
                if not near:
                    skipped["cited paper has no indexed passages"] += 1
                    continue
                items.append({
                    "claim": claim,
                    "evidence": "\n".join(c["content"] for c in near),
                    "row": {
                        "doc": str(doc["id"]),
                        "section": heading,
                        "marker": marks[0],
                        "cited_paper_in_context": (
                            None if context is None else pid in context),
                    },
                })

    print(f"  grounded arm: {sentences_cited} cited sentences, "
          f"{len(items)} prepared", flush=True)
    for reason, n in skipped.items():
        print(f"    skipped {n}: {reason}", flush=True)
    return items, {
        "documents": len(docs),
        "markers_total": markers_total,
        "marker_validity": round(markers_valid / markers_total, 4) if markers_total else 0.0,
        "marker_validity_ci95": [round(v, 4) for v in wilson_interval(markers_valid, markers_total)] if markers_total else [0.0, 0.0],
        "unresolved_markers": markers_total - markers_valid,
        "sentences_cited": sentences_cited,
        "citation_density": round(sentences_cited / sentences_total, 4) if sentences_total else 0.0,
    }


async def ungrounded_arm(fetch_all, llm, user_id, docs, per_section, reuse):
    """Write the same sections with the evidence withheld, then judge them.

    The generated text is saved so that a later change to the judge does not
    require paying to write it all again, which is what went wrong last time.
    """
    from collections import Counter

    from rag.embeddings import embed_query
    from writer.generate import _reference_key

    SAVED.mkdir(parents=True, exist_ok=True)
    skipped: Counter[str] = Counter()
    items = []
    markers_total = markers_valid = 0
    sentences_total = sentences_cited = 0

    for dn, doc in enumerate(docs, 1):
        papers = [dict(p) for p in await fetch_all(
            "SELECT * FROM papers WHERE run_id = %s AND user_id = %s "
            "ORDER BY created_at", doc["run_id"], user_id)]
        if not papers:
            continue
        key = _reference_key(papers)
        index_to_paper = {i + 1: str(p["id"]) for i, p in enumerate(papers)}
        run = await fetch_all("SELECT topic FROM runs WHERE id = %s",
                              doc["run_id"])
        topic = run[0]["topic"] if run else doc["title"]

        cache = SAVED / f"{doc['id']}.json"
        if reuse and cache.exists():
            # The file wraps the sections alongside the topic it was written
            # for, so unwrap rather than iterating the object itself.
            written = json.loads(cache.read_text(encoding="utf-8"))["sections"]
            print(f"  ungrounded doc {dn}/{len(docs)}  reusing "
                  f"{len(written)} saved sections", flush=True)
        else:
            print(f"  ungrounded doc {dn}/{len(docs)}  writing "
                  f"{len(doc['sections'] or [])} sections", flush=True)
            written = []
            for section in doc["sections"] or []:
                heading = section.get("heading") or "Section"
                body = await llm.complete(
                    [{"role": "system", "content": _UNGROUNDED_SYSTEM},
                     {"role": "user", "content":
                      f"Article topic: {topic}\n\nSection to write: {heading}\n\n"
                      f"Reference key:\n{key}"}],
                    max_tokens=1100, temperature=0.4)
                written.append({"heading": heading, "content": body})
            cache.write_text(json.dumps(
                {"document": str(doc["id"]), "topic": topic,
                 "sections": written}, indent=2, ensure_ascii=False),
                encoding="utf-8")

        for section in written:
            body = section["content"]
            total, valid, _bad = marker_validity(body, len(papers))
            markers_total += total
            markers_valid += valid
            sents = cited_sentences(body)
            sentences_total += len(split_sentences(body))
            sentences_cited += len(sents)

            for claim, marks in (sents[:per_section] if per_section else sents):
                pid = index_to_paper.get(marks[0]) if marks else None
                if not pid:
                    skipped["marker did not resolve to a paper"] += 1
                    continue
                vector = await embed_query(claim)
                near = await nearest_chunks(fetch_all, user_id, pid, vector,
                                            JUDGE_CHUNKS)
                if not near:
                    skipped["cited paper has no indexed passages"] += 1
                    continue
                items.append({
                    "claim": claim,
                    "evidence": "\n".join(c["content"] for c in near),
                    "row": {
                        "doc": str(doc["id"]),
                        "section": section["heading"],
                        "marker": marks[0],
                        "cited_paper_in_context": None,
                    },
                })

    print(f"  ungrounded arm: {sentences_cited} cited sentences, "
          f"{len(items)} prepared", flush=True)
    for reason, n in skipped.items():
        print(f"    skipped {n}: {reason}", flush=True)
    return items, {
        "documents": len(docs),
        "markers_total": markers_total,
        "marker_validity": round(markers_valid / markers_total, 4) if markers_total else 0.0,
        "marker_validity_ci95": [round(v, 4) for v in wilson_interval(markers_valid, markers_total)] if markers_total else [0.0, 0.0],
        "unresolved_markers": markers_total - markers_valid,
        "sentences_cited": sentences_cited,
        "citation_density": round(sentences_cited / sentences_total, 4) if sentences_total else 0.0,
    }


async def main(user_id: str, docs_wanted: int, per_section: int,
               reuse: bool, concurrency: int, judge_keys: Path | None,
               judge_model: str) -> None:
    from db import close_pool, fetch_all, open_pool
    from llm.client import resolve_llm

    await open_pool()
    t0 = time.perf_counter()
    try:
        # The writer model is whatever the account runs, because the ungrounded
        # control has to be written by the model that wrote the real documents.
        llm = await resolve_llm(user_id)
        if judge_keys:
            judge = RotatingLlm(judge_model, load_keys(judge_keys))
            print(f"judge: {judge_model} over "
                  f"{len(judge._arms)} keys", flush=True)
        else:
            judge = llm
            print(f"judge: {llm.model} (same as the writer)", flush=True)
        print(f"writer for the ungrounded control: {llm.model}", flush=True)
        docs = await fetch_all(
            "SELECT id, title, run_id, sections FROM documents "
            "WHERE user_id = %s AND status = 'ready' AND run_id IS NOT NULL "
            "ORDER BY created_at DESC LIMIT %s", user_id, docs_wanted)
        if not docs:
            sys.exit("no ready documents for this account")

        # Both arms are prepared first, so the slow provider-bound judging runs
        # as one queue with a known length and a usable estimate of time left.
        g_items, g_meta = await grounded_arm(fetch_all, user_id, docs,
                                             per_section)
        u_items, u_meta = await ungrounded_arm(fetch_all, llm, user_id, docs,
                                               per_section, reuse)

        SAVED.mkdir(parents=True, exist_ok=True)
        print(f"\njudging grounded arm, {len(g_items)} sentences", flush=True)
        g_rows, g_failed = await judge_all(judge, g_items, concurrency,
                                           SAVED / "verdicts_grounded.jsonl")
        print(f"\njudging ungrounded arm, {len(u_items)} sentences", flush=True)
        u_rows, u_failed = await judge_all(judge, u_items, concurrency,
                                           SAVED / "verdicts_ungrounded.jsonl")

        # A partial sample written to results.json would later be read as if it
        # were the finished measurement. Refuse, and let the caller rerun; the
        # checkpoint means a rerun resumes rather than starts over.
        if g_failed or u_failed:
            print(f"\nINCOMPLETE: {g_failed} grounded and {u_failed} ungrounded "
                  f"sentences never got a verdict. results.json not written. "
                  f"Rerun when the provider recovers.", flush=True)
            raise SystemExit(3)

        grounded = {**g_meta, **summarise(g_rows, "retrieval grounded"),
                    "verdicts": g_rows}
        ungrounded = {**u_meta, **summarise(u_rows, "ungrounded control"),
                      "verdicts": u_rows}

        # Strict support as 0/1 per judged sentence, which is what the
        # permutation test shuffles.
        ga = [1.0 if r["verdict"] == "SUPPORTED" else 0.0 for r in g_rows]
        ua = [1.0 if r["verdict"] == "SUPPORTED" else 0.0 for r in u_rows]
        gu = [1.0 if r["verdict"] == "NOT_SUPPORTED" else 0.0 for r in g_rows]
        uu = [1.0 if r["verdict"] == "NOT_SUPPORTED" else 0.0 for r in u_rows]

        comparison = {
            "support_difference": round(grounded["support_rate"]
                                        - ungrounded["support_rate"], 4),
            "support_permutation_p": round(permutation_p(ga, ua), 5),
            "unsupported_difference": round(grounded["unsupported_rate"]
                                            - ungrounded["unsupported_rate"], 4),
            "unsupported_permutation_p": round(permutation_p(gu, uu), 5),
            "permutation_rounds": 20000,
            "judge_model": getattr(judge, "model", "unknown"),
            "writer_model": getattr(llm, "model", "unknown"),
            "judge_evidence": (
                f"{JUDGE_CHUNKS} passages of the cited paper nearest the claim, "
                "identical standard in both arms"),
            "_elapsed_seconds": round(time.perf_counter() - t0, 1),
        }

        data = json.loads(RESULTS.read_text(encoding="utf-8")) if RESULTS.exists() else {}
        data["citations"] = grounded
        data["citations_ungrounded"] = ungrounded
        data["citations_comparison"] = comparison
        RESULTS.write_text(json.dumps(data, indent=2, ensure_ascii=False),
                           encoding="utf-8")

        def brief(d):
            return {k: v for k, v in d.items() if not isinstance(v, list)}

        print("\ngrounded   ", json.dumps(brief(grounded), indent=2))
        print("ungrounded ", json.dumps(brief(ungrounded), indent=2))
        print("comparison ", json.dumps(comparison, indent=2))
        print(f"\nwritten -> {RESULTS}")
    finally:
        await close_pool()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--user", default=os.environ.get("EVAL_USER_ID", ""))
    ap.add_argument("--docs", type=int, default=4)
    ap.add_argument("--per-section", type=int, default=0,
                    help="cited sentences judged per section, 0 means all")
    ap.add_argument("--reuse", action="store_true",
                    help="judge the saved ungrounded text instead of writing it again")
    ap.add_argument("--concurrency", type=int, default=3,
                    help="judge calls in flight at once; the shipped writer "
                         "uses 3 against the same free tier endpoint, and 6 "
                         "drew rate limit errors")
    ap.add_argument("--judge-keys", default=os.environ.get("JUDGE_KEYS_FILE"),
                    help="file of API keys, one per line, used only for the "
                         "judge and rotated when one is rate limited. Keep it "
                         "outside the repository.")
    ap.add_argument("--judge-model", default="gemini/gemini-3.5-flash-lite",
                    help="model used to judge support, applied to both arms")
    a = ap.parse_args()
    if not a.user:
        sys.exit("pass --user <user id> or set EVAL_USER_ID")
    asyncio.run(main(a.user, a.docs, a.per_section, a.reuse, a.concurrency,
                     Path(a.judge_keys) if a.judge_keys else None,
                     a.judge_model))
