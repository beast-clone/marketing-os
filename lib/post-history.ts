// Monthly post-performance history.
//
// Unlike account daily metrics (which Meta drops after ~30 days — see lib/snapshot.ts),
// per-post insights stay available for the life of the post. We still freeze a
// monthly copy into Supabase because (1) a post keeps accruing reach forever, so a
// stored month is a stable "as it stood then" record, (2) a live month of posts is
// 15–30s to fetch (one Meta call per post) while stored is instant, and (3) it
// survives a deleted post / token change.
//
// Storage reuses the `discover_cache` table (no migration): one row per account per
// month, cache_key = `postsnap:<accountId>:<YYYY-MM>`, source = `posts_month_snapshot`.

import { getConfiguredAccounts, fetchMediaInsights, type IGAccountConfig, type IGMedia, graphFor } from "@/lib/instagram";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { metaLimiter } from "@/lib/concurrency";
import { getSupabase } from "@/lib/supabase";

const GRAPH = "https://graph.facebook.com/v25.0";

// Mirrors the shape /api/posts returns (and PreviewOverview's Post type).
export type HistPost = {
  id: string;
  caption: string;
  mediaUrl: string;
  mediaUrls?: string[];
  // The playable file (28 Oct): a reel/video's mp4, and per carousel slide the mp4
  // for a video slide ("" for a picture), so the post popup plays it with sound.
  videoUrl?: string;
  slideVideos?: string[];
  permalink: string;
  type: string;
  timestamp: string;
  likes: number;
  comments: number;
  reach: number;
  shares: number;
  saves: number;
  totalInteractions: number;
  views?: number;
  avgWatchMs?: number;
};

