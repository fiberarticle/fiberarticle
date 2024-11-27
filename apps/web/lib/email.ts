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

/**
 * The address a quotation comes from.
 *
 * Account mail keeps noreply: a password reset should not invite a reply. A
 * price list is the opposite. It is written to a person who asked for it and
 * who is meant to write back, and a no-reply sender on commercial mail is a
 * signal filters weigh against you. Set EMAIL_FROM_CAMPAIGN to change it.
 */
const campaignFrom =
  process.env.EMAIL_FROM_CAMPAIGN ?? "Fiberarticle <admin@fiberarticle.com>";

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
] as const;

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Overrides the account sender. Only the campaign path sets this. */
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
  from: fromOverride,
  replyTo,
  headers,
}: SendEmailOptions) {
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
    from: fromOverride ?? from,
    to,
    subject,
    text,
    ...(html ? { html } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(headers ? { headers } : {}),
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
 * Sends one of the Admin -> Send emails messages.
 *
 * Differs from account mail in three ways, all of them about how a mail
 * provider reads commercial post. It comes from a mailbox a person can answer,
 * it says so again in Reply-To, and it carries the unsubscribe headers Gmail
 * looks for on anything that resembles bulk. The unsubscribe is a mailto
 * rather than a link, which needs no page and no list to maintain: a reader
 * writes, and we stop.
 */
export async function sendCampaign(
  to: string,
  email: RenderedEmail,
  replyTo = "admin@fiberarticle.com"
): Promise<void> {
  await sendEmail({
    to,
    ...email,
    from: campaignFrom,
    replyTo,
    headers: {
      "List-Unsubscribe": `<mailto:${replyTo}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
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
