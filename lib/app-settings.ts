// Numbers the dashboard runs on that an admin can change on the Rules page (27 Oct):
// posting limits per page, the default time per content type, and when the due-today
// reminder starts. Stored in mh_settings (sql/042); these are the built-in defaults,
// used until the saved ones have loaded and whenever one isn't set.
//
// No imports: read by browser screens (lib/use-app-settings.ts loads them) and the
// settings API alike.

export type PostingLimit = { min: number; max: number; gap: number };
export const PAGES = ["GooCampus Main", "GooCampus World", "12Plus / GC India"] as const;

export const SETTINGS = {
  posting: {
    "GooCampus Main": { min: 2, max: 4, gap: 60 },
    "GooCampus World": { min: 1, max: 2, gap: 90 },
    "12Plus / GC India": { min: 1, max: 2, gap: 90 },
  } as Record<string, PostingLimit>,
  /** Minutes per content type, only for types someone has set; the rest use the rule below. */
  taskMinutes: {} as Record<string, number>,
  remindHours: 3,
};
const DEFAULT_POSTING = JSON.parse(JSON.stringify(SETTINGS.posting)) as Record<string, PostingLimit>;

const int = (v: unknown, lo: number, hi: number): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

/** Clean a value for one key, or null if it isn't valid. */
export function cleanSetting(key: string, value: unknown): unknown {
  if (key === "posting") {
    if (!value || typeof value !== "object") return null;
    const out: Record<string, PostingLimit> = {};
    for (const p of PAGES) {
      const v = (value as Record<string, Partial<PostingLimit>>)[p];
      if (!v) continue;
      const min = int(v.min, 0, 20), max = int(v.max, 1, 20), gap = int(v.gap, 0, 720);
      if (min === null || max === null || gap === null || min > max) return null;
      out[p] = { min, max, gap };
    }
    return out;
  }
  if (key === "taskMinutes") {
    if (!value || typeof value !== "object") return null;
    const out: Record<string, number> = {};
    for (const [t, m] of Object.entries(value as Record<string, unknown>)) {
      const n = int(m, 5, 600);
      if (n === null) return null;
      out[String(t).slice(0, 80)] = n;
    }
    return out;
  }
  if (key === "remindHours") return int(value, 1, 8);
  // GEO SEO monthly spend cap in US dollars (lib/geo.ts reads it server-side).
  if (key === "geoMonthlyUsd") return int(value, 1, 500);
  // Who gets the date-change approval emails (Approvals page, 4 Nov 2026). Any
  // address — teammates or outsiders; lib/date-approvals reads it server-side.
  if (key === "approvalEmails") {
    if (!Array.isArray(value)) return null;
    const out = [...new Set(value.map((e) => String(e || "").trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))].slice(0, 20);
    return out.length === value.length ? out : null;
  }
  return null;
}

/** Put saved values in place (keeps the object, so every importer sees them). */
export function applySettings(rows: Record<string, unknown>) {
  const posting = cleanSetting("posting", rows.posting) as Record<string, PostingLimit> | null;
  for (const p of PAGES) SETTINGS.posting[p] = posting?.[p] || DEFAULT_POSTING[p];
  const tm = cleanSetting("taskMinutes", rows.taskMinutes) as Record<string, number> | null;
  for (const k of Object.keys(SETTINGS.taskMinutes)) delete SETTINGS.taskMinutes[k];
  if (tm) Object.assign(SETTINGS.taskMinutes, tm);
  SETTINGS.remindHours = (cleanSetting("remindHours", rows.remindHours) as number | null) ?? 3;
}
