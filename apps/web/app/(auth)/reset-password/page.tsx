"use client";

import "@radix-ui/themes/styles.css";
import { Button, Theme } from "@radix-ui/themes";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { FormEvent } from "react";

import { AuthShell } from "@/components/auth-screen";
import { authClient } from "@/lib/auth-client";

import styles from "@/components/auth-screen.module.css";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    let valid = true;
    if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
      valid = false;
    } else {
      setPasswordError("");
    }
    if (password !== confirm) {
      setConfirmError("Passwords do not match.");
      valid = false;
    } else {
      setConfirmError("");
    }
    if (!valid) return;
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
      setError(
        error.message ?? "Could not reset the password. Request a new link."
      );
      return;
    }
    router.push("/sign-in");
  }

  return (
    <AuthShell>
      <div className={styles.header}>
        <h3 className={styles.heading}>
          <span>Choose a new password</span>
        </h3>
        <p className={styles.subHeading}>
          Set a new password for your Fiberarticle account
        </p>
      </div>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <div className={styles.field}>
          <label htmlFor="password" className={styles.label}>
            New password
          </label>
          <div className={styles.passwordWrap}>
            <input
              type={showPassword ? "text" : "password"}
              id="password"
              placeholder="minimum 8 characters"
              className={`${styles.input} ${passwordError ? styles.inputError : ""}`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!passwordError}
              aria-describedby="password-error"
            />
            <button
              type="button"
              className={styles.eyeBtn}
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          {passwordError && (
            <p id="password-error" className={styles.errorText}>
              {passwordError}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="confirm" className={styles.label}>
            Confirm password
          </label>
          <input
            type={showPassword ? "text" : "password"}
            id="confirm"
            placeholder="repeat the new password"
            className={`${styles.input} ${confirmError ? styles.inputError : ""}`}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={!!confirmError}
            aria-describedby="confirm-error"
          />
          {confirmError && (
            <p id="confirm-error" className={styles.errorText}>
              {confirmError}
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
            Reset password
          </Button>
        </Theme>
      </form>

      <div className={styles.loginRow}>
        <Link href="/sign-in" className={styles.loginLinkButton}>
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
