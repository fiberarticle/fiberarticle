"""
Microsoft Marketplace: the SaaS Fulfillment API v2 and its webhook.

Fiberarticle is sold on Microsoft Marketplace as a "Sell through Microsoft"
SaaS offer. Microsoft takes the payment; this module is how the API learns
about a purchase and tells Microsoft when the buyer's account is ready.

  resolve            the landing page's purchase token -> the subscription
  activate           the buyer finished on the landing page; billing starts
  get_subscription   Microsoft's current view of one subscription
  patch_operation    answer a change Microsoft asked us to confirm
  verify_webhook     prove a webhook call really came from Microsoft
  reconcile_loop     re-read every subscription now and then, in case a
                     webhook call was missed while the API was down

What any of it means for access (unlocking, locking, the payments ledger) is
decided in billing.py, like every other change to "user".access.

The API signs in to Microsoft with the single-tenant Entra app named in the
offer's technical configuration (MARKETPLACE_TENANT_ID, _CLIENT_ID,
_CLIENT_SECRET). Microsoft signs every webhook call with a token issued to
that same app, which is how verify_webhook knows who is calling.
"""

import asyncio
import logging
import re
import time
import uuid
from datetime import datetime
from typing import Any

import httpx
import jwt
from jwt import PyJWK

from config import get_settings

logger = logging.getLogger("fiberarticle.marketplace")

# The Microsoft Marketplace service. Tokens for the fulfillment API are
# requested for this resource, and it is the app that signs webhook calls.
MARKETPLACE_APP_ID = "20e940b3-4c77-4b0b-9a53-9e16a1b010a7"
API_VERSION = "2018-08-31"

# Subscription states, as Microsoft names them.
PENDING = "PendingFulfillmentStart"
SUBSCRIBED = "Subscribed"
SUSPENDED = "Suspended"
UNSUBSCRIBED = "Unsubscribed"

_RETRYABLE = {408, 429, 500, 502, 503, 504}

# Microsoft's SaaS API emulator tells publishers apart by an Entra token or,
# without one, by this query parameter. FourthCoffee is its default, which
# its own pages (token generator, subscription list) use as well.
_EMULATOR_PUBLISHER = "FourthCoffee"


class MarketplaceError(Exception):
    """A call to Microsoft failed. status is Microsoft's HTTP status (0 when
    Microsoft could not be reached at all)."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def enabled() -> bool:
    """Whether marketplace purchases can be handled at all: the Entra app is
    configured, or a development machine points at Microsoft's emulator."""
    s = get_settings()
    return s.marketplace_configured or _emulated()


def _emulated() -> bool:
    return not get_settings().marketplace_api_base.startswith(
        "https://marketplaceapi.microsoft.com"
    )


# ---------------------------------------------------------------- tokens


_token: dict[str, Any] = {"value": None, "expires_at": 0.0}
_token_lock = asyncio.Lock()


async def _access_token() -> str | None:
    """A client-credentials token for the fulfillment API, reused until a
    minute before it expires. None only when talking to the emulator without
    an app configured, which accepts unauthenticated calls."""
    s = get_settings()
    if not s.marketplace_configured:
        if _emulated():
            return None
        raise MarketplaceError(503, "Microsoft Marketplace is not configured on this server.")
    async with _token_lock:
        if _token["value"] and time.monotonic() < _token["expires_at"] - 60:
            return _token["value"]
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                res = await client.post(
                    f"https://login.microsoftonline.com/{s.marketplace_tenant_id}/oauth2/v2.0/token",
                    data={
                        "grant_type": "client_credentials",
                        "client_id": s.marketplace_client_id,
                        "client_secret": s.marketplace_client_secret,
                        "scope": f"{MARKETPLACE_APP_ID}/.default",
                    },
                )
        except httpx.HTTPError as exc:
            raise MarketplaceError(0, "Could not reach Microsoft to sign in.") from exc
        if res.status_code != 200:
            # The body names the problem (a wrong secret, an expired secret)
            # without containing the secret itself.
            logger.error("Entra token request failed (%s): %s", res.status_code, res.text[:300])
            raise MarketplaceError(503, "Could not sign in to Microsoft Marketplace.")
        body = res.json()
        _token["value"] = body["access_token"]
        _token["expires_at"] = time.monotonic() + float(body.get("expires_in", 3600))
        return _token["value"]


