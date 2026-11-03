import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { canUseConnector } from "@/lib/claude-connector";
import { getClient, issueCode } from "@/lib/oauth";

// Where the Approve / Cancel buttons land.
//
// Session-authenticated (it is NOT in the middleware's public list) and same-origin
// checked by the middleware's CSRF rule, so this cannot be driven from another site —
// which matters, because this is the step that actually hands out access.

export const dynamic = "force-dynamic";

// Not a 303: the site's CSP has form-action 'self', and browsers apply that to the
// redirect a form POST gets back — so a 303 to claude.ai (or Claude Code's localhost
// callback) was silently dropped and Approve "did nothing" (3 Nov 2026; broken since
// the headers started being delivered on 4 Oct). A small page that moves on by
// itself is a fresh navigation, which form-action doesn't cover; the link is there
// in case the refresh is slow.
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const back = (uri: string, params: Record<string, string>) => {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  const href = esc(u.toString());
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${href}"><title>Returning to Claude</title>
<style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#F6F7FB;color:#232D42;display:grid;place-items:center;min-height:100vh}
.c{background:#fff;border:1px solid #EEF0F5;border-radius:16px;padding:28px 32px;text-align:center;max-width:360px}
p{color:#8A92A6;font-size:14px;margin:8px 0 18px}a{display:inline-block;background:#3A57E8;color:#fff;text-decoration:none;border-radius:10px;padding:9px 18px;font-size:14px;font-weight:500}</style></head>
<body><div class="c"><div style="font-weight:600;font-size:17px">Returning to Claude…</div><p>You can close this tab once Claude says it's connected.</p><a href="${href}">Continue</a></div></body></html>`;
  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
};

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const s = (k: string) => String(form.get(k) ?? "").trim();
  const clientId = s("client_id"), redirectUri = s("redirect_uri");
  const challenge = s("code_challenge"), state = s("state");

  // Re-validate everything rather than trusting the hidden fields — they came back
  // through a browser and could have been edited on the way.
  const client = clientId ? await getClient(clientId) : null;
  if (!client || !redirectUri || !client.redirectUris.includes(redirectUri) || !challenge) {
    return NextResponse.json({ error: "invalid_request", error_description: "This approval no longer matches a valid request. Start again from Claude." }, { status: 400 });
  }

  if (s("decision") !== "allow") return back(redirectUri, { error: "access_denied", state });

  const userId = getSessionUserId();
  if (!userId || !(await canUseConnector(userId))) {
    return back(redirectUri, { error: "access_denied", error_description: "Not permitted", state });
  }

  const code = await issueCode({ userId, clientId, redirectUri, challenge });
  return back(redirectUri, { code, state });
}
