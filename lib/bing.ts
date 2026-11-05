import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
// Bing Webmaster Tools API — goocampusevents.com search performance.
// Account-level API key (BING_WEBMASTER_API_KEY) + verified site (BING_SITE_URL),
// both in .env.local. JSON endpoints return a WCF-style { "d": [...] } envelope.
// NOTE: the property currently reports 0 clicks / 0 impressions — this integration
// is correct and will populate if/when Bing sends the site search traffic.

const KEY = process.env.BING_WEBMASTER_API_KEY || "";
const SITE = process.env.BING_SITE_URL || "";
const BASE = "https://ssl.bing.com/webmaster/api.svc/json";

export function hasBingAuth(): boolean {
  return Boolean(KEY && SITE);
}

type Row = Record<string, unknown>;
async function call(method: string): Promise<Row[]> {
  const url = `${BASE}/${method}?apikey=${KEY}&siteUrl=${encodeURIComponent(SITE)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Bing ${method} ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const j = (await res.json()) as { d?: Row[] };
  return Array.isArray(j?.d) ? j.d : [];
}

const num = (v: unknown) => Number((v as number) || 0);
// Bing serializes dates as "/Date(1780642800000-0700)/".
const parseDate = (s: unknown) => {
  const m = /\/Date\((\d+)/.exec(String(s || ""));
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : "";
};
const round1 = (n: number) => Math.round(n * 10) / 10;

export async function buildBing() {
  const [traffic, queries, pages] = await Promise.all([
    call("GetRankAndTrafficStats"),
    call("GetQueryStats"),
    call("GetPageStats"),
  ]);

  const overTime = traffic
    .map((r) => ({ date: parseDate(r.Date), clicks: num(r.Clicks), impressions: num(r.Impressions) }))
    .filter((r) => r.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const totalClicks = overTime.reduce((s, r) => s + r.clicks, 0);
  const totalImpr = overTime.reduce((s, r) => s + r.impressions, 0);

  const q = queries
    .map((r) => ({
      query: String(r.Query ?? ""),
      clicks: num(r.Clicks),
      impressions: num(r.Impressions),
      position: round1(num(r.AvgImpressionPosition)),
      ctr: num(r.Impressions) ? round1((num(r.Clicks) / num(r.Impressions)) * 100) : 0,
    }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20);

  const pg = pages
    .map((r) => {
      const label = r.Query ?? r.Page ?? r.Url ?? Object.values(r).find((v) => typeof v === "string" && v.startsWith("http")) ?? "";
      return { url: String(label), clicks: num(r.Clicks), impressions: num(r.Impressions), position: round1(num(r.AvgImpressionPosition)) };
    })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20);

  return {
    source: "live" as const,
    siteUrl: SITE,
    summary: {
      clicks: totalClicks,
      impressions: totalImpr,
      ctr: totalImpr ? round1((totalClicks / totalImpr) * 100) : 0,
      avgPosition: q.length ? round1(q.reduce((s, x) => s + x.position, 0) / q.length) : 0,
    },
    overTime,
    queries: q,
    pages: pg,
  };
}
