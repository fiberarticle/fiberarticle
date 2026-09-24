"""
Paid access: one product, "full access", bought once.

The price is set and charged in Indian rupees. The Razorpay account takes
Indian payment methods only (UPI, Indian cards, netbanking, wallets), so
every order is made in INR. The rupee amounts are stored on the order, which
is what makes the amount charged exactly the amount shown.

Razorpay keeps a fee out of every payment. The buyer pays that fee on top of
the plan price, shown as its own line, so the full plan price reaches the
account (see quote()).

Everything that changes who has access goes through this module:

  mark_paid          a payment is captured (browser verify call or webhook)
  mark_refunded      a payment is refunded from the Razorpay dashboard
  set_access         an admin grants or removes access by hand
  marketplace_link   a Microsoft Marketplace purchase is activated on an
                     account from the landing page
  marketplace_sync   Microsoft reports a subscription changed (suspended,
                     reinstated, cancelled), by webhook or on reconcile

Each writes a row to the payments table and flips "user".access in the same
transaction, so the ledger and the switch can never disagree.

Microsoft Marketplace buyers pay Microsoft, not us: a 5-year subscription
billed once, upfront. Their rows in the ledger (provider "microsoft") carry
no amount, because Microsoft bills in the buyer's own currency and pays us
out separately; they record when access was given and taken away.
"""

import asyncio
import hashlib
import hmac
import logging
import math
import time
import uuid
from decimal import Decimal

import httpx
from fastapi import HTTPException

import marketplace
from config import get_settings
from db import execute, fetch_all, fetch_one, get_pool, jsonb

logger = logging.getLogger("fiberarticle.billing")

SKU = "full_access"
RAZORPAY_API = "https://api.razorpay.com/v1"

LOCKED_MESSAGE = (
    "Fiberarticle is locked on this account. Unlock full access with a "
    "one-time payment to use it."
)


# ---------------------------------------------------------------- access


# Every feature request asks whether the caller has access, so the answer is
# kept for a few seconds. Changes made by this process (a payment, an admin
# grant) clear the entry straight away; the TTL only bounds how stale it can
# get if the database is changed from elsewhere.
_ACCESS_TTL_SECONDS = 15.0
_access_cache: dict[str, tuple[str, float]] = {}


async def access_of(user_id: str) -> str:
    now = time.monotonic()
    hit = _access_cache.get(user_id)
    if hit is not None and now - hit[1] < _ACCESS_TTL_SECONDS:
        return hit[0]
    row = await fetch_one('SELECT access FROM "user" WHERE id = %s', user_id)
    access = "full" if row and row.get("access") == "full" else "locked"
    _access_cache[user_id] = (access, now)
    return access


def forget_access(user_id: str) -> None:
    _access_cache.pop(user_id, None)


# ---------------------------------------------------------------- price


def price_inr() -> int:
    """The plan price in whole rupees, before Razorpay's fee."""
    return get_settings().full_access_price_inr


def fee_rate() -> Decimal:
    """The share of a payment Razorpay keeps: its fee plus GST on the fee.
    2% and 18% give 0.0236."""
    s = get_settings()
    return (
        Decimal(str(s.razorpay_fee_percent))
        * (1 + Decimal(str(s.razorpay_fee_gst_percent)) / 100)
        / 100
    )


def quote(plan: int) -> dict[str, int]:
    """
    What the buyer pays for a plan price, in whole rupees.

    plan   the plan price
    fee    what the buyer adds for Razorpay's fee
    total  what the buyer pays

    Razorpay keeps its fee as a share of the whole payment, not of the plan
    price, so the total is grossed up: total = plan / (1 - fee rate). After
    Razorpay takes its share of the total, the plan price is what is left.
    For 19,999 that is a total of 20,483: Razorpay keeps 483.40 of it.
    """
    total = int(math.ceil(Decimal(plan) / (1 - fee_rate())))
    return {"plan": plan, "fee": total - plan, "total": total}


# ---------------------------------------------------------------- Razorpay


def payments_open() -> bool:
    s = get_settings()
    return bool(s.razorpay_key_id and s.razorpay_key_secret)


def livemode() -> bool:
    return get_settings().razorpay_key_id.startswith("rzp_live_")


def _keys() -> tuple[str, str]:
    s = get_settings()
    if not payments_open():
        raise HTTPException(
            status_code=503,
            detail="Payments are not open yet. Write to admin@fiberarticle.com and we will set up your access.",
        )
    return s.razorpay_key_id, s.razorpay_key_secret


