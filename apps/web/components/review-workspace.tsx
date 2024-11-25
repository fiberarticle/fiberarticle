"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenCheck,
  ChevronDown,
  Compass,
  Database,
  Download,
  FlaskConical,
  Lightbulb,
  Search,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  X,
} from "lucide-react";
import { QuartileBadge } from "@/components/quartile-badge";
import { ReportView } from "@/components/report-view";
import {
  Source,
  SourceContent,
  SourceTrigger,
} from "@/components/prompt-kit/source";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiUrl, getApiToken } from "@/lib/api";
import type {
  Review,
  ReviewDirection,
  ReviewFacet,
  ReviewMatrixRow,
  RunDetail,
} from "@/lib/types";
import { cn } from "@/lib/utils";

// The API normalizes every "the paper does not say" phrasing to one value,
// but rows written before that landed can still carry the variants.
const EMPTY_VALUES = new Set([
  "",
  "-",
  "na",
  "n/a",
  "none",
  "null",
  "unknown",
  "not reported",
  "not specified",
  "not stated",
  "not mentioned",
  "not applicable",
  "not available",
  "not discussed",
  "not provided",
]);

/** Implementation group, in the order the agent extracts it. */
const IMPLEMENTATION: { key: keyof ReviewMatrixRow; label: string }[] = [
  { key: "contribution", label: "Proposes" },
  { key: "methodology", label: "Methodology" },
  { key: "models", label: "Models and algorithms" },
  { key: "dataset", label: "Dataset" },
  { key: "tools", label: "Tools" },
  { key: "metrics", label: "Evaluation metrics" },
  { key: "results", label: "Key results" },
];

/** Limitations and research gaps group. */
const LIMITATIONS: { key: keyof ReviewMatrixRow; label: string }[] = [
  { key: "limitations", label: "Stated limitations" },
  { key: "unresolved", label: "Unresolved issues" },
  { key: "assumptions", label: "Assumptions" },
  { key: "missing_evaluations", label: "Missing evaluations" },
  { key: "opportunities", label: "Research opportunities" },
];

/**
 * Column headers, each in its own accent from the Fiberarticle palette and
 * matching the Overview panel it corresponds to, so the three groups stay
 * distinguishable at a glance. Muted into the foreground so they read as
 * labels rather than as highlights.
 */
const COLUMNS: { label: string; accent: string; width: string }[] = [
  { label: "#", accent: "var(--muted-foreground)", width: "3.5rem" },
  { label: "Paper details", accent: "#4f90e4", width: "26%" },
  { label: "Implementation", accent: "#50c158", width: "37%" },
  { label: "Limitations and research gaps", accent: "#ff7db1", width: "auto" },
];

const headerTint = (accent: string) =>
  `color-mix(in oklab, ${accent} 9%, var(--background))`;

/** Shared column sizing, so the header table and the body table agree. */
function MatrixCols() {
  return (
    <colgroup>
      {COLUMNS.map((column) => (
        <col key={column.label} style={{ width: column.width }} />
      ))}
    </colgroup>
  );
}

type SortKey = "order" | "year_desc" | "year_asc" | "citations";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "order", label: "Reference order" },
  { key: "year_desc", label: "Newest first" },
  { key: "year_asc", label: "Oldest first" },
  { key: "citations", label: "Most cited" },
];

/** Why a column is empty, stated in terms of what the agent could read. */
function emptyLabel(
  row: ReviewMatrixRow,
  group: "implementation" | "limitations"
): string {
  // Older rows predate the evidence field; fall back to the full-text flag.
  const evidence =
    row.evidence || (row.full_text ? "full_text" : "abstract");
  if (evidence === "none") {
    return "No abstract or full text was available from any index, so this paper could not be read.";
  }
  if (evidence === "abstract") {
    return group === "implementation"
      ? "Only the abstract was available, so no implementation details could be read."
      : "Only the abstract was available; limitations are usually stated in the full text.";
  }
  return group === "implementation"
    ? "The paper states no implementation details this agent could recover."
    : "The authors state no limitations or open problems in this paper.";
}

