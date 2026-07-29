import { sendRendered } from "@/lib/email";
import {
  passwordChangedEmail,
  passwordResetEmail,
  verifyEmail,
  welcomeEmail,
  type RenderedEmail,
} from "@/lib/emails";

/**
 * Development-only: send one template to a real inbox.
 *
 * Some templates cannot be triggered through their real hook without a
 * destructive side effect (welcome needs a fresh verification, password
 * changed needs an actual password change), so this exists to inspect them
 * in a real mail client. It renders exactly what the hook would render.
 *
 * GET /dev/emails/<name>/send?to=someone@example.com
 */

const SAMPLES: Record<string, (to: string) => RenderedEmail> = {
  welcome: () => welcomeEmail({ firstName: "Abdul" }),
  "verify-email": (to) =>
    verifyEmail({ email: to, code: "482913", expiresInMinutes: 10 }),
  "password-reset": (to) => {
    const now = new Date();
    return passwordResetEmail({
      email: to,
      resetUrl: "http://localhost:3000/reset-password?token=EXAMPLE_TOKEN",
      requestedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      device: "Chrome on Windows",
    });
  },
  "password-changed": (to) =>
    passwordChangedEmail({
      email: to,
      changedAt: new Date(),
      device: "Chrome on Windows",
    }),
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const { name } = await params;
  const to = new URL(request.url).searchParams.get("to");
  if (!to) {
    return new Response("Add ?to=<address>", { status: 400 });
  }
  const build = SAMPLES[name];
  if (!build) {
    return new Response(
      `Unknown template "${name}". Available: ${Object.keys(SAMPLES).join(", ")}`,
      { status: 404 }
    );
  }

  try {
    await sendRendered(to, build(to));
    return new Response(`sent "${name}" to ${to}`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    return new Response(
      `send failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}
