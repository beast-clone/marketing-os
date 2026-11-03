// "Just published" messages → the team's Telegram group (Praveen, 22 Oct).
// Posts go live from several places (the n8n IG/FB publisher, the LinkedIn cron,
// links pasted by hand), so instead of hooking each one this sweeps mh_posts every
// 15 minutes (with the watchers cron) and announces each newly live post once.
// A platform link that turns up later gets a short "now also on" follow-up.
//
// Setting: discover_cache `setting:publish-announce` = { on, since, chat } — a switch
// on the Watchers page. Only posts published after `since` are announced, so turning
// it on never floods the group with old posts. What was sent per post is kept under
// `pubann:<postId>`.
import { CORE_PAGES } from "@/lib/publish-pages";
import { getSupabase } from "@/lib/supabase";
import { hasTelegram, sendTelegram } from "@/lib/telegram";
import { rosterById } from "@/lib/team-db";

const KEY = "setting:publish-announce";
const IST = "Asia/Kolkata";
export type AnnounceSetting = { on: boolean; since: string | null; chat: string | null };
type Links = { instagram: string[]; facebook: string[]; linkedin: string[] };
const PLATFORM: Record<keyof Links, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn" };
const PAGE: Record<string, string> = Object.fromEntries(CORE_PAGES.map((p) => [p.value, p.label]));

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const split = (v: string | null) => (v || "").split(/\s*,\s*/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));

export async function getAnnounceSetting(): Promise<AnnounceSetting> {
  const sb = getSupabase();
  if (!sb) return { on: false, since: null, chat: null };
  const { data } = await sb.from("discover_cache").select("payload").eq("cache_key", KEY).maybeSingle();
  const p = (data?.payload || {}) as Partial<AnnounceSetting>;
  return { on: p.on === true, since: p.since || null, chat: p.chat || null };
}

export async function saveAnnounceSetting(patch: Partial<AnnounceSetting>): Promise<AnnounceSetting> {
  const sb = getSupabase();
  const cur = await getAnnounceSetting();
  const next: AnnounceSetting = { ...cur, ...patch };
  // Switching on starts the clock now — nothing published before is announced.
  if (patch.on && !cur.on) next.since = new Date().toISOString();
  await sb?.from("discover_cache").upsert({ cache_key: KEY, source: "publish-announce", last_fetched: new Date().toISOString(), payload: next }, { onConflict: "cache_key" });
  return next;
}

type Row = {
  id: string; particulars: string | null; type: string | null; owner_key: string | null; caption: string | null;
  publish_to_pages: string[] | null; published_at: string | null;
  instagram_url: string | null; facebook_url: string | null; linkedin_url: string | null;
};

function linksOf(r: Row): Links {
  return { instagram: split(r.instagram_url), facebook: split(r.facebook_url), linkedin: split(r.linkedin_url) };
}

async function fullMessage(r: Row, links: Links): Promise<string> {
  const owner = r.owner_key ? (await rosterById(r.owner_key))?.first || r.owner_key : null;
  const pages = (r.publish_to_pages || []).map((p) => PAGE[p] || p).join(", ");
  const when = r.published_at ? new Date(r.published_at).toLocaleString("en-GB", { timeZone: IST, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
  const cap = (r.caption || "").replace(/\s+/g, " ").trim();
  const lines = [
    `<b>Published: ${esc(r.particulars || "Untitled")}</b>`,
    [r.type, pages, owner ? `by ${owner}` : ""].filter(Boolean).map((s) => esc(String(s))).join(" · "),
    when ? `Live ${esc(when)} IST` : "",
  ].filter(Boolean);
  if (cap) lines.push("", `<i>${esc(cap.length > 220 ? cap.slice(0, 217) + "…" : cap)}</i>`);
  lines.push("");
  for (const k of Object.keys(PLATFORM) as (keyof Links)[]) for (const u of links[k]) lines.push(`${PLATFORM[k]}: ${esc(u)}`);
  const app = (process.env.APP_URL || process.env.URL || "").replace(/\/+$/, "");
  if (app) lines.push("", `<a href="${esc(`${app}/dashboard/preview/marketing-hub?tab=master&open=${r.id}`)}">Open in dashboard</a>`);
  return lines.join("\n");
}

/** Announce what went live since the last run. Returns how many messages went out. */
export async function runPublishAnnounce(opts: { onlyPostId?: string } = {}): Promise<{ sent: number; skipped?: string }> {
  const sb = getSupabase();
  const s = await getAnnounceSetting();
  if (!sb) return { sent: 0, skipped: "no database" };
  if (!s.on || !s.chat || !s.since) return { sent: 0, skipped: "switched off" };
  if (!(await hasTelegram())) return { sent: 0, skipped: "no bot" };

  let q = sb.from("mh_posts")
    .select("id, particulars, type, owner_key, caption, publish_to_pages, published_at, instagram_url, facebook_url, linkedin_url")
    .order("published_at", { ascending: true }).limit(50);
  // Never older than a day either: a sweep that didn't run for a while (or the first
  // run after a deploy) must not dump a backlog on the group.
  const floor = new Date(Math.max(new Date(s.since).getTime(), Date.now() - 24 * 3600_000)).toISOString();
  q = opts.onlyPostId ? q.eq("id", opts.onlyPostId) : q.gte("published_at", floor);
  const { data } = await q;
  const rows = ((data || []) as Row[]).filter((r) => { const l = linksOf(r); return l.instagram.length + l.facebook.length + l.linkedin.length > 0; });
  if (!rows.length) return { sent: 0 };

  const keys = rows.map((r) => `pubann:${r.id}`);
  const { data: done } = await sb.from("discover_cache").select("cache_key, payload").in("cache_key", keys);
  const sentBefore = new Map((done || []).map((d) => [d.cache_key as string, d.payload as Links]));

  let sent = 0;
  for (const r of rows) {
    const links = linksOf(r);
    const prev = sentBefore.get(`pubann:${r.id}`);
    let msg: string | null = null;
    if (!prev) msg = await fullMessage(r, links);
    else {
      const extra: string[] = [];
      for (const k of Object.keys(PLATFORM) as (keyof Links)[]) for (const u of links[k]) if (!(prev[k] || []).includes(u)) extra.push(`${PLATFORM[k]}: ${esc(u)}`);
      if (extra.length) msg = [`<b>Now also live: ${esc(r.particulars || "Untitled")}</b>`, ...extra].join("\n");
    }
    if (!msg) continue;
    try {
      await sendTelegram(s.chat, msg);
      sent++;
      await sb.from("discover_cache").upsert({ cache_key: `pubann:${r.id}`, source: "publish-announce", last_fetched: new Date().toISOString(), payload: links }, { onConflict: "cache_key" });
    } catch (e) { console.error("[publish-announce]", r.id, (e as Error).message); }
  }
  return { sent };
}
