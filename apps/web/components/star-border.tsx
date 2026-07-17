"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Animated border for the chat inputs: a soft light dot endlessly travels
 * around the perimeter (the StarButton effect, applied to a whole surface).
 *
 * How it works: the wrapper paints the border color and keeps a thin ring
 * exposed via padding; the light is a radial-gradient square that follows a
 * CSS offset-path traced around the wrapper's rectangle. The opaque content
 * pane covers the middle, so the light is only visible on the ring.
 */
export function StarBorder({
  children,
  className,
  contentClassName,
  lightWidth = 200,
  duration = 6,
  borderWidth = 2,
  radius = 26,
}: {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  /** Diameter of the light's glow in px. */
  lightWidth?: number;
  /** Seconds for one full lap. */
  duration?: number;
  borderWidth?: number;
  /** Outer corner radius in px. */
  radius?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  // The offset-path must match the wrapper's real size, and the composer
  // resizes as the textarea grows, so keep the path in sync.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      el.style.setProperty(
        "--path",
        `path('M 0 0 H ${el.offsetWidth} V ${el.offsetHeight} H 0 V 0')`
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={
        {
          "--light-width": `${lightWidth}px`,
          "--star-duration": `${duration}s`,
          padding: borderWidth,
          borderRadius: radius,
        } as React.CSSProperties
      }
      className={cn(
        "relative isolate overflow-hidden bg-[color-mix(in_oklab,var(--border)_78%,var(--muted-foreground))]",
        className
      )}
    >
      <div
        aria-hidden
        className="fa-star-travel absolute aspect-square bg-[radial-gradient(circle_at_center,var(--light-color)_0%,transparent_60%)]"
        style={
          {
            offsetPath: "var(--path)",
            width: "var(--light-width)",
          } as React.CSSProperties
        }
      />
      <div
        className={cn("relative overflow-hidden", contentClassName)}
        style={{ borderRadius: Math.max(0, radius - borderWidth) }}
      >
        {children}
      </div>
    </div>
  );
}
