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
      <span
        className={cn(
          "text-lg font-bold tracking-tight text-foreground",
          textClassName
        )}
      >
        Fiberarticle
      </span>
    </Link>
  );
}