async def _razorpay(method: str, path: str, body: dict | None = None) -> dict:
    key_id, key_secret = _keys()
    async with httpx.AsyncClient(timeout=20, auth=(key_id, key_secret)) as client:
        res = await client.request(method, f"{RAZORPAY_API}{path}", json=body)
    if res.status_code >= 400:
        logger.error("Razorpay %s %s answered %s: %s", method, path, res.status_code, res.text[:500])
        raise HTTPException(
            status_code=502,
            detail="Razorpay did not accept the request. Nothing was charged; try again in a minute.",
        )
    return res.json()


async def create_order(user_id: str, email: str | None) -> dict:
    """A Razorpay order for full access in rupees, recorded as 'created'."""
    amounts = quote(price_inr())
    order = await _razorpay(
        "POST",
        "/orders",
        {
            "amount": amounts["total"] * 100,
            "currency": "INR",
            # Razorpay caps the receipt at 40 characters.
            "receipt": f"fa-{uuid.uuid4().hex[:24]}",
            "notes": {
                "product": "Fiberarticle full access",
                "sku": SKU,
                "user_id": user_id,
                "email": email or "",
                "plan_inr": str(amounts["plan"]),
                "gateway_charges_inr": str(amounts["fee"]),
            },
        },
    )
    await execute(
        """
        INSERT INTO payments
            (user_id, email, sku, provider, status, amount, plan_amount,
             fee_amount, currency, order_id, livemode)
        VALUES (%s, %s, %s, 'razorpay', 'created', %s, %s, %s, 'INR', %s, %s)
        """,
        user_id,
        email,
        SKU,
        order["amount"],
        amounts["plan"] * 100,
        amounts["fee"] * 100,
        order["id"],
        livemode(),
    )
    return {"order": order, "amounts": amounts}


async def fetch_payment(payment_id: str) -> dict:
    return await _razorpay("GET", f"/payments/{payment_id}")


async def ensure_captured(payment: dict) -> dict:
    """Razorpay captures order payments on its own for most accounts; an
    'authorized' payment is captured here so the money is actually taken."""
    if payment.get("status") == "captured":
        return payment
    if payment.get("status") == "authorized":
        return await _razorpay(
            "POST",
            f"/payments/{payment['id']}/capture",
            {"amount": payment["amount"], "currency": payment["currency"]},
        )
    raise HTTPException(
        status_code=402,
        detail="The payment did not go through, so nothing was unlocked. Try again.",
    )


