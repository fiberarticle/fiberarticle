/**
 * Server-side PostHog events from the web app, sent straight to PostHog's
 * capture endpoint so no extra package is needed. Used where the browser
 * cannot be trusted to report, such as an account being created through
 * Google or Microsoft, which happens during a redirect.
 *
 * Never throws and gives up after 3 seconds: an event is never worth slowing
 * down or failing a sign-up.
 */
const token = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

export async function captureServerEvent(
  distinctId: string,
  event: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  if (!token) return;
  try {
    await fetch(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: token,
        event,
        distinct_id: distinctId,
        properties: { ...properties, $lib: "fiberarticle-web-server" },
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Telemetry only.
  }
}
