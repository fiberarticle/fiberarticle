import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthScreen } from "@/components/auth-screen";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  // Redirect only when the session is genuinely valid (not just a cookie
  // present), so a stale cookie cannot lock the user out of signing in.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    redirect("/dashboard");
  }

  return (
    <Suspense>
      <AuthScreen initialMode="login" />
    </Suspense>
  );
}
