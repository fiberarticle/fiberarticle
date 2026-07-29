/**
 * Index of the email previews. Development only, same as the previews
 * themselves.
 */

const TEMPLATES = [
  ["welcome", "Welcome, sent once the account is usable"],
  ["verify-email", "Email verification, six digit code"],
  ["password-reset", "Password reset request"],
  ["password-changed", "Password changed, security notice"],
] as const;

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const rows = TEMPLATES.map(
    ([slug, description]) =>
      `<li><a href="/dev/emails/${slug}">${slug}</a> &mdash; ${description} <a href="/dev/emails/${slug}?format=text">(text)</a></li>`
  ).join("");

  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Fiberarticle email previews</title>
<style>body{font-family:system-ui,sans-serif;max-width:44rem;margin:4rem auto;padding:0 1.5rem;line-height:1.6;}
li{margin:.5rem 0;}a{color:#8A4A03;}</style></head>
<body><h1>Fiberarticle email previews</h1><ul>${rows}</ul></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
