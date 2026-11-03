// Which Instagram/Facebook page a task goes out on, from its primary interest (SBU).
// One list, used by the Scheduler's default page and the content calendar's channels.
//
// Agreed with Praveen on 22 Sep: mentorship → GooCampus World; 12thPlus.com and NEET UG
// → GooCampus India (12th Plus is UG only — NEET PG goes to Main); Samvaya has its own
// channel, so none of ours; everything else → GooCampus Main.
// 26 Oct: 10K Mentorship is GooCampus (Main), not World — Praveen.
// 27 Oct: the page now lives with the brand (mh_sbus.page, sql/040) and is changed on
// Rules → Content calendar → Brands. The lists below are only the fallback until the
// live list has loaded (server: fetchSbus; browser: /api/sbus).
// 3 Nov: a brand can also post to a brand linked on the Brands page (lib/publish-pages.ts),
// so a page is any page value; these are the built-in ones.
export type SbuPage = string;
export const SBU_PAGE_CHOICES = ["GooCampus Main", "GooCampus World", "12Plus / GC India", "none"] as const;
export type SbuPageChoice = string;

// Filled from the database (no imports here: shared by server and browser).
const LIVE: Record<string, SbuPageChoice> = {};
export function setSbuPages(rows: { name: string; page?: string | null }[]) {
  for (const r of rows) {
    const p = typeof r.page === "string" && r.page.trim() ? r.page.trim() : null;
    if (p) LIVE[r.name.trim().toLowerCase()] = p;
  }
}

const WORLD = ["Mentorship Platform"];
const INDIA = ["12thPlus.com", "India NEET UG Consulting"];
const NONE: string[] = [];

const is = (list: string[], sbu: string) => list.some((s) => s.toLowerCase() === sbu);

/** null = the SBU isn't posted on any of our pages (Samvaya). */
export function pageForSbu(sbu: string | null | undefined): SbuPage | null {
  const s = (sbu || "").trim().toLowerCase();
  const live = LIVE[s];
  if (live) return live === "none" ? null : live;
  if (is(NONE, s)) return null;
  if (is(WORLD, s)) return "GooCampus World";
  if (is(INDIA, s)) return "12Plus / GC India";
  return "GooCampus Main";
}
