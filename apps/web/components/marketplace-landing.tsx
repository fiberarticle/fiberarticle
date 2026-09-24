"use client";

import "@radix-ui/themes/styles.css";
import { Button, Flex, Theme } from "@radix-ui/themes";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AuthShell, type SocialProviders } from "@/components/auth-screen";
import { GoogleIcon } from "@/components/google-icon";
import { MicrosoftIcon } from "@/components/microsoft-icon";
import { TERMS_URL } from "@/components/paywall";
import { apiFetch, ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { AZURE_PORTAL_URL } from "@/lib/marketplace";
import { socialSignInError } from "@/lib/sign-in";
import type { MarketplaceActivation, MarketplacePurchase } from "@/lib/types";

import styles from "@/components/auth-screen.module.css";

/**
 * The Microsoft Marketplace landing page.
 *
 * Microsoft sends a buyer here with ?token=<purchase token> right after the
 * purchase ("Configure account now") and whenever they open the subscription
 * from the Azure portal. The page has them sign in (Microsoft first, as the
 * Marketplace asks), shows what was bought, and activates it on the account
 * they chose. Everything about the purchase comes from Microsoft through the
 * API, which resolves the token again on every call.
 */
export function MarketplaceLanding({
  token,
  user,
  providers,
}: {
  token: string;
  user: { name: string; email: string } | null;
  providers: SocialProviders;
}) {
  const searchParams = useSearchParams();
  // Microsoft URL-encodes the token. A "+" that arrived unencoded reads as a
  // space after decoding; the token never contains real spaces.
  const purchaseToken = token.trim().replace(/ /g, "+");
  const here = `/marketplace?token=${encodeURIComponent(purchaseToken)}`;

  if (!purchaseToken) return <NoToken signedIn={user !== null} />;
  if (!user) {
    return (
      <SignInStep
        here={here}
        providers={providers}
        error={socialSignInError(searchParams.get("error"))}
      />
    );
  }
  return <ActivateStep token={purchaseToken} here={here} user={user} />;
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <AuthShell>
      <div className={styles.header}>
        <h3 className={styles.heading}>
          <span>{title}</span>
        </h3>
        <p className={styles.subHeading}>{subtitle}</p>
      </div>
      <Theme
        appearance="light"
        accentColor="brown"
        grayColor="sand"
        radius="large"
        hasBackground={false}
        className={styles.themeScope}
      >
        <Flex direction="column" gap="4" width="100%">
          {children}
        </Flex>
      </Theme>
    </AuthShell>
  );
}

function NoToken({ signedIn }: { signedIn: boolean }) {
  return (
    <Shell
      title="Microsoft Marketplace"
      subtitle="This page finishes a purchase made on Microsoft Marketplace."
    >
      <p className={`${styles.message} ${styles.messageInfo}`}>
        Open it from Microsoft: right after buying, choose Configure account
        now. Later, find Fiberarticle in the{" "}
        <a href={AZURE_PORTAL_URL} target="_blank" rel="noopener noreferrer">
          Azure portal
        </a>{" "}
        under SaaS and choose Open SaaS Account on publisher&apos;s site.
      </p>
      <Button
        asChild
        variant="classic"
        color="brown"
        radius="large"
        size="3"
        className={styles.primaryButton}
      >
        <Link href={signedIn ? "/dashboard" : "/sign-in"}>
          {signedIn ? "Open Fiberarticle" : "Sign in"}
        </Link>
      </Button>
    </Shell>
  );
}

