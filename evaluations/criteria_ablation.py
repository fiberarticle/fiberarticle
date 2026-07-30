"""Does supplying the inclusion criteria change screening, on the one review
where SYNERGY publishes them?

Section 7.1 argues that topic only screening underperforms because the
criteria, which the human reviewers worked from, are not available. That is an
explanation, and until now it was an untested one. SYNERGY does publish
eligibility criteria for many of its reviews. It does not publish them for the
five Cohen subsets we screen, but it does for Nelson_2002, which happens to be
the review our system does worst on. That makes it the natural test.

Both arms run here, topic only and topic plus criteria, on the same records
with the same prompt and the same model, so the difference between them is
attributable to the criteria and nothing else.

One caveat, stated in the paper as well. The model used here is not the model
used for Table 2, because the free tier endpoint that produced Table 2 was out
of quota. Both arms of this experiment share one model, so the difference
within this experiment is sound, but the levels must not be read against
Table 2.

    apps\\api\\venv\\Scripts\\python.exe evaluations/criteria_ablation.py \\
        --judge-keys <file of api keys>
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
API = HERE.parent / "apps" / "api"
sys.path.insert(0, str(API))
sys.path.insert(0, str(HERE))
os.chdir(API)

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import logging  # noqa: E402

logging.getLogger("LiteLLM").setLevel(logging.ERROR)

from citation_support import RotatingLlm, load_keys  # noqa: E402
from metrics import (  # noqa: E402
    average_precision,
    recall_at_k,
    screening_counts,
    wilson_interval,
    work_saved_over_sampling,
)
from run_eval import read_review_csv, screen_one_review  # noqa: E402

RESULTS = Path(os.environ.get("EVAL_RESULTS") or (HERE / "results.json"))
REVIEW = HERE / "data" / "screening" / "Nelson_2002.csv"


async def one_arm(llm, topic, criteria, records, chunk, label):
    gold = [bool(r["label"]) for r in records]
    kept: set[int] = set()
    order: list[int] = []
    t0 = time.perf_counter()
    windows = range(0, len(records), chunk)
    for wi, start in enumerate(windows, 1):
        window = records[start:start + chunk]
        budget = max(1, int(len(window) * 0.35))
        idx = await screen_one_review(llm, topic, criteria, window, budget)
        for i in idx:
            if start + i not in kept:
                kept.add(start + i)
                order.append(start + i)
        print(f"    {label}: window {wi}/{len(windows)}, kept {len(kept)}",
              flush=True)
    elapsed = time.perf_counter() - t0

    predicted = [i in kept for i in range(len(records))]
    counts = screening_counts(predicted, gold)
    ranked = order + [i for i in range(len(records)) if i not in kept]
    ranking = [gold[i] for i in ranked]
    lo, hi = wilson_interval(int(counts.recall * sum(gold) + 0.5), sum(gold))
    return {
        "arm": label,
        "records": len(records),
        "relevant": sum(gold),
        "kept": len(kept),
        "recall": round(counts.recall, 4),
        "recall_ci95": [round(lo, 4), round(hi, 4)],
        "precision": round(counts.precision, 4),
        "f1": round(counts.f1, 4),
        "wss95": round(work_saved_over_sampling(ranking, 0.95), 4),
        "ap": round(average_precision(ranking), 4),
        "recall_at_k": round(recall_at_k(ranking, len(ranking)), 4),
        "seconds": round(elapsed, 1),
        "ranking": [int(x) for x in ranking],
    }


async def main(chunk: int, keys_file: Path, model: str) -> None:
    name, records = read_review_csv(REVIEW)
    topic = (REVIEW.with_suffix(".topic.txt")
             .read_text(encoding="utf-8").strip())
    criteria = (REVIEW.with_suffix(".criteria.txt")
                .read_text(encoding="utf-8").strip())
    print(f"review  : {name}, {len(records)} records, "
          f"{sum(bool(r['label']) for r in records)} relevant")
    print(f"topic   : {topic}")
    print(f"criteria: {len(criteria.split())} words")

    llm = RotatingLlm(model, load_keys(keys_file))
    print(f"model   : {model} over {len(llm._arms)} keys\n")

    without = await one_arm(llm, topic, "", records, chunk, "topic only")
    with_ = await one_arm(llm, topic, criteria, records, chunk,
                          "topic and criteria")

    out = {
        "review": name,
        "model": model,
        "note": ("Both arms share one model and one prompt, so the difference "
                 "is attributable to the criteria. The model differs from the "
                 "one used for Table 2, so the levels are not comparable with "
                 "it."),
        "topic_only": without,
        "with_criteria": with_,
        "delta": {
            "recall": round(with_["recall"] - without["recall"], 4),
            "wss95": round(with_["wss95"] - without["wss95"], 4),
            "precision": round(with_["precision"] - without["precision"], 4),
            "ap": round(with_["ap"] - without["ap"], 4),
        },
    }
    data = json.loads(RESULTS.read_text(encoding="utf-8")) if RESULTS.exists() else {}
    data["criteria_ablation"] = out
    RESULTS.write_text(json.dumps(data, indent=2, ensure_ascii=False),
                       encoding="utf-8")

    def brief(d):
        return {k: v for k, v in d.items() if not isinstance(v, list)}

    print("\ntopic only    ", json.dumps(brief(without), indent=2))
    print("with criteria ", json.dumps(brief(with_), indent=2))
    print("delta         ", json.dumps(out["delta"], indent=2))
    print(f"\nwritten -> {RESULTS}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--chunk", type=int, default=40)
    ap.add_argument("--judge-keys", default=os.environ.get("JUDGE_KEYS_FILE"),
                    required=False)
    ap.add_argument("--model", default="gemini/gemini-3.5-flash-lite")
    a = ap.parse_args()
    if not a.judge_keys:
        sys.exit("pass --judge-keys <file>")
    asyncio.run(main(a.chunk, Path(a.judge_keys), a.model))