def _forget_token() -> None:
    _token["value"] = None
    _token["expires_at"] = 0.0


# ---------------------------------------------------------------- API calls


async def _call(
    method: str,
    path: str,
    *,
    json: dict | None = None,
    extra_headers: dict | None = None,
    url: str | None = None,
) -> Any:
    """One call to the fulfillment API, retried on throttling and on
    Microsoft's own failures. path is relative to /saas; url overrides it for
    the continuation links Microsoft hands back when listing."""
    s = get_settings()
    target = url or f"{s.marketplace_api_base.rstrip('/')}/saas{path}"
    params = None if url else {"api-version": API_VERSION}
    signed_in_again = False

    for attempt in range(4):
        headers = {
            "Content-Type": "application/json",
            "x-ms-requestid": str(uuid.uuid4()),
            "x-ms-correlationid": str(uuid.uuid4()),
            **(extra_headers or {}),
        }
        token = await _access_token()
        query = params
        if token:
            headers["Authorization"] = f"Bearer {token}"
        else:
            # Only reached against the emulator (see _access_token).
            query = {**(params or {}), "publisherId": _EMULATOR_PUBLISHER}
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                res = await client.request(method, target, params=query, json=json, headers=headers)
        except httpx.HTTPError as exc:
            if attempt < 3:
                await asyncio.sleep(1.5 * (2**attempt))
                continue
            raise MarketplaceError(0, "Microsoft Marketplace could not be reached.") from exc

        if res.status_code == 401 and token and not signed_in_again:
            # A token revoked or rotated early: sign in once more and retry.
            _forget_token()
            signed_in_again = True
            continue
        if res.status_code in _RETRYABLE and attempt < 3:
            retry_after = res.headers.get("Retry-After", "")
            delay = float(retry_after) if retry_after.isdigit() else 1.5 * (2**attempt)
            await asyncio.sleep(min(delay, 20.0))
            continue
        if res.status_code >= 400:
            logger.warning(
                "Marketplace %s %s answered %s: %s", method, path or url, res.status_code, res.text[:300]
            )
            raise MarketplaceError(res.status_code, _message_for(res.status_code))
        if res.status_code == 204 or not res.content:
            return None
        try:
            return res.json()
        except ValueError:
            # Activate and the operation PATCH answer 200 without a JSON
            # body; there is nothing in it to read.
            return None

    raise MarketplaceError(503, "Microsoft Marketplace is busy. Try again in a minute.")


def _message_for(status: int) -> str:
    if status in (400, 404):
        return "Microsoft did not recognise this purchase."
    if status == 403:
        return "This purchase belongs to a different publisher."
    return "Microsoft Marketplace did not accept the request."


async def resolve(purchase_token: str) -> dict:
    """The landing page token -> the subscription it stands for.

    The token arrives URL-decoded by the web app; Microsoft wants it exactly
    as it appeared in the landing page URL's query string, which is the
    decoded form (the header carries it as is)."""
    body = await _call(
        "POST",
        "/subscriptions/resolve",
        extra_headers={"x-ms-marketplace-token": purchase_token},
    )
    if not isinstance(body, dict) or not body.get("id"):
        raise MarketplaceError(502, "Microsoft sent back an unexpected answer.")
    # The resolve answer nests the full subscription; fill anything the
    # nested object leaves out from the top level.
    sub = dict(body.get("subscription") or {})
    sub.setdefault("id", body["id"])
    sub.setdefault("offerId", body.get("offerId"))
    sub.setdefault("planId", body.get("planId"))
    sub.setdefault("name", body.get("subscriptionName"))
    if body.get("quantity") is not None:
        sub.setdefault("quantity", body.get("quantity"))
    return sub


