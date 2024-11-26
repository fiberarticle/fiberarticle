import { headers } from "next/headers";

import { auth } from "@/lib/auth";

/**
 * Server-side admin gate for the Next route handlers.
 *
 * The FastAPI side has its own gate (security.AdminUser, which reads the role
 * out of the signed token). This is the equivalent for the handful of routes
 * that have to run inside Next instead, because they need something only Next
 * holds: the Resend key and the email template modules.
 *
 * Returns null rather than throwing so each caller decides its own failure
 * shape: JSON for the send route, plain text for the preview.
 */
export async function currentAdmin(): Promise<{
  id: string;
  email: string;
} | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  if ((session.user as { role?: string }).role !== "admin") return null;
  return { id: session.user.id, email: session.user.email };
}
