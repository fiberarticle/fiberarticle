import type { RenderedEmail } from "./shell";
import {
  WORDMARK_CID,
  WORDMARK_HEIGHT,
  WORDMARK_WIDTH,
} from "./wordmark";

/**
 * The pricing quotation, sent by hand from Admin -> Send emails.
 *
 * This is the A4 pricing flier rebuilt as an email. The flier itself cannot be
 * sent: it is CSS grid for every row, flexbox for the header, a gradient
 * clipped to the wordmark, an SVG logo and two webfonts. Outlook ignores grid
 * outright, so the three columns would collapse into one; the clipped gradient
 * leaves the wordmark transparent, so "Fiberarticle" would simply be missing;
 * and no major client renders an SVG. What follows is the same document in the
 * markup mail clients actually implement: nested tables, inline styles, one
 * PNG logo carried with the message.
 *
 * Deliberate departures from the flier, all forced by the medium:
 *   - 600px wide rather than A4, so type is scaled down by about a fifth
 *   - the wordmark gradient becomes the solid brown-gold it runs through
 *   - the logo is the PNG the other templates already attach, not the SVG
 *   - the two payment cards stack under each other on a phone
 *   - the sheet behind it is the website's pricing backdrop rather than the
 *     flier's paper, so the mail and that page look like the same product
 *
 * Same reason as the rest of this folder for being a module rather than an
 * .html file on disk: the production build ships as a Next standalone bundle,
 * which traces imports but not loose assets.
 */

const SANS =
  "'Bricolage Grotesque','Helvetica Neue',Helvetica,Arial,'Segoe UI',Roboto,sans-serif";
const MONO = "'IBM Plex Mono','SFMono-Regular',Consolas,'Courier New',monospace";

/** Card, band, hairline, ink, muted ink: the flier's palette unchanged. The
 * flier's own paper colour is gone: the sheet is the backdrop below. */
const CARD = "#fdfcfa";
const BAND = "#f1ebe2";
const LINE = "#e5ded4";
const ROW_LINE = "#ece5da";
const INK = "#211d18";
const BODY = "#4a4238";
const MUTED = "#6e675e";
/** The numeral accent, and the brown-gold the wordmark gradient passes through. */
const ACCENT = "#fca91e";

/**
 * The backdrop, taken from the website's own pricing page: the near-black it
 * paints behind the photograph, and the photograph itself.
 *
 * Linked rather than attached. An inline attachment cannot be a CSS background
 * in most clients, and at 133 KB this would be the heaviest thing in the
 * message. It is already served from our own domain for the website, so a
 * recipient with images on gets the same arc they would see at
 * fiberarticle.com/pricing, and one with images off gets PAGE underneath,
 * which is what the website paints while the photograph loads.
 */
const PAGE = "#050406";
const PAGE_IMAGE = "https://fiberarticle.com/pricing/pricing-bg.jpg";
/** The flier's own paper. The sheet sits on the backdrop; only the margin
 * around it shows the photograph, the way the flier sits on a desk. */
const SHEET = "#f8f5f0";

/** Where a reader should write back. A quotation is meant to be replied to. */
const REPLY_TO = "admin@fiberarticle.com";

interface Item {
  no: string;
  title: string;
  body: string;
  amount: string;
  /** The dashed pill under the description. The first item has none. */
  addOn?: string;
}

const ITEMS: Item[] = [
  {
    no: "01",
    title: "Problem identification",
    body: "Problem identification as per provided domain, with objectives. Presentation deck (PPT) included.",
    amount: "&#8377;10,000",
  },
  {
    no: "02",
    title: "Article, first objective",
    body: "Dataset collection, implementation and evaluation, figures and tables generation, and reviewer comments corrections.",
    amount: "&#8377;20,000",
    addOn: "+ &#8377;5,000 PPT preparation for presentation",
  },
  {
    no: "03",
    title: "Article, second objective",
    body: "Dataset collection, implementation and evaluation, figures and tables generation, and reviewer comments corrections.",
    amount: "&#8377;20,000",
    addOn: "+ &#8377;5,000 PPT preparation for presentation",
  },
  {
    no: "04",
    title: "Article, third objective",
    body: "Dataset collection, implementation and evaluation, figures and tables generation, and reviewer comments corrections.",
    amount: "&#8377;20,000",
    addOn: "+ &#8377;5,000 PPT preparation for presentation",
  },
];

