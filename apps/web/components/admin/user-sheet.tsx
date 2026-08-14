"use client";

/**
 * Everything you can do to one person, in a panel that slides in from the side.
 *
 * Two rules run through it:
 *
 *   Anything that cannot be undone asks first. Signing someone out is a plain
 *   confirm. Deleting an account makes you type the word delete, because it
 *   also removes every piece of research they ever ran.
 *
 *   The API refuses an admin removing their own access or deleting their own
 *   account. Those controls are also disabled here and say why, so the rule is
 *   visible rather than only being discovered by an error message.
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  KeyRound,
  Loader2,
  LogOut,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AI_MODE_LABEL,
  type AiMode,
  type UserDetail,
  deleteUser,
  deleteUserAiKey,
  deleteWork,
  getUser,
  patchUser,
  patchUserAi,
  shortDate,
  signOutUser,
  timeAgo,
} from "@/lib/admin";

/** Work items come back as words already; this maps them to the delete route. */
const WORK_KIND: Record<string, string> = {
  Research: "run",
  Article: "document",
  Table: "extraction",
  Chat: "conversation",
};

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="sm:max-w-[60%] sm:text-right">{children}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h3 className="mb-4 text-sm font-semibold">{title}</h3>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function UserSheet({
  userId,
  isSelf,
  onClose,
  onChanged,
}: {
  userId: string;
  isSelf: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  // Editable copies. Kept apart from detail so a half-typed name is never
  // mistaken for what is actually saved.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<AiMode>("fiberarticle_ai");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [reasoning, setReasoning] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getUser(userId);
      setDetail(data);
      setName(data.user.name);
      setEmail(data.user.email);
      setMode((data.user.ai_mode as AiMode) ?? "fiberarticle_ai");
      setProvider(data.user.ai_provider ?? "");
      setModel(data.user.ai_model ?? "");
      setBaseUrl("");
      setReasoning(data.user.reasoning);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this person");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Escape closes, and the page behind stops scrolling while this is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  /** One wrapper so every action reports the same way and cannot double fire. */
  async function run(action: () => Promise<{ message: string }>, after?: "close") {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await action();
      setNote(res.message);
      onChanged();
      if (after === "close") {
        onClose();
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  const u = detail?.user;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Person details"
        className="relative flex h-full w-full max-w-xl flex-col border-l border-border bg-background shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold sm:text-lg">
              {u ? u.name : "Loading"}
            </h2>
            <p className="truncate text-sm text-muted-foreground">
              {u ? u.email : ""}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X />
          </Button>
        </header>

        {/* The panel body is the only thing that scrolls. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loading ? (
            <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading
            </p>
          ) : !u ? (
            <p className="py-10 text-sm text-destructive">
              {error ?? "Could not load this person"}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {note ? (
                <p className="flex items-center gap-2 rounded-xl border border-border bg-[color-mix(in_oklab,var(--success)_12%,transparent)] px-3 py-2 text-sm text-[var(--success)]">
                  <Check className="size-4 shrink-0" /> {note}
                </p>
              ) : null}
              {error ? (
                <p className="flex items-center gap-2 rounded-xl border border-border bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] px-3 py-2 text-sm text-destructive">
                  <AlertTriangle className="size-4 shrink-0" /> {error}
                </p>
              ) : null}

              <Section title="Their details">
                <Row label="Name">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="sm:w-64"
                  />
                </Row>
                <Row label="Email address">
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="sm:w-64"
                  />
                </Row>
                <Row label="Email confirmed">
                  <Switch
                    checked={u.email_verified}
                    onCheckedChange={(v) =>
                      run(() => patchUser(u.id, { email_verified: v }))
                    }
                    disabled={busy}
                  />
                </Row>
                <Row label="Can open this admin page">
                  <div className="flex items-center justify-end gap-2">
                    <Switch
                      checked={u.role === "admin"}
                      onCheckedChange={(v) =>
                        run(() =>
                          patchUser(u.id, { role: v ? "admin" : "user" })
                        )
                      }
                      disabled={busy || isSelf}
                    />
                  </div>
                  {isSelf ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      You cannot remove your own access.
                    </p>
                  ) : u.role === "admin" ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Turning this off signs them out straight away.
                    </p>
                  ) : null}
                </Row>
                <Row label="Joined">
                  <span className="text-sm">{shortDate(u.created_at)}</span>
                </Row>
                <Row label="Last seen">
                  <span className="text-sm">{timeAgo(u.last_seen)}</span>
                </Row>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    disabled={
                      busy ||
                      (name.trim() === u.name && email.trim() === u.email) ||
                      !name.trim() ||
                      !email.trim()
                    }
                    onClick={() =>
                      run(() =>
                        patchUser(u.id, {
                          name: name.trim(),
                          email: email.trim(),
                        })
                      )
                    }
                  >
                    Save name and email
                  </Button>
                </div>
              </Section>

              <Section title="Which AI they use">
                <Row label="AI choice">
                  <Select.Root
                    value={mode}
                    onValueChange={(v) => setMode(v as AiMode)}
                  >
                    <Select.Trigger className="sm:w-64">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      {Object.entries(AI_MODE_LABEL).map(([value, label]) => (
                        <Select.Item key={value} value={value}>
                          {label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Row>

                {mode === "byok" ? (
                  <>
                    <Row label="Company">
                      <Input
                        value={provider}
                        placeholder="openai, anthropic, groq"
                        onChange={(e) => setProvider(e.target.value)}
                        className="sm:w-64"
                      />
                    </Row>
                    <Row label="Model name">
                      <Input
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="sm:w-64"
                      />
                    </Row>
                  </>
                ) : null}

                {mode === "local" ? (
                  <>
                    <Row label="Address of their computer">
                      <Input
                        value={baseUrl}
                        placeholder="http://localhost:11434/v1"
                        onChange={(e) => setBaseUrl(e.target.value)}
                        className="sm:w-64"
                      />
                    </Row>
                    <Row label="Model name">
                      <Input
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="sm:w-64"
                      />
                    </Row>
                  </>
                ) : null}

                {mode === "fiberarticle_ai" ? (
                  <Row label="Think harder before writing">
                    <Switch
                      checked={reasoning}
                      onCheckedChange={setReasoning}
                      disabled={busy}
                    />
                  </Row>
                ) : null}

                <Row label="Their own key">
                  <div className="flex items-center justify-end gap-2">
                    {u.has_key ? (
                      <>
                        <Badge variant="success">
                          <KeyRound className="mr-1 size-3" /> Saved
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                "Remove their saved key? They will have to enter it again."
                              )
                            )
                              return;
                            void run(() => deleteUserAiKey(u.id));
                          }}
                        >
                          Remove
                        </Button>
                      </>
                    ) : (
                      <Badge variant="outline">Not saved</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Keys can never be read here, not even by you. They can only
                    be removed.
                  </p>
                </Row>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        patchUserAi(u.id, {
                          mode,
                          provider: provider.trim() || null,
                          model: model.trim() || null,
                          base_url: baseUrl.trim() || null,
                          reasoning,
                        })
                      )
                    }
                  >
                    Save AI setup
                  </Button>
                </div>
              </Section>

              <Section title={`Their work (${detail.work.length})`}>
                {detail.work.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    They have not made anything yet.
                  </p>
                ) : (
                  <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
                    {detail.work.map((w) => (
                      <li
                        key={`${w.kind}-${w.id}`}
                        className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-accent"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Badge variant="outline" className="shrink-0">
                            {w.kind}
                          </Badge>
                          <span className="truncate text-sm">{w.title}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="hidden text-xs text-muted-foreground sm:inline">
                            {shortDate(w.created_at)}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete ${w.title}`}
                            disabled={busy}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Delete "${w.title}"? This cannot be undone.`
                                )
                              )
                                return;
                              void run(() =>
                                deleteWork(WORK_KIND[w.kind] ?? "run", w.id)
                              );
                            }}
                          >
                            <Trash2 className="text-destructive" />
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="How they sign in">
                <Row label="Signed in right now">
                  <span className="text-sm">
                    {u.active_sessions === 0
                      ? "Not signed in"
                      : `${u.active_sessions} device${u.active_sessions === 1 ? "" : "s"}`}
                  </span>
                </Row>
                {detail.accounts.map((a) => (
                  <Row
                    key={a.id}
                    label={
                      a.providerId === "credential"
                        ? "Email and password"
                        : `Signs in with ${a.providerId}`
                    }
                  >
                    <span className="text-sm text-muted-foreground">
                      Added {shortDate(a.createdAt)}
                    </span>
                  </Row>
                ))}
                <div className="pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || u.active_sessions === 0}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Sign ${u.name} out of every device? They will have to sign in again.`
                        )
                      )
                        return;
                      void run(() => signOutUser(u.id));
                    }}
                  >
                    <LogOut /> Sign them out everywhere
                  </Button>
                </div>
              </Section>

              <Section title="Delete this account">
                <p className="text-sm text-muted-foreground">
                  This removes {u.name} and everything they have made:{" "}
                  {u.run_count} research {u.run_count === 1 ? "run" : "runs"},{" "}
                  {u.document_count}{" "}
                  {u.document_count === 1 ? "article" : "articles"} and{" "}
                  {u.paper_count.toLocaleString()}{" "}
                  {u.paper_count === 1 ? "paper" : "papers"}. It cannot be
                  undone.
                </p>
                {isSelf ? (
                  <p className="text-sm text-muted-foreground">
                    You cannot delete your own account from here.
                  </p>
                ) : (
                  <>
                    <Input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="Type delete to confirm"
                      className="sm:w-64"
                    />
                    <div>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={
                          busy || confirmText.trim().toLowerCase() !== "delete"
                        }
                        onClick={() => run(() => deleteUser(u.id), "close")}
                      >
                        <Trash2 /> Delete {u.name} and all their work
                      </Button>
                    </div>
                  </>
                )}
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
