import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, socialSignIn } from "@/lib/auth";
import { safeNext } from "@/lib/sign-in";
import { AuthScreen } from "@/components/auth-screen";

export const metadata = { title: "Create account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  // Redirect only on a genuinely valid session so a stale cookie cannot lock
  // the user out of creating an account.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    const { next } = await searchParams;
    redirect(safeNext(typeof next === "string" ? next : null));
  }

  return (
    <Suspense>
      <AuthScreen initialMode="signup" providers={socialSignIn} />
    </Suspense>
  );
}
