import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-secondary text-secondary-foreground",
        primary:
          "border-transparent bg-[color-mix(in_oklab,var(--primary)_16%,transparent)] text-primary",
        success:
          "border-transparent bg-[color-mix(in_oklab,var(--success)_15%,transparent)] text-success",
        warning:
          "border-transparent bg-[color-mix(in_oklab,var(--warning)_15%,transparent)] text-warning",
        destructive:
          "border-transparent bg-[color-mix(in_oklab,var(--destructive)_14%,transparent)] text-destructive",
        info:
          "border-transparent bg-[color-mix(in_oklab,var(--leaf)_16%,transparent)] text-leaf",
        leaf: "border-transparent bg-leaf-soft text-leaf",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
