"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  ClipboardCheck,
  FileDown,
  HatGlasses,
  Lock,
  PenLine,
  Table2,
  UserRound,
} from "lucide-react";

import { FiberMark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRupees, formatUsd } from "@/lib/access";
import { apiFetch, ApiError } from "@/lib/api";
import type { BillingStatus } from "@/lib/types";
import { useUnlock } from "@/lib/unlock";
import { cn } from "@/lib/utils";

/** Where the policies the buyer agrees to live. */
export const TERMS_URL = "https://fiberarticle.com/terms/";
export const REFUND_URL = "https://fiberarticle.com/refund-policy/";

// Same accents as the sidebar and the dashboard agent fan, so each feature
// reads as the one the buyer will meet inside.
const FEATURES = [
  {
    icon: UserRound,
    accent: "#fca91e",
    title: "Researcher",
    body: "Deep runs across arXiv, OpenAlex, Semantic Scholar and Crossref.",
  },
  {
    icon: ClipboardCheck,
    accent: "#50c158",
    title: "Literature Reviewer",
    body: "Evidence table, objectives, research gaps and future work.",
  },
  {
    icon: PenLine,
    accent: "#ff7db1",
    title: "Article Writer",
    body: "Full journal-style articles with journal templates.",
  },
  {
    icon: HatGlasses,
    accent: "#4f90e4",
    title: "AI Assistant",
    body: "Cited answers drawn from the best papers.",
  },
  {
    icon: Table2,
    accent: "#9a6b45",
    title: "Extract",
    body: "Your own columns filled from papers, with a quote for every cell.",
  },
  {
    icon: FileDown,
    accent: "#c2842b",
    title: "Every export",
    body: "Word, PDF, LaTeX and HTML, in 10,000+ citation styles.",
  },
];

/**
 * The page a locked account sees in place of every feature.
 *
 * Shown by the app layout for any route while the account is locked, so
 * there is no way around it in the browser; the API refuses feature calls
 * from locked accounts as well (402), which is the part that actually
 * protects anything.
 */
