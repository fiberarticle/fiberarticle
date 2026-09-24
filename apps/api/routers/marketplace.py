"""
Microsoft Marketplace routes.

  POST /v1/marketplace/resolve        landing page: what was bought
  POST /v1/marketplace/activate       landing page: start it on this account
  GET  /v1/marketplace/subscriptions  the caller's own subscriptions
  POST /v1/marketplace/webhook        Microsoft: a subscription changed

The landing page routes take the purchase token Microsoft put in the landing
page URL and resolve it with Microsoft every time. They never take a
subscription id from the browser, so knowing an id is not enough to claim
someone else's purchase: only the holder of the token can activate it.

They are open to every signed-in account, locked or not, the same as the
billing routes: they are how a Microsoft buyer's account becomes unlocked.
The webhook has no user at all and is trusted only through the Entra token
Microsoft signs each call with (marketplace.verify_webhook).
"""

import logging
import time
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import billing
import marketplace
from config import get_settings
from db import execute, fetch_one, jsonb
from security import get_current_claims

logger = logging.getLogger("fiberarticle.marketplace")

router = APIRouter(prefix="/v1/marketplace", tags=["marketplace"])


class TokenIn(BaseModel):
    # Microsoft's purchase tokens are a few hundred characters; the cap only
    # stops junk from being posted to Microsoft on our behalf.
    token: str = Field(min_length=8, max_length=8192)


class SubscriptionOut(BaseModel):
    id: str
    name: str | None
    offer_id: str
    plan_id: str
    # PendingFulfillmentStart | Subscribed | Suspended | Unsubscribed
    status: str
    purchaser_email: str | None
    beneficiary_email: str | None
    term_start: datetime | None
    term_end: datetime | None
    auto_renew: bool | None
    is_free_trial: bool
    is_test: bool
    # Which Fiberarticle account the subscription is active on, from the
    # caller's point of view.
    linked: Literal["you", "other", "none"]
    # Whether the caller already had full access some other way (a payment,
    # an admin grant, another subscription), so the page can say so before
    # the buyer starts a second subscription on the same account.
    account_has_full_access: bool


class ActivateOut(BaseModel):
    subscription: SubscriptionOut
    access: Literal["full", "locked"]


class MySubscription(BaseModel):
    id: str
    name: str | None
    plan_id: str
    status: str
    term_start: datetime | None
    term_end: datetime | None
    auto_renew: bool | None
    is_test: bool
    activated_at: datetime | None


# Landing page calls reach Microsoft, so one account may make only so many.
# Far above what a buyer clicking through the page needs, low enough that a
# script cannot get this publisher throttled by Microsoft.
_CALLS_PER_WINDOW = 30
_WINDOW_SECONDS = 600
_recent_calls: dict[str, list[float]] = {}


def _throttle(user_id: str) -> None:
    now = time.monotonic()
    calls = [t for t in _recent_calls.get(user_id, []) if now - t < _WINDOW_SECONDS]
    if len(calls) >= _CALLS_PER_WINDOW:
        raise HTTPException(
            status_code=429,
            detail="Too many attempts in a short time. Wait a few minutes and try again.",
        )
    calls.append(now)
    _recent_calls[user_id] = calls


def _require_enabled() -> None:
    if not marketplace.enabled():
        raise HTTPException(
            status_code=503,
            detail=(
                "Microsoft Marketplace purchases are not set up on this server yet. "
                "Write to admin@fiberarticle.com and we will activate your purchase."
            ),
        )


def _raise_for(exc: marketplace.MarketplaceError) -> None:
    if exc.status in (400, 403, 404):
        raise HTTPException(
            status_code=400,
            detail=(
                "Microsoft did not recognise this purchase link. It may have expired: "
                "open Fiberarticle again from Microsoft Marketplace or the Azure portal "
                "(Configure account)."
            ),
        )
    raise HTTPException(
        status_code=502,
        detail="Microsoft Marketplace could not be reached. Nothing changed; try again in a minute.",
    )


async def _resolve(token: str) -> dict:
    try:
        sub = await marketplace.resolve(token)
    except marketplace.MarketplaceError as exc:
        _raise_for(exc)
    if not marketplace.offer_matches(sub):
        logger.warning("purchase token for another offer: %s", sub.get("offerId"))
        raise HTTPException(status_code=400, detail="This purchase is not for Fiberarticle.")
    return sub


