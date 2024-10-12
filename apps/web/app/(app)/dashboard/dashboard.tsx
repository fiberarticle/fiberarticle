"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  BookOpen,
  ChevronRight,
  FileText,
  Search,
  Settings2,
} from "lucide-react";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/prompt-kit/prompt-input";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api";
import type { LlmConfig, Run, RunStatus } from "@/lib/types";

const statusVariant: Record<
  RunStatus,
  "default" | "info" | "success" | "destructive"
> = {
  pending: "default",
  running: "info",
  completed: "success",
  failed: "destructive",
  cancelled: "default",
};

const suggestions = [
  "Transformer efficiency techniques for long-context inference",
  "CRISPR off-target detection methods since 2022",
  "Impact of microplastics on marine food webs",
];

export function Dashboard({ userName }: { userName: string }) {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [llmConfig, setLlmConfig] = useState<LlmConfig | null>(null);
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [runsData, configData] = await Promise.all([
        apiFetch<Run[]>("/v1/runs"),
        apiFetch<LlmConfig>("/v1/me/llm-config"),
      ]);
      setRuns(runsData);
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

  async function onStart() {
    setError(null);
    const trimmed = topic.trim();
    if (trimmed.length < 10) {
      setError("Describe your research topic in at least 10 characters.");
      return;
    }
    setStarting(true);
    try {
      const run = await apiFetch<Run>("/v1/runs", {
        method: "POST",
        body: JSON.stringify({ topic: trimmed }),
      });
      router.push(`/runs/${run.id}`);
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

  return (
    <div className="flex flex-col gap-10">
      <section className="mx-auto mt-10 flex w-full max-w-3xl flex-col gap-6">
        <h1 className="text-center text-3xl font-semibold tracking-tight">
          {firstName ? `What should we research, ${firstName}?` : "What should we research?"}
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
            <Link href="/settings">Configure the LLM in Settings</Link>.
          </Callout>
        )}
        {error && <Callout tone="error">{error}</Callout>}

        <PromptInput
          isLoading={starting}
          value={topic}
          onValueChange={setTopic}
          onSubmit={onStart}
          className="w-full pt-1"
        >
          <div className="flex flex-col">
            <PromptInputTextarea placeholder="Describe a research topic, question, or hypothesis..." />
            <PromptInputActions className="mt-3 w-full justify-between px-3 pb-3">
              <div className="flex items-center gap-2">
                <PromptInputAction tooltip="Searches arXiv, OpenAlex, Semantic Scholar, and Crossref">
                  <Button variant="outline" size="sm" className="rounded-full" type="button">
                    <Search />
                    4 scholarly indexes
                  </Button>
                </PromptInputAction>
                <PromptInputAction tooltip="Open-access papers are read in full; paywalled ones abstract-only">
                  <Button variant="outline" size="sm" className="rounded-full" type="button">
                    <BookOpen />
                    Open access
                  </Button>
                </PromptInputAction>
                <PromptInputAction tooltip="LLM settings">
                  <Link href="/settings">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      className="rounded-full"
                      type="button"
                      aria-label="LLM settings"
                    >
                      <Settings2 />
                    </Button>
                  </Link>
                </PromptInputAction>
              </div>
              <div className="flex items-center gap-3">
                {llmConfig?.caps && (
                  <span className="text-xs text-muted-foreground">
                    up to {llmConfig.caps.papers_per_run} papers/run
                  </span>
                )}
                <Button
                  size="icon"
                  className="rounded-full"
                  disabled={!topic.trim() || starting}
                  onClick={onStart}
                  aria-label="Start research"
                >
                  {starting ? (
                    <span className="size-3 rounded-xs bg-primary-foreground" />
                  ) : (
                    <ArrowUp />
                  )}
                </Button>
              </div>
            </PromptInputActions>
          </div>
        </PromptInput>

        {starting && (
          <div className="text-center">
            <TextShimmer className="text-sm">Starting your research run</TextShimmer>
          </div>
        )}

        {!starting && runs !== null && runs.length === 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setTopic(s)}
                className="cursor-pointer rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="mx-auto w-full max-w-3xl">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          Recent research
        </h2>
        {runs === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        ) : runs.length === 0 ? (
          <Card className="flex flex-col items-center gap-1 border-dashed bg-transparent p-8 text-center shadow-none">
            <FileText className="size-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No runs yet. Your research history will appear here.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {runs.map((run) => (
              <Link key={run.id} href={`/runs/${run.id}`}>
                <Card className="group flex items-center justify-between gap-4 p-4 transition-colors hover:bg-accent">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{run.topic}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(run.created_at).toLocaleString()} · {run.paper_count}{" "}
                      papers
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge variant={statusVariant[run.status]}>
                      {run.status === "running" && run.stage
                        ? "running"
                        : run.status}
                    </Badge>
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