export function Paywall({ userName }: { userName: string }) {
  const router = useRouter();
  const [status, setStatus] = React.useState<BillingStatus | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setStatus(await apiFetch<BillingStatus>("/v1/billing"));
      setLoadError(null);
    } catch (e) {
      setLoadError(
        e instanceof ApiError
          ? e.message
          : "The Fiberarticle API is unreachable. This page will recover once it is back."
      );
    }
  }, []);

  // Until the first answer arrives, keep asking, so a page opened while the
  // API was restarting recovers by itself.
  const loaded = status !== null;
  React.useEffect(() => {
    if (loaded) return;
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [loaded, load]);

  const { start, phase, error, busy } = useUnlock(() => {
    // The layout decides what to show from the session on the server, so a
    // refresh is what swaps this page for the one they came to.
    setTimeout(() => router.refresh(), 1400);
  });

  // Someone who paid in another tab, or was given access by an admin, lands
  // here with a stale page: the status says full, so just refresh.
  React.useEffect(() => {
    if (status?.access === "full") router.refresh();
  }, [status, router]);

  const price = status?.price;
  const firstName = userName.trim().split(/\s+/)[0];

  if (phase === "done") {
    return (
      <div className="flex min-h-[calc(100svh-9.5rem)] items-center justify-center md:min-h-[calc(100vh-8rem)]">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <CircleCheck className="size-10 text-success" />
          <h1 className="text-2xl font-semibold tracking-tight">
            You are in{firstName ? `, ${firstName}` : ""}.
          </h1>
          <p className="text-sm text-muted-foreground">
            Payment received. Every feature is now open on your account, and a
            receipt is on its way to your inbox.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100svh-9.5rem)] items-center justify-center md:min-h-[calc(100vh-8rem)]">
      <section className="flex w-full max-w-4xl flex-col gap-6 md:-mt-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <FiberMark size={64} />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Unlock Fiberarticle
          </h1>
          <p className="max-w-lg text-sm text-muted-foreground sm:text-base">
            One payment opens every feature on your account, for good. No
            subscription and nothing to renew.
          </p>
        </div>

        {loadError && <Callout tone="error">{loadError}</Callout>}

        <div className="grid gap-4 md:grid-cols-[1.15fr_1fr]">
          {/* What they get. */}
          <div
            className={cn(
              "rounded-3xl border border-border p-5 sm:p-6",
              "bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--card)_88%,white),var(--card))]",
              // Dark mode takes a little of the brand brown so the surface
              // never reads as flat grey.
              "dark:border-[color-mix(in_oklab,#9a6b45_22%,var(--border))]",
              "dark:bg-[linear-gradient(to_bottom,color-mix(in_oklab,#9a6b45_13%,var(--card)),color-mix(in_oklab,#9a6b45_4%,var(--card)))]",
              "shadow-[inset_0_1.5px_0_var(--classic-highlight),inset_0_-1px_0_var(--classic-shade),0_18px_40px_-22px_rgba(0,0,0,0.45)]"
            )}
          >
            <p className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Lock className="size-3.5" /> Everything this unlocks
            </p>
            <ul className="flex flex-col gap-3.5">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <li key={f.title} className="flex items-start gap-3">
                    <Icon
                      className="mt-0.5 size-[18px] shrink-0"
                      style={{ color: f.accent }}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">
                        {f.title}
                      </span>
                      <span className="block text-[13px] leading-relaxed text-muted-foreground">
                        {f.body}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* The price and the button. Amber inner glow, solid surface.
              First on phones, so the price and the button are on screen
              without scrolling past the feature list. */}
          <div
            className={cn(
              "order-first flex flex-col rounded-3xl border p-5 sm:p-6 md:order-none",
              "border-[color-mix(in_oklab,#fca91e_30%,var(--border))]",
              "bg-[linear-gradient(to_bottom,color-mix(in_oklab,#fca91e_9%,var(--card)),var(--card)_70%)]",
              "dark:bg-[linear-gradient(to_bottom,color-mix(in_oklab,#fca91e_16%,var(--card)),color-mix(in_oklab,#fca91e_5%,var(--card)))]",
              "shadow-[inset_0_0_30px_2px_color-mix(in_oklab,#fca91e_22%,transparent),inset_0_1.5px_0_var(--classic-highlight),inset_0_-1px_0_var(--classic-shade),0_22px_44px_-22px_rgba(0,0,0,0.55)]"
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#b26d12] dark:text-[#f7c56c]">
              Full access
            </p>
            <div className="mt-2 flex items-end gap-2">
              {price ? (
                <span className="text-5xl font-semibold tracking-tight">
                  {formatUsd(price.usd)}
                </span>
              ) : (
                <Skeleton className="h-12 w-28" />
              )}
              <span className="pb-1.5 text-sm text-muted-foreground">
                one-time
              </span>
            </div>

            <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4 text-sm">
              {price === undefined ? (
                <>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </>
              ) : price.total_inr !== null &&
                price.plan_inr !== null &&
                price.fee_inr !== null ? (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground">
                      Plan price in rupees
                    </span>
                    <span className="tabular-nums">
                      {formatRupees(price.plan_inr)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground">
                      Payment gateway charges
                    </span>
                    <span className="tabular-nums">
                      {formatRupees(price.fee_inr)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 border-t border-dashed border-border pt-2 font-semibold">
                    <span>You pay</span>
                    <span className="tabular-nums">
                      {formatRupees(price.total_inr)}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  The amount in rupees, with payment gateway charges, is shown
                  at checkout.
                </p>
              )}
            </div>

            {status && !status.payments_open ? (
              <Callout tone="info" className="mt-5">
                Payments open soon. Write to{" "}
                <a href="mailto:admin@fiberarticle.com">admin@fiberarticle.com</a>{" "}
                and we will set up your access.
              </Callout>
            ) : (
              <Button
                size="lg"
                className="mt-5 w-full"
                disabled={!status || busy}
                loading={busy}
                onClick={start}
              >
                {phase === "confirming"
                  ? "Confirming your payment"
                  : phase === "starting"
                    ? "Opening the checkout"
                    : price?.total_inr
                      ? `Pay ${formatRupees(price.total_inr)}`
                      : "Continue to payment"}
              </Button>
            )}

            {error && (
              <Callout tone="error" className="mt-3">
                {error}
              </Callout>
            )}

            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Pay by UPI, card, netbanking or wallet through Razorpay. All sales
              are final: there are no refunds. By paying you agree to the{" "}
              <a
                href={TERMS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                Terms
              </a>{" "}
              and the{" "}
              <a
                href={REFUND_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                Refund policy
              </a>
              .
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Want us to do the research and manuscript preparation for you
          instead? Write to{" "}
          <a
            href="mailto:admin@fiberarticle.com"
            className="font-medium text-primary hover:underline"
          >
            admin@fiberarticle.com
          </a>
          .
        </p>
      </section>
    </div>
  );
}
