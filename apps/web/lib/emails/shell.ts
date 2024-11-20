/**
 * Shared chrome for every Fiberarticle transactional email.
 *
 * Email clients do not run a layout engine we can trust, so these templates
 * are 600px tables with inline styles only. The head block, the four colour
 * bar, and the dark brand header are byte-identical across all four emails,
 * so they live here once instead of being copy-pasted per template.
 *
 * Light is the default; the `d-*` class names are the dark variant applied by
 * the prefers-color-scheme block. The `s-*` names are the mobile overrides.
 */

import { LOGO_CID } from "./logo";

const SANS =
  "'Bricolage Grotesque','Helvetica Neue',Helvetica,Arial,'Segoe UI',Roboto,sans-serif";
const MONO = "'IBM Plex Mono','SFMono-Regular',Consolas,'Courier New',monospace";

/** What every template returns, ready to hand to sendEmail. */
export interface RenderedEmail {
  subject: string;
  html: string;
  /** Plain-text twin. Never optional: text-only clients and spam scoring
   * both punish an HTML-only message. */
  text: string;
}

/** Escapes anything interpolated into markup or an attribute value. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Base URL of the web app. Every link and the logo resolve against it, so a
 * dev preview points at localhost and production points at the real domain
 * without touching the templates.
 */
export function appUrl(): string {
  return (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  );
}

/**
 * Source for the header logo: the inline attachment carried by the message
 * itself, not a link to our host. sendEmail attaches the bytes whenever the
 * markup references this id. PNG rather than SVG, which mail clients do not
 * render.
 */
export function logoSrc(): string {
  return `cid:${LOGO_CID}`;
}

