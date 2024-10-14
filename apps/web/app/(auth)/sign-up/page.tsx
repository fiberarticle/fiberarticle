import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SignUpForm } from "./sign-up-form";

export const metadata = { title: "Create account" };

export default async function SignUpPage() {
  // Redirect only on a genuinely valid session so a stale cookie cannot lock
  // the user out of creating an account.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    redirect("/dashboard");
  }

  return <SignUpForm googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID)} />;
}