def checkout_signature_ok(order_id: str, payment_id: str, signature: str) -> bool:
    secret = get_settings().razorpay_key_secret
    if not secret or not signature:
        return False
    expected = hmac.new(
        secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def webhook_signature_ok(body: bytes, signature: str) -> bool:
    secret = get_settings().razorpay_webhook_secret
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


# ---------------------------------------------------------------- ledger


async def mark_paid(order_id: str, payment: dict) -> dict | None:
    """
    Record a captured payment against its order and unlock the account.

    Both the browser (right after checkout) and the webhook (a moment later,
    or on their own if the browser was closed) end up here, so it is
    idempotent: the row is locked, and a second call for an order that is
    already paid changes nothing and returns None. Returns the payment row
    the first time.
    """
    async with get_pool().connection() as conn:
        async with conn.transaction():
            cur = await conn.execute(
                "SELECT * FROM payments WHERE order_id = %s FOR UPDATE", (order_id,)
            )
            row = await cur.fetchone()
            if row is None:
                logger.warning("payment %s is for an unknown order %s", payment.get("id"), order_id)
                return None
            if row["status"] == "paid":
                return None
            # At least the order amount, in the order's currency. Razorpay
            # only accepts payments for an order at its amount, so in practice
            # this is exact; ">=" leaves room for Razorpay's own convenience
            # fee option, which adds its fee to the payment on top.
            if (
                int(payment.get("amount") or 0) < row["amount"]
                or payment.get("currency") != row["currency"]
            ):
                logger.error(
                    "payment %s amount %s %s does not match order %s (%s %s)",
                    payment.get("id"),
                    payment.get("amount"),
                    payment.get("currency"),
                    order_id,
                    row["amount"],
                    row["currency"],
                )
                raise HTTPException(
                    status_code=400,
                    detail="The amount paid does not match the order. Write to admin@fiberarticle.com.",
                )
            # Two checkouts left open in two tabs can both be paid. The second
            # one still counts (the money was taken), but it is flagged so an
            # admin sees it and refunds it from the Razorpay dashboard. What
            # makes it a duplicate is that the account already had full access
            # when the payment came in; someone buying again after an admin
            # removed their access is a real purchase.
            cur = await conn.execute(
                'SELECT access FROM "user" WHERE id = %s FOR UPDATE', (row["user_id"],)
            )
            owner = await cur.fetchone()
            duplicate = owner is not None and owner.get("access") == "full"
            if duplicate:
                logger.error(
                    "duplicate payment %s by user %s: they already had full access",
                    payment.get("id"),
                    row["user_id"],
                )
            cur = await conn.execute(
                """
                UPDATE payments
                   SET status = 'paid',
                       payment_id = %s,
                       method = %s,
                       note = %s,
                       paid_at = now(),
                       updated_at = now()
                 WHERE id = %s
             RETURNING *
                """,
                (
                    payment.get("id"),
                    payment.get("method"),
                    "Paid while this account already had full access. Refund this payment from the Razorpay dashboard."
                    if duplicate
                    else None,
                    row["id"],
                ),
            )
            paid = await cur.fetchone()
            await conn.execute(
                'UPDATE "user" SET access = %s, "updatedAt" = now() WHERE id = %s',
                ("full", row["user_id"]),
            )
    forget_access(paid["user_id"])
    if not duplicate:
        _send_access_email_later(str(paid["id"]))
    return paid


async def mark_failed(order_id: str, reason: str | None) -> None:
    """A failed attempt stays visible to admins; it never touches access."""
    await execute(
        """
        UPDATE payments
           SET status = 'failed', note = %s, updated_at = now()
         WHERE order_id = %s AND status = 'created'
        """,
        (reason or "Payment failed")[:500],
        order_id,
    )


async def _still_entitled(conn, user_id: str) -> bool:
    """Whether the account keeps full access without the payment or the
    subscription that just ended: another payment that still stands, a
    Microsoft Marketplace subscription that is still live, or an admin whose
    latest word on this account was to give access."""
    cur = await conn.execute(
        """
        SELECT EXISTS (
                 SELECT 1 FROM payments WHERE user_id = %s AND status = 'paid'
               )
            OR EXISTS (
                 SELECT 1 FROM marketplace_subscriptions
                  WHERE user_id = %s AND status = %s
               )
            OR COALESCE((
                 SELECT status = 'granted' FROM payments
                  WHERE user_id = %s AND provider = 'admin'
                  ORDER BY created_at DESC
                  LIMIT 1
               ), false) AS entitled
        """,
        (user_id, user_id, marketplace.SUBSCRIBED, user_id),
    )
    row = await cur.fetchone()
    return bool(row and row["entitled"])


async def mark_refunded(payment: dict) -> None:
    """
    A refund made from the Razorpay dashboard. A full refund takes the access
    back, because the purchase no longer stands; a partial one is only noted.
    """
    payment_id = payment.get("id")
    fully = int(payment.get("amount_refunded") or 0) >= int(payment.get("amount") or 0)
    async with get_pool().connection() as conn:
        async with conn.transaction():
            cur = await conn.execute(
                "SELECT * FROM payments WHERE payment_id = %s FOR UPDATE", (payment_id,)
            )
            row = await cur.fetchone()
            if row is None:
                return
            if not fully:
                await conn.execute(
                    "UPDATE payments SET note = %s, updated_at = now() WHERE id = %s",
                    (
                        f"Partly refunded: {int(payment.get('amount_refunded') or 0) / 100:.2f} INR",
                        row["id"],
                    ),
                )
                return
            if row["status"] == "refunded":
                return
            await conn.execute(
                """
                UPDATE payments
                   SET status = 'refunded', note = 'Refunded from the Razorpay dashboard',
                       updated_at = now()
                 WHERE id = %s
                """,
                (row["id"],),
            )
            if not await _still_entitled(conn, row["user_id"]):
                await conn.execute(
                    """
                    UPDATE "user" SET access = 'locked', "updatedAt" = now()
                     WHERE id = %s AND COALESCE(role, 'user') <> 'admin'
                    """,
                    (row["user_id"],),
                )
    forget_access(row["user_id"])


async def set_access(user_id: str, access: str, admin_id: str, email: str | None) -> bool:
    """
    An admin gives full access without a payment (a team deal, a "contact us"
    customer, a replacement account) or takes it away. Logged as its own row,
    so the ledger shows who changed it and when. Returns False when the
    account already had that access and nothing was changed.
    """
    grant = access == "full"
    async with get_pool().connection() as conn:
        async with conn.transaction():
            cur = await conn.execute(
                'SELECT access FROM "user" WHERE id = %s FOR UPDATE', (user_id,)
            )
            current = await cur.fetchone()
            if current is None:
                raise HTTPException(status_code=404, detail="No such user")
            if (current.get("access") == "full") == grant:
                return False
            cur = await conn.execute(
                """
                INSERT INTO payments
                    (user_id, email, sku, provider, status, amount, currency,
                     livemode, actor_id, note, paid_at)
                VALUES (%s, %s, %s, 'admin', %s, 0, 'INR', true, %s, %s,
                        CASE WHEN %s THEN now() END)
             RETURNING id
                """,
                (
                    user_id,
                    email,
                    SKU,
                    "granted" if grant else "revoked",
                    admin_id,
                    "Full access given by an admin" if grant else "Access removed by an admin",
                    grant,
                ),
            )
            ledger = await cur.fetchone()
            await conn.execute(
                'UPDATE "user" SET access = %s, "updatedAt" = now() WHERE id = %s',
                ("full" if grant else "locked", user_id),
            )
    forget_access(user_id)
    if grant:
        _send_access_email_later(str(ledger["id"]))
    return True


async def payments_of(user_id: str) -> list[dict]:
    """Everything that decided this person's access, newest first. Unpaid
    checkout attempts are left out; they are noise to the person reading."""
    return await fetch_all(
        """
        SELECT id::text, provider, status, amount, plan_amount, fee_amount,
               currency, order_id, payment_id, method, livemode, note, ref,
               paid_at, created_at
          FROM payments
         WHERE user_id = %s AND status NOT IN ('created')
         ORDER BY created_at DESC
         LIMIT 50
        """,
        user_id,
    )


# ---------------------------------------------------------------- Microsoft Marketplace


def _marketplace_note(row: dict) -> str:
    return f"Microsoft Marketplace subscription, plan {row['plan_id']}"


async def _save_marketplace_row(conn, row: dict) -> None:
    """Store Microsoft's description of a subscription. Which account it is
    activated on (user_id) is never touched here."""
    await conn.execute(
        """
        INSERT INTO marketplace_subscriptions
            (id, offer_id, plan_id, quantity, status, name,
             purchaser_email, purchaser_tenant_id, beneficiary_email,
             beneficiary_tenant_id, term_start, term_end, term_unit,
             auto_renew, is_free_trial, is_test, raw)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            offer_id = EXCLUDED.offer_id,
            plan_id = EXCLUDED.plan_id,
            quantity = EXCLUDED.quantity,
            status = EXCLUDED.status,
            name = EXCLUDED.name,
            purchaser_email = EXCLUDED.purchaser_email,
            purchaser_tenant_id = EXCLUDED.purchaser_tenant_id,
            beneficiary_email = EXCLUDED.beneficiary_email,
            beneficiary_tenant_id = EXCLUDED.beneficiary_tenant_id,
            term_start = EXCLUDED.term_start,
            term_end = EXCLUDED.term_end,
            term_unit = EXCLUDED.term_unit,
            auto_renew = EXCLUDED.auto_renew,
            is_free_trial = EXCLUDED.is_free_trial,
            is_test = EXCLUDED.is_test,
            raw = EXCLUDED.raw,
            updated_at = now()
        """,
        (
            row["id"],
            row["offer_id"],
            row["plan_id"],
            row["quantity"],
            row["status"],
            row["name"],
            row["purchaser_email"],
            row["purchaser_tenant_id"],
            row["beneficiary_email"],
            row["beneficiary_tenant_id"],
            row["term_start"],
            row["term_end"],
            row["term_unit"],
            row["auto_renew"],
            row["is_free_trial"],
            row["is_test"],
            jsonb(row["raw"]),
        ),
    )


async def _marketplace_ledger(
    conn, user_id: str, row: dict, status: str, operation_id: str | None
) -> str:
    """One payments row for a Microsoft Marketplace event on this account."""
    cur = await conn.execute('SELECT email FROM "user" WHERE id = %s', (user_id,))
    owner = await cur.fetchone()
    cur = await conn.execute(
        """
        INSERT INTO payments
            (user_id, email, sku, provider, status, amount, currency, livemode,
             note, payment_id, ref, paid_at)
        VALUES (%s, %s, %s, 'microsoft', %s, 0, 'INR', %s, %s, %s, %s,
                CASE WHEN %s IN ('subscribed', 'reinstated') THEN now() END)
     RETURNING id
        """,
        (
            user_id,
            (owner or {}).get("email"),
            SKU,
            status,
            not row["is_test"],
            _marketplace_note(row),
            operation_id,
            row["id"],
            status,
        ),
    )
    return str((await cur.fetchone())["id"])


async def _marketplace_unlock(
    conn, user_id: str, row: dict, status: str, operation_id: str | None
) -> str | None:
    """Open the features for a live subscription. Returns the ledger row id
    when this is news (the first 'subscribed' row for this subscription, or a
    reinstatement), None when it was already recorded."""
    if status == "subscribed":
        cur = await conn.execute(
            """
            SELECT 1 FROM payments
             WHERE provider = 'microsoft' AND ref = %s AND user_id = %s
               AND status = 'subscribed'
             LIMIT 1
            """,
            (row["id"], user_id),
        )
        if await cur.fetchone():
            await conn.execute(
                """
                UPDATE "user" SET access = 'full', "updatedAt" = now()
                 WHERE id = %s AND access IS DISTINCT FROM 'full'
                """,
                (user_id,),
            )
            return None
    ledger_id = await _marketplace_ledger(conn, user_id, row, status, operation_id)
    await conn.execute(
        'UPDATE "user" SET access = %s, "updatedAt" = now() WHERE id = %s',
        ("full", user_id),
    )
    return ledger_id


async def _marketplace_lock(
    conn, user_id: str, row: dict, status: str, operation_id: str | None
) -> None:
    """The subscription is suspended or over. The row for it is already
    saved with the new status, so _still_entitled no longer counts it."""
    await _marketplace_ledger(conn, user_id, row, status, operation_id)
    if not await _still_entitled(conn, user_id):
        await conn.execute(
            """
            UPDATE "user" SET access = 'locked', "updatedAt" = now()
             WHERE id = %s AND COALESCE(role, 'user') <> 'admin'
            """,
            (user_id,),
        )


async def marketplace_link(user_id: str, sub: dict) -> dict:
    """
    Tie a Microsoft Marketplace subscription to the account that finished on
    the landing page, and open the features if Microsoft reports it live.

    One subscription serves one account. Asking to link a subscription that
    is already in use by another account is refused (409), however the
    caller came by the purchase token.
    """
    row = marketplace.subscription_row(sub)
    ledger_id = None
    async with get_pool().connection() as conn:
        async with conn.transaction():
            cur = await conn.execute(
                "SELECT user_id FROM marketplace_subscriptions WHERE id = %s FOR UPDATE",
                (row["id"],),
            )
            existing = await cur.fetchone()
            if existing and existing["user_id"] and existing["user_id"] != user_id:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "This Microsoft Marketplace subscription is already active on "
                        "another Fiberarticle account. Sign in with that account, or "
                        "write to admin@fiberarticle.com."
                    ),
                )
            await _save_marketplace_row(conn, row)
            await conn.execute(
                """
                UPDATE marketplace_subscriptions
                   SET user_id = %s,
                       activated_at = CASE WHEN status = %s
                                           THEN COALESCE(activated_at, now())
                                           ELSE activated_at END,
                       updated_at = now()
                 WHERE id = %s
                """,
                (user_id, marketplace.SUBSCRIBED, row["id"]),
            )
            # The account row is locked for the rest of the transaction so a
            # webhook for the same subscription waits instead of racing.
            await conn.execute('SELECT 1 FROM "user" WHERE id = %s FOR UPDATE', (user_id,))
            if row["status"] == marketplace.SUBSCRIBED:
                ledger_id = await _marketplace_unlock(conn, user_id, row, "subscribed", None)
            cur = await conn.execute(
                "SELECT * FROM marketplace_subscriptions WHERE id = %s", (row["id"],)
            )
            stored = await cur.fetchone()
    forget_access(user_id)
    if ledger_id:
        _send_access_email_later(ledger_id)
    return stored