/** Timestamps are rendered in IST, the timezone the product is operated in. */
export function formatWhen(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const meridiem = get("dayPeriod").toUpperCase().replace(/\./g, "");
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get(
    "minute"
  )} ${meridiem} IST`;
}

/**
 * A human label for the device that made the request, from its User-Agent.
 *
 * Deliberately small: this line exists so a reader can recognise their own
 * request, not to fingerprint anything. Anything unrecognised degrades to a
 * generic label rather than dumping a raw UA string into the email.
 */
export function deviceFrom(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const ua = userAgent;

  let browser = "";
  if (/\bEdg[A-Z]?\//.test(ua)) browser = "Edge";
  else if (/\bOPR\/|\bOpera\//.test(ua)) browser = "Opera";
  else if (/\bChrome\/|\bCriOS\//.test(ua)) browser = "Chrome";
  else if (/\bFirefox\/|\bFxiOS\//.test(ua)) browser = "Firefox";
  else if (/\bSafari\//.test(ua)) browser = "Safari";

  let os = "";
  if (/\bWindows NT\b/.test(ua)) os = "Windows";
  else if (/\biPhone\b|\biPad\b|\biPod\b/.test(ua)) os = "iOS";
  else if (/\bAndroid\b/.test(ua)) os = "Android";
  else if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) os = "macOS";
  else if (/\bCrOS\b/.test(ua)) os = "ChromeOS";
  else if (/\bLinux\b/.test(ua)) os = "Linux";

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;
  return "Unknown device";
}

const PREHEADER_SPACER =
  "&nbsp;&#847;&zwnj;".repeat(10);

const HEAD_STYLE = `
  html,body{margin:0 !important;padding:0 !important;height:100% !important;width:100% !important;}
  *{-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;}
  table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;}
  img{-ms-interpolation-mode:bicubic;border:0;height:auto;line-height:100%;outline:none;text-decoration:none;}
  a{color:#8A4A03;}
  a:hover{color:#181005;}
  .btn:hover{background:#F9F7F3 !important;}
  @media only screen and (max-width:620px){
    .sh{padding-left:24px !important;padding-right:24px !important;}
    .sv{padding-top:32px !important;padding-bottom:34px !important;}
    .s-h1{font-size:28px !important;line-height:33px !important;letter-spacing:-0.7px !important;}
    .s-digit{font-size:26px !important;padding:14px 0 !important;}
    .s-block{display:block !important;width:100% !important;}
    .s-btn a{display:block !important;}
    .s-hide{display:none !important;}
    .s-stack{display:block !important;width:100% !important;padding:0 0 16px 0 !important;}
  }
  @media (prefers-color-scheme:dark){
    .d-page{background:#0F0A03 !important;}
    .d-card{background:#20170A !important;border-color:#6E5220 !important;}
    .d-ink{color:#FCF5E8 !important;}
    .d-body{color:#E3D5BC !important;}
    .d-muted{color:#BFAB88 !important;}
    .d-panel{background:#2C2009 !important;border-color:#7C5C1E !important;}
    .d-alert{background:#331523 !important;border-color:#933C60 !important;}
    .d-accent{color:#FCA91E !important;}
    .d-rule{background:#6E5220 !important;}
    .d-tile{background:#33250C !important;border-color:#8A6624 !important;color:#FCA91E !important;}
    .d-num{background:#FCA91E !important;border-color:#3E2C0D !important;color:#181005 !important;}
    .d-btn{background:#FCF5E8 !important;border-color:#E4D8BF !important;border-bottom-color:#C3B292 !important;}
    .d-btn a{color:#181005 !important;}
    .d-btn2{background:#2C2009 !important;border-color:#7C5C1E !important;border-bottom-color:#5E441A !important;}
    .d-btn2 a{color:#FCF5E8 !important;}
  }`;

export interface ShellOptions {
  /** Subject line; also the document title. */
  title: string;
  /** Hidden line inboxes show next to the subject. */
  preheader: string;
  /** Small uppercase tag on the right of the dark header. */
  headerTag: string;
  /** Body rows: `<tr>` elements for the inner content table. */
  rows: string;
}

/** Wraps body rows in the shared page, card, and header chrome. */
export function renderShell({
  title,
  preheader,
  headerTag,
  rows,
}: ShellOptions): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&amp;display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&amp;display=swap" rel="stylesheet">
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch><o:AllowPNG/></o:OfficeDocumentSettings></xml>
<style>*{font-family:Helvetica,Arial,sans-serif !important;} .mso-mono{font-family:Consolas,'Courier New',monospace !important;}</style>
<![endif]-->
<style>${HEAD_STYLE}
</style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#F3E7D2;" bgcolor="#F3E7D2" class="d-page">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(
    preheader
  )}${PREHEADER_SPACER}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3E7D2" class="d-page" style="width:100%;background-color:#F3E7D2;">
<tr><td align="center" style="padding:34px 12px 44px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td style="padding:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" class="d-card" style="width:100%;border-collapse:separate;background-color:#FFFFFF;border:3px solid #181005;border-radius:20px;overflow:hidden;">
<tr><td style="padding:0;font-size:0;line-height:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;">
<tr>
<td width="252" height="10" bgcolor="#FCA91E" style="width:252px;height:10px;background:#FCA91E;font-size:0;line-height:10px;">&nbsp;</td>
<td width="114" height="10" bgcolor="#50C158" style="width:114px;height:10px;background:#50C158;font-size:0;line-height:10px;">&nbsp;</td>
<td width="114" height="10" bgcolor="#FF7DB1" style="width:114px;height:10px;background:#FF7DB1;font-size:0;line-height:10px;">&nbsp;</td>
<td width="114" height="10" bgcolor="#4F90E4" style="width:114px;height:10px;background:#4F90E4;font-size:0;line-height:10px;">&nbsp;</td>
</tr></table></td></tr>
<tr><td bgcolor="#181005" class="sh" style="background:#181005;padding:24px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
<tr>
<td width="40" style="width:40px;padding:0 13px 0 0;vertical-align:middle;"><img src="${esc(
    logoSrc()
  )}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;"></td>
<td align="left" style="vertical-align:middle;font-family:${SANS};font-size:24px;line-height:27px;mso-line-height-rule:exactly;font-weight:600;letter-spacing:-0.5px;color:#FCA91E;">Fiberarticle</td>
<td align="right" class="s-hide" style="vertical-align:middle;font-family:${SANS};font-size:11px;line-height:15px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:1.7px;text-transform:uppercase;color:#B49A6D;">${esc(
    headerTag
  )}</td>
</tr></table></td></tr>
<tr><td class="sv" style="padding:44px 0 46px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
${rows}
</table></td></tr>
</table></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`;
}

/* -------------------------------------------------------------------------
 * Row builders. Each returns one `<tr>` for the inner content table.
 * ---------------------------------------------------------------------- */

/** Small uppercase accent line above the headline. */
export function eyebrow(text: string): string {
  return `<tr><td class="sh d-accent" style="padding:0 44px 12px 44px;font-family:${SANS};font-size:11px;line-height:15px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#8A4A03;">${esc(
    text
  )}</td></tr>`;
}

export function headline(text: string): string {
  return `<tr><td class="sh s-h1 d-ink" style="padding:0 44px;font-family:${SANS};font-size:36px;line-height:42px;mso-line-height-rule:exactly;font-weight:600;letter-spacing:-0.9px;color:#181005;text-wrap:pretty;">${esc(
    text
  )}</td></tr>`;
}

/** Body copy. `html` is inserted as-is: callers escape their own values. */
export function paragraph(html: string, topPadding = 18): string {
  return `<tr><td class="sh d-body" style="padding:${topPadding}px 44px 0 44px;font-family:${SANS};font-size:17px;line-height:28px;mso-line-height-rule:exactly;font-weight:500;color:#3D3020;text-wrap:pretty;">${html}</td></tr>`;
}

/** Inline emphasis for a value inside body copy (an email address). */
export function strong(text: string): string {
  return `<strong style="font-weight:700;color:#181005;" class="d-ink">${esc(
    text
  )}</strong>`;
}

export function rule(topPadding = 30, bottomPadding = 26): string {
  return `<tr><td class="sh" style="padding:${topPadding}px 44px ${bottomPadding}px 44px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td height="2" bgcolor="#CBBFA8" class="d-rule" style="height:2px;background:#CBBFA8;font-size:0;line-height:2px;">&nbsp;</td></tr></table></td></tr>`;
}

/**
 * Call to action. `primary` is the white button, `secondary` the sand one
 * used when the action is a recovery step rather than the happy path.
 */
export function button(
  href: string,
  label: string,
  variant: "primary" | "secondary" = "primary",
  topPadding = 30
): string {
  const bg = variant === "primary" ? "#FFFFFF" : "#F7F4EE";
  const darkClass = variant === "primary" ? "d-btn" : "d-btn2";
  return `<tr><td class="sh" style="padding:${topPadding}px 44px 0 44px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" class="s-btn s-block" style="border-collapse:separate;">
<tr><td align="center" bgcolor="${bg}" class="btn ${darkClass}" style="background:${bg};border:1px solid #D5C9B2;border-bottom:2px solid #B6A788;border-radius:8px;padding:13px 22px;mso-padding-alt:13px 22px;text-align:center;box-shadow:inset 0 1px 0 #FFFFFF, 0 1px 2px rgba(24,16,5,0.14);">
<a href="${esc(
    href
  )}" style="font-family:${SANS};font-size:15.5px;line-height:20px;mso-line-height-rule:exactly;font-weight:600;letter-spacing:-0.1px;color:#181005;text-decoration:none;">${esc(
    label
  )}</a>
</td></tr></table></td></tr>`;
}

/** The copy-and-paste URL panel that backs up every button. */
export function urlPanel(href: string, topPadding = 16): string {
  return `<tr><td class="sh" style="padding:${topPadding}px 44px 0 44px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3E7D2" class="d-panel" style="width:100%;border-collapse:separate;background-color:#F3E7D2;border:2px solid #CBBFA8;border-radius:10px;">
<tr><td style="padding:14px 16px;font-family:${MONO};font-size:13px;line-height:22px;mso-line-height-rule:exactly;font-weight:500;word-break:break-all;" class="mso-mono">
<a href="${esc(href)}" style="color:#8A4A03;text-decoration:none;" class="d-accent">${esc(
    href
  )}</a></td></tr></table></td></tr>`;
}

/**
 * Boxed notice. `info` is the warm sand box, `alert` the pink one reserved
 * for "this was not you" copy.
 */
export function notice(
  label: string,
  body: string,
  tone: "info" | "alert" = "info",
  topPadding = 28
): string {
  const bg = tone === "alert" ? "#FFEAF1" : "#FFF6E6";
  const darkClass = tone === "alert" ? "d-alert" : "d-panel";
  return `<tr><td class="sh" style="padding:${topPadding}px 44px 0 44px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" class="${darkClass}" style="width:100%;border-collapse:separate;background-color:${bg};border:2px solid #181005;border-radius:14px;">
<tr><td style="padding:22px 26px 24px 26px;">
<div class="d-ink" style="font-family:${SANS};font-size:11px;line-height:15px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#181005;">${esc(
    label
  )}</div>
<div class="d-body" style="padding-top:10px;font-family:${SANS};font-size:16px;line-height:26px;mso-line-height-rule:exactly;font-weight:500;color:#3D3020;text-wrap:pretty;">${body}</div>
</td></tr></table></td></tr>`;
}

/** Label/value table inside a boxed panel: request and event details. */
export function detailPanel(
  label: string,
  entries: Array<[string, string]>,
  topPadding = 28
): string {
  const rows = entries
    .map(([key, value], index) => {
      const last = index === entries.length - 1;
      const pad = last ? "0px" : "13px";
      return `<tr>
<td width="150" class="s-stack d-muted" style="width:150px;padding:0 18px ${pad} 0;vertical-align:top;font-family:${SANS};font-size:11px;line-height:24px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#6E5C43;">${esc(
        key
      )}</td>
<td class="s-stack d-ink" style="padding:0 0 ${pad} 0;vertical-align:top;font-family:${SANS};font-size:16px;line-height:24px;mso-line-height-rule:exactly;font-weight:600;color:#181005;">${esc(
        value
      )}</td>
</tr>`;
    })
    .join("");
  return `<tr><td class="sh" style="padding:${topPadding}px 44px 0 44px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFF6E6" class="d-panel" style="width:100%;border-collapse:separate;background-color:#FFF6E6;border:2px solid #181005;border-radius:14px;">
<tr><td style="padding:24px 26px;">
<div class="d-accent" style="font-family:${SANS};font-size:11px;line-height:15px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#8A4A03;padding-bottom:16px;">${esc(
    label
  )}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">${rows}</table>
</td></tr></table></td></tr>`;
}

/** One tile per character of the verification code. */
export function otpTiles(code: string, topPadding = 30): string {
  const digits = code.split("");
  const cells = digits
    .map(
      (digit, index) =>
        `${
          index === 0
            ? ""
            : '<td width="9" style="width:9px;font-size:0;line-height:0;">&nbsp;</td>'
        }<td align="center" bgcolor="#FFFFFF" class="s-digit d-tile" style="background:#FFFFFF;border:2px solid #181005;border-radius:11px;padding:16px 0;font-family:${MONO};font-size:32px;line-height:36px;mso-line-height-rule:exactly;font-weight:600;color:#181005;text-align:center;">${esc(
          digit
        )}</td>`
    )
    .join("");
  return `<tr><td class="sh" style="padding:${topPadding}px 44px 0 44px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;"><tr>${cells}</tr></table>
</td></tr>`;
}

export interface NumberedStep {
  /** Tile colour, from the brand palette. */
  color: string;
  title: string;
  body: string;
}

/** The numbered walkthrough used by the welcome email. */
export function numberedSteps(steps: NumberedStep[]): string {
  const items = steps
    .map((step, index) => {
      const last = index === steps.length - 1;
      return `<tr><td style="padding:0 0 ${last ? "0px" : "20px"} 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
<tr>
<td width="40" valign="top" style="width:40px;padding:2px 16px 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
<tr><td width="40" height="40" align="center" bgcolor="${step.color}" class="d-num" style="width:40px;height:40px;background:${step.color};border:2px solid #181005;border-radius:11px;font-family:${SANS};font-size:18px;line-height:36px;mso-line-height-rule:exactly;font-weight:800;color:#181005;text-align:center;">${index + 1}</td></tr>
</table></td>
<td valign="top" style="padding:0;">
<div class="d-ink" style="font-family:${SANS};font-size:18px;line-height:25px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:-0.4px;color:#181005;">${esc(
        step.title
      )}</div>
<div class="d-body" style="padding-top:6px;font-family:${SANS};font-size:16px;line-height:26px;mso-line-height-rule:exactly;font-weight:500;color:#3D3020;text-wrap:pretty;">${esc(
        step.body
      )}</div>
</td></tr></table></td></tr>`;
    })
    .join("");
  return `<tr><td class="sh" style="padding:0 44px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">${items}</table></td></tr>`;
}

/** Small print at the bottom of the card. */
export function footnote(html: string): string {
  return `<tr><td class="sh d-muted" style="padding:0 44px;font-family:${SANS};font-size:13px;line-height:21px;mso-line-height-rule:exactly;font-weight:500;color:#6E5C43;">${html}</td></tr>`;
}

/** Inline link styled for the footnote row. */
export function inlineLink(href: string, label: string): string {
  return `<a href="${esc(
    href
  )}" style="color:#8A4A03;font-weight:700;text-decoration:underline;" class="d-accent">${esc(
    label
  )}</a>`;
}
