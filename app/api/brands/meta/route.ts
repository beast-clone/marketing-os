import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getSessionIsAdmin } from "@/lib/auth";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { getIntegrationToken, saveIntegrationToken } from "@/lib/integration-tokens";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { META_PAGE_PREFIX, warmBrandAccounts, readRegistry, forgetAvatars, type PageNote } from "@/lib/brand-accounts";
import { ACCOUNTS } from "@/lib/accounts";
import { getConfiguredAccounts } from "@/lib/instagram";

// Brands page → Connect Instagram + Facebook (docs/BRANDS_SPEC.md, stage 2).
//   GET  ?brand=…        the Facebook pages the dashboard's Meta login manages (no keys sent).
//   POST { brand, pageId }  saves that page's key for the brand — fetched here, never from the browser.
//   DELETE { brand }     disconnects a brand connected on this page.
// Admin only: it decides whose numbers every tab shows for the brand.
export const dynamic = "force-dynamic";

const GRAPH = "https://graph.facebook.com/v25.0";
type FbPage = { id: string; name: string; access_token?: string; instagram_business_account?: { id: string; username?: string } };

async function myPages(): Promise<FbPage[]> {
  const userToken = await getIntegrationToken("meta");
  if (!userToken) throw new Error("No Meta key is set up. Add one on Diagnostics → Reconnect.");
  const qs = new URLSearchParams({ fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100", access_token: userToken });
  const r = await fetchWithTimeout(`${GRAPH}/me/accounts?${qs}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = j?.error?.code;
    throw new Error(code === 190
      ? "The dashboard's Meta key has expired. Reconnect Meta on Diagnostics, then try again."
      : `Meta said: ${j?.error?.message || `HTTP ${r.status}`}`);
  }
  return (j.data as FbPage[]) || [];
}

async function knownBrand(id: string) {
  return ACCOUNTS.some((a) => a.id === id) || (await readRegistry()).added.some((a) => a.id === id);
}

async function guard() {
  const denied = await requireSection("system");
  if (denied) return denied;
  if (!getSessionIsAdmin()) return NextResponse.json({ error: "Only an admin can connect a brand's accounts." }, { status: 403 });
  return null;
}

export async function GET(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  try {
    const brand = new URL(req.url).searchParams.get("brand") || "";
    const pages = await myPages();
    // Which brand already uses each Instagram account, so a page can't be linked to two brands.
    const usedBy = new Map(getConfiguredAccounts().map((a) => [a.igUserId, a.id]));
    return NextResponse.json({
      pages: pages.map((p) => ({
        pageId: p.id, pageName: p.name,
        igUserId: p.instagram_business_account?.id || null,
        igUsername: p.instagram_business_account?.username || null,
        usedBy: (p.instagram_business_account && usedBy.get(p.instagram_business_account.id) !== brand && usedBy.get(p.instagram_business_account.id)) || null,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  try {
    const b = (await req.json()) as { brand?: string; pageId?: string };
    if (!b.brand || !(await knownBrand(b.brand))) return NextResponse.json({ error: "No such brand." }, { status: 404 });
    const page = (await myPages()).find((p) => p.id === b.pageId);
    if (!page?.access_token) return NextResponse.json({ error: "That page isn't one the Meta login manages." }, { status: 400 });
    const ig = page.instagram_business_account;
    if (!ig?.id || !ig.username) return NextResponse.json({ error: "That Facebook page has no Instagram business account linked to it. Link one in Meta Business settings first." }, { status: 400 });
    const other = getConfiguredAccounts().find((a) => a.igUserId === ig.id && a.id !== b.brand);
    if (other) return NextResponse.json({ error: `That Instagram account already belongs to ${other.label}.` }, { status: 400 });
    const note: PageNote = { igUserId: ig.id, igUsername: ig.username, pageId: page.id, pageName: page.name };
    await saveIntegrationToken(`${META_PAGE_PREFIX}${b.brand}`, page.access_token, { note: JSON.stringify(note) });
    await warmBrandAccounts(true);
    await forgetAvatars();
    // Make the picker's logo cache refetch, so the new brand's Instagram picture shows up.
    await getSupabase()?.from("discover_cache").update({ last_fetched: new Date(0).toISOString() }).eq("cache_key", "account_avatars_v1");
    return NextResponse.json({ ok: true, instagram: `@${ig.username}`, facebook: page.name });
  } catch (err) {
    return NextResponse.json(safeError(err, "Could not connect the page"), { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "no db" }, { status: 500 });
  try {
    const b = (await req.json()) as { brand?: string };
    const { data } = await sb.from("mh_integration_tokens").delete().eq("provider", `${META_PAGE_PREFIX}${b.brand}`).select("provider");
    if (!data?.length) return NextResponse.json({ error: "This brand's Instagram/Facebook comes from the dashboard settings, not this page — it can't be disconnected here." }, { status: 400 });
    await warmBrandAccounts(true);
    await forgetAvatars();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(safeError(err, "Could not disconnect"), { status: 400 });
  }
}
