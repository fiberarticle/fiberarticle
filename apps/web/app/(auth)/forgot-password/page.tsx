"use client";

import "@radix-ui/themes/styles.css";
import { Button, Theme } from "@radix-ui/themes";
import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

import { AuthShell } from "@/components/auth-screen";
import { authClient } from "@/lib/auth-client";

import styles from "@/components/auth-screen.module.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    setEmailError("");
    setPending(true);
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    setPending(false);
    if (error) {
      setError(error.message ?? "Could not send the reset email. Try again.");
      return;
    }
    setSent(true);
  }

  return (
    <AuthShell>
      <div className={styles.header}>
        <h3 className={styles.heading}>
          <span>Reset your password</span>
        </h3>
        <p className={styles.subHeading}>
          Enter your email and we will send you a reset link
        </p>
      </div>

      {sent ? (
        <p role="status" className={styles.noticeText}>
          If an account exists for {email}, a reset link is on its way. Check
          your inbox.
        </p>
      ) : (
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <div className={styles.field}>
            <label htmlFor="email" className={styles.label}>
              Email
            </label>
            <input
              type="email"
              id="email"
              placeholder="enter your email"
              className={`${styles.input} ${emailError ? styles.inputError : ""}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!emailError}
              aria-describedby="email-error"
            />
            {emailError && (
              <p id="email-error" className={styles.errorText}>
                {emailError}
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className={styles.errorText}>
              {error}
            </p>
          )}

          <Theme
            appearance="light"
            accentColor="brown"
            grayColor="sand"
            radius="large"
            hasBackground={false}
            className={styles.themeScope}
          >
            <Button
              type="submit"
              variant="classic"
              color="brown"
              radius="large"
              size="3"
              className={styles.primaryButton}
              loading={pending}
            >
              Send reset link
            </Button>
          </Theme>
        </form>
      )}

      <div className={styles.loginRow}>
        <Link href="/sign-in" className={styles.loginLinkButton}>
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}
