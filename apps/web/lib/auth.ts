import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer, emailOTP, jwt } from "better-auth/plugins";
import { prisma } from "@/lib/db";
import { sendRendered, sendRenderedQuietly } from "@/lib/email";
import {
  deviceFrom,
  passwordChangedEmail,
  passwordResetEmail,
  verifyEmail,
  welcomeEmail,
} from "@/lib/emails";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

// Server-side password policy. The sign-up form mirrors this, but the API
// must enforce it itself: any direct caller could otherwise bypass the
// client-side check entirely.
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,64}$/;
const PASSWORD_PATHS = new Set([
  "/sign-up/email",
  "/change-password",
  "/reset-password",
]);

// Origins allowed to send authenticated requests. Env-driven so production
// (e.g. https://app.fiberarticle.com) works without a code change; the dev
// default covers both localhost spellings.
const trustedOrigins = (
  process.env.TRUSTED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Verification code lifetime. The email states this in minutes, so keep the
// two in step by deriving one from the other.
const OTP_TTL_SECONDS = 600;
const OTP_TTL_MINUTES = OTP_TTL_SECONDS / 60;

// Password reset link lifetime, and the same value in the email copy.
const RESET_TTL_SECONDS = 3600;

/** First name only: "Hello Abdul" reads better than the full name. */
function firstNameOf(name: string, email: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || email.split("@")[0];
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!PASSWORD_PATHS.has(ctx.path)) return;
      const body = ctx.body as
        | { password?: string; newPassword?: string }
        | undefined;
      const password = body?.newPassword ?? body?.password;
      if (typeof password === "string" && !PASSWORD_RE.test(password)) {
        throw new APIError("BAD_REQUEST", {
          message:
            "Password must be 8-64 characters and include an uppercase letter, a lowercase letter, and a number.",
        });
      }
    }),
    // A password change from Settings has no built-in callback (unlike a
    // reset, which has onPasswordReset), so the security notice is sent from
    // here. Only on success: a failed change leaves ctx.context.returned as
    // an APIError and must not alarm anyone.
    //
    // The user comes from the response body rather than ctx.context.session.
    // /change-password returns { token, user }, and the dispatcher assigns
    // context.returned before running after hooks, so it is always there;
    // whether the endpoint's session middleware writes back to this same
    // context object is an internal detail not worth depending on.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/change-password") return;
      const returned = ctx.context.returned;
      if (returned instanceof APIError) return;
      const user =
        (returned as { user?: { email?: string } } | undefined)?.user ??
        ctx.context.session?.user;
      if (!user?.email) return;
      await sendRenderedQuietly(
        user.email,
        passwordChangedEmail({
          email: user.email,
          changedAt: new Date(),
          device: deviceFrom(ctx.headers?.get("user-agent")),
        })
      );
    }),
  },
  user: {
    deleteUser: {
      enabled: true,
    },
    additionalFields: {
      /**
       * "user" or "admin".
       *
       * input: false is the important part. Better Auth would otherwise let a
       * caller pass role in the sign-up body, and anyone could register
       * themselves as an admin. With it off the field can only be changed by
       * server-side code, which is the admin API and nothing else.
       */
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Social sign-ups arrive already verified, so this is the moment the
        // account becomes usable for them. Email/password users are created
        // unverified and get their welcome from afterEmailVerification
        // instead, so neither path sends it twice.
        after: async (user) => {
          if (!user.emailVerified) return;
          await sendRenderedQuietly(
            user.email,
            welcomeEmail({ firstName: firstNameOf(user.name, user.email) })
          );
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    resetPasswordTokenExpiresIn: RESET_TTL_SECONDS,
    // Makes the "every other session was signed out" line in the security
    // notice true for the reset path as well as the change-password path.
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }, request) => {
      const requestedAt = new Date();
      await sendRendered(
        user.email,
        passwordResetEmail({
          email: user.email,
          resetUrl: url,
          requestedAt,
          expiresAt: new Date(requestedAt.getTime() + RESET_TTL_SECONDS * 1000),
          device: deviceFrom(request?.headers?.get("user-agent")),
        })
      );
    },
    // Fires once a reset actually completes. Same template as a change from
    // Settings: from the reader's side it is the same event.
    onPasswordReset: async ({ user }, request) => {
      await sendRenderedQuietly(
        user.email,
        passwordChangedEmail({
          email: user.email,
          changedAt: new Date(),
          device: deviceFrom(request?.headers?.get("user-agent")),
        })
      );
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    // The emailOTP plugin replaces sendVerificationEmail with its own OTP
    // send (see overrideDefaultEmailVerification below), so there is no
    // sendVerificationEmail here: it would never be called.
    afterEmailVerification: async (user) => {
      await sendRenderedQuietly(
        user.email,
        welcomeEmail({ firstName: firstNameOf(user.name, user.email) })
      );
    },
  },
  ...(googleClientId && googleClientSecret
    ? {
        socialProviders: {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        },
      }
    : {}),
  plugins: [
    /**
     * The role travels inside the signed token.
     *
     * The API has no session store and no shared secret with this app: all it
     * ever sees is the JWT, which it checks against the JWKS. So if the role
     * is not in the token, the API has no way to tell an admin from anyone
     * else, and /v1/admin could not be defended at all. Putting it in the
     * payload means the API can trust it, because the signature covers it and
     * only this server holds the signing key.
     *
     * Consequence worth knowing: a token already issued keeps whatever role it
     * was minted with until it expires. Removing someone's admin rights also
     * deletes their sessions, so they cannot mint a fresh one.
     */
    jwt({
      jwt: {
        definePayload: ({ user }) => ({
          sub: user.id,
          email: user.email,
          role: (user as { role?: string }).role ?? "user",
        }),
      },
    }),
    bearer(),
    /**
     * Email verification by six digit code.
     *
     * The plugin also mounts sign-in-by-OTP, forget-password-by-OTP, and
     * change-email-by-OTP endpoints. Those are deliberately inert here: the
     * sender below delivers mail for "email-verification" only, so a code
     * minted for any other flow never reaches anyone and cannot be used.
     * disableSignUp stops the sign-in endpoint from creating accounts, and
     * changeEmail stays disabled by default. Verification code retrieval
     * (getVerificationOTP) is server-only in the plugin and unreachable from
     * the browser.
     */
    emailOTP({
      overrideDefaultEmailVerification: true,
      otpLength: 6,
      expiresIn: OTP_TTL_SECONDS,
      disableSignUp: true,
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type !== "email-verification") return;
        await sendRendered(
          email,
          verifyEmail({
            email,
            code: otp,
            expiresInMinutes: OTP_TTL_MINUTES,
          })
        );
      },
    }),
  ],
});
