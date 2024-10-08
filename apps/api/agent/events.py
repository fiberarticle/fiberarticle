"""Run event log. Every step of the agent reports what it is doing, what it
found, what it is reading, and what it decided. The SSE endpoint tails this table."""

from typing import Any

from db import execute, jsonb


async def emit(
    run_id: str,
    user_id: str,
    stage: str,
    message: str,
    type: str = "info",
    data: dict[str, Any] | None = None,
) -> None:
    await execute(
        """
        INSERT INTO run_events (run_id, user_id, stage, type, message, data)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        run_id,
        user_id,
        stage,
        type,
        message,
        jsonb(data) if data is not None else None,
    )


async def set_stage(run_id: str, stage: str) -> None:
    await execute(
        "UPDATE runs SET stage = %s, updated_at = now() WHERE id = %s",
        stage,
        run_id,
    )
