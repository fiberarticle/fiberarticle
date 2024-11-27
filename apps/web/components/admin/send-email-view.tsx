"use client";

/**
 * Admin -> Send emails.
 *
 * One screen, three things on it: who it goes to, which of the standing emails
 * it is, and the message itself rendered exactly as the recipient will receive
 * it. The address field is the form, so typing an address and pressing Enter
 * sends the mail that is on screen. There is no confirmation step: the preview
 * is the confirmation, and it sits there while you type.
 *
 * The preview is an iframe rather than markup dropped into this page, and it
 * has to be. These emails are 600px tables carrying their own <style> block and
 * their own body background; inlined here they would inherit the app's
 * stylesheet and stop resembling the thing being sent. The markup is fetched
 * and handed to the frame as srcDoc rather than pointed at with src, so the
 * request is an ordinary authenticated fetch from this page and a failure can
 * be shown as a message instead of a broken frame. sandbox="" leaves the frame
 * with no permissions at all: no scripts, no navigation, no access to us.
 *
 * On a phone the preview sits under the form. From large screens up the form is
 * a column beside it, because the point is reading the message and typing the
 * address without either one moving.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Mail,
  Send,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import type { CampaignSummary } from "@/lib/emails/catalog";

// Mirrors the check in the send route. This one only decides whether the
// button looks pressable; the server does the check that counts.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; to: string }
  | { kind: "error"; message: string };

type Preview =
  | { kind: "loading" }
  | { kind: "ready"; html: string }
  | { kind: "error" };

export function SendEmailView({ campaigns }: { campaigns: CampaignSummary[] }) {
  const [slug, setSlug] = useState(campaigns[0]?.slug ?? "");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [preview, setPreview] = useState<Preview>({ kind: "loading" });
  const addressRef = useRef<HTMLInputElement>(null);

  // Hard guard against a second Enter landing before React has re-rendered
  // with the disabled button. State alone is one render too slow for that, and
  // a duplicate quotation cannot be recalled.
  const inFlight = useRef(false);

  const chosen = useMemo(
    () => campaigns.find((c) => c.slug === slug) ?? campaigns[0],
    [campaigns, slug]
  );

  const address = to.trim();
  const valid = EMAIL_RE.test(address);
  const sending = status.kind === "sending";

  useEffect(() => {
    if (!chosen) return;
    let current = true;
    setPreview({ kind: "loading" });
    fetch(`/api/admin/emails/${chosen.slug}/preview`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error())))
      .then((html) => {
        if (current) setPreview({ kind: "ready", html });
      })
      .catch(() => {
        if (current) setPreview({ kind: "error" });
      });
    // Stops a slow response for the previous message from landing after a
    // faster one for the message now chosen.
    return () => {
      current = false;
    };
  }, [chosen]);

  const send = useCallback(async () => {
    if (!valid || !chosen || inFlight.current) return;
    inFlight.current = true;
    setStatus({ kind: "sending" });
    try {
      const res = await fetch(`/api/admin/emails/${chosen.slug}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ to: address }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setStatus({
          kind: "error",
          message: body?.error ?? "The message could not be sent.",
        });
        return;
      }
      setStatus({ kind: "sent", to: address });
      // Cleared so a second Enter cannot quietly send the same quotation to
      // the same person twice, and focused so the next address can be typed
      // straight away.
      setTo("");
      addressRef.current?.focus();
    } catch {
      setStatus({
        kind: "error",
        message: "Could not reach the server. Nothing was sent.",
      });
    } finally {
      inFlight.current = false;
    }
  }, [address, chosen, valid]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href="/admin"
            className="mb-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Admin
          </Link>
          <h1 className="text-xl font-semibold sm:text-2xl">Send emails</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a message, read it exactly as it will arrive, then send it to
            one person.
          </p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
        <form
          className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-4 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="send-to" className="text-sm font-semibold">
              Send to
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="send-to"
                ref={addressRef}
                type="email"
                inputMode="email"
                autoComplete="off"
                autoFocus
                spellCheck={false}
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  // A "sent to someone else" line sitting under a new address
                  // reads as though this one has gone too.
                  if (status.kind !== "idle") setStatus({ kind: "idle" });
                }}
                placeholder="person@example.com"
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              One address. Press Enter to send the message shown here.
            </p>
          </div>

          {/* A fieldset rather than a div: screen readers announce these as one
              group of choices, and the list is short enough that the
              description of each matters more than the compactness of a
              dropdown. */}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold">
              Which message
            </legend>
            {campaigns.map((campaign) => {
              const active = campaign.slug === chosen?.slug;
              return (
                <label
                  key={campaign.slug}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${
                    active
                      ? "border-primary bg-[color-mix(in_oklab,var(--primary)_10%,transparent)]"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  <input
                    type="radio"
                    name="campaign"
                    className="sr-only"
                    checked={active}
                    onChange={() => {
                      setSlug(campaign.slug);
                      if (status.kind !== "idle") setStatus({ kind: "idle" });
                    }}
                  />
                  <span
                    aria-hidden
                    className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
                      active ? "border-primary" : "border-input"
                    }`}
                  >
                    {active ? (
                      <span className="size-2 rounded-full bg-primary" />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {campaign.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {campaign.description}
                    </span>
                    <span className="mt-1.5 block truncate text-xs text-muted-foreground">
                      Subject: {campaign.subject}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          <Button type="submit" disabled={!valid || sending || !chosen}>
            {sending ? (
              <>
                <Loader2 className="animate-spin" /> Sending
              </>
            ) : (
              <>
                <Send /> Send
              </>
            )}
          </Button>

          {status.kind === "sent" ? (
            <Callout tone="success">
              Sent to <strong>{status.to}</strong>.
            </Callout>
          ) : null}
          {status.kind === "error" ? (
            <Callout tone="error">{status.message}</Callout>
          ) : null}
        </form>

        <section className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Preview</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {chosen ? `Subject: ${chosen.subject}` : "Nothing to preview"}
              </p>
            </div>
            {chosen ? (
              <a
                href={`/api/admin/emails/${chosen.slug}/preview`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="size-3.5" /> Open
              </a>
            ) : null}
          </div>
          {/* The frame keeps the email's own paper background rather than the
              app's, so what is on screen is the message and not a page with a
              message in it. */}
          <div className="relative h-[38rem] bg-[#f1ebe2] lg:h-[46rem]">
            {preview.kind === "loading" ? (
              <p className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-[#6e675e]">
                <Loader2 className="size-4 animate-spin" /> Rendering
              </p>
            ) : null}
            {preview.kind === "error" ? (
              <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-[#6e675e]">
                The preview could not be loaded. Reload the page, and if it
                stays empty do not send.
              </p>
            ) : null}
            {preview.kind === "ready" ? (
              <iframe
                srcDoc={preview.html}
                title={`Preview of ${chosen?.name ?? "the message"}`}
                sandbox=""
                className="size-full border-0"
              />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
