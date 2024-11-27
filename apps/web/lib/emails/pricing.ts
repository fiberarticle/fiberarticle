import type { RenderedEmail } from "./shell";

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
 *   - the wordmark is real text, carrying the app's gradient in Apple Mail
 *     and solid brown-gold in Gmail and Outlook, which support neither the
 *     gradient nor the app's webfont
 *   - the mark is a small PNG served from the app, since no common mail
 *     client draws an SVG and an attached one shows up in Gmail's attachment
 *     strip. It is the only thing the message fetches: the backdrop is drawn
 *     with gradients rather than downloaded as the website's photograph
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
/** The wordmark's colour where a client cannot paint the app's gradient. */
const BRAND = "#b3782d";


/**
 * The sheet sits on this: the near-black of the website's pricing page with
 * its warm glow drawn in, not photographed.
 *
 * The website paints an arc of light across a dark field. That photograph is
 * 133 KB on a server, which means the mail would fetch something every time it
 * is opened. These two radial gradients evoke the same light for nothing: no
 * file, no request, no wait. Outlook understands neither and keeps PAGE, which
 * is the colour the website itself shows while its photograph loads.
 */
const PAGE = "#050406";
const PAGE_GLOW =
  "radial-gradient(115% 85% at 116% 74%,rgba(255,138,32,0.50) 0%,rgba(198,58,18,0.26) 34%,rgba(5,4,6,0) 64%)," +
  "radial-gradient(85% 62% at -12% 16%,rgba(206,58,24,0.30) 0%,rgba(5,4,6,0) 58%)";
/** The flier's own paper. The sheet sits on the backdrop; only the margin
 * around it shows the photograph, the way the flier sits on a desk. */
const SHEET = "#f8f5f0";

/**
 * The watermark behind the priced table.
 *
 * Served from the app rather than attached, because an attachment cannot be a
 * CSS background in a mail client. Pre-faded to five percent and baked onto
 * the card colour, since neither opacity nor a transparent PNG can be relied
 * on behind text. Outlook ignores background images altogether and shows the
 * plain card, which is a quiet way to lose a decoration.
 */
/** The engraved figures: banknote green, a lit top edge, and a soft drop.
 * Apple Mail and iOS draw the relief. Gmail and Outlook drop text shadows and
 * show flat ink, which is why the colour is declared on its own. */
const PRICE_INK = "#1e4d34";
const PRICE_RELIEF =
  "text-shadow:0 1px 0 rgba(255,255,255,0.92),0 2px 1px rgba(20,62,42,0.30);";

/** The marker behind the word Note. A filled cell, not a brush stroke: the
 * stroke had to be a picture, and this message carries none. */
const HIGHLIGHT = "#f8d878";

