// The live brand (SBU) list, read from Supabase `mh_sbus` (sql/027) so a brand
// added in the dashboard shows up everywhere without a deploy. Server-only —
// browsers get it through /api/sbus (lib/use-sbus.ts).
//
// Falls back to SBU_OPTIONS in lib/sbus.ts if the table can't be read, so a
// database hiccup never empties a brand picker or rejects a valid task.

import { PUBLISH_PAGES } from "@/lib/publish-pages";
import { loadPublishPages } from "@/lib/publish-pages-server";
import { getSupabase } from "@/lib/supabase";
import { SBU_OPTIONS } from "@/lib/sbus";
import { setSbuPages, SBU_PAGE_CHOICES, type SbuPageChoice } from "@/lib/sbu-pages";

let cache: { at: number; names: string[]; pages: Record<string, string> } | null = null;
const CACHE_MS = 30_000;

/** Active brands, A→Z. */
export async function fetchSbus(fresh = false): Promise<string[]> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.names;
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("mh_sbus").select("name, page").eq("active", true);
    if (!error && data && data.length > 0) {
      const rows = data as { name: string; page: string | null }[];
      const names = rows.map((r) => r.name).sort((a, b) => a.localeCompare(b));
      setSbuPages(rows);   // which page each brand posts to (sql/040)
      cache = { at: Date.now(), names, pages: Object.fromEntries(rows.map((r) => [r.name, r.page || "GooCampus Main"])) };
      return names;
    }
  }
  return [...SBU_OPTIONS];
}

/** Brand → page, as stored (after fetchSbus). */
export async function fetchSbuPages(): Promise<Record<string, string>> {
  await fetchSbus();
  return cache?.pages || {};
}

// A built-in page, "none", or a brand linked on the Brands page (lib/publish-pages.ts).
const cleanPage = (p: unknown): SbuPageChoice => {
  const v = typeof p === "string" ? p.trim().slice(0, 80) : "";
  return (SBU_PAGE_CHOICES as readonly string[]).includes(v) || PUBLISH_PAGES.some((x) => x.value === v) ? v : "GooCampus Main";
};

/** Change which page a brand posts to. */
export async function setSbuPage(name: string, page: unknown): Promise<void> {
  await loadPublishPages();   // so cleanPage knows the linked brands
  const sb = getSupabase();
  if (!sb) throw new Error("no db");
  const { error } = await sb.from("mh_sbus").update({ page: cleanPage(page) }).eq("name", name);
  if (error) throw new Error(error.message);
  invalidateSbus();
}

export function invalidateSbus() {
  cache = null;
}

/** Add a brand. Returns the stored name; a case-insensitive match returns the existing one. */
export async function addSbu(raw: string, by: string | null, page?: unknown): Promise<string> {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Type the brand's name.");
  if (name.length > 80) throw new Error("That name is too long.");
  const existing = (await fetchSbus(true)).find((n) => n.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const sb = getSupabase();
  if (!sb) throw new Error("no db");
  // Upsert so a brand that was switched off comes back instead of failing.
  const { error } = await sb.from("mh_sbus").upsert({ name, active: true, created_by: by, page: cleanPage(page) }, { onConflict: "name" });
  if (error) throw new Error(error.message);
  invalidateSbus();
  return name;
}
