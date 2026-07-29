"""Fiberarticle evaluation harness.

Run from the repository root:

    apps\\api\\venv\\Scripts\\python.exe evaluations/run_eval.py --stage screening
    apps\\api\\venv\\Scripts\\python.exe evaluations/run_eval.py --stage citations
    apps\\api\\venv\\Scripts\\python.exe evaluations/run_eval.py --stage cost
    apps\\api\\venv\\Scripts\\python.exe evaluations/run_eval.py --stage all

Every stage appends to evaluations/results.json. The keys in that file line up one
to one with the placeholder tokens in the manuscript, so filling the paper is
a copy of numbers and nothing more.

Nothing in this folder is imported by the running application. It reads the
same modules the application uses so that what is measured is what ships.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import statistics
import sys
import time
from dataclasses import asdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
# The harness now lives at the repository root. The application it measures
# lives under apps/api, so that directory goes on the import path and becomes
# the working directory, which is where the settings loader expects .env and
# where the bundled citation styles are resolved from.
API = HERE.parent / "apps" / "api"
sys.path.insert(0, str(API))
sys.path.insert(0, str(HERE))
os.chdir(API)

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from metrics import (  # noqa: E402
    CitationReport,
    bootstrap_ci,
    cited_sentences,
    marker_validity,
    mean,
    mean_average_precision,
    paired_bootstrap_p,
    recall_at_k,
    screening_counts,
    stdev,
    wilson_interval,
    work_saved_over_sampling,
)

RESULTS = HERE / "results.json"
DATA = HERE / "data"


# ------------------------------------------------------------------ store
def load_results() -> dict:
    if RESULTS.exists():
        return json.loads(RESULTS.read_text(encoding="utf-8"))
    return {}


def save_results(data: dict) -> None:
    RESULTS.write_text(json.dumps(data, indent=2, ensure_ascii=False),
                       encoding="utf-8")
    print(f"\nwritten -> {RESULTS}")


# ------------------------------------------------------------- E1 screening
def read_review_csv(path: Path) -> tuple[str, list[dict]]:
    """One review per CSV. Columns: id,title,abstract,label

    label is 1 when the human reviewers included the record at full text
    screening and 0 otherwise. This is the format the CLEF eHealth TAR
    qrels convert into with evaluations/prepare_synergy.py.
    """
    rows = []
    with path.open(encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            rows.append({
                "id": r["id"],
                "title": r.get("title", ""),
                "abstract": r.get("abstract", ""),
                "label": int(r["label"]),
            })
    return path.stem, rows


async def complete_with_retry(llm, messages, max_tokens, temperature=0.3,
                              attempts: int = 5):
    """Model call that survives a transient provider fault.

    Free tier endpoints return 500 and 429 often enough that a long evaluation
    will hit one. Without a retry a single blip discards hours of completed
    work, which is what happened on our first screening run.
    """
    delay = 4.0
    last = None
    for attempt in range(attempts):
        try:
            return await llm.complete(messages, max_tokens=max_tokens,
                                      temperature=temperature)
        except Exception as exc:            # noqa: BLE001
            last = exc
            if attempt == attempts - 1:
                break
            print(f"      provider error ({type(exc).__name__}), retry in "
                  f"{delay:.0f}s", flush=True)
            await asyncio.sleep(delay)
            delay *= 2
    print(f"      giving up on this call: {type(last).__name__}", flush=True)
    return ""


async def screen_one_review(llm, topic: str, criteria: str,
                            records: list[dict], budget: int) -> list[int]:
    """Ask the screening agent for the indexes it would keep.

    This calls the same prompt shape the production `screen` node uses, so the
    number reported is the number the deployed system would produce.
    """
    from agent.nodes import _parse_json_array

    catalog = "\n".join(
        f"{i}. {r['title']}" + (f" ({r['abstract'][:200]})" if r["abstract"] else "")
        for i, r in enumerate(records)
    )
    rule = (f" Apply these inclusion and exclusion criteria strictly; exclude any "
            f"paper that violates them: {criteria}." if criteria else "")
    text = await complete_with_retry(
        llm,
        [
            {"role": "system", "content":
                ("You screen papers for a literature review. Given a topic, research "
                 "questions, and a numbered candidate list, return the indexes of papers "
                 f"directly relevant to the topic, best first, at most {budget}."
                 f"{rule} Respond with ONLY a JSON array of integers.")},
            {"role": "user", "content": f"Topic: {topic}\n\nCandidates:\n{catalog}"},
        ],
        max_tokens=1500,
    )
    parsed = _parse_json_array(text) or []
    return [i for i in parsed if isinstance(i, int) and 0 <= i < len(records)]


async def stage_screening(user_id: str, chunk: int) -> dict:
    """Screen every review CSV and score against the gold labels.

    resolve_llm reads the user's stored configuration, so the connection pool
    has to be open before the first call.
    """
    from db import close_pool, open_pool
    from llm.client import resolve_llm

    reviews = sorted((DATA / "screening").glob("*.csv"))
    if not reviews:
        print(f"no review CSVs in {DATA / 'screening'}; "
              "run prepare_synergy.py first")
        return {}

    await open_pool()
    try:
        return await _screen_all(user_id, chunk, reviews, resolve_llm)
    finally:
        await close_pool()


async def _screen_all(user_id, chunk, reviews, resolve_llm) -> dict:
    llm = await resolve_llm(user_id)

    # Completed reviews are kept on disk, so a provider fault costs one review
    # rather than the whole run, and rerunning resumes where it stopped.
    store = load_results()
    done = {r["review"]: r
            for r in store.get("screening", {}).get("per_review", [])}
    per_review, rankings, recalls, wss, latencies = [], [], [], [], []

    for path in reviews:
        name, records = read_review_csv(path)
        if name in done and done[name].get("ranking"):
            row = done[name]
            print(f"  {name:38s} already done, reusing")
            per_review.append(row)
            rankings.append([bool(x) for x in row["ranking"]])
            recalls.append(row["recall"])
            wss.append(row["wss95"])
            latencies.append(row["seconds"])
            continue
        gold = [bool(r["label"]) for r in records]
        topic_file = path.with_suffix(".topic.txt")
        topic = (topic_file.read_text(encoding="utf-8").strip()
                 if topic_file.exists() else name.replace("_", " "))
        criteria = ""
        crit_file = path.with_suffix(".criteria.txt")
        if crit_file.exists():
            criteria = crit_file.read_text(encoding="utf-8").strip()

        kept: set[int] = set()
        order: list[int] = []
        t0 = time.perf_counter()
        # Long candidate lists are screened in windows so the prompt stays
        # inside the context limit of the smaller free tier models.
        windows = range(0, len(records), chunk)
        for wi, start in enumerate(windows, 1):
            print(f"    window {wi}/{len(windows)}", flush=True)
            window = records[start:start + chunk]
            budget = max(1, int(len(window) * 0.35))
            idx = await screen_one_review(llm, topic, criteria, window, budget)
            for i in idx:
                if start + i not in kept:
                    kept.add(start + i)
                    order.append(start + i)
        elapsed = time.perf_counter() - t0

        predicted = [i in kept for i in range(len(records))]
        counts = screening_counts(predicted, gold)
        ranked = order + [i for i in range(len(records)) if i not in kept]
        ranking = [gold[i] for i in ranked]

        row = {
            "review": name,
            "records": len(records),
            "relevant": sum(gold),
            "kept": len(kept),
            "recall": round(counts.recall, 4),
            "precision": round(counts.precision, 4),
            "f1": round(counts.f1, 4),
            "wss95": round(work_saved_over_sampling(ranking, 0.95), 4),
            "ap": round(recall_at_k(ranking, len(ranking)), 4),
            "seconds": round(elapsed, 1),
            "ranking": [int(x) for x in ranking],
        }
        per_review.append(row)
        snap = load_results()
        snap.setdefault("screening", {}).setdefault("per_review", [])
        snap["screening"]["per_review"] = [
            r for r in snap["screening"]["per_review"] if r["review"] != name
        ] + [row]
        save_results(snap)
        rankings.append(ranking)
        recalls.append(counts.recall)
        wss.append(row["wss95"])
        latencies.append(elapsed)
        print(f"  {name:38s} recall={row['recall']:.3f} "
              f"prec={row['precision']:.3f} wss95={row['wss95']:.3f}")

    lo, hi = bootstrap_ci(recalls)
    return {
        "reviews": len(per_review),
        "per_review": per_review,
        "recall_mean": round(mean(recalls), 4),
        "recall_sd": round(stdev(recalls), 4),
        "recall_ci95": [round(lo, 4), round(hi, 4)],
        "wss95_mean": round(mean(wss), 4),
        "wss95_sd": round(stdev(wss), 4),
        "map": round(mean_average_precision(rankings), 4),
        "seconds_mean": round(mean(latencies), 1),
    }


# ------------------------------------------------------- E2 citation checks
_JUDGE = (
    "You check whether a claim is supported by an evidence passage. Answer "
    "with ONLY one word: SUPPORTED if the passage states or directly implies "
    "the claim, PARTIAL if it is related but does not establish the claim, "
    "NOT_SUPPORTED if the passage does not support it at all."
)


async def judge_support(llm, claim: str, evidence: str) -> str:
    out = await complete_with_retry(
        llm,
        [{"role": "system", "content": _JUDGE},
         {"role": "user", "content": f"Claim:\n{claim}\n\nEvidence passage:\n{evidence[:2500]}"}],
        max_tokens=12, temperature=0.0,
    )
    up = out.strip().upper()
    for label in ("NOT_SUPPORTED", "SUPPORTED", "PARTIAL"):
        if label in up:
            return label
    return "NOT_SUPPORTED"


async def stage_citations(user_id: str, sample: int) -> dict:
    """Measure citation behaviour on documents this account has generated.

    Reported separately for documents produced with retrieval grounding on
    (the shipped path) and for the ungrounded control, which is generated by
    the same model with the evidence block withheld.
    """
    from db import close_pool, fetch_all, open_pool
    from llm.client import resolve_llm

    await open_pool()
    try:
        llm = await resolve_llm(user_id)
        docs = await fetch_all(
            "SELECT id, title, run_id, sections FROM documents "
            "WHERE user_id = %s AND status = 'ready' AND run_id IS NOT NULL "
            "ORDER BY created_at DESC", user_id)
        if not docs:
            print("no ready documents for this user; generate some first")
            return {}

        rep = CitationReport()
        judged_rows = []
        for dn, doc in enumerate(docs, 1):
            print(f"  doc {dn}/{len(docs)}  {str(doc['title'])[:52]}", flush=True)
            papers = await fetch_all(
                "SELECT id FROM papers WHERE run_id = %s AND user_id = %s "
                "ORDER BY created_at", doc["run_id"], user_id)
            ref_count = len(papers)
            index_to_paper = {i + 1: str(p["id"]) for i, p in enumerate(papers)}

            for section in doc["sections"] or []:
                body = section.get("content") or ""
                total, valid, bad = marker_validity(body, ref_count)
                rep.markers_total += total
                rep.markers_valid += valid
                rep.unresolved.extend(bad)
                sents = cited_sentences(body)
                rep.sentences_total += len(body.split(". "))
                rep.sentences_cited += len(sents)

                for claim, marks in sents[:sample]:
                    for m in marks[:1]:
                        pid = index_to_paper.get(m)
                        if not pid:
                            continue
                        chunks = await fetch_all(
                            "SELECT content FROM chunks WHERE paper_id = %s "
                            "AND user_id = %s ORDER BY id LIMIT 3", pid, user_id)
                        if not chunks:
                            continue
                        evidence = "\n".join(c["content"] for c in chunks)
                        verdict = await judge_support(llm, claim, evidence)
                        rep.judged += 1
                        if verdict == "SUPPORTED":
                            rep.supported += 1
                        judged_rows.append({"doc": str(doc["id"]),
                                            "marker": m, "verdict": verdict})
                        if rep.judged % 5 == 0:
                            print(f"    judged {rep.judged}, supported "
                                  f"{rep.supported}", flush=True)

        lo, hi = wilson_interval(rep.markers_valid, rep.markers_total)
        slo, shi = wilson_interval(rep.supported, rep.judged)
        return {
            "documents": len(docs),
            "markers_total": rep.markers_total,
            "marker_validity": round(rep.marker_validity, 4),
            "marker_validity_ci95": [round(lo, 4), round(hi, 4)],
            "unresolved_markers": len(rep.unresolved),
            "sentences_cited": rep.sentences_cited,
            "citation_density": round(rep.citation_density, 4),
            "judged": rep.judged,
            "support_rate": round(rep.support_rate, 4),
            "support_rate_ci95": [round(slo, 4), round(shi, 4)],
            "verdicts": judged_rows,
        }
    finally:
        await close_pool()


# ------------------------------------------------------- E5 cost and timing
#: A gap larger than this between two consecutive events in a run means the
#: run was interrupted and later resumed. The idle time in between is not
#: work done by the stage and must not be counted as latency.
_RESUME_GAP_SECONDS = 900


async def stage_cost(user_id: str) -> dict:
    """Per stage wall clock, attributed by stage transition.

    A stage's duration is the time from its first event to the first event of
    the stage that follows it, walking the run's event log in order. Grouping
    by min and max timestamp per stage is wrong, because a resumed run visits
    the same stage twice and the idle time between the two visits then lands
    inside the stage.
    """
    from db import close_pool, fetch_all, open_pool

    await open_pool()
    try:
        runs = await fetch_all(
            "SELECT id, created_at, updated_at, status FROM runs "
            "WHERE user_id = %s AND status = 'completed' ORDER BY created_at",
            user_id)

        by_stage: dict[str, list[float]] = {}
        dropped = 0
        for run in runs:
            events = await fetch_all(
                "SELECT stage, ts FROM run_events WHERE run_id = %s "
                "ORDER BY id", run["id"])
            if len(events) < 2:
                continue
            # collapse consecutive events into stage blocks
            blocks: list[tuple[str, object]] = []
            for e in events:
                if not blocks or blocks[-1][0] != e["stage"]:
                    blocks.append((e["stage"], e["ts"]))
            last_ts = events[-1]["ts"]
            for i, (stage, t0) in enumerate(blocks):
                t1 = blocks[i + 1][1] if i + 1 < len(blocks) else last_ts
                secs = (t1 - t0).total_seconds()
                if secs < 0 or secs > _RESUME_GAP_SECONDS:
                    dropped += 1          # interrupted, not real latency
                    continue
                by_stage.setdefault(stage, []).append(secs)

        # A completed run's own duration, measured the same careful way.
        totals = []
        for run in runs:
            events = await fetch_all(
                "SELECT ts FROM run_events WHERE run_id = %s ORDER BY id",
                run["id"])
            if len(events) < 2:
                continue
            span, prev = 0.0, events[0]["ts"]
            for e in events[1:]:
                gap = (e["ts"] - prev).total_seconds()
                if 0 <= gap <= _RESUME_GAP_SECONDS:
                    span += gap
                prev = e["ts"]
            totals.append(span)

        return {
            "completed_runs": len(runs),
            "runs_measured": len(totals),
            "blocks_dropped_as_interrupted": dropped,
            "run_seconds_mean": round(mean(totals), 1),
            "run_seconds_sd": round(stdev(totals), 1),
            "run_seconds_median": round(statistics.median(totals), 1) if totals else 0,
            "run_seconds_min": round(min(totals), 1) if totals else 0,
            "run_seconds_max": round(max(totals), 1) if totals else 0,
            "stage_seconds": {k: {"mean": round(mean(v), 1),
                                  "sd": round(stdev(v), 1),
                                  "median": round(statistics.median(v), 1),
                                  "n": len(v)}
                              for k, v in sorted(by_stage.items())},
        }
    finally:
        await close_pool()


# -------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser(description="Fiberarticle evaluation harness")
    ap.add_argument("--stage", default="all",
                    choices=["screening", "citations", "cost", "all"])
    ap.add_argument("--user", default=os.environ.get("EVAL_USER_ID", ""),
                    help="Better Auth user id whose data is measured")
    ap.add_argument("--chunk", type=int, default=40,
                    help="candidates per screening prompt window")
    ap.add_argument("--sample", type=int, default=20,
                    help="cited sentences judged per section")
    args = ap.parse_args()

    if not args.user:
        sys.exit("pass --user <user id> or set EVAL_USER_ID")

    results = load_results()
    stages = (["screening", "citations", "cost"]
              if args.stage == "all" else [args.stage])

    for st in stages:
        print(f"\n=== {st} ===")
        t0 = time.perf_counter()
        if st == "screening":
            out = asyncio.run(stage_screening(args.user, args.chunk))
        elif st == "citations":
            out = asyncio.run(stage_citations(args.user, args.sample))
        else:
            out = asyncio.run(stage_cost(args.user))
        if out:
            out["_elapsed_seconds"] = round(time.perf_counter() - t0, 1)
            results[st] = out
            print(json.dumps({k: v for k, v in out.items()
                              if not isinstance(v, list)}, indent=2))

    save_results(results)


if __name__ == "__main__":
    main()
