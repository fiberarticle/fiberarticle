"use client";

import * as React from "react";
import { Check, Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import type { CitationStyle } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Searchable picker over the full CSL catalog (10,000+ styles) with a live
 * preview of a sample reference rendered in the highlighted style.
 */
export function StylePicker({
  value,
  valueTitle,
  onSelect,
  children,
}: {
  value: string;
  valueTitle?: string;
  onSelect: (style: CitationStyle) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [styles, setStyles] = React.useState<CitationStyle[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);

  // Debounced catalog search.
  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch<CitationStyle[]>(
          `/v1/citations/styles?q=${encodeURIComponent(query)}`
        );
        setStyles(data);
      } catch {
        setStyles([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open]);

  // Live preview of the highlighted (or selected) style.
  const previewTarget = highlighted ?? value;
  React.useEffect(() => {
    if (!open || !previewTarget) return;
    let cancelled = false;
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch<{ preview: string }>(
          "/v1/citations/preview",
          {
            method: "POST",
            body: JSON.stringify({ style: previewTarget }),
          }
        );
        if (!cancelled) setPreview(data.preview);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previewTarget, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-[26rem] max-w-[90vw] p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search 10,000+ citation styles"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        {!query && (
          <p className="mt-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Popular styles
          </p>
        )}

        <div className="mt-1.5 flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {loading && styles.length === 0 && (
            <div className="flex flex-col gap-1.5 p-1">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          )}
          {!loading && styles.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">
              No styles matched that search.
            </p>
          )}
          {styles.map((style) => {
            const selected = style.id === value;
            return (
              <button
                key={style.id}
                type="button"
                onMouseEnter={() => setHighlighted(style.id)}
                onFocus={() => setHighlighted(style.id)}
                onClick={() => {
                  onSelect(style);
                  setOpen(false);
                  setQuery("");
                  setHighlighted(null);
                }}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent",
                  selected && "bg-accent"
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{style.title}</span>
                  {style.format && (
                    <span className="block text-[11px] text-muted-foreground">
                      {style.format.replace("-", " ")}
                    </span>
                  )}
                </span>
                {selected && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>

        <div className="mt-2 rounded-xl border border-border bg-muted/40 p-2.5">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Preview
          </p>
          {previewLoading ? (
            <Skeleton className="h-4 w-full" />
          ) : preview ? (
            <p className="text-xs leading-5 text-foreground/90">{preview}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Hover a style to preview a sample reference.
            </p>
          )}
        </div>
        {valueTitle && (
          <p className="mt-2 px-1 text-[11px] text-muted-foreground">
            Current: {valueTitle}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
