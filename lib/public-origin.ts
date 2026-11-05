// The address a person actually opened, for sign-in return URLs (Google, Instagram).
//
// On Netlify a function's req.url can carry the deploy's permalink host
// (<24-hex>--site.netlify.app), which no sign-in provider has registered — so that is
// never used. What the browser opened arrives as x-forwarded-host: localhost and
// *.netlify.app addresses (the live site, or a preview link such as igtest--…) come
// back to themselves; anything else (a custom domain, or no forwarded host) uses APP_URL.
export function publicOrigin(req: Request): string {
  const here = new URL(req.url);
  if (/^(localhost|127\.0\.0\.1)$/.test(here.hostname)) return here.origin;
  const fwd = (req.headers.get("x-forwarded-host") || "").split(",")[0].trim();
  const permalink = /^[0-9a-f]{24}--/i.test(fwd);
  if (fwd && fwd.endsWith(".netlify.app") && !permalink) return `https://${fwd}`;
  return (process.env.APP_URL || here.origin).replace(/\/$/, "");
}
