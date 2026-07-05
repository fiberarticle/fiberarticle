"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";
import {
  AgentComposer,
  AGENTS,
  type AgentMode,
} from "@/components/agent-composer";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import { Callout } from "@/components/ui/callout";
import { apiFetch, ApiError, apiUrl, getApiToken } from "@/lib/api";
import type { LlmConfig, Run } from "@/lib/types";

const MODE_STORAGE_KEY = "fa-agent-mode";

const startingLabel: Record<AgentMode, string> = {
  researcher: "Starting your research run",
  article: "Starting research for your article",
  review: "Starting your literature review",
  assistant: "Taking you to your answer",
};

function isAgentMode(value: string | null): value is AgentMode {
  return AGENTS.some((a) => a.id === value);
}

export function Dashboard({ userName }: { userName: string }) {
  const router = useRouter();
  const [llmConfig, setLlmConfig] = useState<LlmConfig | null>(null);
  const [mode, setMode] = useState<AgentMode>("researcher");
  const [topic, setTopic] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [starting, setStarting] = useState(false);

  // Restore the last-used agent after mount (avoids hydration mismatch).
  useEffect(() => {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (isAgentMode(stored)) setMode(stored);
  }, []);

  function onModeChange(next: AgentMode) {
    setMode(next);
    setError(null);
    localStorage.setItem(MODE_STORAGE_KEY, next);
  }

  const load = useCallback(async () => {
    try {
      const configData = await apiFetch<LlmConfig>("/v1/me/llm-config");
      setLlmConfig(configData);
      setApiDown(false);
    } catch (e) {
      if (!(e instanceof ApiError)) {
        setApiDown(true);
      }
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load]);

  function onAttach(files: File[]) {
    setError(null);
    setAttachments((prev) => {
      const merged = [...prev];
      for (const file of files) {
        const duplicate = merged.some(
          (f) => f.name === file.name && f.size === file.size
        );
        if (!duplicate) merged.push(file);
      }
      return merged;
    });
  }

  function onRemoveAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  /** Upload every attachment so the task can use them. Returns the created
   * paper ids, or null (and reports errors) if any upload failed. */
  async function uploadAttachments(): Promise<string[] | null> {
    if (attachments.length === 0) return [];
    setUploading(true);
    const failures: string[] = [];
    const uploaded: string[] = [];
    try {
      const token = await getApiToken();
      for (const file of attachments) {
        const form = new FormData();
        form.append("file", file);
        try {
          const res = await fetch(apiUrl("/v1/papers/upload"), {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            failures.push(`${file.name}: ${body.detail ?? "upload failed"}`);
          } else {
            const body = await res.json().catch(() => null);
            if (body?.id) uploaded.push(body.id);
          }
        } catch {
          failures.push(`${file.name}: upload failed`);
        }
      }
    } finally {
      setUploading(false);
    }
    if (failures.length > 0) {
      setError(`Some attachments were not added: ${failures.join("; ")}`);
      // Keep only the failed files so the user can fix or remove them.
      setAttachments((prev) =>
        prev.filter((f) => failures.some((msg) => msg.startsWith(f.name)))
      );
      return null;
    }
    setAttachments([]);
    return uploaded;
  }

  async function onStart() {
    setError(null);
    const trimmed = topic.trim();

    if (mode === "assistant") {
      if (trimmed.length < 3) {
        setError("Ask a fuller question so the search has something to work with.");
        return;
      }
      setStarting(true);
      const uploadedIds = await uploadAttachments();
      if (uploadedIds === null) {
        setStarting(false);
        return;
      }
      // The Assistant page creates the chat and sends this question;
      // attached=1 forces a library search over the just-uploaded files.
      router.push(
        `/assistant?q=${encodeURIComponent(trimmed)}${
          uploadedIds.length > 0 ? "&attached=1" : ""
        }`
      );
      return;
    }

    if (trimmed.length < 10) {
      setError("Describe your topic in at least 10 characters.");
      return;
    }
    setStarting(true);
    const seedIds = await uploadAttachments();
    if (seedIds === null) {
      setStarting(false);
      return;
    }
    try {
      const run = await apiFetch<Run>("/v1/runs", {
        method: "POST",
        body: JSON.stringify({
          topic: trimmed,
          mode: mode === "review" ? "literature_review" : "research",
          // Attached papers are guaranteed sources for the run.
          seed_paper_ids: seedIds.length > 0 ? seedIds : null,
        }),
      });
      if (mode === "article") {
        // The run page consumes this once and auto-generates the article
        // when the research completes.
        sessionStorage.setItem(`fa-article-intent-${run.id}`, "1");
        router.push(`/runs/${run.id}?intent=article`);
      } else {
        router.push(`/runs/${run.id}`);
      }
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "The Fiberarticle API is unreachable. Is it running?"
      );
      setStarting(false);
    }
  }

  const firstName = userName.trim().split(" ")[0];
  const llmNotConfigured = llmConfig !== null && llmConfig.mode === null;

  const heading =
    mode === "assistant"
      ? firstName
        ? `What do you want to know, ${firstName}?`
        : "What do you want to know?"
      : mode === "article"
        ? firstName
          ? `What should we write, ${firstName}?`
          : "What should we write?"
        : mode === "review"
          ? firstName
            ? `What should we review, ${firstName}?`
            : "What should we review?"
          : firstName
            ? `What should we research, ${firstName}?`
            : "What should we research?";

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center">
      <section className="-mt-10 flex w-full max-w-3xl flex-col gap-6">
        <h1 className="text-center text-3xl font-semibold tracking-tight">
          {heading}
        </h1>

        {apiDown && (
          <Callout tone="error">
            The Fiberarticle API is unreachable. Start it and this page will
            recover automatically.
          </Callout>
        )}
        {llmNotConfigured && (
          <Callout tone="info">
            Choose how Fiberarticle should think before your first run.{" "}
            <Link href="?settings=llm">Configure the LLM in Settings</Link>.
          </Callout>
        )}
        {error && <Callout tone="error">{error}</Callout>}

        <AgentComposer
          mode={mode}
          onModeChange={onModeChange}
          value={topic}
          onValueChange={setTopic}
          onSubmit={onStart}
          isLoading={starting}
          attachments={attachments}
          onAttach={onAttach}
          onRemoveAttachment={onRemoveAttachment}
        />

        {mode === "article" && (
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <PenLine className="size-3.5" />
            Article Writer researches the topic first, then writes a full
            journal-style article you can edit and export.
          </p>
        )}
        {mode === "review" && (
          <p className="text-center text-xs text-muted-foreground">
            Need screening criteria and filters? Use the full{" "}
            <Link
              href="/review"
              className="font-medium text-primary hover:underline"
            >
              Literature review
            </Link>{" "}
            form.
          </p>
        )}

        {starting && (
          <div className="text-center">
            <TextShimmer className="text-sm">
              {uploading
                ? "Adding your attachments"
                : startingLabel[mode]}
            </TextShimmer>
          </div>
        )}
      </section>
    </div>
  );
}
