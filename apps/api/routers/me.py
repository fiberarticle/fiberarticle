from fastapi import APIRouter, HTTPException

from db import execute, fetch_one
from models import CAPS, LlmConfigIn, LlmConfigOut
from security import CurrentUser, encrypt_secret

router = APIRouter(prefix="/v1/me", tags=["me"])

_DEFAULT_CAPS = CAPS["fiberarticle_ai"]


def _to_out(row: dict | None) -> LlmConfigOut:
    if row is None:
        return LlmConfigOut(
            mode=None,
            provider=None,
            model=None,
            base_url=None,
            has_key=False,
            caps=_DEFAULT_CAPS,
            reasoning=True,
        )
    return LlmConfigOut(
        mode=row["mode"],
        provider=row["provider"],
        model=row["model"],
        base_url=row["base_url"],
        has_key=row["encrypted_key"] is not None,
        caps=CAPS.get(row["mode"], _DEFAULT_CAPS),
        reasoning=row["reasoning"] if row["reasoning"] is not None else True,
    )


@router.get("/llm-config", response_model=LlmConfigOut)
async def get_llm_config(user_id: str = CurrentUser) -> LlmConfigOut:
    row = await fetch_one("SELECT * FROM llm_config WHERE user_id = %s", user_id)
    return _to_out(row)


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
