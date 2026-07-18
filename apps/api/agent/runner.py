"""Executes a research run as a background task and owns its lifecycle."""

import asyncio
import logging

from agent.events import emit
from agent.graph import build_graph
from db import execute
from llm.client import LlmNotConfigured, resolve_llm
from models import CAPS

logger = logging.getLogger("fiberarticle.runner")

# Wall-clock backstop for a whole run. Generous on purpose: real runs on the
# small production VM can legitimately take a long time, so this only exists
# to reap a genuinely hung run, not to police slow ones.
_RUN_TIMEOUT_SECONDS = 2 * 60 * 60
_active_tasks: dict[str, asyncio.Task] = {}


async def _set_status(run_id: str, status: str, error: str | None = None) -> None:
    await execute(
        "UPDATE runs SET status = %s, error = %s, updated_at = now() WHERE id = %s",
        status,
        error,
        run_id,
    )


async def _execute(
    run_id: str,
    user_id: str,
    topic: str,
    mode: str = "research",
    filters: dict | None = None,
    criteria: str | None = None,
    seed_paper_ids: list[str] | None = None,
) -> None:
    try:
        llm = await resolve_llm(user_id)
        caps = CAPS[llm.mode]
        papers_per_run = caps["papers_per_run"]
        if filters and filters.get("max_papers"):
            papers_per_run = min(papers_per_run, int(filters["max_papers"]))
        await _set_status(run_id, "running")
        graph = build_graph(run_id, user_id, llm)
        await asyncio.wait_for(
            graph.ainvoke(
                {
                    "run_id": run_id,
                    "user_id": user_id,
                    "topic": topic,
                    "papers_per_run": papers_per_run,
                    "mode": mode,
                    "filters": filters or {},
                    "criteria": criteria or "",
                    "seed_paper_ids": seed_paper_ids or [],
                },
                {"recursion_limit": 60},
            ),
            timeout=_RUN_TIMEOUT_SECONDS,
        )
        await _set_status(run_id, "completed")
    except asyncio.CancelledError:
        # User pressed Stop: keep everything found so far, mark cancelled.
        await _set_status(run_id, "cancelled")
        try:
            await emit(
                run_id,
                user_id,
                "report",
                "Run stopped by you. Papers and findings collected so far are kept.",
                type="warning",
            )
        except Exception:
            pass
    except LlmNotConfigured as exc:
        await _set_status(run_id, "failed", str(exc))
        await emit(run_id, user_id, "plan", str(exc), type="error")
    except asyncio.TimeoutError:
        message = "The run exceeded the 2 hour budget and was stopped."
        await _set_status(run_id, "failed", message)
        await emit(run_id, user_id, "report", message, type="error")
    except Exception as exc:
        logger.exception("run %s failed", run_id)
        message = f"The run failed: {exc}"
        await _set_status(run_id, "failed", message)
        try:
            await emit(run_id, user_id, "report", message, type="error")
        except Exception:
            pass
    finally:
        _active_tasks.pop(run_id, None)


def start_run(
    run_id: str,
    user_id: str,
    topic: str,
    mode: str = "research",
    filters: dict | None = None,
    criteria: str | None = None,
    seed_paper_ids: list[str] | None = None,
) -> None:
    task = asyncio.create_task(
        _execute(run_id, user_id, topic, mode, filters, criteria, seed_paper_ids)
    )
    _active_tasks[run_id] = task


def cancel_run(run_id: str) -> bool:
    """Cancel the in-process task for a run. Returns False when no task is
    live (already finished, or lost to an API restart)."""
    task = _active_tasks.get(run_id)
    if task is None or task.done():
        return False
    task.cancel()
    return True