async def get_subscription(subscription_id: str) -> dict:
    return await _call("GET", f"/subscriptions/{subscription_id}")


async def activate(subscription_id: str, plan_id: str, quantity: int | None = None) -> None:
    body: dict[str, Any] = {"planId": plan_id}
    if quantity is not None:
        body["quantity"] = quantity
    await _call("POST", f"/subscriptions/{subscription_id}/activate", json=body)


async def patch_operation(subscription_id: str, operation_id: str, succeeded: bool) -> None:
    await _call(
        "PATCH",
        f"/subscriptions/{subscription_id}/operations/{operation_id}",
        json={"status": "Success" if succeeded else "Failure"},
    )


async def list_subscriptions() -> list[dict]:
    subs: list[dict] = []
    body = await _call("GET", "/subscriptions")
    for _ in range(1000):
        if not isinstance(body, dict):
            break
        subs.extend(body.get("subscriptions") or [])
        next_link = body.get("@nextLink") or body.get("nextLink")
        if not next_link:
            break
        body = await _call("GET", "", url=next_link)
    return subs


# ---------------------------------------------------------------- webhook


_ms_keys: dict[str, Any] = {"keys": None, "fetched_at": 0.0}
_MS_KEYS_TTL_SECONDS = 3600
# A token naming a key we do not have forces a fresh read, at most this
# often: otherwise anyone could make every forged call fetch from Entra.
_MS_KEYS_MIN_REFRESH_SECONDS = 300


async def _signing_keys(refresh: bool = False) -> dict[str, dict]:
    """Entra's signing keys for our tenant, by key id. Both the v1 and v2
    key lists are read: Microsoft may send either kind of token."""
    now = time.monotonic()
    if _ms_keys["keys"] is not None:
        age = now - _ms_keys["fetched_at"]
        if age < (_MS_KEYS_MIN_REFRESH_SECONDS if refresh else _MS_KEYS_TTL_SECONDS):
            return _ms_keys["keys"]
    tenant = get_settings().marketplace_tenant_id
    keys: dict[str, dict] = {}
    async with httpx.AsyncClient(timeout=15) as client:
        for url in (
            f"https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys",
            f"https://login.microsoftonline.com/{tenant}/discovery/keys",
        ):
            try:
                res = await client.get(url)
                res.raise_for_status()
            except httpx.HTTPError:
                logger.warning("could not read Entra signing keys from %s", url)
                continue
            for key in res.json().get("keys", []):
                if key.get("kid"):
                    keys[key["kid"]] = key
    if not keys:
        raise MarketplaceError(503, "Could not read Microsoft's signing keys.")
    _ms_keys["keys"] = keys
    _ms_keys["fetched_at"] = now
    return keys


class WebhookUnauthorized(Exception):
    pass


async def verify_webhook(authorization: str | None) -> dict:
    """
    Check the bearer token on a webhook call and return its claims.

    Microsoft signs each call with an Entra token addressed to the app in
    the offer's technical configuration. It must be signed by Entra for our
    tenant (tid), addressed to our app (aud), and issued to the Microsoft
    Marketplace service (appid/azp). Anything else is someone else calling.
    """
    s = get_settings()
    if not s.marketplace_configured:
        raise WebhookUnauthorized("marketplace not configured")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise WebhookUnauthorized("no bearer token")
    token = authorization[7:].strip()
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as exc:
        raise WebhookUnauthorized("unreadable token") from exc
    kid = header.get("kid")
    if not kid:
        raise WebhookUnauthorized("token has no key id")

    keys = await _signing_keys()
    if kid not in keys:
        # Entra rotates keys; read them again once before refusing.
        keys = await _signing_keys(refresh=True)
    if kid not in keys:
        raise WebhookUnauthorized("unknown signing key")

    tenant = s.marketplace_tenant_id
    client_id = s.marketplace_client_id
    try:
        claims = jwt.decode(
            token,
            key=PyJWK.from_dict(keys[kid]).key,
            algorithms=["RS256"],
            audience=[client_id, f"api://{client_id}"],
            issuer=[
                f"https://sts.windows.net/{tenant}/",
                f"https://login.microsoftonline.com/{tenant}/v2.0",
            ],
            options={"require": ["exp", "iat", "aud", "iss"]},
            leeway=60,
        )
    except jwt.InvalidTokenError as exc:
        raise WebhookUnauthorized(f"invalid token: {type(exc).__name__}") from exc

    if claims.get("tid") != tenant:
        raise WebhookUnauthorized("token is for another tenant")
    caller = claims.get("appid") or claims.get("azp")
    allowed = {MARKETPLACE_APP_ID} | {
        a.strip() for a in s.marketplace_webhook_extra_app_ids.split(",") if a.strip()
    }
    if caller not in allowed:
        raise WebhookUnauthorized("token was not issued to Microsoft Marketplace")
    return claims


