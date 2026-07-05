import { cn } from "@/lib/utils";

function TextShimmer({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // Two animations at once: the shine sweeps across while the highlight
    // color drifts through the logo palette (amber, green, blue, pink).
    <span
      className={cn(
        "inline-block [animation:var(--animate-shimmer),var(--animate-shimmer-hue)] bg-[linear-gradient(90deg,var(--muted-foreground)_35%,var(--shimmer-hi,var(--foreground))_50%,var(--muted-foreground)_65%)] bg-[length:200%_100%] bg-clip-text text-transparent",
        className
      )}
    >
      {children}
    </span>
  );
}

export { TextShimmer };
