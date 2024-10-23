import type { Quartile } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Scimago journal-quartile styling with a medal metaphor:
 * Q1 gold, Q2 silver, Q3 bronze, Q4 neutral. Shared by the badge and by
 * the Q1-Q4 filter chips so the metals read consistently everywhere.
 */
export const QUARTILE_METAL: Record<
  Quartile,
  { badge: string; chipActive: string; chipIdle: string }
> = {
  Q1: {
    badge:
      "border-[#e0b94e] bg-[linear-gradient(135deg,#fdeeb8_0%,#f3cf6b_45%,#dca92e_100%)] text-[#6b4e0a] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]",
    chipActive:
      "border-[#e0b94e] bg-[linear-gradient(135deg,#fdeeb8_0%,#f3cf6b_45%,#dca92e_100%)] text-[#6b4e0a] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]",
    chipIdle:
      "border-[#e0b94e]/60 text-[#a8842a] hover:bg-[linear-gradient(135deg,#fdeeb8_0%,#f3cf6b_45%,#dca92e_100%)] hover:text-[#6b4e0a]",
  },
  Q2: {
    badge:
      "border-[#c2c2ca] bg-[linear-gradient(135deg,#f7f7f9_0%,#dcdce1_45%,#b9b9c1_100%)] text-[#494951] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]",
    chipActive:
      "border-[#c2c2ca] bg-[linear-gradient(135deg,#f7f7f9_0%,#dcdce1_45%,#b9b9c1_100%)] text-[#494951] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]",
    chipIdle:
      "border-[#c2c2ca]/70 text-[#84848e] hover:bg-[linear-gradient(135deg,#f7f7f9_0%,#dcdce1_45%,#b9b9c1_100%)] hover:text-[#494951]",
  },
  Q3: {
    badge:
      "border-[#c98d54] bg-[linear-gradient(135deg,#f3cfae_0%,#dd9f66_45%,#bd7841_100%)] text-[#5e3714] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]",
    chipActive:
      "border-[#c98d54] bg-[linear-gradient(135deg,#f3cfae_0%,#dd9f66_45%,#bd7841_100%)] text-[#5e3714] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]",
    chipIdle:
      "border-[#c98d54]/60 text-[#a9713d] hover:bg-[linear-gradient(135deg,#f3cfae_0%,#dd9f66_45%,#bd7841_100%)] hover:text-[#5e3714]",
  },
  Q4: {
    badge: "border-border bg-muted text-muted-foreground",
    chipActive: "border-ring bg-muted font-semibold text-foreground",
    chipIdle: "border-border text-muted-foreground hover:bg-accent",
  },
};

export function quartileChipClass(quartile: Quartile, active: boolean): string {
  const metal = QUARTILE_METAL[quartile];
  return active ? metal.chipActive : metal.chipIdle;
}

export function QuartileBadge({
  quartile,
  className,
}: {
  quartile: Quartile | null | undefined;
  className?: string;
}) {
  if (!quartile || !(quartile in QUARTILE_METAL)) return null;
  return (
    <span
      title={`Scimago best quartile ${quartile}`}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-[11px] font-bold leading-none",
        QUARTILE_METAL[quartile].badge,
        className
      )}
    >
      {quartile}
    </span>
  );
}
