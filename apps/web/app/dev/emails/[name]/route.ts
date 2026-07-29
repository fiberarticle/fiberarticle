import {
  passwordChangedEmail,
  passwordResetEmail,
  verifyEmail,
  welcomeEmail,
  type RenderedEmail,
} from "@/lib/emails";
import {
  LOGO_BASE64,
  LOGO_CID,
  LOGO_CONTENT_TYPE,
} from "@/lib/emails/logo";

/**
 * Development preview for the transactional emails.
 *
 * Iterating on 14 KB of table markup by sending real mail is slow and burns
 * Resend quota, so each template renders here with sample data instead.
 * Append ?format=text to read the plain-text twin.
 *
 * Disabled outside development: these pages expose nothing sensitive, but a
 * production route that renders account-shaped mail is a phishing asset.
 */

const SAMPLE_DATE = new Date("2026-07-29T15:44:00.000Z");

const SAMPLES: Record<string, () => RenderedEmail> = {
  welcome: () => welcomeEmail({ firstName: "Abdul" }),
  "verify-email": () =>
    verifyEmail({
      email: "abdulateeb5932@gmail.com",
      code: "482913",
      expiresInMinutes: 10,
    }),
  "password-reset": () =>
    passwordResetEmail({
      email: "abdulateeb5932@gmail.com",
      resetUrl:
        "http://localhost:3000/reset-password?token=EXAMPLE_TOKEN_VALUE_1234567890",
      requestedAt: SAMPLE_DATE,
      expiresAt: new Date(SAMPLE_DATE.getTime() + 60 * 60 * 1000),
      device: "Chrome on Windows",
    }),
  "password-changed": () =>
    passwordChangedEmail({
      email: "abdulateeb5932@gmail.com",
      changedAt: SAMPLE_DATE,
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
  const build = SAMPLES[name];
  if (!build) {
    return new Response(
      `Unknown template "${name}". Available: ${Object.keys(SAMPLES).join(", ")}`,
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  const email = build();
  const format = new URL(request.url).searchParams.get("format");
  if (format === "text") {
    return new Response(`Subject: ${email.subject}\n\n${email.text}`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // A browser cannot resolve the cid: reference that a real client resolves
  // against the inline attachment, so the preview inlines the same bytes as a
  // data URI. Everything else is byte-for-byte what gets sent.
  const previewHtml = email.html.replace(
    `cid:${LOGO_CID}`,
    `data:${LOGO_CONTENT_TYPE};base64,${LOGO_BASE64}`
  );

  return new Response(previewHtml, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
