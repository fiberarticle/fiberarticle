"use client";

import * as React from "react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { cn } from "@/lib/utils";

const SourceContext = React.createContext<{ href?: string }>({});

function Source({
  href,
  children,
}: {
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <SourceContext.Provider value={{ href }}>
      <HoverCardPrimitive.Root openDelay={150} closeDelay={100}>
        {children}
      </HoverCardPrimitive.Root>
    </SourceContext.Provider>
  );
}

function SourceTrigger({
  className,
  label,
  children,
}: {
  className?: string;
  label?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { href } = React.useContext(SourceContext);
  const content = children ?? (
    <span
      className={cn(
        "inline-flex h-6 max-w-56 items-center gap-1 rounded-full border border-border bg-secondary px-2.5 text-xs text-secondary-foreground transition-colors hover:bg-accent",
        className
      )}
    >
      <span className="truncate">{label}</span>
    </span>
  );
  return (
    <HoverCardPrimitive.Trigger asChild>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {content}
        </a>
      ) : (
        <button type="button">{content}</button>
      )}
    </HoverCardPrimitive.Trigger>
  );
}

function SourceContent({
  title,
  description,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  const { href } = React.useContext(SourceContext);
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        sideOffset={6}
        className={cn(
          "z-50 w-80 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg",
          className
        )}
      >
        <div className="text-sm font-medium leading-snug">{title}</div>
        {description && (
          <div className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
        {href && (
          <div className="mt-2 truncate text-xs text-primary">{href}</div>
        )}
      </HoverCardPrimitive.Content>
    </HoverCardPrimitive.Portal>
  );
}

export { Source, SourceTrigger, SourceContent };
