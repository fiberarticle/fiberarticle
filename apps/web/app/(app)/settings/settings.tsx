"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Cpu, KeyRound, Lightbulb, Scroll } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch, ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import type { LlmConfig, LlmMode } from "@/lib/types";

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

export function Settings({
  userName,
  userEmail,
  emailVerified,
}: {
  userName: string;
  userEmail: string;
  emailVerified: boolean;
}) {
  const [name, setName] = useState(userName);
  const [nameSaved, setNameSaved] = useState(false);
  const [namePending, setNamePending] = useState(false);

  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [mode, setMode] = useState<LlmMode>("fiberarticle_ai");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [reasoning, setReasoning] = useState(true);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [llmSaved, setLlmSaved] = useState(false);
  const [llmPending, setLlmPending] = useState(false);
  const [apiDown, setApiDown] = useState(false);
  const [verifySent, setVerifySent] = useState(false);

  useEffect(() => {
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

  async function onSaveName(e: React.FormEvent) {
    e.preventDefault();
    setNamePending(true);
    setNameSaved(false);
    await authClient.updateUser({ name });
    setNamePending(false);
    setNameSaved(true);
  }

  async function onSendVerification() {
    await authClient.sendVerificationEmail({
      email: userEmail,
      callbackURL: "/settings",
    });
    setVerifySent(true);
  }

  async function onSaveLlm(e: React.FormEvent) {
    e.preventDefault();
    setLlmError(null);
    setLlmSaved(false);

    if (mode === "byok" && !apiKey && !config?.has_key) {
      setLlmError("Enter your provider API key.");
      return;
    }
    if (mode === "local" && !baseUrl) {
      setLlmError(
        "Enter the base URL of your OpenAI-compatible endpoint, for example http://localhost:11434/v1"
      );
      return;
    }
    if (mode === "byok" && provider === "custom" && (!baseUrl || !model)) {
      setLlmError("Custom providers need both a base URL and a model name.");
      return;
    }

    setLlmPending(true);
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
      setLlmSaved(true);
    } catch (e) {
      setLlmError(
        e instanceof ApiError
          ? e.message
          : "The Fiberarticle API is unreachable."
      );
    } finally {
      setLlmPending(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account and how Fiberarticle thinks.
        </p>
      </div>

      {apiDown && (
        <Callout tone="error">
          The Fiberarticle API is unreachable. LLM settings need it running.
        </Callout>
      )}

      <Tabs defaultValue="llm">
        <TabsList>
          <TabsTrigger value="llm">Fiberarticle AI</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>

        <TabsContent value="llm">
          <Card>
            <CardHeader>
              <CardTitle>How should Fiberarticle think?</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSaveLlm} className="flex flex-col gap-5">
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
                        <span className="mt-1 text-sm font-semibold">
                          {m.title}
                        </span>
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
                      <select
                        value={provider}
                        onChange={(e) => {
                          setProvider(e.target.value);
                          setModel(defaultModels[e.target.value] ?? "");
                        }}
                        className="h-9 w-full max-w-xs cursor-pointer rounded-xl border border-input bg-transparent px-3 text-sm focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1"
                      >
                        {byokProviders.map((p) => (
                          <option
                            key={p.value}
                            value={p.value}
                            className="bg-popover text-popover-foreground"
                          >
                            {p.label}
                          </option>
                        ))}
                      </select>
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
                          config?.has_key
                            ? "Leave blank to keep the saved key"
                            : "sk-..."
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
                          <span className="text-sm font-semibold">
                            Max reasoning
                          </span>
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
                      Fiberarticle AI is fully managed. No keys, no setup, no run
                      limits.
                    </Callout>
                  </>
                )}

                {llmError && <Callout tone="error">{llmError}</Callout>}
                {llmSaved && (
                  <Callout tone="success">LLM configuration saved.</Callout>
                )}

                <div className="flex justify-end">
                  <Button type="submit" loading={llmPending}>
                    Save configuration
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="account">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
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
                  <Button type="submit" loading={namePending}>
                    Save name
                  </Button>
                  {nameSaved && (
                    <span className="text-sm text-success">Saved.</span>
                  )}
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
