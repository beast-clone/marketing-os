import { getSupabase } from "@/lib/supabase";

// The monthly report's hand-written sections (Achievements, Focused SBUs, etc.),
// saved per month so they persist and re-open. Stored in discover_cache (no
// migration): one row per month, key `report-manual:<YYYY-MM>`, source below.
const SOURCE = "report_manual";
const keyFor = (month: string) => `report-manual:${month}`;

// A section someone added to the month's report — a title and free text. Text pasted
// from a table (tab-separated, e.g. the Airtable Backup's "Copy table") shows as a table.
export type ManualSection = { id: string; title: string; body: string };

export type ManualFields = {
  sections: ManualSection[];
  achievements: string;
  focusedSbus: string;
  amcEbook: string;
  newsletter: string;
  futureProspects: string;
  actionNotes: string;
};
export const MANUAL_KEYS: Exclude<keyof ManualFields, "sections">[] = [
  "achievements", "focusedSbus", "amcEbook", "newsletter", "futureProspects", "actionNotes",
];
const EMPTY: ManualFields = { sections: [], achievements: "", focusedSbus: "", amcEbook: "", newsletter: "", futureProspects: "", actionNotes: "" };

export async function getManual(month: string): Promise<ManualFields> {
  const sb = getSupabase();
  if (!sb) return { ...EMPTY };
  const { data } = await sb.from("discover_cache").select("payload").eq("cache_key", keyFor(month)).maybeSingle();
  return { ...EMPTY, ...((data?.payload as Partial<ManualFields>) || {}) };
}

export async function setManual(month: string, patch: Partial<ManualFields>): Promise<ManualFields> {
  const sb = getSupabase();
  if (!sb) throw new Error("database unavailable");
  const current = await getManual(month);
  const merged: ManualFields = { ...current };
  for (const k of MANUAL_KEYS) if (typeof patch[k] === "string") merged[k] = patch[k] as string;
  if (Array.isArray(patch.sections)) merged.sections = cleanSections(patch.sections);
  await sb.from("discover_cache").upsert(
    { cache_key: keyFor(month), source: SOURCE, last_fetched: new Date().toISOString(), payload: merged },
    { onConflict: "cache_key" },
  );
  return merged;
}

export function cleanSections(raw: unknown[]): ManualSection[] {
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({ id: String(x.id || "").slice(0, 40), title: String(x.title ?? "").slice(0, 120), body: String(x.body ?? "").slice(0, 20_000) }))
    .filter((x) => x.id)
    .slice(0, 20);
}
