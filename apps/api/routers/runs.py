import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from agent.graph import STAGES
from agent.runner import cancel_run as cancel_run_task
from agent.runner import is_run_active, resume_run, start_run
from db import execute, fetch_all, fetch_one, jsonb
from llm.client import LlmNotConfigured, resolve_llm
from llm.titles import schedule_title
from models import PaperOut, RunCreate, RunDetailOut, RunOut, RunUpdate
from security import CurrentUser

router = APIRouter(prefix="/v1/runs", tags=["runs"])

_TERMINAL = {"completed", "failed", "cancelled"}


def _run_out(row: dict) -> RunOut:
    return RunOut(
        id=str(row["id"]),
        topic=row["topic"],
        title=row.get("title") or row["topic"],
        pinned=bool(row.get("pinned")),
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
    # Attached papers: only ones the user actually owns become seeds.
    seed_ids: list[str] = []
    if body.seed_paper_ids:
        owned = await fetch_all(
            "SELECT id FROM papers WHERE user_id = %s AND id = ANY(%s::uuid[])",
            user_id,
            body.seed_paper_ids,
        )
        seed_ids = [str(r["id"]) for r in owned]
    row = await fetch_one(
        """
        INSERT INTO runs (user_id, topic, mode, filters, criteria, seed_paper_ids)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING *, 0 AS paper_count
        """,
        user_id,
        body.topic.strip(),
        body.mode,
        jsonb(filters) if filters else None,
        criteria,
        jsonb(seed_ids) if seed_ids else None,
    )
    start_run(
        str(row["id"]), user_id, body.topic.strip(), body.mode, filters, criteria, seed_ids
    )
    # Sidebar history shows an AI title, not the raw topic. Background only.
    schedule_title("run", str(row["id"]), user_id, body.topic.strip())
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


@router.patch("/{run_id}", response_model=RunOut)
async def update_run(
    run_id: str, body: RunUpdate, user_id: str = CurrentUser
) -> RunOut:
    await _get_owned_run(run_id, user_id)
    if body.title is not None:
        await execute(
            "UPDATE runs SET title = %s, updated_at = now() WHERE id = %s",
            body.title.strip(),
            run_id,
        )
    if body.pinned is not None:
        await execute(
            "UPDATE runs SET pinned = %s, updated_at = now() WHERE id = %s",
            body.pinned,
            run_id,
        )
    return _run_out(await _get_owned_run(run_id, user_id))


@router.post("/{run_id}/cancel", response_model=RunOut)
async def cancel_run(run_id: str, user_id: str = CurrentUser) -> RunOut:
    """Non-destructive stop: the run is marked cancelled and everything
    collected so far (papers, events, partial report) is kept."""
    row = await _get_owned_run(run_id, user_id)
    if row["status"] not in ("pending", "running"):
        raise HTTPException(409, "Only a pending or running run can be stopped.")
    cancel_run_task(run_id)
    # Conditional update: if the task slipped to completed/failed in the
    # meantime, that terminal status wins.
    await execute(
        """
        UPDATE runs SET status = 'cancelled', error = NULL, updated_at = now()
        WHERE id = %s AND status IN ('pending', 'running')
        """,
        run_id,
    )
    return _run_out(await _get_owned_run(run_id, user_id))


@router.post("/{run_id}/resume", response_model=RunOut)
async def resume_failed_run(run_id: str, user_id: str = CurrentUser) -> RunOut:
    """Continue a failed run from the stage it died in. The state saved after
    every completed stage is restored, so finished work is never redone."""
    row = await _get_owned_run(run_id, user_id)
    if is_run_active(run_id):
        raise HTTPException(409, "This run is already being resumed.")
    try:
        await resolve_llm(user_id)
    except LlmNotConfigured as exc:
        raise HTTPException(409, str(exc))

    # Atomic claim: only one caller can flip failed -> pending, so two
    # Resume clicks (or Resume plus Retry) can never spawn two pipelines
    # for the same run. The elapsed timer restarts with the new attempt.
    claimed = await fetch_one(
        """
        UPDATE runs SET status = 'pending', error = NULL,
            created_at = now(), updated_at = now()
        WHERE id = %s AND status = 'failed'
        RETURNING id
        """,
        run_id,
    )
    if claimed is None:
        raise HTTPException(409, "Only a failed run can be resumed.")

    snapshot = row.get("snapshot") or None
    entry = row.get("stage") if snapshot else "plan"
    if entry not in STAGES:
        entry = "plan"
    # PDF bytes are never snapshotted, so a run that died while reading
    # documents re-enters one stage earlier and refetches them.
    if entry == "parse":
        entry = "fetch_oa_pdfs"

    if snapshot:
        # Rows written by the half-finished stage would duplicate what the
        # resumed stage writes again: papers not in the snapshot go, and
        # partly indexed chunks of unfinished papers are re-embedded.
        kept_ids = [p["id"] for p in snapshot.get("papers", []) if p.get("id")]
        await execute(
            "DELETE FROM papers WHERE run_id = %s AND NOT (id = ANY(%s::uuid[]))",
            run_id,
            kept_ids or ["00000000-0000-0000-0000-000000000000"],
        )
        if STAGES.index(entry) <= STAGES.index("chunk_embed"):
            pending_ids = [
                p["id"]
                for p in snapshot.get("papers", [])
                if p.get("id") and not p.get("_done")
            ]
            if pending_ids:
                await execute(
                    "DELETE FROM chunks WHERE run_id = %s AND paper_id = ANY(%s::uuid[])",
                    run_id,
                    pending_ids,
                )
    else:
        # A run that failed before any stage snapshot existed (or one from
        # before snapshots shipped) can only start over; clear what the
        # failed attempt wrote so nothing shows up twice.
        await execute("DELETE FROM papers WHERE run_id = %s", run_id)
        await execute("DELETE FROM run_events WHERE run_id = %s", run_id)
        await execute(
            "UPDATE runs SET report = NULL, stage = NULL WHERE id = %s", run_id
        )

    resume_run(
        run_id,
        user_id,
        row["topic"],
        row.get("mode") or "research",
        row.get("filters"),
        row.get("criteria"),
        seed_paper_ids=row.get("seed_paper_ids") or [],
        entry_stage=entry,
        resume_state=snapshot,
    )
    return _run_out(await _get_owned_run(run_id, user_id))


@router.post("/{run_id}/retry", response_model=RunOut)
async def retry_run(run_id: str, user_id: str = CurrentUser) -> RunOut:
    """Start the run over from scratch: everything the failed attempt
    collected is wiped and the same topic runs again."""
    row = await _get_owned_run(run_id, user_id)
    if is_run_active(run_id):
        raise HTTPException(409, "This run is already active.")
    try:
        await resolve_llm(user_id)
    except LlmNotConfigured as exc:
        raise HTTPException(409, str(exc))

    # Atomic claim (see resume): one caller wins, every other gets a 409.
    # A retry is a fresh attempt, so the clock starts over too.
    claimed = await fetch_one(
        """
        UPDATE runs SET status = 'pending', stage = NULL, error = NULL,
            report = NULL, snapshot = NULL, created_at = now(), updated_at = now()
        WHERE id = %s AND status = 'failed'
        RETURNING id
        """,
        run_id,
    )
    if claimed is None:
        raise HTTPException(409, "Only a failed run can be retried.")

    await execute("DELETE FROM papers WHERE run_id = %s", run_id)
    await execute("DELETE FROM run_events WHERE run_id = %s", run_id)
    start_run(
        run_id,
        user_id,
        row["topic"],
        row.get("mode") or "research",
        row.get("filters"),
        row.get("criteria"),
        seed_paper_ids=row.get("seed_paper_ids") or [],
    )
    return _run_out(await _get_owned_run(run_id, user_id))


@router.delete("/{run_id}", status_code=204)
async def delete_run(run_id: str, user_id: str = CurrentUser) -> None:
    # Papers, chunks, and events cascade; documents keep their sections and
    # just lose the run link (run_id SET NULL). A still-running task fails
    # its next write harmlessly and stops.
    await _get_owned_run(run_id, user_id)
    await execute("DELETE FROM runs WHERE id = %s", run_id)


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
