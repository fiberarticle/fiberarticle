"""
Billing API: the price, buying full access through Razorpay, and the
Razorpay webhook.

These routes are open to every signed-in account, locked or not: they are how
a locked account becomes unlocked. The webhook has no user at all and is
trusted only through Razorpay's signature.
"""

import json
import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

import billing
from config import get_settings
from db import fetch_one
from security import get_current_claims

logger = logging.getLogger("fiberarticle.billing")

router = APIRouter(prefix="/v1/billing", tags=["billing"])

# How many checkouts one person may open in an hour. Far above what a real
# buyer needs (a failed card, a retry, a second method), low enough that a
# script cannot flood the Razorpay account with orders.
_MAX_ORDERS_PER_HOUR = 12


class Price(BaseModel):
    usd: int
    # Whole rupees. The three are null when today's exchange rate could not
    # be fetched; the page then shows the dollar price alone and the checkout
    # retries the rate.
    #   plan_inr   the dollar price at today's rate
    #   fee_inr    Razorpay's fee, which the buyer pays on top
    #   total_inr  what the buyer is charged
    plan_inr: int | None
    fee_inr: int | None
    total_inr: int | None
    # Razorpay's share of a payment, as a percentage (2.36 = 2% + 18% GST).
    fee_percent: float
    usd_inr_rate: float | None
    rate_fetched_at: datetime | None


class LedgerRow(BaseModel):
    id: str
    provider: str
    status: str
    price_usd: int
    amount: int
    plan_amount: int
    fee_amount: int
    currency: str
    order_id: str | None
    payment_id: str | None
    method: str | None
    livemode: bool
    note: str | None
    paid_at: datetime | None
    created_at: datetime


class BillingStatus(BaseModel):
    access: Literal["full", "locked"]
    # admin: role admin, always full | payment: bought it | grant: given by an
    # admin | none: locked
    via: Literal["admin", "payment", "grant", "none"]
    price: Price
    payments_open: bool
    history: list[LedgerRow]


class OrderOut(BaseModel):
    key_id: str
    order_id: str
    # Paise, as Razorpay's checkout expects.
    amount: int
    currency: str
    plan_inr: int
    fee_inr: int
    total_inr: int
    price_usd: int
    usd_inr_rate: float
    name: str
    email: str
    description: str


class VerifyIn(BaseModel):
    razorpay_order_id: str = Field(min_length=6, max_length=64)
    razorpay_payment_id: str = Field(min_length=6, max_length=64)
    razorpay_signature: str = Field(min_length=16, max_length=256)


async def _price() -> Price:
    usd = billing.price_usd()
    fee_percent = float(round(billing.fee_rate() * 100, 2))
    try:
        rate, fetched_at = await billing.usd_inr()
    except HTTPException:
        return Price(
            usd=usd,
            plan_inr=None,
            fee_inr=None,
            total_inr=None,
            fee_percent=fee_percent,
            usd_inr_rate=None,
            rate_fetched_at=None,
        )
    amounts = billing.quote(usd, rate)
    return Price(
        usd=usd,
        plan_inr=amounts["plan"],
        fee_inr=amounts["fee"],
        total_inr=amounts["total"],
        fee_percent=fee_percent,
        usd_inr_rate=float(rate),
        rate_fetched_at=fetched_at,
    )


async def _status(claims: dict) -> BillingStatus:
    user_id = claims["sub"]
    is_admin = claims.get("role") == "admin"
    billing.forget_access(user_id)
    access = await billing.access_of(user_id)
    history = await billing.payments_of(user_id)

    if is_admin:
        via = "admin"
    elif access != "full":
        via = "none"
    elif any(r["status"] == "paid" for r in history):
        via = "payment"
    else:
        via = "grant"

    return BillingStatus(
        access="full" if is_admin or access == "full" else "locked",
        via=via,
        price=await _price(),
        payments_open=billing.payments_open(),
        history=[LedgerRow(**r) for r in history],
    )


@router.get("", response_model=BillingStatus)
async def billing_status(claims: dict = Depends(get_current_claims)) -> BillingStatus:
    return await _status(claims)


