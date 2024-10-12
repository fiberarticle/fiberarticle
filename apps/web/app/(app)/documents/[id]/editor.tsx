"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Download,
  Loader2,
  Scroll,
  Trash2,
} from "lucide-react";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import {
  Source,
  SourceContent,
  SourceTrigger,
} from "@/components/prompt-kit/source";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError, apiUrl, getApiToken } from "@/lib/api";
import type { DocumentDetail, DocumentTemplate } from "@/lib/types";
import { cn } from "@/lib/utils";

const templates: { value: DocumentTemplate; label: string }[] = [
  { value: "generic", label: "Generic manuscript" },
  { value: "ieee", label: "IEEE" },
  { value: "apa", label: "APA 7" },
];

const aiCommands = [
  { value: "rewrite", label: "Rewrite for clarity" },
  { value: "expand", label: "Expand" },
  { value: "condense", label: "Condense" },
  { value: "academic_tone", label: "More academic tone" },
] as const;

function SectionTextarea({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight + 2}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-none rounded-xl border border-transparent bg-transparent px-3 py-2 text-[15px] leading-7 outline-none transition-colors hover:border-border focus:border-ring disabled:opacity-60"
    />
  );
}

export function DocumentEditor({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [doc, setDoc] = React.useState<DocumentDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [aiBusy, setAiBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const data = await apiFetch<DocumentDetail>(`/v1/documents/${documentId}`);
      setDoc((prev) => {
        // Never clobber local unsaved edits with poll results.
        if (prev && dirty) return prev;
        return data;
      });
      return data;
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not load this document."
      );
      return null;
    }
  }, [documentId, dirty]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Poll while generating so sections stream in as they are written.
  React.useEffect(() => {
    if (doc?.status !== "generating") return;
    const interval = setInterval(load, 2500);
    return () => clearInterval(interval);
  }, [doc?.status, load]);

  function mutate(updater: (d: DocumentDetail) => DocumentDetail) {
    setDoc((prev) => (prev ? updater(prev) : prev));
    setDirty(true);
    setSaved(false);
  }

  async function onSave() {
    if (!doc) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<DocumentDetail>(
        `/v1/documents/${doc.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            title: doc.title,
            template: doc.template,
            sections: doc.sections,
            authors: doc.authors,
          }),
        }
      );
      setDoc(updated);
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function onExport() {
    if (!doc) return;
    if (dirty) await onSave();
    setExporting(true);
    setError(null);
    try {
      const token = await getApiToken();
      const res = await fetch(apiUrl(`/v1/documents/${doc.id}/export`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new ApiError(res.status, "Export failed. Is the document ready?");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+?)"/);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = match?.[1] ?? "article.docx";
      a.click();
      URL.revokeObjectURL(a.href);
      setNotice("Exported .docx downloaded.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function onAi(sectionId: string, command: (typeof aiCommands)[number]["value"]) {
    if (!doc) return;
    if (dirty) await onSave();
    setAiBusy(sectionId);
    setError(null);
    try {
      const result = await apiFetch<{ section_id: string; content: string }>(
        `/v1/documents/${doc.id}/edit`,
        {
          method: "POST",
          body: JSON.stringify({ section_id: sectionId, command }),
        }
      );
      setDoc((prev) =>
        prev
          ? {
              ...prev,
              sections: prev.sections.map((s) =>
                s.id === result.section_id ? { ...s, content: result.content } : s
              ),
            }
          : prev
      );
      setDirty(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The AI edit failed.");
    } finally {
      setAiBusy(null);
    }
  }

  async function onDelete() {
    if (!doc) return;
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    await apiFetch(`/v1/documents/${doc.id}`, { method: "DELETE" });
    router.push("/documents");
  }

  if (error && !doc) {
    return (
      <div className="mx-auto max-w-3xl">
        <Callout tone="error">{error}</Callout>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const generating = doc.status === "generating";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-24">
      <div className="flex items-center justify-between gap-3">
        <Link href="/documents">
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
            <ArrowLeft /> Documents
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          {generating ? (
            <TextShimmer className="text-xs">
              Writing your article section by section
            </TextShimmer>
          ) : (
            <>
              {saved && !dirty && (
                <span className="flex items-center gap-1 text-xs text-success">
                  <Check className="size-3.5" /> Saved
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={onSave}
                loading={saving}
                disabled={!dirty}
              >
                Save
              </Button>
              <Button size="sm" onClick={onExport} loading={exporting}>
                <Download /> Export .docx
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <Callout tone="error">{error}</Callout>}
      {notice && <Callout tone="success">{notice}</Callout>}
      {doc.status === "failed" && (
        <Callout tone="error">
          Generation failed: {doc.error ?? "unknown error"}
        </Callout>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-5">
          <input
            value={doc.title}
            disabled={generating}
            onChange={(e) => mutate((d) => ({ ...d, title: e.target.value }))}
            className="w-full border-none bg-transparent text-2xl font-semibold tracking-tight outline-none disabled:opacity-70"
            placeholder="Article title"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={doc.authors.join(", ")}
              disabled={generating}
              onChange={(e) =>
                mutate((d) => ({
                  ...d,
                  authors: e.target.value
                    .split(",")
                    .map((a) => a.trim())
                    .filter(Boolean),
                }))
              }
              placeholder="Authors (comma separated)"
              className="max-w-xs"
            />
            <select
              value={doc.template}
              disabled={generating}
              onChange={(e) =>
                mutate((d) => ({
                  ...d,
                  template: e.target.value as DocumentTemplate,
                }))
              }
              className="h-9 cursor-pointer rounded-xl border border-input bg-transparent px-3 text-sm focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1"
            >
              {templates.map((t) => (
                <option
                  key={t.value}
                  value={t.value}
                  className="bg-popover text-popover-foreground"
                >
                  {t.label}
                </option>
              ))}
            </select>
            <Badge>{doc.references.length} references</Badge>
          </div>
        </CardContent>
      </Card>

      {doc.sections.map((section, index) => (
        <Card key={section.id} className={cn(aiBusy === section.id && "opacity-80")}>
          <CardContent className="flex flex-col gap-2 pt-5">
            <div className="flex items-center justify-between gap-2">
              <input
                value={section.heading}
                disabled={generating}
                onChange={(e) =>
                  mutate((d) => ({
                    ...d,
                    sections: d.sections.map((s) =>
                      s.id === section.id ? { ...s, heading: e.target.value } : s
                    ),
                  }))
                }
                className="w-full border-none bg-transparent text-lg font-semibold tracking-tight outline-none disabled:opacity-70"
              />
              {!generating && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      disabled={aiBusy !== null}
                    >
                      {aiBusy === section.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Scroll />
                      )}
                      AI
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Revise this section</DropdownMenuLabel>
                    {aiCommands.map((cmd) => (
                      <DropdownMenuItem
                        key={cmd.value}
                        onSelect={() => onAi(section.id, cmd.value)}
                      >
                        {cmd.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <SectionTextarea
              value={section.content}
              disabled={generating || aiBusy === section.id}
              onChange={(value) =>
                mutate((d) => ({
                  ...d,
                  sections: d.sections.map((s) =>
                    s.id === section.id ? { ...s, content: value } : s
                  ),
                }))
              }
            />
            <span className="text-right text-xs text-muted-foreground">
              Section {index + 1} of {doc.sections.length}
            </span>
          </CardContent>
        </Card>
      ))}

      {generating && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
            <TextShimmer className="text-sm">
              Writing the next section
            </TextShimmer>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      )}

      {doc.references.length > 0 && (
        <div>
          <h2 className="mb-2.5 text-sm font-semibold text-muted-foreground">
            References ({doc.references.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {doc.references.map((paper, i) => (
              <Source key={paper.id} href={paper.url ?? undefined}>
                <SourceTrigger label={`[${i + 1}] ${paper.title}`} />
                <SourceContent
                  title={paper.title}
                  description={[
                    paper.authors.slice(0, 4).join(", ") +
                      (paper.authors.length > 4 ? " et al." : ""),
                    paper.year ? `(${paper.year})` : null,
                    paper.venue,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              </Source>
            ))}
          </div>
        </div>
      )}

      {!generating && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="text-destructive" onClick={onDelete}>
            <Trash2 /> Delete document
          </Button>
        </div>
      )}
    </div>
  );
}
