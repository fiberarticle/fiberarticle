"use client";

import { useState } from "react";
import { ArrowUp, BookOpen, Check, FileText, Plus, Quote, SlidersHorizontal } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { apiFetch, ApiError } from "@/lib/api";
import type { PaperDetail, SearchResponse, SearchResultPaper } from "@/lib/types";
import { cn } from "@/lib/utils";

type YearMode = "all" | "recent" | "custom";

interface Filters {
  yearMode: YearMode;
  recentYears: number;
  yearFrom: string;
  yearTo: string;
  openAccessOnly: boolean;
  fullTextOnly: boolean;
  minCitations: string;
}

const defaultFilters: Filters = {
  yearMode: "all",
  recentYears: 5,
  yearFrom: "",
  yearTo: "",
  openAccessOnly: false,
  fullTextOnly: false,
  minCitations: "",
};

function activeFilterCount(f: Filters): number {
  let n = 0;
  if (f.yearMode !== "all") n += 1;
  if (f.openAccessOnly) n += 1;
  if (f.fullTextOnly) n += 1;
  if (f.minCitations.trim()) n += 1;
  return n;
}

function resolveYears(f: Filters): { year_from: number | null; year_to: number | null } {
  const now = new Date().getFullYear();
  if (f.yearMode === "recent") {
    return { year_from: now - f.recentYears + 1, year_to: null };
  }
  if (f.yearMode === "custom") {
    return {
      year_from: f.yearFrom ? Number(f.yearFrom) : null,
      year_to: f.yearTo ? Number(f.yearTo) : null,
    };
  }
  return { year_from: null, year_to: null };
}

function FilterRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function FiltersPopover({
  filters,
  onChange,
  onReset,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  onReset: () => void;
}) {
  const count = activeFilterCount(filters);
  const yearButtons: { value: YearMode; label: string }[] = [
    { value: "all", label: "All years" },
    { value: "recent", label: "Recent" },
    { value: "custom", label: "Range" },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={count > 0 ? "secondary" : "outline"}
          size="sm"
          className="rounded-full"
        >
          <SlidersHorizontal />
          Filters
          {count > 0 && (
            <span className="ml-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold">Refine results</p>
          {count > 0 && (
            <button
              type="button"
              onClick={onReset}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Reset
            </button>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-1.5 text-sm font-medium">Publication year</p>
            <div className="flex gap-1.5">
              {yearButtons.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  onClick={() => onChange({ ...filters, yearMode: b.value })}
                  className={cn(
                    "flex-1 cursor-pointer rounded-lg border px-2 py-1.5 text-xs transition-colors",
                    filters.yearMode === b.value
                      ? "border-ring bg-[color-mix(in_oklab,var(--primary)_10%,transparent)] font-medium text-primary"
                      : "border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>
            {filters.yearMode === "recent" && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Last</span>
                <Input
                  value={String(filters.recentYears)}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      recentYears: Math.max(
                        1,
                        Math.min(50, Number(e.target.value.replace(/\D/g, "")) || 1)
                      ),
                    })
                  }
                  className="h-8 w-16 text-center"
                />
                <span className="text-xs text-muted-foreground">years</span>
              </div>
            )}
            {filters.yearMode === "custom" && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  placeholder="From"
                  value={filters.yearFrom}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      yearFrom: e.target.value.replace(/\D/g, "").slice(0, 4),
                    })
                  }
                  className="h-8 w-20 text-center"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  placeholder="To"
                  value={filters.yearTo}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      yearTo: e.target.value.replace(/\D/g, "").slice(0, 4),
                    })
                  }
                  className="h-8 w-20 text-center"
                />
              </div>
            )}
          </div>

          <div className="h-px bg-border" />

          <FilterRow label="Open access" hint="Free-to-read papers only">
            <Switch
              checked={filters.openAccessOnly}
              onCheckedChange={(v) =>
                onChange({ ...filters, openAccessOnly: v })
              }
            />
          </FilterRow>

          <FilterRow label="Full text available" hint="Has a readable PDF">
            <Switch
              checked={filters.fullTextOnly}
              onCheckedChange={(v) => onChange({ ...filters, fullTextOnly: v })}
            />
          </FilterRow>

          <FilterRow label="Minimum citations">
            <Input
              placeholder="Any"
              value={filters.minCitations}
              onChange={(e) =>
                onChange({
                  ...filters,
                  minCitations: e.target.value.replace(/\D/g, "").slice(0, 6),
                })
              }
              className="h-8 w-24 text-center"
            />
          </FilterRow>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function Ask() {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [addingIndex, setAddingIndex] = useState<number | null>(null);

  async function onSearch() {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setError("Ask a fuller question so the search has something to work with.");
      return;
    }
    setError(null);
    setPending(true);
    setResponse(null);
    setAdded(new Set());
    const years = resolveYears(filters);
    try {
      const data = await apiFetch<SearchResponse>("/v1/search", {
        method: "POST",
        body: JSON.stringify({
          query: trimmed,
          year_from: years.year_from,
          year_to: years.year_to,
          open_access_only: filters.openAccessOnly,
          full_text_only: filters.fullTextOnly,
          min_citations: filters.minCitations ? Number(filters.minCitations) : null,
          answer: true,
        }),
      });
      setResponse(data);
      if (data.results.length === 0) {
        setError("No papers matched. Try rephrasing or loosening the filters.");
      }
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "The Fiberarticle API is unreachable."
      );
    } finally {
      setPending(false);
    }
  }

  async function onAdd(paper: SearchResultPaper, index: number) {
    setAddingIndex(index);
    setError(null);
    try {
      await apiFetch<PaperDetail>("/v1/papers", {
        method: "POST",
        body: JSON.stringify(paper),
      });
      setAdded((prev) => new Set(prev).add(index));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setAdded((prev) => new Set(prev).add(index));
      } else {
        setError(e instanceof ApiError ? e.message : "Could not add the paper.");
      }
    } finally {
      setAddingIndex(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ask</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask a research question. Fiberarticle searches arXiv, OpenAlex,
          Semantic Scholar, and Crossref, then answers from the best papers with
          citations.
        </p>
      </div>

      <PromptInput
        isLoading={pending}
        value={query}
        onValueChange={setQuery}
        onSubmit={onSearch}
        className="w-full pt-1"
      >
        <div className="flex flex-col">
          <PromptInputTextarea placeholder="Example: Does intermittent fasting outperform daily calorie restriction for fat loss?" />
          <PromptInputActions className="mt-3 w-full justify-between px-3 pb-3">
            <div className="flex items-center gap-2">
              <FiltersPopover
                filters={filters}
                onChange={setFilters}
                onReset={() => setFilters(defaultFilters)}
              />
              <PromptInputAction tooltip="Only papers with an open-access PDF">
                <Button
                  type="button"
                  variant={filters.openAccessOnly ? "secondary" : "outline"}
                  size="sm"
                  className="rounded-full"
                  onClick={() =>
                    setFilters((f) => ({ ...f, openAccessOnly: !f.openAccessOnly }))
                  }
                >
                  <BookOpen />
                  Open access
                  {filters.openAccessOnly && <Check />}
                </Button>
              </PromptInputAction>
            </div>
            <Button
              size="icon"
              className="rounded-full"
              disabled={!query.trim() || pending}
              onClick={onSearch}
              aria-label="Search"
            >
              <ArrowUp />
            </Button>
          </PromptInputActions>
        </div>
      </PromptInput>

      {error && <Callout tone="error">{error}</Callout>}
      {pending && (
        <TextShimmer className="text-sm">
          Breaking your question into scholarly queries and searching four indexes
        </TextShimmer>
      )}

      {response?.answer && (
        <Card className="border-l-4 border-l-leaf">
          <CardHeader className="pb-2">
            <CardTitle>Research-backed answer</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-[15px] leading-7">
              {response.answer}
            </p>
            {response.sub_queries.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Searched as: {response.sub_queries.map((q) => `"${q}"`).join(", ")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {response && response.results.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Papers ({response.results.length})
          </h2>
          {response.results.map((paper, i) => {
            const inLibrary =
              added.has(i) ||
              (paper.doi ? response.in_library_dois.includes(paper.doi) : false);
            return (
              <Card key={`${paper.title}-${i}`} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug">
                      <span className="mr-1.5 text-muted-foreground">[{i + 1}]</span>
                      {paper.url ? (
                        <a
                          href={paper.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                        >
                          {paper.title}
                        </a>
                      ) : (
                        paper.title
                      )}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {paper.authors.slice(0, 4).join(", ")}
                      {paper.authors.length > 4 ? " et al." : ""}
                      {paper.year ? ` (${paper.year})` : ""}
                      {paper.venue ? ` · ${paper.venue}` : ""}
                    </p>
                    {paper.abstract && (
                      <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                        {paper.abstract}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge>{paper.source}</Badge>
                      {paper.cited_by_count > 0 && (
                        <Badge variant="leaf">
                          <Quote className="size-3" />
                          {paper.cited_by_count.toLocaleString()} citations
                        </Badge>
                      )}
                      {(paper.is_open_access || paper.oa_pdf_url) && (
                        <Badge variant="success">open access</Badge>
                      )}
                      {paper.oa_pdf_url && (
                        <Badge variant="outline">
                          <FileText className="size-3" />
                          full text
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    variant={inLibrary ? "outline" : "secondary"}
                    size="sm"
                    className="shrink-0 rounded-full"
                    disabled={inLibrary || addingIndex === i}
                    loading={addingIndex === i}
                    onClick={() => onAdd(paper, i)}
                  >
                    {inLibrary ? (
                      <>
                        <Check /> In library
                      </>
                    ) : (
                      <>
                        <Plus /> Add
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
