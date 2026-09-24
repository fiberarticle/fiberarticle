import type { MarketplaceSubscription } from "@/lib/types";

/** Microsoft Marketplace buyers manage their subscription here, under SaaS. */
export const AZURE_PORTAL_URL = "https://portal.azure.com/";

/**
 * Why a locked account that bought through Microsoft Marketplace is locked,
 * or null when that does not apply. A live subscription means the account
 * is not locked because of Microsoft, so it wins over an old ended one.
 */
export function marketplaceLockReason(
  subscriptions: MarketplaceSubscription[] | undefined
): string | null {
  if (!subscriptions?.length) return null;
  if (subscriptions.some((s) => s.status === "Subscribed")) return null;
  if (subscriptions.some((s) => s.status === "Suspended")) {
    return "Microsoft has suspended your Microsoft Marketplace subscription, usually because a payment did not go through. Settle it in the Azure portal and your access comes back on its own.";
  }
  if (subscriptions.some((s) => s.status === "Unsubscribed")) {
    return "Your Microsoft Marketplace subscription has ended, so the features are locked again.";
  }
  return null;
}
