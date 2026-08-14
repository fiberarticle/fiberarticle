"use client";

/**
 * The four charts on the Admin page, drawn as plain SVG.
 *
 * No chart library: these are two shapes, and a dependency would cost more than
 * it saves. They follow the house rules for charts:
 *
 *   - bars capped at 24px thick, rounded on the growing end only, square where
 *     they meet the baseline
 *   - a 2px gap in the surface colour between neighbouring bars, so touching
 *     bars separate without a border being drawn around them
 *   - one hairline baseline, no grid of lines across the plot
 *   - one colour per chart where there is one thing being counted, so no legend
 *     is needed: the heading already says what is being shown
 *   - where there are categories, the category name is written beside its bar,
 *     so the reader never has to match a colour to a key. That also means the
 *     chart still works for anyone who cannot separate the colours
 *   - every value is written out, and the charts fall back to a plain sentence
 *     when there is nothing to draw yet
 *
 * Colours come from the app's own tokens, so both light and dark mode are
 * handled without a second palette.
 */

import { useId, useState } from "react";

/* ------------------------------------------------------------------ tiles */

export function StatTile({
  label,
  value,
  hint,
  tone = "plain",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "plain" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    plain: "text-foreground",
    good: "text-[var(--success)]",
    warn: "text-[var(--warning)]",
    bad: "text-destructive",
  }[tone];

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <p className="text-xs font-medium text-muted-foreground sm:text-sm">
        {label}
      </p>
      <p
        className={`mt-1.5 text-2xl font-semibold tabular-nums sm:text-3xl ${toneClass}`}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- wrapper */

function ChartCard({
  title,
  note,
  empty,
  children,
}: {
  title: string;
  note?: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold sm:text-base">{title}</h3>
        {note ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
        ) : null}
      </div>
      {empty ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing to show yet.
        </p>
      ) : (
        children
      )}
    </div>
  );
}

/* --------------------------------------------------------------- columns */

/**
 * Day by day counts. Upright bars, oldest on the left.
 *
 * Only a few day labels are printed. Fourteen of them will not fit on a phone,
 * and a crowded axis is harder to read than a sparse one.
 */
export function DayColumns({
  title,
  note,
  data,
}: {
  title: string;
  note?: string;
  data: { label: string; value: number }[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();

  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const empty = data.length === 0 || total === 0;

  // Label every third day, and always the last one, so today is never unnamed.
  const showLabel = (i: number) => i === data.length - 1 || i % 3 === 0;

  return (
    <ChartCard
      title={title}
      note={note ?? `${total.toLocaleString()} in the last ${data.length} days`}
      empty={empty}
    >
      <div className="flex h-44 items-end gap-[2px] sm:h-52">
        {data.map((d, i) => {
          const pct = (d.value / max) * 100;
          const active = hover === i;
          return (
            <button
              key={`${id}-${d.label}-${i}`}
              type="button"
              // The whole column is the hit target, not just the drawn bar, so
              // a day with zero can still be pointed at.
              className="group relative flex h-full flex-1 cursor-default flex-col justify-end"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${d.label}: ${d.value}`}
            >
              {active ? (
                <span className="pointer-events-none absolute inset-x-0 -top-1 z-10 mx-auto w-max -translate-y-full rounded-lg border border-border bg-popover px-2 py-1 text-xs whitespace-nowrap shadow-md">
                  <span className="font-medium">{d.value.toLocaleString()}</span>{" "}
                  <span className="text-muted-foreground">on {d.label}</span>
                </span>
              ) : null}
              <span
                className="mx-auto w-full max-w-6 rounded-t-[4px] bg-primary transition-opacity"
                style={{
                  // Never a zero-height bar: a 3px stub shows the day exists
                  // and had none, which an absent bar cannot say.
                  height: d.value === 0 ? "3px" : `max(3px, ${pct}%)`,
                  opacity: d.value === 0 ? 0.25 : active ? 1 : 0.85,
                }}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex gap-[2px] border-t border-border pt-2">
        {data.map((d, i) => (
          <span
            key={`${id}-x-${i}`}
            className="flex-1 truncate text-center text-[10px] text-muted-foreground"
          >
            {showLabel(i) ? d.label : ""}
          </span>
        ))}
      </div>
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ bars */

/**
 * Named categories. Bars run left to right with the name above each one, which
 * is what makes the colour optional rather than load-bearing.
 */
export function NamedBars({
  title,
  note,
  data,
  colorFor,
  labelFor,
}: {
  title: string;
  note?: string;
  data: { label: string; value: number }[];
  colorFor?: (label: string) => string;
  labelFor?: (label: string) => string;
}) {
  const id = useId();
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <ChartCard
      title={title}
      note={note}
      empty={data.length === 0 || total === 0}
    >
      <ul className="flex flex-col gap-3.5">
        {data.map((d, i) => {
          const pct = (d.value / max) * 100;
          const share = total > 0 ? Math.round((d.value / total) * 100) : 0;
          return (
            <li key={`${id}-${d.label}-${i}`}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      background: colorFor?.(d.label) ?? "var(--primary)",
                    }}
                  />
                  <span className="truncate text-sm">
                    {labelFor?.(d.label) ?? d.label}
                  </span>
                </span>
                <span className="shrink-0 text-sm tabular-nums">
                  {d.value.toLocaleString()}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {share}%
                  </span>
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `max(6px, ${pct}%)`,
                    background: colorFor?.(d.label) ?? "var(--primary)",
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}

/**
 * Colours for how a research run ended. These are states, not a series, so they
 * keep the app's own success and danger colours and always sit beside their
 * name.
 */
export function runStatusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "finished" || s === "complete" || s === "completed" || s === "done")
    return "var(--success)";
  if (s === "failed" || s === "error") return "var(--destructive)";
  if (s === "running") return "var(--primary)";
  return "var(--muted-foreground)";
}

/** Plain words for run states, so the chart is not full of database values. */
export function runStatusLabel(status: string): string {
  const s = status.toLowerCase();
  const map: Record<string, string> = {
    finished: "Finished",
    completed: "Finished",
    complete: "Finished",
    done: "Finished",
    failed: "Failed",
    error: "Failed",
    running: "Still running",
    pending: "Waiting to start",
    cancelled: "Cancelled",
    canceled: "Cancelled",
  };
  return map[s] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

/** One steady colour per AI choice, matching the logo palette. */
export function aiModeColor(mode: string): string {
  const map: Record<string, string> = {
    fiberarticle_ai: "#fca91e",
    byok: "#4f90e4",
    local: "#50c158",
  };
  return map[mode] ?? "var(--muted-foreground)";
}
