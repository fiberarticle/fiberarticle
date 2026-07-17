"use client";

import * as React from "react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const SourceContext = React.createContext<{ href?: string }>({});

/** Site favicon for a source URL, ChatGPT/Claude style: the real icon of
 * arxiv.org, doi.org, nature.com, etc. builds trust at a glance. Falls back
 * to a globe when the URL is missing or the icon cannot be loaded. */
function SourceFavicon({ url, className }: { url?: string; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  const host = React.useMemo(() => {
    if (!url) return null;
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }, [url]);

  if (!host || failed) {
    return (
      <Globe className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${host}&sz=64`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("size-3.5 shrink-0 rounded-sm", className)}
    />
  );
}

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
        "inline-flex h-6 max-w-56 items-center gap-1.5 rounded-full border border-border bg-secondary pl-1.5 pr-2.5 text-xs text-secondary-foreground transition-colors hover:bg-accent",
        className
      )}
    >
      <SourceFavicon url={href} />
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
        <div className="flex items-start gap-2">
          <SourceFavicon url={href} className="mt-0.5 size-4" />
          <div className="min-w-0 text-sm font-medium leading-snug">{title}</div>
        </div>
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
