import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

import prefs as prefs_service
from citations.catalog import style_title
from db import execute, fetch_all, fetch_one
from models import CAPS, LlmConfigIn, LlmConfigOut, PreferencesIn, PreferencesOut
from security import CurrentUser, encrypt_secret

router = APIRouter(prefix="/v1/me", tags=["me"])

_DEFAULT_CAPS = CAPS["fiberarticle_ai"]


def _to_out(row: dict | None) -> LlmConfigOut:
    if row is None:
        # Zero-setup default: managed Fiberarticle AI with the fast model.
        # Mirrors resolve_llm so the UI never shows an "unconfigured" state.
        return LlmConfigOut(
            mode="fiberarticle_ai",
            provider=None,
            model=None,
            base_url=None,
            has_key=False,
            caps=_DEFAULT_CAPS,
            reasoning=False,
        )
    return LlmConfigOut(
        mode=row["mode"],
        provider=row["provider"],
        model=row["model"],
        base_url=row["base_url"],
        has_key=row["encrypted_key"] is not None,
        caps=CAPS.get(row["mode"], _DEFAULT_CAPS),
        reasoning=bool(row["reasoning"]),
    )


def _prefs_out(data: dict) -> PreferencesOut:
    return PreferencesOut(
        citation_style=data["citation_style"],
        citation_style_title=style_title(data["citation_style"])
        or data["citation_style"],
        ai_language=data["ai_language"],
    )


@router.get("/preferences", response_model=PreferencesOut)
async def get_preferences(user_id: str = CurrentUser) -> PreferencesOut:
    return _prefs_out(await prefs_service.get_prefs(user_id))


@router.put("/preferences", response_model=PreferencesOut)
async def put_preferences(
    body: PreferencesIn, user_id: str = CurrentUser
) -> PreferencesOut:
    if body.ai_language and body.ai_language not in prefs_service.LANGUAGES:
        raise HTTPException(422, "Unknown language.")
    if body.citation_style and style_title(body.citation_style) is None:
        raise HTTPException(422, "Unknown citation style.")
    return _prefs_out(
        await prefs_service.set_prefs(user_id, body.citation_style, body.ai_language)
    )


@router.get("/languages")
async def list_languages() -> list[dict]:
    return [
        {"value": value, "label": label}
        for value, label in prefs_service.LANGUAGES.items()
    ]


@router.get("/llm-config", response_model=LlmConfigOut)
async def get_llm_config(user_id: str = CurrentUser) -> LlmConfigOut:
    row = await fetch_one("SELECT * FROM llm_config WHERE user_id = %s", user_id)
    return _to_out(row)


def _rows_for_export(rows: list[dict], drop: tuple[str, ...] = ()) -> list[dict]:
    return [
        {k: v for k, v in row.items() if k not in drop and k != "user_id"}
        for row in rows
    ]


@router.get("/export")
async def export_data(user_id: str = CurrentUser) -> Response:
    """Data portability: everything the user owns, as one JSON download.

    Vector embeddings are omitted (huge, derivable); encrypted API keys are
    never exported.
    """
    data = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "preferences": await prefs_service.get_prefs(user_id),
        "runs": _rows_for_export(
            await fetch_all("SELECT * FROM runs WHERE user_id = %s ORDER BY created_at", user_id)
        ),
        "papers": _rows_for_export(
            await fetch_all("SELECT * FROM papers WHERE user_id = %s ORDER BY created_at", user_id)
        ),
        "documents": _rows_for_export(
            await fetch_all("SELECT * FROM documents WHERE user_id = %s ORDER BY created_at", user_id)
        ),
        "conversations": _rows_for_export(
            await fetch_all("SELECT * FROM conversations WHERE user_id = %s ORDER BY created_at", user_id)
        ),
        "chat_messages": _rows_for_export(
            await fetch_all("SELECT * FROM chat_messages WHERE user_id = %s ORDER BY id", user_id)
        ),
        "extractions": _rows_for_export(
            await fetch_all("SELECT * FROM extractions WHERE user_id = %s ORDER BY created_at", user_id)
        ),
    }
    return Response(
        content=json.dumps(data, ensure_ascii=False, indent=2, default=str),
        media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="fiberarticle-export.json"'
        },
    )


@router.delete("", status_code=204)
async def delete_account_data(user_id: str = CurrentUser) -> None:
    """Right to erasure: purge every row the user owns. The web app deletes
    the Better Auth user afterwards; this endpoint only owns the API data."""
    # Cascades cover children (papers/chunks/events via runs, chunks via
    # papers, messages via conversations); the direct deletes make the
    # erasure complete even for rows without a parent.
    for query in (
        "DELETE FROM extractions WHERE user_id = %s",
        "DELETE FROM conversations WHERE user_id = %s",
        "DELETE FROM chat_messages WHERE user_id = %s",
        "DELETE FROM documents WHERE user_id = %s",
        "DELETE FROM runs WHERE user_id = %s",
        "DELETE FROM papers WHERE user_id = %s",
        "DELETE FROM chunks WHERE user_id = %s",
        "DELETE FROM user_prefs WHERE user_id = %s",
        "DELETE FROM llm_config WHERE user_id = %s",
    ):
        await execute(query, user_id)


@router.put("/llm-config", response_model=LlmConfigOut)
async def put_llm_config(body: LlmConfigIn, user_id: str = CurrentUser) -> LlmConfigOut:
    if body.mode == "byok":
        if not body.provider:
            raise HTTPException(422, "BYOK mode needs a provider.")
        if not body.model:
            raise HTTPException(422, "BYOK mode needs a model.")
        if body.provider == "custom" and not body.base_url:
            raise HTTPException(422, "Custom providers need a base URL.")
    if body.mode == "local":
        if not body.base_url:
            raise HTTPException(422, "Local mode needs the endpoint base URL.")
        if not body.model:
            raise HTTPException(422, "Local mode needs a model name.")

    existing = await fetch_one(
        "SELECT encrypted_key FROM llm_config WHERE user_id = %s", user_id
    )
    if body.api_key:
        encrypted = encrypt_secret(body.api_key)
    elif existing is not None:
        # Key is write-only from the UI; blank means keep the stored key.
        encrypted = existing["encrypted_key"]
    else:
        encrypted = None

    if body.mode == "byok" and encrypted is None:
        raise HTTPException(422, "BYOK mode needs an API key.")

    await execute(
        """
        INSERT INTO llm_config (user_id, mode, provider, model, base_url, encrypted_key, reasoning)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (user_id) DO UPDATE SET
            mode = EXCLUDED.mode,
            provider = EXCLUDED.provider,
            model = EXCLUDED.model,
            base_url = EXCLUDED.base_url,
            encrypted_key = EXCLUDED.encrypted_key,
            reasoning = EXCLUDED.reasoning,
            updated_at = now()
        """,
        user_id,
        body.mode,
        body.provider,
        body.model,
        body.base_url,
        encrypted,
        body.reasoning,
    )
    row = await fetch_one("SELECT * FROM llm_config WHERE user_id = %s", user_id)
    return _to_out(row)
