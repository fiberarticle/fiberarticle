import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function FiberMark({ size = 34 }: { size?: number }) {
  return (
    <Image
      src="/Fiberarticle_Logo_Without_Background.svg"
      alt=""
      width={size}
      height={size}
      priority
      unoptimized
      aria-hidden
    />
  );
}

export function Wordmark({
  href = "/",
  className,
  textClassName,
}: {
  href?: string;
  className?: string;
  textClassName?: string;
}) {
  return (
    <Link
      href={href}
      className={cn("flex items-center gap-2 no-underline", className)}
    >
      <FiberMark />
      {/* Exactly the sign-in brand title gradient: amber on the left
          flowing to brown on the right. Inline style guarantees the same
          rendering as the auth page's CSS. */}
      <span
        className={cn(
          "bg-clip-text text-lg font-bold tracking-tight text-transparent",
          textClassName
        )}
        style={{
          backgroundImage:
            "linear-gradient(to right, #fca91e 0%, #d98b28 55%, #b3782d 100%)",
        }}
      >
        Fiberarticle
      </span>
    </Link>
  );
}
