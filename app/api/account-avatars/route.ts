import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getConfiguredAccounts, fetchBasic } from "@/lib/instagram";
import { getSupabase } from "@/lib/supabase";
import { readRegistry, warmBrandAccounts } from "@/lib/brand-accounts";

export const dynamic = "force-dynamic";

// Real Instagram profile pictures for the brand/account picker.
// IG Graph `profile_picture_url` values are short-lived CDN URLs, so we fetch
// the bytes once and store them as base64 data URIs — those never expire and
// render instantly, so the picker logos don't break mid-session. Cached in
// discover_cache for a day so we don't re-hit the Graph API on every page load.

const CACHE_KEY = "account_avatars_v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

type Avatars = Record<string, string>; // accountId -> data URI

// Logos uploaded on the Brands page (docs/BRANDS_SPEC.md) win over the Instagram picture —
// they're also the only logo a brand without a connected Instagram can have.
async function uploadedLogos(db: ReturnType<typeof getSupabase>): Promise<Avatars> {
  if (!db) return {};
  try {
    const { data } = await db.from("discover_cache").select("payload").eq("cache_key", "brands:logos").maybeSingle();
    return (data?.payload as Avatars) || {};
  } catch { return {}; }
}

// Brands added on the Brands page that have Instagram + Facebook connected — the pickers list
// them after the built-in brands. An added brand with nothing connected stays off the picker:
// every tab would be empty for it.
async function addedBrands() {
  // A brand connected with "Connect Instagram only" has no Facebook page (5 Nov).
  // The linked-brand list lives in memory; load it first, or a fresh server sees none.
  await warmBrandAccounts();
  const live = new Map(getConfiguredAccounts().map((a) => [a.id, a]));
  return (await readRegistry()).added.filter((b) => live.has(b.id))
    .map((b) => ({ ...b, handle: live.get(b.id)?.handle || b.handle, platforms: live.get(b.id)?.pageId ? ["instagram", "facebook"] : ["instagram"] }));
}

async function toDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 512 * 1024) return null; // sanity cap ~512KB
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET() {
  const __denied = await requireSection("system");
  if (__denied) return __denied;

  const db = getSupabase();

  // 1) Serve from cache when fresh.
  if (db) {
    try {
      const { data } = await db
        .from("discover_cache")
        .select("payload,last_fetched")
        .eq("cache_key", CACHE_KEY)
        .maybeSingle();
      const age = data?.last_fetched ? Date.now() - new Date(data.last_fetched).getTime() : Infinity;
      if (data?.payload && age < CACHE_TTL_MS) {
        return NextResponse.json({ avatars: { ...(data.payload as Avatars), ...(await uploadedLogos(db)) }, brands: await addedBrands(), cached: true });
      }
    } catch {
      /* fall through to a live fetch */
    }
  }

  // 2) Fetch each configured account's profile picture and inline it.
  const accounts = getConfiguredAccounts();
  const avatars: Avatars = {};
  await Promise.all(
    accounts.map(async (acc) => {
      try {
        const basic = await fetchBasic(acc);
        if (!basic?.profile_picture_url) return;
        const uri = await toDataUri(basic.profile_picture_url);
        if (uri) avatars[acc.id] = uri;
      } catch {
        /* skip this account — the picker falls back to the generic icon */
      }
    }),
  );

  // 3) Cache (only if we got at least one, so a transient failure doesn't poison the cache).
  if (db && Object.keys(avatars).length) {
    try {
      await db.from("discover_cache").upsert(
        { cache_key: CACHE_KEY, source: "account_avatars", last_fetched: new Date().toISOString(), payload: avatars },
        { onConflict: "cache_key" },
      );
    } catch {
      /* non-fatal */
    }
  }

  return NextResponse.json({ avatars: { ...avatars, ...(await uploadedLogos(db)) }, brands: await addedBrands(), cached: false });
}
