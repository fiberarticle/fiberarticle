"""ReAct agent behind the Assistant chat.

The model reasons in Thought → Action → Observation loops, choosing tools
dynamically until it can answer:

- library_search: pgvector retrieval over the user's own papers (or the one
  paper a paper-scoped chat is about).
- scholar_search: live scholarly lookup (OpenAlex + Crossref) for questions
  the library cannot answer.

Every step is captured and returned so the UI can show the chain of thought.
Graceful by design: an empty library, a failed tool, or an unparseable model
reply never kills the turn — the loop degrades to a direct answer.
"""

import asyncio
import logging
import re
from typing import Any

from db import fetch_all
from llm.client import ResolvedLlm
from rag.embeddings import embed_query
from sources import crossref, openalex

logger = logging.getLogger("fiberarticle.assistant")

_MAX_STEPS = 5
_SNIPPET_CHARS = 350

_FINAL_RE = re.compile(r"Final Answer:\s*(.*)", re.DOTALL | re.IGNORECASE)
_ACTION_RE = re.compile(
    r"Action:\s*(\w+)\s*\nAction Input:\s*(.+?)(?:\n|$)", re.IGNORECASE
)
_THOUGHT_RE = re.compile(
    r"Thought:\s*(.+?)(?=\n\s*(?:Action|Final Answer)|\Z)",
    re.DOTALL | re.IGNORECASE,
)

_SYSTEM = """You are Fiberarticle Assistant, a research assistant that answers \
any question accurately, grounding claims in sources whenever possible.

You have these tools:
- library_search: searches the user's own paper library (full text and \
abstracts). Input: a short search query.
- scholar_search: searches published academic literature (OpenAlex, \
Crossref). Input: a short keyword query.

Work in steps. On each step respond with EXACTLY one of these two formats:

Thought: <your reasoning about what to do next>
Action: <library_search or scholar_search>
Action Input: <the query>

OR, once you can answer:

Thought: <your final reasoning>
Final Answer: <the answer>

Rules:
- Questions about "my papers", "my library", or an attached document need \
library_search first.
- Factual or scientific claims should be checked against sources; cite \
evidence with bracketed numbers like [2] that match the numbered \
observations you received.
- Simple conversational or definitional questions may be answered directly \
with no tool use.
- Never invent citations. If the sources do not support an answer, say so \
honestly.{language}"""


def _snippet(text: str | None) -> str:
    return " ".join((text or "").split())[:_SNIPPET_CHARS]


