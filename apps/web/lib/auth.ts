import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer, jwt, magicLink } from "better-auth/plugins";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  // In dev the app is reachable as both localhost and 127.0.0.1.
  trustedOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
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
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendEmail({
          to: email,
          subject: "Your Fiberarticle sign-in link",
          text: `Sign in to Fiberarticle using the link below. The link expires in five minutes.\n\n${url}\n\nIf you did not request this, you can safely ignore this email.`,
        });
      },
    }),
    jwt(),
    bearer(),
  ],
});
