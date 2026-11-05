// Google Search Console (Search Analytics) client for goocampusevents.com.
// Reuses the GA4 service account (see lib/google-jwt.ts) — the ONLY manual step
// is adding that service-account email as a user on the Search Console property.
// Powers the Content Radar SEO lanes: winning keywords (rank ≤10) + striking-
// distance gaps (rank 11–20, the page-2 opportunities worth pushing up).
import { googleAccessToken, hasGoogleServiceAccount, SERVICE_ACCOUNT_EMAIL } from "./google-jwt";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

// The property we want data for. If GSC_SITE_URL is set we trust it; otherwise
// we auto-discover the right property (domain vs URL-prefix) from whatever the
// service account can actually see — so it works no matter how the property was
// verified.
const TARGET_DOMAIN = "goocampusevents.com";
const ENV_SITE_URL = process.env.GSC_SITE_URL || "";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

// Thrown when the service account exists but isn't a user on the property yet —
// the API route turns this into a 403 with a fix-it message.
export class GscNoAccessError extends Error {
  constructor(public siteUrl: string, public account: string) {
    super("GSC_NO_ACCESS");
    this.name = "GscNoAccessError";
  }
}

// Thrown when the Search Console API isn't enabled in the Cloud project that owns
// the service account (a one-click enable in Google Cloud Console).
export class GscApiDisabledError extends Error {
  constructor(public enableUrl: string, public detail: string) {
    super("GSC_API_DISABLED");
    this.name = "GscApiDisabledError";
  }
}

// Turn a Google error payload into the most actionable error we can.
function classifyGscError(json: { error?: { code?: number; status?: string; message?: string; details?: { reason?: string }[] } }, siteUrl: string): Error {
  const err = json.error || {};
  const msg = err.message || JSON.stringify(err);
  const disabled = /has not been used in project|SERVICE_DISABLED/i.test(msg)
    || (err.details || []).some((d) => d.reason === "SERVICE_DISABLED");
  if (disabled) {
    const m = msg.match(/https:\/\/console\.developers\.google\.com\S+/);
    return new GscApiDisabledError(m ? m[0].replace(/[.\s]+$/, "") : "", msg);
  }
  if (err.code === 403 || err.status === "PERMISSION_DENIED") {
    return new GscNoAccessError(siteUrl, SERVICE_ACCOUNT_EMAIL);
  }
  return new Error(`GSC error: ${msg}`);
}

export function hasGSCAuth(): boolean {
  return hasGoogleServiceAccount();
}
let resolvedSiteUrl: string | null = ENV_SITE_URL || null;
export function gscSiteUrl(): string { return resolvedSiteUrl || ENV_SITE_URL || `sc-domain:${TARGET_DOMAIN}`; }
export function gscServiceAccount(): string { return SERVICE_ACCOUNT_EMAIL; }

type SiteEntry = { siteUrl: string; permissionLevel: string };

// All properties the service account can read. Handy for setup debugging and the
// basis for auto-discovery below.
export async function listGscSites(): Promise<SiteEntry[]> {
  const token = await googleAccessToken(SCOPE);
  const res = await fetchWithTimeout("https://searchconsole.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (json.error) throw classifyGscError(json, gscSiteUrl());
  return (json.siteEntry || []) as SiteEntry[];
}

// Pick the property to query: an explicit env override wins; otherwise find the
// one matching goocampusevents.com among the SA's verified properties, preferring
// the domain property, then a URL-prefix (https before http). Result is cached.
async function resolveSiteUrl(): Promise<string> {
  if (ENV_SITE_URL) return ENV_SITE_URL;
  if (resolvedSiteUrl) return resolvedSiteUrl;
  const sites = (await listGscSites()).filter((s) => s.permissionLevel !== "siteUnverifiedUser");
  const host = (u: string) => u.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
  const matches = sites.filter((s) => host(s.siteUrl).endsWith(TARGET_DOMAIN));
  if (!matches.length) throw new GscNoAccessError(gscSiteUrl(), SERVICE_ACCOUNT_EMAIL);
  const rank = (u: string) => (u.startsWith("sc-domain:") ? 0 : u.startsWith("https://") ? 1 : 2);
  matches.sort((a, b) => rank(a.siteUrl) - rank(b.siteUrl));
  resolvedSiteUrl = matches[0].siteUrl;
  return resolvedSiteUrl;
}

type RawRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
export type SeoKeyword = { query: string; clicks: number; impressions: number; ctr: number; position: number };

const pct = (n: number) => Math.round(n * 1000) / 10;   // ratio → %, 1 dp
const r1 = (n: number) => Math.round(n * 10) / 10;

// One Search Analytics query for a given dimension set (empty = totals only).
async function gscQuery(from: string, to: string, dimensions: string[], rowLimit = 500): Promise<RawRow[]> {
  const siteUrl = await resolveSiteUrl();
  const token = await googleAccessToken(SCOPE);
  const res = await fetchWithTimeout(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: from, endDate: to, dimensions, rowLimit, dataState: "all" }),
    },
  );
  const json = await res.json();
  if (json.error) throw classifyGscError(json, siteUrl);
  return (json.rows || []) as RawRow[];
}

