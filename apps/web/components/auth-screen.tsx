"use client";

import "@radix-ui/themes/styles.css";
import { Button, Flex, Theme } from "@radix-ui/themes";
import { Eye, EyeOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { AuthLottie } from "@/components/auth-lottie";
import { GoogleIcon } from "@/components/google-icon";
import { authClient } from "@/lib/auth-client";

import styles from "./auth-screen.module.css";

/**
 * Full-screen split auth screen: black brand panel on the left, sand form
 * panel on the right. One component serves both sign-up and sign-in; the
 * link row switches modes in place.
 */
/**
 * Shared full-screen auth shell: black brand panel with effects on the
 * left, sand content panel on the right. Every auth page renders inside it.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.topFade} />

        <div className={styles.stripeLayer}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className={styles.stripe} />
          ))}
        </div>

        <div className={styles.warmMist} />
        <div className={styles.orangeBlob} />
        <div className={styles.whiteGlow} />

        <div className={styles.leftPanel}>
          {/* Decorative animation filling the empty lower half of the
              brand panel. aria-hidden + pointer-events none: pure visual. */}
          <div className={styles.leftAnimation} aria-hidden>
            <div className={styles.animSearch}>
              <AuthLottie src="/Searching.lottie" />
            </div>
          </div>
          <div className={styles.leftContent}>
            <h1 className={styles.leftBrand}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/Fiberarticle_Logo_Without_Background.svg"
                alt=""
                className={styles.leftBrandLogo}
              />
              <span className={styles.leftBrandWord}>Fiberarticle</span>
            </h1>
            <p className={styles.leftDescription}>
              <span className={styles.descLine}>An Agentic AI that,</span>
              <span className={`${styles.descLine} ${styles.hlAmber}`}>
                Researches.
              </span>
              <span className={`${styles.descLine} ${styles.hlGreen}`}>
                Performs literature reviews.
              </span>
              <span className={`${styles.descLine} ${styles.hlPink}`}>
                Writes article papers.
              </span>
            </p>
          </div>
        </div>

        <div className={styles.rightPanel}>
          <div className={styles.rightContent}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export function AuthScreen({
  initialMode,
}: {
  initialMode: "signup" | "login";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";

  const [isLoginMode, setIsLoginMode] = useState(initialMode === "login");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstNameError, setFirstNameError] = useState("");
  const [lastNameError, setLastNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const validateEmail = (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  // Better Auth enforces a minimum of 8 characters; mirror that here and
  // ask for a mix so accounts start with a sane password.
  const validatePassword = (value: string) =>
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,64}$/.test(value);

  const switchMode = (nextMode: "signup" | "login") => {
    setIsLoginMode(nextMode === "login");
    setFirstNameError("");
    setLastNameError("");
    setEmailError("");
    setPasswordError("");
    setFormError("");
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;

    setFormError("");
    let valid = true;

    if (!isLoginMode) {
      if (!firstName.trim()) {
        setFirstNameError("First name is required.");
        valid = false;
      } else {
        setFirstNameError("");
      }

      if (!lastName.trim()) {
        setLastNameError("Last name is required.");
        valid = false;
      } else {
        setLastNameError("");
      }
    }

    if (!validateEmail(email)) {
      setEmailError("Please enter a valid email address.");
      valid = false;
    } else {
      setEmailError("");
    }

    if (isLoginMode ? !password.trim() : !validatePassword(password)) {
      setPasswordError(
        isLoginMode
          ? "Password is required."
          : "Use at least 8 characters with uppercase, lowercase, and a number."
      );
      valid = false;
    } else {
      setPasswordError("");
    }

    if (!valid) return;

    setSubmitting(true);
    try {
      const { error } = isLoginMode
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({
            name: `${firstName.trim()} ${lastName.trim()}`.trim(),
            email,
            password,
          });

      if (error) {
        setFormError(
          error.message ||
            (isLoginMode
              ? "Login failed. Please check your credentials."
              : "Signup failed. Please try again.")
        );
        return;
      }

      router.push(next);
      router.refresh();
    } catch (err) {
      setFormError(
        err instanceof Error
          ? `Network error: ${err.message}`
          : "Network error. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogle = async () => {
    setFormError("");
    await authClient.signIn.social({ provider: "google", callbackURL: next });
  };

  return (
    <AuthShell>
            <div className={styles.header}>
              <h3 className={styles.heading}>
                <span>Get Started</span>
              </h3>
              <p className={styles.subHeading}>
                From topic to publication-ready article
              </p>
            </div>

            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              {!isLoginMode && (
                <div className={styles.field}>
                  <label className={styles.label}>Full Name</label>
                  <div className={styles.nameRow}>
                    <div className={styles.nameCell}>
                      <input
                        type="text"
                        id="first-name"
                        placeholder="first name"
                        className={`${styles.input} ${firstNameError ? styles.inputError : ""}`}
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        aria-invalid={!!firstNameError}
                        aria-describedby="first-name-error"
                      />
                      {firstNameError && (
                        <p id="first-name-error" className={styles.errorText}>
                          {firstNameError}
                        </p>
                      )}
                    </div>

                    <div className={styles.nameCell}>
                      <input
                        type="text"
                        id="last-name"
                        placeholder="last name"
                        className={`${styles.input} ${lastNameError ? styles.inputError : ""}`}
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        aria-invalid={!!lastNameError}
                        aria-describedby="last-name-error"
                      />
                      {lastNameError && (
                        <p id="last-name-error" className={styles.errorText}>
                          {lastNameError}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

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

              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <label htmlFor="password" className={styles.label}>
                    Password
                  </label>
                  {isLoginMode && (
                    <a href="/forgot-password" className={styles.forgotLink}>
                      Forgot password?
                    </a>
                  )}
                </div>
                <div className={styles.passwordWrap}>
                  <input
                    type={showPassword ? "text" : "password"}
                    id="password"
                    placeholder={
                      isLoginMode ? "enter your password" : "minimum 8 characters"
                    }
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

              {formError && (
                <p role="alert" className={styles.errorText}>
                  {formError}
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
                <Flex direction="column" gap="3" align="center" width="100%">
                  <Button
                    type="submit"
                    variant="classic"
                    color="brown"
                    radius="large"
                    size="3"
                    className={styles.primaryButton}
                    loading={submitting}
                  >
                    {isLoginMode ? "Login" : "Create a new account"}
                  </Button>

                  <div className={styles.orRow} aria-hidden>
                    <span className={styles.orLine} />
                    <span>or</span>
                    <span className={styles.orLine} />
                  </div>

                  <Button
                    type="button"
                    variant="classic"
                    color="gray"
                    highContrast
                    radius="large"
                    size="3"
                    className={styles.googleButton}
                    onClick={onGoogle}
                  >
                    <GoogleIcon />
                    Continue with Google
                  </Button>
                </Flex>
              </Theme>

              <div className={styles.loginRow}>
                {isLoginMode ? "Don't have account? " : "Already have account? "}
                <button
                  type="button"
                  className={styles.loginLinkButton}
                  onClick={() => switchMode(isLoginMode ? "signup" : "login")}
                >
                  {isLoginMode ? "Create account" : "Login"}
                </button>
              </div>
            </form>
    </AuthShell>
  );
}
