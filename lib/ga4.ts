// Google Analytics 4 (Data API + Realtime API) client — GooCampus Events
// (goocampusevents.com). Zero-dependency: sign the service-account JWT with
// Node's built-in crypto, exchange for an access token, hit GA over plain fetch.
// Credentials in .env.local: GA4_PROPERTY_ID / GA4_CLIENT_EMAIL / GA4_PRIVATE_KEY.
// The service account (ig-dashboard-ga-reader@…) has Viewer on the property.
import crypto from "crypto";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const PROPERTY = process.env.GA4_PROPERTY_ID || "";
const CLIENT_EMAIL = process.env.GA4_CLIENT_EMAIL || "";
const PRIVATE_KEY = (process.env.GA4_PRIVATE_KEY || "").replace(/\\n/g, "\n");

export function hasGA4Auth(): boolean {
  return Boolean(PROPERTY && CLIENT_EMAIL && PRIVATE_KEY);
}

// ── auth ──────────────────────────────────────────────────────────────────
let tokenCache: { token: string; exp: number } | null = null;

function b64url(s: string | Buffer): string {
  return Buffer.from(s).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  signer.end();
  const jwt = `${header}.${claim}.${b64url(signer.sign(PRIVATE_KEY))}`;
  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`GA4 token error: ${JSON.stringify(json)}`);
  tokenCache = { token: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

// ── reporting ───────────────────────────────────────────────────────────────
type ReportSpec = { dimensions?: string[]; metrics: string[]; orderByMetric?: string; limit?: number };
type GaRow = { dims: string[]; mets: number[] };
type RawRep = { rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[] };

function parse(rep: RawRep): GaRow[] {
  return (rep.rows || []).map((r) => ({
    dims: (r.dimensionValues || []).map((d) => d.value),
    mets: (r.metricValues || []).map((m) => Number(m.value)),
  }));
}

// GA4 caps batchRunReports at 5 reports per call.
async function batchRun(from: string, to: string, specs: ReportSpec[]): Promise<GaRow[][]> {
  const token = await getAccessToken();
  const body = {
    requests: specs.map((r) => ({
      dateRanges: [{ startDate: from, endDate: to }],
      dimensions: (r.dimensions || []).map((name) => ({ name })),
      metrics: r.metrics.map((name) => ({ name })),
      ...(r.orderByMetric ? { orderBys: [{ metric: { metricName: r.orderByMetric }, desc: true }] } : {}),
      ...(r.limit ? { limit: String(r.limit) } : {}),
      keepEmptyRows: false,
    })),
  };
  const res = await fetchWithTimeout(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:batchRunReports`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) throw new Error(`GA4 report error: ${json.error.message || JSON.stringify(json.error)}`);
  return (json.reports || []).map(parse);
}

const isoDate = (ga: string) => (ga?.length === 8 ? `${ga.slice(0, 4)}-${ga.slice(4, 6)}-${ga.slice(6, 8)}` : ga);

// Categorical breakdown → [{name,value,pct}], skipping GA's "(not set)"/unknown noise.
function breakdown(rows: GaRow[], metricIdx = 0) {
  const total = rows.reduce((a, r) => a + (r.mets[metricIdx] || 0), 0);
  return rows.map((r) => {
    const value = r.mets[metricIdx] || 0;
    return { name: r.dims[0] || "(unknown)", value, pct: total > 0 ? Math.round((value / total) * 1000) / 10 : 0 };
  });
}

export async function buildGA4Traffic(from: string, to: string) {
  // 16 reports across four ≤5 batches, all in parallel.
  const [a, b, c, d] = await Promise.all([
    batchRun(from, to, [
      { metrics: ["totalUsers", "newUsers", "sessions", "engagedSessions", "screenPageViews", "keyEvents", "averageSessionDuration", "engagementRate", "bounceRate", "screenPageViewsPerSession"] },
      { dimensions: ["date"], metrics: ["activeUsers", "sessions", "keyEvents"] },
      { dimensions: ["pagePath", "pageTitle"], metrics: ["screenPageViews"], orderByMetric: "screenPageViews", limit: 10 },
      { dimensions: ["landingPage"], metrics: ["sessions", "keyEvents"], orderByMetric: "sessions", limit: 10 },
      { dimensions: ["eventName"], metrics: ["eventCount", "keyEvents"], orderByMetric: "eventCount", limit: 15 },
    ]),
    batchRun(from, to, [
      { dimensions: ["sessionDefaultChannelGroup"], metrics: ["sessions"], orderByMetric: "sessions", limit: 10 },
      { dimensions: ["sessionSourceMedium"], metrics: ["sessions"], orderByMetric: "sessions", limit: 10 },
      { dimensions: ["country"], metrics: ["activeUsers"], orderByMetric: "activeUsers", limit: 10 },
      { dimensions: ["city"], metrics: ["activeUsers"], orderByMetric: "activeUsers", limit: 10 },
      { dimensions: ["deviceCategory"], metrics: ["sessions"], orderByMetric: "sessions", limit: 6 },
    ]),
    batchRun(from, to, [
      { dimensions: ["browser"], metrics: ["sessions"], orderByMetric: "sessions", limit: 8 },
      { dimensions: ["operatingSystem"], metrics: ["sessions"], orderByMetric: "sessions", limit: 8 },
      { dimensions: ["language"], metrics: ["sessions"], orderByMetric: "sessions", limit: 8 },
      { dimensions: ["newVsReturning"], metrics: ["activeUsers"], orderByMetric: "activeUsers", limit: 5 },
      { dimensions: ["userAgeBracket"], metrics: ["activeUsers"], orderByMetric: "activeUsers", limit: 8 },
    ]),
    batchRun(from, to, [
      { dimensions: ["userGender"], metrics: ["activeUsers"], orderByMetric: "activeUsers", limit: 5 },
      // For the list + map card: ISO country codes, Indian states, cities with their state.
      { dimensions: ["countryId"], metrics: ["activeUsers"], orderByMetric: "activeUsers", limit: 25 },
      { dimensions: ["region", "countryId"], metrics: ["activeUsers"], orderByMetric: "activeUsers", limit: 80 },
      { dimensions: ["city", "region", "countryId"], metrics: ["activeUsers"], orderByMetric: "activeUsers", limit: 25 },
    ]),
  ]);

  const s = a[0]?.[0]?.mets || [];
  return {
    source: "live" as const,
    property: PROPERTY,
    range: { from, to },
    summary: {
      users: s[0] || 0,
      newUsers: s[1] || 0,
      sessions: s[2] || 0,
      engagedSessions: s[3] || 0,
      pageViews: s[4] || 0,
      keyEvents: s[5] || 0,
      avgSessionSec: Math.round(s[6] || 0),
      engagementRate: Math.round((s[7] || 0) * 1000) / 10,
      bounceRate: Math.round((s[8] || 0) * 1000) / 10,
      viewsPerSession: Math.round((s[9] || 0) * 10) / 10,
    },
    usersOverTime: a[1]
      .map((r) => ({ date: isoDate(r.dims[0]), users: r.mets[0] || 0, sessions: r.mets[1] || 0, keyEvents: r.mets[2] || 0 }))
      .sort((x, y) => x.date.localeCompare(y.date)),
    topPages: a[2].map((r) => ({ path: r.dims[0], title: r.dims[1] || r.dims[0], views: r.mets[0] || 0 })),
    landingPages: a[3].map((r) => ({ path: r.dims[0], sessions: r.mets[0] || 0, keyEvents: r.mets[1] || 0 })),
    events: a[4].map((r) => ({ name: r.dims[0], count: r.mets[0] || 0, keyEvents: r.mets[1] || 0 })),
    channels: breakdown(b[0]).map((x) => ({ channel: x.name, sessions: x.value, pct: x.pct })),
    sourceMedium: breakdown(b[1]).map((x) => ({ name: x.name, sessions: x.value, pct: x.pct })),
    countries: breakdown(b[2]).map((x) => ({ country: x.name, users: x.value, pct: x.pct })),
    cities: breakdown(b[3]).map((x) => ({ city: x.name, users: x.value, pct: x.pct })),
    // Geography for the list + map card (LocationCard): real Indian states from GA's region,
    // cities labelled "City, State, India" (other countries keep their code, so no state).
    geo: {
      countries: d[1].filter((r) => r.dims[0] && r.dims[0] !== "(not set)").map((r) => ({ code: r.dims[0], users: r.mets[0] || 0 })),
      states: d[2].filter((r) => r.dims[1] === "IN" && r.dims[0] && r.dims[0] !== "(not set)").map((r) => ({ state: r.dims[0], users: r.mets[0] || 0 })),
      cities: d[3].filter((r) => r.dims[0] && r.dims[0] !== "(not set)")
        .map((r) => ({ label: [r.dims[0], r.dims[1] !== "(not set)" ? r.dims[1] : "", r.dims[2] === "IN" ? "India" : r.dims[2]].filter(Boolean).join(", "), users: r.mets[0] || 0 })),
    },
    devices: breakdown(b[4]).map((x) => ({ device: x.name, sessions: x.value, pct: x.pct })),
    browsers: breakdown(c[0]),
    os: breakdown(c[1]),
    languages: breakdown(c[2]),
    newVsReturning: breakdown(c[3]),
    age: breakdown(c[4]),
    gender: breakdown(d[0]),
  };
}

// ── realtime (last 30 min) — separate API, kept fresh (not on the 10-min cache) ──
async function runRealtime(dim: string, limit = 10): Promise<GaRow[]> {
  const token = await getAccessToken();
  const res = await fetchWithTimeout(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runRealtimeReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ dimensions: [{ name: dim }], metrics: [{ name: "activeUsers" }], limit: String(limit) }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`GA4 realtime error: ${json.error.message || JSON.stringify(json.error)}`);
  return parse(json);
}

export async function buildGA4Realtime() {
  const [country, device] = await Promise.all([runRealtime("country", 8), runRealtime("deviceCategory", 5)]);
  return {
    activeUsers: country.reduce((a, r) => a + (r.mets[0] || 0), 0),
    byCountry: country.map((r) => ({ name: r.dims[0] || "(unknown)", value: r.mets[0] || 0 })),
    byDevice: device.map((r) => ({ name: r.dims[0] || "(unknown)", value: r.mets[0] || 0 })),
  };
}