async def marketplace_sync(sub: dict, *, action: str, operation_id: str | None = None) -> None:
    """
    Store Microsoft's current view of a subscription and apply whatever its
    status change means for the account it is activated on.

    Used by the webhook and by the reconcile loop, so it acts on a change of
    status only: hearing the same news twice changes nothing. A subscription
    no account has activated yet is only stored; the landing page links it.
    """
    row = marketplace.subscription_row(sub)
    user_id = None
    ledger_id = None
    async with get_pool().connection() as conn:
        async with conn.transaction():
            cur = await conn.execute(
                "SELECT user_id, status FROM marketplace_subscriptions WHERE id = %s FOR UPDATE",
                (row["id"],),
            )
            existing = await cur.fetchone()
            await _save_marketplace_row(conn, row)
            if existing is not None and existing["user_id"]:
                user_id = existing["user_id"]
                before, after = existing["status"], row["status"]
                await conn.execute('SELECT 1 FROM "user" WHERE id = %s FOR UPDATE', (user_id,))
                if before != after:
                    if after == marketplace.SUBSCRIBED:
                        if before == marketplace.PENDING:
                            ledger_id = await _marketplace_unlock(
                                conn, user_id, row, "subscribed", operation_id
                            )
                        else:
                            await _marketplace_unlock(
                                conn, user_id, row, "reinstated", operation_id
                            )
                    elif after in (marketplace.SUSPENDED, marketplace.UNSUBSCRIBED):
                        await _marketplace_lock(
                            conn,
                            user_id,
                            row,
                            "suspended" if after == marketplace.SUSPENDED else "unsubscribed",
                            operation_id,
                        )
                    logger.info(
                        "marketplace subscription %s: %s -> %s (%s)",
                        row["id"],
                        before,
                        after,
                        action,
                    )
    if user_id:
        forget_access(user_id)
    if ledger_id:
        _send_access_email_later(ledger_id)


