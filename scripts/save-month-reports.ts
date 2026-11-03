// Save a full-month copy of the monthly report for months that have ended, so they
// open from the copy instead of being re-counted (Praveen, 3 Nov 2026). The daily
// cron does this for each new month; this fills the months before it started.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/save-month-reports.ts 2026-06 2026-10
//
// Subscribers / LinkedIn followers are "today's" count. If an older copy read them
// closer to the month's end than today does, that older reading is kept.
import { buildReportSnapshot, saveReportSnapshot, snapshotKey } from "@/lib/report-month";
import { getSupabase } from "@/lib/supabase";

const [first, last] = process.argv.slice(2);
if (!/^\d{4}-\d{2}$/.test(first || "") || !/^\d{4}-\d{2}$/.test(last || "")) throw new Error("usage: save-month-reports.ts YYYY-MM YYYY-MM");
const DAY = 86_400_000;
async function main() {
const sb = getSupabase()!;
for (let m = first; m <= last; m = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1)).toISOString().slice(0, 7)) {
  const end = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
  if (end >= new Date().toISOString().slice(0, 10)) { console.log(m, "hasn't ended — skipped"); continue; }
  const { data: old } = await sb.from("discover_cache").select("payload").eq("cache_key", snapshotKey(m)).maybeSingle();
  const p = await buildReportSnapshot(m, end);
  const prev = old?.payload as { window?: { to?: string }; youtube?: { subscribers?: number }; linkedin?: { followers?: number } } | undefined;
  const gap = (d: string) => Math.abs(Date.parse(d) - Date.parse(end)) / DAY;
  if (prev?.window?.to && gap(prev.window.to) < gap(p.pointInTime.asOf)) {
    p.pointInTime = { asOf: prev.window.to, youtubeSubs: prev.youtube?.subscribers ?? null, linkedinFollowers: prev.linkedin?.followers ?? null };
  }
  await saveReportSnapshot(m, p);
  console.log(m, "saved ·", p.leadStatus?.total, "leads ·", p.instagram && "post" in p.instagram ? `${p.instagram.post} posts` : "no IG", "· subscribers/followers as of", p.pointInTime.asOf);
}
}
main().catch((e) => { console.error(e); process.exit(1); });
