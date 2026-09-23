"use client";

import * as React from "react";

import { apiFetch, ApiError } from "@/lib/api";
import type { BillingOrder, BillingStatus } from "@/lib/types";

/**
 * Buying full access with Razorpay Standard Checkout.
 *
 *   1. The API makes a Razorpay order in rupees for today's price.
 *   2. Razorpay's checkout opens over the page; the buyer pays by UPI, card,
 *      netbanking or wallet without leaving the app.
 *   3. On success the checkout hands back the order id, payment id and a
 *      signature, which the API verifies before unlocking the account.
 *
 * If step 3 cannot reach the API (a dropped connection right after paying),
 * the payment is not lost: Razorpay's webhook unlocks the account on its
 * own. This hook then watches the billing status for a minute and reports
 * the unlock as soon as the webhook has landed.
 */

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open: () => void;
  on: (
    event: "payment.failed",
    handler: (response: { error?: { description?: string } }) => void
  ) => void;
}

type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let checkoutScript: Promise<void> | null = null;

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!checkoutScript) {
    checkoutScript = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CHECKOUT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        // Let the next click try again instead of reusing a failed load.
        checkoutScript = null;
        reject(
          new Error(
            "Could not load the Razorpay checkout. Check your connection and try again."
          )
        );
      };
      document.body.appendChild(script);
    });
  }
  return checkoutScript;
}

export type UnlockPhase = "idle" | "starting" | "open" | "confirming" | "done";

const CONFIRM_POLL_MS = 3000;
const CONFIRM_POLL_TRIES = 20;

export function useUnlock(onUnlocked: (status: BillingStatus) => void) {
  const [phase, setPhase] = React.useState<UnlockPhase>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const unlockedRef = React.useRef(onUnlocked);
  unlockedRef.current = onUnlocked;

  /** After a failed verify call: wait for the webhook to unlock the account. */
  const waitForWebhook = React.useCallback(async () => {
    for (let i = 0; i < CONFIRM_POLL_TRIES; i += 1) {
      await new Promise((r) => setTimeout(r, CONFIRM_POLL_MS));
      try {
        const status = await apiFetch<BillingStatus>("/v1/billing");
        if (status.access === "full") {
          setPhase("done");
          setError(null);
          unlockedRef.current(status);
          return;
        }
      } catch {
        // keep waiting
      }
    }
    setPhase("idle");
    setError(
      "Your payment is being confirmed. If this page still shows locked in a few minutes, write to admin@fiberarticle.com with your payment id from the Razorpay email and we will sort it out."
    );
  }, []);

  const start = React.useCallback(async () => {
    setError(null);
    setPhase("starting");
    try {
      const [order, { CHECKOUT_LOGO }] = await Promise.all([
        apiFetch<BillingOrder>("/v1/billing/order", { method: "POST" }),
        import("@/lib/checkout-logo"),
        loadCheckout(),
      ]);
      const Razorpay = window.Razorpay;
      if (!Razorpay) throw new Error("The Razorpay checkout did not load. Try again.");

      const checkout = new Razorpay({
        key: order.key_id,
        order_id: order.order_id,
        amount: order.amount,
        currency: order.currency,
        name: "Fiberarticle",
        description: order.description,
        image: CHECKOUT_LOGO,
        prefill: { name: order.name, email: order.email },
        theme: { color: "#9a6b45" },
        modal: {
          // Closing by accident mid-payment is easy on a phone; ask first.
          confirm_close: true,
          ondismiss: () => {
            setPhase((p) => (p === "open" ? "idle" : p));
          },
        },
        handler: async (response: RazorpaySuccess) => {
          setPhase("confirming");
          setError(null);
          try {
            const status = await apiFetch<BillingStatus>("/v1/billing/verify", {
              method: "POST",
              body: JSON.stringify(response),
            });
            if (status.access === "full") {
              setPhase("done");
              unlockedRef.current(status);
              return;
            }
            await waitForWebhook();
          } catch {
            await waitForWebhook();
          }
        },
      });
      checkout.on("payment.failed", (response) => {
        // The checkout keeps itself open so they can retry with another
        // method; this message stays under the button if they close it.
        setError(
          response.error?.description ??
            "The payment did not go through. Nothing was charged; try again."
        );
      });
      setPhase("open");
      checkout.open();
    } catch (e) {
      setPhase("idle");
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "Could not start the payment. Try again."
      );
    }
  }, [waitForWebhook]);

  return {
    start,
    phase,
    error,
    busy: phase === "starting" || phase === "open" || phase === "confirming",
  };
}