/** The small labels. A size up from 10px and browner than the old grey. */
const LABEL = "#6b5233";

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
    body: "Problem identification as per provided domain, with objectives. Presentation (PPT) included.",
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
            <td style="padding:5px 11px;border:1px dashed #ddd5c9;border-radius:40px;font-family:${MONO};font-size:11.5px;line-height:15px;mso-line-height-rule:exactly;color:${MUTED};white-space:nowrap;" class="s-pill mut">${item.addOn}</td>
          </tr>
        </table>`
    : "";

  return `
      <tr>
        <td class="s-no acc" width="34" valign="top" style="width:34px;padding:15px 0 15px 24px;border-bottom:${edge};font-family:${MONO};font-size:15px;line-height:22px;mso-line-height-rule:exactly;font-weight:500;color:${ACCENT};">${item.no}</td>
        <td class="s-mid" valign="top" style="padding:15px 14px 15px 12px;border-bottom:${edge};font-family:${SANS};">
          <div class="ink" style="font-size:19px;line-height:23px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:-0.4px;color:${INK};">${item.title}</div>
          <p class="txt" style="margin:6px 0 0;font-size:14px;line-height:20px;mso-line-height-rule:exactly;color:${BODY};">${item.body}</p>${pill}
        </td>
        <td class="s-amt amt" width="118" align="right" valign="top" style="width:118px;padding:15px 24px 15px 0;border-bottom:${edge};font-family:${SANS};font-size:27px;line-height:32px;mso-line-height-rule:exactly;font-weight:600;letter-spacing:-0.6px;color:${PRICE_INK};${PRICE_RELIEF}white-space:nowrap;">${item.amount}</td>
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
        <td class="s-stack card" width="265" valign="top" style="width:265px;background-color:${CARD};border:1px solid ${LINE};border-radius:12px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%">
            <tr>
              <td style="padding:16px 18px;font-family:${SANS}">
                <div class="lbl" style="font-family:${MONO};font-size:11px;line-height:15px;mso-line-height-rule:exactly;letter-spacing:1.5px;text-transform:uppercase;color:${LABEL}">${label}</div>
                <div class="ink" style="margin-top:7px;font-size:18px;line-height:22px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:-0.4px;color:${INK}">${heading}</div>
                <p class="txt" style="margin:5px 0 0;font-size:13.5px;line-height:19px;mso-line-height-rule:exactly;color:${BODY}">${body}</p>
              </td>
            </tr>
          </table>
        </td>`;
}

/**
 * The mark, served from the app rather than attached to the message.
 *
 * It has to be a picture at all because no common mail client draws an SVG.
 * Attaching it works, but Gmail then lists it under the mail as "One
 * attachment", which looks wrong on a quotation and cannot be turned off: an
 * inline attachment is still an attachment. Serving it is what every
 * professional sender does, and Gmail fetches it through its own cache rather
 * than exposing the reader to us.
 *
 * EMAIL_ASSET_BASE exists for a staging host. The default is production,
 * never the app's own origin, because a mail is read long after it was sent
 * and a developer machine's localhost is unreachable from an inbox.
 */
const ASSET_BASE = (
  process.env.EMAIL_ASSET_BASE ?? "https://app.fiberarticle.com"
).replace(/\/$/, "");
const MARK_SRC = `${ASSET_BASE}/email/mark.png`;
/** Half the file's natural size, which is 2x for retina screens. */
const MARK_W = 42;
const MARK_H = 42;

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Article Work Pricing</title>
<style>
  /* "only" is the strong form: it tells a client this message has no dark
     variant at all, so the well behaved ones skip their repaint entirely. */
  :root { color-scheme: light only; supported-color-schemes: light; }
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
  /* Dark mode.
     Gmail and Outlook.com repaint a message when the reader is in dark mode:
     light panels go dark and dark text goes light. They cannot repaint a
     picture, and our wordmark is a picture with the paper colour baked into
     it, so a repainted card would leave a pale rectangle sitting on a dark
     one. This document is a light sheet on a dark backdrop of its own and is
     meant to look the same either way.

     The meta tags and color-scheme above ask clients not to repaint. These
     rules put every colour back for the ones that do it anyway, and the
     data-ogsc and data-ogsb copies do the same for Outlook.com, which
     rewrites the message with those attributes instead of honouring the
     media query. */
  @media (prefers-color-scheme: dark) {
    .sheet { background-color:${SHEET} !important; }
    .card { background-color:${CARD} !important; }
    .band { background-color:${BAND} !important; }
    .ink { color:${INK} !important; }
    .txt { color:${BODY} !important; }
    .mut { color:${MUTED} !important; }
    .acc { color:${ACCENT} !important; }
    .ntl { color:#985203 !important; }
    .nte { color:#3c352d !important; }
    .lnk { color:#9a6b45 !important; }
    .lbl { color:${LABEL} !important; }
    .mark { background-color:${HIGHLIGHT} !important; color:#7a3f02 !important; }
    .ntl { color:#8a4a03 !important; }
    .amt { color:${PRICE_INK} !important; }
    /* Both properties, because the gradient rule below sets the fill colour
       separately and a repainting client must not be left with an invisible
       word. */
    .wm { color:${BRAND} !important; -webkit-text-fill-color:${BRAND} !important; }
  }
  [data-ogsc] .sheet, [data-ogsb] .sheet { background-color:${SHEET} !important; }
  [data-ogsc] .card, [data-ogsb] .card { background-color:${CARD} !important; }
  [data-ogsc] .band, [data-ogsb] .band { background-color:${BAND} !important; }
  [data-ogsc] .ink { color:${INK} !important; }
  [data-ogsc] .txt { color:${BODY} !important; }
  [data-ogsc] .mut { color:${MUTED} !important; }
  [data-ogsc] .acc { color:${ACCENT} !important; }
  [data-ogsc] .ntl { color:#985203 !important; }
  [data-ogsc] .nte { color:#3c352d !important; }
  [data-ogsc] .lnk { color:#9a6b45 !important; }
  [data-ogsc] .lbl { color:${LABEL} !important; }
  [data-ogsc] .mark, [data-ogsb] .mark { background-color:${HIGHLIGHT} !important; color:#7a3f02 !important; }
  [data-ogsc] .amt { color:${PRICE_INK} !important; }
  [data-ogsc] .wm { color:${BRAND} !important; -webkit-text-fill-color:${BRAND} !important; }
  /* The app paints "Fiberarticle" as a gradient clipped to the letters. Apple
     Mail and iOS can do the same. Gmail and Outlook support neither the clip
     nor @supports, so they drop this block and keep the solid brown declared
     on the cell. Guarded on purpose: applied unconditionally, a client that
     honours the transparent fill but not the clip would show no word at all. */
  @supports (-webkit-background-clip: text) or (background-clip: text) {
    .wm {
      background-image: linear-gradient(90deg,#b3782d 0%,#c2842b 62%,#fca91e 100%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
    }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:${PAGE}">
<!-- The preheader: the line Gmail and Apple Mail print next to the subject
     in the message list. Hidden in the message itself. -->
<span style="display:none;font-size:1px;color:${PAGE};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">Thank you for your interest in Fiberarticle. Here is our pricing for article work, in Indian rupees.</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${PAGE}" style="width:100%;background-color:${PAGE};margin:0;padding:0">
<tr>
<td align="center" bgcolor="${PAGE}" valign="top" style="padding:30px 12px;background-color:${PAGE};background-image:${PAGE_GLOW}">

<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="w600 sheet" cellpadding="0" cellspacing="0" border="0" width="600" bgcolor="${SHEET}" style="width:600px;max-width:600px;background-color:${SHEET};border:1px solid ${LINE};border-radius:18px;overflow:hidden">

  <!-- Header: mark, wordmark, hairline. The flier runs a gradient through the
       wordmark; a mail client cannot clip one to text, so it is the solid
       brown-gold that gradient passes through. -->
  <tr>
    <td class="s-pad" style="padding:28px 28px 18px 28px;border-bottom:1px solid ${LINE}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="${MARK_W}" style="width:${MARK_W}px;padding-right:10px;vertical-align:middle"><img src="${MARK_SRC}" width="${MARK_W}" height="${MARK_H}" alt="Fiberarticle" style="display:block;width:${MARK_W}px;height:${MARK_H}px;border:0"></td>
          <td class="wm" style="vertical-align:middle;font-family:${SANS};font-size:26px;line-height:32px;mso-line-height-rule:exactly;font-weight:600;letter-spacing:-0.5px;color:${BRAND}">Fiberarticle</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- The priced items, one card with a banded header. -->
  <tr>
    <td class="s-pad" style="padding:26px 28px 0 28px">
      <table role="presentation" class="s-table card" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background-color:${CARD};background-image:repeating-linear-gradient(135deg,rgba(154,107,69,0.05) 0 1px,transparent 1px 10px);border:1px solid ${LINE};border-radius:16px">
        <tr>
          <td class="s-no band lbl" width="34" style="width:34px;padding:13px 0 13px 24px;background-color:${BAND};border-bottom:1px solid ${LINE};border-radius:16px 0 0 0;font-family:${MONO};font-size:11px;line-height:15px;mso-line-height-rule:exactly;letter-spacing:1.5px;text-transform:uppercase;color:${LABEL}">No</td>
          <td class="s-mid band lbl" style="padding:13px 14px 13px 12px;background-color:${BAND};border-bottom:1px solid ${LINE};font-family:${MONO};font-size:11px;line-height:15px;mso-line-height-rule:exactly;letter-spacing:1.5px;text-transform:uppercase;color:${LABEL}">Deliverable</td>
          <td class="s-amth band lbl" width="118" align="right" style="width:118px;padding:13px 24px 13px 0;background-color:${BAND};border-bottom:1px solid ${LINE};border-radius:0 16px 0 0;font-family:${MONO};font-size:11px;line-height:15px;mso-line-height-rule:exactly;letter-spacing:1.5px;text-transform:uppercase;color:${LABEL}">Amount</td>
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
          <td class="band" width="76" align="center" valign="middle" style="width:76px;padding:18px 8px 18px 14px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate">
              <tr>
                <td class="mark" bgcolor="${HIGHLIGHT}" align="center" style="padding:5px 10px;background-color:${HIGHLIGHT};border-radius:5px;font-family:${MONO};font-size:11px;line-height:15px;mso-line-height-rule:exactly;letter-spacing:1.5px;text-transform:uppercase;color:#7a3f02">Note</td>
              </tr>
            </table>
          </td>
          <td class="band nte" valign="middle" style="padding:18px 18px 18px 14px;font-family:${SANS};font-size:14px;line-height:21px;mso-line-height-rule:exactly;color:#3c352d">Fiberarticle is not responsible for paying the APC (Article Processing Charges). The APC must be paid by the scholar as per journal norms.</td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td class="s-pad txt" style="padding:20px 28px 14px 28px;font-family:${SANS};font-size:12.5px;line-height:18px;mso-line-height-rule:exactly;color:${BODY}">Questions about this quotation? Reply to <a class="lnk" href="mailto:${REPLY_TO}" style="color:#9a6b45;text-decoration:none;font-weight:700">${REPLY_TO}</a></td>
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

/**
 * The plain-text copy of the same quotation.
 *
 * Every message carries two copies: this one and the designed one. A message
 * with only markup scores badly with spam filters, and a screen reader or a
 * watch is handed this copy instead, so it cannot be dropped.
 *
 * It is written as a letter rather than as a dump of the priced table,
 * because it is also what an inbox prints beside the subject line. Gmail
 * takes that grey preview line from here and not from the markup, so the
 * first sentence has to read like something a person wrote.
 */
const TEXT = [
  "Thank you for your interest in Fiberarticle. Here is our pricing for article work, in Indian rupees. Each item stands on its own, so you can take one of them or all of them.",
  "",
  "PROBLEM IDENTIFICATION, Rs 10,000",
  "The problem is identified for the domain you provide, along with the",
  "objectives. Presentation (PPT) included.",
  "",
  "ARTICLE, FIRST OBJECTIVE, Rs 20,000",
  "Dataset collection, implementation and evaluation, generation of the",
  "figures and tables, and corrections for the reviewer comments.",
  "Add Rs 5,000 for the PPT preparation for the presentation.",
  "",
  "ARTICLE, SECOND OBJECTIVE, Rs 20,000",
  "Dataset collection, implementation and evaluation, generation of the",
  "figures and tables, and corrections for the reviewer comments.",
  "Add Rs 5,000 for the PPT preparation for the presentation.",
  "",
  "ARTICLE, THIRD OBJECTIVE, Rs 20,000",
  "Dataset collection, implementation and evaluation, generation of the",
  "figures and tables, and corrections for the reviewer comments.",
  "Add Rs 5,000 for the PPT preparation for the presentation.",
  "",
  "PAYMENT",
  "The payment is in two halves. Fifty percent in advance, before the work on",
  "an item begins, and the remaining fifty percent once the paper is accepted",
  "into a scopus journal.",
  "",
  "PLEASE NOTE",
  "Fiberarticle does not pay the APC, the Article Processing Charges. That is",
  "paid by the scholar as per the norms of the journal.",
  "",
  "If you have any questions about this quotation, simply reply to this mail",
  "or write to admin@fiberarticle.com.",
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
