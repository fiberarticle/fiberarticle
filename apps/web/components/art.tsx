/**
 * Hand-drawn-style inline SVG illustrations in the Fiberarticle palette.
 * Stroke-based, no external assets, no emoji. Accent strokes use var(--leaf).
 *
 * Motion: .fa-art-draw (stroke draw-in) and .fa-art-pulse (soft opacity
 * pulse) - defined in globals.css and disabled under prefers-reduced-motion.
 */

import { LibraryBig } from "lucide-react";

/** A big library: the Researcher page. */
export function ResearcherArt({ className }: { className?: string }) {
  return (
    <div className={className} role="img" aria-label="Library">
      <div className="flex h-28 items-center justify-center">
        <LibraryBig
          className="size-20 text-muted-foreground"
          strokeWidth={1.3}
        />
      </div>
    </div>
  );
}

function strokeProps(width = 1.6) {
  return {
    fill: "none",
    strokeWidth: width,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

/** Stacked papers under a magnifying lens: the literature review. */
export function ReviewArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 140"
      className={className}
      role="img"
      aria-label="Stack of papers under a magnifying lens"
    >
      <g stroke="var(--border)" {...strokeProps()}>
        <rect x="30" y="52" width="86" height="64" rx="6" fill="var(--card)" />
        <rect x="38" y="42" width="86" height="64" rx="6" fill="var(--card)" />
      </g>
      <g stroke="var(--muted-foreground)" {...strokeProps()}>
        <rect x="46" y="32" width="86" height="64" rx="6" fill="var(--card)" />
        <line x1="58" y1="48" x2="118" y2="48" />
        <line x1="58" y1="58" x2="112" y2="58" />
        <line x1="58" y1="68" x2="118" y2="68" />
        <line x1="58" y1="78" x2="96" y2="78" />
      </g>
      <g>
        <g stroke="var(--leaf)" {...strokeProps(2.2)}>
          <circle
            cx="138"
            cy="78"
            r="24"
            fill="color-mix(in oklab, var(--leaf) 7%, transparent)"
          />
          <line x1="155" y1="95" x2="172" y2="112" />
        </g>
        <g stroke="var(--leaf)" {...strokeProps(1.8)}>
          <path className="fa-art-draw" pathLength={60} d="M128 78 l7 7 l14 -14" />
        </g>
      </g>
    </svg>
  );
}

/** Quill writing on a manuscript: the AI writer / articles. */
export function WriterArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 140"
      className={className}
      role="img"
      aria-label="Quill writing on a manuscript"
    >
      <g stroke="var(--muted-foreground)" {...strokeProps()}>
        <rect x="40" y="30" width="96" height="84" rx="8" fill="var(--card)" />
        <line x1="54" y1="50" x2="122" y2="50" />
        <line x1="54" y1="62" x2="116" y2="62" />
        <line x1="54" y1="74" x2="122" y2="74" />
        <line className="fa-art-draw" pathLength={60} x1="54" y1="86" x2="88" y2="86" />
      </g>
      <g>
        <g stroke="var(--leaf)" {...strokeProps(2)}>
          <path
            d="M96 96 C 120 60, 148 40, 168 28 C 160 52, 140 84, 112 104 Z"
            fill="color-mix(in oklab, var(--leaf) 8%, transparent)"
          />
          <line x1="96" y1="96" x2="86" y2="108" />
        </g>
      </g>
    </svg>
  );
}

/** Empty bookshelf: the library before anything is added. */
export function EmptyShelfArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 140"
      className={className}
      role="img"
      aria-label="Bookshelf with a few books"
    >
      <g stroke="var(--muted-foreground)" {...strokeProps()}>
        <line x1="30" y1="110" x2="170" y2="110" />
        <rect x="48" y="66" width="14" height="44" rx="2" fill="var(--card)" />
        <rect x="66" y="58" width="14" height="52" rx="2" fill="var(--card)" />
        <rect x="84" y="70" width="14" height="40" rx="2" fill="var(--card)" />
      </g>
      <g>
        <g stroke="var(--leaf)" {...strokeProps(1.8)}>
          <rect
            x="106"
            y="54"
            width="16"
            height="56"
            rx="2"
            fill="color-mix(in oklab, var(--leaf) 8%, transparent)"
            transform="rotate(8 114 82)"
          />
        </g>
      </g>
      <g stroke="var(--border)" {...strokeProps()}>
        <line x1="52" y1="76" x2="58" y2="76" />
        <line x1="70" y1="68" x2="76" y2="68" />
        <line x1="88" y1="80" x2="94" y2="80" />
      </g>
    </svg>
  );
}

/** Compass over a document: starting a new research direction. */
export function CompassArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 140"
      className={className}
      role="img"
      aria-label="Compass over a document"
    >
      <g stroke="var(--muted-foreground)" {...strokeProps()}>
        <rect x="36" y="34" width="80" height="80" rx="8" fill="var(--card)" />
        <line x1="50" y1="54" x2="102" y2="54" />
        <line x1="50" y1="66" x2="96" y2="66" />
        <line x1="50" y1="78" x2="102" y2="78" />
      </g>
      <g>
        <g stroke="var(--leaf)" {...strokeProps(2)}>
          <circle
            cx="134"
            cy="76"
            r="28"
            fill="color-mix(in oklab, var(--leaf) 7%, transparent)"
          />
          <path
            className="fa-art-pulse"
            d="M146 62 L138 80 L122 90 L130 72 Z"
            fill="color-mix(in oklab, var(--leaf) 20%, transparent)"
          />
        </g>
      </g>
    </svg>
  );
}

