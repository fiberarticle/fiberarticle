"use client";

import * as React from "react";
import Link from "next/link";
import {
  Download,
  FolderPlus,
  Import,
  Link2,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { EmptyShelfArt } from "@/components/art";
import { QuartileBadge } from "@/components/quartile-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError, apiUrl, getApiToken } from "@/lib/api";
import type { Collection, PaperDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Library() {
  const [papers, setPapers] = React.useState<PaperDetail[] | null>(null);
  const [collections, setCollections] = React.useState<Collection[]>([]);
  const [activeCollection, setActiveCollection] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [doiInput, setDoiInput] = React.useState("");
  const [showDoi, setShowDoi] = React.useState(false);
  const pdfInputRef = React.useRef<HTMLInputElement>(null);
  const bibInputRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    try {
      const params = activeCollection ? `?collection_id=${activeCollection}` : "";
      const [paperRows, collectionRows] = await Promise.all([
        apiFetch<PaperDetail[]>(`/v1/papers${params}`),
        apiFetch<Collection[]>("/v1/collections"),
      ]);
      setPapers(paperRows);
      setCollections(collectionRows);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "The Fiberarticle API is unreachable."
      );
    }
  }, [activeCollection]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function onUploadPdf(file: File) {
    setBusy("upload");
    setError(null);
    setNotice(null);
    try {
      const token = await getApiToken();
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(apiUrl("/v1/papers/upload"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.detail ?? "Upload failed.");
      }
      setNotice(`Uploaded and indexed "${file.name}".`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onImportBibtex(file: File) {
    setBusy("bibtex");
    setError(null);
    setNotice(null);
    try {
      const token = await getApiToken();
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(apiUrl("/v1/papers/import/bibtex"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await res.json().catch(() => []);
      if (!res.ok) {
        throw new ApiError(res.status, body.detail ?? "Import failed.");
      }
      setNotice(`Imported ${body.length} papers from BibTeX.`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onAddDoi() {
    const doi = doiInput.trim();
    if (!doi) return;
    setBusy("doi");
    setError(null);
    setNotice(null);
    try {
      const paper = await apiFetch<PaperDetail>("/v1/papers/doi", {
        method: "POST",
        body: JSON.stringify({ doi }),
      });
      setNotice(`Added "${paper.title}".`);
      setDoiInput("");
      setShowDoi(false);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add that DOI.");
    } finally {
      setBusy(null);
    }
  }

  async function onExport(format: "bibtex" | "ris") {
    setError(null);
    try {
      const token = await getApiToken();
      const params = activeCollection
        ? `&collection_id=${activeCollection}`
        : "";
      const res = await fetch(
        apiUrl(`/v1/papers/export?format=${format}${params}`),
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.detail ?? "Export failed.");
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = format === "bibtex" ? "fiberarticle-library.bib" : "fiberarticle-library.ris";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Export failed.");
    }
  }

  async function onNewCollection() {
    const name = window.prompt("Collection name");
    if (!name?.trim()) return;
    try {
      await apiFetch("/v1/collections", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create the collection.");
    }
  }

  async function onDeleteCollection(id: string) {
    if (!window.confirm("Delete this collection? Papers stay in your library.")) return;
    await apiFetch(`/v1/collections/${id}`, { method: "DELETE" });
    if (activeCollection === id) setActiveCollection(null);
    load();
  }

  const filtered =
    papers?.filter(
      (p) =>
        !query ||
        p.title.toLowerCase().includes(query.toLowerCase()) ||
        p.authors.some((a) => a.toLowerCase().includes(query.toLowerCase()))
    ) ?? null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your reference manager. Import, organize, summarize, cite.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUploadPdf(file);
              e.target.value = "";
            }}
          />
          <input
            ref={bibInputRef}
            type="file"
            accept=".bib,.bibtex,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportBibtex(file);
              e.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={busy === "upload"}
            onClick={() => pdfInputRef.current?.click()}
          >
            <Upload /> Upload PDF
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowDoi((v) => !v)}
          >
            <Link2 /> Add by DOI
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy === "bibtex"}
            onClick={() => bibInputRef.current?.click()}
          >
            <Import /> Import BibTeX
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onExport("bibtex")}>
                BibTeX (.bib)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport("ris")}>
                RIS (.ris)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {showDoi && (
        <Card className="flex items-center gap-2 p-3">
          <Input
            value={doiInput}
            onChange={(e) => setDoiInput(e.target.value)}
            placeholder="10.1038/s41586-023-06792-0"
            onKeyDown={(e) => e.key === "Enter" && onAddDoi()}
            className="max-w-md"
          />
          <Button size="sm" loading={busy === "doi"} onClick={onAddDoi}>
            Add
          </Button>
        </Card>
      )}

      {error && <Callout tone="error">{error}</Callout>}
      {notice && <Callout tone="success">{notice}</Callout>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setActiveCollection(null)}
          className={cn(
            "cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors",
            activeCollection === null
              ? "border-leaf bg-leaf-soft text-leaf"
              : "border-border text-muted-foreground hover:bg-accent"
          )}
        >
          All papers
        </button>
        {collections.map((c) => (
          <span key={c.id} className="group relative">
            <button
              onClick={() => setActiveCollection(c.id)}
              className={cn(
                "cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors",
                activeCollection === c.id
                  ? "border-leaf bg-leaf-soft text-leaf"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {c.name} · {c.paper_count}
            </button>
            <button
              aria-label={`Delete collection ${c.name}`}
              onClick={() => onDeleteCollection(c.id)}
              className="absolute -right-1 -top-1 hidden size-4 cursor-pointer items-center justify-center rounded-full bg-destructive text-destructive-foreground group-hover:flex"
            >
              <X className="size-2.5" />
            </button>
          </span>
        ))}
        <button
          onClick={onNewCollection}
          className="flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
        >
          <FolderPlus className="size-3" /> New collection
        </button>
      </div>

      {papers && papers.length > 0 && (
        <Input
          placeholder="Filter by title or author..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
      )}

      {filtered === null && !error ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      ) : filtered && filtered.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 border-dashed bg-transparent p-10 text-center shadow-none">
          <EmptyShelfArt className="w-36 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {query
              ? "No papers match your filter."
              : "Nothing here yet. Upload a PDF, add a DOI, import BibTeX, or add papers from Ask and research runs."}
          </p>
          <Link href="/ask">
            <Button variant="secondary" size="sm">
              <Plus /> Find papers with Ask
            </Button>
          </Link>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered?.map((paper) => (
            <Link key={paper.id} href={`/library/${paper.id}`}>
              <Card className="p-4 transition-colors hover:bg-accent">
                <p className="text-sm font-medium leading-snug">{paper.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {paper.authors.slice(0, 4).join(", ")}
                  {paper.authors.length > 4 ? " et al." : ""}
                  {paper.year ? ` (${paper.year})` : ""}
                  {paper.venue ? ` · ${paper.venue}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <QuartileBadge quartile={paper.quartile} />
                  <Badge>{paper.source}</Badge>
                  {paper.full_text_parsed ? (
                    <Badge variant="leaf">full text</Badge>
                  ) : (
                    <Badge variant="outline">abstract only</Badge>
                  )}
                  {paper.cited_by_count > 0 && (
                    <Badge variant="leaf">
                      {paper.cited_by_count.toLocaleString()} citations
                    </Badge>
                  )}
                  {paper.summary && <Badge variant="primary">summarized</Badge>}
                  {paper.notes && <Badge variant="outline">notes</Badge>}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
