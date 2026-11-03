import { getAccount, getDefaultAccountId, fetchBasic, fetchAccountReachUnique, fetchAccountEngagement, fetchMediaSince } from "@/lib/instagram";
import { hasYouTubeAuth, buildLiveYouTube } from "@/lib/youtube";
import { linkedinToken, buildLive as buildLinkedIn } from "@/lib/linkedin";
import { airtableList, CRM_TABLE, dateRangeFormula, pickName } from "@/lib/sales-hub";
import { getSbuMap } from "@/lib/lead-assignment";
import { readSnapshots } from "@/lib/snapshot";
import { getManual } from "@/lib/report-manual";
import { getSupabase } from "@/lib/supabase";

// The numbers behind the monthly report, one function per section. The report's API
// routes call these for the page, and the daily cron calls buildReportSnapshot() so
// every month is saved in full on its last day even if nobody opens the report.
// See docs/MONTHLY_REPORT_SPEC.md.

const DAY = 86_400_000;
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
const today = () => new Date().toISOString().slice(0, 10);

async function crmLeads(from: string, to: string, fields: string[]) {
  return airtableList<Record<string, unknown>>(CRM_TABLE, {
    filterByFormula: dateRangeFormula("Created Date", from, to),
    fields, pageSize: 100, maxRecords: 30_000,
  });
}
const sourceOf = (rec: { fields: Record<string, unknown> }) => (pickName(rec.fields["Lead Source (n8n)"]) || "").toLowerCase();

export async function instagramMonth(from: string, to: string, accountId = getDefaultAccountId()) {
  const acc = getAccount(accountId);
  if (!acc) return { available: false, reason: "no account" };
  // Meta caps account insights at 30 days. For a 31-day month, reach (unique people,
  // which can't be added up) covers the last 30 days; interactions add day 1 back.
  const long = days(from, to) > 30;
  const reachFrom = long ? addDays(to, -29) : from;
  const isPast = to < today();

  const [basic, reach, engA, engB, media, crm, snaps, stories] = await Promise.all([
    fetchBasic(acc).catch(() => null),
    fetchAccountReachUnique(acc, reachFrom, to).catch(() => null),
    fetchAccountEngagement(acc, long ? addDays(from, 1) : from, to).catch(() => null),
    long ? fetchAccountEngagement(acc, from, from).catch(() => null) : Promise.resolve({ interactions: 0, profileViews: 0 }),
    fetchMediaSince(acc, from).catch(() => []),
    crmLeads(from, to, ["Lead Source (n8n)"]).catch(() => []),
    // Followers are only ever "today's" count, so a past month reads the daily
    // snapshot taken closest to its last day.
    isPast ? readSnapshots(acc.id, from, to).catch(() => []) : Promise.resolve([]),
    // Stories vanish from the API after 24h; the story cron keeps a copy of each.
    getSupabase()?.from("story_snapshots").select("story_id", { count: "exact", head: true })
      .eq("account_id", acc.id).gte("posted_at", from).lt("posted_at", addDays(to, 1)) ?? Promise.resolve({ count: null }),
  ]);

  let post = 0, reel = 0;
  for (const m of media) {
    const ts = (m.timestamp || "").slice(0, 10);
    if (!ts || ts < from || ts > to || m.media_product_type === "STORY") continue;
    if (m.media_product_type === "REELS") reel++; else post++;
  }
  const leads = crm.filter((r) => { const s = sourceOf(r); return s.includes("instagram") || s.includes("facebook"); }).length;
  const last = snaps[snaps.length - 1];

  return {
    available: !!basic,
    window: { from, to },
    followers: isPast ? last?.followers ?? null : basic?.followers_count ?? null,
    followersAsOf: isPast ? last?.date ?? null : to,
    reach,
    reachFrom,
    contentInteractions: engA && engB ? engA.interactions + engB.interactions : null,
    // The story cron's first copies are from 1 Jul 2026 — earlier months are unknown, not 0.
    post, reel, story: from < "2026-07-01" ? null : stories.count ?? 0, leads,
  };
}

export async function instagramTop(from: string, to: string, limit = 6, accountId = getDefaultAccountId()) {
  const acc = getAccount(accountId);
  if (!acc) return { available: false, posts: [] };
  const media = await fetchMediaSince(acc, from).catch(() => []);
  const posts = media
    .filter((m) => { const ts = (m.timestamp || "").slice(0, 10); return ts && ts >= from && ts <= to && m.media_product_type !== "STORY"; })
    .map((m) => ({
      permalink: m.permalink,
      thumb: m.thumbnail_url || m.media_url || "",
      type: m.media_product_type === "REELS" ? "Reel" : m.media_type === "CAROUSEL_ALBUM" ? "Carousel" : "Post",
      likes: m.like_count || 0,
      comments: m.comments_count || 0,
      timestamp: m.timestamp || "",
    }))
    .sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))
    .slice(0, limit);
  return { available: posts.length > 0, window: { from, to }, posts };
}

export async function youtubeMonth(from: string, to: string, key = "goocampus") {
  if (!(await hasYouTubeAuth())) return { available: false, reason: "no auth" };
  const [live, crm] = await Promise.all([buildLiveYouTube(key, from, to), crmLeads(from, to, ["Lead Source (n8n)"]).catch(() => [])]);
  const s = live.summary;
  return { available: true, subscribers: s.subscribers, views: s.views, video: s.postedVideos, shorts: s.postedShorts, leads: crm.filter((r) => sourceOf(r).includes("youtube")).length };
}

