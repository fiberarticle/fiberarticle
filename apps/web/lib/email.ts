import { Resend } from "resend";

import type { RenderedEmail } from "@/lib/emails";
import {
  LOGO_BASE64,
  LOGO_CID,
  LOGO_CONTENT_TYPE,
  LOGO_FILENAME,
} from "@/lib/emails/logo";

const resendKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? "Fiberarticle <noreply@fiberarticle.com>";

const resend = resendKey ? new Resend(resendKey) : null;

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail({ to, subject, text, html }: SendEmailOptions) {
  if (!resend) {
    // Development fallback: no Resend key configured, log instead of sending.
    console.log(
      `\n[Fiberarticle mail dev-fallback]\nTo: ${to}\nSubject: ${subject}\n${text}\n`
    );
    return;
  }
  // The templates reference the logo as `cid:...` rather than a URL, so the
  // bytes have to travel with the message. Attached only when the markup
  // actually asks for it, so a plain-text send stays plain.
  const needsLogo = !!html && html.includes(`cid:${LOGO_CID}`);

  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    text,
    ...(html ? { html } : {}),
    ...(needsLogo
      ? {
          attachments: [
            {
              content: Buffer.from(LOGO_BASE64, "base64"),
              filename: LOGO_FILENAME,
              contentType: LOGO_CONTENT_TYPE,
              inlineContentId: LOGO_CID,
            },
          ],
        }
      : {}),
  });
  if (error) {
    console.error(`[Fiberarticle mail] failed to send to ${to}: ${error.message}`);
    throw new Error("Failed to send email");
  }
}

/** Sends a rendered template. Failures propagate: the caller is an auth flow
 * that should surface "we could not send the email" to the user. */
export async function sendRendered(
  to: string,
  email: RenderedEmail
): Promise<void> {
  await sendEmail({ to, ...email });
}

/**
 * Sends a rendered template, swallowing any failure.
 *
 * For courtesy mail that must never break the request that triggered it: a
 * dead mail provider should not fail a signup or a password change that has
 * already been committed.
 */
export async function sendRenderedQuietly(
  to: string,
  email: RenderedEmail
): Promise<void> {
  try {
    await sendRendered(to, email);
  } catch (err) {
    console.error(
      `[Fiberarticle mail] non-fatal send failure to ${to}:`,
      err instanceof Error ? err.message : err
    );
  }
}
