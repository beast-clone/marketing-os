import { fetchWithTimeout } from "./fetch-with-timeout";
// Long-term history: snapshot one day's Meta data per account into Supabase so
// it survives Meta's 30-day daily-data cutoff.

import { getConfiguredAccounts, fetchBasic, fetchAccountInsights, type IGAccountConfig, graphFor } from "@/lib/instagram";
import { getSupabase } from "@/lib/supabase";

const GRAPH = "https://graph.facebook.com/v25.0";

export type AccountSnapshot = {
  accountId: string;
  date: string;            // YYYY-MM-DD (the day this row represents)
  followers: number;       // total follower count "as of" capture (reference)
  newFollowers: number;    // NEW followers on this day (follower_count metric) — for growth
  reach: number;
  profileVisits: number;
  websiteClicks: number;
  totalInteractions: number;
  capturedAt: string;
};

async function fetchDayMetric(acc: IGAccountConfig, metric: string, date: string): Promise<number> {
  const since = Math.floor(new Date(date + "T00:00:00Z").getTime() / 1000);
  const until = Math.floor(new Date(date + "T23:59:59Z").getTime() / 1000);
  const base = `${graphFor(acc.pageAccessToken)}/${acc.igUserId}/insights?metric=${metric}&period=day&since=${since}&until=${until}&access_token=${acc.pageAccessToken}`;

  // Meta splits these metrics across two shapes:
  //   reach, follower_count  → period=day, read data[0].values[0].value
  //   profile_views, website_clicks, total_interactions
  //                          → ALSO need metric_type=total_value, read total_value
  // Asking the wrong way returns a 400 with an error BODY rather than throwing, so
  // the old try/catch never saw it and quietly banked a 0. That is why every
  // snapshot written before 22 Sep 2026 has profileVisits / totalInteractions /
  // websiteClicks at zero. Ask the plain way, then retry with metric_type on
  // exactly that error. follower_count is incompatible with metric_type, and it
  // never triggers the retry because it answers the plain call fine.
  type MetricBody = {
    data?: { values?: { value: number }[]; total_value?: { value: number } }[];
    error?: { message?: string };
  };
  const read = async (url: string): Promise<{ value: number; needsTotalValue: boolean }> => {
    const r = await fetchWithTimeout(url, { cache: "no-store" });
    const j = (await r.json()) as MetricBody;
    if (j.error) {
      const msg = j.error.message || "";
      return { value: 0, needsTotalValue: /metric_type=total_value/.test(msg) };
    }
    const row = j.data?.[0];
    return { value: Number(row?.total_value?.value ?? row?.values?.[0]?.value ?? 0), needsTotalValue: false };
  };

  try {
    const first = await read(base);
    if (!first.needsTotalValue) return first.value;
    const second = await read(`${base}&metric_type=total_value`);
    return second.value;
  } catch {
    return 0;
  }
}

export async function snapshotAccountForDay(acc: IGAccountConfig, date: string): Promise<AccountSnapshot> {
  // Followers count is "now" — we record today's value for the snapshot date.
  const basic = await fetchBasic(acc).catch(() => ({ followers_count: 0 } as { followers_count: number }));

  // Daily metrics for the snapshot date. follower_count = NEW followers that day
  // (available for the last 30 days) — this is what lets us reconstruct monthly
  // follower growth after Meta drops the daily data.
  const [reach, profileVisits, websiteClicks, totalInteractions, newFollowers] = await Promise.all([
    fetchDayMetric(acc, "reach", date),
    fetchDayMetric(acc, "profile_views", date),
    fetchDayMetric(acc, "website_clicks", date),
    fetchDayMetric(acc, "total_interactions", date),
    fetchDayMetric(acc, "follower_count", date),
  ]);

  return {
    accountId: acc.id,
    date,
    followers: basic.followers_count || 0,
    newFollowers,
    reach,
    profileVisits,
    websiteClicks,
    totalInteractions,
    capturedAt: new Date().toISOString(),
  };
}

export async function writeSnapshot(snap: AccountSnapshot): Promise<{ ok: boolean; error?: string }> {
  const db = getSupabase();
  if (!db) return { ok: false, error: "Supabase not configured" };
  const cacheKey = `snapshot:${snap.accountId}:${snap.date}`;
  const { error } = await db.from("discover_cache").upsert(
    {
      cache_key: cacheKey,
      source: "account_snapshot",
      last_fetched: new Date().toISOString(),
      payload: snap,
    },
    { onConflict: "cache_key" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function readSnapshots(accountId: string, fromDate: string, toDate: string): Promise<AccountSnapshot[]> {
  const db = getSupabase();
  if (!db) return [];
  // Use a `like` pattern on cache_key to pull all snapshots for this account,
  // then filter date range in memory (handful of rows; cheap).
  const { data } = await db
    .from("discover_cache")
    .select("payload")
    .like("cache_key", `snapshot:${accountId}:%`)
    .eq("source", "account_snapshot");
  if (!data) return [];
  return data
    .map((row) => row.payload as AccountSnapshot)
    .filter((s) => s.date >= fromDate && s.date <= toDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Snapshot every configured account for a single day. Used for daily cron + backfill.
export async function snapshotAllAccountsForDay(date: string) {
  const accounts = getConfiguredAccounts();
  const results = await Promise.all(accounts.map(async (acc) => {
    try {
      const snap = await snapshotAccountForDay(acc, date);
      const w = await writeSnapshot(snap);
      return { accountId: acc.id, date, ok: w.ok, error: w.error, snap };
    } catch (e) {
      return { accountId: acc.id, date, ok: false, error: (e as Error).message };
    }
  }));
  return results;
}
