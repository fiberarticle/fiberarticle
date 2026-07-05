import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const protectedPrefixes = [
  "/dashboard",
  "/runs",
  "/documents",
  "/settings",
  "/assistant",
  "/extract",
  "/researcher",
  "/review",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Optimistic guard only: if there is no session cookie at all, send the user
  // to sign-in before rendering a protected page. We do NOT redirect authed
  // users away from the auth pages here, because that check would only look at
  // cookie presence, not validity. A stale-but-present cookie (for example
  // after a session is revoked or the auth database is reset) would then bounce
  // the user between /dashboard and /sign-in forever and lock them out. The
  // auth pages themselves verify the real session and redirect if it is valid.
  if (
    protectedPrefixes.some((p) => pathname.startsWith(p)) &&
    !getSessionCookie(request)
  ) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/runs/:path*",
    "/documents/:path*",
    "/settings/:path*",
    "/assistant/:path*",
    "/extract/:path*",
    "/researcher/:path*",
    "/review/:path*",
  ],
};