function SignInStep({
  here,
  providers,
  error,
}: {
  here: string;
  providers: SocialProviders;
  error: string | null;
}) {
  const [pending, setPending] = useState<"google" | "microsoft" | null>(null);
  const [message, setMessage] = useState<string | null>(error);
  const next = encodeURIComponent(here);

  async function social(provider: "google" | "microsoft") {
    if (pending) return;
    setMessage(null);
    setPending(provider);
    try {
      // Success and failure both come back to this page, token and all.
      const { error: startError } = await authClient.signIn.social({
        provider,
        callbackURL: here,
        errorCallbackURL: here,
      });
      if (startError) {
        setMessage(
          startError.message || "Sign-in could not start. Try again in a moment."
        );
        setPending(null);
      }
    } catch {
      setMessage("Network error. Please try again.");
      setPending(null);
    }
  }

  return (
    <Shell
      title="Activate Fiberarticle"
      subtitle="Thank you for buying Fiberarticle on Microsoft Marketplace. Sign in to choose the account it unlocks."
    >
      {message && (
        <p role="alert" className={`${styles.message} ${styles.messageError}`}>
          {message}
        </p>
      )}

      {providers.microsoft && (
        <Button
          type="button"
          variant="classic"
          color="brown"
          radius="large"
          size="3"
          className={styles.primaryButton}
          loading={pending === "microsoft"}
          onClick={() => social("microsoft")}
        >
          <MicrosoftIcon />
          Continue with Microsoft
        </Button>
      )}
      {providers.google && (
        <Button
          type="button"
          variant="classic"
          color="gray"
          highContrast
          radius="large"
          size="3"
          className={styles.googleButton}
          loading={pending === "google"}
          onClick={() => social("google")}
        >
          <GoogleIcon />
          Continue with Google
        </Button>
      )}
      {(providers.microsoft || providers.google) && (
        <div className={styles.orRow} aria-hidden>
          <span className={styles.orLine} />
          <span>or</span>
          <span className={styles.orLine} />
        </div>
      )}
      <Button
        asChild
        variant="classic"
        color="gray"
        highContrast
        radius="large"
        size="3"
        className={styles.googleButton}
      >
        <Link href={`/sign-in?next=${next}`}>Sign in with email</Link>
      </Button>

      <div className={styles.loginRow}>
        New to Fiberarticle?{" "}
        <Link href={`/sign-up?next=${next}`} className={styles.loginLinkButton}>
          Create an account
        </Link>
      </div>
    </Shell>
  );
}