// Our real Google searches that contain `term` (SEO tab → Google research): what
// people typed when our pages showed up, with impressions / clicks / position.
export async function searchConsoleQueriesContaining(term: string, from: string, to: string, limit = 50): Promise<SeoKeyword[]> {
  const siteUrl = await resolveSiteUrl();
  const token = await googleAccessToken(SCOPE);
  const res = await fetchWithTimeout(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      startDate: from, endDate: to, dimensions: ["query"], rowLimit: 500, dataState: "all",
      dimensionFilterGroups: [{ filters: [{ dimension: "query", operator: "contains", expression: term.toLowerCase() }] }],
    }),
  });
  const json = await res.json();
  if (json.error) throw classifyGscError(json, siteUrl);
  return ((json.rows || []) as RawRow[])
    .map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: pct(r.ctr), position: r1(r.position) }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

// Full analytics payload for the Website · Google Search Console sub-tab — same
// shape the Bing tab renders (summary + over-time + top queries + top pages).
export async function buildSearchConsoleFull(from: string, to: string) {
  const [sum, dates, queries, pages] = await Promise.all([
    gscQuery(from, to, [], 1),
    gscQuery(from, to, ["date"], 1000),
    gscQuery(from, to, ["query"], 100),
    gscQuery(from, to, ["page"], 100),
  ]);
  const s = sum[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return {
    source: "live" as const,
    siteUrl: gscSiteUrl(),
    summary: { clicks: s.clicks, impressions: s.impressions, ctr: pct(s.ctr), avgPosition: r1(s.position) },
    overTime: dates
      .map((d) => ({ date: d.keys[0], clicks: d.clicks, impressions: d.impressions }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    queries: queries.slice(0, 25).map((q) => ({ query: q.keys[0], clicks: q.clicks, impressions: q.impressions, ctr: pct(q.ctr), position: r1(q.position) })),
    pages: pages.slice(0, 25).map((p) => ({ url: p.keys[0], clicks: p.clicks, impressions: p.impressions, position: r1(p.position) })),
  };
}

export async function buildSearchConsole(from: string, to: string) {
  const rows = await gscQuery(from, to, ["query"]);
  const norm = (r: RawRow): SeoKeyword => ({
    query: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: Math.round(r.ctr * 1000) / 10,      // → percentage, 1 dp
    position: Math.round(r.position * 10) / 10,
  });
  const all = rows.map(norm);
  // Winning: already on page 1 — rank the ones actually earning clicks.
  const winning = all
    .filter((r) => r.position <= 10)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 15);
  // Striking distance: page 2 (rank 11–20) — sort by impressions, since high
  // demand + almost-page-1 = the biggest, cheapest wins.
  const striking = all
    .filter((r) => r.position > 10 && r.position <= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15);
  return {
    source: "live" as const,
    siteUrl: gscSiteUrl(),
    range: { from, to },
    totals: {
      clicks: all.reduce((s, r) => s + r.clicks, 0),
      impressions: all.reduce((s, r) => s + r.impressions, 0),
      queries: all.length,
    },
    winning,
    striking,
  };
}
