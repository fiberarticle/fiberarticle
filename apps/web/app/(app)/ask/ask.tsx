"use client";

import { useState } from "react";
import { ArrowUp, BookOpen, Check, Plus } from "lucide-react";
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
import { apiFetch, ApiError } from "@/lib/api";
import type { PaperDetail, SearchResponse, SearchResultPaper } from "@/lib/types";

export function Ask() {
  const [query, setQuery] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [oaOnly, setOaOnly] = useState(false);
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
    try {
      const data = await apiFetch<SearchResponse>("/v1/search", {
        method: "POST",
        body: JSON.stringify({
          query: trimmed,
          year_from: yearFrom ? Number(yearFrom) : null,
          open_access_only: oaOnly,
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
              <input
                value={yearFrom}
                onChange={(e) => setYearFrom(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="From year"
                className="h-8 w-24 rounded-full border border-input bg-transparent px-3 text-xs outline-none focus:border-ring"
              />
              <PromptInputAction tooltip="Only papers with an open-access PDF">
                <Button
                  type="button"
                  variant={oaOnly ? "secondary" : "outline"}
                  size="sm"
                  className="rounded-full"
                  onClick={() => setOaOnly((v) => !v)}
                >
                  <BookOpen />
                  Open access only
                  {oaOnly && <Check />}
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
                          {paper.cited_by_count.toLocaleString()} citations
                        </Badge>
                      )}
                      {(paper.is_open_access || paper.oa_pdf_url) && (
                        <Badge variant="success">open access</Badge>
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
