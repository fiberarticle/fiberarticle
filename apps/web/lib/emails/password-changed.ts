import {
  appUrl,
  button,
  detailPanel,
  eyebrow,
  formatWhen,
  headline,
  notice,
  paragraph,
  renderShell,
  rule,
  strong,
  type RenderedEmail,
} from "./shell";

export interface PasswordChangedEmailProps {
  /** Account whose password changed. */
  email: string;
  /** When the change landed. */
  changedAt: Date;
  /** Human label for the client that made the change. */
  device: string;
}

/** Security notice, sent after both /change-password and a completed reset. */
export function passwordChangedEmail({
  email,
  changedAt,
  device,
}: PasswordChangedEmailProps): RenderedEmail {
  const forgotUrl = `${appUrl()}/forgot-password`;

  const rows = [
    eyebrow("Security notice"),
    headline("Your password was changed"),
    paragraph(
      `The password for the account registered to ${strong(
        email
      )} was changed a few moments ago. Every other session was signed out, so you will need to sign in again on your other devices.`
    ),
    detailPanel("What happened", [
      ["Event", "Password changed"],
      ["Changed at", formatWhen(changedAt)],
      ["Device", device],
    ]),
    notice(
      "If you did not do this",
      "Reset your password straight away with the button below. Doing that signs out every other session automatically. Use a device you trust, and choose a password you have not used elsewhere.",
      "alert"
    ),
    button(forgotUrl, "Reset your password", "secondary", 28),
    rule(30, 24),
    paragraph(
      "No further action is needed if you made this change yourself. Fiberarticle will never ask you for your password or an API key by email.",
      0
    ),
  ].join("\n");

  return {
    subject: "Your Fiberarticle password was changed",
    html: renderShell({
      title: "Your Fiberarticle password was changed",
      preheader:
        "The password on your account was changed. Read this if it was not you.",
      headerTag: "Security notice",
      rows,
    }),
    text: [
      `The password for the Fiberarticle account registered to ${email} was changed a few moments ago.`,
      "Every other session was signed out, so you will need to sign in again on your other devices.",
      "",
      "Event: Password changed",
      `Changed at: ${formatWhen(changedAt)}`,
      `Device: ${device}`,
      "",
      `If you did not do this, reset your password straight away: ${forgotUrl}`,
      "",
      "Fiberarticle will never ask you for your password or an API key by email.",
    ].join("\n"),
  };
}
