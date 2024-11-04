"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ClipboardCheck,
  ChevronRight,
  HatGlasses,
  LogOut,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Pin,
  PinOff,
  Settings,
  SquarePen,
  Table2,
  Trash2,
  UserRound,
} from "lucide-react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark, FiberMark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import type {
  Conversation,
  DocumentListItem,
  Extraction,
  Run,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const OPEN_SECTIONS_KEY = "fa-sidebar-open";
const MAX_VISIBLE_ITEMS = 20;

type SectionKey = "researcher" | "review" | "writer" | "assistant" | "extract";

interface HistoryItem {
  id: string;
  title: string;
  pinned: boolean;
  href: string;
}

interface SectionDef {
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{
    className?: string;
    style?: React.CSSProperties;
  }>;
  /** Brand accent from the Fiberarticle agent palette. */
  accent: string;
  /** The feature's dedicated page: the label navigates here. */
  landing: string;
  load: () => Promise<HistoryItem[]>;
  rename: (id: string, title: string) => Promise<unknown>;
  pin: (id: string, pinned: boolean) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
}

const patch = (path: string, body: Record<string, unknown>) =>
  apiFetch(path, { method: "PATCH", body: JSON.stringify(body) });

const runsSection = (
  key: SectionKey,
  label: string,
  icon: SectionDef["icon"],
  accent: string,
  landing: string,
  mode: "research" | "literature_review"
): SectionDef => ({
  key,
  label,
  icon,
  accent,
  landing,
  load: async () =>
    (await apiFetch<Run[]>(`/v1/runs?mode=${mode}`)).map((r) => ({
      id: r.id,
      title: r.title || r.topic,
      pinned: r.pinned,
      href: `/runs/${r.id}`,
    })),
  rename: (id, title) => patch(`/v1/runs/${id}`, { title }),
  pin: (id, pinned) => patch(`/v1/runs/${id}`, { pinned }),
  remove: (id) => apiFetch(`/v1/runs/${id}`, { method: "DELETE" }),
});

// Accents match the dashboard agent fan (components/agent-composer.tsx).
const SECTIONS: SectionDef[] = [
  runsSection(
    "researcher",
    "Researcher",
    UserRound,
    "#fca91e",
    "/researcher",
    "research"
  ),
  runsSection(
    "review",
    "Literature Reviewer",
    ClipboardCheck,
    "#50c158",
    "/review",
    "literature_review"
  ),
  {
    key: "writer",
    label: "Article Writer",
    icon: SquarePen,
    accent: "#ff7db1",
    landing: "/documents",
    load: async () =>
      (await apiFetch<DocumentListItem[]>("/v1/documents")).map((d) => ({
        id: d.id,
        title: d.title,
        pinned: d.pinned,
        href: `/documents/${d.id}`,
      })),
    rename: (id, title) =>
      apiFetch(`/v1/documents/${id}`, {
        method: "PUT",
        body: JSON.stringify({ title }),
      }),
    pin: (id, pinned) =>
      apiFetch(`/v1/documents/${id}`, {
        method: "PUT",
        body: JSON.stringify({ pinned }),
      }),
    remove: (id) => apiFetch(`/v1/documents/${id}`, { method: "DELETE" }),
  },
  {
    key: "assistant",
    label: "Assistant",
    // Same hat-and-glasses icon as the dashboard AI Assistant card, so the
    // two read as one feature.
    icon: HatGlasses,
    accent: "#4f90e4",
    landing: "/assistant",
    load: async () =>
      (await apiFetch<Conversation[]>("/v1/chats")).map((c) => ({
        id: c.id,
        title: c.title,
        pinned: c.pinned,
        href: `/assistant?chat=${c.id}`,
      })),
    rename: (id, title) => patch(`/v1/chats/${id}`, { title }),
    pin: (id, pinned) => patch(`/v1/chats/${id}`, { pinned }),
    remove: (id) => apiFetch(`/v1/chats/${id}`, { method: "DELETE" }),
  },
  {
    key: "extract",
    label: "Extract",
    icon: Table2,
    accent: "#9a6b45",
    landing: "/extract",
    load: async () =>
      (await apiFetch<Extraction[]>("/v1/extractions")).map((e) => ({
        id: e.id,
        title: e.name,
        pinned: e.pinned,
        href: `/extract?id=${e.id}`,
      })),
    rename: (id, name) => patch(`/v1/extractions/${id}`, { name }),
    pin: (id, pinned) => patch(`/v1/extractions/${id}`, { pinned }),
    remove: (id) => apiFetch(`/v1/extractions/${id}`, { method: "DELETE" }),
  },
];