@router.post("/order", response_model=OrderOut, status_code=201)
async def create_order(claims: dict = Depends(get_current_claims)) -> OrderOut:
    user_id = claims["sub"]
    if claims.get("role") == "admin":
        raise HTTPException(status_code=409, detail="Admin accounts already have full access.")
    billing.forget_access(user_id)
    if await billing.access_of(user_id) == "full":
        raise HTTPException(status_code=409, detail="This account already has full access.")

    recent = await fetch_one(
        """
        SELECT count(*) AS n FROM payments
         WHERE user_id = %s AND provider = 'razorpay'
           AND created_at > now() - interval '1 hour'
        """,
        user_id,
    )
    if int(recent["n"]) >= _MAX_ORDERS_PER_HOUR:
        raise HTTPException(
            status_code=429,
            detail="Too many payment attempts in the last hour. Wait a little and try again.",
        )

    user = await fetch_one('SELECT name, email FROM "user" WHERE id = %s', user_id)
    email = (user or {}).get("email") or claims.get("email") or ""
    made = await billing.create_order(user_id, email)
    order = made["order"]
    amounts = made["amounts"]
    return OrderOut(
        key_id=get_settings().razorpay_key_id,
        order_id=order["id"],
        amount=order["amount"],
        currency=order["currency"],
        plan_inr=amounts["plan"],
        fee_inr=amounts["fee"],
        total_inr=amounts["total"],
        price_usd=made["usd"],
        usd_inr_rate=float(made["rate"]),
        name=(user or {}).get("name") or "",
        email=email,
        description=f"Full access, one-time payment (US${made['usd']} plus gateway charges)",
    )


@router.post("/verify", response_model=BillingStatus)
async def verify_payment(
    body: VerifyIn, claims: dict = Depends(get_current_claims)
) -> BillingStatus:
    """
    Called by the browser as soon as the checkout reports success.

    The browser's word is not enough on its own: the signature proves the
    order and payment ids came from Razorpay for this key, the order must
    belong to the caller, and the payment is fetched from Razorpay to confirm
    it was really captured for the right amount.
    """
    user_id = claims["sub"]
    if not billing.checkout_signature_ok(
        body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature
    ):
        raise HTTPException(status_code=400, detail="The payment could not be verified.")

    row = await fetch_one(
        "SELECT user_id, status FROM payments WHERE order_id = %s", body.razorpay_order_id
    )
    if row is None or row["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="No such order on this account.")

    if row["status"] != "paid":
        payment = await billing.fetch_payment(body.razorpay_payment_id)
        if payment.get("order_id") != body.razorpay_order_id:
            raise HTTPException(status_code=400, detail="The payment is for a different order.")
        payment = await billing.ensure_captured(payment)
        await billing.mark_paid(body.razorpay_order_id, payment)

    return await _status(claims)


@router.post("/webhook")
async def razorpay_webhook(request: Request) -> dict:
    """
    Razorpay's server-to-server events. This is what unlocks an account when
    the buyer closed the tab before the browser could call /verify, and what
    takes access back after a refund.

    The raw body is checked against the webhook secret before anything is
    parsed. Anything else is answered 200 and ignored, so Razorpay does not
    keep retrying events this app has no use for.
    """
    raw = await request.body()
    if not billing.webhook_signature_ok(raw, request.headers.get("X-Razorpay-Signature", "")):
        raise HTTPException(status_code=400, detail="Bad signature")

    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Bad JSON")

    kind = event.get("event")
    payload = event.get("payload") or {}
    payment = (payload.get("payment") or {}).get("entity") or {}

    try:
        if kind in ("payment.captured", "order.paid"):
            order_id = payment.get("order_id") or (
                (payload.get("order") or {}).get("entity") or {}
            ).get("id")
            if order_id and payment.get("status") == "captured":
                await billing.mark_paid(order_id, payment)
        elif kind == "payment.failed":
            if payment.get("order_id"):
                await billing.mark_failed(
                    payment["order_id"], payment.get("error_description")
                )
        elif kind == "refund.processed":
            if payment.get("id"):
                await billing.mark_refunded(payment)
    except HTTPException as exc:
        # A mismatch worth a human look, not a retry loop: log and accept.
        logger.error("webhook %s rejected: %s", kind, exc.detail)

    return {"ok": True}
