import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Dashboard } from "./dashboard";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return <Dashboard userName={session.user.name} />;
}
