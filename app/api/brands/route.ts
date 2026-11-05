import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getSessionIsAdmin } from "@/lib/auth";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { ACCOUNTS } from "@/lib/accounts";
import { LI_PAGE, YT_CHANNEL } from "@/lib/brand-platforms";
import { getAccount } from "@/lib/instagram";
import { CHANNELS } from "@/lib/youtube-channels";
import { hasChannelGrant } from "@/lib/youtube";
import { readRegistry, writeRegistry, brandIdOf, META_PAGE_PREFIX, warmBrandAccounts, forgetAvatars } from "@/lib/brand-accounts";

// Brands page (docs/BRANDS_SPEC.md, stage 1): every brand, its logo, and whether each of its
// four accounts is really connected — read from the same places the data tabs read, so the page
// can't say "connected" while a tab shows nothing. POST saves an uploaded logo, or adds a brand
// (stage 2); DELETE removes an added brand.
export const dynamic = "force-dynamic";

const LOGOS_KEY = "brands:logos";            // { brandId: data URI } — uploaded logos
const AVATARS_KEY = "account_avatars_v1";    // Instagram profile pictures (/api/account-avatars)
const LI_NAME: Record<string, string> = { goocampus: "GooCampus", gcworld: "GooCampus World" };
const MAX_LOGO = 300 * 1024;

type SB = NonNullable<ReturnType<typeof getSupabase>>;
async function readCache(sb: SB | null, key: string): Promise<Record<string, string>> {
  if (!sb) return {};
  const { data } = await sb.from("discover_cache").select("payload").eq("cache_key", key).maybeSingle();
  return (data?.payload as Record<string, string>) || {};
}

export async function GET() {
  const denied = await requireSection("system");
  if (denied) return denied;
  try {
    const sb = getSupabase();
    const [uploaded, avatars] = await Promise.all([readCache(sb, LOGOS_KEY), readCache(sb, AVATARS_KEY)]);
    const added = (await readRegistry()).added;
    // Brands whose Instagram + Facebook were connected on this page (these can be disconnected here).
    const onPage = new Set(((sb ? (await sb.from("mh_integration_tokens").select("provider").like("provider", `${META_PAGE_PREFIX}%`)).data : null) || [])
      .map((r) => String(r.provider).slice(META_PAGE_PREFIX.length)));
    const all = [...ACCOUNTS.map((a) => ({ ...a, added: false })), ...added.map((a) => ({ ...a, added: true }))];
    const brands = await Promise.all(all.map(async (a) => {
      const meta = getAccount(a.id);                       // null = no Instagram/Facebook key configured
      const li = LI_PAGE[a.id] ?? null;
      const liOn = !!li && !!process.env[`LINKEDIN_ORG_URN_${li.toUpperCase()}`];
      const yt = YT_CHANNEL[a.id] ?? null;
      const ytOn = yt ? await hasChannelGrant(yt).catch(() => false) : false;
      return {
        id: a.id, name: a.label, handle: a.handle, added: a.added, metaOnPage: onPage.has(a.id),
        logo: uploaded[a.id] || avatars[a.id] || null,
        logoUploaded: !!uploaded[a.id],
        accounts: {
          instagram: { connected: !!meta, name: meta ? meta.handle : null },
          facebook: { connected: !!meta?.pageId, name: meta?.pageId ? meta.label : null },
          linkedin: { connected: liOn, name: liOn ? LI_NAME[li!] || li : null, page: li },
          youtube: { connected: ytOn, name: yt ? CHANNELS[yt]?.name || yt : null, channel: yt },
        },
      };
    }));
    return NextResponse.json({ brands });
  } catch (err) {
    return NextResponse.json(safeError(err, "Could not load brands"), { status: 502 });
  }
}

/** Body: { name, handle? } adds a brand; { id, logo } saves a logo — a PNG/JPEG/WebP data URI
 *  (≤300 KB), or null to remove it. Admin only. */
