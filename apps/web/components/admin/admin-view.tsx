"use client";

/**
 * The Admin page.
 *
 * Two halves: a set of numbers and charts at the top, and the list of everyone
 * below it. Clicking a person opens the side panel where the actual changes
 * happen (user-sheet.tsx).
 *
 * Layout notes, since this has to work on a phone as well as a wide screen:
 *   - the number cards go two across on a phone and four across from tablet up
 *   - the charts stack on a phone and sit two across from large screens
 *   - the people list becomes cards on a phone, because a table with eight
 *     columns cannot be read on a 390px screen no matter how it is styled.
 *     From tablet up it is a real table with the header staying put while the
 *     rows scroll
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  DayColumns,
  NamedBars,
  StatTile,
  aiModeColor,
  runStatusColor,
  runStatusLabel,
} from "@/components/admin/charts";
import { UserSheet } from "@/components/admin/user-sheet";
import {
  type AdminUserRow,
  type Overview,
  type SortKey,
  aiModeLabel,
  getOverview,
  getUsers,
  shortDate,
  timeAgo,
} from "@/lib/admin";

const PAGE_SIZE = 50;

const SORT_LABEL: Record<SortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "Name A to Z",
  email: "Email A to Z",
  runs: "Most research",
};

function PersonBadges({ user }: { user: AdminUserRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {user.role === "admin" ? (
        <Badge variant="primary">
          <ShieldCheck className="mr-1 size-3" /> Admin
        </Badge>
      ) : null}
      {user.email_verified ? null : (
        <Badge variant="warning">Email not confirmed</Badge>
      )}
      {user.active_sessions > 0 ? (
        <Badge variant="success">Signed in</Badge>
      ) : null}
    </span>
  );
}

export function AdminView({ meId }: { meId: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [page, setPage] = useState(0);
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  // The search box fires on every keystroke, so the request waits until typing
  // pauses. Without this a ten letter name is ten calls to the server.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Guards against an older, slower request landing after a newer one and
  // overwriting the list with stale rows.
  const requestRef = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      const ticket = ++requestRef.current;
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [ov, list] = await Promise.all([
          getOverview(),
          getUsers({
            search: debounced,
            sort,
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
          }),
        ]);
        if (ticket !== requestRef.current) return;
        setOverview(ov);
        setUsers(list.users);
        setTotal(list.total);
      } catch (e) {
        if (ticket !== requestRef.current) return;
        setError(
          e instanceof Error ? e.message : "Could not load the admin page"
        );
      } finally {
        if (ticket === requestRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [debounced, sort, page]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min(total, (page + 1) * PAGE_SIZE);

  const aiChart = useMemo(
    () => overview?.users_by_ai_mode ?? [],
    [overview]
  );

  if (loading && !overview) {
    return (
      <p className="flex items-center gap-2 py-20 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading the admin page
      </p>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone who has signed up, and everything they are doing.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(true)}
          disabled={refreshing}
        >
          <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </header>

      {error ? (
        <p className="flex items-center gap-2 rounded-xl border border-border bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" /> {error}
        </p>
      ) : null}

      {overview ? (
        <>
          <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile
              label="People signed up"
              value={overview.total_users}
              hint="Everyone who has ever registered"
            />
            <StatTile
              label="Signed in right now"
              value={overview.users_with_live_session}
              hint="Have a live session open"
            />
            <StatTile
              label="Email confirmed"
              value={overview.verified_users}
              hint={`${overview.unverified_users} still to confirm`}
              tone={overview.unverified_users > 0 ? "warn" : "good"}
            />
            <StatTile
              label="Admins"
              value={overview.admin_users}
              hint="Can open this page"
            />
          </section>

          <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile label="Research runs" value={overview.total_runs} />
            <StatTile label="Articles written" value={overview.total_documents} />
            <StatTile label="Papers collected" value={overview.total_papers} />
            <StatTile
              label="Runs that failed"
              value={overview.runs_failed}
              hint={
                overview.runs_running > 0
                  ? `${overview.runs_running} running now`
                  : "None running now"
              }
              tone={overview.runs_failed > 0 ? "bad" : "good"}
            />
          </section>

          <section className="grid gap-3 sm:gap-4 lg:grid-cols-2">
            <DayColumns
              title="New people each day"
              data={overview.signups_by_day}
            />
            <DayColumns
              title="Research runs each day"
              data={overview.runs_by_day}
            />
            <NamedBars
              title="Which AI people use"
              note="Anyone who has never changed it counts as Fiberarticle AI"
              data={aiChart}
              colorFor={aiModeColor}
              labelFor={aiModeLabel}
            />
            <NamedBars
              title="How research runs ended"
              data={overview.runs_by_status}
              colorFor={runStatusColor}
              labelFor={runStatusLabel}
            />
          </section>
        </>
      ) : null}

      <section className="rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="text-sm font-semibold sm:text-base">
              Everyone who signed up
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {total === 0
                ? "Nobody yet"
                : `Showing ${showingFrom} to ${showingTo} of ${total}`}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email"
                className="pl-9 sm:w-56"
              />
            </div>
            <Select.Root
              value={sort}
              onValueChange={(v) => {
                setSort(v as SortKey);
                setPage(0);
              }}
            >
              <Select.Trigger className="sm:w-44">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {Object.entries(SORT_LABEL).map(([value, label]) => (
                  <Select.Item key={value} value={value}>
                    {label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </div>
        </div>

        {users.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground sm:px-5">
            {debounced
              ? `Nobody matches "${debounced}".`
              : "No one has signed up yet."}
          </p>
        ) : (
          <>
            {/* Phone: one card per person. A wide table cannot be read here. */}
            <ul className="flex flex-col divide-y divide-border md:hidden">
              {users.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setOpenUserId(u.id)}
                    className="w-full px-4 py-3.5 text-left transition-colors hover:bg-accent"
                  >
                    <span className="flex items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--primary)_18%,transparent)] text-sm font-semibold text-primary">
                        {u.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {u.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {u.email}
                        </span>
                      </span>
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-1.5">
                      <PersonBadges user={u} />
                      <Badge variant="outline">{aiModeLabel(u.ai_mode)}</Badge>
                      <Badge variant="outline">
                        {u.run_count} research
                      </Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {/* Tablet and up: a real table. Only this box scrolls sideways, so
                the page itself never does. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[52rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Person</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 font-medium">AI they use</th>
                    <th className="px-3 py-3 text-right font-medium">
                      Research
                    </th>
                    <th className="px-3 py-3 text-right font-medium">
                      Articles
                    </th>
                    <th className="px-3 py-3 font-medium">Joined</th>
                    <th className="px-5 py-3 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      onClick={() => setOpenUserId(u.id)}
                      className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-accent"
                    >
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-3">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--primary)_18%,transparent)] text-xs font-semibold text-primary">
                            {u.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {u.name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {u.email}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <PersonBadges user={u} />
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className="size-2.5 shrink-0 rounded-full"
                            style={{
                              background: aiModeColor(
                                u.ai_mode ?? "fiberarticle_ai"
                              ),
                            }}
                          />
                          {aiModeLabel(u.ai_mode)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {u.run_count}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {u.document_count}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                        {shortDate(u.created_at)}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">
                        {timeAgo(u.last_seen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {pageCount > 1 ? (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Back
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </section>

      <p className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
        <UserRound className="size-3.5" />
        Only people marked as admin can open this page. Everyone else is shown
        Page not found.
      </p>

      {openUserId ? (
        <UserSheet
          userId={openUserId}
          isSelf={openUserId === meId}
          onClose={() => setOpenUserId(null)}
          onChanged={() => void load(true)}
        />
      ) : null}
    </div>
  );
}