function reported(value: string | null | undefined): boolean {
  if (!value) return false;
  return !EMPTY_VALUES.has(value.trim().replace(/[.!;:\s]+$/, "").toLowerCase());
}

/** A labeled block inside an evidence-matrix cell. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-xs leading-5">
      <span className="font-semibold text-foreground">{label}:</span>{" "}
      <span className="text-muted-foreground">{value}</span>
    </p>
  );
}

function CellGroup({
  row,
  fields,
  emptyLabel,
}: {
  row: ReviewMatrixRow;
  fields: { key: keyof ReviewMatrixRow; label: string }[];
  emptyLabel: string;
}) {
  const shown = fields.filter((f) => reported(row[f.key] as string));
  if (shown.length === 0) {
    return (
      <p className="text-xs italic leading-5 text-muted-foreground/70">
        {emptyLabel}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((f) => (
        <Field key={f.key} label={f.label} value={row[f.key] as string} />
      ))}
    </div>
  );
}

// Fades the text itself rather than laying a tinted block over it. An
// overlay rectangle draws its own hard edges against the row and reads as a
// box; a mask just lets the last lines dissolve, in either theme.
const FADE_MASK = "linear-gradient(to bottom, #000 58%, transparent 100%)";

/**
 * A matrix cell that clamps until its row is expanded.
 *
 * The fade only appears when the content really is taller than the clamp;
 * without the measurement a one-line cell would fade out for no reason.
 */
function ClampedCell({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setOverflowing(el.scrollHeight > el.clientHeight + 4);
  }, [open]);

  const faded = !open && overflowing;
  return (
    <div
      ref={ref}
      className={cn(!open && "max-h-40 overflow-hidden")}
      style={
        faded
          ? { maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }
          : undefined
      }
    >
      {children}
    </div>
  );
}

/** Chips for the papers a methodology or dataset was drawn from. */
function RefChips({ papers }: { papers: number[] }) {
  if (papers.length === 0) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {papers.map((n) => (
        <span
          key={n}
          className="rounded-md bg-[color-mix(in_oklab,var(--primary)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-primary"
        >
          {n}
        </span>
      ))}
    </span>
  );
}

