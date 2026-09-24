import { timingSafeEqual } from "node:crypto";

import { prisma } from "@/lib/db";
import { sendRendered } from "@/lib/email";
import { fullAccessEmail } from "@/lib/emails";

/**
 * Sends the "you now have full access" email for one payment record.
 *
 * POST /api/internal/access-email   body: { "payment_id": "<payments.id>" }
 *
 * Called by the API (apps/api/billing.py) after a payment is recorded, a
 * Microsoft Marketplace subscription is activated, or an admin gives access,
 * because the email templates and the Resend key live in this app. Not for browsers: the caller must present INTERNAL_API_SECRET,
 * and anyone else gets the same 404 as a route that does not exist.
 *
 * Sent at most once per record however often it is called: the row is
 * claimed (receipt_sent_at set) before sending, and released again if the
 * send fails, so the API's retry can try once more.
 */

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function fromTheApi(request: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET ?? "";
  const given = request.headers.get("x-internal-secret") ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

function firstNameOf(name: string, email: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || email.split("@")[0];
}

interface ClaimedRow {
  id: string;
  user_id: string;
  status: string;
  payment_id: string | null;
  method: string | null;
  amount: number;
  plan_amount: number;
  fee_amount: number;
  paid_at: Date | null;
  /** The Microsoft Marketplace subscription of a "subscribed" row. */
  ref: string | null;
}

interface SubscriptionRow {
  plan_id: string;
  term_end: Date | null;
}

export async function POST(request: Request) {
  if (!fromTheApi(request)) return json({ error: "Not found" }, 404);

  let id: unknown;
  try {
    ({ payment_id: id } = (await request.json()) as { payment_id?: unknown });
  } catch {
    return json({ error: "Send that as JSON" }, 400);
  }
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return json({ error: "payment_id must be a payment record id" }, 400);
  }

  const claimed = await prisma.$queryRaw<ClaimedRow[]>`
    UPDATE payments
       SET receipt_sent_at = now()
     WHERE id = ${id}::uuid
       AND receipt_sent_at IS NULL
       AND status IN ('paid', 'granted', 'subscribed')
 RETURNING id::text, user_id, status, payment_id, method, amount,
           plan_amount, fee_amount, paid_at, ref`;
  const row = claimed[0];
  if (!row) return json({ ok: true, sent: false });

  const user = await prisma.user.findUnique({
    where: { id: row.user_id },
    select: { name: true, email: true },
  });
  if (!user) return json({ ok: true, sent: false });

  // The API's own table, so read with SQL rather than through Prisma.
  const subscription =
    row.status === "subscribed" && row.ref
      ? (
          await prisma.$queryRaw<SubscriptionRow[]>`
            SELECT plan_id, term_end FROM marketplace_subscriptions
             WHERE id = ${row.ref}`
        )[0]
      : undefined;

  const email =
    row.status === "subscribed"
      ? fullAccessEmail({
          firstName: firstNameOf(user.name, user.email),
          via: "microsoft",
          subscription: {
            id: row.ref ?? "",
            planId: subscription?.plan_id ?? "Fiberarticle full access",
            termEnd: subscription?.term_end ?? null,
          },
        })
      : row.status === "paid"
      ? fullAccessEmail({
          firstName: firstNameOf(user.name, user.email),
          via: "payment",
          receipt: {
            paymentId: row.payment_id ?? "",
            paidAt: row.paid_at ?? new Date(),
            method: row.method,
            planInr: Math.round(row.plan_amount / 100),
            feeInr: Math.round(row.fee_amount / 100),
            totalInr: Math.round(row.amount / 100),
          },
        })
      : fullAccessEmail({
          firstName: firstNameOf(user.name, user.email),
          via: "grant",
        });

  try {
    await sendRendered(user.email, email);
  } catch {
    await prisma.$executeRaw`
      UPDATE payments SET receipt_sent_at = NULL WHERE id = ${id}::uuid`;
    return json({ error: "Could not send the email" }, 502);
  }
  return json({ ok: true, sent: true });
}
