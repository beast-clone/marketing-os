import { getSupabase } from "@/lib/supabase";
import { OWNER_ALIASES } from "@/lib/airtable-import";
import { REPORT_HISTORY as H, historyRow, HISTORY_FIRST } from "@/lib/report-history";
import { snapshotKey } from "@/lib/report-month";

// The yearly report (3 Nov 2026): what was made in a year, by primary interest, month,
// type and owner — plus leads and platform numbers month by month.
//   · content: the Airtable Backup (mh_archive) and the Master sheet (mh_posts) together;
//     a task in both counts once, as the Master sheet has it (that copy is newer)
//   · leads / platforms: each month's saved report copy; ≤ May 2026 from the Notion history
// Reads stored data only, so it opens quickly.

type Item = { sbu: string | null; type: string | null; status: string | null; owner: string | null; date: string | null };
const PUBLISHED = "Published/Scheduled";

const ownerKey = (name: string | null) => {
  if (!name) return null;
  const k = OWNER_ALIASES[name.toLowerCase()] || name.toLowerCase().split(" ")[0];
  return k.charAt(0).toUpperCase() + k.slice(1);
};

async function contentFor(year: string): Promise<Item[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const page = async <T,>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null }>) => {
    const out: T[] = [];
    for (let a = 0; ; a += 1000) { const { data } = await q(a, a + 999); out.push(...(data || [])); if (!data || data.length < 1000) break; }
    return out;
  };
  type Arc = { airtable_id: string; sbu: string | null; type: string | null; status: string | null; owner: string | null; publishing_date: string | null; created_at: string | null };
  type Post = { id: string; airtable_record_id: string | null; sbu: string | null; type: string | null; status: string | null; owner_key: string | null; publishing_date: string | null; created_at: string | null };
  const [arc, posts] = await Promise.all([
    page<Arc>((a, b) => sb.from("mh_archive").select("airtable_id, sbu, type, status, owner, publishing_date, created_at").range(a, b)),
    page<Post>((a, b) => sb.from("mh_posts").select("id, airtable_record_id, sbu, type, status, owner_key, publishing_date, created_at").range(a, b)),
  ]);
  const byKey = new Map<string, Item>();
  for (const r of arc) byKey.set(r.airtable_id, { sbu: r.sbu, type: r.type, status: r.status, owner: ownerKey(r.owner), date: r.publishing_date || r.created_at?.slice(0, 10) || null });
  for (const r of posts) byKey.set(r.airtable_record_id || r.id, { sbu: r.sbu, type: r.type, status: r.status, owner: ownerKey(r.owner_key), date: r.publishing_date || r.created_at?.slice(0, 10) || null });
  // Up to today: a task planned for later this year hasn't been made yet.
  const until = [to, new Date().toISOString().slice(0, 10)].sort()[0];
  return [...byKey.values()].filter((x) => x.date && x.date >= from && x.date <= until);
}

function tally(items: Item[], key: (x: Item) => string) {
  const m = new Map<string, { name: string; tasks: number; published: number; types: Record<string, number> }>();
  for (const x of items) {
    const k = key(x);
    const o = m.get(k) || { name: k, tasks: 0, published: 0, types: {} };
    o.tasks++; if (x.status === PUBLISHED) o.published++;
    if (x.type) o.types[x.type] = (o.types[x.type] || 0) + 1;
    m.set(k, o);
  }
  return [...m.values()].sort((a, b) => b.tasks - a.tasks);
}

type Num = number | string | null;
export type YearMonth = { month: string; source: "copy" | "partial" | "notion" | "none"; tasks: number; published: number; leads: Num; organic: Num; igFollowers: Num; igReach: Num; ytViews: Num; ytSubs: Num; liImpressions: Num; liFollowers: Num };

export async function buildYearReport(year: string) {
  const sb = getSupabase();
  const items = await contentFor(year);
  const now = new Date().toISOString().slice(0, 7);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).filter((m) => m <= now);

  const { data: snaps } = sb
    ? await sb.from("discover_cache").select("cache_key, payload").in("cache_key", months.map(snapshotKey))
    : { data: [] as { cache_key: string; payload: unknown }[] };
  const copyOf = new Map((snaps || []).map((r) => [r.cache_key, r.payload as Record<string, any>]));

  const perMonth: YearMonth[] = months.map((m) => {
    const inMonth = items.filter((x) => x.date!.startsWith(m));
    const base = { month: m, tasks: inMonth.length, published: inMonth.filter((x) => x.status === PUBLISHED).length };
    const p = copyOf.get(snapshotKey(m));
    if (p) {
      const end = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
      // Subscribers / followers count only if read within a week of the month's end
      // (the same rule as the monthly report); otherwise they'd be another month's.
      const pit = p.pointInTime ?? { asOf: p.window?.to, youtubeSubs: p.youtube?.subscribers ?? null, linkedinFollowers: p.linkedin?.followers ?? null };
      const fresh = pit.asOf && Math.abs(Date.parse(pit.asOf) - Date.parse(end)) / 86_400_000 <= 7;
      const partial = p.window?.to < end;
      return {
        ...base, source: partial ? "partial" : "copy",
        leads: p.leadStatus?.total ?? null, organic: p.organic?.rows?.find((r: { month: string }) => r.month === m)?.total ?? null,
        igFollowers: p.instagram?.followers ?? null, igReach: p.instagram?.reach ?? null,
        ytViews: p.youtube?.views ?? null, ytSubs: fresh || partial ? pit.youtubeSubs : null,
        liImpressions: p.linkedin?.impressions ?? null, liFollowers: fresh || partial ? pit.linkedinFollowers : null,
      };
    }
    const ig = historyRow(H.instagram, m), yt = historyRow(H.youtube, m), li = historyRow(H.linkedin, m), org = historyRow(H.organicLeads, m);
    if (ig || yt || li || org) {
      return { ...base, source: "notion", leads: null, organic: org?.[5] ?? null, igFollowers: ig?.[0] ?? null, igReach: ig?.[1] ?? null,
        ytViews: yt?.[1] ?? null, ytSubs: yt?.[0] ?? null, liImpressions: li?.[1] ?? null, liFollowers: li?.[0] ?? null };
    }
    return { ...base, source: "none", leads: null, organic: null, igFollowers: null, igReach: null, ytViews: null, ytSubs: null, liImpressions: null, liFollowers: null };
  });

  const firstYear = Number(HISTORY_FIRST.slice(0, 4));
  const years = Array.from({ length: Number(now.slice(0, 4)) - firstYear + 1 }, (_, i) => String(Number(now.slice(0, 4)) - i));
  const datesWithContent = items.map((x) => x.date!).sort();
  return {
    year, years,
    content: {
      total: items.length,
      published: items.filter((x) => x.status === PUBLISHED).length,
      from: datesWithContent[0] ?? null, to: datesWithContent[datesWithContent.length - 1] ?? null,
      bySbu: tally(items, (x) => x.sbu || "No Primary Interest"),
      byType: tally(items, (x) => x.type || "No type"),
      byOwner: tally(items, (x) => x.owner || "No owner"),
    },
    months: perMonth,
  };
}
