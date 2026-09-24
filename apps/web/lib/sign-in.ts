/**
 * Where to go after signing in: the ?next= path when it points inside
 * Fiberarticle, the fallback otherwise. A full URL or a protocol-relative
 * "//host" is ignored, so a crafted sign-in link cannot send someone off to
 * another site once they have signed in.
 */
export function safeNext(
  value: string | null | undefined,
  fallback = "/dashboard"
): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  ) {
    return fallback;
  }
  return value;
}

/**
 * What to tell someone whose Google or Microsoft sign-in came back with an
 * error code (Better Auth puts it on the errorCallbackURL as ?error=). Only
 * the code is read: the error_description next to it comes from the link and
 * is never shown.
 */
export function socialSignInError(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "access_denied":
      return "Sign-in was cancelled.";
    case "account_not_linked":
    case "unable_to_link_account":
      return "An account with this email already exists. Sign in the way you did before, with your email and password or Google.";
    case "email_not_found":
      return "That account did not share an email address with Fiberarticle. Choose an account that has one, or sign up with email and password.";
    case "state_mismatch":
    case "state_not_found":
    case "please_restart_the_process":
    case "invalid_code":
    case "no_code":
      return "The sign-in was interrupted or took too long. Try again.";
    case "consent_required":
    case "interaction_required":
      return "Your organisation needs to approve Fiberarticle before you can sign in with this account. Ask your IT admin, or sign in with email and password.";
    default:
      return "Sign-in did not complete. Try again, or use your email and password.";
  }
}
