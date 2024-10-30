"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, ChevronRight, FunnelPlus, UserRound } from "lucide-react";
import { ResearcherArt } from "@/components/art";
import { quartileChipClass } from "@/components/quartile-badge";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, ApiError } from "@/lib/api";
import type { Quartile, Run, RunStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

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

const quartileOptions: Quartile[] = ["Q1", "Q2", "Q3", "Q4"];

export function Researcher() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [quartiles, setQuartiles] = useState<Quartile[]>([]);
  const [openAccessOnly, setOpenAccessOnly] = useState(false);
  const [minCitations, setMinCitations] = useState("");
  const [maxPapers, setMaxPapers] = useState("40");

  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Run[]>("/v1/runs?mode=research");
      setRuns(data);
    } catch {
      // The list is secondary; the form still works if it fails.
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load]);

  const activeFilterCount =
    (yearFrom || yearTo ? 1 : 0) +
    (quartiles.length > 0 ? 1 : 0) +
    (openAccessOnly ? 1 : 0) +
    (minCitations ? 1 : 0) +
    (maxPapers !== "40" ? 1 : 0);

  async function onStart() {
    setError(null);
    const trimmed = topic.trim();
    if (trimmed.length < 10) {
      setError("Describe your topic in at least 10 characters.");
      return;
    }
    setStarting(true);
    const filters: Record<string, unknown> = {};
    if (yearFrom) filters.year_from = Number(yearFrom);
    if (yearTo) filters.year_to = Number(yearTo);
    if (quartiles.length > 0) filters.quartiles = quartiles;
    if (openAccessOnly) filters.open_access_only = true;
    if (minCitations) filters.min_citations = Number(minCitations);
    if (maxPapers) filters.max_papers = Number(maxPapers);
    try {
      const run = await apiFetch<Run>("/v1/runs", {
        method: "POST",
        body: JSON.stringify({
          topic: trimmed,
          mode: "research",
          filters: Object.keys(filters).length > 0 ? filters : null,
        }),
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Researcher</h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            End-to-end research on any topic: the agent plans, searches four
            scholarly indexes, screens and reads the papers, and writes a
            cited research report.
          </p>
        </div>
        <ResearcherArt className="hidden w-40 shrink-0 sm:block" />
      </div>

      <Card className="flex flex-col gap-4 p-5">
        <Textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Example: How effective are mRNA vaccines against emerging influenza strains?"
          className="min-h-20"
        />

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="flex w-fit cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <FunnelPlus className="size-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </button>

          {showFilters && (
            <div className="flex flex-col gap-4 rounded-2xl border border-border p-4">
              <div className="flex flex-wrap items-center gap-3">
                <p className="w-40 text-sm font-medium">Publication years</p>
                <Input
                  placeholder="From"
                  value={yearFrom}
                  onChange={(e) =>
                    setYearFrom(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  className="h-8 w-20 text-center"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  placeholder="To"
                  value={yearTo}
                  onChange={(e) =>
                    setYearTo(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  className="h-8 w-20 text-center"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="w-40">
                  <p className="text-sm font-medium">Journal quality</p>
                  <p className="text-xs text-muted-foreground">
                    Scimago quartiles
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {quartileOptions.map((q) => {
                    const active = quartiles.includes(q);
                    return (
                      <button
                        key={q}
                        type="button"
                        onClick={() =>
                          setQuartiles((prev) =>
                            active
                              ? prev.filter((x) => x !== q)
                              : [...prev, q]
                          )
                        }
                        className={cn(
                          "cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-bold transition-all",
                          quartileChipClass(q, active)
                        )}
                      >
                        {q}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <p className="w-40 text-sm font-medium">Open access only</p>
                <Switch
                  checked={openAccessOnly}
                  onCheckedChange={setOpenAccessOnly}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <p className="w-40 text-sm font-medium">Minimum citations</p>
                <Input
                  placeholder="Any"
                  value={minCitations}
                  onChange={(e) =>
                    setMinCitations(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  className="h-8 w-24 text-center"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="w-40">
                  <p className="text-sm font-medium">Papers to research</p>
                  <p className="text-xs text-muted-foreground">5 to 60</p>
                </div>
                <Input
                  value={maxPapers}
                  onChange={(e) =>
                    setMaxPapers(e.target.value.replace(/\D/g, "").slice(0, 2))
                  }
                  className="h-8 w-20 text-center"
                />
              </div>
            </div>
          )}
        </div>

        {error && <Callout tone="error">{error}</Callout>}

        <div className="flex justify-end">
          <Button onClick={onStart} loading={starting} disabled={!topic.trim()}>
            <ArrowUp /> Start research
          </Button>
        </div>
      </Card>

      <div>
        <h2 className="mb-2.5 text-sm font-semibold text-muted-foreground">
          Your research runs
        </h2>
        {runs === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        ) : runs.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 p-8 text-center">
            <UserRound className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No research runs yet. Describe a topic above to start your first
              one.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {runs.map((run) => (
              <Link key={run.id} href={`/runs/${run.id}`}>
                <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-accent">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {run.title || run.topic}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(run.created_at).toLocaleString()}
                      {run.paper_count > 0 && ` · ${run.paper_count} papers`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {run.status === "running" ? (
                      <TextShimmer className="text-xs">
                        {run.stage ?? "running"}
                      </TextShimmer>
                    ) : (
                      <Badge variant={statusVariant[run.status]}>
                        {run.status}
                      </Badge>
                    )}
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