async def marketplace_release(user_id: str) -> None:
    """
    The account is being deleted: free its Microsoft Marketplace
    subscriptions, so the buyer can activate them on a new account from the
    Azure portal, and take back the access they gave. The web app deletes the
    account itself right after; if that fails, the account must not keep
    access a subscription now serving someone else gave it.
    """
    async with get_pool().connection() as conn:
        async with conn.transaction():
            await conn.execute('SELECT 1 FROM "user" WHERE id = %s FOR UPDATE', (user_id,))
            cur = await conn.execute(
                """
                UPDATE marketplace_subscriptions SET user_id = NULL, updated_at = now()
                 WHERE user_id = %s
                """,
                (user_id,),
            )
            if cur.rowcount and not await _still_entitled(conn, user_id):
                await conn.execute(
                    """
                    UPDATE "user" SET access = 'locked', "updatedAt" = now()
                     WHERE id = %s AND COALESCE(role, 'user') <> 'admin'
                    """,
                    (user_id,),
                )
    forget_access(user_id)


async def marketplace_subscriptions_of(user_id: str) -> list[dict]:
    return await fetch_all(
        """
        SELECT id, name, plan_id, status, term_start, term_end, auto_renew,
               is_test, activated_at
          FROM marketplace_subscriptions
         WHERE user_id = %s
         ORDER BY created_at DESC
        """,
        user_id,
    )