async def _describe(sub: dict, user_id: str, is_admin: bool) -> SubscriptionOut:
    row = marketplace.subscription_row(sub)
    stored = await fetch_one(
        "SELECT user_id FROM marketplace_subscriptions WHERE id = %s", row["id"]
    )
    owner = (stored or {}).get("user_id")
    linked = "none" if not owner else ("you" if owner == user_id else "other")
    billing.forget_access(user_id)
    full = is_admin or await billing.access_of(user_id) == "full"
    return SubscriptionOut(
        id=row["id"],
        name=row["name"],
        offer_id=row["offer_id"],
        plan_id=row["plan_id"],
        status=row["status"],
        purchaser_email=row["purchaser_email"],
        beneficiary_email=row["beneficiary_email"],
        term_start=row["term_start"],
        term_end=row["term_end"],
        auto_renew=row["auto_renew"],
        is_free_trial=row["is_free_trial"],
        is_test=row["is_test"],
        linked=linked,
        # Full access that this very subscription gave does not count.
        account_has_full_access=full and linked != "you",
    )


@router.post("/resolve", response_model=SubscriptionOut)
async def resolve_purchase(body: TokenIn, claims: dict = Depends(get_current_claims)) -> SubscriptionOut:
    _require_enabled()
    _throttle(claims["sub"])
    sub = await _resolve(body.token)
    # Remember what Microsoft said, without linking it to anyone yet: the
    # webhook and the reconcile loop then know about the purchase too.
    await billing.marketplace_sync(sub, action="Resolve")
    return await _describe(sub, claims["sub"], claims.get("role") == "admin")


@router.post("/activate", response_model=ActivateOut)
async def activate_purchase(body: TokenIn, claims: dict = Depends(get_current_claims)) -> ActivateOut:
    """
    Start the subscription on the signed-in account.

    A new purchase waits in PendingFulfillmentStart until we call Activate,
    and Microsoft only starts billing then. If Microsoft already activated
    it (auto activation), this links it to the account instead.
    """
    _require_enabled()
    user_id = claims["sub"]
    _throttle(user_id)
    sub = await _resolve(body.token)
    status = str(sub.get("saasSubscriptionStatus") or marketplace.PENDING)

    if status == marketplace.UNSUBSCRIBED:
        raise HTTPException(
            status_code=409, detail="This subscription was cancelled, so it cannot be activated."
        )
    stored = await fetch_one(
        "SELECT user_id FROM marketplace_subscriptions WHERE id = %s", str(sub["id"])
    )
    if stored and stored["user_id"] and stored["user_id"] != user_id:
        raise HTTPException(
            status_code=409,
            detail=(
                "This Microsoft Marketplace subscription is already active on another "
                "Fiberarticle account. Sign in with that account, or write to "
                "admin@fiberarticle.com."
            ),
        )
    if status == marketplace.SUSPENDED:
        raise HTTPException(
            status_code=409,
            detail=(
                "Microsoft has suspended this subscription, usually because a payment "
                "did not go through. Settle it in the Azure portal and your access "
                "returns on its own."
            ),
        )

    if status == marketplace.PENDING:
        try:
            await marketplace.activate(str(sub["id"]), str(sub.get("planId") or ""), sub.get("quantity"))
        except marketplace.MarketplaceError as exc:
            # A second click, or a retry after a dropped connection, can find
            # it already active; Microsoft's current view settles it.
            try:
                current = await marketplace.get_subscription(str(sub["id"]))
            except marketplace.MarketplaceError:
                _raise_for(exc)
            if str(current.get("saasSubscriptionStatus")) != marketplace.SUBSCRIBED:
                _raise_for(exc)
            sub = current
        else:
            # Microsoft answered 200: the subscription is live and billing has
            # started. Its GET can lag a moment behind, so record it as live
            # now; the reconcile loop re-reads it later anyway.
            sub = {**sub, "saasSubscriptionStatus": marketplace.SUBSCRIBED}
            try:
                current = await marketplace.get_subscription(str(sub["id"]))
                if str(current.get("saasSubscriptionStatus")) == marketplace.SUBSCRIBED:
                    sub = current
            except marketplace.MarketplaceError:
                pass

    await billing.marketplace_link(user_id, sub)
    out = await _describe(sub, user_id, claims.get("role") == "admin")
    billing.forget_access(user_id)
    access = await billing.access_of(user_id)
    return ActivateOut(
        subscription=out,
        access="full" if claims.get("role") == "admin" or access == "full" else "locked",
    )


