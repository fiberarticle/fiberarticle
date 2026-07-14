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

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
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

        <div
          className="mt-1.5 flex max-h-64 flex-col gap-0.5 overflow-y-auto"
          // The picker portals outside the Settings dialog, whose modal
          // scroll-lock swallows wheel events over portaled content. Scroll
          // the list ourselves so the mouse wheel works, not just the bar.
          onWheel={(e) => {
            e.currentTarget.scrollTop += e.deltaY;
          }}
        >
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
                onClick={() => onSelect(style)}
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

        {valueTitle && (
          <p className="mt-2 px-1 text-[11px] text-muted-foreground">
            Current: {valueTitle}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
