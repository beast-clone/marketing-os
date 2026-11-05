// Connect Instagram only — Meta's "Instagram API with Instagram Login" (Praveen, 5 Nov).
//
// The Brands page's other Connect goes through a Facebook Page, which needs the
// Instagram account linked to a Page. This one signs in with the Instagram account
// itself: no Page. The key it gets back is an Instagram user key ("IG…"), saved the
// same way as a Page key — `meta:page:<brandId>` in mh_integration_tokens — so
// warmBrandAccounts() loads it and every tab sees the brand. lib/instagram.ts sends an
// IG… key to graph.instagram.com (graphFor) instead of graph.facebook.com.
//
// Needs, from the Meta app's Instagram → "API setup with Instagram login":
//   INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, and this redirect URL added there:
//   <site>/api/auth/instagram/callback
import { saveIntegrationToken } from "@/lib/integration-tokens";
import { META_PAGE_PREFIX, warmBrandAccounts, type PageNote } from "@/lib/brand-accounts";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

export const IG_LOGIN_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
  "instagram_business_manage_comments",
].join(",");

export const igLoginReady = () => !!(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);

export function instagramRedirect(req: Request): string {
  const here = new URL(req.url);
  // The address the browser actually used. On Netlify req.url can carry the deploy's
  // permalink host, which Instagram would reject, so the forwarded host wins.
  const host = req.headers.get("x-forwarded-host") || here.host;
  // Localhost and *.netlify.app (the live site, or a preview link used to test) come back
  // to themselves; a custom domain in front uses APP_URL.
  const origin = /^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? here.origin
    : host.endsWith(".netlify.app") ? `https://${host}`
    : (process.env.APP_URL || here.origin);
  return `${origin.replace(/\/$/, "")}/api/auth/instagram/callback`;
}

async function json(r: Response) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.error || j?.error_message) {
    const m = j?.error_message || j?.error?.message || j?.error_description || `HTTP ${r.status}`;
    throw new Error(`Instagram said: ${m}`);
  }
  return j;
}

/** Code → long-lived key (60 days) → the account's id and @handle → saved for the brand. */
export async function saveInstagramLogin(code: string, redirectUri: string, brandId: string, taken: (igUserId: string) => string | null): Promise<string> {
  const form = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID || "",
    client_secret: process.env.INSTAGRAM_APP_SECRET || "",
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });
  const short = await json(await fetchWithTimeout("https://api.instagram.com/oauth/access_token", { method: "POST", body: form }));
  const long = await json(await fetchWithTimeout(`https://graph.instagram.com/access_token?${new URLSearchParams({
    grant_type: "ig_exchange_token", client_secret: process.env.INSTAGRAM_APP_SECRET || "", access_token: String(short.access_token),
  })}`, { cache: "no-store" }));
  const token = String(long.access_token);
  const me = await json(await fetchWithTimeout(`https://graph.instagram.com/v25.0/me?${new URLSearchParams({ fields: "user_id,username,account_type", access_token: token })}`, { cache: "no-store" }));
  const igUserId = String(me.user_id || "");
  const username = String(me.username || "");
  if (!igUserId || !username) throw new Error("Instagram didn't say which account this is. Try again.");
  if (me.account_type && !/business|media_creator|creator/i.test(String(me.account_type))) {
    throw new Error(`@${username} is a personal account. Switch it to Professional in the Instagram app, then connect again.`);
  }
  const other = taken(igUserId);
  if (other && other !== brandId) throw new Error(`@${username} already belongs to ${other}.`);
  const note: PageNote & { via: string } = { igUserId, igUsername: username, pageId: "", pageName: `@${username}`, via: "instagram" };
  const expiresAt = long.expires_in ? new Date(Date.now() + Number(long.expires_in) * 1000).toISOString() : null;
  await saveIntegrationToken(`${META_PAGE_PREFIX}${brandId}`, token, { expiresAt, note: JSON.stringify(note) });
  await warmBrandAccounts(true);
  return `@${username}`;
}

/** Instagram-login keys last 60 days; a refresh resets that. Run daily; refreshes any due within 10 days. */
export async function refreshInstagramLogins(sb: NonNullable<ReturnType<typeof import("@/lib/supabase").getSupabase>>): Promise<{ refreshed: string[]; failed: string[] }> {
  const out = { refreshed: [] as string[], failed: [] as string[] };
  const { data } = await sb.from("mh_integration_tokens").select("provider, token, expires_at, note").like("provider", `${META_PAGE_PREFIX}%`);
  for (const r of data || []) {
    const tok = String(r.token || "");
    if (!tok.startsWith("IG")) continue;   // Page keys don't expire this way
    const due = !r.expires_at || Date.parse(String(r.expires_at)) - Date.now() < 10 * 86_400_000;
    if (!due) continue;
    try {
      const j = await json(await fetchWithTimeout(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: tok })}`, { cache: "no-store" }));
      const expiresAt = j.expires_in ? new Date(Date.now() + Number(j.expires_in) * 1000).toISOString() : null;
      await saveIntegrationToken(String(r.provider), String(j.access_token), { expiresAt, note: String(r.note || "") });
      out.refreshed.push(String(r.provider));
    } catch { out.failed.push(String(r.provider)); }
  }
  if (out.refreshed.length) await warmBrandAccounts(true);
  return out;
}
