"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!token) {
      setError("This reset link is invalid or has expired. Request a new one.");
      return;
    }
    setPending(true);
    const { error } = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setPending(false);
    if (error) {
      setError(error.message ?? "Could not reset the password. Request a new link.");
      return;
    }
    router.push("/sign-in");
  }

  return (
    <Card>
      <CardHeader>
        <h1 className="text-xl font-semibold tracking-tight">
          Choose a new password
        </h1>
        <p className="text-sm text-muted-foreground">
          Set a new password for your Fiberarticle account.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <Callout tone="error">{error}</Callout>}

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              New password
            </label>
            <Input
              id="password"
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm" className="text-sm font-medium">
              Confirm password
            </label>
            <Input
              id="confirm"
              type="password"
              placeholder="Repeat the new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          <Button type="submit" loading={pending}>
            Reset password
          </Button>
        </form>

        <p className="text-center text-sm">
          <Link
            href="/sign-in"
            className="font-medium text-primary hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
