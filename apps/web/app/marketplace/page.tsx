import { Suspense } from "react";
import { headers } from "next/headers";
import { auth, socialSignIn } from "@/lib/auth";
import { MarketplaceLanding } from "@/components/marketplace-landing";

export const metadata = { title: "Activate your Microsoft Marketplace purchase" };

/**
 * Microsoft Marketplace landing page: the URL set as the offer's landing
 * page in Partner Center (https://app.fiberarticle.com/marketplace).
 *
 * Outside the (app) group on purpose: a buyer arrives signed out, or signed
 * in to a locked account, and must reach this page either way. The page does
 * the signing in itself and passes the purchase token along through it.
 */
export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  const { token } = await searchParams;

  return (
    <Suspense>
      <MarketplaceLanding
        token={typeof token === "string" ? token : ""}
        user={
          session
            ? { name: session.user.name, email: session.user.email }
            : null
        }
        providers={socialSignIn}
      />
    </Suspense>
  );
}
