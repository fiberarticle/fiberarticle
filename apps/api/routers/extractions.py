"""Structured data extraction across papers: custom columns, per-cell source
quotes for verification, CSV export."""

import asyncio
import csv
import io
import json
import logging
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from db import execute, fetch_all, fetch_one, jsonb
from llm.client import LlmNotConfigured, resolve_llm
from llm.titles import schedule_title
from models import (
    ExtractionColumn,
    ExtractionCreateIn,
    ExtractionOut,
    ExtractionUpdate,
)
from security import CurrentUser

router = APIRouter(prefix="/v1/extractions", tags=["extractions"])

logger = logging.getLogger("fiberarticle.extractions")


def _extraction_out(row: dict) -> ExtractionOut:
    return ExtractionOut(
        id=str(row["id"]),
        name=row["name"],
        status=row["status"],
        pinned=bool(row.get("pinned")),
        total_papers=len(row["paper_ids"] or []),
        columns=[ExtractionColumn(**c) for c in row["columns"]],
        rows=row["rows"] or [],
        error=row["error"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def _get_owned(extraction_id: str, user_id: str) -> dict:
    row = await fetch_one(
        "SELECT * FROM extractions WHERE id = %s AND user_id = %s",
        extraction_id,
        user_id,
    )
    if row is None:
        raise HTTPException(404, "Extraction not found")
    return row


def _parse_json_object(text: str) -> dict | None:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


async def _extract_for_paper(
    llm, user_id: str, paper: dict, columns: list[dict]
) -> dict:
    chunks = await fetch_all(
        "SELECT content FROM chunks WHERE paper_id = %s AND user_id = %s ORDER BY id LIMIT 8",
        paper["id"],
        user_id,
    )
    material = "\n\n".join(c["content"][:1000] for c in chunks) or (
        paper.get("abstract") or ""
    )
    row: dict = {
        "paper_id": str(paper["id"]),
        "title": paper["title"],
        "year": paper.get("year"),
        "cells": {},
    }
    if not material.strip():
        for col in columns:
            row["cells"][col["name"]] = {
                "value": "No text available",
                "quote": None,
            }
        return row

    spec = "\n".join(f"- {c['name']}: {c['description']}" for c in columns)
    text = await llm.complete(
        [
            {
                "role": "system",
                "content": (
                    "Extract the requested fields from the paper text. Respond "
                    "with ONLY a JSON object mapping each field name to an "
                    "object {\"value\": string, \"quote\": string}. The quote "
                    "must be a short verbatim passage from the text that "
                    "supports the value. If a field is not stated in the text, "
                    "use {\"value\": \"Not reported\", \"quote\": null}."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Fields to extract:\n{spec}\n\n"
                    f"Paper: {paper['title']}\n\nText:\n{material[:9000]}"
                ),
            },
        ],
        max_tokens=1000,
    )
    parsed = _parse_json_object(text) or {}
    for col in columns:
        cell = parsed.get(col["name"])
        if isinstance(cell, dict) and "value" in cell:
            row["cells"][col["name"]] = {
                "value": str(cell.get("value") or "Not reported")[:600],
                "quote": (str(cell["quote"])[:400] if cell.get("quote") else None),
            }
        elif isinstance(cell, str):
            row["cells"][col["name"]] = {"value": cell[:600], "quote": None}
        else:
            row["cells"][col["name"]] = {"value": "Not reported", "quote": None}
    return row


async def _run_extraction(extraction_id: str, user_id: str) -> None:
    try:
        extraction = await fetch_one(
            "SELECT * FROM extractions WHERE id = %s", extraction_id
        )
        llm = await resolve_llm(user_id)
        columns = extraction["columns"]
        rows: list[dict] = []
        for paper_id in extraction["paper_ids"]:
            paper = await fetch_one(
                "SELECT * FROM papers WHERE id = %s AND user_id = %s",
                paper_id,
                user_id,
            )
            if paper is None:
                continue
            row = await _extract_for_paper(llm, user_id, paper, columns)
            rows.append(row)
            await execute(
                "UPDATE extractions SET rows = %s, updated_at = now() WHERE id = %s",
                jsonb(rows),
                extraction_id,
            )
        await execute(
            "UPDATE extractions SET status = 'ready', updated_at = now() WHERE id = %s",
            extraction_id,
        )
    except Exception as exc:
        logger.exception("extraction %s failed", extraction_id)
        await execute(
            "UPDATE extractions SET status = 'failed', error = %s, updated_at = now() WHERE id = %s",
            str(exc),
            extraction_id,
        )


@router.get("", response_model=list[ExtractionOut])
async def list_extractions(user_id: str = CurrentUser) -> list[ExtractionOut]:
    rows = await fetch_all(
        "SELECT * FROM extractions WHERE user_id = %s ORDER BY created_at DESC LIMIT 50",
        user_id,
    )
    return [_extraction_out(r) for r in rows]


@router.post("", response_model=ExtractionOut, status_code=201)
async def create_extraction(
    body: ExtractionCreateIn, user_id: str = CurrentUser
) -> ExtractionOut:
    try:
        await resolve_llm(user_id)
    except LlmNotConfigured as exc:
        raise HTTPException(409, str(exc))

    names = [c.name.strip() for c in body.columns]
    if len(set(n.lower() for n in names)) != len(names):
        raise HTTPException(422, "Column names must be unique.")

    owned = await fetch_all(
        "SELECT id FROM papers WHERE user_id = %s AND id = ANY(%s::uuid[])",
        user_id,
        body.paper_ids,
    )
    owned_ids = [str(r["id"]) for r in owned]
    if not owned_ids:
        raise HTTPException(422, "None of those papers belong to your account.")

    name = body.name.strip()
    row = await fetch_one(
        """
        INSERT INTO extractions (user_id, name, columns, paper_ids)
        VALUES (%s, %s, %s, %s)
        RETURNING *
        """,
        user_id,
        name or "New extraction",
        jsonb([c.model_dump() for c in body.columns]),
        jsonb(owned_ids),
    )
    asyncio.create_task(_run_extraction(str(row["id"]), user_id))
    if not name:
        # No user-given name: title it from what is being extracted.
        spec = "; ".join(f"{c.name}: {c.description}" for c in body.columns)
        schedule_title(
            "extraction",
            str(row["id"]),
            user_id,
            f"Extract these fields from {len(owned_ids)} papers: {spec}",
        )
    return _extraction_out(row)


@router.get("/{extraction_id}", response_model=ExtractionOut)
async def get_extraction(
    extraction_id: str, user_id: str = CurrentUser
) -> ExtractionOut:
    return _extraction_out(await _get_owned(extraction_id, user_id))


@router.patch("/{extraction_id}", response_model=ExtractionOut)
async def update_extraction(
    extraction_id: str, body: ExtractionUpdate, user_id: str = CurrentUser
) -> ExtractionOut:
    await _get_owned(extraction_id, user_id)
    if body.name is not None:
        await execute(
            "UPDATE extractions SET name = %s, updated_at = now() WHERE id = %s",
            body.name.strip(),
            extraction_id,
        )
    if body.pinned is not None:
        await execute(
            "UPDATE extractions SET pinned = %s, updated_at = now() WHERE id = %s",
            body.pinned,
            extraction_id,
        )
    return _extraction_out(await _get_owned(extraction_id, user_id))


@router.delete("/{extraction_id}", status_code=204)
async def delete_extraction(extraction_id: str, user_id: str = CurrentUser) -> None:
    await _get_owned(extraction_id, user_id)
    await execute("DELETE FROM extractions WHERE id = %s", extraction_id)


@router.get("/{extraction_id}/export")
async def export_extraction(
    extraction_id: str, user_id: str = CurrentUser
) -> Response:
    row = await _get_owned(extraction_id, user_id)
    columns = [c["name"] for c in row["columns"]]
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Paper", "Year", *columns, *(f"{c} (source quote)" for c in columns)])
    for r in row["rows"] or []:
        cells = r.get("cells", {})
        writer.writerow(
            [
                r.get("title"),
                r.get("year"),
                *[(cells.get(c) or {}).get("value", "") for c in columns],
                *[(cells.get(c) or {}).get("quote", "") or "" for c in columns],
            ]
        )
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", row["name"]).strip("-").lower()[:60] or "extraction"
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{slug}.csv"'},
    )
