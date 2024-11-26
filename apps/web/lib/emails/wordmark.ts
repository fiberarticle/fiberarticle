/**
 * The header lockup: the mark and the wordmark as one image.
 *
 * The app paints "Fiberarticle" as a three-stop gradient clipped to the text.
 * No mail client can do that: background-clip:text is unsupported, and where it
 * fails the text-fill-color:transparent survives, so the word renders as
 * nothing at all. The only way to put the real wordmark in a message is to ship
 * it as pixels.
 *
 * Rendered from the app's own values rather than eyeballed: Bricolage
 * Grotesque semi-bold, letter-spacing -0.02em, linear-gradient(90deg,#b3782d
 * 0%,#c2842b 62%,#fca91e 100%) clipped to the text, beside
 * /Fiberarticle_Logo_Without_Background.svg. Captured at twice the size it is
 * displayed so it stays sharp on a retina screen, and baked onto the sheet
 * colour rather than left transparent, because Outlook fills PNG transparency
 * with white.
 *
 * Regenerate by rendering the lockup at 2x and running:
 *   [Convert]::ToBase64String([IO.File]::ReadAllBytes("<path-to-png>"))
 */

/** Referenced from the markup as `cid:fiberarticle-wordmark`. */
export const WORDMARK_CID = "fiberarticle-wordmark";
export const WORDMARK_FILENAME = "fiberarticle-wordmark.png";
export const WORDMARK_CONTENT_TYPE = "image/png";

/** Natural size of the PNG. It is placed at half of this. */
export const WORDMARK_WIDTH = 382;
export const WORDMARK_HEIGHT = 100;

export const WORDMARK_BASE64 =
  "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";
