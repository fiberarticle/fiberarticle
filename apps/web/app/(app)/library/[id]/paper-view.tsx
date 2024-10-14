"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  MessageSquareText,
  Scroll,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api";
import type { Collection, PaperDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

const citationStyles = ["apa", "mla", "chicago", "ieee", "vancouver", "harvard"];

export function PaperView({ paperId }: { paperId: string }) {
  const router = useRouter();
  const [paper, setPaper] = React.useState<PaperDetail | null>(null);
  const [collections, setCollections] = React.useState<Collection[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState("");
  const [notesDirty, setNotesDirty] = React.useState(false);
  const [savingNotes, setSavingNotes] = React.useState(false);
  const [summarizing, setSummarizing] = React.useState(false);
  const [copiedStyle, setCopiedStyle] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        apiFetch<PaperDetail>(`/v1/papers/${paperId}`),
        apiFetch<Collection[]>("/v1/collections"),
      ]);
      setPaper(p);
      setCollections(c);
      setNotes(p.notes ?? "");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this paper.");
    }
  }, [paperId]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function onSummarize() {
    setSummarizing(true);
    setError(null);
    try {
      const updated = await apiFetch<PaperDetail>(
        `/v1/papers/${paperId}/summarize`,
        { method: "POST" }
      );
      setPaper(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Summarization failed.");
    } finally {
      setSummarizing(false);
    }
  }

  async function onSaveNotes() {
    setSavingNotes(true);
    try {
      const updated = await apiFetch<PaperDetail>(`/v1/papers/${paperId}`, {
        method: "PUT",
        body: JSON.stringify({ notes }),
      });
      setPaper(updated);
      setNotesDirty(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save notes.");
    } finally {
      setSavingNotes(false);
    }
  }

  async function onToggleCollection(collectionId: string) {
    if (!paper) return;
    const next = paper.collection_ids.includes(collectionId)
      ? paper.collection_ids.filter((c) => c !== collectionId)
      : [...paper.collection_ids, collectionId];
    try {
      const updated = await apiFetch<PaperDetail>(`/v1/papers/${paperId}`, {
        method: "PUT",
        body: JSON.stringify({ collection_ids: next }),
      });
      setPaper(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update collections.");
    }
  }

  async function onCopyCitation(style: string) {
    try {
      const data = await apiFetch<{ citation: string }>(
        `/v1/papers/${paperId}/citation?style=${style}`
      );
      await navigator.clipboard.writeText(data.citation);
      setCopiedStyle(style);
      setTimeout(() => setCopiedStyle(null), 1500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not copy the citation.");
    }
  }

  async function onDelete() {
    if (!window.confirm("Remove this paper from your library?")) return;
    await apiFetch(`/v1/papers/${paperId}`, { method: "DELETE" });
    router.push("/library");
  }

  if (error && !paper) {
    return (
      <div className="mx-auto max-w-3xl">
        <Callout tone="error">{error}</Callout>
      </div>
    );
  }

  if (!paper) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-16">
      <div>
        <Link href="/library">
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
            <ArrowLeft /> Library
          </Button>
        </Link>
        <h1 className="mt-2 text-2xl font-semibold leading-snug tracking-tight">
          {paper.title}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {paper.authors.join(", ") || "Unknown authors"}
          {paper.year ? ` (${paper.year})` : ""}
          {paper.venue ? ` · ${paper.venue}` : ""}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Badge>{paper.source}</Badge>
          {paper.full_text_parsed ? (
            <Badge variant="leaf">full text indexed ({paper.chunk_count} chunks)</Badge>
          ) : (
            <Badge variant="outline">abstract only</Badge>
          )}
          {paper.cited_by_count > 0 && (
            <Badge variant="leaf">
              {paper.cited_by_count.toLocaleString()} citations
            </Badge>
          )}
          {paper.doi && <Badge variant="outline">doi:{paper.doi}</Badge>}
        </div>
      </div>

      {error && <Callout tone="error">{error}</Callout>}

      <div className="flex flex-wrap gap-2">
        <Link href={`/assistant?paper=${paper.id}`}>
          <Button size="sm">
            <MessageSquareText /> Chat with this paper
          </Button>
        </Link>
        <Button
          variant="secondary"
          size="sm"
          loading={summarizing}
          onClick={onSummarize}
        >
          <Scroll /> {paper.summary ? "Refresh summary" : "Summarize"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Copy /> Cite
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Copy citation as</DropdownMenuLabel>
            {citationStyles.map((style) => (
              <DropdownMenuItem key={style} onSelect={() => onCopyCitation(style)}>
                {copiedStyle === style ? <Check /> : null}
                {style.toUpperCase()}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {paper.url && (
          <a href={paper.url} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              <ExternalLink /> Open source page
            </Button>
          </a>
        )}
      </div>

      {collections.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Collections:</span>
          {collections.map((c) => {
            const active = paper.collection_ids.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => onToggleCollection(c.id)}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors",
                  active
                    ? "border-leaf bg-leaf-soft text-leaf"
                    : "border-border text-muted-foreground hover:bg-accent"
                )}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      {paper.summary && (
        <Card className="border-l-4 border-l-leaf">
          <CardHeader className="pb-2">
            <CardTitle>AI summary</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm leading-6">
            {paper.summary.tldr && (
              <p className="font-medium">{paper.summary.tldr}</p>
            )}
            {paper.summary.key_findings && paper.summary.key_findings.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Key findings
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  {paper.summary.key_findings.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            {paper.summary.methodology && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Methodology
                </p>
                <p>{paper.summary.methodology}</p>
              </div>
            )}
            {paper.summary.limitations && paper.summary.limitations.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Limitations
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  {paper.summary.limitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {paper.abstract && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Abstract</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-7">{paper.abstract}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between">
            Notes
            {notesDirty && (
              <Button size="sm" loading={savingNotes} onClick={onSaveNotes}>
                Save notes
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setNotesDirty(true);
            }}
            rows={5}
            placeholder="Your research notes on this paper..."
            className="w-full resize-y rounded-xl border border-transparent bg-transparent px-3 py-2 text-sm leading-6 outline-none transition-colors hover:border-border focus:border-ring"
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="text-destructive" onClick={onDelete}>
          <Trash2 /> Remove from library
        </Button>
      </div>
    </div>
  );
}
