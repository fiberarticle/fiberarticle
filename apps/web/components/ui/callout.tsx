import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  OctagonAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

const styles = {
  info: "bg-[color-mix(in_oklab,var(--leaf)_12%,transparent)] text-leaf",
  success:
    "bg-[color-mix(in_oklab,var(--success)_10%,transparent)] text-success",
  warning:
    "bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] text-warning",
  error:
    "bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-destructive",
};

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: OctagonAlert,
};

function Callout({
  tone = "info",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof styles }) {
  const Icon = icons[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-sm",
        styles[tone],
        className
      )}
      {...props}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="[&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2">
        {children}
      </div>
    </div>
  );
}

export { Callout };
