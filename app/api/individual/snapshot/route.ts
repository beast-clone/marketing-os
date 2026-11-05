import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { format, subDays } from "date-fns";
import { getConfiguredAccounts, fetchBasic, fetchAccountInsights, fetchRecentMedia, graphFor } from "@/lib/instagram";
import { buildLive as linkedinBuildLive } from "@/lib/linkedin";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

// Live per-brand snapshot for the individual dashboard.
//   Instagram — real followers / 30d reach / engagement (all accounts)
//   Facebook  — real page followers + best-effort 28d reach & engagement (all accounts with a page)
//   LinkedIn  — real followers / impressions / engagement (GooCampus World only — the approved org)

const GRAPH = "https://graph.facebook.com/v25.0";
const BRAND: Record<string, string> = {
  goocampus: "edu",
  goocampusworld: "world",
  "12thplusdotcom": "12th",
  samvaya_matrimony: "samvaya",
};

type PlatStat = { followers: number; reach: number | null; engRate: number | null; live: boolean };

async function fbGet(pathAndQuery: string, token: string) {
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const res = await fetchWithTimeout(`${graphFor(token)}/${pathAndQuery}${sep}access_token=${encodeURIComponent(token)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("fb " + res.status);
  return res.json();
}

async function fbSnapshot(pageId: string, token: string): Promise<PlatStat> {
  const basic = await fbGet(`${pageId}?fields=followers_count,fan_count`, token);
  const followers = basic.followers_count ?? basic.fan_count ?? 0;
  let reach: number | null = null;
  let engRate: number | null = null;
  try {
    const ins = await fbGet(`${pageId}/insights?metric=page_impressions_unique,page_post_engagements&period=days_28`, token);
    const arr: { name: string; values: { value: number }[] }[] = ins.data || [];
    const last = (n: string) => {
      const v = arr.find((x) => x.name === n)?.values;
      return v && v.length ? v[v.length - 1].value : null;
    };
    reach = last("page_impressions_unique");
    const engAbs = last("page_post_engagements");
    if (engAbs != null && followers > 0) engRate = (engAbs / followers) * 100;
  } catch {
    /* page insights need read_insights; followers still real */
  }
  return { followers, reach, engRate, live: true };
}

async function igSnapshot(a: ReturnType<typeof getConfiguredAccounts>[number], from: string, to: string): Promise<PlatStat> {
  const [basic, insights, media] = await Promise.all([
    fetchBasic(a),
    fetchAccountInsights(a, from, to).catch(() => []),
    fetchRecentMedia(a, 12).catch(() => []),
  ]);
  const reachMetric = insights.find((m) => m.name === "reach");
  const reach = reachMetric ? reachMetric.values.reduce((s, v) => s + (v.value || 0), 0) : 0;
  const followers = basic.followers_count || 0;
  let engRate: number | null = null;
  if (media.length && followers > 0) {
    const totalEng = media.reduce((s, m) => s + (m.like_count || 0) + (m.comments_count || 0), 0);
    engRate = (totalEng / media.length / followers) * 100;
  }
  return { followers, reach, engRate, live: true };
}

export async function GET() {
  const __denied = await requireSection("analytics");
  if (__denied) return __denied;

  const accts = getConfiguredAccounts();
  if (!accts.length) return NextResponse.json({ live: false, brands: {} });

  const to = format(new Date(), "yyyy-MM-dd");
  const from = format(subDays(new Date(), 29), "yyyy-MM-dd");

  const [rows, li] = await Promise.all([
    Promise.all(
      accts.map(async (a) => {
        const brand = BRAND[a.id] || a.id;
        const [ig, fb] = await Promise.all([
          igSnapshot(a, from, to).catch((): PlatStat => ({ followers: 0, reach: 0, engRate: null, live: false })),
          a.pageId && a.pageAccessToken ? fbSnapshot(a.pageId, a.pageAccessToken).catch(() => null) : Promise.resolve(null),
        ]);
        return { brand, ig, fb };
      }),
    ),
    linkedinBuildLive("gcworld", from, to)
      .then((l): PlatStat => ({ followers: l.summary.followers, reach: l.summary.impressions, engRate: l.summary.engagementRate, live: true }))
      .catch(() => null),
  ]);

  const brands: Record<string, { ig: PlatStat; fb: PlatStat | null; li?: PlatStat | null }> = {};
  for (const r of rows) brands[r.brand] = { ig: r.ig, fb: r.fb };
  if (brands.world) brands.world.li = li;

  // Aggregate "All brands" (IG + FB across accounts; LinkedIn = World, the only live one).
  const sum = (get: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + get(r), 0);
  const igEng = rows.map((r) => r.ig.engRate).filter((x): x is number => x != null);
  brands.all = {
    ig: {
      followers: sum((r) => r.ig.followers),
      reach: sum((r) => r.ig.reach || 0),
      engRate: igEng.length ? igEng.reduce((s, x) => s + x, 0) / igEng.length : null,
      live: rows.some((r) => r.ig.live),
    },
    fb: {
      followers: sum((r) => r.fb?.followers || 0),
      reach: rows.some((r) => r.fb?.reach != null) ? sum((r) => r.fb?.reach || 0) : null,
      engRate: null,
      live: rows.some((r) => r.fb?.live),
    },
    li,
  };

  return NextResponse.json({ live: true, brands });
}
