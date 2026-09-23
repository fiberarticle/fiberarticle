"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Lock } from "lucide-react";

import { ledgerLabel } from "@/components/ledger";
import { REFUND_URL, TERMS_URL } from "@/components/paywall";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRupees } from "@/lib/access";
import { apiFetch, ApiError } from "@/lib/api";
import type { BillingStatus } from "@/lib/types";
import { useUnlock } from "@/lib/unlock";

function when(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Settings, Plan tab: whether the account has full access, how it got it,
 * and every payment or change behind it. A locked account can buy from here
 * as well as from the unlock page.
 */
export function PlanPanel() {
  const router = useRouter();
  const [status, setStatus] = React.useState<BillingStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    apiFetch<BillingStatus>("/v1/billing")
      .then(setStatus)
      .catch((e) =>
        setError(
          e instanceof ApiError ? e.message : "The Fiberarticle API is unreachable."
        )
      );
  }, []);

  const { start, phase, error: payError, busy } = useUnlock((next) => {
    setStatus(next);
    // The layout decides between the unlock page and the features on the
    // server; refreshing makes it decide again.
    router.refresh();
  });

  if (error) return <Callout tone="error">{error}</Callout>;
  if (!status) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  const full = status.access === "full";
  const paid = status.history.find((r) => r.status === "paid");
  const granted = status.history.find((r) => r.status === "granted");
  const price = status.price;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Your plan</span>
        <div className="flex items-center gap-2">
          {full ? (
            <Badge variant="success">
              <BadgeCheck /> Full access
            </Badge>
          ) : (
            <Badge variant="warning">
              <Lock /> Locked
            </Badge>
          )}
        </div>
        <span className="text-sm text-muted-foreground">
          {status.via === "admin"
            ? "Admin accounts always have full access."
            : status.via === "payment" && paid
              ? `Paid once on ${when(paid.paid_at)}. Nothing to renew: every feature stays open.`
              : status.via === "grant" && granted
                ? `Given by an admin on ${when(granted.paid_at ?? granted.created_at)}. Every feature is open.`
                : "Every feature is locked until a one-time payment."}
        </span>
      </div>

      {!full && (
        <>
          <div className="h-px bg-border" />
          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium">Unlock full access</span>
            <span className="text-sm text-muted-foreground">
              {formatRupees(price.plan_inr)} once, plus{" "}
              {formatRupees(price.fee_inr)} payment gateway charges:{" "}
              {formatRupees(price.total_inr)} in all.
            </span>
            {status.payments_open ? (
              <Button
                className="w-fit"
                onClick={start}
                disabled={busy}
                loading={busy}
              >
                {phase === "confirming"
                  ? "Confirming your payment"
                  : price.total_inr
                    ? `Pay ${formatRupees(price.total_inr)}`
                    : "Continue to payment"}
              </Button>
            ) : (
              <Callout tone="info">
                Payments open soon. Write to{" "}
                <a href="mailto:admin@fiberarticle.com">admin@fiberarticle.com</a>{" "}
                and we will set up your access.
              </Callout>
            )}
            {payError && <Callout tone="error">{payError}</Callout>}
            <span className="text-xs text-muted-foreground">
              No refunds. By paying you agree to the{" "}
              <a
                href={TERMS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Terms
              </a>{" "}
              and the{" "}
              <a
                href={REFUND_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Refund policy
              </a>
              .
            </span>
          </div>
        </>
      )}

      {status.history.length > 0 && (
        <>
          <div className="h-px bg-border" />
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">History</span>
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
              {status.history.map((row) => {
                const line = ledgerLabel(row);
                return (
                  <li key={row.id} className="flex flex-col gap-1 px-3 py-2.5">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm">{line.title}</span>
                      <Badge variant={line.tone}>{line.status}</Badge>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {when(row.paid_at ?? row.created_at)}
                      {line.detail ? ` · ${line.detail}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
            {status.via === "payment" && (
              <span className="text-xs text-muted-foreground">
                Questions about a payment? Write to admin@fiberarticle.com with
                the payment ID.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
