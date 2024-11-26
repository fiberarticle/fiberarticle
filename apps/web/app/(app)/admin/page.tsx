import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { AdminView } from "@/components/admin/admin-view";

export const metadata = { title: "Admin" };

/**
 * The page is checked on the server before anything is sent to the browser.
 *
 * Hiding the menu entry in the sidebar is not protection: anyone can type this
 * address. This check is what stops them, and the API does its own check on
 * top, so even a caller who skips the browser entirely gets nothing.
 *
 * notFound rather than a "you are not allowed" screen, so a signed-in user who
 * is not an admin cannot tell that the page exists at all.
 */
export default async function AdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as { role?: string }).role;
  if (role !== "admin") notFound();

  return <AdminView meId={session.user.id} />;
}
