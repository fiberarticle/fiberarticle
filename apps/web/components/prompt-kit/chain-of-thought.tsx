"use client";

import * as React from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

function ChainOfThought({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col", className)} {...props} />;
}

function ChainOfThoughtStep({
  className,
  isLast = false,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root> & {
  isLast?: boolean;
}) {
  return (
    <CollapsiblePrimitive.Root
      className={cn(
        "group relative pb-1 pl-7",
        !isLast &&
          "before:absolute before:left-[9px] before:top-6 before:bottom-0 before:w-px before:bg-border",
        className
      )}
      {...props}
    />
  );
}

function ChainOfThoughtTrigger({
  className,
  leftIcon,
  status = "done",
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger> & {
  leftIcon?: React.ReactNode;
  status?: "active" | "done" | "error";
}) {
  return (
    <CollapsiblePrimitive.Trigger
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "absolute left-0 flex size-[19px] items-center justify-center rounded-full border bg-card [&_svg]:size-3",
          status === "active" && "border-ring text-primary",
          status === "done" && "border-border text-muted-foreground",
          status === "error" && "border-destructive text-destructive"
        )}
      >
        {leftIcon}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{children}</span>
      <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
    </CollapsiblePrimitive.Trigger>
  );
}

function ChainOfThoughtContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      className={cn(
        "overflow-hidden data-[state=closed]:animate-[collapse_0.15s_ease-out] data-[state=open]:animate-[expand_0.15s_ease-out]",
        className
      )}
      {...props}
    >
      <div className="flex flex-col gap-1.5 py-1.5">{children}</div>
    </CollapsiblePrimitive.Content>
  );
}

function ChainOfThoughtItem({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export {
  ChainOfThought,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
};