# ---------------------------------------------------------------- shapes


_FRACTION_RE = re.compile(r"(\.\d{6})\d+")


def _parse_time(value: Any) -> datetime | None:
    """Microsoft's timestamps, which can carry seven fractional digits."""
    if not value or not isinstance(value, str):
        return None
    text = _FRACTION_RE.sub(r"\1", value.strip()).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def subscription_row(sub: dict) -> dict:
    """The columns of marketplace_subscriptions for one subscription."""
    term = sub.get("term") or {}
    purchaser = sub.get("purchaser") or {}
    beneficiary = sub.get("beneficiary") or {}
    quantity = sub.get("quantity")
    return {
        "id": str(sub["id"]),
        "offer_id": str(sub.get("offerId") or ""),
        "plan_id": str(sub.get("planId") or ""),
        "quantity": int(quantity) if isinstance(quantity, (int, float)) else None,
        "status": str(sub.get("saasSubscriptionStatus") or PENDING),
        "name": sub.get("name"),
        "purchaser_email": purchaser.get("emailId"),
        "purchaser_tenant_id": purchaser.get("tenantId"),
        "beneficiary_email": beneficiary.get("emailId"),
        "beneficiary_tenant_id": beneficiary.get("tenantId"),
        "term_start": _parse_time(term.get("startDate")),
        "term_end": _parse_time(term.get("endDate")),
        "term_unit": term.get("termUnit"),
        "auto_renew": sub.get("autoRenew") if isinstance(sub.get("autoRenew"), bool) else None,
        "is_free_trial": bool(sub.get("isFreeTrial")),
        "is_test": bool(sub.get("isTest")),
        "raw": sub,
    }


def offer_matches(sub: dict) -> bool:
    """False when the purchase is for an offer other than ours. While the
    offer is in preview, Microsoft reports its id with "-preview" added."""
    expected = get_settings().marketplace_offer_id.strip()
    if not expected:
        return True
    return str(sub.get("offerId") or "") in (expected, f"{expected}-preview")


# ---------------------------------------------------------------- reconcile


_RECONCILE_EVERY_SECONDS = 6 * 3600


async def reconcile_once() -> int:
    """Read every subscription from Microsoft and apply any change the
    webhook did not deliver. Returns how many subscriptions were read."""
    import billing  # billing imports this module; import late to avoid a cycle

    subs = await list_subscriptions()
    for sub in subs:
        try:
            if offer_matches(sub):
                await billing.marketplace_sync(sub, action="Reconcile")
        except Exception:
            logger.exception("reconcile failed for subscription %s", sub.get("id"))
    return len(subs)


async def reconcile_loop() -> None:
    """Started with the API when the marketplace is configured. Microsoft
    retries a webhook call for about eight hours; this catches anything that
    was still missed, for example while the database was paused."""
    await asyncio.sleep(90)
    while True:
        try:
            count = await reconcile_once()
            logger.info("marketplace reconcile read %d subscription(s)", count)
        except Exception:
            logger.exception("marketplace reconcile failed")
        await asyncio.sleep(_RECONCILE_EVERY_SECONDS)
