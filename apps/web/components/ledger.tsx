import { formatRupees } from "@/lib/access";
import type { LedgerRow } from "@/lib/types";

const METHOD_LABEL: Record<string, string> = {
  upi: "UPI",
  card: "Card",
  netbanking: "Netbanking",
  wallet: "Wallet",
  emi: "EMI",
  paylater: "Pay later",
};

export interface LedgerLine {
  title: string;
  status: string;
  tone: "success" | "warning" | "destructive" | "outline" | "info";
  /** Amount, method and payment id, when there is a payment behind it. */
  detail: string | null;
}

/**
 * Plain words for one row of the payments ledger, shared by the Plan tab in
 * Settings and the person panel on the Admin page.
 */
export function ledgerLabel(row: LedgerRow): LedgerLine {
  const paid = formatRupees(row.amount / 100);
  const method = row.method ? (METHOD_LABEL[row.method] ?? row.method) : null;
  const detail =
    row.provider === "razorpay"
      ? [paid, method, row.payment_id, row.livemode ? null : "test mode"]
          .filter(Boolean)
          .join(" · ")
      : null;

  switch (row.status) {
    case "paid":
      return { title: "Paid for full access", status: "Paid", tone: "success", detail };
    case "refunded":
      return { title: "Payment refunded", status: "Refunded", tone: "warning", detail };
    case "failed":
      return { title: "Payment did not go through", status: "Failed", tone: "destructive", detail };
    case "granted":
      return { title: "Full access given by an admin", status: "Given", tone: "info", detail: null };
    case "revoked":
      return {
        title: row.provider === "admin" ? "Access removed by an admin" : "Access removed",
        status: "Removed",
        tone: "outline",
        detail: null,
      };
    default:
      return { title: "Checkout opened, not paid", status: "Not paid", tone: "outline", detail };
  }
}
