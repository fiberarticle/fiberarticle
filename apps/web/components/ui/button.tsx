import * as React from "react";
import {
  Button as RadixButton,
  IconButton as RadixIconButton,
} from "@radix-ui/themes";
import { cn } from "@/lib/utils";

/*
 * The app's button is the real Radix Themes button, the same component the
 * website uses (variant="classic"). The root <Theme> sits on <body> (see
 * app/layout.tsx), so every button, including ones inside portalled dialogs
 * and sheets, picks up the Radix tokens. The props below keep the old API so
 * call sites did not have to change.
 */
type Variant =
  | "default"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive"
  | "link";
type Size = "default" | "sm" | "lg" | "icon" | "icon-sm";

// Our variant -> Radix variant + colour. Every filled or bordered button is
// the classic one: brown for the main action, silver (gray, high contrast)
// like the website's Sign up for everything secondary, red for destructive.
const VARIANTS = {
  default: { variant: "classic", color: "brown", highContrast: false },
  secondary: { variant: "classic", color: "gray", highContrast: true },
  outline: { variant: "classic", color: "gray", highContrast: true },
  destructive: { variant: "classic", color: "red", highContrast: false },
  ghost: { variant: "ghost", color: "gray", highContrast: true },
} as const;

// Our size -> Radix size (Radix heights: 1=24, 2=32, 3=40, 4=48px). Size 2
// is the website navbar's Sign up size; 3 looked too big inside the app.
const SIZES = {
  default: "2",
  sm: "2",
  lg: "3",
  icon: "2",
  "icon-sm": "2",
} as const;

// Radix does not size icons; lucide draws at 24px unless told otherwise.
const ICON_SIZE: Record<Size, string> = {
  default: "[&_svg]:size-4",
  sm: "[&_svg]:size-3.5",
  lg: "[&_svg]:size-4",
  icon: "[&_svg]:size-4",
  "icon-sm": "[&_svg]:size-4",
};

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  variant?: Variant | null;
  size?: Size | null;
  loading?: boolean;
  /** Render the child (for example a Next.js <Link>) as the button. */
  asChild?: boolean;
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
  const v = variant ?? "default";
  const s = size ?? "default";
  const classes = cn(
    "cursor-pointer [&_svg]:pointer-events-none [&_svg]:shrink-0",
    ICON_SIZE[s],
    // Radix pulls ghost buttons outward with negative margins for optical
    // alignment; our layouts were built without that offset.
    v === "ghost" && "m-0",
    className
  );

  // Text-style link: Radix has no button variant for it, so it stays a plain
  // button styled as a link.
  if (v === "link") {
    return (
      <button
        className={cn(
          "inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-50",
          classes
        )}
        disabled={disabled || loading}
        {...props}
      >
        {children}
      </button>
    );
  }

  const look = VARIANTS[v];
  const shared = {
    variant: look.variant,
    color: look.color,
    highContrast: look.highContrast,
    size: SIZES[s],
    radius: "large",
    loading,
    disabled,
    className: classes,
  } as const;

  if (s === "icon" || s === "icon-sm") {
    return (
      <RadixIconButton {...shared} {...props}>
        {children}
      </RadixIconButton>
    );
  }
  return (
    <RadixButton {...shared} {...props}>
      {children}
    </RadixButton>
  );
}

export { Button };
