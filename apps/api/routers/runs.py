import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from agent.runner import start_run
from db import fetch_all, fetch_one, jsonb
from llm.client import LlmNotConfigured, resolve_llm
from models import PaperOut, RunCreate, RunDetailOut, RunOut
from security import CurrentUser

router = APIRouter(prefix="/v1/runs", tags=["runs"])

_TERMINAL = {"completed", "failed", "cancelled"}


def _run_out(row: dict) -> RunOut:
    return RunOut(
        id=str(row["id"]),
        topic=row["topic"],
        mode=row.get("mode") or "research",
        status=row["status"],
        stage=row["stage"],
        paper_count=row.get("paper_count", 0),
        error=row["error"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.post("", response_model=RunOut, status_code=201)
async def create_run(body: RunCreate, user_id: str = CurrentUser) -> RunOut:
    try:
        await resolve_llm(user_id)
    except LlmNotConfigured as exc:
        raise HTTPException(409, str(exc))

    filters = (
        body.filters.model_dump(exclude_none=True) if body.filters else None
    )
    criteria = (body.criteria or "").strip() or None
    row = await fetch_one(
        """
        INSERT INTO runs (user_id, topic, mode, filters, criteria)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING *, 0 AS paper_count
        """,
        user_id,
        body.topic.strip(),
        body.mode,
        jsonb(filters) if filters else None,
        criteria,
    )
    start_run(str(row["id"]), user_id, body.topic.strip(), body.mode, filters, criteria)
    return _run_out(row)


@router.get("", response_model=list[RunOut])
async def list_runs(
    mode: str | None = None, user_id: str = CurrentUser
) -> list[RunOut]:
    condition = "AND r.mode = %s" if mode in ("research", "literature_review") else ""
    args = [user_id] + ([mode] if condition else [])
    rows = await fetch_all(
        f"""
        SELECT r.*, (SELECT count(*) FROM papers p WHERE p.run_id = r.id) AS paper_count
        FROM runs r
        WHERE r.user_id = %s {condition}
        ORDER BY r.created_at DESC
        LIMIT 50
        """,
        *args,
    )
    return [_run_out(r) for r in rows]


async def _get_owned_run(run_id: str, user_id: str) -> dict:
    row = await fetch_one(
        """
        SELECT r.*, (SELECT count(*) FROM papers p WHERE p.run_id = r.id) AS paper_count
        FROM runs r
        WHERE r.id = %s AND r.user_id = %s
        """,
        run_id,
        user_id,
    )
    if row is None:
        raise HTTPException(404, "Run not found")
    return row


@router.get("/{run_id}", response_model=RunDetailOut)
async def get_run(run_id: str, user_id: str = CurrentUser) -> RunDetailOut:
    row = await _get_owned_run(run_id, user_id)
    papers = await fetch_all(
        "SELECT * FROM papers WHERE run_id = %s AND user_id = %s ORDER BY created_at",
        run_id,
        user_id,
    )
    return RunDetailOut(
        **_run_out(row).model_dump(),
        report=row["report"],
        papers=[
            PaperOut(
                id=str(p["id"]),
                title=p["title"],
                authors=p["authors"] or [],
                year=p["year"],
                venue=p["venue"],
                doi=p["doi"],
                url=p["url"],
                source=p["source"],
                is_open_access=p["is_open_access"],
                abstract=p["abstract"],
                quartile=p.get("quartile"),
            )
            for p in papers
        ],
    )


@router.get("/{run_id}/events")
async def stream_events(run_id: str, user_id: str = CurrentUser) -> StreamingResponse:
    await _get_owned_run(run_id, user_id)

    async def generate():
        last_id = 0
        while True:
            events = await fetch_all(
                """
                SELECT id, stage, type, message, data, ts
                FROM run_events
                WHERE run_id = %s AND user_id = %s AND id > %s
                ORDER BY id
                LIMIT 200
                """,
                run_id,
                user_id,
                last_id,
            )
            for event in events:
                last_id = event["id"]
                payload = {
                    "id": event["id"],
                    "stage": event["stage"],
                    "type": event["type"],
                    "message": event["message"],
                    "data": event["data"],
                    "ts": event["ts"].isoformat(),
                }
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            status_row = await fetch_one(
                "SELECT status FROM runs WHERE id = %s", run_id
            )
            if status_row is None or (status_row["status"] in _TERMINAL and not events):
                yield "event: done\ndata: {}\n\n"
                return
            if not events:
                await asyncio.sleep(0.7)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