/** Question card answered by a reply card with a check: Ask. */
export function AskArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 140"
      className={className}
      role="img"
      aria-label="Question card with an answered reply"
    >
      <g stroke="var(--border)" {...strokeProps()}>
        <rect x="40" y="52" width="72" height="54" rx="8" fill="var(--card)" />
      </g>
      <g stroke="var(--muted-foreground)" {...strokeProps()}>
        <rect x="32" y="42" width="72" height="54" rx="8" fill="var(--card)" />
        <path d="M58 60 c0 -7 12 -7 12 0 c0 5 -6 4 -6 10" />
        <line x1="64" y1="78" x2="64" y2="79" />
        <line x1="82" y1="62" x2="94" y2="62" />
        <line x1="82" y1="72" x2="92" y2="72" />
      </g>
      <g>
        <g stroke="var(--leaf)" {...strokeProps(1.8)}>
          <rect
            x="118"
            y="38"
            width="52"
            height="42"
            rx="9"
            fill="color-mix(in oklab, var(--leaf) 8%, transparent)"
          />
          <path d="M130 80 l-4 9 l13 -9" fill="var(--background)" />
          <line
            className="fa-art-draw"
            pathLength={60}
            x1="128"
            y1="50"
            x2="160"
            y2="50"
          />
          <line
            className="fa-art-draw"
            pathLength={60}
            x1="128"
            y1="58"
            x2="154"
            y2="58"
          />
          <path
            className="fa-art-draw"
            pathLength={60}
            d="M128 68 l5 5 l10 -10"
          />
        </g>
      </g>
    </svg>
  );
}

/** Document flowing into a structured grid: Extract. */
export function ExtractArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 140"
      className={className}
      role="img"
      aria-label="Document distilled into a data table"
    >
      <g stroke="var(--muted-foreground)" {...strokeProps()}>
        <rect x="30" y="36" width="56" height="72" rx="6" fill="var(--card)" />
        <line x1="40" y1="52" x2="76" y2="52" />
        <line x1="40" y1="62" x2="72" y2="62" />
        <line x1="40" y1="72" x2="76" y2="72" />
        <line x1="40" y1="82" x2="64" y2="82" />
      </g>
      <g stroke="var(--leaf)" {...strokeProps(1.8)}>
        <path className="fa-art-draw" pathLength={60} d="M92 72 h20 m-6 -6 l6 6 l-6 6" />
      </g>
      <g>
        <g stroke="var(--leaf)" {...strokeProps(1.7)}>
          <rect
            x="122"
            y="46"
            width="52"
            height="52"
            rx="6"
            fill="color-mix(in oklab, var(--leaf) 6%, transparent)"
          />
          <line x1="122" y1="63" x2="174" y2="63" />
          <line x1="122" y1="80" x2="174" y2="80" />
          <line x1="148" y1="46" x2="148" y2="98" />
        </g>
      </g>
    </svg>
  );
}

/** Chat bubbles over an open book: the paper Assistant. */
export function AssistantArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 140"
      className={className}
      role="img"
      aria-label="Conversation about an open book"
    >
      <g stroke="var(--muted-foreground)" {...strokeProps()}>
        <path
          d="M56 108 c14 -8 34 -8 44 0 c10 -8 30 -8 44 0 v-46 c-14 -8 -34 -8 -44 0 c-10 -8 -30 -8 -44 0 Z"
          fill="var(--card)"
        />
        <line x1="100" y1="62" x2="100" y2="108" />
        <line x1="66" y1="72" x2="90" y2="72" />
        <line x1="66" y1="82" x2="88" y2="82" />
        <line x1="110" y1="72" x2="134" y2="72" />
        <line x1="110" y1="82" x2="132" y2="82" />
      </g>
      <g>
        <g stroke="var(--leaf)" {...strokeProps(1.8)}>
          <rect
            x="118"
            y="24"
            width="46"
            height="26"
            rx="9"
            fill="color-mix(in oklab, var(--leaf) 9%, transparent)"
          />
          <path d="M130 50 l-4 8 l12 -8" fill="var(--background)" />
          <line className="fa-art-draw" pathLength={60} x1="128" y1="34" x2="154" y2="34" />
          <line className="fa-art-draw" pathLength={60} x1="128" y1="41" x2="148" y2="41" />
        </g>
      </g>
      <g stroke="var(--border)" {...strokeProps(1.5)}>
        <rect x="42" y="34" width="34" height="20" rx="7" fill="var(--card)" />
        <path d="M56 54 l3 6 l6 -6" fill="var(--card)" />
        <line x1="50" y1="42" x2="68" y2="42" />
        <line x1="50" y1="47" x2="62" y2="47" />
      </g>
    </svg>
  );
}
