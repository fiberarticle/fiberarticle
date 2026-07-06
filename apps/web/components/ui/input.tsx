import * as React from "react";
import { cn } from "@/lib/utils";

function Input({
  className,
  type,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-xl border border-input bg-transparent px-3 py-1 text-sm shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Input };
