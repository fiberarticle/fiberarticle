import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { SendEmailView } from "@/components/admin/send-email-view";
import { campaignSummaries } from "@/lib/emails/catalog";

export const metadata = { title: "Send emails" };

/**
 * Admin -> Send emails.
 *
 * Gated exactly like /admin: checked on the server before anything reaches the
 * browser, and notFound rather than a refusal screen so a signed-in user who is
 * not an admin cannot tell the page exists. The two routes behind it repeat the
 * check, because a hidden page stops nobody who can type a URL.
 *
 * The catalogue is read here and handed down as plain data. Only the name,
 * description and subject of each mail cross into the browser; the functions
 * that render them stay on the server.
 */
export default async function AdminEmailsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as { role?: string }).role;
  if (role !== "admin") notFound();

  return <SendEmailView campaigns={campaignSummaries()} />;
}
