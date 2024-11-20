"""RQ4: the fixed staged graph against the bounded reasoning and acting loop.

Both arms are the application's own code. The loop arm is `agent/assistant.py`
exactly as the chat surface uses it. The graph arm inserts a real run row and
drives `agent/runner._execute`, which is what the API does when a user starts a
run. Nothing here reimplements either architecture, so what is measured is what
ships.

The two arms answer the same question and both produce a text with [n] markers
over a numbered source list, which is what makes them comparable at all. The
loop cites its evidence pool, the graph cites its reference list.

    python evaluations/architecture_compare.py --user <id>

Results append to evaluations/results.json under "architecture". Each question
is saved the moment it finishes, and rerunning skips questions already stored,
because a run takes long enough that losing one to a provider blip is painful.
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
API = HERE.parent / "apps" / "api"
sys.path.insert(0, str(API))
sys.path.insert(0, str(HERE))
os.chdir(API)

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from metrics import citation_markers, mean, stdev  # noqa: E402

RESULTS = HERE / "results.json"

# Four questions, all answerable from the open literature, none of them
# specific to one paper. They are deliberately the kind of question a research
# student actually asks rather than a benchmark probe.
QUESTIONS = [
    "How do retrieval augmented generation systems reduce hallucination in "
    "scientific writing, and what remains unsolved?",
    "What methods are used to automate title and abstract screening in "
    "systematic reviews, and how well do they work?",
    "How is the quality of machine generated literature reviews evaluated?",
    "What are the reported failure modes of large language model agents that "
    "use external tools?",
]

_JUDGE_SYSTEM = (
    "You are grading two answers to the same research question. Grade each on "
    "four criteria, each from 1 to 5:\n"
    "coverage: how much of the question is addressed\n"
    "specificity: whether claims are concrete rather than generic\n"
    "grounding: whether claims are attributed to cited sources\n"
    "usefulness: whether a research student could act on it\n"
    "Judge only what is written. Length is not quality on its own. Respond "
    "with ONLY this JSON and nothing else:\n"
    '{"A": {"coverage": n, "specificity": n, "grounding": n, "usefulness": n}, '
    '"B": {"coverage": n, "specificity": n, "grounding": n, "usefulness": n}}'
)


class CallCounter:
    """Counts real HTTP completions by wrapping ResolvedLlm._call.

    Retries count, because a retry is a call the provider served and a cost the
    user pays. Counting requests at the `complete` level would hide them.
    """

    def __init__(self) -> None:
        self.count = 0
        self._original = None

    def __enter__(self) -> "CallCounter":
        from llm.client import ResolvedLlm

        self._original = ResolvedLlm._call
        counter = self

        async def counted(self, messages, max_tokens, temperature):
            counter.count += 1
            return await counter._original(self, messages, max_tokens, temperature)

        ResolvedLlm._call = counted
        return self

    def __exit__(self, *exc) -> None:
        from llm.client import ResolvedLlm

        ResolvedLlm._call = self._original


def _validity(text: str, reference_count: int) -> tuple[int, int]:
    """Markers found, and markers that point at a source that exists."""
    markers = citation_markers(text)
    good = [m for m in markers if 1 <= m <= reference_count]
    return len(markers), len(good)


async def loop_arm(user_id: str, question: str) -> dict:
    from agent.assistant import AssistantAgent
    from llm.client import resolve_llm

    llm = await resolve_llm(user_id)
    agent = AssistantAgent(llm, user_id, {"scope": "all", "id": None})
    started = time.time()
    with CallCounter() as calls:
        try:
            result = await agent.run(question, history=[])
            answer = (result.get("answer") or "").strip()
            failed = ""
        except Exception as exc:                        # noqa: BLE001
            answer, failed = "", f"{type(exc).__name__}: {exc}"
    seconds = time.time() - started
    total, good = _validity(answer, len(agent.evidence))
    return {
        "answer": answer,
        "seconds": round(seconds, 1),
        "calls": calls.count,
        "sources": len(agent.evidence),
        "markers": total,
        "markers_valid": good,
        "tool_steps": sum(1 for s in agent.steps if s.get("type") == "action"),
        "words": len(answer.split()),
        "completed": bool(answer) and not failed,
        "error": failed,
    }


async def graph_arm(user_id: str, question: str, max_papers: int) -> dict:
    """Insert a run and drive it exactly as the API route does.

    The paper cap is the same `max_papers` filter the user interface exposes.
    It is set below the plan default here because full text parsing of forty
    PDFs takes long enough to make a four question sweep impractical, and the
    comparison in Table 5 is between two arms measured on the same setting
    rather than an absolute claim about run time.
    """
    from agent.runner import _execute
    from db import fetch_one, jsonb

    filters = {"max_papers": max_papers}
    row = await fetch_one(
        """
        INSERT INTO runs (user_id, topic, mode, filters)
        VALUES (%s, %s, 'research', %s)
        RETURNING id
        """,
        user_id,
        question,
        jsonb(filters),
    )
    run_id = str(row["id"])
    started = time.time()
    with CallCounter() as calls:
        await _execute(run_id, user_id, question, "research", filters)
    seconds = time.time() - started

    state = await fetch_one(
        "SELECT status, error, report FROM runs WHERE id = %s", run_id
    )
    papers = await fetch_one(
        "SELECT count(*) AS n FROM papers WHERE run_id = %s", run_id
    )
    report = (state.get("report") or "") if state else ""
    # The reference list is the graph's numbered source list, the same role the
    # evidence pool plays for the loop.
    refs = len(re.findall(r"^\[(\d+)\] ", report, re.M))
    body = report.split("## References")[0]
    total, good = _validity(body, refs)
    return {
        "run_id": run_id,
        "answer": body.strip(),
        "seconds": round(seconds, 1),
        "calls": calls.count,
        "sources": refs,
        "papers": (papers or {}).get("n", 0),
        "markers": total,
        "markers_valid": good,
        "words": len(body.split()),
        "completed": (state or {}).get("status") == "completed" and bool(body.strip()),
        "error": (state or {}).get("error") or "",
    }


async def judge_pair(user_id: str, question: str, loop_text: str,
                     graph_text: str) -> dict:
    """Score both answers in one call so the grades are on one scale.

    Which arm is A alternates by question elsewhere; here A and B are just
    whatever was passed, and the caller records the mapping.
    """
    from llm.client import resolve_llm
    from run_eval import complete_with_retry

    llm = await resolve_llm(user_id)
    text = await complete_with_retry(
        llm,
        [
            {"role": "system", "content": _JUDGE_SYSTEM},
            {"role": "user", "content":
                f"Question: {question}\n\n=== ANSWER A ===\n{loop_text[:9000]}"
                f"\n\n=== ANSWER B ===\n{graph_text[:9000]}"},
        ],
        max_tokens=400,
        temperature=0.0,
    )
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        return {}
    try:
        return json.loads(match.group(0))
    except Exception:                                   # noqa: BLE001
        return {}


def _load() -> dict:
    if RESULTS.exists():
        return json.loads(RESULTS.read_text(encoding="utf-8"))
    return {}


def _save(per_question: list[dict]) -> None:
    data = _load()
    data.setdefault("architecture", {})["per_question"] = per_question
    RESULTS.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _quality(scores: dict) -> float | None:
    if not scores:
        return None
    wanted = ("coverage", "specificity", "grounding", "usefulness")
    values = [scores.get(k) for k in wanted]
    if any(not isinstance(v, (int, float)) for v in values):
        return None
    return round(sum(values) / len(values), 2)


def summarise(per_question: list[dict]) -> dict:
    out: dict = {"questions": len(per_question)}
    for arm in ("loop", "graph"):
        rows = [q[arm] for q in per_question if arm in q]
        done = [r for r in rows if r.get("completed")]
        markers = sum(r["markers"] for r in done)
        valid = sum(r["markers_valid"] for r in done)
        quality = [q["quality"][arm] for q in per_question
                   if q.get("quality", {}).get(arm) is not None]
        out[arm] = {
            "attempted": len(rows),
            "completed": len(done),
            "seconds_mean": round(mean([r["seconds"] for r in done]), 1) if done else 0.0,
            "seconds_sd": round(stdev([r["seconds"] for r in done]), 1) if done else 0.0,
            "calls_mean": round(mean([r["calls"] for r in done]), 1) if done else 0.0,
            "words_mean": round(mean([r["words"] for r in done]), 0) if done else 0.0,
            "sources_mean": round(mean([r["sources"] for r in done]), 1) if done else 0.0,
            "markers_total": markers,
            "marker_validity": round(valid / markers, 3) if markers else 0.0,
            "quality_mean": round(mean(quality), 2) if quality else None,
            "quality_sd": round(stdev(quality), 2) if quality else None,
        }
    return out


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", default=os.environ.get("EVAL_USER_ID", ""))
    ap.add_argument("--questions", type=int, default=len(QUESTIONS))
    ap.add_argument("--max-papers", type=int, default=20,
                    help="Paper cap for the graph arm, using the same filter "
                         "the interface exposes.")
    args = ap.parse_args()
    if not args.user:
        sys.exit("pass --user <user id> or set EVAL_USER_ID")

    from db import close_pool, open_pool

    await open_pool()
    try:
        stored = _load().get("architecture", {}).get("per_question", [])
        done = {q["question"] for q in stored}
        per_question = list(stored)

        for question in QUESTIONS[: args.questions]:
            if question in done:
                print(f"skip (already done): {question[:60]}", flush=True)
                continue
            print(f"\n=== {question}", flush=True)

            print("  loop arm...", flush=True)
            loop = await loop_arm(args.user, question)
            print(f"    {loop['seconds']}s, {loop['calls']} calls, "
                  f"{loop['words']} words, {loop['markers']} markers", flush=True)

            print("  graph arm...", flush=True)
            graph = await graph_arm(args.user, question, args.max_papers)
            print(f"    {graph['seconds']}s, {graph['calls']} calls, "
                  f"{graph['words']} words, {graph['markers']} markers, "
                  f"status ok={graph['completed']}", flush=True)

            quality = {"loop": None, "graph": None}
            if loop["completed"] and graph["completed"]:
                print("  judging...", flush=True)
                verdict = await judge_pair(args.user, question,
                                           loop["answer"], graph["answer"])
                quality = {"loop": _quality(verdict.get("A", {})),
                           "graph": _quality(verdict.get("B", {})),
                           "raw": verdict}
                print(f"    quality loop={quality['loop']} "
                      f"graph={quality['graph']}", flush=True)

            per_question.append({"question": question, "loop": loop,
                                 "graph": graph, "quality": quality})
            _save(per_question)

        summary = summarise(per_question)
        summary["max_papers"] = args.max_papers
        data = _load()
        data["architecture"] = {**summary, "per_question": per_question}
        RESULTS.write_text(json.dumps(data, indent=2), encoding="utf-8")

        print("\n" + json.dumps({k: v for k, v in summary.items()
                                 if k != "per_question"}, indent=2))
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