export async function POST(req: Request) {
  const denied = await requireSection("system");
  if (denied) return denied;
  if (!getSessionIsAdmin()) return NextResponse.json({ error: "Only an admin can change brands." }, { status: 403 });
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "no db" }, { status: 500 });
  try {
    const b = (await req.json()) as { id?: string; logo?: string | null; name?: string; handle?: string };
    const reg = await readRegistry();
    if (b.name !== undefined) {
      const name = b.name.trim().slice(0, 60);
      const id = brandIdOf(name);
      if (!id) return NextResponse.json({ error: "Give the brand a name." }, { status: 400 });
      if (ACCOUNTS.some((a) => a.id === id || a.label.toLowerCase() === name.toLowerCase()) || reg.added.some((a) => a.id === id))
        return NextResponse.json({ error: `There's already a brand called ${name}.` }, { status: 400 });
      const h = (b.handle || "").trim().replace(/^@+/, "").slice(0, 40);
      reg.added.push({ id, label: name, handle: h ? `@${h}` : "" });
      await writeRegistry(reg);
      return NextResponse.json({ ok: true, id });
    }
    if (!ACCOUNTS.some((a) => a.id === b.id) && !reg.added.some((a) => a.id === b.id)) return NextResponse.json({ error: "No such brand." }, { status: 404 });
    if (b.logo != null && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.logo) || b.logo.length > MAX_LOGO))
      return NextResponse.json({ error: "Use a PNG, JPG or WebP image under 300 KB." }, { status: 400 });
    const logos = await readCache(sb, LOGOS_KEY);
    if (b.logo) logos[b.id!] = b.logo; else delete logos[b.id!];
    await sb.from("discover_cache").upsert(
      { cache_key: LOGOS_KEY, source: "brand_logos", last_fetched: new Date().toISOString(), payload: logos },
      { onConflict: "cache_key" },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(safeError(err, "Could not save the logo"), { status: 400 });
  }
}

/** Body: { id } — removes a brand added on this page. Its Instagram/Facebook must be disconnected first. Admin only. */
// What removing a brand takes with it (?impact=<id>), for the warning: posts still
// waiting to go out on its page, and Primary Interests that post to it by default.
async function impactOf(sb: NonNullable<ReturnType<typeof getSupabase>>, id: string) {
  const { data: tok } = await sb.from("mh_integration_tokens").select("note").eq("provider", `${META_PAGE_PREFIX}${id}`).maybeSingle();
  let page = "";
  try { page = String((JSON.parse(String(tok?.note || "{}")) as { pageName?: string }).pageName || ""); } catch { /* not connected */ }
  if (!page) return { connected: !!tok, page: null, scheduled: 0, interests: [] as string[] };
  const { count } = await sb.from("mh_posts").select("id", { count: "exact", head: true })
    .contains("publish_to_pages", [page]).in("publish_status", ["scheduled", "draft"]);
  const { data: sbus } = await sb.from("mh_sbus").select("name").eq("page", page);
  return { connected: true, page, scheduled: count || 0, interests: (sbus || []).map((r) => String(r.name)) };
}

/** Body: { id } removes a brand added on this page — with its Instagram/Facebook
 *  connection and its logo (5 Nov: one step, after a warning that says what goes).
 *  The four built-in brands can't be removed. Admin only. */
export async function DELETE(req: Request) {
  const denied = await requireSection("system");
  if (denied) return denied;
  if (!getSessionIsAdmin()) return NextResponse.json({ error: "Only an admin can change brands." }, { status: 403 });
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "no db" }, { status: 500 });
  try {
    const url = new URL(req.url);
    const { id, impact } = (await req.json().catch(() => ({}))) as { id?: string; impact?: boolean };
    const reg = await readRegistry();
    if (!id || !reg.added.some((a) => a.id === id)) return NextResponse.json({ error: "Only brands added on this page can be removed." }, { status: 400 });
    if (impact || url.searchParams.get("impact")) return NextResponse.json(await impactOf(sb, id));
    // Primary Interests that defaulted to its page go back to GooCampus Main (the
    // column's own default), so nothing points at a brand that is gone.
    const { page } = await impactOf(sb, id);
    if (page) await sb.from("mh_sbus").update({ page: "GooCampus Main" }).eq("page", page);
    await sb.from("mh_integration_tokens").delete().eq("provider", `${META_PAGE_PREFIX}${id}`);
    const { data: logos } = await sb.from("discover_cache").select("payload").eq("cache_key", "brands:logos").maybeSingle();
    if (logos?.payload && (logos.payload as Record<string, unknown>)[id]) {
      const next = { ...(logos.payload as Record<string, unknown>) }; delete next[id];
      await sb.from("discover_cache").update({ payload: next }).eq("cache_key", "brands:logos");
    }
    await writeRegistry({ ...reg, added: reg.added.filter((a) => a.id !== id) });
    await warmBrandAccounts(true);
    await forgetAvatars();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(safeError(err, "Could not remove the brand"), { status: 400 });
  }
}
