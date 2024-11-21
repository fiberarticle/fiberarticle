"use client";

import "@radix-ui/themes/styles.css";
import { Button, Theme } from "@radix-ui/themes";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { AuthShell } from "@/components/auth-screen";
import { authClient } from "@/lib/auth-client";

import styles from "@/components/auth-screen.module.css";

function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const codeFromLink = searchParams.get("code") ?? "";

  const [code, setCode] = useState(codeFromLink);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resent, setResent] = useState(false);
  // The link in the email carries the code, so it verifies on arrival. This
  // guard keeps React's development double-effect from firing it twice and
  // burning the single-use code on the second call.
  const autoSubmitted = useRef(false);

  const verify = useCallback(
    async (value: string) => {
      if (!email) {
        setError(
          "This link is missing the email address. Enter the code from the email on the sign-in page instead."
        );
        return;
      }
      setError(null);
      setPending(true);
      const { error: verifyError } = await authClient.emailOtp.verifyEmail({
        email,
        otp: value,
      });
      setPending(false);
      if (verifyError) {
        setError(
          verifyError.message ??
            "That code is not valid any more. Request a new one below."
        );
        return;
      }
      // autoSignInAfterVerification is on, so the session already exists.
      router.push("/dashboard");
      router.refresh();
    },
    [email, router]
  );

  useEffect(() => {
    if (!codeFromLink || autoSubmitted.current) return;
    autoSubmitted.current = true;
    void verify(codeFromLink);
  }, [codeFromLink, verify]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = code.trim();
    if (!/^\d{6}$/.test(value)) {
      setError("Enter the six digit code from the email.");
      return;
    }
    await verify(value);
  }

  async function onResend() {
    if (!email) return;
    setError(null);
    setResent(false);
    const { error: resendError } = await authClient.emailOtp.sendVerificationOtp(
      { email, type: "email-verification" }
    );
    if (resendError) {
      setError(resendError.message ?? "Could not send a new code. Try again.");
      return;
    }
    setResent(true);
  }

  return (
    <AuthShell>
      <div className={styles.header}>
        <h3 className={styles.heading}>
          <span>Confirm your email</span>
        </h3>
        <p className={styles.subHeading}>
          {email
            ? `Enter the six digit code we sent to ${email}`
            : "Enter the six digit code from the verification email"}
        </p>
      </div>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <div className={styles.field}>
          <label htmlFor="code" className={styles.label}>
            Verification code
          </label>
          <input
            type="text"
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            className={`${styles.input} ${styles.codeInput} ${
              error ? styles.inputError : ""
            }`}
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            aria-invalid={!!error}
            aria-describedby="code-error"
          />
        </div>

        {error && (
          <p id="code-error" role="alert" className={styles.errorText}>
            {error}
          </p>
        )}

        {resent && (
          <p role="status" className={styles.noticeText}>
            A new code is on its way. It expires in 10 minutes.
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
            Verify email
          </Button>
        </Theme>
      </form>

      <div className={styles.loginRow}>
        {email && (
          <>
            Did not get it?{" "}
            <button
              type="button"
              className={styles.loginLinkButton}
              onClick={onResend}
            >
              Send a new code
            </button>
            {" · "}
          </>
        )}
        <Link href="/sign-in" className={styles.loginLinkButton}>
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  );
}
