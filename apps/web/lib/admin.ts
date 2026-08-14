"use client";

/**
 * Everything the Admin page sends and receives.
 *
 * All of it goes through apiFetch, which attaches the signed token. The API
 * checks the role on that token for every one of these paths, so nothing here
 * is trusted just because this file only runs on an admin's screen.
 */

import { apiFetch } from "@/lib/api";

export type AiMode = "fiberarticle_ai" | "byok" | "local";

export type CountPoint = { label: string; value: number };

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  role: "user" | "admin";
  image: string | null;
  created_at: string;
  ai_mode: AiMode | null;
  ai_provider: string | null;
  ai_model: string | null;
  has_key: boolean;
  reasoning: boolean;
  run_count: number;
  document_count: number;
  paper_count: number;
  active_sessions: number;
  last_seen: string | null;
};

export type Overview = {
  total_users: number;
  verified_users: number;
  unverified_users: number;
  admin_users: number;
  users_with_live_session: number;
  total_runs: number;
  total_documents: number;
  total_papers: number;
  runs_running: number;
  runs_failed: number;
  signups_by_day: CountPoint[];
  users_by_ai_mode: CountPoint[];
  runs_by_day: CountPoint[];
  runs_by_status: CountPoint[];
};

export type AdminSession = {
  id: string;
  createdAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  live: boolean;
};

export type AdminAccount = {
  id: string;
  providerId: string;
  createdAt: string;
  has_password: boolean;
};

export type WorkItem = {
  id: string;
  kind: string;
  title: string;
  status: string | null;
  created_at: string;
};

export type UserDetail = {
  user: AdminUserRow;
  sessions: AdminSession[];
  accounts: AdminAccount[];
  work: WorkItem[];
};

export type SortKey = "newest" | "oldest" | "name" | "email" | "runs";

/** Plain words for the three AI choices. The stored values are technical. */
export const AI_MODE_LABEL: Record<string, string> = {
  fiberarticle_ai: "Fiberarticle AI",
  byok: "Their own key",
  local: "Their own computer",
};

export function aiModeLabel(mode: string | null): string {
  if (!mode) return "Fiberarticle AI";
  return AI_MODE_LABEL[mode] ?? mode;
}

export const getOverview = () => apiFetch<Overview>("/v1/admin/overview");

export function getUsers(params: {
  search?: string;
  sort?: SortKey;
  limit?: number;
  offset?: number;
}) {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.sort) q.set("sort", params.sort);
  q.set("limit", String(params.limit ?? 50));
  q.set("offset", String(params.offset ?? 0));
  return apiFetch<{ users: AdminUserRow[]; total: number }>(
    `/v1/admin/users?${q.toString()}`
  );
}

export const getUser = (id: string) =>
  apiFetch<UserDetail>(`/v1/admin/users/${id}`);

type Ok = { ok: boolean; message: string };

export const patchUser = (
  id: string,
  body: Partial<{
    name: string;
    email: string;
    email_verified: boolean;
    role: "user" | "admin";
  }>
) =>
  apiFetch<Ok>(`/v1/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const signOutUser = (id: string) =>
  apiFetch<Ok>(`/v1/admin/users/${id}/sign-out`, { method: "POST" });

export const deleteUser = (id: string) =>
  apiFetch<Ok>(`/v1/admin/users/${id}`, { method: "DELETE" });

export const patchUserAi = (
  id: string,
  body: {
    mode: AiMode;
    provider?: string | null;
    model?: string | null;
    base_url?: string | null;
    reasoning?: boolean;
  }
) =>
  apiFetch<Ok>(`/v1/admin/users/${id}/ai`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteUserAiKey = (id: string) =>
  apiFetch<Ok>(`/v1/admin/users/${id}/ai-key`, { method: "DELETE" });

/** kind is one of run, document, extraction, conversation. */
export const deleteWork = (kind: string, id: string) =>
  apiFetch<Ok>(`/v1/admin/work/${kind}/${id}`, { method: "DELETE" });

/** "3 Sep 2026" rather than a machine timestamp. */
export function shortDate(value: string | null): string {
  if (!value) return "Never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "2 hours ago". Falls back to the date once it stops being useful. */
export function timeAgo(value: string | null): string {
  if (!value) return "Never";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "Unknown";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return shortDate(value);
}