@router.get("/subscriptions", response_model=list[MySubscription])
async def my_subscriptions(claims: dict = Depends(get_current_claims)) -> list[MySubscription]:
    rows = await billing.marketplace_subscriptions_of(claims["sub"])
    return [MySubscription(**r) for r in rows]


# Microsoft wants a 200 for anything it should stop retrying. These are the
# actions that change a subscription; anything else is acknowledged as is.
_KNOWN_ACTIONS = {
    "Subscribe",
    "ChangePlan",
    "ChangeQuantity",
    "Renew",
    "Suspend",
    "Unsubscribe",
    "Reinstate",
    "Transfer",
}
# Changes Microsoft asks the publisher to confirm (PATCH the operation). Every
# plan of this offer gives the same full access, so they are always accepted.
_CONFIRM_ACTIONS = {"ChangePlan", "ChangeQuantity", "Reinstate"}


@router.post("/webhook")
async def marketplace_webhook(request: Request):
    """
    Microsoft's notice that a subscription changed.

    The token is checked before the body is even parsed. The subscription is
    then re-read from Microsoft, so the stored state always comes from
    Microsoft's current view, not from whatever the notice says, and notices
    arriving out of order or twice cannot unlock or lock anyone wrongly.
    """
    if not get_settings().marketplace_configured:
        return JSONResponse({"error": "not configured"}, status_code=503)
    try:
        await marketplace.verify_webhook(request.headers.get("Authorization"))
    except marketplace.WebhookUnauthorized as exc:
        logger.warning("marketplace webhook refused: %s", exc)
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    except marketplace.MarketplaceError:
        # Could not read Entra's keys: let Microsoft retry later.
        return JSONResponse({"error": "try again"}, status_code=503)

    try:
        payload = await request.json()
    except ValueError:
        return JSONResponse({"error": "bad json"}, status_code=400)
    if not isinstance(payload, dict):
        return JSONResponse({"error": "bad payload"}, status_code=400)

    operation_id = str(payload.get("id") or "")
    subscription_id = str(payload.get("subscriptionId") or "")
    action = str(payload.get("action") or "")
    op_status = str(payload.get("status") or "")
    if not operation_id or not subscription_id:
        return {"ok": True}

    if payload.get("offerId") and not marketplace.offer_matches({"offerId": payload.get("offerId")}):
        logger.warning("webhook for another offer %s", payload.get("offerId"))
        return {"ok": True}

    seen = await fetch_one(
        "SELECT processed_at FROM marketplace_events WHERE operation_id = %s", operation_id
    )
    if seen and seen["processed_at"] is not None:
        return {"ok": True}
    if seen is None:
        await execute(
            """
            INSERT INTO marketplace_events (operation_id, subscription_id, action, status, payload)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (operation_id) DO NOTHING
            """,
            operation_id,
            subscription_id,
            action,
            op_status,
            jsonb(payload),
        )

    if action not in _KNOWN_ACTIONS:
        logger.info("marketplace webhook action %s acknowledged without change", action)
    else:
        try:
            try:
                sub = await marketplace.get_subscription(subscription_id)
            except marketplace.MarketplaceError as exc:
                if exc.status != 404 or not isinstance(payload.get("subscription"), dict):
                    raise
                # Gone from Microsoft's list: the notice's copy is the last word.
                sub = payload["subscription"]
            if marketplace.offer_matches(sub):
                await billing.marketplace_sync(sub, action=action, operation_id=operation_id)
            if action in _CONFIRM_ACTIONS and op_status.lower() == "inprogress":
                try:
                    await marketplace.patch_operation(subscription_id, operation_id, True)
                except marketplace.MarketplaceError:
                    # Microsoft settles an unanswered operation on its own.
                    logger.warning("could not confirm operation %s", operation_id)
        except Exception:
            # Nothing was marked processed: Microsoft retries, and the next
            # try picks up from here.
            logger.exception("marketplace webhook %s for %s failed", action, subscription_id)
            return JSONResponse({"error": "try again"}, status_code=500)

    await execute(
        "UPDATE marketplace_events SET processed_at = now() WHERE operation_id = %s",
        operation_id,
    )
    return {"ok": True}
