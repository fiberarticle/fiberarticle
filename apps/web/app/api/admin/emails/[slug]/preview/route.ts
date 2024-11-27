import { currentAdmin } from "@/lib/admin-server";
import { findCampaign } from "@/lib/emails/catalog";
import { LOGO_BASE64, LOGO_CID, LOGO_CONTENT_TYPE } from "@/lib/emails/logo";
import {
  WORDMARK_BASE64,
  WORDMARK_CID,
  WORDMARK_CONTENT_TYPE,
} from "@/lib/emails/wordmark";

/**
 * Renders one sendable email so the admin screen can show it in an iframe.
 *
 * What comes back is what Resend would be handed, with two changes that exist
 * only because a browser is not a mail client: the cid: images become data
 * URIs, and the frame gets the app's scrollbar. Both are noted below.
 *
 * Note this route is NOT the dev-only one under /dev/emails: this has to work
 * in production, which is the entire point of a screen for sending mail to a
 * real prospect. The admin check above takes the place of the dev-only guard,
 * and it is the same check the page itself makes.
 */

/** The bytes a mail client resolves against the inline attachments. */
const INLINE_IMAGES = [
  { cid: LOGO_CID, base64: LOGO_BASE64, contentType: LOGO_CONTENT_TYPE },
  {
    cid: WORDMARK_CID,
    base64: WORDMARK_BASE64,
    contentType: WORDMARK_CONTENT_TYPE,
  },
] as const;

/**
 * The app's scrollbar, restated for the frame.
 *
 * The preview is a document of its own, so nothing in globals.css reaches
 * inside it and Windows draws its default bar: a white track with arrow
 * buttons at both ends, which looks nothing like the rest of the product.
 * These are the same rules globals.css applies, with the colour written out
 * because the email has none of the app's custom properties, and light because
 * it floats over the dark backdrop.
 *
 * Preview only: injected into the head of the copy this route serves, never
 * into the message itself.
 */
const PREVIEW_SCROLLBAR = `<style>
  html, body { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.32) #050406; background-color: #050406; }
  ::-webkit-scrollbar { width: 10px; height: 10px; background: #050406; }
  ::-webkit-scrollbar-track { background: #050406; }
  ::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.28);
    border-radius: 9999px;
    border: 3px solid #050406;
    background-clip: content-box;
    min-height: 48px;
  }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.5); border: 3px solid #050406; background-clip: content-box; }
  ::-webkit-scrollbar-corner { background: #050406; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
</style>`;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  // 404, not 403: an address that answers differently for an admin tells an
  // anonymous caller the route is there at all.
  const notFound = () =>
    new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });

  if (!(await currentAdmin())) return notFound();

  const { slug } = await params;
  const campaign = findCampaign(slug);
  if (!campaign) return notFound();

  // A browser cannot resolve a cid: reference, which a mail client answers
  // from the attachment travelling with the message, so the preview carries
  // the same bytes as a data URI instead.
  let html = campaign.build().html;
  for (const image of INLINE_IMAGES) {
    html = html.replaceAll(
      `cid:${image.cid}`,
      `data:${image.contentType};base64,${image.base64}`
    );
  }
  html = html.includes("</head>")
    ? html.replace("</head>", `${PREVIEW_SCROLLBAR}</head>`)
    : html + PREVIEW_SCROLLBAR;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Never cached at any hop and never indexed: it is account-adjacent
      // marketing markup served off our own domain.
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
