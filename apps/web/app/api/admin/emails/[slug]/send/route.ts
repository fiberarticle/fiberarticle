import { sendRendered } from "@/lib/email";
import { currentAdmin } from "@/lib/admin-server";
import { findCampaign } from "@/lib/emails/catalog";

/**
 * Sends one of the catalog emails to one address.
 *
 * POST /api/admin/emails/<slug>/send   body: { "to": "someone@example.com" }
 *
 * Admin only, and the check is here rather than only on the page: the page
 * hiding the form stops nobody who can type a URL.
 */

// Same shape the API uses for the one address an admin edits by hand. It is
// there to catch a typo, not to decide what RFC 5322 permits; the mail either
// arrives or it bounces, and both are visible.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const admin = await currentAdmin();
  if (!admin) return json({ error: "Not found" }, 404);

  const { slug } = await params;
  const campaign = findCampaign(slug);
  if (!campaign) return json({ error: "Not found" }, 404);

  let to: unknown;
  try {
    ({ to } = (await request.json()) as { to?: unknown });
  } catch {
    return json({ error: "Send that as JSON" }, 400);
  }

  const address = typeof to === "string" ? to.trim() : "";
  if (!EMAIL_RE.test(address)) {
    return json({ error: "That does not look like an email address" }, 400);
  }

  // Without a key, sendEmail quietly logs to the console and returns as if it
  // had sent. That fallback is right for a signup on a dev machine and wrong
  // here: the screen would report a delivered quotation that never left.
  if (!process.env.RESEND_API_KEY) {
    return json(
      {
        error:
          "No mail key is configured on this server, so nothing was sent. Set RESEND_API_KEY and try again.",
      },
      503
    );
  }

  const email = campaign.build();
  try {
    await sendRendered(address, email);
  } catch {
    // sendRendered already logged the provider's own message.
    return json(
      { error: `Resend refused the message to ${address}. Nothing was sent.` },
      502
    );
  }

  // Who sent what to whom. The provider dashboard shows the message but not
  // which admin pressed the button, and this is the only record of that.
  console.log(
    `[Fiberarticle mail] admin ${admin.email} sent "${campaign.slug}" to ${address}`
  );

  return json({ ok: true, to: address, subject: email.subject });
}
