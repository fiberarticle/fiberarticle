"""Executes a research run as a background task and owns its lifecycle."""

import asyncio
import logging

from agent.events import emit
from agent.graph import build_graph
from db import execute
from llm.client import LlmNotConfigured, resolve_llm
from models import CAPS

logger = logging.getLogger("fiberarticle.runner")

_RUN_TIMEOUT_SECONDS = 30 * 60
_active_tasks: dict[str, asyncio.Task] = {}


async def _set_status(run_id: str, status: str, error: str | None = None) -> None:
    await execute(
        "UPDATE runs SET status = %s, error = %s, updated_at = now() WHERE id = %s",
        status,
        error,
        run_id,
    )


async def _execute(run_id: str, user_id: str, topic: str) -> None:
    try:
        llm = await resolve_llm(user_id)
        caps = CAPS[llm.mode]
        await _set_status(run_id, "running")
        graph = build_graph(run_id, user_id, llm)
        await asyncio.wait_for(
            graph.ainvoke(
                {
                    "run_id": run_id,
                    "user_id": user_id,
                    "topic": topic,
                    "papers_per_run": caps["papers_per_run"],
                },
                {"recursion_limit": 60},
            ),
            timeout=_RUN_TIMEOUT_SECONDS,
        )
        await _set_status(run_id, "completed")
    except LlmNotConfigured as exc:
        await _set_status(run_id, "failed", str(exc))
        await emit(run_id, user_id, "plan", str(exc), type="error")
    except asyncio.TimeoutError:
        message = "The run exceeded the 30 minute budget and was stopped."
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


def start_run(run_id: str, user_id: str, topic: str) -> None:
    task = asyncio.create_task(_execute(run_id, user_id, topic))
    _active_tasks[run_id] = task