/** One history row: open on click, hover "..." menu for rename/pin/delete. */
function HistoryRow({
  item,
  active,
  onRename,
  onPin,
  onDelete,
}: {
  item: HistoryItem;
  active: boolean;
  onRename: (title: string) => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(item.title);
  const [menuOpen, setMenuOpen] = React.useState(false);

  function commitRename() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== item.title) onRename(next);
    else setDraft(item.title);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitRename();
          if (e.key === "Escape") {
            setDraft(item.title);
            setEditing(false);
          }
        }}
        className="w-full rounded-lg border border-ring bg-transparent px-2 py-1 text-[13px] outline-none"
      />
    );
  }

  return (
    <div
      className={cn(
        "group/row relative flex items-center rounded-lg transition-colors",
        active
          ? "bg-[color-mix(in_oklab,var(--primary)_12%,transparent)]"
          : "hover:bg-accent"
      )}
    >
      <Link
        href={item.href}
        title={item.title}
        className={cn(
          "min-w-0 flex-1 truncate px-2 py-1.5 text-[13px]",
          active ? "font-medium text-primary" : "text-muted-foreground"
        )}
      >
        {item.title}
      </Link>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Options for ${item.title}`}
            className={cn(
              "mr-1 shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100",
              menuOpen && "opacity-100"
            )}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-40">
          <DropdownMenuItem
            onSelect={() => {
              setDraft(item.title);
              setEditing(true);
            }}
          >
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onPin}>
            {item.pinned ? (
              <>
                <PinOff /> Unpin
              </>
            ) : (
              <>
                <Pin /> Pin
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive [&_svg]:text-destructive"
            onSelect={onDelete}
          >
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Section({
  def,
  items,
  loaded,
  open,
  onOpenChange,
  activeHref,
  onMutate,
}: {
  def: SectionDef;
  items: HistoryItem[];
  loaded: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeHref: string;
  onMutate: (
    key: SectionKey,
    update: (items: HistoryItem[]) => HistoryItem[],
    action: () => Promise<unknown>
  ) => void;
}) {
  const Icon = def.icon;
  const pinned = items.filter((i) => i.pinned);
  const recent = items.filter((i) => !i.pinned).slice(0, MAX_VISIBLE_ITEMS);

  const row = (item: HistoryItem) => (
    <HistoryRow
      key={item.id}
      item={item}
      active={activeHref === item.href}
      onRename={(title) =>
        onMutate(
          def.key,
          (list) =>
            list.map((i) => (i.id === item.id ? { ...i, title } : i)),
          () => def.rename(item.id, title)
        )
      }
      onPin={() =>
        onMutate(
          def.key,
          (list) =>
            list.map((i) =>
              i.id === item.id ? { ...i, pinned: !item.pinned } : i
            ),
          () => def.pin(item.id, !item.pinned)
        )
      }
      onDelete={() =>
        onMutate(
          def.key,
          (list) => list.filter((i) => i.id !== item.id),
          () => def.remove(item.id)
        )
      }
    />
  );

  const sectionActive =
    activeHref === def.landing || activeHref.startsWith(def.landing + "/");

  return (
    <CollapsiblePrimitive.Root open={open} onOpenChange={onOpenChange}>
      {/* Label opens the feature's dedicated page; the chevron toggles the
          history list. */}
      <div
        className={cn(
          "group/section flex w-full items-center rounded-xl transition-colors",
          sectionActive
            ? "bg-[color-mix(in_oklab,var(--primary)_12%,transparent)]"
            : "hover:bg-accent"
        )}
      >
        <Link
          href={def.landing}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-sm [&_svg]:size-4",
            sectionActive
              ? "font-medium text-primary"
              : "text-muted-foreground group-hover/section:text-foreground"
          )}
        >
          <Icon className="shrink-0" style={{ color: def.accent }} />
          <span className="min-w-0 flex-1 truncate text-left">{def.label}</span>
        </Link>
        <CollapsiblePrimitive.Trigger asChild>
          <button
            aria-label={`Toggle ${def.label} history`}
            className="mr-1.5 shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] hover:text-foreground focus-visible:opacity-100 group-hover/section:opacity-100 data-[state=open]:opacity-100"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", open && "rotate-90")}
            />
          </button>
        </CollapsiblePrimitive.Trigger>
      </div>
      <CollapsiblePrimitive.Content className="overflow-hidden">
        <div className="ml-4 flex flex-col gap-0.5 border-l border-border py-1 pl-2">
          {!loaded ? (
            <div className="flex flex-col gap-1 px-2 py-1">
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground/70">
              No history yet
            </p>
          ) : (
            <>
              {pinned.length > 0 && (
                <>
                  <p className="flex items-center gap-1 px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    <Pin className="size-2.5" /> Pinned
                  </p>
                  {pinned.map(row)}
                  {recent.length > 0 && <div className="my-1 h-px bg-border" />}
                </>
              )}
              {recent.map(row)}
            </>
          )}
        </div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}

export function Sidebar({
  userName,
  userEmail,
}: {
  userName: string;
  userEmail: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(false);

  // The active row is matched on path plus the query params we use for
  // deep links (assistant chats, extraction tables).
  const chatParam = searchParams.get("chat");
  const idParam = searchParams.get("id");
  const activeHref =
    pathname === "/assistant" && chatParam
      ? `/assistant?chat=${chatParam}`
      : pathname === "/extract" && idParam
        ? `/extract?id=${idParam}`
        : pathname;

  const [openSections, setOpenSections] = React.useState<
    Record<string, boolean>
  >({});
  const [history, setHistory] = React.useState<
    Partial<Record<SectionKey, HistoryItem[]>>
  >({});

  // Restore remembered open/closed state after mount (avoids hydration
  // mismatch with server-rendered markup).
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(OPEN_SECTIONS_KEY);
      if (stored) setOpenSections(JSON.parse(stored));
    } catch {
      // corrupted state: default to all collapsed
    }
  }, []);

  function toggleSection(key: SectionKey, open: boolean) {
    setOpenSections((prev) => {
      const next = { ...prev, [key]: open };
      localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(next));
      return next;
    });
  }

  const loadAll = React.useCallback(async () => {
    const results = await Promise.allSettled(SECTIONS.map((s) => s.load()));
    setHistory((prev) => {
      const next = { ...prev };
      results.forEach((result, i) => {
        if (result.status === "fulfilled") {
          next[SECTIONS[i].key] = result.value;
        }
      });
      return next;
    });
  }, []);

  // Refresh on navigation (new items appear right after they are created)
  // and on a slow poll (background AI titles land without a reload).
  React.useEffect(() => {
    loadAll();
  }, [loadAll, pathname]);
  React.useEffect(() => {
    const interval = setInterval(loadAll, 20_000);
    return () => clearInterval(interval);
  }, [loadAll]);

  function onMutate(
    key: SectionKey,
    update: (items: HistoryItem[]) => HistoryItem[],
    action: () => Promise<unknown>
  ) {
    // Optimistic: update the list immediately, reconcile with the server after.
    setHistory((prev) => ({ ...prev, [key]: update(prev[key] ?? []) }));
    action()
      .catch(() => undefined)
      .finally(loadAll);
  }

  async function onSignOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          "sticky top-0 flex h-screen shrink-0 flex-col justify-between border-r border-border bg-sidebar transition-[width] duration-200",
          collapsed ? "w-14" : "w-64"
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 py-4">
          <div
            className={cn(
              "flex items-center",
              collapsed ? "justify-center" : "justify-between pl-1"
            )}
          >
            {collapsed ? (
              // Collapsed: the logo itself is the expand control; hovering
              // swaps it for the expand icon.
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Expand sidebar"
                    onClick={() => setCollapsed(false)}
                    className="group/logo mx-auto flex size-9 cursor-pointer items-center justify-center rounded-xl transition-colors hover:bg-accent"
                  >
                    <span className="group-hover/logo:hidden">
                      <FiberMark />
                    </span>
                    <PanelLeft className="hidden size-4 rotate-180 text-muted-foreground group-hover/logo:block" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Expand sidebar</TooltipContent>
              </Tooltip>
            ) : (
              <>
                <Wordmark href="/dashboard" />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Collapse sidebar"
                  onClick={() => setCollapsed(true)}
                >
                  <PanelLeft />
                </Button>
              </>
            )}
          </div>

          <Link href="/dashboard" className={cn(collapsed && "mx-auto")}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="secondary" size="icon-sm" aria-label="New Task">
                    <SquarePen />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">New Task</TooltipContent>
              </Tooltip>
            ) : (
              <Button variant="secondary" className="w-full justify-start">
                <SquarePen />
                New Task
              </Button>
            )}
          </Link>

          {collapsed ? (
            <nav className="flex flex-col items-center gap-0.5">
              {SECTIONS.map((section) => {
                const Icon = section.icon;
                const active =
                  pathname === section.landing ||
                  pathname.startsWith(section.landing + "/");
                return (
                  <Tooltip key={section.key}>
                    <TooltipTrigger asChild>
                      <Link
                        href={section.landing}
                        aria-label={section.label}
                        className={cn(
                          "flex size-9 items-center justify-center rounded-xl transition-colors [&_svg]:size-4",
                          active
                            ? "bg-[color-mix(in_oklab,var(--primary)_12%,transparent)]"
                            : "hover:bg-accent"
                        )}
                      >
                        <Icon style={{ color: section.accent }} />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right">{section.label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </nav>
          ) : (
            <nav className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
              {SECTIONS.map((section) => (
                <Section
                  key={section.key}
                  def={section}
                  items={history[section.key] ?? []}
                  loaded={history[section.key] !== undefined}
                  open={!!openSections[section.key]}
                  onOpenChange={(open) => toggleSection(section.key, open)}
                  activeHref={activeHref}
                  onMutate={onMutate}
                />
              ))}
            </nav>
          )}
        </div>

        <div className="flex flex-col gap-1 px-3 py-4">
          <div className="mb-1 h-px bg-border" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent",
                  collapsed && "justify-center px-0"
                )}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--primary)_20%,transparent)] text-xs font-semibold text-primary">
                  {userName.slice(0, 1).toUpperCase()}
                </span>
                {!collapsed && (
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {userName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {userEmail}
                    </span>
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            {/* Centered over the account card, lifted above the divider. */}
            <DropdownMenuContent
              side="top"
              align="center"
              sideOffset={14}
              className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-52"
            >
              <DropdownMenuLabel className="truncate">
                {userEmail}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {/* Opens the centered settings modal (settings-dialog.tsx). */}
              <DropdownMenuItem
                onSelect={() => router.push(`${pathname}?settings=preferences`)}
              >
                <Settings /> Settings
              </DropdownMenuItem>
              {/* Plain row, not a menu item: only the pill is interactive,
                  so the row itself never shows a hover highlight. */}
              <div className="flex items-center justify-between px-2.5 py-1.5">
                <span className="text-sm">Theme</span>
                <ThemeToggle />
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive [&_svg]:text-destructive"
                onSelect={onSignOut}
              >
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </TooltipProvider>
  );
}
