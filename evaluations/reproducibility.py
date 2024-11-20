"""Section 7.6: how much the same topic varies from run to run.

A hosted model is not deterministic, so a single run is not the system's
behaviour, it is one sample of it. This runs one topic five times with every
setting held constant and reports how much the selected paper set and the
citation count move.

    python evaluations/reproducibility.py --user <id> --repeats 5

Overlap is the mean pairwise Jaccard index over the selected paper sets, keyed
on DOI where a paper has one and on the index identifier otherwise, so that the
same paper found through two indexes counts once. Variation in citation markers
is the coefficient of variation, which is the standard deviation over the mean,
because an absolute spread means nothing without the level.

Results append to evaluations/results.json under "reproducibility", saved after
every run so an interrupted sweep resumes instead of restarting.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
from itertools import combinations
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parent / "apps" / "api"
sys.path.insert(0, str(API))
sys.path.insert(0, str(HERE))
os.chdir(API)

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from metrics import citation_markers, mean, stdev  # noqa: E402

RESULTS = HERE / "results.json"

TOPIC = ("Retrieval augmented generation for scientific literature review "
         "automation")


def _load() -> dict:
    if RESULTS.exists():
        return json.loads(RESULTS.read_text(encoding="utf-8"))
    return {}


def _key(paper: dict) -> str:
    doi = (paper.get("doi") or "").strip().lower()
    if doi:
        return f"doi:{doi}"
    external = (paper.get("external_id") or "").strip().lower()
    if external:
        return f"id:{external}"
    return "title:" + " ".join((paper.get("title") or "").lower().split())


def jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 1.0
    union = a | b
    return len(a & b) / len(union) if union else 0.0


async def one_run(user_id: str, topic: str, max_papers: int) -> dict:
    from agent.runner import _execute
    from db import fetch_all, fetch_one, jsonb

    filters = {"max_papers": max_papers}
    row = await fetch_one(
        "INSERT INTO runs (user_id, topic, mode, filters) "
        "VALUES (%s, %s, 'research', %s) RETURNING id",
        user_id,
        topic,
        jsonb(filters),
    )
    run_id = str(row["id"])
    started = time.time()
    await _execute(run_id, user_id, topic, "research", filters)
    seconds = round(time.time() - started, 1)

    state = await fetch_one(
        "SELECT status, report FROM runs WHERE id = %s", run_id
    )
    papers = await fetch_all(
        "SELECT doi, external_id, title, full_text_parsed FROM papers "
        "WHERE run_id = %s",
        run_id,
    )
    report = (state or {}).get("report") or ""
    body = report.split("## References")[0]
    return {
        "run_id": run_id,
        "status": (state or {}).get("status"),
        "seconds": seconds,
        "papers": len(papers),
        "keys": sorted({_key(p) for p in papers}),
        "full_text": sum(1 for p in papers if p.get("full_text_parsed")),
        "markers": len(citation_markers(body)),
        "sections": len(re.findall(r"^## ", body, re.M)),
        "words": len(body.split()),
    }


def summarise(runs: list[dict]) -> dict:
    good = [r for r in runs if r["status"] == "completed" and r["papers"]]
    sets = [set(r["keys"]) for r in good]
    pairs = [jaccard(a, b) for a, b in combinations(sets, 2)]
    markers = [r["markers"] for r in good]
    papers = [r["papers"] for r in good]
    marker_mean = mean(markers) if markers else 0.0
    paper_mean = mean(papers) if papers else 0.0
    union = set().union(*sets) if sets else set()
    core = set.intersection(*sets) if sets else set()
    return {
        "topic": TOPIC,
        "runs_attempted": len(runs),
        "runs_completed": len(good),
        "jaccard_pairs": len(pairs),
        "jaccard_mean": round(mean(pairs), 3) if pairs else 0.0,
        "jaccard_sd": round(stdev(pairs), 3) if pairs else 0.0,
        "jaccard_min": round(min(pairs), 3) if pairs else 0.0,
        "jaccard_max": round(max(pairs), 3) if pairs else 0.0,
        "papers_mean": round(paper_mean, 1),
        "papers_sd": round(stdev(papers), 1) if papers else 0.0,
        "papers_union": len(union),
        "papers_in_every_run": len(core),
        "markers_mean": round(marker_mean, 1),
        "markers_sd": round(stdev(markers), 1) if markers else 0.0,
        "markers_cv": round(stdev(markers) / marker_mean, 3) if marker_mean else 0.0,
        "seconds_mean": round(mean([r["seconds"] for r in good]), 1) if good else 0.0,
    }


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", default=os.environ.get("EVAL_USER_ID", ""))
    ap.add_argument("--repeats", type=int, default=5)
    ap.add_argument("--topic", default=TOPIC)
    ap.add_argument("--max-papers", type=int, default=20,
                    help="Paper cap, using the same filter the interface "
                         "exposes. Held constant across the repeats.")
    ap.add_argument("--concurrent", action="store_true",
                    help="Run the repeats at the same time. Overlap and marker "
                         "counts are unaffected, but the per run seconds stop "
                         "being comparable, so they are not reported from a "
                         "concurrent sweep.")
    args = ap.parse_args()
    if not args.user:
        sys.exit("pass --user <user id> or set EVAL_USER_ID")

    from db import close_pool, open_pool

    await open_pool()
    try:
        stored = _load().get("reproducibility", {}).get("runs", [])
        runs = list(stored)
        remaining = args.repeats - len(runs)

        if args.concurrent and remaining > 0:
            print(f"starting {remaining} runs together", flush=True)
            done = await asyncio.gather(
                *[one_run(args.user, args.topic, args.max_papers)
                  for _ in range(remaining)],
                return_exceptions=True,
            )
            for result in done:
                if isinstance(result, Exception):
                    print(f"  run failed: {type(result).__name__}: {result}",
                          flush=True)
                    continue
                print(f"  {result['status']}, {result['papers']} papers, "
                      f"{result['markers']} markers", flush=True)
                runs.append(result)
            data = _load()
            data.setdefault("reproducibility", {})["runs"] = runs
            RESULTS.write_text(json.dumps(data, indent=2), encoding="utf-8")
        else:
            for i in range(len(runs), args.repeats):
                print(f"\nrun {i + 1} of {args.repeats}", flush=True)
                result = await one_run(args.user, args.topic, args.max_papers)
                print(f"  {result['status']}, {result['seconds']}s, "
                      f"{result['papers']} papers, {result['markers']} markers",
                      flush=True)
                runs.append(result)
                data = _load()
                data.setdefault("reproducibility", {})["runs"] = runs
                RESULTS.write_text(json.dumps(data, indent=2), encoding="utf-8")

        summary = summarise(runs)
        summary["concurrent"] = bool(args.concurrent)
        summary["max_papers"] = args.max_papers
        if args.concurrent:
            summary.pop("seconds_mean", None)
        data = _load()
        data["reproducibility"] = {**summary, "runs": runs}
        RESULTS.write_text(json.dumps(data, indent=2), encoding="utf-8")
        print("\n" + json.dumps(summary, indent=2))
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
