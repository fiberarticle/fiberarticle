import hashlib
import os
import time

import httpx
import jwt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import Depends, HTTPException, Request
from jwt import PyJWK

from config import get_settings

_jwks_cache: dict = {"keys": None, "fetched_at": 0.0}
_JWKS_TTL_SECONDS = 300


async def _get_jwks() -> list[dict]:
    now = time.monotonic()
    if _jwks_cache["keys"] is not None and now - _jwks_cache["fetched_at"] < _JWKS_TTL_SECONDS:
        return _jwks_cache["keys"]
    settings = get_settings()
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(settings.jwks_url)
        res.raise_for_status()
        keys = res.json().get("keys", [])
    _jwks_cache["keys"] = keys
    _jwks_cache["fetched_at"] = now
    return keys


def _invalidate_jwks_cache() -> None:
    _jwks_cache["keys"] = None
    _jwks_cache["fetched_at"] = 0.0


async def verify_bearer_token(token: str) -> dict:
    settings = get_settings()
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    kid = header.get("kid")

    for attempt in range(2):
        keys = await _get_jwks()
        jwk_data = None
        if kid:
            jwk_data = next((k for k in keys if k.get("kid") == kid), None)
        elif keys:
            jwk_data = keys[0]
        if jwk_data is None:
            if attempt == 0:
                # Key rotation: refetch JWKS once before rejecting.
                _invalidate_jwks_cache()
                continue
            raise HTTPException(status_code=401, detail="Unknown signing key")
        try:
            key = PyJWK.from_dict(jwk_data).key
            # Better Auth signs with Ed25519 only; never trust the alg an
            # attacker can put in the token header.
            payload = jwt.decode(
                token,
                key=key,
                algorithms=["EdDSA"],
                issuer=settings.web_url,
                audience=settings.web_url,
            )
            return payload
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid token")
    raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_claims(request: Request) -> dict:
    """Every verified claim in the bearer token, not just the subject."""
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    payload = await verify_bearer_token(authorization.removeprefix("Bearer ").strip())
    if not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Token has no subject")
    return payload


async def get_current_user_id(request: Request) -> str:
    claims = await get_current_claims(request)
    return claims["sub"]


async def get_admin_user_id(request: Request) -> str:
    """
    Admin gate for every /v1/admin route.

    The role is read from the signed token and nowhere else. It cannot come
    from a header or a query parameter, because the caller controls those; the
    token is signed by the web app with a key only the web app holds, so a
    forged or edited one fails verification before this line is reached.

    404 rather than 403 on purpose: a non-admin gets the same answer as if the
    route did not exist, so probing tells them nothing about what is there.
    """
    claims = await get_current_claims(request)
    if claims.get("role") != "admin":
        raise HTTPException(status_code=404, detail="Not found")
    return claims["sub"]


CurrentUser = Depends(get_current_user_id)
AdminUser = Depends(get_admin_user_id)


def _master_key() -> bytes:
    return hashlib.sha256(get_settings().key_encryption_secret.encode()).digest()


def encrypt_secret(plaintext: str) -> bytes:
    nonce = os.urandom(12)
    ciphertext = AESGCM(_master_key()).encrypt(nonce, plaintext.encode(), None)
    return nonce + ciphertext


def decrypt_secret(blob: bytes) -> str:
    nonce, ciphertext = blob[:12], blob[12:]
    return AESGCM(_master_key()).decrypt(nonce, ciphertext, None).decode()
