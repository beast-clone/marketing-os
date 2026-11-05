// Connect a YouTube channel from the dashboard (YouTube tab → "Connect this
// channel"). Same Google OAuth client as the other channels and sign-in, same two
// read-only scopes they were given. The grant is saved per channel in
// mh_integration_tokens as "youtube:<key>", which lib/youtube.ts reads first.
import { CHANNELS } from "@/lib/youtube-channels";
import { saveIntegrationToken } from "@/lib/integration-tokens";
import { createHmac, timingSafeEqual } from "crypto";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

export const YT_SCOPES = "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly";

// On localhost the request origin IS the registered redirect; in production the
// stable APP_URL has to win (functions see deploy-permalink hosts).
export function youtubeRedirect(reqUrl: string): string {
  const here = new URL(reqUrl);
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(here.origin);
  const origin = (local ? here.origin : (process.env.APP_URL || here.origin)).replace(/\/$/, "");
  return `${origin}/api/auth/youtube/callback`;
}

// Swap the code for tokens, check the grant is for the channel asked for (Google
// lets you pick any channel you manage), then save it. Returns the channel title.
export async function saveYouTubeGrant(code: string, redirectUri: string, channelKey: string): Promise<string> {
  const ch = CHANNELS[channelKey];
  if (!ch) throw new Error("Unknown channel");
  const r = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.YOUTUBE_CLIENT_ID || "", client_secret: process.env.YOUTUBE_CLIENT_SECRET || "", redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) throw new Error(j.error_description || j.error || "Google didn't return a lasting permission — try again.");
  const me = await fetchWithTimeout("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${j.access_token}` } }).then((x) => x.json()).catch(() => ({}));
  const got = (me.items || [])[0] as { id?: string; snippet?: { title?: string } } | undefined;
  if (ch.channelId && got?.id !== ch.channelId) {
    throw new Error(`That permission is for "${got?.snippet?.title || "another channel"}". Pick ${ch.name} on Google's channel list and try again.`);
  }
  await saveIntegrationToken(`youtube:${channelKey}`, j.refresh_token, { note: got?.snippet?.title || ch.name });
  return got?.snippet?.title || ch.name;
}

// ── Connect links (docs/BRANDS_SPEC.md) ──────────────────────────────────────
// The Brands page hands out a link the channel owner opens on their own device —
// no dashboard login, no secrets to pass around. The link names one channel and
// expires in a day; it's signed with SESSION_SECRET so it can't be edited to
// another channel. It can be reused within the day (to retry after picking the
// wrong channel), and Google's channel check above still guards what is saved.
const LINK_TTL_MS = 24 * 60 * 60 * 1000;
const linkSig = (body: string) => createHmac("sha256", process.env.SESSION_SECRET || "").update(`yt-link:${body}`).digest("hex").slice(0, 32);

export function makeConnectToken(channelKey: string): string {
  const body = `${channelKey}~${Date.now() + LINK_TTL_MS}`;
  return `${body}~${linkSig(body)}`;
}

/** The channel a connect token is for, or null if it's forged, malformed or expired. */
export function readConnectToken(t: string): string | null {
  const [key, exp, sig] = t.split("~");
  if (!key || !exp || !sig || !process.env.SESSION_SECRET) return null;
  const want = linkSig(`${key}~${exp}`);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  if (Number(exp) < Date.now() || !CHANNELS[key]) return null;
  return key;
}

/** Google's sign-in page for a channel; `state` comes back to the callback. */
export function googleAuthUrl(redirectUri: string, state: string): string {
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", process.env.YOUTUBE_CLIENT_ID || "");
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", YT_SCOPES);
  auth.searchParams.set("state", state);
  // offline + consent = a refresh token every time (otherwise it dies within the hour).
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent select_account");
  return auth.toString();
}