export async function linkedinMonth(from: string, to: string, key = "goocampus") {
  if (!(await linkedinToken())) return { available: false, reason: "no token" };
  const live = await buildLinkedIn(key, from, to);
  // LinkedIn hands back the latest 25 posts whatever the dates — keep the month's.
  const posts = live.posts.filter((p) => p.date >= from && p.date <= to);
  const oldest = live.posts[live.posts.length - 1]?.date || "";
  return {
    available: true,
    followers: live.summary.followers,
    impressions: live.summary.impressions,
    reactions: posts.reduce((n, p) => n + (p.reactions || 0), 0),
    posts: posts.length,
    comments: posts.reduce((n, p) => n + (p.comments || 0), 0),
    // LinkedIn returns the latest 25 posts only; if none reach back before the
    // month started, the month's count can't be known.
    postsComplete: !!oldest && oldest < from,
  };
}

export async function leadStatus(from: string, to: string) {
  const [leads, sbuMap] = await Promise.all([crmLeads(from, to, ["Lead Status", "Primary Interest (n8n)"]), getSbuMap()]);
  const statusCount = new Map<string, number>();
  const agg = new Map<string, { total: number; counts: Map<string, number> }>();
  for (const rec of leads) {
    const status = pickName(rec.fields["Lead Status"]) || "—";
    const sbu = sbuMap.get(pickName(rec.fields["Primary Interest (n8n)"]) || "No primary interest") || "Other";
    statusCount.set(status, (statusCount.get(status) || 0) + 1);
    let s = agg.get(sbu);
    if (!s) { s = { total: 0, counts: new Map() }; agg.set(sbu, s); }
    s.total += 1;
    s.counts.set(status, (s.counts.get(status) || 0) + 1);
  }
  const byStatus = [...statusCount.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
  const bySbu = [...agg.entries()]
    .map(([sbu, v]) => ({ sbu, total: v.total, counts: Object.fromEntries(v.counts) as Record<string, number> }))
    .sort((a, b) => b.total - a.total);
  return { window: { from, to }, total: leads.length, byStatus, statuses: byStatus.map((s) => s.status), bySbu };
}

// Organic only — paid ads / referrals excluded, so Total = sum of the 5 buckets.
function bucketOf(source: string): "igfb" | "dmBookings" | "ytEnquiries" | "website" | "inboundCall" | null {
  if (source.includes("instagram") || source.includes("facebook")) return "igfb";
  if (source.includes("dm booking") || source === "bookings") return "dmBookings";
  if (source.includes("youtube")) return "ytEnquiries";
  if (source.includes("website")) return "website";
  if (source.includes("inbound call")) return "inboundCall";
  return null;
}

export async function organicLeads(from: string, to: string) {
  const leads = await crmLeads(from, to, ["Created Date", "Lead Source (n8n)"]);
  type Row = { month: string; igfb: number; dmBookings: number; ytEnquiries: number; website: number; inboundCall: number; total: number };
  const byMonth = new Map<string, Row>();
  for (const rec of leads) {
    const created = pickName(rec.fields["Created Date"]);
    const b = bucketOf(sourceOf(rec));
    if (!created || !b) continue;
    const month = created.slice(0, 7);
    let row = byMonth.get(month);
    if (!row) { row = { month, igfb: 0, dmBookings: 0, ytEnquiries: 0, website: 0, inboundCall: 0, total: 0 }; byMonth.set(month, row); }
    row[b] += 1;
    row.total += 1;
  }
  // Guard against a boundary/timezone leak: only months at/after the requested start.
  const rows = [...byMonth.values()].filter((r) => r.month >= from.slice(0, 7)).sort((a, b) => a.month.localeCompare(b.month));
  return { estimate: true, rows };
}

// ---------- Saved copy of a month ----------
const SNAP_SOURCE = "report_snapshot";
export const snapshotKey = (month: string) => `report-snapshot:${month}`;

export async function saveReportSnapshot(month: string, payload: unknown) {
  const sb = getSupabase();
  if (!sb) throw new Error("database unavailable");
  const at = new Date().toISOString();
  await sb.from("discover_cache").upsert(
    { cache_key: snapshotKey(month), source: SNAP_SOURCE, last_fetched: at, payload: payload ?? {} },
    { onConflict: "cache_key" },
  );
  return at;
}

/** Everything the report shows for `month`, from its 1st to `to`, in the shape the page saves. */
export async function buildReportSnapshot(month: string, to: string) {
  const from = `${month}-01`;
  const label = new Date(from + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const settle = <T,>(p: Promise<T>) => p.catch(() => null);
  const [leadStatusR, organic, instagram, youtube, linkedin, topPosts, manual] = await Promise.all([
    settle(leadStatus(from, to)), settle(organicLeads(from, to)), settle(instagramMonth(from, to)),
    settle(youtubeMonth(from, to)), settle(linkedinMonth(from, to)), settle(instagramTop(from, to)), settle(getManual(month)),
  ]);
  return { label, window: { from, to }, leadStatus: leadStatusR, organic, instagram, youtube, linkedin, topPosts, manual };
}
