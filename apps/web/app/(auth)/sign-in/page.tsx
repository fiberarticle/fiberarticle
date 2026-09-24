import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, socialSignIn } from "@/lib/auth";
import { safeNext } from "@/lib/sign-in";
import { AuthScreen } from "@/components/auth-screen";

export const metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  // Redirect only when the session is genuinely valid (not just a cookie
  // present), so a stale cookie cannot lock the user out of signing in.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    const { next } = await searchParams;
    redirect(safeNext(typeof next === "string" ? next : null));
  }

  return (
    <Suspense>
      <AuthScreen initialMode="login" providers={socialSignIn} />
    </Suspense>
  );
}
