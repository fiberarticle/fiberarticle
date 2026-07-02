"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

let cachedToken: string | null = null;
let cachedExpiry = 0;

function decodeJwtExpiry(token: string): number {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    );
    return typeof json.exp === "number" ? json.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export async function getApiToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedExpiry - 30_000) {
    return cachedToken;
  }
  const res = await fetch("/api/auth/token", { credentials: "include" });
  if (!res.ok) {
    throw new Error("Not authenticated");
  }
  const data = (await res.json()) as { token: string };
  cachedToken = data.token;
  cachedExpiry = decodeJwtExpiry(data.token);
  return data.token;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = await getApiToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // keep default message
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}