class AssistantAgent:
    def __init__(self, llm: ResolvedLlm, user_id: str, conversation: dict):
        self.llm = llm
        self.user_id = user_id
        self.conversation = conversation
        # Numbered evidence pool shared across tools; [n] cites index+1.
        self.evidence: list[dict[str, Any]] = []
        self.steps: list[dict[str, Any]] = []

    async def _library_search(self, query: str) -> str:
        try:
            vector = await embed_query(query)
        except Exception:
            return "Library search is unavailable right now."
        if self.conversation.get("scope") == "paper" and self.conversation.get(
            "paper_id"
        ):
            rows = await fetch_all(
                """
                SELECT ch.content, ch.paper_id, p.title, p.url
                FROM chunks ch JOIN papers p ON p.id = ch.paper_id
                WHERE ch.user_id = %s AND ch.paper_id = %s
                ORDER BY ch.embedding <=> %s::vector LIMIT 6
                """,
                self.user_id,
                self.conversation["paper_id"],
                str(vector),
            )
        else:
            rows = await fetch_all(
                """
                SELECT ch.content, ch.paper_id, p.title, p.url
                FROM chunks ch JOIN papers p ON p.id = ch.paper_id
                WHERE ch.user_id = %s
                ORDER BY ch.embedding <=> %s::vector LIMIT 6
                """,
                self.user_id,
                str(vector),
            )
        if not rows:
            return (
                "No results: the library has no indexed text for this query. "
                "Consider scholar_search or answer from general knowledge, "
                "saying the library had nothing relevant."
            )
        lines = []
        for row in rows:
            self.evidence.append(
                {
                    "paper_id": str(row["paper_id"]),
                    "title": row["title"],
                    "quote": _snippet(row["content"]),
                    "url": row.get("url"),
                }
            )
            lines.append(
                f"[{len(self.evidence)}] From \"{row['title'][:90]}\": "
                f"{_snippet(row['content'])}"
            )
        return "\n".join(lines)

    async def _scholar_search(self, query: str) -> str:
        async def run(fn):
            try:
                return await asyncio.wait_for(fn(query, limit=5), timeout=12)
            except Exception:
                return []

        results = await asyncio.gather(run(openalex.search), run(crossref.search))
        papers = [p for source in results for p in source if p.get("abstract")][:6]
        if not papers:
            return (
                "No results from the scholarly indexes. Answer from general "
                "knowledge and say the literature lookup found nothing."
            )
        lines = []
        for paper in papers:
            self.evidence.append(
                {
                    "paper_id": None,
                    "title": paper["title"],
                    "quote": _snippet(paper.get("abstract")),
                    "url": paper.get("url"),
                }
            )
            lines.append(
                f"[{len(self.evidence)}] {paper['title']} "
                f"({paper.get('year') or 'n.d.'}): {_snippet(paper.get('abstract'))}"
            )
        return "\n".join(lines)

    async def run(
        self,
        question: str,
        history: list[dict],
        search_library_first: bool = False,
    ) -> dict[str, Any]:
        from prefs import language_instruction

        language = await language_instruction(self.user_id)
        messages: list[dict] = [
            {"role": "system", "content": _SYSTEM.format(language=language)},
            *[{"role": h["role"], "content": h["content"]} for h in history],
            {"role": "user", "content": question},
        ]

        if search_library_first:
            # The user attached documents with this message: consult them
            # unconditionally instead of leaving retrieval to the model.
            observation = await self._library_search(question)
            self.steps.append(
                {
                    "type": "action",
                    "tool": "library_search",
                    "input": question[:200],
                    "result": _snippet(observation)[:220],
                }
            )
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Observation (automatic library search over the user's "
                        f"newly attached documents):\n{observation}"
                    ),
                }
            )

        answer = ""
        for _ in range(_MAX_STEPS):
            text = (await self.llm.complete(messages, max_tokens=900)).strip()
            if not text:
                break

            final = _FINAL_RE.search(text)
            thought_match = _THOUGHT_RE.search(text)
            thought = _snippet(thought_match.group(1)) if thought_match else None

            if final:
                if thought:
                    self.steps.append({"type": "thought", "text": thought})
                answer = final.group(1).strip()
                break

            action = _ACTION_RE.search(text)
            if not action:
                # No recognizable structure: treat the whole reply as the answer.
                answer = text
                break

            tool = action.group(1).lower()
            tool_input = action.group(2).strip().strip('"')
            if thought:
                self.steps.append({"type": "thought", "text": thought})

            if tool == "library_search":
                observation = await self._library_search(tool_input)
            elif tool == "scholar_search":
                observation = await self._scholar_search(tool_input)
            else:
                observation = f"Unknown tool '{tool}'. Use library_search or scholar_search."
            self.steps.append(
                {
                    "type": "action",
                    "tool": tool,
                    "input": tool_input[:200],
                    "result": _snippet(observation)[:220],
                }
            )

            messages.append({"role": "assistant", "content": text})
            messages.append(
                {"role": "user", "content": f"Observation:\n{observation}"}
            )
        else:
            # Step budget exhausted: force a final answer from what was seen.
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Stop searching. Give your Final Answer now from the "
                        "observations so far."
                    ),
                }
            )
            text = (await self.llm.complete(messages, max_tokens=900)).strip()
            final = _FINAL_RE.search(text)
            answer = (final.group(1) if final else text).strip()

        # Only evidence actually cited in the answer becomes a citation chip.
        # No [n] markers means the answer used no sources: show none, rather
        # than passing off unused (possibly irrelevant) evidence as citations.
        cited = {
            int(n)
            for n in re.findall(r"\[(\d+)\]", answer)
            if 0 < int(n) <= len(self.evidence)
        }
        citations: list[dict[str, Any]] = []
        seen: set[str] = set()
        for n in sorted(cited):
            item = self.evidence[n - 1]
            # One chip per paper: several chunks of the same source are not
            # several sources.
            key = item.get("paper_id") or item.get("url") or item["title"]
            if key in seen:
                continue
            seen.add(key)
            citations.append(item)

        return {"answer": answer, "steps": self.steps, "citations": citations}
