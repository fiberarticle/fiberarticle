import {
  appUrl,
  button,
  detailPanel,
  esc,
  eyebrow,
  footnote,
  formatWhen,
  headline,
  inlineLink,
  paragraph,
  renderShell,
  rule,
  type RenderedEmail,
} from "./shell";

export interface FullAccessReceipt {
  /** Razorpay's payment id, pay_... */
  paymentId: string;
  paidAt: Date;
  /** Razorpay's method name: upi, card, netbanking, wallet, emi... */
  method: string | null;
  /** Whole rupees. */
  planInr: number;
  feeInr: number;
  totalInr: number;
}

export interface FullAccessSubscription {
  /** Microsoft's SaaS subscription id. */
  id: string;
  /** The plan bought, as named in the offer (fiberarticle-5-year). */
  planId: string;
  /** End of the term Microsoft billed for, when Microsoft reported it. */
  termEnd: Date | null;
}

export interface FullAccessEmailProps {
  /** First name only: the greeting reads better than a full name. */
  firstName: string;
  /** "payment" when they bought it, "grant" when an admin gave it,
   * "microsoft" when a Microsoft Marketplace subscription was activated. */
  via: "payment" | "grant" | "microsoft";
  /** Present for a payment, absent otherwise. */
  receipt?: FullAccessReceipt;
  /** Present for a Microsoft Marketplace subscription, absent otherwise. */
  subscription?: FullAccessSubscription;
}

const FEATURES =
  "the Researcher, the Literature Reviewer, the Article Writer, the AI Assistant and Extract";

const METHOD_LABEL: Record<string, string> = {
  upi: "UPI",
  card: "Card",
  netbanking: "Netbanking",
  wallet: "Wallet",
  emi: "EMI",
  paylater: "Pay later",
  cardless_emi: "Cardless EMI",
};

function methodLabel(method: string | null): string {
  if (!method) return "Online payment";
  return METHOD_LABEL[method] ?? method.charAt(0).toUpperCase() + method.slice(1);
}

