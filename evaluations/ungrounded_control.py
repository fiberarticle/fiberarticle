"""The ungrounded control for RQ2.

Regenerates the sections of documents this account already produced, using the
same model, the same temperature, the same section headings and the same
reference key, with one thing removed: the retrieved evidence block. Anything
the model writes then comes from its own memory rather than from a passage.

The comparison is therefore a clean one. Only grounding changes.

    apps\\api\\venv\\Scripts\\python.exe evaluations/ungrounded_control.py --user <id>
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
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

from metrics import (  # noqa: E402
    cited_sentences,
    marker_validity,
    split_sentences,
    wilson_interval,
)
from run_eval import complete_with_retry  # noqa: E402

RESULTS = HERE / "results.json"

# Identical to the shipped writing prompt except that the evidence block is
# absent and the instruction to use only the excerpts is therefore dropped.
_UNGROUNDED_SYSTEM = (
    "You write one section of an academic research article in a measured "
    "scholarly tone. Cite sources with bracketed numbers like [3] that match "
    "the reference key. Do not include the section heading in your output. "
    "Plain paragraphs only, no markdown headings. "
)

_JUDGE = (
    "You check whether a claim is supported by an evidence passage. Answer "
    "with ONLY one word: SUPPORTED if the passage states or directly implies "
    "the claim, PARTIAL if it is related but does not establish the claim, "
    "NOT_SUPPORTED if the passage does not support it at all."
)


async def judge(llm, claim: str, evidence: str) -> str:
    out = await llm.complete(
        [{"role": "system", "content": _JUDGE},
         {"role": "user",
          "content": f"Claim:\n{claim}\n\nEvidence passage:\n{evidence[:2500]}"}],
        max_tokens=12, temperature=0.0)
    up = out.strip().upper()
    for label in ("NOT_SUPPORTED", "SUPPORTED", "PARTIAL"):
        if label in up:
            return label
    return "NOT_SUPPORTED"


async def main(user_id: str, sample: int, max_docs: int) -> None:
    from db import close_pool, fetch_all, open_pool
    from llm.client import resolve_llm
    from writer.generate import _reference_key

    await open_pool()
    try:
        llm = await resolve_llm(user_id)
        docs = await fetch_all(
            "SELECT id, title, run_id, sections FROM documents "
            "WHERE user_id = %s AND status = 'ready' AND run_id IS NOT NULL "
            "ORDER BY created_at DESC LIMIT %s", user_id, max_docs)
        if not docs:
            print("no documents to control against")
            return

        markers_total = markers_valid = 0
        sentences_total = sentences_cited = 0
        judged = supported = 0
        verdicts: list[dict] = []
        t0 = time.perf_counter()

        for dn, doc in enumerate(docs, 1):
            papers = [dict(p) for p in await fetch_all(
                "SELECT * FROM papers WHERE run_id = %s AND user_id = %s "
                "ORDER BY created_at", doc["run_id"], user_id)]
            if not papers:
                continue
            key = _reference_key(papers)
            index_to_paper = {i + 1: str(p["id"]) for i, p in enumerate(papers)}
            run = await fetch_all(
                "SELECT topic FROM runs WHERE id = %s", doc["run_id"])
            topic = run[0]["topic"] if run else doc["title"]

            print(f"  doc {dn}/{len(docs)}  {str(doc['title'])[:50]}", flush=True)

            for section in (doc["sections"] or []):
                heading = section.get("heading") or "Section"
                body = await llm.complete(
                    [{"role": "system", "content": _UNGROUNDED_SYSTEM},
                     {"role": "user", "content":
                      f"Article topic: {topic}\n\nSection to write: {heading}\n\n"
                      f"Reference key:\n{key}"}],
                    max_tokens=1100, temperature=0.4)

                total, valid, _bad = marker_validity(body, len(papers))
                markers_total += total
                markers_valid += valid
                sents = cited_sentences(body)
                sentences_total += len(split_sentences(body))
                sentences_cited += len(sents)

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
                        v = await judge(
                            llm, claim, "\n".join(c["content"] for c in chunks))
                        judged += 1
                        supported += (v == "SUPPORTED")
                        verdicts.append({"doc": str(doc["id"]),
                                         "marker": m, "verdict": v})
                        if judged % 5 == 0:
                            print(f"    judged {judged}, supported {supported}",
                                  flush=True)

        mlo, mhi = wilson_interval(markers_valid, markers_total)
        slo, shi = wilson_interval(supported, judged)
        out = {
            "documents": len(docs),
            "markers_total": markers_total,
            "marker_validity": round(markers_valid / markers_total, 4) if markers_total else 0,
            "marker_validity_ci95": [round(mlo, 4), round(mhi, 4)],
            "unresolved_markers": markers_total - markers_valid,
            "sentences_cited": sentences_cited,
            "citation_density": round(sentences_cited / sentences_total, 4) if sentences_total else 0,
            "judged": judged,
            "support_rate": round(supported / judged, 4) if judged else 0,
            "support_rate_ci95": [round(slo, 4), round(shi, 4)],
            "verdicts": verdicts,
            "_elapsed_seconds": round(time.perf_counter() - t0, 1),
        }
        data = json.loads(RESULTS.read_text(encoding="utf-8")) if RESULTS.exists() else {}
        data["citations_ungrounded"] = out
        RESULTS.write_text(json.dumps(data, indent=2, ensure_ascii=False),
                           encoding="utf-8")
        print(json.dumps({k: v for k, v in out.items()
                          if not isinstance(v, list)}, indent=2))
        print(f"\nwritten -> {RESULTS}")
    finally:
        await close_pool()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True)
    ap.add_argument("--sample", type=int, default=2)
    ap.add_argument("--docs", type=int, default=4)
    a = ap.parse_args()
    asyncio.run(main(a.user, a.sample, a.docs))
