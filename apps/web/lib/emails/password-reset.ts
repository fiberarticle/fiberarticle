import {
  button,
  detailPanel,
  eyebrow,
  formatWhen,
  headline,
  notice,
  paragraph,
  renderShell,
  strong,
  urlPanel,
  type RenderedEmail,
} from "./shell";

export interface PasswordResetEmailProps {
  /** Account the reset was requested for. */
  email: string;
  /** Better Auth callback URL carrying the one time token. */
  resetUrl: string;
  /** When the request came in. */
  requestedAt: Date;
  /** When the token stops working. */
  expiresAt: Date;
  /** Human label for the requesting client, from its User-Agent. */
  device: string;
}

export function passwordResetEmail({
  email,
  resetUrl,
  requestedAt,
  expiresAt,
  device,
}: PasswordResetEmailProps): RenderedEmail {
  const rows = [
    eyebrow("Password reset"),
    headline("Reset your Fiberarticle password"),
    paragraph(
      `A password reset was requested for the account registered to ${strong(
        email
      )}. The link below works once, and it expires 60 minutes after this message was sent.`
    ),
    button(resetUrl, "Choose a new password"),
    paragraph(
      "If the button does not open, copy this address into your browser:",
      26
    ),
    urlPanel(resetUrl),
    detailPanel("Request details", [
      ["Requested", formatWhen(requestedAt)],
      ["Expires", formatWhen(expiresAt)],
      ["Device", device],
    ]),
    notice(
      "If you did not request this",
      "Nothing has changed yet, and your current password still works. Ignore this message and the link will expire by itself. If these arrive often, someone may know your address, so consider changing your password in Settings, then Account.",
      "alert"
    ),
  ].join("\n");

  return {
    subject: "Reset your Fiberarticle password",
    html: renderShell({
      title: "Reset your Fiberarticle password",
      preheader: "Your reset link works once and expires in 60 minutes.",
      headerTag: "Password reset",
      rows,
    }),
    text: [
      `A password reset was requested for the Fiberarticle account registered to ${email}.`,
      "The link below works once, and it expires 60 minutes after this message was sent.",
      "",
      resetUrl,
      "",
      `Requested: ${formatWhen(requestedAt)}`,
      `Expires: ${formatWhen(expiresAt)}`,
      `Device: ${device}`,
      "",
      "If you did not request this, nothing has changed and your current password still works. Ignore this message and the link will expire by itself.",
    ].join("\n"),
  };
}
