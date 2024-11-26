import type { RenderedEmail } from "./shell";
import { pricingQuotationEmail } from "./pricing";

/**
 * The emails an admin may send by hand from Admin -> Send emails.
 *
 * Deliberately not the same list as lib/emails/index.ts. The transactional
 * templates (verify your email, reset your password, password changed) are
 * absent on purpose: a screen that sends an account-shaped mail to any address
 * on demand is a phishing tool, and those three already have exactly one
 * legitimate trigger each inside the auth flow. Only mail that a person would
 * reasonably send by hand belongs here.
 *
 * Adding a second one is a single entry: write the template module, import it,
 * and push it onto this list. The API and the screen both read the list, so
 * nothing else has to change.
 */
export interface Campaign {
  /** Used in the URL, so keep it lowercase with hyphens. */
  slug: string;
  name: string;
  /** One line, shown under the name in the picker. */
  description: string;
  build: () => RenderedEmail;
}

export const CAMPAIGNS: Campaign[] = [
  {
    slug: "pricing",
    name: "Pricing quotation",
    description:
      "Price per deliverable in rupees, the two payment stages, and the note about who pays the APC.",
    build: pricingQuotationEmail,
  },
];

export function findCampaign(slug: string): Campaign | undefined {
  return CAMPAIGNS.find((campaign) => campaign.slug === slug);
}

/** Shape sent to the browser: the picker needs to describe each mail, but the
 * build function itself must never leave the server. */
export interface CampaignSummary {
  slug: string;
  name: string;
  description: string;
  subject: string;
}

export function campaignSummaries(): CampaignSummary[] {
  return CAMPAIGNS.map(({ slug, name, description, build }) => ({
    slug,
    name,
    description,
    subject: build().subject,
  }));
}
