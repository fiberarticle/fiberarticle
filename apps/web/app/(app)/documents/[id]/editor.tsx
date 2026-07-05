"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  FileCode2,
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
  { value: "ieee", label: "IEEE (IEEEtran)" },
  { value: "apa", label: "APA 7" },
  { value: "acm", label: "ACM (acmart)" },
  { value: "elsevier", label: "Elsevier (elsarticle)" },
  { value: "springer", label: "Springer Nature (sn-jnl)" },
  { value: "neurips", label: "NeurIPS" },
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
  // Sections are an accordion: collapsed previews instead of one endless
  // scroll. The first section opens on load; new sections open as they
  // stream in during generation.
  const [openSections, setOpenSections] = React.useState<Set<string>>(
    new Set()
  );
  const openedInitially = React.useRef(false);

  function toggleSection(id: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function jumpToSection(id: string) {
    setOpenSections((prev) => new Set(prev).add(id));
    requestAnimationFrame(() => {
      document
        .getElementById(`sec-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

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

  // Open the first section once loaded; while generating, open each new
  // section as it appears so the user watches it being written.
  React.useEffect(() => {
    if (!doc || doc.sections.length === 0) return;
    if (!openedInitially.current) {
      openedInitially.current = true;
      setOpenSections(new Set([doc.sections[0].id]));
      return;
    }
    if (doc.status === "generating") {
      const last = doc.sections[doc.sections.length - 1];
      setOpenSections((prev) =>
        prev.has(last.id) ? prev : new Set(prev).add(last.id)
      );
    }
  }, [doc]);

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

  const [exportingLatex, setExportingLatex] = React.useState(false);

  async function downloadExport(
    path: string,
    fallbackName: string,
    doneNotice: string,
    setBusy: (v: boolean) => void
  ) {
    if (!doc) return;
    if (dirty) await onSave();
    setBusy(true);
    setError(null);
    try {
      const token = await getApiToken();
      const res = await fetch(apiUrl(path), {
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
      a.download = match?.[1] ?? fallbackName;
      a.click();
      URL.revokeObjectURL(a.href);
      setNotice(doneNotice);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  function onExport() {
    if (!doc) return;
    return downloadExport(
      `/v1/documents/${doc.id}/export`,
      "article.docx",
      "Exported .docx downloaded.",
      setExporting
    );
  }

  function onExportLatex() {
    if (!doc) return;
    return downloadExport(
      `/v1/documents/${doc.id}/export-latex`,
      "article-latex.zip",
      "LaTeX project downloaded. Upload the zip to Overleaf to compile.",
      setExportingLatex
    );
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
    <div className="mx-auto flex max-w-5xl gap-8 pb-24">
      {/* Sticky contents rail: jump anywhere without endless scrolling. */}
      <nav className="sticky top-8 hidden w-48 shrink-0 self-start xl:block">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Contents
        </p>
        <div className="flex flex-col gap-0.5">
          {doc.sections.map((section, i) => (
            <button
              key={section.id}
              type="button"
              onClick={() => jumpToSection(section.id)}
              className={cn(
                "cursor-pointer truncate rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-foreground",
                openSections.has(section.id)
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {i + 1}. {section.heading}
            </button>
          ))}
          {doc.references.length > 0 && (
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById("doc-references")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="cursor-pointer truncate rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              References ({doc.references.length})
            </button>
          )}
        </div>
      </nav>

      <div className="flex min-w-0 max-w-3xl flex-1 flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <Link href="/documents">
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
            <ArrowLeft /> Articles
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
              <Button
                variant="secondary"
                size="sm"
                onClick={onExportLatex}
                loading={exportingLatex}
              >
                <FileCode2 /> Export LaTeX
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

      {doc.sections.map((section, index) => {
        const open = openSections.has(section.id);
        const words = section.content
          .split(/\s+/)
          .filter(Boolean).length;
        return (
          <Card
            key={section.id}
            id={`sec-${section.id}`}
            className={cn(
              "scroll-mt-8 py-0",
              aiBusy === section.id && "opacity-80"
            )}
          >
            <div
              className="flex cursor-pointer items-center gap-2 px-5 py-3.5"
              onClick={() => toggleSection(section.id)}
            >
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  !open && "-rotate-90"
                )}
              />
              {open ? (
                <input
                  value={section.heading}
                  disabled={generating}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    mutate((d) => ({
                      ...d,
                      sections: d.sections.map((s) =>
                        s.id === section.id
                          ? { ...s, heading: e.target.value }
                          : s
                      ),
                    }))
                  }
                  className="w-full border-none bg-transparent text-lg font-semibold tracking-tight outline-none disabled:opacity-70"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
                  {section.heading}
                </span>
              )}
              {!open && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {words.toLocaleString()} words
                </span>
              )}
              {!generating && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 rounded-full"
                      disabled={aiBusy !== null}
                      onClick={(e) => e.stopPropagation()}
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
                        onSelect={() => {
                          setOpenSections((prev) =>
                            new Set(prev).add(section.id)
                          );
                          onAi(section.id, cmd.value);
                        }}
                      >
                        {cmd.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {!open && section.content && (
              <p
                className="cursor-pointer px-5 pb-4 -mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground"
                onClick={() => toggleSection(section.id)}
              >
                {section.content}
              </p>
            )}
            {open && (
              <CardContent className="flex flex-col gap-2 pb-4">
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
            )}
          </Card>
        );
      })}

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
        <div id="doc-references" className="scroll-mt-8">
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
            <Trash2 /> Delete article
          </Button>
        </div>
      )}
      </div>
    </div>
  );
}