function Panel({
  icon: Icon,
  accent,
  title,
  subtitle,
  children,
}: {
  icon: React.ElementType;
  accent: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-[13px]">
          <Icon className="size-4" style={{ color: accent }} />
          {title}
        </CardTitle>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm leading-6">
          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function FacetList({ items }: { items: ReviewFacet[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item, i) => (
        <li key={i} className="text-sm leading-6">
          <span className="font-semibold">{item.name}</span>
          <RefChips papers={item.papers} />
          {item.note && (
            <p className="mt-0.5 text-[13px] leading-6 text-muted-foreground">
              {item.note}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function NumberedList({ items, accent }: { items: string[]; accent: string }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-sm leading-6">
          <span
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
            style={{
              color: accent,
              background: `color-mix(in oklab, ${accent} 16%, transparent)`,
            }}
          >
            {i + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

function DirectionList({ items }: { items: ReviewDirection[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_oklab,#4f90e4_16%,transparent)] text-[11px] font-bold text-[#4f90e4]">
            {i + 1}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-6">{item.title}</p>
            {item.rationale && (
              <p className="mt-0.5 text-[13px] leading-6 text-muted-foreground">
                {item.rationale}
              </p>
            )}
            {item.addresses && (
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Closes gap:</span>{" "}
                {item.addresses}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0 flex-1 px-4 py-3">
      <p className="text-xl font-semibold tracking-tight">{value}</p>
      <p className="truncate text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function ReviewWorkspace({
  run,
  review,
}: {
  run: RunDetail;
  review: Review;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("order");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const matrix = review.matrix;
  const synthesis = review.synthesis;

  const stats = useMemo(() => {
    const years = matrix
      .map((r) => r.year)
      .filter((y): y is number => typeof y === "number" && y > 0);
    const databases = new Map<string, number>();
    for (const row of matrix) {
      for (const name of row.indexed_in) {
        databases.set(name, (databases.get(name) ?? 0) + 1);
      }
    }
    return {
      papers: matrix.length,
      fullText: matrix.filter((r) => r.full_text).length,
      unreadable: matrix.filter((r) => r.evidence === "none").length,
      span:
        years.length > 0
          ? `${Math.min(...years)}-${Math.max(...years)}`
          : "n.d.",
      ranked: matrix.filter((r) => r.quartile === "Q1" || r.quartile === "Q2")
        .length,
      databases: [...databases.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [matrix]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? matrix.filter((row) =>
          [
            row.title,
            row.authors.join(" "),
            row.venue ?? "",
            String(row.year ?? ""),
            row.indexed_in.join(" "),
            ...IMPLEMENTATION.map((f) => row[f.key] as string),
            ...LIMITATIONS.map((f) => row[f.key] as string),
          ]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        )
      : matrix;
    const sorted = [...filtered];
    if (sort === "year_desc") sorted.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    if (sort === "year_asc")
      sorted.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
    if (sort === "citations")
      sorted.sort((a, b) => b.cited_by_count - a.cited_by_count);
    return sorted;
  }, [matrix, query, sort]);

  function toggleRow(n: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  async function onDownloadCsv() {
    setDownloading(true);
    try {
      const token = await getApiToken();
      const res = await fetch(apiUrl(`/v1/runs/${run.id}/review.csv`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(run.title || run.topic)
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .toLowerCase()
        .slice(0, 60)}-matrix.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // A failed download is visible to the user as nothing happening; the
      // matrix on screen is the real deliverable either way.
    } finally {
      setDownloading(false);
    }
  }

  const hasSynthesis =
    synthesis.trends.length > 0 ||
    synthesis.methodologies.length > 0 ||
    synthesis.datasets.length > 0 ||
    synthesis.gaps.length > 0 ||
    synthesis.future_work.length > 0;

  return (
    <Tabs defaultValue="overview" className="min-w-0">
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="matrix">
          Evidence matrix
          <span className="ml-1.5 text-xs text-muted-foreground">
            {matrix.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="review">Full review</TabsTrigger>
        <TabsTrigger value="sources">
          Sources
          <span className="ml-1.5 text-xs text-muted-foreground">
            {run.papers.length}
          </span>
        </TabsTrigger>
      </TabsList>

      {/* ------------------------------------------------------ overview */}
      <TabsContent value="overview" className="flex flex-col gap-4">
        <Card className="flex flex-wrap divide-x divide-border">
          <Stat value={String(stats.papers)} label="Papers reviewed" />
          <Stat
            value={`${stats.fullText}/${stats.papers}`}
            label="Read in full text"
          />
          <Stat value={stats.span} label="Publication years" />
          <Stat value={String(stats.ranked)} label="Q1 or Q2 journals" />
        </Card>

        {stats.unreadable > 0 && (
          <p className="-mt-1 text-xs text-muted-foreground">
            {stats.unreadable} of these papers are paywalled with no abstract
            released to any index, so their rows in the matrix are empty. A
            narrower topic, or the open access filter, gives a fuller review.
          </p>
        )}

        {stats.databases.length > 0 && (
          <Card className="p-4">
            <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
              <Database className="size-4" style={{ color: "#9a6b45" }} />
              Indexed databases covered
            </p>
            <div className="flex flex-wrap gap-1.5">
              {stats.databases.map(([name, count]) => (
                <Badge key={name} variant="default">
                  {name}
                  <span className="text-muted-foreground">{count}</span>
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Derived from each record: a Scimago rank proves Scopus coverage, a
              PubMed id proves PubMed, and the DOI prefix identifies the
              publisher platform. Coverage that cannot be proven is never
              claimed.
            </p>
          </Card>
        )}

        {!hasSynthesis && (
          <Card className="p-5">
            <p className="text-sm text-muted-foreground">
              The cross-paper synthesis produced no structured output for this
              run. The evidence matrix and the written review are still
              complete.
            </p>
          </Card>
        )}

        {synthesis.trends.length > 0 && (
          <Panel
            icon={TrendingUp}
            accent="#fca91e"
            title="Research trends"
            subtitle="How this field has moved across the reviewed years"
          >
            <BulletList items={synthesis.trends} />
          </Panel>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {synthesis.methodologies.length > 0 && (
            <Panel
              icon={FlaskConical}
              accent="#50c158"
              title="Common methodologies"
              subtitle="Approaches that recur across the literature"
            >
              <FacetList items={synthesis.methodologies} />
            </Panel>
          )}
          {synthesis.datasets.length > 0 && (
            <Panel
              icon={Database}
              accent="#4f90e4"
              title="Datasets and benchmarks"
              subtitle="What the field evaluates on"
            >
              <FacetList items={synthesis.datasets} />
            </Panel>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {synthesis.strengths.length > 0 && (
            <Panel
              icon={ThumbsUp}
              accent="#50c158"
              title="Strengths across the literature"
            >
              <BulletList items={synthesis.strengths} />
            </Panel>
          )}
          {synthesis.weaknesses.length > 0 && (
            <Panel
              icon={ThumbsDown}
              accent="#d13415"
              title="Weaknesses and recurring limitations"
            >
              <BulletList items={synthesis.weaknesses} />
            </Panel>
          )}
        </div>

        {synthesis.gaps.length > 0 && (
          <Panel
            icon={ShieldAlert}
            accent="#ff7db1"
            title="Research gaps"
            subtitle="What this body of work still leaves open"
          >
            <NumberedList items={synthesis.gaps} accent="#ff7db1" />
          </Panel>
        )}

        {synthesis.future_work.length > 0 && (
          <Panel
            icon={Compass}
            accent="#4f90e4"
            title="Suggested future work"
            subtitle="Novel directions that follow from the gaps above"
          >
            <DirectionList items={synthesis.future_work} />
          </Panel>
        )}

        {synthesis.themes.length > 0 && (
          <Card className="p-4">
            <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
              <Lightbulb className="size-4" style={{ color: "#fca91e" }} />
              Themes used to organize the written review
            </p>
            <div className="flex flex-wrap gap-1.5">
              {synthesis.themes.map((theme) => (
                <Badge key={theme} variant="leaf">
                  {theme}
                </Badge>
              ))}
            </div>
          </Card>
        )}
      </TabsContent>

      {/* -------------------------------------------------------- matrix */}
      <TabsContent value="matrix" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search titles, methods, datasets, limitations"
              className="pl-9 pr-9"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-muted p-1">
            {SORTS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setSort(option.key)}
                className={cn(
                  "cursor-pointer whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                  sort === option.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const next = !allExpanded;
              setAllExpanded(next);
              setExpanded(next ? new Set(matrix.map((r) => r.n)) : new Set());
            }}
          >
            <ChevronDown className={cn(allExpanded && "rotate-180")} />
            {allExpanded ? "Collapse all" : "Expand all"}
          </Button>
          <Button variant="secondary" size="sm" onClick={onDownloadCsv} loading={downloading}>
            <Download /> CSV
          </Button>
        </div>

        {rows.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No reviewed paper matches “{query}”.
            </p>
          </Card>
        ) : (
          /* Header and body are separate tables so the vertical scrollbar
             belongs to the body alone. A single header row inside the
             scroller would sit beside the scrollbar and stop short of the
             right edge, because overflow clips to the padding box and the
             gutter is outside it.

             They share one horizontal scroller, so horizontal scrolling
             moves both with no JS synchronization, and both reserve a
             scrollbar gutter the browser measures itself, so the columns
             line up on any platform and scrollbar style without a single
             hardcoded width. */
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="overflow-x-auto">
              <div className="min-w-[64rem]">
                {/* The reserved gutter is painted in the last column's tint,
                    so the header still reads as one full-width band. */}
                <div
                  className="fa-matrix-head overflow-y-scroll"
                  style={{
                    background: headerTint(COLUMNS[COLUMNS.length - 1].accent),
                  }}
                >
                  <table className="w-full table-fixed border-collapse text-left">
                    <MatrixCols />
                    <thead>
                      <tr>
                        {COLUMNS.map((column) => (
                          <th
                            key={column.label}
                            className="px-3 py-3 text-center align-middle text-xs font-semibold tracking-wide shadow-[inset_0_-1px_0_var(--border)]"
                            style={{
                              // Blended toward the foreground so the accent
                              // reads as a quiet label, never a highlight.
                              color: `color-mix(in oklab, ${column.accent} 72%, var(--foreground))`,
                              background: headerTint(column.accent),
                            }}
                          >
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  </table>
                </div>

                {/* The only vertically scrolling element: its scrollbar
                    starts immediately below the header. Always-on rather
                    than auto, so a short table cannot shift the columns by
                    dropping the gutter. */}
                <div className="max-h-[64vh] overflow-y-scroll">
                  <table className="w-full table-fixed border-collapse text-left">
                    <MatrixCols />
                    <tbody>
                {rows.map((row) => {
                  const open = expanded.has(row.n);
                  return (
                    <tr
                      key={row.n}
                      className="border-t border-border align-top transition-colors hover:bg-accent/40"
                    >
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => toggleRow(row.n)}
                          aria-label={
                            open ? "Collapse this paper" : "Expand this paper"
                          }
                          aria-expanded={open}
                          className="flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          {row.n}
                          <ChevronDown
                            className={cn(
                              "size-3 transition-transform",
                              open && "rotate-180"
                            )}
                          />
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1.5">
                          {row.url ? (
                            <a
                              href={row.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[13px] font-semibold leading-5 hover:text-primary hover:underline"
                            >
                              {row.title}
                            </a>
                          ) : (
                            <p className="text-[13px] font-semibold leading-5">
                              {row.title}
                            </p>
                          )}
                          {row.authors.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {row.authors.slice(0, 3).join(", ")}
                              {row.authors.length > 3 && " et al."}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {[row.venue, row.year].filter(Boolean).join(", ") ||
                              "Venue not reported"}
                          </p>
                          <div className="flex flex-wrap items-center gap-1">
                            <QuartileBadge quartile={row.quartile} />
                            {row.indexed_in.map((name) => (
                              <span
                                key={name}
                                className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                          {/* arXiv reports no citation count at all, so a
                              literal "0 citations" would be a false claim. */}
                          <p className="text-[11px] text-muted-foreground">
                            {row.cited_by_count > 0 &&
                              `${row.cited_by_count} citation${
                                row.cited_by_count === 1 ? "" : "s"
                              } · `}
                            {row.full_text ? "full text read" : "abstract only"}
                          </p>
                          {row.doi && (
                            <a
                              href={`https://doi.org/${row.doi}`}
                              target="_blank"
                              rel="noreferrer"
                              className="break-all text-[11px] text-[#4f90e4] hover:underline"
                            >
                              doi:{row.doi}
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <ClampedCell open={open}>
                          <CellGroup
                            row={row}
                            fields={IMPLEMENTATION}
                            emptyLabel={emptyLabel(row, "implementation")}
                          />
                        </ClampedCell>
                      </td>
                      <td className="px-3 py-3">
                        <ClampedCell open={open}>
                          <CellGroup
                            row={row}
                            fields={LIMITATIONS}
                            emptyLabel={emptyLabel(row, "limitations")}
                          />
                        </ClampedCell>
                      </td>
                    </tr>
                  );
                })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Every cell is read from the paper itself. Fields the paper does not
          state are left out rather than guessed.
        </p>
      </TabsContent>

      {/* --------------------------------------------------- full review */}
      <TabsContent value="review">
        {run.report ? (
          <Card className="p-6">
            <ReportView markdown={run.report} papers={run.papers} />
          </Card>
        ) : (
          <Card className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              This review has no written report.
            </p>
          </Card>
        )}
      </TabsContent>

      {/* ------------------------------------------------------- sources */}
      <TabsContent value="sources">
        <Card className="p-5">
          <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
            <BookOpenCheck className="size-4" style={{ color: "#50c158" }} />
            {run.papers.length} papers reviewed
          </p>
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
        </Card>
      </TabsContent>
    </Tabs>
  );
}
