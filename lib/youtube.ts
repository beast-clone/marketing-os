// YouTube Analytics API client (live side of /api/youtube).
//
// Auth is a Google OAuth token authorized by an account that manages the
// channel (owner OR manager — the primary-owner role is NOT required to read
// analytics). Reading your own channel's stats needs no Google review, just the
// yt-analytics.readonly scope.
//
// Env (absence keeps the tab on demo data):
//   YOUTUBE_ACCESS_TOKEN    — OAuth access token, scope yt-analytics.readonly (+ youtube.readonly)
//   YOUTUBE_REFRESH_TOKEN   — refresh token (access tokens last ~1h; refresh with client id/secret)
//   YOUTUBE_CLIENT_ID       — OAuth client id
//   YOUTUBE_CLIENT_SECRET   — OAuth client secret
//   YOUTUBE_CHANNEL_IDS     — JSON map { "<key>": "UCxxxx", ... } filling CHANNELS[key].channelId
//
// Docs: https://developers.google.com/youtube/analytics/reference/reports/query

import { createHash } from "crypto";
import { CHANNELS } from "@/lib/youtube-channels";
import { recordApiCall } from "./api-usage";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { getIntegrationToken } from "./integration-tokens";

const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";

export function youtubeToken(): string | null {
  return process.env.YOUTUBE_ACCESS_TOKEN || null;
}

// Live is possible with EITHER a stored access token OR refresh-token credentials
// (freshAccessToken below mints hourly access tokens from the refresh token).
export async function hasYouTubeAuth(): Promise<boolean> {
  const at = process.env.YOUTUBE_ACCESS_TOKEN;
  // Prefer a reconnected refresh token (Diagnostics → Reconnect) over the env one.
  const rt = await getIntegrationToken("youtube");
  const id = process.env.YOUTUBE_CLIENT_ID;
  const secret = process.env.YOUTUBE_CLIENT_SECRET;
  return !!(at || (rt && id && secret));
}

// Each channel is a separate Google brand account, so each needs its own refresh
// token: YOUTUBE_REFRESH_TOKENS = {"goocampus":"1//…","twelfthplus":"1//…"}.
// Falls back to the single YOUTUBE_REFRESH_TOKEN for unlisted channels.
async function refreshTokenFor(channelKey?: string): Promise<string | null> {
  // A channel connected from the dashboard (/api/auth/youtube) keeps its own token.
  if (channelKey) {
    const own = await getIntegrationToken(`youtube:${channelKey}`);
    if (own) return own;
  }
  try {
    const map = JSON.parse(process.env.YOUTUBE_REFRESH_TOKENS || "{}") as Record<string, unknown>;
    if (channelKey && typeof map[channelKey] === "string") return map[channelKey] as string;
  } catch { /* malformed map → fall through to the single-token override/env */ }
  // Single-channel fallback: reconnected refresh token (Supabase) → env.
  return getIntegrationToken("youtube");
}

// Does this channel have a permission of its own — a dashboard-connected grant or
// an entry in the env map? Without one, analytics calls are refused and every
// figure would quietly read 0 under a "Live" badge (Samvaya, 5 Oct), so the route
// answers "not connected" instead and the tab offers "Connect this channel".
export async function hasChannelGrant(channelKey: string): Promise<boolean> {
  if (await getIntegrationToken(`youtube:${channelKey}`)) return true;
  try {
    const map = JSON.parse(process.env.YOUTUBE_REFRESH_TOKENS || "{}") as Record<string, unknown>;
    if (typeof map[channelKey] === "string") return true;
    // No per-channel map at all = the old single-token setup, which covers its channels.
    return Object.keys(map).length === 0;
  } catch { return true; }
}

