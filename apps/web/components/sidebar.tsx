"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpenCheck,
  FileText,
  Home,
  Library,
  LogOut,
  MessageSquareText,
  PanelLeft,
  Search,
  Settings,
  SquarePen,
  Table2,
} from "lucide-react";
import { Wordmark, FiberMark } from "@/components/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/ask", label: "Ask", icon: Search },
  { href: "/review", label: "Literature review", icon: BookOpenCheck },
  { href: "/assistant", label: "Assistant", icon: MessageSquareText },
  { href: "/library", label: "Library", icon: Library },
  { href: "/extract", label: "Extract", icon: Table2 },
  { href: "/documents", label: "Articles", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({
  userName,
  userEmail,
}: {
  userName: string;
  userEmail: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(false);

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
          collapsed ? "w-14" : "w-60"
        )}
      >
        <div className="flex flex-col gap-4 px-3 py-4">
          <div
            className={cn(
              "flex items-center",
              collapsed ? "justify-center" : "justify-between pl-1"
            )}
          >
            {collapsed ? (
              <Link href="/dashboard" aria-label="Fiberarticle">
                <FiberMark />
              </Link>
            ) : (
              <Wordmark href="/dashboard" />
            )}
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Collapse sidebar"
                onClick={() => setCollapsed(true)}
              >
                <PanelLeft />
              </Button>
            )}
          </div>

          {collapsed && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Expand sidebar"
              className="mx-auto"
              onClick={() => setCollapsed(false)}
            >
              <PanelLeft className="rotate-180" />
            </Button>
          )}

          <Link href="/dashboard" className={cn(collapsed && "mx-auto")}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="secondary" size="icon-sm" aria-label="New research">
                    <SquarePen />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">New research</TooltipContent>
              </Tooltip>
            ) : (
              <Button variant="secondary" className="w-full justify-start">
                <SquarePen />
                New research
              </Button>
            )}
          </Link>

          <nav className="flex flex-col gap-0.5">
            {navItems.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              const link = (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors [&_svg]:size-4",
                    collapsed && "justify-center px-0",
                    active
                      ? "bg-[color-mix(in_oklab,var(--primary)_12%,transparent)] font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Icon />
                  {!collapsed && item.label}
                </Link>
              );
              return collapsed ? (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              ) : (
                link
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-2 px-3 py-4">
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
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel className="truncate">
                {userEmail}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings /> Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Theme</span>
                  <ThemeToggle />
                </div>
              </DropdownMenuItem>
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
