"""Background AI titles for sidebar history items.

The moment a run, chat, or extraction is created, a fire-and-forget task asks
the user's LLM for a short one-line title and writes it back. Failures are
silent: every caller keeps a sensible fallback (the raw topic, the first
message, a default name), so a broken model never blocks or breaks the flow.
"""

import asyncio
import logging

from db import execute
from llm.client import resolve_llm
from prefs import language_instruction

logger = logging.getLogger("fiberarticle.titles")

# Whitelist of (table, column) targets a title task may write to.
_TARGETS: dict[str, tuple[str, str]] = {
    "run": ("runs", "title"),
    "conversation": ("conversations", "title"),
    "extraction": ("extractions", "name"),
}

_MAX_TITLE_CHARS = 120


async def _generate(kind: str, row_id: str, user_id: str, text: str) -> None:
    table, column = _TARGETS[kind]
    try:
        llm = await resolve_llm(user_id)
        language = await language_instruction(user_id)
        raw = await llm.complete(
            [
                {
                    "role": "system",
                    "content": (
                        "Write one short, meaningful title (3 to 8 words) that "
                        "captures what the user is asking for. Respond with "
                        "ONLY the title: no quotes, no trailing period, no "
                        "explanations." + language
                    ),
                },
                {"role": "user", "content": text[:2000]},
            ],
            max_tokens=60,
        )
        title = " ".join(raw.strip().strip('"').strip("'").split())
        if not title:
            return
        await execute(
            f"UPDATE {table} SET {column} = %s WHERE id = %s AND user_id = %s",
            title[:_MAX_TITLE_CHARS],
            row_id,
            user_id,
        )
    except Exception:
        # The fallback title stays; a title is never worth failing anything.
        logger.info("title generation skipped for %s %s", kind, row_id)


def schedule_title(kind: str, row_id: str, user_id: str, text: str) -> None:
    """Fire-and-forget: never blocks the request that created the item."""
    if kind not in _TARGETS or not text.strip():
        return
    asyncio.create_task(_generate(kind, row_id, user_id, text))
