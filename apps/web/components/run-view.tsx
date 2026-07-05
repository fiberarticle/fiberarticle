"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ClipboardCheck,
  Boxes,
  Check,
  Download,
  FilePlus2,
  FileText,
  Filter,
  Lightbulb,
  ListChecks,
  PenLine,
  Play,
  Quote,
  RotateCcw,
  Search,
  Scroll,
  Target,
  X,
} from "lucide-react";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
} from "@/components/prompt-kit/chain-of-thought";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import {
  Source,
  SourceContent,
  SourceTrigger,
} from "@/components/prompt-kit/source";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { streamRunEvents } from "@/lib/sse";
import type {
  DocumentDetail,
  DocumentTemplate,
  Paper,
  RunDetail,
  RunEvent,
  RunStatus,
} from "@/lib/types";

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

const stageMeta: Record<string, { label: string; icon: React.ElementType }> = {
  plan: { label: "Planning the research", icon: Lightbulb },
  generate_queries: { label: "Generating search queries", icon: Scroll },
  search: { label: "Searching scholarly sources", icon: Search },
  dedupe_rank: { label: "Deduplicating and ranking", icon: Filter },
  screen: { label: "Screening papers", icon: ListChecks },
  fetch_oa_pdfs: { label: "Fetching open-access PDFs", icon: Download },
  parse: { label: "Reading documents", icon: FileText },
  chunk_embed: { label: "Indexing the evidence", icon: Boxes },
  extract: { label: "Extracting key findings", icon: Quote },
  coverage_check: { label: "Checking coverage", icon: Target },
  synthesize: { label: "Synthesizing the review", icon: PenLine },
  report: { label: "Writing the report", icon: ClipboardCheck },
};

const stageOrder = Object.keys(stageMeta);

function formatElapsed(startIso: string, endIso?: string | null): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const total = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

interface StageGroup {
  stage: string;
  events: RunEvent[];
}

function groupByStage(events: RunEvent[]): StageGroup[] {
  const groups: StageGroup[] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (last && last.stage === event.stage) {
      last.events.push(event);
    } else {
      groups.push({ stage: event.stage, events: [event] });
    }
  }
  return groups;
}