/** "₹17,053": Indian digit grouping, whole rupees. */
function rupees(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

/**
 * Sent once an account gets full access: after a payment (with the receipt
 * details), when a Microsoft Marketplace subscription is activated, or when
 * an admin gives access by hand. The web app sends it once per payment
 * record, when the API asks (app/api/internal/access-email).
 */
export function fullAccessEmail({
  firstName,
  via,
  receipt,
  subscription,
}: FullAccessEmailProps): RenderedEmail {
  if (via === "microsoft" && subscription !== undefined) {
    return microsoftEmail(firstName, subscription);
  }
  const url = appUrl();
  const host = url.replace(/^https?:\/\//, "");
  const paid = via === "payment" && receipt !== undefined;

  const intro = paid
    ? `Hello ${esc(
        firstName
      )}, thank you for your payment. Every feature is now open on your account: ${FEATURES}.`
    : `Hello ${esc(
        firstName
      )}, your account has been given full access to Fiberarticle. Every feature is now open: ${FEATURES}.`;

  const receiptRows: Array<[string, string]> = paid
    ? [
        ["Product", "Fiberarticle full access"],
        ["Plan price", rupees(receipt.planInr)],
        ["Gateway charges", rupees(receipt.feeInr)],
        ["Total paid", rupees(receipt.totalInr)],
        ["Paid on", formatWhen(receipt.paidAt)],
        ["Method", methodLabel(receipt.method)],
        ["Payment ID", receipt.paymentId],
      ]
    : [];

  const rows = [
    eyebrow(paid ? "Payment received" : "Full access"),
    headline("Fiberarticle is fully unlocked"),
    paragraph(intro),
    ...(paid ? [detailPanel("Receipt", receiptRows)] : []),
    button(url, "Open Fiberarticle", "primary", 30),
    rule(30, 22),
    paragraph(
      paid
        ? "This was a one-time payment. There is nothing to renew and you will not be charged again. Keep this email as your receipt."
        : "There is nothing to pay and nothing to renew. Your access stays on your account.",
      0
    ),
    rule(22, 22),
    footnote(
      paid
        ? `Questions about this payment? Write to ${inlineLink(
            "mailto:admin@fiberarticle.com",
            "admin@fiberarticle.com"
          )} with your payment ID. This email was sent for an account at ${inlineLink(
            url,
            host
          )}.`
        : `Questions? Write to ${inlineLink(
            "mailto:admin@fiberarticle.com",
            "admin@fiberarticle.com"
          )}. This email was sent for an account at ${inlineLink(url, host)}.`
    ),
  ].join("\n");

  const subject = paid
    ? "Your Fiberarticle payment is confirmed"
    : "You now have full access to Fiberarticle";

  return {
    subject,
    html: renderShell({
      title: subject,
      preheader: paid
        ? "Payment received. Every feature is now open on your account."
        : "Every feature is now open on your account.",
      headerTag: paid ? "Receipt" : "Account",
      rows,
    }),
    text: [
      paid
        ? `Hello ${firstName}, thank you for your payment. Every feature is now open on your account: ${FEATURES}.`
        : `Hello ${firstName}, your account has been given full access to Fiberarticle. Every feature is now open: ${FEATURES}.`,
      "",
      ...(paid
        ? [
            "Receipt",
            ...receiptRows.map(([label, value]) => `${label}: ${value}`),
            "",
            "This was a one-time payment. There is nothing to renew and you will not be charged again. Keep this email as your receipt.",
            "",
          ]
        : ["There is nothing to pay and nothing to renew.", ""]),
      `Open Fiberarticle: ${url}`,
      "",
      "Questions? Write to admin@fiberarticle.com.",
    ].join("\n"),
  };
}

/**
 * The Microsoft Marketplace version. Microsoft bills the buyer and sends its
 * own invoices, so this confirms the activation instead of being a receipt.
 */
function microsoftEmail(
  firstName: string,
  subscription: FullAccessSubscription
): RenderedEmail {
  const url = appUrl();
  const host = url.replace(/^https?:\/\//, "");
  const details: Array<[string, string]> = [
    ["Product", "Fiberarticle full access"],
    ["Bought through", "Microsoft Marketplace"],
    ["Plan", subscription.planId],
  ];
  if (subscription.termEnd) {
    details.push(["Paid up to", formatWhen(subscription.termEnd)]);
  }
  details.push(["Subscription ID", subscription.id]);
  const billing =
    "Microsoft bills this subscription and sends its own invoices. You can see or cancel it in the Azure portal, under SaaS.";

  const rows = [
    eyebrow("Microsoft Marketplace"),
    headline("Fiberarticle is fully unlocked"),
    paragraph(
      `Hello ${esc(
        firstName
      )}, your Microsoft Marketplace subscription is active. Every feature is now open on your account: ${FEATURES}.`
    ),
    detailPanel("Subscription", details),
    button(url, "Open Fiberarticle", "primary", 30),
    rule(30, 22),
    paragraph(billing, 0),
    rule(22, 22),
    footnote(
      `Questions about this subscription? Write to ${inlineLink(
        "mailto:admin@fiberarticle.com",
        "admin@fiberarticle.com"
      )} with your subscription ID. This email was sent for an account at ${inlineLink(
        url,
        host
      )}.`
    ),
  ].join("\n");

  const subject = "Your Fiberarticle subscription is active";

  return {
    subject,
    html: renderShell({
      title: subject,
      preheader:
        "Your Microsoft Marketplace subscription is active. Every feature is now open on your account.",
      headerTag: "Subscription",
      rows,
    }),
    text: [
      `Hello ${firstName}, your Microsoft Marketplace subscription is active. Every feature is now open on your account: ${FEATURES}.`,
      "",
      "Subscription",
      ...details.map(([label, value]) => `${label}: ${value}`),
      "",
      billing,
      "",
      `Open Fiberarticle: ${url}`,
      "",
      "Questions? Write to admin@fiberarticle.com.",
    ].join("\n"),
  };
}
