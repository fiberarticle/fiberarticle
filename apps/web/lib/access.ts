/**
 * Who may use the features.
 *
 * Everything in Fiberarticle is locked until the one-time payment, or until
 * an admin gives access by hand. Admins always pass. The value comes from
 * "user".access, which only the API writes (apps/api/billing.py), and the
 * API checks it again on every feature request, so this is the display side
 * of a rule enforced there.
 */
export function hasFullAccess(user: {
  role?: string | null;
  access?: string | null;
}): boolean {
  return user.role === "admin" || user.access === "full";
}

/** "₹19,999": Indian digit grouping, no decimals. */
export function formatRupees(rupees: number): string {
  return `₹${Math.round(rupees).toLocaleString("en-IN")}`;
}