// Page the account's media, keeping only posts whose timestamp falls in [from, to].
async function fetchMediaInDateRange(igUserId: string, token: string, fromIso?: string, toIso?: string, hardCap = 500): Promise<IGMedia[]> {
  const fields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,children{media_type,media_url,thumbnail_url}";
  let url = `${graphFor(token)}/${igUserId}/media?fields=${fields}&limit=100&access_token=${token}`;
  const fromTs = fromIso ? new Date(fromIso + "T00:00:00Z").getTime() : -Infinity;
  const toTs = toIso ? new Date(toIso + "T23:59:59Z").getTime() : Infinity;
  const out: IGMedia[] = [];
  while (url && out.length < hardCap) {
    const r = await metaLimiter(() => fetchWithTimeout(url, { cache: "no-store" }));
    if (!r.ok) throw new Error(`Meta ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as { data: IGMedia[]; paging?: { next?: string } };
    let stopPaging = false;
    for (const m of j.data ?? []) {
      const ts = new Date(m.timestamp).getTime();
      if (ts > toTs) continue;
      if (ts < fromTs) { stopPaging = true; break; }
      out.push(m);
      if (out.length >= hardCap) break;
    }
    if (stopPaging) break;
    url = j.paging?.next ?? "";
  }
  return out;
}

// Shared post fetch: media in range → HistPost[], optionally with per-post insights.
// Used by BOTH /api/posts (live) and the monthly snapshotter, so there is one code
// path for "what a post looks like".
export async function fetchPostsInRange(
  acc: IGAccountConfig,
  from?: string,
  to?: string,
  opts: { withInsights?: boolean; cap?: number } = {},
): Promise<HistPost[]> {
  const withInsights = opts.withInsights !== false;
  const cap = opts.cap && opts.cap > 0 ? opts.cap : 500;
  const media = await fetchMediaInDateRange(acc.igUserId, acc.pageAccessToken, from, to, cap);

  const posts: HistPost[] = new Array(media.length);
  const concurrency = 6;
  let i = 0;
  async function worker() {
    while (i < media.length) {
      const idx = i++;
      const m = media[idx];
      let reach = 0, shares = 0, saves = 0, totalInteractions = 0, views: number | undefined, avgWatch: number | undefined;
      if (withInsights) {
        const insights = await fetchMediaInsights(acc, m.id, m.media_type, m.media_product_type);
        for (const ins of insights) {
          const v = ins.values?.[0]?.value;
          if (typeof v !== "number") continue;
          if (ins.name === "reach") reach = v;
          else if (ins.name === "shares") shares = v;
          else if (ins.name === "saved") saves = v;
          else if (ins.name === "total_interactions") totalInteractions = v;
          else if (ins.name === "views") views = v;
          else if (ins.name === "ig_reels_avg_watch_time") avgWatch = v;
        }
      }
      const kids = (m.children?.data ?? []).filter((ch) => ch.thumbnail_url || ch.media_url);
      const childUrls = kids.map((ch) => ch.thumbnail_url || ch.media_url || "");
      const childVideos = kids.map((ch) => (ch.media_type === "VIDEO" ? ch.media_url || "" : ""));
      posts[idx] = {
        id: m.id,
        caption: m.caption ?? "",
        mediaUrl: m.thumbnail_url || m.media_url || "",
        mediaUrls: childUrls.length ? childUrls : undefined,
        videoUrl: m.media_type === "VIDEO" && m.media_url ? m.media_url : undefined,
        slideVideos: childVideos.some(Boolean) ? childVideos : undefined,
        permalink: m.permalink,
        type: m.media_product_type === "REELS" ? "REEL" : m.media_type,
        timestamp: m.timestamp,
        likes: m.like_count ?? 0,
        comments: m.comments_count ?? 0,
        reach, shares, saves, totalInteractions, views, avgWatchMs: avgWatch,
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, media.length) }, () => worker()));
  return posts;
}

// ── month helpers ───────────────────────────────────────────────────────────
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this
  const to = `${month}-${String(last).padStart(2, "0")}`;
  return { from, to };
}
export function monthsInRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [ey, em] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
export function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── write ───────────────────────────────────────────────────────────────────
export type PostMonthSnapshot = { accountId: string; month: string; from: string; to: string; count: number; capturedAt: string; posts: HistPost[] };

export async function snapshotPostsForMonth(acc: IGAccountConfig, month: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  const db = getSupabase();
  if (!db) return { ok: false, error: "Supabase not configured" };
  const { from, to } = monthBounds(month);
  const posts = await fetchPostsInRange(acc, from, to, { withInsights: true, cap: 500 });
  const payload: PostMonthSnapshot = { accountId: acc.id, month, from, to, count: posts.length, capturedAt: new Date().toISOString(), posts };
  const { error } = await db.from("discover_cache").upsert(
    { cache_key: `postsnap:${acc.id}:${month}`, source: "posts_month_snapshot", last_fetched: new Date().toISOString(), payload },
    { onConflict: "cache_key" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: posts.length };
}

export async function snapshotAllAccountsPostsForMonth(month: string) {
  const accounts = getConfiguredAccounts();
  const results = [];
  // Sequential across accounts — each is already a burst of Meta calls; running
  // them in parallel would trip Meta rate limits.
  for (const acc of accounts) {
    try {
      const r = await snapshotPostsForMonth(acc, month);
      results.push({ accountId: acc.id, month, ...r });
    } catch (e) {
      results.push({ accountId: acc.id, month, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

// ── read ───────────────────────────────
export async function readPostsMonthSnapshot(accountId: string, month: string): Promise<PostMonthSnapshot | null> {
  const db = getSupabase();
  if (!db) return null;
  const { data } = await db
    .from("discover_cache")
    .select("payload")
    .eq("cache_key", `postsnap:${accountId}:${month}`)
    .eq("source", "posts_month_snapshot")
    .maybeSingle();
  const snap = (data?.payload as PostMonthSnapshot) ?? null;
  // Only a copy taken after the month ended is complete. One taken mid-month froze
  // whatever existed then (October's, taken 4 Oct, had 7 of 84 posts) — treat it
  // as missing so the month is fetched live instead.
  if (snap && !(snap.capturedAt > `${monthBounds(month).to}T23:59:59.999Z`)) return null;
  return snap;
}

export function previousMonth(): string {
  const d = new Date();
  const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Stored posts for an arbitrary [from,to] range: read every covered month's
// snapshot, merge, filter to the range. Returns null if NO covered month has a
// snapshot (caller falls back to live). Partial coverage returns what exists.
export async function readPostsForRangeStored(accountId: string, from: string, to: string): Promise<HistPost[] | null> {
  const months = monthsInRange(from, to);
  const snaps = await Promise.all(months.map((mo) => readPostsMonthSnapshot(accountId, mo)));
  // Require EVERY covered month to be stored — partial coverage would undercount,
  // so fall back to a live (complete) fetch instead.
  if (snaps.some((s) => !s)) return null;
  const fromTs = new Date(from + "T00:00:00Z").getTime();
  const toTs = new Date(to + "T23:59:59Z").getTime();
  const seen = new Set<string>();
  const out: HistPost[] = [];
  for (const s of snaps) {
    if (!s) continue;
    for (const p of s.posts) {
      const ts = new Date(p.timestamp).getTime();
      if (ts < fromTs || ts > toTs || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
  }
  out.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return out;
}

// Instagram's CDN links are SIGNED and expire — every slide URL in the August
// snapshot (captured 14 Sep) was returning 403 by 22 Sep. A stored month therefore
// carries good numbers but dead images, which shows up as black frames in the post
// modal. Re-ask Meta for just the media URLs, batched 50 ids per call: one request
// refreshes a whole month's images, versus one-per-post for the insights we are
// deliberately NOT re-fetching. Numbers still come from the snapshot.
async function refreshMediaUrls(acc: IGAccountConfig, posts: HistPost[]): Promise<void> {
  const CHUNK = 50;
  const chunks: HistPost[][] = [];
  for (let i = 0; i < posts.length; i += CHUNK) chunks.push(posts.slice(i, i + CHUNK));
  await Promise.all(chunks.map(async (slice) => {
    const ids = slice.map((p) => p.id).join(",");
    const url = `${graphFor(acc.pageAccessToken)}/?ids=${ids}&fields=media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}&access_token=${acc.pageAccessToken}`;
    try {
      const res = await metaLimiter(() => fetchWithTimeout(url, { cache: "no-store" }));
      const body = (await res.json()) as Record<string, {
        media_type?: string;
        media_url?: string;
        thumbnail_url?: string;
        children?: { data?: { media_type?: string; media_url?: string; thumbnail_url?: string }[] };
        error?: unknown;
      }>;
      for (const post of slice) {
        const fresh = body[post.id];
        if (!fresh || fresh.error) continue;   // deleted post → keep what we stored
        const main = fresh.thumbnail_url || fresh.media_url;
        if (main) post.mediaUrl = main;
        if (fresh.media_type === "VIDEO" && fresh.media_url) post.videoUrl = fresh.media_url;
        const kids = (fresh.children?.data ?? []).filter((c) => c.thumbnail_url || c.media_url);
        if (kids.length) post.mediaUrls = kids.map((c) => c.thumbnail_url || c.media_url || "");
        const vids = kids.map((c) => (c.media_type === "VIDEO" ? c.media_url || "" : ""));
        if (vids.some(Boolean)) post.slideVideos = vids;
      }
    } catch { /* leave the stored URLs — stale images beat no post at all */ }
  }));
}

// Serve a range that ENDS TODAY without re-fetching months we already hold.
//
// /api/posts used to be all-or-nothing: a range ending today went live for its
// whole span, and one Meta call per post meant a 60- or 90-day window took
// 20–40s every time the cache went cold. Anything older than the current month
// is frozen — its posts and their insights can't change — so those months are
// read from the monthly snapshots and only the months we genuinely lack (plus
// the current, still-growing one) are fetched live.
//
// Returns the merged, de-duplicated, newest-first list clipped to [from, to],
// along with which months came from where so the caller can report it.
export async function readPostsForRangeHybrid(
  acc: IGAccountConfig,
  from: string,
  to: string,
  opts: { withInsights?: boolean; cap?: number } = {},
): Promise<{ posts: HistPost[]; storedMonths: string[]; liveMonths: string[] }> {
  const months = monthsInRange(from, to);
  const thisMonth = currentMonth();

  // A stored month is only usable if it is fully in the past; the current month
  // keeps growing, so it always goes live.
  const snaps = await Promise.all(
    months.map(async (mo) => (mo === thisMonth ? null : await readPostsMonthSnapshot(acc.id, mo))),
  );

  const storedMonths: string[] = [];
  const liveMonths: string[] = [];
  const out: HistPost[] = [];
  const seen = new Set<string>();
  const push = (p: HistPost) => {
    const ts = new Date(p.timestamp).getTime();
    if (ts < fromTs || ts > toTs || seen.has(p.id)) return;
    seen.add(p.id);
    out.push(p);
  };
  const fromTs = new Date(from + "T00:00:00Z").getTime();
  const toTs = new Date(to + "T23:59:59Z").getTime();

  // Live months are fetched as one contiguous span per run of adjacent months,
  // so a gap in storage doesn't turn into a burst of tiny Meta calls.
  const liveRuns: { from: string; to: string }[] = [];
  months.forEach((mo, idx) => {
    if (snaps[idx]) { storedMonths.push(mo); return; }
    liveMonths.push(mo);
    const b = monthBounds(mo);
    const lo = b.from < from ? from : b.from;
    const hi = b.to > to ? to : b.to;
    const last = liveRuns[liveRuns.length - 1];
    if (last && new Date(lo).getTime() - new Date(last.to).getTime() <= 86_400_000) last.to = hi;
    else liveRuns.push({ from: lo, to: hi });
  });

  const storedIds = new Set<string>();
  for (const s of snaps) if (s) for (const p of s.posts) { storedIds.add(p.id); push(p); }
  const fetched = await Promise.all(liveRuns.map((r) => fetchPostsInRange(acc, r.from, r.to, opts)));
  for (const list of fetched) for (const p of list) push(p);

  out.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const cap = opts.cap && opts.cap > 0 ? opts.cap : 500;
  const page = out.slice(0, cap);
  // Only the ones that came from storage need new links; the live fetch's are fresh.
  const stale = page.filter((p) => storedIds.has(p.id));
  if (stale.length) await refreshMediaUrls(acc, stale);
  return { posts: page, storedMonths, liveMonths };
}
