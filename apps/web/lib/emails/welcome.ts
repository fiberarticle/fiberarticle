import {
  appUrl,
  button,
  esc,
  eyebrow,
  footnote,
  headline,
  inlineLink,
  numberedSteps,
  paragraph,
  renderShell,
  rule,
  type RenderedEmail,
} from "./shell";

export interface WelcomeEmailProps {
  /** First name only: the greeting reads better than a full name. */
  firstName: string;
}

const STEPS = [
  {
    color: "#FCA91E",
    title: "Choose how you want to run the model",
    body: "Fiberarticle AI needs no setup at all. You can also bring your own key, or point us at a local model you already run.",
  },
  {
    color: "#50C158",
    title: "Start a research run",
    body: "Give the agent a topic or a research question. It searches, screens the results, reads what matters, and reports progress as it goes.",
  },
  {
    color: "#4F90E4",
    title: "Review the sources, then export",
    body: "Every claim is linked to the source it came from. Verify the citations, then export in the format your journal expects.",
  },
];

/** Sent once an account is usable: after verification, or straight away for
 * social sign-ups, which arrive already verified. */
export function welcomeEmail({ firstName }: WelcomeEmailProps): RenderedEmail {
  const url = appUrl();
  const host = url.replace(/^https?:\/\//, "");

  const rows = [
    eyebrow("Account created"),
    headline("Your Fiberarticle account is ready"),
    paragraph(
      `Hello ${esc(
        firstName
      )}, your signup is complete. Fiberarticle searches the literature, screens what it finds, and drafts publication ready papers with citations you can check line by line.`
    ),
    rule(30, 26),
    // Section label: same treatment as the eyebrow, with room under it for
    // the numbered list that follows.
    `<tr><td class="sh d-accent" style="padding:0 44px 20px 44px;font-family:'Bricolage Grotesque','Helvetica Neue',Helvetica,Arial,'Segoe UI',Roboto,sans-serif;font-size:11px;line-height:15px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#8A4A03;">Three steps to your first draft</td></tr>`,
    numberedSteps(STEPS),
    button(url, "Start your first run", "primary", 32),
    paragraph(
      "Everything Fiberarticle writes stays tied to the sources it read, so you can open any citation and check it yourself before the paper leaves your hands.",
      30
    ),
    rule(30, 22),
    footnote(
      `You are receiving this because a Fiberarticle account was created for this address at ${inlineLink(
        url,
        host
      )}. This is a one time account notice, not a subscription.`
    ),
  ].join("\n");

  return {
    subject: "Welcome to Fiberarticle",
    html: renderShell({
      title: "Welcome to Fiberarticle",
      preheader:
        "Your account is ready. Three steps to your first research run, inside.",
      headerTag: "Account",
      rows,
    }),
    text: [
      `Hello ${firstName}, your Fiberarticle signup is complete.`,
      "",
      "Fiberarticle searches the literature, screens what it finds, and drafts publication ready papers with citations you can check line by line.",
      "",
      "Three steps to your first draft:",
      ...STEPS.map((step, index) => `${index + 1}. ${step.title}. ${step.body}`),
      "",
      `Start your first run: ${url}`,
      "",
      `You are receiving this because a Fiberarticle account was created for this address at ${host}.`,
    ].join("\n"),
  };
}
