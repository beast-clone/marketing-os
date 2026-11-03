import { NextResponse } from "next/server";
import { pageInfo } from "@/lib/publish-pages";
import { headers } from "next/headers";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { getSessionUserId, getSessionIsAdmin } from "@/lib/auth";
import { rosterById } from "@/lib/team-db";
import { CAPABILITIES, hasCapability, canAccessSection, canSeeTab, apiTabFor, maySchedulePage, type Capability, type Section } from "@/lib/permissions";
import { getSupabase } from "@/lib/supabase";
import { warmBrandAccounts } from "@/lib/brand-accounts";

// Per-user (falls back to IP) rate-limit guard for expensive routes — the ones
// that call paid third parties (OpenAI/Perplexity, HikerAPI, Airtable). Returns a
// 429 NextResponse when the caller is over the limit, else null.
//
// NOTE: the underlying limiter is in-memory + per-instance (see lib/rate-limit.ts),
// so on serverless this raises the bar against credit-drain abuse but is not a
// hard global cap. Swap for Upstash Redis if a strict cap is needed.
export function guardRate(req: Request, name: string, max: number, windowMs: number): NextResponse | null {
  const who = getSessionUserId() || getClientIp(req.headers);
  const rl = rateLimit(`${name}:${who}`, max, windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests — please slow down and try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec || 60) } },
    );
  }
  return null;
}

// ---------- Authorization guards ----------
//
// Authentication is enforced in middleware.ts (every /api/* needs a valid signed
// session). AUTHORIZATION was not — capability/section checks lived only in the UI
// (team/page.tsx), so any logged-in user could bypass them by calling the API
// directly. These close that gap, mirroring `requireAdmin` in
// app/api/admin/team/route.ts. Each returns `null` when allowed, or a 403
// NextResponse to return immediately when not:
//
//   const denied = await requireCapability("delete_tasks");
//   if (denied) return denied;
// Scheduler brand pages (Team & access → Scheduler, 22 Oct). `pages` are the
// PublishToPage values a request wants to post to; a post id checks the row's own.
const PAGE_LABEL = (p: string) => pageInfo(p).label || p;
export async function requireSchedulerPages(pages: string[]): Promise<NextResponse | null> {
  const me = await rosterById(getSessionUserId());
  const bad = pages.filter((p) => !maySchedulePage(me, p));
  if (!bad.length) return null;
  return NextResponse.json({ error: `You can't schedule to ${bad.map(PAGE_LABEL).join(", ")} — ask an admin to add it in Team & access.` }, { status: 403 });
}
export async function requireSchedulerPost(postId: string): Promise<NextResponse | null> {
  const sb = getSupabase();
  if (!sb || !postId) return null;
  const { data } = await sb.from("mh_posts").select("publish_to_pages").eq("id", postId).maybeSingle();
  const pages = Array.isArray(data?.publish_to_pages) ? (data!.publish_to_pages as string[]) : [];
  return pages.length ? requireSchedulerPages(pages) : null;
}

export async function requireCapability(cap: Capability): Promise<NextResponse | null> {
  const me = await rosterById(getSessionUserId());
  // "Can sign in" off counts at once, not at their next login (A9).
  if (me && !me.active) return NextResponse.json({ error: "This account is switched off." }, { status: 401 });
  if (!hasCapability(me, cap)) {
    const label = CAPABILITIES.find((c) => c.key === cap)?.label;
    return NextResponse.json({ error: label ? `Your access doesn't include "${label}" — ask an admin to switch it on in Team & access.` : "You don't have permission to do that." }, { status: 403 });
  }
  return null;
}

export async function requireSection(sec: Section): Promise<NextResponse | null> {
  const me = await rosterById(getSessionUserId());
  if (me && !me.active) return NextResponse.json({ error: "This account is switched off." }, { status: 401 });
  if (!canAccessSection(me, sec)) {
    return NextResponse.json({ error: "You don't have access to this section." }, { status: 403 });
  }
  // A page switched off on Team & access also closes the data behind it, not just
  // the sidebar link (A7). The middleware stamps the API path on every request.
  const tab = apiTabFor(headers().get("x-gc-path"));
  if (tab && !canSeeTab(me, tab.key)) {
    return NextResponse.json({ error: `Your access doesn't include ${tab.label} — ask an admin to switch it on in Team & access.` }, { status: 403 });
  }
  // Brands connected on the Brands page keep their Instagram/Facebook keys in the database;
  // load them (cached a minute) so getConfiguredAccounts() in the route includes them.
  await warmBrandAccounts();
  return null;
}

/** Whose personal data (notepad, notifications, …) a request may read: the person
 *  asked for when the caller is an admin, otherwise always the caller — the same
 *  rule My Day's chat and report already used (security audit, 3 Nov 2026). */
export function ownPerson(asked: string | null | undefined): string {
  const me = (getSessionUserId() || "").toLowerCase();
  const want = (asked || "").toLowerCase().trim();
  return getSessionIsAdmin() && want ? want : me;
}
