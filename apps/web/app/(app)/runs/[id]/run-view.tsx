"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpenCheck,
  Boxes,
  Check,
  Download,
  FilePlus2,
  FileText,
  Filter,
  Lightbulb,
  ListChecks,
  PenLine,
  Quote,
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
import { Badge } from "@/components/ui/badge";
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
import { streamRunEvents } from "@/lib/sse";
import type {
  DocumentDetail,
  DocumentTemplate,
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
  report: { label: "Writing the report", icon: BookOpenCheck },
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

function MarkdownTable({ block }: { block: string }) {
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
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportView({ markdown }: { markdown: string }) {
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
          return <MarkdownTable key={i} block={trimmed} />;
        }
        return (
          <p key={i} className="whitespace-pre-wrap text-[15px] leading-7">
            {trimmed}
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
  const [run, setRun] = useState<RunDetail | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openStage, setOpenStage] = useState<string | null>(null);
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [elapsed, setElapsed] = useState("");
  const userToggledRef = useRef(false);
  const runStatusRef = useRef<RunStatus | null>(null);

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
  }, [runId, loadRun]);

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

  async function onGenerateDocument(template: DocumentTemplate) {
    setGeneratingDoc(true);
    setError(null);
    try {
      const doc = await apiFetch<DocumentDetail>(`/v1/runs/${runId}/document`, {
        method: "POST",
        body: JSON.stringify({ template }),
      });
      router.push(`/documents/${doc.id}`);
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
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
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
              <BookOpenCheck className="size-3" /> literature review
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
          <div className="mt-4">
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            Agent activity
            {isActive && activeStage && (
              <TextShimmer className="text-xs font-normal">
                {stageMeta[activeStage]?.label ?? activeStage}
              </TextShimmer>
            )}
          </CardTitle>
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
                      {meta.label}
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {group.events.length}
                      </span>
                    </ChainOfThoughtTrigger>
                    <ChainOfThoughtContent>
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
                    </ChainOfThoughtContent>
                  </ChainOfThoughtStep>
                );
              })}
            </ChainOfThought>
          )}
        </CardContent>
      </Card>

      {run.papers.length > 0 && (
        <div>
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

      {run.report && (
        <Card>
          <CardContent className="pt-5">
            <ReportView markdown={run.report} />
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">Run {run.id}</p>
    </div>
  );
}
