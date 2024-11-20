import {
  appUrl,
  button,
  esc,
  eyebrow,
  headline,
  notice,
  otpTiles,
  paragraph,
  renderShell,
  urlPanel,
  type RenderedEmail,
} from "./shell";

export interface VerifyEmailProps {
  /** Address being verified; also carried in the one click link. */
  email: string;
  /** Six digit code from the emailOTP plugin. */
  code: string;
  /** Lifetime of the code, in whole minutes. */
  expiresInMinutes: number;
}

/**
 * Email verification. The code is the primary path; the link is the same code
 * pre-filled on /verify-email, so both halves of the message verify the same
 * one time value rather than two independent tokens.
 */
export function verifyEmail({
  email,
  code,
  expiresInMinutes,
}: VerifyEmailProps): RenderedEmail {
  const url = `${appUrl()}/verify-email?email=${encodeURIComponent(
    email
  )}&code=${encodeURIComponent(code)}`;

  const rows = [
    eyebrow("Verify email"),
    headline("Confirm your email address"),
    paragraph(
      `Enter this six digit code in Fiberarticle to verify that this address belongs to you. The code expires in ${esc(
        String(expiresInMinutes)
      )} minutes and can be used once.`
    ),
    otpTiles(code),
    paragraph(
      "If the code will not go through, verify with this link instead:",
      30
    ),
    button(url, "Verify email address", "primary", 18),
    urlPanel(url),
    notice(
      "If this was not you",
      `Someone may have typed your address by mistake. You can ignore this message, and the code stops working on its own in ${esc(
        String(expiresInMinutes)
      )} minutes. No account is created or changed until the address is verified.`
    ),
  ].join("\n");

  return {
    subject: `Your Fiberarticle verification code: ${code}`,
    html: renderShell({
      title: `Your Fiberarticle verification code: ${code}`,
      preheader: `Your six digit code is ${code}. It expires in ${expiresInMinutes} minutes.`,
      headerTag: "Verify email",
      rows,
    }),
    text: [
      "Confirm your email address.",
      "",
      `Your Fiberarticle verification code is ${code}.`,
      `It expires in ${expiresInMinutes} minutes and can be used once.`,
      "",
      `Or verify with this link: ${url}`,
      "",
      "If this was not you, ignore this message. The code stops working on its own, and no account is created or changed until the address is verified.",
    ].join("\n"),
  };
}