/** One priced line. `last` drops the hairline so it does not double up with
 * the card's own bottom edge. */
function itemRow(item: Item, last: boolean): string {
  const edge = last ? "none" : `1px solid ${ROW_LINE}`;
  const pill = item.addOn
    ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:9px;">
          <tr>
            <td style="padding:5px 11px;border:1px dashed #ddd5c9;border-radius:40px;font-family:${MONO};font-size:11.5px;line-height:15px;mso-line-height-rule:exactly;color:${MUTED};white-space:nowrap;" class="s-pill">${item.addOn}</td>
          </tr>
        </table>`
    : "";

  return `
      <tr>
        <td class="s-no" width="34" valign="top" style="width:34px;padding:15px 0 15px 24px;border-bottom:${edge};font-family:${MONO};font-size:15px;line-height:22px;mso-line-height-rule:exactly;font-weight:500;color:${ACCENT};">${item.no}</td>
        <td class="s-mid" valign="top" style="padding:15px 14px 15px 12px;border-bottom:${edge};font-family:${SANS};">
          <div style="font-size:19px;line-height:23px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:-0.4px;color:${INK};">${item.title}</div>
          <p style="margin:6px 0 0;font-size:14px;line-height:20px;mso-line-height-rule:exactly;color:${BODY};">${item.body}</p>${pill}
        </td>
        <td class="s-amt" width="118" align="right" valign="top" style="width:118px;padding:15px 24px 15px 0;border-bottom:${edge};font-family:${SANS};font-size:26px;line-height:30px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:-0.8px;color:${INK};white-space:nowrap;">${item.amount}</td>
      </tr>`;
}

/**
 * One of the two payment cards, as the cell itself rather than a table nested
 * inside it. Two cells in one row are always the same height, which is the
 * only way to get equal cards without measuring text: a nested table would
 * shrink to its own content and leave one card short.
 *
 * The padding lives on an inner cell, not on this one. A table cell is sized
 * content-box, so 293px plus 18px of padding on each side is a 331px card, and
 * two of those plus the gutter is 676px of a message that is supposed to be
 * 600px wide.
 */
function paymentCard(label: string, heading: string, body: string): string {
  // 265 + 14 + 265 = 544, the sheet's width less its two 28px margins. A pair
  // sized for the full 600 would push the sheet itself out to 660.
  return `
        <td class="s-stack" width="265" valign="top" style="width:265px;background-color:${CARD};border:1px solid ${LINE};border-radius:12px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%">
            <tr>
              <td style="padding:16px 18px;font-family:${SANS}">
                <div style="font-family:${MONO};font-size:10px;line-height:14px;mso-line-height-rule:exactly;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED}">${label}</div>
                <div style="margin-top:7px;font-size:18px;line-height:22px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:-0.4px;color:${INK}">${heading}</div>
                <p style="margin:5px 0 0;font-size:13.5px;line-height:19px;mso-line-height-rule:exactly;color:${BODY}">${body}</p>
              </td>
            </tr>
          </table>
        </td>`;
}

const MARK_W = Math.round(WORDMARK_WIDTH / 2);
const MARK_H = Math.round(WORDMARK_HEIGHT / 2);

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Article Work Pricing</title>
<style>
  body { margin:0; padding:0; background-color:${PAGE}; -webkit-text-size-adjust:100%; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  @media only screen and (max-width:620px) {
    .w600 { width:100% !important; max-width:100% !important; }
    /* The two payment cards sit side by side on a desktop and under each
       other on a phone, where 300px each is too narrow to read. */
    /* border-box or the card's own 18px padding is added to the 100%, which
       pushes each stacked card a fraction wider than the screen. */
    .s-stack { display:block !important; width:100% !important; box-sizing:border-box !important; }
    /* Stacked, the spacer stops being a gutter and becomes the gap. */
    .s-gap { display:block !important; width:100% !important; height:14px !important; }
    /* At 390px the priced rows cannot keep desktop gutters and a 118px money
       column: the table would refuse to shrink and the amounts would be cut
       off the right edge. Narrower columns, smaller money, and the add-on
       pill allowed to wrap instead of holding one long line. */
    /* Fixed layout is the part that actually works: left to itself the table
       refuses to go below the widest thing in it and the money column ends up
       off the right edge of the screen. */
    .s-table { table-layout:fixed !important; }
    .s-no { padding-left:14px !important; }
    .s-mid { padding-right:8px !important; padding-left:10px !important; }
    .s-amt { width:84px !important; font-size:19px !important; line-height:24px !important; padding-right:14px !important; }
    .s-amth { width:84px !important; padding-right:14px !important; }
    .s-pill { white-space:normal !important; }
    /* table-layout:fixed sets a table's minimum width to the sum of its
       column widths, so a bar of three 200px cells pins the whole message at
       600px however narrow the screen is. Percentages have no such floor. */
    .s-bar { width:33.33% !important; }
    .s-payrow { table-layout:auto !important; }
    .s-pad { padding-left:18px !important; padding-right:18px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:${PAGE}">
<span style="display:none;font-size:1px;color:${PAGE};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">Pricing per deliverable: problem identification and three article objectives, in rupees.</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${PAGE}" style="width:100%;background-color:${PAGE};margin:0;padding:0">
<tr>
<!-- background= for the clients that only read the attribute, the CSS for the
     ones that only read the property. Outlook desktop reads neither on a cell
     and simply keeps bgcolor, which is the same near-black the website shows
     under the photograph, so it degrades to a flat dark sheet rather than to
     nothing. -->
<td align="center" background="${PAGE_IMAGE}" bgcolor="${PAGE}" valign="top" style="padding:30px 12px;background-color:${PAGE};background-image:url('${PAGE_IMAGE}');background-position:center top;background-repeat:no-repeat;background-size:cover">

<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="w600" cellpadding="0" cellspacing="0" border="0" width="600" bgcolor="${SHEET}" style="width:600px;max-width:600px;background-color:${SHEET};border:1px solid ${LINE};border-radius:18px;overflow:hidden">

  <!-- Header: mark, wordmark, hairline. The flier runs a gradient through the
       wordmark; a mail client cannot clip one to text, so it is the solid
       brown-gold that gradient passes through. -->
  <tr>
    <td class="s-pad" style="padding:28px 28px 18px 28px;border-bottom:1px solid ${LINE}">
<img src="cid:${WORDMARK_CID}" width="${MARK_W}" height="${MARK_H}" alt="Fiberarticle" style="display:block;width:${MARK_W}px;height:${MARK_H}px;border:0">
    </td>
  </tr>

  <!-- The priced items, one card with a banded header. -->
  <tr>
    <td class="s-pad" style="padding:26px 28px 0 28px">
      <table role="presentation" class="s-table" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background-color:${CARD};border:1px solid ${LINE};border-radius:16px">
        <tr>
          <td class="s-no" width="34" style="width:34px;padding:12px 0 12px 24px;background-color:${BAND};border-bottom:1px solid ${LINE};border-radius:16px 0 0 0;font-family:${MONO};font-size:10px;line-height:14px;mso-line-height-rule:exactly;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED}">No</td>
          <td class="s-mid" style="padding:12px 14px 12px 12px;background-color:${BAND};border-bottom:1px solid ${LINE};font-family:${MONO};font-size:10px;line-height:14px;mso-line-height-rule:exactly;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED}">Deliverable</td>
          <td class="s-amth" width="118" align="right" style="width:118px;padding:12px 24px 12px 0;background-color:${BAND};border-bottom:1px solid ${LINE};border-radius:0 16px 0 0;font-family:${MONO};font-size:10px;line-height:14px;mso-line-height-rule:exactly;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED}">Amount</td>
        </tr>${ITEMS.map((item, index) =>
          itemRow(item, index === ITEMS.length - 1)
        ).join("")}
      </table>
    </td>
  </tr>

  <!-- The two payment stages. table-layout:fixed so both stay 293px wide
       whatever the text does, and border-collapse:separate so each cell can
       carry its own border and corners. -->
  <tr>
    <td class="s-pad" style="padding:16px 28px 0 28px">
      <table role="presentation" class="s-payrow" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:separate">
        <tr>${paymentCard(
          "Payment, stage 1",
          "50% in advance",
          "Paid before work on the item begins."
        )}
          <td class="s-gap" width="14" style="width:14px;font-size:0;line-height:0">&nbsp;</td>${paymentCard(
            "Payment, stage 2",
            "50% on acceptance",
            "Paid after the paper is accepted into a scopus journal."
          )}
        </tr>
      </table>
    </td>
  </tr>

  <!-- Who pays the APC. The one thing on the flier a reader must not miss. -->
  <tr>
    <td class="s-pad" style="padding:16px 28px 0 28px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background-color:${BAND};border:1px solid ${LINE};border-radius:12px">
        <tr>
          <td width="46" valign="top" style="width:46px;padding:18px 0 18px 18px;font-family:${MONO};font-size:10px;line-height:16px;mso-line-height-rule:exactly;letter-spacing:1.4px;text-transform:uppercase;color:#985203">Note</td>
          <td valign="top" style="padding:16px 18px 18px 12px;font-family:${SANS};font-size:14px;line-height:21px;mso-line-height-rule:exactly;color:#3c352d">Fiberarticle is not responsible for paying the APC (Article Processing Charges). The APC must be paid by the scholar as per journal norms.</td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td class="s-pad" style="padding:20px 28px 14px 28px;font-family:${SANS};font-size:12.5px;line-height:18px;mso-line-height-rule:exactly;color:${BODY}">Questions about this quotation? Reply to <a href="mailto:${REPLY_TO}" style="color:#9a6b45;text-decoration:none;font-weight:700">${REPLY_TO}</a></td>
  </tr>

  <!-- The flier's three colour bar, bled to the full width of the sheet.
       6px rather than the flier's 3px so the outer cells can carry the card's
       corner: a browser clamps a radius to the box it is on, and 3px of height
       leaves nothing to curve. Outlook ignores radius entirely and shows a
       square bar under a square card, which is consistent. -->
  <tr>
    <td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed">
        <tr>
          <td class="s-bar" width="200" height="6" bgcolor="${ACCENT}" style="height:6px;line-height:6px;font-size:0;background-color:${ACCENT};border-radius:0 0 0 18px">&nbsp;</td>
          <td class="s-bar" width="200" height="6" bgcolor="#ff7db1" style="height:6px;line-height:6px;font-size:0;background-color:#ff7db1">&nbsp;</td>
          <td class="s-bar" width="200" height="6" bgcolor="#50c158" style="height:6px;line-height:6px;font-size:0;background-color:#50c158;border-radius:0 0 18px 0">&nbsp;</td>
        </tr>
      </table>
    </td>
  </tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->

</td>
</tr>
</table>
</body>
</html>
`;

const TEXT = [
  "FIBERARTICLE PRICING",
  "",
  "Priced per deliverable, in Indian rupees. Each item stands on its own.",
  "",
  "01. Problem identification - Rs 10,000",
  "    Problem identification as per provided domain, with objectives.",
  "    Presentation deck (PPT) included.",
  "",
  "02. Article, first objective - Rs 20,000",
  "    Dataset collection, implementation and evaluation, figures and tables",
  "    generation, and reviewer comments corrections.",
  "    + Rs 5,000 PPT preparation for presentation.",
  "",
  "03. Article, second objective - Rs 20,000",
  "    Dataset collection, implementation and evaluation, figures and tables",
  "    generation, and reviewer comments corrections.",
  "    + Rs 5,000 PPT preparation for presentation.",
  "",
  "04. Article, third objective - Rs 20,000",
  "    Dataset collection, implementation and evaluation, figures and tables",
  "    generation, and reviewer comments corrections.",
  "    + Rs 5,000 PPT preparation for presentation.",
  "",
  "PAYMENT",
  "Stage 1, 50% in advance. Paid before work on the item begins.",
  "Stage 2, 50% on acceptance. Paid after the paper is accepted into a scopus",
  "journal.",
  "",
  "NOTE",
  "Fiberarticle is not responsible for paying the APC (Article Processing",
  "Charges). The APC must be paid by the scholar as per journal norms.",
  "",
  "Questions about this quotation? Reply to admin@fiberarticle.com",
].join("\n");

/** The quotation as sent. Takes no arguments: every recipient gets the same
 * document, which is what makes it a price list and not a proposal. */
export function pricingQuotationEmail(): RenderedEmail {
  return {
    subject: "Article Work Pricing",
    html: HTML,
    text: TEXT,
  };
}