// Access tokens last about an hour, so one is minted and then REUSED until it is
// nearly expired. Minting per request looked harmless and was not.
//
// Google only keeps a limited number of live access tokens per (client, account)
// and quietly invalidates the oldest when a new one is issued. Every request here
// minted its own, so several requests against the same channel — a tab opening
// while the cache warmer runs, two people looking at once, one person changing the
// date range — would each issue a token and kill the one before it. A request that
// takes 2–9 seconds could therefore lose its token halfway through: the analytics
// calls had already gone out, and the LAST call, the subscriber count, came back
// 401. That is exactly how it showed up — the 12thplus tab reading "subscriber
// count unavailable (YouTube 401)" while the same credentials worked perfectly when
// tried on their own. Six requests fired at once reproduced it three times out of
// six; with one shared token, six out of six pass.
//
// The in-flight promise matters as much as the cache: without it, concurrent
// callers all miss the cache together and mint in parallel, which is the same race
// again.
type CachedToken = { token: string; expiresAt: number };
const accessTokens = new Map<string, CachedToken>();
const tokenInFlight = new Map<string, Promise<string>>();
const TOKEN_SAFETY_MS = 120_000;   // renew a couple of minutes early

async function mintAccessToken(cacheKey: string, rt: string, id: string, secret: string): Promise<string> {
  const r = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: rt, grant_type: "refresh_token" }),
  });
  if (!r.ok) throw new Error(`token refresh failed (${r.status})`);
  const j = await r.json();
  if (!j.access_token) throw new Error("token refresh returned no access_token");
  // expires_in is seconds (typically 3599). Fall back to an hour if absent.
  const ttlMs = (Number(j.expires_in) || 3600) * 1000;
  accessTokens.set(cacheKey, { token: j.access_token as string, expiresAt: Date.now() + ttlMs - TOKEN_SAFETY_MS });
  return j.access_token as string;
}

async function freshAccessToken(channelKey?: string): Promise<string> {
  const at = process.env.YOUTUBE_ACCESS_TOKEN;
  const rt = await refreshTokenFor(channelKey);
  const id = process.env.YOUTUBE_CLIENT_ID;
  const secret = process.env.YOUTUBE_CLIENT_SECRET;
  if (rt && id && secret) {
    // One access token per ACCOUNT: not one per channel, and not one for the app.
    //
    // Google rotates access tokens per account, so two channels sharing an account
    // and holding separate tokens kill each other's on every mint — that was the
    // intermittent 401 storm when more than one channel loaded at once. Keying by
    // account fixes it, because those channels now share a single entry.
    //
    // Keying by nothing at all does NOT. That was tried, and it broke three of the
    // four tabs: each channel here has its OWN refresh token for its own brand
    // account, so whichever channel minted first had its token served to all the
    // others. A note here claimed one account managed everything and a wrong token
    // would 401 and be retried — both wrong. Crossing every token against every
    // channel gives a clean diagonal, and a cross-account read answers 403, which
    // the 401 retry never sees. The callers turn that throw into empty rows, so the
    // tabs showed a correct subscriber count beside 0 views, 0 watch hours and no
    // videos, which looks like a quiet channel rather than a broken one.
    //
    // The refresh token IS the account identity here, so hash it and key on that.
    // Same account, same entry; different account, different entry.
    const cacheKey = "rt:" + createHash("sha256").update(rt).digest("hex").slice(0, 16);
    const hit = accessTokens.get(cacheKey);
    if (hit && Date.now() < hit.expiresAt) return hit.token;

    const pending = tokenInFlight.get(cacheKey);
    if (pending) { try { return await pending; } catch { /* fall through to the stored token */ } }
    else {
      const task = mintAccessToken(cacheKey, rt, id, secret).finally(() => tokenInFlight.delete(cacheKey));
      tokenInFlight.set(cacheKey, task);
      try { return await task; } catch { /* fall back to the stored token */ }
    }
  }
  if (!at) throw new Error("No YouTube access token");
  return at;
}

// Every YouTube call goes through here.
//
// Google rotates access tokens per account, so minting for one channel can
// invalidate the token a channel sharing that account is holding. Caching alone
// therefore trades "mint too often" for "serve a token that was killed from
// outside", which is how a warm, valid-looking cache still produced intermittent
// 401s.
//
// Note what this retry does NOT cover: a token for the wrong account answers 403,
// not 401, and 403 is a real answer — this channel is not readable with these
// credentials — so retrying it would just ask twice. Keying the cache by account
// is what prevents that case; see freshAccessToken.
//
// So: use the cached token, and if the call comes back 401, throw that token away,
// mint once more and repeat the call. One retry only — a second 401 is a real
// credentials problem and should be reported, not looped on.
async function ytFetch(channelKey: string | undefined, url: string): Promise<Response> {
  let token = await freshAccessToken(channelKey);
  let r = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (r.status === 401) {
    forgetYouTubeToken(channelKey);
    token = await freshAccessToken(channelKey);
    r = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  }
  return r;
}

