import posthog from "posthog-js";

/*
 * PostHog for the whole app, loaded by Next.js before the app starts in the
 * browser: product analytics, session replay, error tracking, surveys and the
 * support chat widget. Nothing loads when no project token is set, so local
 * development stays untracked.
 *
 * Users are identified in components/posthog-identify.tsx once they are
 * signed in, and forgotten on sign out (posthog.reset()).
 */
const token = process.env.NEXT_PUBLIC_POSTHOG_KEY;

// The API's host name, so PostHog's tracing headers (X-POSTHOG-DISTINCT-ID
// and X-POSTHOG-SESSION-ID) go along with API calls and the API can file its
// errors and AI calls under the same person and session replay.
function apiHost(): string[] {
  try {
    return [new URL(process.env.NEXT_PUBLIC_API_URL ?? "").hostname];
  } catch {
    return [];
  }
}

if (token) {
  posthog.init(token, {
    // Caddy on the server relays /relay/* to PostHog US Cloud, so blockers
    // that drop requests to posthog.com do not drop ours.
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "/relay",
    ui_host: "https://us.posthog.com",
    defaults: "2026-08-30",
    capture_exceptions: true,
    // Replays show what was typed, except passwords, which PostHog always
    // hides. The privacy policy on fiberarticle.com says so.
    session_recording: { maskAllInputs: false },
    tracing_headers: apiHost(),
    conversations: {
      theme: {
        colorScheme: "auto",
        primary: "#9a6b45",
        dark: { primary: "#c09468" },
      },
    },
  });
}
