"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

/**
 * Tells PostHog who is signed in, so events, replays, errors, survey answers
 * and support chats are filed under the account instead of an anonymous
 * visitor. Rendered by the (app) layout, which knows the user on the server.
 * The id is the Better Auth user id, the same one the API uses for its own
 * events and AI calls.
 */
export function PostHogIdentify({
  userId,
  email,
  name,
  access,
  role,
}: {
  userId: string;
  email: string;
  name: string;
  access: string;
  role: string;
}) {
  useEffect(() => {
    // Not loaded when no project token is set (local development).
    if (!posthog.__loaded) return;
    posthog.identify(userId, { email, name, access, role });
  }, [userId, email, name, access, role]);

  return null;
}
