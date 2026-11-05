// Brands — the database side (docs/BRANDS_SPEC.md, stage 2).
//
//   · Instagram + Facebook keys connected on the Brands page live in mh_integration_tokens as
//     `meta:page:<brandId>` (token = the page key, note = JSON of the page / Instagram ids).
//     warmBrandAccounts() loads them into lib/instagram.ts so getConfiguredAccounts() — which
//     ~30 routes call synchronously — includes them. requireSection runs it, so every guarded
//     route sees connected brands; the snapshot crons call it themselves.
//   · Brands added on the page live in discover_cache `brands:registry`.
import { getSupabase } from "@/lib/supabase";
import { setDbAccounts, type IGAccountConfig } from "@/lib/instagram";

export const META_PAGE_PREFIX = "meta:page:";
export type PageNote = { igUserId: string; igUsername: string; pageId: string; pageName: string };

let loadedAt = 0;
const TTL = 60_000;

/** Load database-connected Instagram/Facebook brands (cached a minute). Never throws. */
export async function warmBrandAccounts(force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < TTL) return;
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { data } = await sb.from("mh_integration_tokens").select("provider, token, note").like("provider", `${META_PAGE_PREFIX}%`);
    const list: IGAccountConfig[] = [];
    for (const r of data || []) {
      try {
        const n = JSON.parse((r.note as string) || "{}") as Partial<PageNote>;
        if (!r.token || !n.igUserId || !n.igUsername) continue;
        list.push({ id: String(r.provider).slice(META_PAGE_PREFIX.length), label: n.pageName || n.igUsername, handle: `@${n.igUsername}`, igUserId: n.igUserId, pageAccessToken: r.token as string, pageId: n.pageId });
      } catch { /* a bad row is skipped, never fatal */ }
    }
    setDbAccounts(list);
    loadedAt = Date.now();
  } catch { /* database unreachable — keep the last list */ }
}

/** Connecting or disconnecting a brand drops the day-cached profile pictures
 *  (/api/account-avatars), so the brand's Instagram picture shows on the next page
 *  load instead of up to a day later (5 Nov). Never throws. */
export async function forgetAvatars(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try { await sb.from("discover_cache").delete().eq("cache_key", "account_avatars_v1"); } catch { /* next day's refresh still comes */ }
}

// ── the brand list ───────────────────────────────────────────────────────────
export type AddedBrand = { id: string; label: string; handle: string };
export type Registry = { added: AddedBrand[]; hidden: string[] };
const REG_KEY = "brands:registry";

export async function readRegistry(): Promise<Registry> {
  const sb = getSupabase();
  if (!sb) return { added: [], hidden: [] };
  try {
    const { data } = await sb.from("discover_cache").select("payload").eq("cache_key", REG_KEY).maybeSingle();
    const p = (data?.payload as Partial<Registry>) || {};
    return { added: p.added || [], hidden: p.hidden || [] };
  } catch { return { added: [], hidden: [] }; }
}

export async function writeRegistry(reg: Registry): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("no db");
  await sb.from("discover_cache").upsert(
    { cache_key: REG_KEY, source: "brand_registry", last_fetched: new Date().toISOString(), payload: reg },
    { onConflict: "cache_key" },
  );
}

/** A brand id from its name: lowercase, letters/digits/underscores. */
export const brandIdOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
