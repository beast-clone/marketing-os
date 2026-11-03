import seed from "./data/report-history-seed.json";

// One-time history imported from the team's Notion monthly report (May 2026).
// Each table = the column headers + one row per month (values kept as display
// strings, exactly as the Notion report showed them, e.g. "5.3 L", "40.1K").
// Going forward the report appends each new month from live data.
// See docs/MONTHLY_REPORT_SPEC.md.
export type HistoryTable = { heading: string; header: string[]; rows: string[][] };
export type ReportHistory = {
  organicLeads: HistoryTable;
  instagram: HistoryTable;
  engagement: HistoryTable;
  youtube: HistoryTable;
  facebook: HistoryTable;
  linkedin: HistoryTable;
};

export const REPORT_HISTORY = seed as ReportHistory;

// The imported rows don't carry a reliable year ("October" appears twice), but every
// table is consecutive months ending May 2026 — so a row's month is its distance
// from the end. Engagement is the same, laid out as columns instead of rows.
export const HISTORY_LAST = "2026-05";
const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const back = (m: string) => monthIndex(HISTORY_LAST) - monthIndex(m);

/** The imported row for `month` (YYYY-MM), without its label cell — or null. */
export function historyRow(t: HistoryTable, month: string): string[] | null {
  const i = t.rows.length - 1 - back(month);
  return back(month) >= 0 && i >= 0 ? t.rows[i].slice(1) : null;
}

/** Likes / comments / saves / shares for `month` from the imported engagement table. */
export function historyEngagement(month: string): Record<string, string> | null {
  const t = REPORT_HISTORY.engagement;
  const col = t.header.length - 1 - back(month);
  if (back(month) < 0 || col < 1) return null;
  return Object.fromEntries(t.rows.map((r) => [r[0], r[col]]));
}

/** The earliest month any imported table reaches back to. */
export const HISTORY_FIRST = (() => {
  const longest = Math.max(...Object.values(REPORT_HISTORY).filter((t) => t !== REPORT_HISTORY.engagement).map((t) => t.rows.length));
  const i = monthIndex(HISTORY_LAST) - (longest - 1);
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
})();
