"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  BadgeCheck,
  BookMarked,
  ChevronDown,
  Cpu,
  HatGlasses,
  KeyRound,
  Languages,
  Lightbulb,
  Scroll,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StylePicker } from "@/components/style-picker";
import { apiFetch, ApiError, apiUrl, getApiToken } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import type {
  LanguageOption,
  LlmConfig,
  LlmMode,
  Preferences,
} from "@/lib/types";

/** Query param that opens the dialog from anywhere: ?settings=<tab>. */
export const SETTINGS_PARAM = "settings";

type SettingsTab = "preferences" | "llm" | "account";

const TABS: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "llm", label: "AI Model", icon: HatGlasses },
  { id: "account", label: "Account", icon: UserRound },
];

function isTab(value: string | null): value is SettingsTab {
  return TABS.some((t) => t.id === value);
}

const byokProviders = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Google Gemini (AI Studio)" },
  { value: "groq", label: "Groq" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "zen", label: "OpenCode Zen" },
  { value: "custom", label: "Custom OpenAI-compatible" },
];

const defaultModels: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-5",
  gemini: "gemini-2.5-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "deepseek/deepseek-chat-v3-0324:free",
  zen: "",
  custom: "",
};

const modes: {
  value: LlmMode;
  title: string;
  description: string;
  icon: React.ElementType;
}[] = [
  {
    value: "fiberarticle_ai",
    title: "Fiberarticle AI",
    description: "Zero setup. Managed by us.",
    icon: Scroll,
  },
  {
    value: "byok",
    title: "Bring your own key",
    description: "Your own provider key via LiteLLM.",
    icon: KeyRound,
  },
  {
    value: "local",
    title: "Local LLM",
    description: "Ollama, vLLM, or LM Studio endpoint.",
    icon: Cpu,
  },
];