function when(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function PurchaseDetails({ purchase }: { purchase: MarketplacePurchase }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Subscription", purchase.name || purchase.id],
    ["Plan", purchase.plan_id],
  ];
  if (purchase.purchaser_email) rows.push(["Bought by", purchase.purchaser_email]);
  if (
    purchase.beneficiary_email &&
    purchase.beneficiary_email.toLowerCase() !==
      (purchase.purchaser_email ?? "").toLowerCase()
  ) {
    rows.push(["Bought for", purchase.beneficiary_email]);
  }
  const until = when(purchase.term_end);
  if (until) rows.push(["Paid up to", until]);
  if (purchase.is_test) {
    rows.push(["Kind", <span className={styles.testTag}>Test purchase</span>]);
  }

  return (
    <div className={styles.purchasePanel}>
      {rows.map(([key, value]) => (
        <div key={key} className={styles.purchaseRow}>
          <span className={styles.purchaseKey}>{key}</span>
          <span className={styles.purchaseValue}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function ActivateStep({
  token,
  here,
  user,
}: {
  token: string;
  here: string;
  user: { name: string; email: string };
}) {
  const [purchase, setPurchase] = useState<MarketplacePurchase | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [result, setResult] = useState<MarketplaceActivation | null>(null);
  const [leaving, setLeaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setPurchase(
        await apiFetch<MarketplacePurchase>("/v1/marketplace/resolve", {
          method: "POST",
          body: JSON.stringify({ token }),
        })
      );
    } catch (e) {
      setLoadError(
        e instanceof ApiError
          ? e.message
          : "The Fiberarticle API is unreachable. Try again in a minute."
      );
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function activate() {
    if (activating) return;
    setActivating(true);
    setActivateError(null);
    try {
      const done = await apiFetch<MarketplaceActivation>(
        "/v1/marketplace/activate",
        { method: "POST", body: JSON.stringify({ token }) }
      );
      setPurchase(done.subscription);
      setResult(done);
    } catch (e) {
      setActivateError(
        e instanceof ApiError
          ? e.message
          : "The Fiberarticle API is unreachable. Nothing changed; try again."
      );
      // It may have moved on meanwhile (activated from another tab, or
      // cancelled): show Microsoft's current view.
      void load();
    } finally {
      setActivating(false);
    }
  }

  async function switchAccount() {
    setLeaving(true);
    await authClient.signOut();
    // A full load, so the page starts over at the sign-in step with nothing
    // of this account left in memory.
    window.location.assign(here);
  }

  function openApp() {
    // A full load: the app decides locked or open from the session on the
    // server, and that has just changed.
    window.location.assign("/dashboard");
  }

  const firstName = user.name.trim().split(/\s+/)[0];
  const account = (
    <div className={styles.accountRow}>
      <span>
        Signed in as <strong>{user.email}</strong>
      </span>
      <button
        type="button"
        className={styles.loginLinkButton}
        onClick={switchAccount}
        disabled={leaving}
      >
        Use another account
      </button>
    </div>
  );

  if (result) {
    const open = result.access === "full";
    return (
      <Shell
        title={open ? `You are in${firstName ? `, ${firstName}` : ""}` : "Almost there"}
        subtitle={
          open
            ? "Your Microsoft Marketplace subscription is active."
            : "Microsoft has your activation."
        }
      >
        <PurchaseDetails purchase={result.subscription} />
        {open ? (
          <p className={`${styles.message} ${styles.messageSuccess}`}>
            Every feature is now open on {user.email}. The details are on their
            way to your inbox.
          </p>
        ) : (
          <p className={`${styles.message} ${styles.messageInfo}`}>
            Access opens as soon as Microsoft confirms the subscription,
            usually within a minute.
          </p>
        )}
        <Button
          type="button"
          variant="classic"
          color="brown"
          radius="large"
          size="3"
          className={styles.primaryButton}
          loading={!open && activating}
          onClick={open ? openApp : activate}
        >
          {open ? "Open Fiberarticle" : "Check again"}
        </Button>
      </Shell>
    );
  }

  if (loadError && !purchase) {
    return (
      <Shell
        title="Activate Fiberarticle"
        subtitle="Your Microsoft Marketplace purchase could not be read."
      >
        <p role="alert" className={`${styles.message} ${styles.messageError}`}>
          {loadError}
        </p>
        <Button
          type="button"
          variant="classic"
          color="brown"
          radius="large"
          size="3"
          className={styles.primaryButton}
          onClick={() => void load()}
        >
          Try again
        </Button>
        {account}
      </Shell>
    );
  }

  if (!purchase) {
    return (
      <Shell
        title="Activate Fiberarticle"
        subtitle="Reading your purchase from Microsoft."
      >
        <div className={styles.purchasePanel} aria-busy>
          <span className={styles.purchaseKey}>One moment.</span>
        </div>
        {account}
      </Shell>
    );
  }

  const live = purchase.status === "Subscribed";
  const mismatch =
    purchase.beneficiary_email &&
    purchase.beneficiary_email.toLowerCase() !== user.email.toLowerCase();

  let body: React.ReactNode;
  if (purchase.status === "Unsubscribed") {
    body = (
      <p className={`${styles.message} ${styles.messageError}`}>
        This subscription was cancelled, so there is nothing to activate.
      </p>
    );
  } else if (purchase.linked === "other") {
    body = (
      <p className={`${styles.message} ${styles.messageError}`}>
        This subscription is already active on another Fiberarticle account.
        Use another account to sign in with that one, or write to
        admin@fiberarticle.com.
      </p>
    );
  } else if (purchase.status === "Suspended") {
    body = (
      <p className={`${styles.message} ${styles.messageWarn}`}>
        Microsoft has suspended this subscription, usually because a payment
        did not go through. Settle it in the{" "}
        <a href={AZURE_PORTAL_URL} target="_blank" rel="noopener noreferrer">
          Azure portal
        </a>{" "}
        and your access comes back on its own.
      </p>
    );
  } else if (purchase.linked === "you" && live) {
    body = (
      <>
        <p className={`${styles.message} ${styles.messageSuccess}`}>
          This subscription is active on this account. Every feature is open.
        </p>
        <Button
          type="button"
          variant="classic"
          color="brown"
          radius="large"
          size="3"
          className={styles.primaryButton}
          onClick={openApp}
        >
          Open Fiberarticle
        </Button>
      </>
    );
  } else {
    body = (
      <>
        {mismatch && (
          <p className={`${styles.message} ${styles.messageInfo}`}>
            Microsoft lists {purchase.beneficiary_email} as the person this was
            bought for. Activate it here only if {user.email} is the account
            that should get access.
          </p>
        )}
        {purchase.account_has_full_access && (
          <p className={`${styles.message} ${styles.messageWarn}`}>
            This account already has full access. To give this subscription to
            someone else, sign in with their account instead.
          </p>
        )}
        {activateError && (
          <p role="alert" className={`${styles.message} ${styles.messageError}`}>
            {activateError}
          </p>
        )}
        <Button
          type="button"
          variant="classic"
          color="brown"
          radius="large"
          size="3"
          className={styles.primaryButton}
          loading={activating}
          onClick={activate}
        >
          Activate on this account
        </Button>
        <p className={styles.finePrint}>
          {live
            ? "Microsoft has already started this subscription; activating ties it to this account."
            : "Microsoft starts billing the subscription when you activate it."}{" "}
          By activating you agree to the{" "}
          <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">
            Terms
          </a>
          .
        </p>
      </>
    );
  }

  return (
    <Shell
      title="Activate Fiberarticle"
      subtitle="Here is what you bought on Microsoft Marketplace."
    >
      <PurchaseDetails purchase={purchase} />
      {body}
      {account}
    </Shell>
  );
}
