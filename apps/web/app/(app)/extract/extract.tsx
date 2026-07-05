"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Download, Plus, Trash2, X } from "lucide-react";
import { ExtractArt } from "@/components/art";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiFetch, ApiError, apiUrl, getApiToken } from "@/lib/api";
import type { Extraction, ExtractionColumn, PaperDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

const defaultColumns: ExtractionColumn[] = [
  { name: "Method", description: "The main method or approach used in the paper" },
  { name: "Dataset", description: "Datasets or data sources used" },
  { name: "Key result", description: "The single most important quantitative or qualitative result" },
];

export function Extract() {
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get("id");
  const [extractions, setExtractions] = React.useState<Extraction[] | null>(null);
  const [papers, setPapers] = React.useState<PaperDetail[]>([]);
  const [active, setActive] = React.useState<Extraction | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [columns, setColumns] = React.useState<ExtractionColumn[]>(defaultColumns);

  const load = React.useCallback(async () => {
    try {
      const [rows, paperRows] = await Promise.all([
        apiFetch<Extraction[]>("/v1/extractions"),
        apiFetch<PaperDetail[]>("/v1/papers"),
      ]);
      setExtractions(rows);
      setPapers(paperRows);
      setActive((prev) =>
        prev ? rows.find((r) => r.id === prev.id) ?? null : prev
      );
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "The Fiberarticle API is unreachable."
      );
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // Deep link from the sidebar history: /extract?id=<id> opens that table.
  React.useEffect(() => {
    if (!deepLinkId || extractions === null) return;
    const match = extractions.find((e) => e.id === deepLinkId);
    if (match) setActive(match);
  }, [deepLinkId, extractions]);

  // Poll while any table is running so cells stream in.
  React.useEffect(() => {
    if (!extractions?.some((e) => e.status === "running")) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [extractions, load]);

  async function onCreate() {
    if (selected.size === 0) {
      setError("Pick at least one paper.");
      return;
    }
    if (columns.some((c) => !c.name.trim() || !c.description.trim())) {
      setError("Every column needs a name and a description.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await apiFetch<Extraction>("/v1/extractions", {
        method: "POST",
        body: JSON.stringify({
          // Blank name: the API generates an AI title in the background.
          name: name.trim(),
          paper_ids: [...selected],
          columns,
        }),
      });
      setWizardOpen(false);
      setName("");
      setSelected(new Set());
      setColumns(defaultColumns);
      await load();
      setActive(created);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start the extraction.");
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Delete this extraction table?")) return;
    await apiFetch(`/v1/extractions/${id}`, { method: "DELETE" });
    if (active?.id === id) setActive(null);
    load();
  }

  async function onExportCsv(id: string) {
    try {
      const token = await getApiToken();
      const res = await fetch(apiUrl(`/v1/extractions/${id}/export`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new ApiError(res.status, "Export failed.");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "extraction.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Export failed.");
    }
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-start gap-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Extract</h1>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Pull structured data from many papers into one table. Every cell
                carries a source quote for verification.
              </p>
            </div>
            <ExtractArt className="hidden w-32 shrink-0 md:block" />
          </div>
          <Button onClick={() => setWizardOpen((v) => !v)}>
            <Plus /> New extraction
          </Button>
        </div>

        {error && <Callout tone="error">{error}</Callout>}

        {wizardOpen && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>New extraction table</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Table name (optional)"
                className="max-w-sm"
              />

              <div>
                <p className="mb-2 text-sm font-medium">
                  Columns ({columns.length}/20)
                </p>
                <div className="flex flex-col gap-2">
                  {columns.map((col, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={col.name}
                        onChange={(e) =>
                          setColumns((prev) =>
                            prev.map((c, ci) =>
                              ci === i ? { ...c, name: e.target.value } : c
                            )
                          )
                        }
                        placeholder="Column name"
                        className="max-w-44"
                      />
                      <Input
                        value={col.description}
                        onChange={(e) =>
                          setColumns((prev) =>
                            prev.map((c, ci) =>
                              ci === i ? { ...c, description: e.target.value } : c
                            )
                          )
                        }
                        placeholder="What should be extracted?"
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove column"
                        disabled={columns.length <= 1}
                        onClick={() =>
                          setColumns((prev) => prev.filter((_, ci) => ci !== i))
                        }
                      >
                        <X />
                      </Button>
                    </div>
                  ))}
                </div>
                {columns.length < 20 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() =>
                      setColumns((prev) => [...prev, { name: "", description: "" }])
                    }
                  >
                    <Plus /> Add column
                  </Button>
                )}
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">
                  Papers ({selected.size} selected, max 50)
                </p>
                {papers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Your library is empty. Add papers first.
                  </p>
                ) : (
                  <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-xl border border-border p-2">
                    {papers.map((paper) => {
                      const checked = selected.has(paper.id);
                      return (
                        <label
                          key={paper.id}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                            checked ? "bg-leaf-soft" : "hover:bg-accent"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            className="accent-[var(--leaf)]"
                            onChange={() =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(paper.id)) {
                                  next.delete(paper.id);
                                } else if (next.size < 50) {
                                  next.add(paper.id);
                                }
                                return next;
                              })
                            }
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {paper.title}
                          </span>
                          {!paper.full_text_parsed && (
                            <Badge variant="outline">abstract only</Badge>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setWizardOpen(false)}>
                  Cancel
                </Button>
                <Button loading={creating} onClick={onCreate}>
                  Start extraction
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {extractions === null ? (
          <Skeleton className="h-24 w-full rounded-2xl" />
        ) : extractions.length === 0 && !wizardOpen ? (
          <Card className="flex flex-col items-center gap-2 border-dashed bg-transparent p-10 text-center shadow-none">
            <ExtractArt className="w-36" />
            <p className="text-sm text-muted-foreground">
              No extraction tables yet. Create one to compare papers side by side.
            </p>
          </Card>
        ) : (
          <div className="flex flex-wrap gap-2">
            {extractions.map((e) => (
              <button
                key={e.id}
                onClick={() => setActive(e)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition-colors",
                  active?.id === e.id
                    ? "border-leaf bg-leaf-soft text-leaf"
                    : "border-border text-muted-foreground hover:bg-accent"
                )}
              >
                {e.name}
                {e.status === "running" && (
                  <TextShimmer className="text-xs">running</TextShimmer>
                )}
                {e.status === "failed" && <Badge variant="destructive">failed</Badge>}
              </button>
            ))}
          </div>
        )}

        {active && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between">
                <span>
                  {active.name}{" "}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {active.rows.length} of {active.total_papers} papers
                  </span>
                </span>
                <span className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onExportCsv(active.id)}
                    disabled={active.rows.length === 0}
                  >
                    <Download /> CSV
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete extraction"
                    className="text-destructive"
                    onClick={() => onDelete(active.id)}
                  >
                    <Trash2 />
                  </Button>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {active.error && <Callout tone="error">{active.error}</Callout>}
              {active.status === "running" && active.rows.length === 0 && (
                <TextShimmer className="text-sm">
                  Reading papers and extracting fields
                </TextShimmer>
              )}
              {active.rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="py-2 pr-3 font-semibold">Paper</th>
                        {active.columns.map((c) => (
                          <th key={c.name} className="py-2 pr-3 font-semibold">
                            {c.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {active.rows.map((row) => (
                        <tr key={row.paper_id} className="border-b border-border align-top">
                          <td className="max-w-56 py-2 pr-3">
                            <p className="line-clamp-2 font-medium">{row.title}</p>
                            {row.year && (
                              <p className="text-xs text-muted-foreground">{row.year}</p>
                            )}
                          </td>
                          {active.columns.map((c) => {
                            const cell = row.cells[c.name];
                            return (
                              <td key={c.name} className="max-w-64 py-2 pr-3">
                                {cell?.quote ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="cursor-help underline decoration-dotted decoration-[var(--leaf)] underline-offset-4">
                                        {cell.value}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs">
                                      &quot;{cell.quote}&quot;
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <span
                                    className={cn(
                                      cell?.value === "Not reported" &&
                                        "text-muted-foreground"
                                    )}
                                  >
                                    {cell?.value ?? ""}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {active.status === "running" && (
                    <div className="py-3">
                      <TextShimmer className="text-xs">
                        Extracting the next paper
                      </TextShimmer>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </TooltipProvider>
  );
}