function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-sm font-medium">
        {label}
      </span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function PreferencesPanel() {
  const [prefs, setPrefs] = React.useState<Preferences | null>(null);
  const [languages, setLanguages] = React.useState<LanguageOption[]>([]);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    apiFetch<Preferences>("/v1/me/preferences").then(setPrefs).catch(() => {});
    apiFetch<LanguageOption[]>("/v1/me/languages")
      .then(setLanguages)
      .catch(() => {});
  }, []);

  async function save(patch: { citation_style?: string; ai_language?: string }) {
    setError(null);
    setSaved(false);
    try {
      const updated = await apiFetch<Preferences>("/v1/me/preferences", {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      setPrefs(updated);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save preferences.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-start gap-3">
          <BookMarked className="mt-0.5 size-5 text-muted-foreground" />
          <span className="flex flex-col">
            <span className="text-sm font-semibold">Citation style</span>
            <span className="max-w-xs text-xs leading-relaxed text-muted-foreground">
              Used everywhere Fiberarticle formats a reference. Search the full
              catalog of 10,000+ CSL styles.
            </span>
          </span>
        </span>
        <StylePicker
          value={prefs?.citation_style ?? "apa"}
          valueTitle={prefs?.citation_style_title}
          onSelect={(style) => save({ citation_style: style.id })}
        >
          <Button variant="outline" className="max-w-56 justify-between">
            <span className="truncate">
              {prefs?.citation_style_title ?? "APA Style 7th edition"}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        </StylePicker>
      </div>

      <div className="h-px bg-border" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-start gap-3">
          <Languages className="mt-0.5 size-5 text-muted-foreground" />
          <span className="flex flex-col">
            <span className="text-sm font-semibold">AI generation language</span>
            <span className="max-w-xs text-xs leading-relaxed text-muted-foreground">
              The language Fiberarticle writes in. Citations stay untouched.
            </span>
          </span>
        </span>
        <Select.Root
          value={prefs?.ai_language ?? "en-US"}
          onValueChange={(value) => save({ ai_language: value })}
        >
          <Select.Trigger className="w-56">
            <Select.Value placeholder="English (US)" />
          </Select.Trigger>
          <Select.Content>
            {(languages.length > 0
              ? languages
              : [{ value: "en-US", label: "English (US)" }]
            ).map((lang) => (
              <Select.Item key={lang.value} value={lang.value}>
                {lang.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </div>

      {error && <Callout tone="error">{error}</Callout>}
      {saved && <Callout tone="success">Preferences saved.</Callout>}
    </div>
  );
}

function LlmPanel() {
  const [config, setConfig] = React.useState<LlmConfig | null>(null);
  const [mode, setMode] = React.useState<LlmMode>("fiberarticle_ai");
  const [provider, setProvider] = React.useState("openai");
  const [model, setModel] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  // Fast model is the default; max reasoning is an explicit opt-in.
  const [reasoning, setReasoning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [apiDown, setApiDown] = React.useState(false);

  React.useEffect(() => {
    apiFetch<LlmConfig>("/v1/me/llm-config")
      .then((data) => {
        setConfig(data);
        if (data.mode) setMode(data.mode);
        if (data.provider) setProvider(data.provider);
        if (data.model) setModel(data.model);
        if (data.base_url) setBaseUrl(data.base_url);
        if (typeof data.reasoning === "boolean") setReasoning(data.reasoning);
      })
      .catch((e) => {
        if (!(e instanceof ApiError)) setApiDown(true);
      });
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    if (mode === "byok" && !apiKey && !config?.has_key) {
      setError("Enter your provider API key.");
      return;
    }
    if (mode === "local" && !baseUrl) {
      setError(
        "Enter the base URL of your OpenAI-compatible endpoint, for example http://localhost:11434/v1"
      );
      return;
    }
    if (mode === "byok" && provider === "custom" && (!baseUrl || !model)) {
      setError("Custom providers need both a base URL and a model name.");
      return;
    }

    setPending(true);
    try {
      const updated = await apiFetch<LlmConfig>("/v1/me/llm-config", {
        method: "PUT",
        body: JSON.stringify({
          mode,
          provider: mode === "byok" ? provider : null,
          model:
            mode === "fiberarticle_ai"
              ? null
              : model || defaultModels[provider] || null,
          api_key: apiKey || null,
          base_url:
            mode === "local" || (mode === "byok" && provider === "custom")
              ? baseUrl || null
              : null,
          reasoning,
        }),
      });
      setConfig(updated);
      setApiKey("");
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "The Fiberarticle API is unreachable."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSave} className="flex flex-col gap-5">
      {apiDown && (
        <Callout tone="error">
          The Fiberarticle API is unreachable. LLM settings need it running.
        </Callout>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        {modes.map((m) => {
          const Icon = m.icon;
          const selected = mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-2xl border p-3.5 text-left transition-colors",
                selected
                  ? "border-ring bg-[color-mix(in_oklab,var(--primary)_8%,transparent)]"
                  : "border-border hover:bg-accent"
              )}
            >
              <Icon
                className={cn(
                  "size-4",
                  selected ? "text-primary" : "text-muted-foreground"
                )}
              />
              <span className="mt-1 text-sm font-semibold">{m.title}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {m.description}
              </span>
            </button>
          );
        })}
      </div>

      {mode === "byok" && (
        <>
          <Field label="Provider">
            <Select.Root
              value={provider}
              onValueChange={(value) => {
                setProvider(value);
                setModel(defaultModels[value] ?? "");
              }}
            >
              <Select.Trigger className="max-w-xs">
                <Select.Value placeholder="Select a provider..." />
              </Select.Trigger>
              <Select.Content>
                {byokProviders.map((p) => (
                  <Select.Item key={p.value} value={p.value}>
                    {p.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Field>
          <Field label="Model">
            <Input
              placeholder={defaultModels[provider] || "model-name"}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="max-w-sm"
            />
          </Field>
          <Field
            label={
              <>
                API key
                {config?.has_key && (
                  <Badge variant="success">
                    <BadgeCheck /> saved
                  </Badge>
                )}
              </>
            }
            hint="Stored encrypted. Never shown again, never logged."
          >
            <Input
              type="password"
              placeholder={
                config?.has_key ? "Leave blank to keep the saved key" : "sk-..."
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="max-w-sm"
            />
          </Field>
          {provider === "custom" && (
            <Field label="Base URL">
              <Input
                placeholder="https://my-endpoint.example.com/v1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="max-w-sm"
              />
            </Field>
          )}
        </>
      )}

      {mode === "local" && (
        <>
          <Field
            label="Endpoint base URL"
            hint="The endpoint must be reachable from the Fiberarticle API server, not just from your browser."
          >
            <Input
              placeholder="http://localhost:11434/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="max-w-sm"
            />
          </Field>
          <Field label="Model">
            <Input
              placeholder="llama3.1:8b"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="max-w-sm"
            />
          </Field>
        </>
      )}

      {mode === "fiberarticle_ai" && (
        <>
          <button
            type="button"
            onClick={() => setReasoning((r) => !r)}
            aria-pressed={reasoning}
            className={cn(
              "flex items-center justify-between gap-3 rounded-2xl border p-3.5 text-left transition-colors",
              reasoning
                ? "border-ring bg-[color-mix(in_oklab,var(--primary)_8%,transparent)]"
                : "border-border hover:bg-accent"
            )}
          >
            <span className="flex items-center gap-3">
              <Lightbulb
                className={cn(
                  "size-5",
                  reasoning ? "text-primary" : "text-muted-foreground"
                )}
              />
              <span className="flex flex-col">
                <span className="text-sm font-semibold">Max reasoning</span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {reasoning
                    ? "On: deepest analysis for the most accurate results. Slower."
                    : "Off: a fast model. Quicker runs, lighter reasoning."}
                </span>
              </span>
            </span>
            <span
              aria-hidden
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                reasoning ? "bg-primary" : "bg-input"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-5 rounded-full bg-background shadow transition-all",
                  reasoning ? "left-[calc(100%-1.375rem)]" : "left-0.5"
                )}
              />
            </span>
          </button>
          <Callout tone="info">
            Fiberarticle AI is fully managed. No keys, no setup.
          </Callout>
        </>
      )}

      {error && <Callout tone="error">{error}</Callout>}
      {saved && <Callout tone="success">LLM configuration saved.</Callout>}

      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          Save configuration
        </Button>
      </div>
    </form>
  );
}

// Mirrors the server-side policy in lib/auth.ts.
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,64}$/;

function AccountPanel({
  userName,
  userEmail,
  emailVerified,
}: {
  userName: string;
  userEmail: string;
  emailVerified: boolean;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(userName);
  const [saved, setSaved] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [verifySent, setVerifySent] = React.useState(false);

  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [pwPending, setPwPending] = React.useState(false);
  const [pwError, setPwError] = React.useState<string | null>(null);
  const [pwSaved, setPwSaved] = React.useState(false);

  const [exportError, setExportError] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);

  const [confirmDelete, setConfirmDelete] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  async function onSaveName(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setSaved(false);
    await authClient.updateUser({ name });
    setPending(false);
    setSaved(true);
  }

  async function onSendVerification() {
    await authClient.sendVerificationEmail({
      email: userEmail,
      callbackURL: "/dashboard?settings=account",
    });
    setVerifySent(true);
  }

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSaved(false);
    if (!PASSWORD_RE.test(newPassword)) {
      setPwError(
        "Use 8-64 characters with an uppercase letter, a lowercase letter, and a number."
      );
      return;
    }
    setPwPending(true);
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setPwPending(false);
    if (error) {
      setPwError(
        error.message ??
          "Could not change the password. Check your current password."
      );
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setPwSaved(true);
  }

  async function onExportData() {
    setExporting(true);
    setExportError(null);
    try {
      const token = await getApiToken();
      const res = await fetch(apiUrl("/v1/me/export"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "fiberarticle-export.json";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setExportError("Export failed. Is the Fiberarticle API running?");
    } finally {
      setExporting(false);
    }
  }

  async function onDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      // Purge all API data first, then remove the auth account itself.
      await apiFetch("/v1/me", { method: "DELETE" });
      const { error } = await authClient.deleteUser();
      if (error) {
        setDeleteError(
          error.message ??
            "Your data was deleted, but the account could not be removed. Sign in again and retry."
        );
        return;
      }
      router.push("/sign-up");
      router.refresh();
    } catch (e) {
      setDeleteError(
        e instanceof ApiError
          ? e.message
          : "Could not delete your data. Try again."
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={onSaveName} className="flex flex-col gap-3">
        <Field label="Full name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="max-w-sm"
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" loading={pending}>
            Save name
          </Button>
          {saved && <span className="text-sm text-success">Saved.</span>}
        </div>
      </form>

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Email</span>
        <div className="flex items-center gap-2">
          <span className="text-sm">{userEmail}</span>
          {emailVerified ? (
            <Badge variant="success">
              <BadgeCheck /> verified
            </Badge>
          ) : (
            <Badge variant="warning">unverified</Badge>
          )}
        </div>
        {!emailVerified &&
          (verifySent ? (
            <span className="text-xs text-muted-foreground">
              Verification email sent. Check your inbox.
            </span>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="w-fit"
              onClick={onSendVerification}
            >
              Resend verification email
            </Button>
          ))}
      </div>

      <div className="h-px bg-border" />

      <form onSubmit={onChangePassword} className="flex flex-col gap-3">
        <Field
          label="Change password"
          hint="Accounts created with Google have no password to change."
        >
          <Input
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            className="max-w-sm"
          />
        </Field>
        <Input
          type="password"
          placeholder="New password (min 8 chars, upper, lower, number)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          className="max-w-sm"
        />
        {pwError && <Callout tone="error">{pwError}</Callout>}
        {pwSaved && (
          <Callout tone="success">
            Password changed. Other sessions were signed out.
          </Callout>
        )}
        <Button
          type="submit"
          variant="secondary"
          className="w-fit"
          loading={pwPending}
          disabled={!currentPassword || !newPassword}
        >
          Change password
        </Button>
      </form>

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Export your data</span>
        <span className="text-xs text-muted-foreground">
          Download everything you own — runs, papers, articles, chats, and
          extractions — as one JSON file.
        </span>
        {exportError && <Callout tone="error">{exportError}</Callout>}
        <Button
          variant="secondary"
          size="sm"
          className="w-fit"
          loading={exporting}
          onClick={onExportData}
        >
          Download my data
        </Button>
      </div>

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-destructive">
          Delete account
        </span>
        <span className="text-xs text-muted-foreground">
          Permanently deletes your account and all of your data: runs, papers,
          articles, chats, and extractions. This cannot be undone. Type{" "}
          <span className="font-semibold">DELETE</span> to confirm.
        </span>
        {deleteError && <Callout tone="error">{deleteError}</Callout>}
        <div className="flex items-center gap-2">
          <Input
            placeholder="DELETE"
            value={confirmDelete}
            onChange={(e) => setConfirmDelete(e.target.value)}
            className="max-w-36"
          />
          <Button
            variant="destructive"
            size="sm"
            disabled={confirmDelete !== "DELETE"}
            loading={deleting}
            onClick={onDeleteAccount}
          >
            Delete my account
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Centered settings modal over a blurred backdrop, opened from anywhere with
 * the ?settings=<tab> query param (preferences | llm | account). Left rail
 * picks the panel, ChatGPT/Claude style.
 */
export function SettingsDialog({
  userName,
  userEmail,
  emailVerified,
}: {
  userName: string;
  userEmail: string;
  emailVerified: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const param = searchParams.get(SETTINGS_PARAM);
  const open = param !== null;
  const [tab, setTab] = React.useState<SettingsTab>("preferences");

  React.useEffect(() => {
    if (isTab(param)) setTab(param);
  }, [param]);

  function onOpenChange(next: boolean) {
    if (!next) {
      // Strip the param so the dialog closes and the URL is clean again.
      const params = new URLSearchParams(searchParams.toString());
      params.delete(SETTINGS_PARAM);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 flex h-[min(600px,85vh)] w-[min(860px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_80px_rgba(0,0,0,0.35)] outline-none"
          aria-describedby={undefined}
        >
          {/* Left rail */}
          <div className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-border bg-sidebar p-3 sm:w-56">
            <p className="px-2 pb-2 pt-1 text-xs font-medium text-muted-foreground">
              Settings
            </p>
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors [&_svg]:size-4",
                    active
                      ? "bg-[color-mix(in_oklab,var(--primary)_12%,transparent)] font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Icon />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Content pane */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <DialogPrimitive.Title className="text-sm font-semibold">
                {TABS.find((t) => t.id === tab)?.label}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close asChild>
                <button
                  aria-label="Close settings"
                  className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </DialogPrimitive.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {tab === "preferences" && <PreferencesPanel />}
              {tab === "llm" && <LlmPanel />}
              {tab === "account" && (
                <AccountPanel
                  userName={userName}
                  userEmail={userEmail}
                  emailVerified={emailVerified}
                />
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
