import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
// Microsoft Clarity Data Export API — goocampusevents.com (project x258m54ioh).
// Returns aggregate behavior metrics for the LAST 1–3 DAYS ONLY (API limit), and
// is capped at 10 calls/project/day — so callers MUST cache aggressively.
// Heatmaps & session recordings are NOT exposed by this API (Clarity-UI only).
// Auth: Bearer CLARITY_API_TOKEN (Data.Export scope JWT) from .env.local.

const TOKEN = process.env.CLARITY_API_TOKEN || "";
const PROJECT_ID = process.env.CLARITY_PROJECT_ID || "";

export function hasClarityAuth(): boolean {
  return Boolean(TOKEN);
}

// Frustration / error signals → friendly labels, in display order.
const SIGNALS: Record<string, string> = {
  RageClickCount: "Rage clicks",
  DeadClickCount: "Dead clicks",
  QuickbackClick: "Quick backs",
  ExcessiveScroll: "Excessive scrolling",
  ErrorClickCount: "Error clicks",
  ScriptErrorCount: "Script errors",
};

type Info = Record<string, string | number>;
type Metric = { metricName: string; information: Info[] };

export async function buildClarity(numOfDays: 1 | 2 | 3 = 3) {
  const res = await fetchWithTimeout(`https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=${numOfDays}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`Clarity API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const arr = (await res.json()) as Metric[];
  const by: Record<string, Info[]> = Object.fromEntries(arr.map((m) => [m.metricName, m.information || []]));
  const num = (v: string | number | undefined) => Number(v || 0);
  const first = (n: string): Info => by[n]?.[0] || {};
  const dim = (n: string) => (by[n] || []).map((r) => ({ name: String(r.name ?? "(unknown)"), value: num(r.sessionsCount) }));

  const traffic = first("Traffic");
  const eng = first("EngagementTime");

  return {
    source: "live" as const,
    projectId: PROJECT_ID,
    numOfDays,
    traffic: {
      sessions: num(traffic.totalSessionCount),
      botSessions: num(traffic.totalBotSessionCount),
      distinctUsers: num(traffic.distinctUserCount),
      pagesPerSession: num(traffic.pagesPerSessionPercentage),
    },
    scrollDepth: num(first("ScrollDepth").averageScrollDepth),
    engagement: { totalTimeSec: num(eng.totalTime), activeTimeSec: num(eng.activeTime) },
    signals: Object.entries(SIGNALS).map(([k, label]) => {
      const r = first(k);
      return { name: label, sessionsPct: num(r.sessionsWithMetricPercentage), count: num(r.subTotal) };
    }),
    devices: dim("Device"),
    browsers: dim("Browser"),
    os: dim("OS"),
    countries: dim("Country"),
    referrers: dim("ReferrerUrl"),
    pages: (by["PopularPages"] || []).map((r) => ({ url: String(r.url ?? ""), visits: num(r.visitsCount) })),
  };
}
