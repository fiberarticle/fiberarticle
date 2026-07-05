import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer, jwt } from "better-auth/plugins";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";

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
  },
  user: {
    deleteUser: {
      enabled: true,
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your Fiberarticle password",
        text: `Hi ${user.name},\n\nReset your Fiberarticle password using the link below. The link expires in one hour.\n\n${url}\n\nIf you did not request this, you can safely ignore this email.`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your Fiberarticle email",
        text: `Hi ${user.name},\n\nWelcome to Fiberarticle. Verify your email address using the link below.\n\n${url}\n\nIf you did not create this account, you can safely ignore this email.`,
      });
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
  plugins: [jwt(), bearer()],
});
