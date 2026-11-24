/**
 * Hand-drawn-style inline SVG illustrations in the Fiberarticle palette.
 * Stroke-based, no external assets, no emoji. Accent strokes use var(--leaf).
 *
 * Motion: .fa-art-draw (stroke draw-in) and .fa-art-pulse (soft opacity
 * pulse) - defined in globals.css and disabled under prefers-reduced-motion.
 */

import {
  ClipboardCheck,
  LibraryBig,
  MessagesSquare,
  PenLine,
  Table2,
  type LucideIcon,
} from "lucide-react";

/**
 * Chalk style feature art: a thick icon drawing over a scribbled patch of the
 * same colour, both run through a grain filter so they look drawn with chalk
 * or crayon. Pure SVG (no image files), and the patch mixes with the page
 * background so it works in light and dark mode.
 */
function ChalkArt({
  id,
  icon: Icon,
  color,
  label,
  className,
}: {
  /** Unique per art kind; same-kind copies on one page share one filter. */
  id: string;
  icon: LucideIcon;
  color: string;
  label: string;
  className?: string;
}) {
  const filterId = `fa-chalk-${id}`;
  return (
    <svg viewBox="0 0 200 140" className={className} role="img" aria-label={label}>
      <defs>
        <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%">
          {/* Noise drives both the rough edges and the speckled grain. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.42"
            numOctaves="2"
            seed="7"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="6"
            xChannelSelector="R"
            yChannelSelector="G"
            result="rough"
          />
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3 0 0 0 -0.75"
            result="grain"
          />
          <feComposite in="rough" in2="grain" operator="in" />
        </filter>
      </defs>
      <g filter={`url(#${filterId})`}>
        {/* Scribbled patch: a few crayon strokes, kept light and set a
            little to the right so the drawing stays the main thing. */}
        <path
          d="M66 48 L146 44 M60 68 L154 64 M66 88 L150 86 M76 106 L140 104"
          fill="none"
          stroke={`color-mix(in oklab, ${color} 16%, var(--background))`}
          strokeWidth="18"
          strokeLinecap="round"
        />
        <Icon x={56} y={26} size={88} color={color} strokeWidth={2.2} />
      </g>
    </svg>
  );
}

/** A shelf of books: the Researcher page. */
export function ResearcherArt({ className }: { className?: string }) {
  return (
    <ChalkArt
      id="researcher"
      icon={LibraryBig}
      color="#fca91e"
      label="Shelf of books"
      className={className}
    />
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

/** A checked clipboard: the literature review. */
export function ReviewArt({ className }: { className?: string }) {
  return (
    <ChalkArt
      id="review"
      icon={ClipboardCheck}
      color="#50c158"
      label="Checked clipboard"
      className={className}
    />
  );
}

/** A pen writing: the AI writer / articles. */
export function WriterArt({ className }: { className?: string }) {
  return (
    <ChalkArt
      id="writer"
      icon={PenLine}
      color="#ff7db1"
      label="Pen writing"
      className={className}
    />
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

/** Two chat bubbles: Ask, the paper Assistant. */
export function AskArt({ className }: { className?: string }) {
  return (
    <ChalkArt
      id="ask"
      icon={MessagesSquare}
      color="#4f90e4"
      label="Question and answer"
      className={className}
    />
  );
}

/** A data table: Extract. */
export function ExtractArt({ className }: { className?: string }) {
  return (
    <ChalkArt
      id="extract"
      icon={Table2}
      color="#9a6b45"
      label="Data table"
      className={className}
    />
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
