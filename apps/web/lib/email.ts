import { Resend } from "resend";

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
  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    text,
    ...(html ? { html } : {}),
  });
  if (error) {
    console.error(`[Fiberarticle mail] failed to send to ${to}: ${error.message}`);
    throw new Error("Failed to send email");
  }
}
