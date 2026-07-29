"use client";

import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

// emailOTPClient exposes authClient.emailOtp.* , used by the verify-email
// page to check the six digit code from the verification email.
export const authClient = createAuthClient({
  plugins: [emailOTPClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
