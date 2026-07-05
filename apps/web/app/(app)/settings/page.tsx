import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Settings } from "./settings";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  return (
    <Settings
      userName={session.user.name}
      userEmail={session.user.email}
      emailVerified={session.user.emailVerified}
    />
  );
}
