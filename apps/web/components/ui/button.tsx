import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Radix Themes "classic" accent button
        default:
          "border border-[var(--classic-accent-border)] bg-[linear-gradient(to_bottom,var(--classic-accent-from),var(--classic-accent-to))] text-primary-foreground shadow-[inset_0_1px_0_var(--classic-highlight),inset_0_-1px_0_var(--classic-shade),0_1px_2px_rgba(0,0,0,0.25)] hover:brightness-105 active:translate-y-px active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]",
        // Radix Themes "classic" gray button
        secondary:
          "border border-[var(--classic-gray-border)] bg-[linear-gradient(to_bottom,var(--classic-gray-from),var(--classic-gray-to))] text-[var(--classic-gray-text)] shadow-[inset_0_1px_0_var(--classic-highlight),inset_0_-1px_0_var(--classic-shade),0_1px_2px_rgba(0,0,0,0.18)] hover:brightness-103 active:translate-y-px active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]",
        outline:
          "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive:
          "border border-[rgba(0,0,0,0.4)] bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--destructive)_92%,white),var(--destructive))] text-destructive-foreground shadow-[inset_0_1px_0_var(--classic-highlight),inset_0_-1px_0_var(--classic-shade),0_1px_2px_rgba(0,0,0,0.25)] hover:brightness-105 active:translate-y-px",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 [&_svg]:size-4",
        sm: "h-8 rounded-lg px-3 text-xs [&_svg]:size-3.5",
        lg: "h-10 rounded-xl px-6 [&_svg]:size-4",
        icon: "size-9 [&_svg]:size-4",
        "icon-sm": "size-8 rounded-lg [&_svg]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

function Button({
  className,
  variant,
  size,
  loading,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" />}
      {children}
    </button>
  );
}

export { Button, buttonVariants };