/** An access token for a channel that was connected from the dashboard, or null.
 *  Uploads use only these: the env fallbacks can belong to another channel's
 *  account, and an upload must never land on the wrong channel. */
export async function channelAccessToken(channelKey: string): Promise<string | null> {
  if (!(await getIntegrationToken(`youtube:${channelKey}`))) return null;
  return freshAccessToken(channelKey);
}

/** Drop a cached access token so the next call mints a new one. */
export function forgetYouTubeToken(channelKey?: string): void {
  // Clear the lot rather than one entry. Channels that share an account share an
  // entry, so a token revoked for one is the very token the others hold; keeping
  // their copies would only move the 401 to the next tab. Channels on their own
  // account lose a still-good token and mint again — one extra round trip, on a
  // path that is already an error.
  accessTokens.clear();
  void channelKey;
}

async function ytGet(params: Record<string, string>, token: string, channelKey?: string): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  // Same revocation problem as everything else, and worse here: every caller
  // catches and substitutes empty rows, so a dead token used to show up as a flat
  // chart rather than an error.
  let r = await fetchWithTimeout(`${ANALYTICS}?${qs}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (r.status === 401) {
    forgetYouTubeToken(channelKey);
    const fresh = await freshAccessToken(channelKey);
    r = await fetchWithTimeout(`${ANALYTICS}?${qs}`, { headers: { Authorization: `Bearer ${fresh}` }, cache: "no-store" });
  }
  recordApiCall("YouTube", r.ok, r.status);
  const text = await r.text();
  if (!r.ok) throw new Error(`YouTube ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// Analytics queries use channel==<id> (or channel==MINE for the auth'd channel).
function channelFilter(channelId: string): string {
  return channelId ? `channel==${channelId}` : "channel==MINE";
}

// When YOUTUBE_CHANNEL_IDS isn't configured, resolve a channel's real id from its
// public @handle (works with the OAuth token) and cache it onto CHANNELS, so live
// data works with just OAuth — no channel-id env needed. Returns null if it can't.
export async function resolveChannelId(channelKey: string): Promise<string | null> {
  const ch = CHANNELS[channelKey];
  if (!ch) return null;
  if (ch.channelId) return ch.channelId;
  // A channel registered without a handle is one whose identity nobody has
  // confirmed yet. Looking it up by name would be a guess, and a wrong guess here
  // means reporting someone else's channel as ours — so it stays "not connected"
  // until its id is supplied.
  if (!ch.handle.trim()) return null;
  try {
    const token = await freshAccessToken(channelKey);
    const handle = ch.handle.replace(/^@/, "");
    const r = await fetchWithTimeout(
      `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    recordApiCall("YouTube", r.ok, r.status);
    if (!r.ok) return null;
    const j = await r.json();
    const id = j?.items?.[0]?.id;
    if (typeof id === "string" && id) { ch.channelId = id; return id; }
  } catch { /* leave on demo */ }
  return null;
}

// "PT1H2M3S" → seconds. Data API expresses video length as ISO-8601 duration.
function parseIsoDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

// YouTube counts videos up to 3 minutes as Shorts (since Oct 2024).
export const SHORTS_MAX_SEC = 180;

export type UploadVideo = {
  id: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
  durationSec: number;
  isShort: boolean;
  views: number;
  likes: number;
  comments: number;
};

export type VideoReply = {
  id: string; author: string; authorImage: string; text: string; likes: number; publishedAt: string;
};
export type VideoComment = {
  id: string; author: string; authorImage: string; text: string;
  likes: number; publishedAt: string; replyCount: number; replies: VideoReply[];
};

// Top comments on a video (commentThreads, ordered by relevance). Shown inside
// the in-dashboard player modal so the whole conversation stays in the app.
// Comments are PUBLIC data — read with a Data API key (the OAuth token's
// youtube.readonly scope is rejected by commentThreads, a known YT quirk).
export async function fetchVideoComments(channelKey: string, videoId: string, max = 25): Promise<{ available: boolean; reason?: string; comments: VideoComment[] }> {
  const key = process.env.YOUTUBE_API_KEY;
  // part=snippet,replies returns up to 5 replies per top-level comment inline.
  let url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=${encodeURIComponent(videoId)}&maxResults=${max}&order=relevance&textFormat=plainText`;
  const opts: RequestInit = { cache: "no-store" };
  if (key) {
    url += `&key=${key}`;
  } else {
    // Fallback to OAuth (works only if the token carries a comment-capable scope).
    const token = await freshAccessToken(channelKey);
    opts.headers = { Authorization: `Bearer ${token}` };
  }
  const r = await fetchWithTimeout(url, opts);
  if (!r.ok) {
    const t = await r.text();
    const disabled = /commentsDisabled|disabled comments/i.test(t);
    return { available: false, reason: disabled ? "Comments are turned off for this video." : `Couldn't load comments (${r.status}).`, comments: [] };
  }
  const j = await r.json();
  const comments: VideoComment[] = (j.items || []).map((it: any) => {
    const s = it?.snippet?.topLevelComment?.snippet || {};
    const replies: VideoReply[] = (it?.replies?.comments || []).map((rc: any) => {
      const rs = rc?.snippet || {};
      return {
        id: rc.id,
        author: rs.authorDisplayName || "—",
        authorImage: rs.authorProfileImageUrl || "",
        text: rs.textDisplay || "",
        likes: Number(rs.likeCount || 0),
        publishedAt: rs.publishedAt || "",
      };
    }).reverse(); // API returns newest-first; show oldest-first under the parent
    return {
      id: it.id,
      author: s.authorDisplayName || "—",
      authorImage: s.authorProfileImageUrl || "",
      text: s.textDisplay || "",
      likes: Number(s.likeCount || 0),
      publishedAt: s.publishedAt || "",
      replyCount: Number(it?.snippet?.totalReplyCount || 0),
      replies,
    };
  });
  return { available: true, comments };
}

// ALL videos a channel has ever uploaded (not just the top-25-in-range that the
// Analytics API returns) — via the Data API uploads playlist. Each carries
// LIFETIME stats (views/likes/comments) so the Shorts/Long-form pages can show
// the full library, sort by performance, and flag reusable top performers.
export async function fetchChannelUploads(channelKey: string): Promise<UploadVideo[]> {
  const ch = CHANNELS[channelKey];
  if (!ch?.channelId) throw new Error("unknown channel");
  const token = await freshAccessToken(channelKey);
  const auth = { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" as const };
  const api = (path: string) => `https://www.googleapis.com/youtube/v3/${path}`;

  // 1. uploads playlist id
  const chRes = await fetchWithTimeout(api(`channels?part=contentDetails&id=${ch.channelId}`), auth).then((r) => r.json());
  const uploadsId: string | undefined = chRes?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return [];

  // 2. page all video ids (cap 400 for safety)
  const ids: string[] = [];
  let pageToken = "";
  for (let i = 0; i < 8 && ids.length < 400; i++) {
    const pl = await fetchWithTimeout(api(`playlistItems?part=contentDetails&maxResults=50&playlistId=${uploadsId}${pageToken ? `&pageToken=${pageToken}` : ""}`), auth).then((r) => r.json());
    for (const it of pl?.items || []) if (it?.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
    pageToken = pl?.nextPageToken || "";
    if (!pageToken) break;
  }
  if (!ids.length) return [];

  // 3. hydrate in batches of 50
  const out: UploadVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).join(",");
    const vr = await fetchWithTimeout(api(`videos?part=snippet,contentDetails,statistics&id=${batch}`), auth).then((r) => r.json());
    for (const v of vr?.items || []) {
      const durationSec = parseIsoDuration(v?.contentDetails?.duration || "");
      out.push({
        id: v.id,
        title: v?.snippet?.title || v.id,
        thumbnail: v?.snippet?.thumbnails?.medium?.url || v?.snippet?.thumbnails?.default?.url || "",
        publishedAt: v?.snippet?.publishedAt || "",
        durationSec,
        isShort: durationSec > 0 && durationSec <= SHORTS_MAX_SEC,
        views: Number(v?.statistics?.viewCount || 0),
        likes: Number(v?.statistics?.likeCount || 0),
        comments: Number(v?.statistics?.commentCount || 0),
      });
    }
  }
  out.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return out;
}

export async function buildLiveYouTube(channelKey: string, from: string, to: string) {
  const ch = CHANNELS[channelKey];
  if (!ch) throw new Error("unknown channel");
  const token = await freshAccessToken(channelKey);
  const ids = channelFilter(ch.channelId);

  // ── Views & watch time (+ subs) by day ──
  const daily = await ytGet({
    ids, startDate: from, endDate: to,
    metrics: "views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost",
    dimensions: "day", sort: "day",
  }, token, channelKey).catch(() => ({ rows: [] }));

  const dayRows: any[] = daily.rows || [];
  // Column order matches the metrics list above.
  const viewsOverTime = dayRows.map((r) => ({
    date: r[0],
    views: r[1] || 0,
    watchHours: Math.round(((r[2] || 0) / 60) * 10) / 10,
  }));

  // Subscribers: reconstruct a running total ending at the current count.
  const subEvents = dayRows.map((r) => ({ date: r[0], gained: r[4] || 0, lost: r[5] || 0, net: (r[4] || 0) - (r[5] || 0) }));

  // Totals for the range
  const totals = await ytGet({
    ids, startDate: from, endDate: to,
    metrics: "views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost",
  }, token, channelKey).catch(() => ({ rows: [[0, 0, 0, 0, 0]] }));
  const t = (totals.rows && totals.rows[0]) || [0, 0, 0, 0, 0];
  const totalViews = t[0] || 0;
  const totalWatchHours = Math.round((t[1] || 0) / 60);
  const avgViewDurationSec = t[2] || 0;
  const netSubs = (t[3] || 0) - (t[4] || 0);

  // Average % viewed (retention) — a SEPARATE query so, if it ever errors, it can't
  // break the summary above (it just falls back to 0/omitted).
  const avgPctRes = await ytGet({ ids, startDate: from, endDate: to, metrics: "averageViewPercentage" }, token, channelKey).catch(() => ({ rows: [[0]] }));
  const avgViewPercentage = Math.round(((avgPctRes.rows?.[0]?.[0]) || 0) * 10) / 10;

  // Subscribers vs non-subscribers (views) — the real, API-available version of
  // "new vs returning". Separate query so it can't break the summary above.
  const subRes = await ytGet({ ids, startDate: from, endDate: to, metrics: "views", dimensions: "subscribedStatus" }, token, channelKey).catch(() => ({ rows: [] }));
  let subscribedViews = 0, nonSubscribedViews = 0;
  for (const r of (subRes.rows || [])) {
    if (String(r[0]).toUpperCase() === "SUBSCRIBED") subscribedViews += r[1] || 0;
    else nonSubscribedViews += r[1] || 0;
  }

  // Current subscriber count (lifetime) — from the Data API channels.statistics.
  // No fallback: a made-up count under a Live badge is worse than an error.
  const dr = await ytFetch(channelKey, `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${ch.channelId}`);
  if (!dr.ok) {
    // Google says WHY (expired token, wrong project, channel not accessible).
    // Swallowing it left "YouTube 401" on screen, which is not something anyone
    // can act on.
    const why = await dr.text().catch(() => "");
    const reason = (() => { try { return JSON.parse(why)?.error?.message || ""; } catch { return why.slice(0, 160); } })();
    throw new Error(`subscriber count unavailable (YouTube ${dr.status}${reason ? ": " + reason : ""})`);
  }
  const dj = await dr.json();
  const subCount = dj.items?.[0]?.statistics?.subscriberCount;
  if (subCount == null) throw new Error("subscriber count unavailable");
  const currentSubs = Number(subCount);

  let running = currentSubs - netSubs;
  const subscribersOverTime = subEvents.map((e) => {
    running += e.net;
    return { date: e.date, subscribers: running, gained: e.gained, lost: e.lost, net: e.net };
  });

  // ── Top videos ──
  // 25 rows so the Long-form/Shorts content pages have a real list to split.
  const topRaw = await ytGet({
    ids, startDate: from, endDate: to,
    metrics: "views,estimatedMinutesWatched,averageViewDuration,likes,comments",
    dimensions: "video", sort: "-views", maxResults: "25",
  }, token, channelKey).catch(() => ({ rows: [] }));
  const videoRows: any[] = topRaw.rows || [];
  const videoIds = videoRows.map((r) => r[0]).join(",");
  // Resolve titles + thumbnails + durations via the Data API. Duration is what
  // separates Shorts from long-form (Shorts are ≤ 3 minutes).
  const titleMap: Record<string, { title: string; thumb: string; durationSec: number }> = {};
  if (videoIds) {
    try {
      const vr = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoIds}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      if (vr.ok) {
        const vj = await vr.json();
        for (const item of vj.items || []) {
          titleMap[item.id] = {
            title: item.snippet?.title || item.id,
            thumb: item.snippet?.thumbnails?.medium?.url || "",
            durationSec: parseIsoDuration(item.contentDetails?.duration || ""),
          };
        }
      }
    } catch { /* leave ids */ }
  }
  const topVideos = videoRows.map((r) => {
    const id = r[0];
    const durationSec = titleMap[id]?.durationSec ?? 0;
    return {
      id,
      title: titleMap[id]?.title || id,
      thumbnail: titleMap[id]?.thumb || "",
      views: r[1] || 0,
      watchHours: Math.round(((r[2] || 0) / 60) * 10) / 10,
      avgViewDurationSec: r[3] || 0,
      likes: r[4] || 0,
      comments: r[5] || 0,
      publishedDaysAgo: 0,
      durationSec,
      isShort: durationSec > 0 && durationSec <= SHORTS_MAX_SEC,
    };
  });

  // ── Traffic sources / geography / devices / demographics ──
  const pct = (rows: any[], labelIdx = 0, valIdx = 1) => {
    const total = rows.reduce((s, r) => s + (r[valIdx] || 0), 0);
    return rows
      .map((r) => ({ label: String(r[labelIdx]), value: r[valIdx] || 0, pct: total ? Math.round(((r[valIdx] || 0) / total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.pct - a.pct);
  };

  const [trafficRaw, geoRaw, deviceRaw, demoRaw, cityRaw] = await Promise.all([
    ytGet({ ids, startDate: from, endDate: to, metrics: "views", dimensions: "insightTrafficSourceType", sort: "-views" }, token, channelKey).catch(() => ({ rows: [] })),
    ytGet({ ids, startDate: from, endDate: to, metrics: "views", dimensions: "country", sort: "-views", maxResults: "25" }, token, channelKey).catch(() => ({ rows: [] })),
    ytGet({ ids, startDate: from, endDate: to, metrics: "views", dimensions: "deviceType", sort: "-views" }, token, channelKey).catch(() => ({ rows: [] })),
    ytGet({ ids, startDate: from, endDate: to, metrics: "viewerPercentage", dimensions: "ageGroup,gender", sort: "-viewerPercentage" }, token, channelKey).catch(() => ({ rows: [] })),
    // Top cities — YouTube only returns cities that clear its privacy threshold,
    // so small channels may get few rows (that's Google, not us).
    ytGet({ ids, startDate: from, endDate: to, metrics: "views", dimensions: "city", sort: "-views", maxResults: "25" }, token, channelKey).catch(() => ({ rows: [] })),
  ]);

  const TRAFFIC_LABELS: Record<string, string> = {
    YT_SEARCH: "YouTube search", RELATED_VIDEO: "Suggested videos", BROWSE: "Browse features",
    EXT_URL: "External", NO_LINK_OTHER: "Direct / unknown", SUBSCRIBER: "Subscriptions",
    CHANNEL: "Channel pages", PLAYLIST: "Playlists", NOTIFICATION: "Notifications",
  };
  const trafficSources = pct(trafficRaw.rows || []).map((r) => ({ source: TRAFFIC_LABELS[r.label] || r.label, views: r.value, pct: r.pct }));
  const geography = pct(geoRaw.rows || []).map((r) => ({ country: r.label, views: r.value, pct: r.pct }));
  const cities = pct(cityRaw.rows || []).map((r) => ({ city: r.label, views: r.value, pct: r.pct }));
  const devices = pct(deviceRaw.rows || []).map((r) => ({ device: (r.label.charAt(0) + r.label.slice(1).toLowerCase()), pct: r.pct }));

  // Demographics: rows are [ageGroup, gender, viewerPercentage]. Collapse to age + gender.
  const ageMap: Record<string, number> = {};
  const genderMap: Record<string, number> = {};
  for (const r of demoRaw.rows || []) {
    const age = String(r[0]).replace("age", "").replace("_", "–");
    ageMap[age] = (ageMap[age] || 0) + (r[2] || 0);
    const g = String(r[1]);
    genderMap[g] = (genderMap[g] || 0) + (r[2] || 0);
  }
  const ageGroups = Object.entries(ageMap).map(([group, p]) => ({ group, pct: Math.round(p * 10) / 10 })).sort((a, b) => b.pct - a.pct);
  const genderSplit = Object.entries(genderMap).map(([label, p]) => ({ label: label.charAt(0) + label.slice(1).toLowerCase(), pct: Math.round(p * 10) / 10 }));

  // Combined age×gender for the Instagram-style grouped chart (male + female
  // bars side by side per age bracket). Sorted young → old.
  const agMap: Record<string, { male: number; female: number }> = {};
  for (const r of demoRaw.rows || []) {
    const age = String(r[0]).replace("age", "").replace("_", "–");
    const g = String(r[1]).toLowerCase();
    if (g !== "male" && g !== "female") continue;
    agMap[age] = agMap[age] || { male: 0, female: 0 };
    agMap[age][g as "male" | "female"] += r[2] || 0;
  }
  const ageGender = Object.entries(agMap)
    .map(([group, v]) => ({ group, male: Math.round(v.male * 10) / 10, female: Math.round(v.female * 10) / 10 }))
    .sort((a, b) => parseInt(a.group) - parseInt(b.group));

  // Videos vs Shorts PUBLISHED in this range (from the uploads library, classified
  // by duration) — matches the monthly report's Video / Shorts counts, unlike
  // topVideos which is only the 25 best-performing in range.
  let postedVideos = 0, postedShorts = 0;
  try {
    const uploads = await fetchChannelUploads(channelKey);
    const fromTs = new Date(from + "T00:00:00Z").getTime();
    const toTs = new Date(to + "T23:59:59Z").getTime();
    for (const u of uploads) {
      const ts = new Date(u.publishedAt).getTime();
      if (Number.isNaN(ts) || ts < fromTs || ts > toTs) continue;
      if (u.isShort) postedShorts++; else postedVideos++;
    }
  } catch { /* leave zero if the uploads read fails */ }

  return {
    channel: { id: ch.id, name: ch.name, handle: ch.handle, channelId: ch.channelId },
    source: "live" as const,
    range: { from, to },
    summary: {
      subscribers: currentSubs,
      subscriberGain: netSubs,
      views: totalViews,
      watchHours: totalWatchHours,
      avgViewDurationSec,
      avgViewPercentage,
      videos: topVideos.length,
      postedVideos,
      postedShorts,
    },
    subscriberViews: { subscribed: subscribedViews, nonSubscribed: nonSubscribedViews },
    viewsOverTime,
    subscribersOverTime,
    topVideos,
    traffic: { sources: trafficSources, geography, cities, devices, ageGroups, genderSplit, ageGender },
  };
}

// Read PUBLIC YouTube Data API resources (any channel's details/uploads/videos),
// authorised with our own channel's OAuth token. Used by the SEO keyword tab to look
// at competitor channels. `path` is everything after /youtube/v3/.
export async function youtubeGet<T>(path: string): Promise<T> {
  const token = await freshAccessToken("goocampus");
  const r = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error?.message || `YouTube ${r.status}`);
  return j as T;
}
