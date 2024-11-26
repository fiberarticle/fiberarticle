import { Resend } from "resend";

import type { RenderedEmail } from "@/lib/emails";
import {
  LOGO_BASE64,
  LOGO_CID,
  LOGO_CONTENT_TYPE,
  LOGO_FILENAME,
} from "@/lib/emails/logo";
import {
  WORDMARK_BASE64,
  WORDMARK_CID,
  WORDMARK_CONTENT_TYPE,
  WORDMARK_FILENAME,
} from "@/lib/emails/wordmark";

const resendKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? "Fiberarticle <noreply@fiberarticle.com>";

const resend = resendKey ? new Resend(resendKey) : null;

/**
 * Images the templates reference as `cid:...` rather than as a URL, so the
 * bytes travel with the message. Only the ones a given message actually asks
 * for are attached: a plain-text send stays plain, and the pricing quotation
 * does not carry the transactional header mark it never shows.
 */
const INLINE_IMAGES = [
  {
    cid: LOGO_CID,
    base64: LOGO_BASE64,
    filename: LOGO_FILENAME,
    contentType: LOGO_CONTENT_TYPE,
  },
  {
    cid: WORDMARK_CID,
    base64: WORDMARK_BASE64,
    filename: WORDMARK_FILENAME,
    contentType: WORDMARK_CONTENT_TYPE,
  },
] as const;

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
  const attachments = INLINE_IMAGES.filter(
    (image) => !!html && html.includes(`cid:${image.cid}`)
  ).map((image) => ({
    content: Buffer.from(image.base64, "base64"),
    filename: image.filename,
    contentType: image.contentType,
    inlineContentId: image.cid,
  }));

  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    text,
    ...(html ? { html } : {}),
    ...(attachments.length ? { attachments } : {}),
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