# ---------------------------------------------------------------- email


# Strong references to the fire-and-forget email tasks. asyncio keeps only a
# weak one, so an unreferenced task can be collected before it finishes.
_email_tasks: set[asyncio.Task] = set()


def _send_access_email_later(payment_row_id: str) -> None:
    task = asyncio.create_task(_request_access_email(payment_row_id))
    _email_tasks.add(task)
    task.add_done_callback(_email_tasks.discard)


async def _request_access_email(payment_row_id: str) -> None:
    """
    The "you now have full access" email is sent by the web app, because the
    email templates and the Resend key live there. The web app sends it once
    per payment row, however often it is asked, so a retry here is harmless.
    A failure is logged and never undoes the unlock.
    """
    s = get_settings()
    if not s.internal_api_secret:
        logger.warning("INTERNAL_API_SECRET is not set; skipping the access email")
        return
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                res = await client.post(
                    f"{s.web_url}/api/internal/access-email",
                    json={"payment_id": payment_row_id},
                    headers={"x-internal-secret": s.internal_api_secret},
                )
            if res.status_code < 500:
                if res.status_code >= 400:
                    logger.error("access email refused (%s): %s", res.status_code, res.text[:300])
                return
        except Exception:
            logger.warning("access email request failed", exc_info=True)
        await asyncio.sleep(5 * (attempt + 1))
    logger.error("gave up asking the web app to send the access email for %s", payment_row_id)