/** Renders text with every [n] citation marker as a link to that paper. */
function CitedText({ text, papers }: { text: string; papers: Paper[] }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = /^\[(\d+)\]$/.exec(part);
        const paper = match ? papers[Number(match[1]) - 1] : undefined;
        if (paper?.url) {
          return (
            <a
              key={i}
              href={paper.url}
              target="_blank"
              rel="noreferrer"
              title={paper.title}
              className="font-medium text-[#4f90e4] hover:underline"
            >
              {part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function MarkdownTable({ block, papers }: { block: string; papers: Paper[] }) {
  const rows = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));
  if (rows.length < 2) return null;
  const parse = (line: string) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  const header = parse(rows[0]);
  const body = rows
    .slice(1)
    .filter((line) => !/^\|[\s\-|:]+\|$/.test(line))
    .map(parse);
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-muted/60">
          <tr>
            {header.map((cell, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((cells, r) => (
            <tr key={r} className="border-t border-border align-top">
              {cells.map((cell, c) => (
                <td key={c} className="px-3 py-2 leading-5">
                  <CitedText text={cell} papers={papers} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportView({
  markdown,
  papers,
}: {
  markdown: string;
  papers: Paper[];
}) {
  const blocks = markdown.split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith("# ")) {
          return (
            <h1 key={i} className="text-2xl font-semibold tracking-tight">
              {trimmed.slice(2)}
            </h1>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <h2 key={i} className="mt-2 text-lg font-semibold tracking-tight">
              {trimmed.slice(3)}
            </h2>
          );
        }
        if (trimmed.startsWith("|")) {
          return <MarkdownTable key={i} block={trimmed} papers={papers} />;
        }
        return (
          <p key={i} className="whitespace-pre-wrap text-[15px] leading-7">
            <CitedText text={trimmed} papers={papers} />
          </p>
        );
      })}
    </div>
  );
}

const templateMenu: {
  value: DocumentTemplate;
  label: string;
  description: string;
}[] = [
  {
    value: "generic",
    label: "Generic manuscript",
    description: "Clean single-column article",
  },
  { value: "ieee", label: "IEEE", description: "Two-column IEEEtran" },
  { value: "apa", label: "APA 7", description: "Author-date manuscript" },
  { value: "acm", label: "ACM", description: "acmart proceedings format" },
  {
    value: "elsevier",
    label: "Elsevier",
    description: "elsarticle submission format",
  },
  {
    value: "springer",
    label: "Springer Nature",
    description: "sn-jnl journal format",
  },
  { value: "neurips", label: "NeurIPS", description: "Conference preprint" },
];

export function RunView({ runId }: { runId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Article Writer flow: the dashboard set this flag; when the research
  // completes we generate the article automatically.
  const articleIntent = searchParams.get("intent") === "article";
  const [run, setRun] = useState<RunDetail | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openStage, setOpenStage] = useState<string | null>(null);
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // Bumped after resume/retry so the closed SSE stream reconnects.
  const [streamEpoch, setStreamEpoch] = useState(0);
  const [elapsed, setElapsed] = useState("");
  const userToggledRef = useRef(false);
  const runStatusRef = useRef<RunStatus | null>(null);
  // Slide-out report panel: opens itself the first time a report exists,
  // then the user opens and closes it freely.
  const [reportOpen, setReportOpen] = useState(false);
  const reportAutoOpenedRef = useRef(false);

  useEffect(() => {
    if (run?.report && !reportAutoOpenedRef.current) {
      reportAutoOpenedRef.current = true;
      setReportOpen(true);
    }
  }, [run?.report]);

  const loadRun = useCallback(async () => {
    try {
      const data = await apiFetch<RunDetail>(`/v1/runs/${runId}`);
      setRun(data);
      runStatusRef.current = data.status;
      return data;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this run.");
      return null;
    }
  }, [runId]);

  // Live event stream with automatic reconnect while the run is active.
  useEffect(() => {
    let stopped = false;
    let handle: { close: () => void } | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      handle = streamRunEvents(
        runId,
        (event) => {
          try {
            const parsed = JSON.parse(event.data) as RunEvent;
            if (typeof parsed.id !== "number" || !parsed.stage) return;
            setEvents((prev) =>
              prev.some((p) => p.id === parsed.id) ? prev : [...prev, parsed]
            );
          } catch {
            // ignore malformed frames
          }
        },
        async () => {
          const data = await loadRun();
          if (
            !stopped &&
            data &&
            (data.status === "running" || data.status === "pending")
          ) {
            retryTimer = setTimeout(connect, 1500);
          }
        },
        () => {
          if (stopped) return;
          retryTimer = setTimeout(connect, 2000);
        }
      );
    };

    loadRun().then((data) => {
      if (!stopped && data) connect();
    });

    const poll = setInterval(() => {
      if (
        runStatusRef.current === "running" ||
        runStatusRef.current === "pending"
      ) {
        loadRun();
      }
    }, 6000);

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      clearInterval(poll);
      handle?.close();
    };
  }, [runId, loadRun, streamEpoch]);

  const groups = groupByStage(events);
  const isActive = run?.status === "running" || run?.status === "pending";
  const activeStage = groups.length > 0 ? groups[groups.length - 1].stage : null;

  // Elapsed-time ticker while the run is active.
  useEffect(() => {
    if (!run) return;
    const update = () =>
      setElapsed(
        formatElapsed(run.created_at, isActive ? null : run.updated_at)
      );
    update();
    if (!isActive) return;
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [run, isActive]);

  async function onCancelRun() {
    setCancelling(true);
    setError(null);
    try {
      await apiFetch(`/v1/runs/${runId}/cancel`, { method: "POST" });
      await loadRun();
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not stop the run."
      );
    } finally {
      setCancelling(false);
    }
  }

  // Resume: continue a failed run from the stage it died in.
  async function onResumeRun() {
    setResuming(true);
    setError(null);
    try {
      await apiFetch(`/v1/runs/${runId}/resume`, { method: "POST" });
      reportAutoOpenedRef.current = false;
      await loadRun();
      setStreamEpoch((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not resume the run."
      );
    } finally {
      setResuming(false);
    }
  }

  // Retry: wipe the failed attempt and run the same topic from the start.
  async function onRetryRun() {
    setRetrying(true);
    setError(null);
    try {
      await apiFetch(`/v1/runs/${runId}/retry`, { method: "POST" });
      setEvents([]);
      reportAutoOpenedRef.current = false;
      userToggledRef.current = false;
      await loadRun();
      setStreamEpoch((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not retry the run."
      );
    } finally {
      setRetrying(false);
    }
  }

  async function onGenerateDocument(template: DocumentTemplate) {
    setGeneratingDoc(true);
    setError(null);
    try {
      const doc = await apiFetch<DocumentDetail>(`/v1/runs/${runId}/document`, {
        method: "POST",
        body: JSON.stringify({ template }),
      });
      router.push(`/article-writer/${doc.id}`);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not start the article."
      );
      setGeneratingDoc(false);
    }
  }

  useEffect(() => {
    if (!userToggledRef.current && isActive && activeStage) {
      setOpenStage(activeStage);
    }
  }, [activeStage, isActive]);

  // Article Writer: auto-generate the article exactly once when the
  // research run completes. The sessionStorage flag is consumed so a
  // reload never generates a duplicate document.
  useEffect(() => {
    if (!articleIntent || run?.status !== "completed" || generatingDoc) return;
    const key = `fa-article-intent-${runId}`;
    if (sessionStorage.getItem(key) !== "1") return;
    sessionStorage.removeItem(key);
    if (run.paper_count === 0) {
      setError(
        "The research run found no papers, so no article was generated. Try a broader topic."
      );
      return;
    }
    onGenerateDocument("generic");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleIntent, run?.status, run?.paper_count, runId]);

  if (error && !run) {
    return (
      <div className="mx-auto max-w-3xl">
        <Callout tone="error">{error}</Callout>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    // With the report panel open, a fixed right margin reserves the panel's
    // width, so the auto left margin re-centers the content in the space
    // that remains: both stay fully visible side by side.
    <div
      className={cn(
        "mx-auto flex max-w-3xl flex-col gap-6",
        reportOpen && run.report && "xl:mr-[47rem]"
      )}
    >
      <div>
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
            <ArrowLeft /> Home
          </Button>
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {run.topic}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          {run.mode === "literature_review" && (
            <Badge variant="leaf">
              <ClipboardCheck className="size-3" /> literature review
            </Badge>
          )}
          <Badge variant={statusVariant[run.status]}>
            {run.status === "completed" ? (
              <>
                <Check /> completed
              </>
            ) : run.status === "failed" ? (
              <>
                <X /> failed
              </>
            ) : (
              run.status
            )}
          </Badge>
          {run.status === "failed" && (
            <>
              <button
                type="button"
                onClick={onResumeRun}
                disabled={resuming || retrying}
                className={cn(
                  badgeVariants({ variant: "success" }),
                  "cursor-pointer transition-colors hover:bg-[color-mix(in_oklab,var(--success)_22%,transparent)] disabled:opacity-60"
                )}
              >
                <Play /> {resuming ? "Resuming" : "Resume"}
              </button>
              <button
                type="button"
                aria-label="Retry from the start"
                title="Retry from the start"
                onClick={onRetryRun}
                disabled={resuming || retrying}
                className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
              >
                <RotateCcw
                  className={cn("size-4", retrying && "animate-spin")}
                />
              </button>
            </>
          )}
          <span className="text-xs text-muted-foreground">
            Started {new Date(run.created_at).toLocaleString()}
          </span>
          {elapsed && (
            <span className="text-xs text-muted-foreground">{elapsed}</span>
          )}
          {run.paper_count > 0 && (
            <span className="text-xs text-muted-foreground">
              {run.paper_count} papers
            </span>
          )}
          {isActive && (
            <button
              type="button"
              onClick={onCancelRun}
              disabled={cancelling}
              className={cn(
                badgeVariants({ variant: "destructive" }),
                "cursor-pointer transition-colors hover:bg-[color-mix(in_oklab,var(--destructive)_22%,transparent)] disabled:opacity-60"
              )}
            >
              <X /> {cancelling ? "Cancelling" : "Cancel"}
            </button>
          )}
        </div>
        {isActive && activeStage && (
          <div className="mt-4">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[linear-gradient(to_right,var(--classic-accent-from),var(--classic-accent-to))] transition-[width] duration-700"
                style={{
                  width: `${Math.round(((stageOrder.indexOf(activeStage) + 1) / stageOrder.length) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Stage {stageOrder.indexOf(activeStage) + 1} of {stageOrder.length}
            </p>
          </div>
        )}
        {run.status === "completed" && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {run.report && (
              <Button
                variant="secondary"
                onClick={() => setReportOpen((v) => !v)}
              >
                <FileText /> {reportOpen ? "Hide report" : "View report"}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button loading={generatingDoc}>
                  <FilePlus2 /> Generate article
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Journal template</DropdownMenuLabel>
                {templateMenu.map((t) => (
                  <DropdownMenuItem
                    key={t.value}
                    onSelect={() => onGenerateDocument(t.value)}
                  >
                    <span className="flex flex-col">
                      <span>{t.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {t.description}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {error && <Callout tone="error">{error}</Callout>}
      {run.error && <Callout tone="error">{run.error}</Callout>}
      {articleIntent && isActive && (
        <Callout tone="info">
          Article Writer: a full article will be generated automatically as
          soon as this research completes.
        </Callout>
      )}
      {articleIntent && generatingDoc && (
        <Callout tone="info">
          Research complete. Writing your article now — you will be taken to
          the editor.
        </Callout>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Agent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            isActive ? (
              <TextShimmer className="text-sm">
                Fiberarticle is thinking
              </TextShimmer>
            ) : (
              <p className="text-sm text-muted-foreground">
                No activity was recorded for this run.
              </p>
            )
          ) : (
            <ChainOfThought>
              {groups.map((group, index) => {
                const meta = stageMeta[group.stage] ?? {
                  label: group.stage,
                  icon: Lightbulb,
                };
                const Icon = meta.icon;
                const isLast = index === groups.length - 1;
                const hasError = group.events.some((e) => e.type === "error");
                const stageStatus =
                  hasError ? "error" : isActive && isLast ? "active" : "done";
                const key = `${group.stage}-${index}`;
                return (
                  <ChainOfThoughtStep
                    key={key}
                    isLast={isLast}
                    open={openStage === key || (isActive && isLast && !userToggledRef.current)}
                    onOpenChange={(open) => {
                      userToggledRef.current = true;
                      setOpenStage(open ? key : null);
                    }}
                  >
                    <ChainOfThoughtTrigger
                      leftIcon={<Icon />}
                      status={stageStatus}
                    >
                      {/* The step that is happening right now shimmers in
                          place; no separate status label anywhere else. */}
                      {stageStatus === "active" ? (
                        <TextShimmer>{meta.label}</TextShimmer>
                      ) : (
                        meta.label
                      )}
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {group.events.length}
                      </span>
                    </ChainOfThoughtTrigger>
                    <ChainOfThoughtContent>
                      {/* Claude-style: long stage logs stay compact and
                          scroll inside a fixed-height box. */}
                      <div className="fa-textarea-scroll flex max-h-52 flex-col gap-1.5 overflow-y-auto pr-2">
                        {group.events.map((event) => (
                          <ChainOfThoughtItem
                            key={event.id}
                            className={
                              event.type === "error"
                                ? "text-destructive"
                                : event.type === "warning"
                                  ? "text-warning"
                                  : undefined
                            }
                          >
                            {event.message}
                          </ChainOfThoughtItem>
                        ))}
                      </div>
                    </ChainOfThoughtContent>
                  </ChainOfThoughtStep>
                );
              })}
            </ChainOfThought>
          )}
        </CardContent>
      </Card>

      {run.papers.length > 0 && (
        <div className="min-w-0">
          <h2 className="mb-2.5 text-sm font-semibold text-muted-foreground">
            Sources ({run.papers.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {run.papers.map((paper, i) => (
              <Source key={paper.id} href={paper.url ?? undefined}>
                <SourceTrigger label={`[${i + 1}] ${paper.title}`} />
                <SourceContent
                  title={paper.title}
                  description={
                    [
                      paper.authors.slice(0, 4).join(", ") +
                        (paper.authors.length > 4 ? " et al." : ""),
                      paper.year ? `(${paper.year})` : null,
                      paper.venue,
                      paper.quartile ? `· ${paper.quartile} journal` : null,
                    ]
                      .filter(Boolean)
                      .join(" ") +
                    (paper.abstract ? ` · ${paper.abstract}` : "")
                  }
                />
              </Source>
            ))}
          </div>
        </div>
      )}

      {/* Slide-out report panel, Claude artifact style: opens from the
          right edge, closable, reopenable from the View report button. */}
      {run.report && (
        <div
          className={cn(
            "fixed inset-y-0 right-0 z-40 flex w-[min(720px,94vw)] flex-col border-l border-border bg-card transition-transform duration-300 ease-out",
            reportOpen ? "translate-x-0" : "translate-x-full"
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="size-4 text-muted-foreground" />
              Research report
            </span>
            <button
              type="button"
              aria-label="Close report"
              onClick={() => setReportOpen(false)}
              className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <ReportView markdown={run.report} papers={run.papers} />
          </div>
        </div>
      )}
    </div>
  );
}
