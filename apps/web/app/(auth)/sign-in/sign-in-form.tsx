"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { GoogleIcon } from "@/components/google-icon";

export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [magicPending, setMagicPending] = useState(false);

  async function onPasswordSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    const { error } = await authClient.signIn.email({ email, password });
    setPending(false);
    if (error) {
      setError(error.message ?? "Sign-in failed. Check your email and password.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function onMagicLink() {
    setError(null);
    setNotice(null);
    if (!email) {
      setError("Enter your email address first, then request a magic link.");
      return;
    }
    setMagicPending(true);
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: next,
    });
    setMagicPending(false);
    if (error) {
      setError(error.message ?? "Could not send the magic link. Try again.");
      return;
    }
    setNotice(`Magic link sent to ${email}. Check your inbox.`);
  }

  async function onGoogle() {
    setError(null);
    await authClient.signIn.social({ provider: "google", callbackURL: next });
  }

  return (
    <Card>
      <CardHeader>
        <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to continue your research.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <Callout tone="error">{error}</Callout>}
        {notice && <Callout tone="info">{notice}</Callout>}

        {googleEnabled && (
          <>
            <Button variant="secondary" onClick={onGoogle}>
              <GoogleIcon />
              Continue with Google
            </Button>
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <form onSubmit={onPasswordSignIn} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="you@university.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" loading={pending}>
            Sign in
          </Button>
        </form>

        <Button variant="secondary" loading={magicPending} onClick={onMagicLink}>
          Email me a magic link
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          New to Fiberarticle?{" "}
          <Link
            href="/sign-up"
            className="font-medium text-primary hover:underline"
          >
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
