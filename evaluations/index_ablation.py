"""Index ablation for RQ3.

Replays the search queries that real runs actually issued, sending each one to
one scholarly index at a time and then to all four together. This answers a
question the paper claims but has not yet shown, which is whether four indexes
are worth the extra latency over any single one.

Coverage is measured against the union of everything the four indexes return
for the same queries. That reference set is the only honest one available,
because no external gold list exists for an arbitrary topic. Recall for an
index is therefore its share of the union, and the number is a measure of
complementarity rather than of absolute completeness.

    apps\\api\\venv\\Scripts\\python.exe evaluations/index_ablation.py --user <id>
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
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

from metrics import mean, stdev  # noqa: E402

RESULTS = HERE / "results.json"
_QUERY_RE = re.compile(r'^Search query:\s*"(.+)"\s*$')


def key_of(rec: dict) -> str:
    """Same identity rule the pipeline uses when it deduplicates."""
    doi = (rec.get("doi") or "").strip().lower()
    if doi:
        return doi
    return re.sub(r"\W+", "", (rec.get("title") or "").lower())


async def gather_queries(user_id: str, limit: int) -> list[str]:
    from db import fetch_all

    rows = await fetch_all(
        "SELECT message FROM run_events WHERE user_id = %s "
        "AND stage = 'generate_queries' ORDER BY id", user_id)
    out: list[str] = []
    for r in rows:
        m = _QUERY_RE.match((r["message"] or "").strip())
        if m and m.group(1) not in out:
            out.append(m.group(1))
    return out[:limit]


async def run_source(name: str, fn, queries: list[str],
                     per_query_timeout: float = 60.0,
                     pace: float = 3.0) -> dict:
    """One index, every query, measured.

    The timeout is deliberately more generous than the one the live pipeline
    uses, and there is a pause between queries. Firing a dozen queries at
    arXiv back to back trips its rate limiter and returns nothing at all,
    which would be measured as the index contributing zero papers. That is an
    artefact of the measurement, not a property of the index, so the ablation
    paces itself and the pipeline's own 25 second budget is reported
    separately in the latency discussion.
    """
    found: dict[str, dict] = {}
    times: list[float] = []
    failures = 0
    for qi, q in enumerate(queries):
        if qi:
            await asyncio.sleep(pace)
        t0 = time.perf_counter()
        try:
            recs = await asyncio.wait_for(fn(q, limit=10),
                                          timeout=per_query_timeout)
            for rec in recs:
                k = key_of(rec)
                if k and k not in found:
                    found[k] = rec
        except Exception:
            failures += 1
        times.append(time.perf_counter() - t0)
    oa = sum(1 for r in found.values()
             if r.get("is_open_access") or r.get("oa_pdf_url"))
    return {
        "name": name,
        "papers": len(found),
        "keys": set(found),
        "oa_rate": round(oa / len(found), 4) if found else 0.0,
        "seconds_mean": round(mean(times), 2),
        "seconds_sd": round(stdev(times), 2),
        "failed_queries": failures,
    }


async def main(user_id: str, n_queries: int) -> None:
    from db import close_pool, open_pool
    from sources import arxiv, crossref, openalex, semantic_scholar

    await open_pool()
    try:
        queries = await gather_queries(user_id, n_queries)
    finally:
        await close_pool()

    if not queries:
        print("no recorded search queries for this user")
        return
    print(f"replaying {len(queries)} real queries against each index\n")
    for q in queries:
        print("   ", q)
    print()

    connectors = [("arXiv", arxiv.search),
                  ("OpenAlex", openalex.search),
                  ("Semantic Scholar", semantic_scholar.search),
                  ("Crossref", crossref.search)]

    per_source = []
    for name, fn in connectors:
        print(f"  {name} ...", flush=True)
        per_source.append(await run_source(name, fn, queries))

    union: set[str] = set()
    for s in per_source:
        union |= s["keys"]

    rows = []
    for s in per_source:
        others: set[str] = set()
        for t in per_source:
            if t["name"] != s["name"]:
                others |= t["keys"]
        rows.append({
            "index": s["name"],
            "papers": s["papers"],
            "coverage_of_union": round(len(s["keys"]) / len(union), 4) if union else 0,
            "unique_to_this_index": len(s["keys"] - others),
            "oa_rate": s["oa_rate"],
            "seconds_mean": s["seconds_mean"],
            "seconds_sd": s["seconds_sd"],
            "failed_queries": s["failed_queries"],
        })
        print(f"    {s['name']:20s} papers={s['papers']:>4d} "
              f"unique={len(s['keys'] - others):>4d} "
              f"oa={s['oa_rate']:.2f} s/query={s['seconds_mean']:.1f}")

    out = {
        "queries": len(queries),
        "query_list": queries,
        "union_papers": len(union),
        "per_index": rows,
        "all_four_seconds_mean": round(
            max(r["seconds_mean"] for r in rows), 2),
    }
    data = json.loads(RESULTS.read_text(encoding="utf-8")) if RESULTS.exists() else {}
    data["index_ablation"] = out
    RESULTS.write_text(json.dumps(data, indent=2, ensure_ascii=False),
                       encoding="utf-8")
    print(f"\nunion across all four: {len(union)} distinct papers")
    print(f"written -> {RESULTS}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True)
    ap.add_argument("--queries", type=int, default=12)
    a = ap.parse_args()
    asyncio.run(main(a.user, a.queries))
