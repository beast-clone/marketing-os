// The competitor watcher (docs/COMPETITOR_RADAR_SPEC.md, step 2).
//
// Run every few minutes by /api/cron/competitor-watch. For each tracked competitor
// it reads their website's sitemap and events/webinar pages, their YouTube feed and
// (every ~15 min) their Instagram, and records anything it hasn't seen before as an
// event in mh_competitor_events — which the Briefing shows and which becomes a
// notification for the team.
//
// Two rules keep it honest:
//   · The first read of any source is a BASELINE: everything goes into
//     mh_competitor_seen and nothing is announced. Otherwise the first run would
//     call Academically's 1,315 existing blog posts "new".
//   · A read that comes back empty (site down, blocked, sitemap moved) changes
//     nothing. An empty read must never look like "everything is new next time".
//
// Politeness: one request per page per run, a timeout on every fetch, and paths the
// site's robots.txt disallows are not fetched.

import { getSupabase } from "@/lib/supabase";
import { getAccount, fetchCompetitor } from "@/lib/instagram";
import { safeFetch } from "@/lib/ssrf";

type SB = NonNullable<ReturnType<typeof getSupabase>>;
export type WatchEvent = { handle: string; name: string; kind: "blog" | "event" | "page" | "youtube" | "instagram"; title: string; url: string; publishedAt?: string | null; section?: string | null };
// `events` are new since the last run → stored AND notified. `listed` are events a
// site shows the first time we read its event pages → stored (so the Briefing shows
// what's on right now) but NOT notified: they weren't announced just now.
export type WatchResult = { competitors: number; checked: number; baselined: string[]; events: WatchEvent[]; listed: WatchEvent[]; errors: string[] };

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const EVENT_PATH = /(webinar|event|seminar|workshop|masterclass|conference|expo|live-session)/i;
const BLOG_PATH = /\/(blogs?|news-blogs?|news|articles?|news-articles|insights|resources)\//i;
const EVENT_WORDS = /\b(webinar|live session|go(ing)? live|seminar|workshop|masterclass|register|registration|events?|expo|fair|summit|conference|meet-?up|open house)\b/i;
const MAX_SUBSITEMAPS = 60;
const MAX_TITLES = 8;          // new pages whose <title> we fetch per competitor per run

async function get(url: string, ms = 12_000): Promise<string | null> {
  try {
    // URLs come from competitors' own sitemaps, so each hop is checked (lib/ssrf).
    const r = await safeFetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xml,text/xml;q=0.9,*/*;q=0.8" }, timeoutMs: ms, cache: "no-store" });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

// ── robots.txt ─────────────────────────────────────────────────────────────────
type Robots = { disallow: string[]; sitemaps: string[] };
async function robotsFor(origin: string): Promise<Robots> {
  const txt = await get(`${origin}/robots.txt`, 8_000);
  const out: Robots = { disallow: [], sitemaps: [] };
  if (!txt) return out;
  let applies = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") applies = val === "*";
    else if (key === "disallow" && applies && val) out.disallow.push(val);
    else if (key === "sitemap" && val) out.sitemaps.push(val);
  }
  return out;
}
const allowed = (r: Robots, url: string) => {
  try { const p = new URL(url).pathname; return !r.disallow.some((d) => p.startsWith(d)); } catch { return false; }
};

// ── sitemap ────────────────────────────────────────────────────────────────────
// Returns every page URL (with lastmod when given). Follows sitemap indexes. Some
// sites point their index at a host that no longer resolves (Hello Mentor's lists
// "temp.hellomentor.in"); those are retried on the site's own host.
async function sitemapUrls(origin: string, robots: Robots): Promise<Map<string, string | null>> {
  const pages = new Map<string, string | null>();
  const queue = robots.sitemaps.length ? [...robots.sitemaps] : [`${origin}/sitemap.xml`];
  const seen = new Set<string>();
  let subs = 0;
  while (queue.length && subs < MAX_SUBSITEMAPS) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm); subs++;
    let xml = await get(sm);
    if (!xml) {
      try { const u = new URL(sm); if (u.origin !== origin) xml = await get(origin + u.pathname + u.search); } catch { /* bad url */ }
    }
    if (!xml) continue;
    const isIndex = /<sitemapindex/i.test(xml);
    for (const block of xml.split(/<\/(?:url|sitemap)>/i)) {
      const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(block)?.[1]?.replace(/&amp;/g, "&");
      if (!loc) continue;
      // Page URLs are put on the site's own host: Hello Mentor's sitemap lists every
      // page on a dead "temp." host, which would give broken links and hide /webinar.
      let page = loc;
      try { const u = new URL(loc); if (u.origin !== origin) page = origin + u.pathname + u.search; } catch { continue; }
      if (isIndex) queue.push(loc);
      else pages.set(page, /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i.exec(block)?.[1] || null);
    }
  }
  return pages;
}

const kindOfUrl = (u: string): WatchEvent["kind"] => (EVENT_PATH.test(u) ? "event" : BLOG_PATH.test(u) ? "blog" : "page");

async function titleOf(url: string): Promise<string> {
  const html = await get(url, 8_000);
  const t = html ? /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html)?.[1] : null;
  return decode(t || "").replace(/\s+/g, " ").trim() || prettyPath(url);
}
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
const prettyPath = (u: string) => { try { return decodeURIComponent(new URL(u).pathname).split("/").filter(Boolean).pop()?.replace(/[-_]+/g, " ") || u; } catch { return u; } };

// ── events / webinar listing pages ─────────────────────────────────────────────
// What an events page actually lists. Three readers, best first:
//   1. schema.org Event data in the page (Academically publishes an EventSeries with
//      a sub-event per city and date).
//   2. Dated cards in the visible text: "Oct 03 Sat, 06:00 PM - 07:00 PM <title>
//      Register Now" (Moksh's /webinars).
//   3. Links to event-looking pages (Hello Mentor's /pg-medical-expo-2026). Links are
//      judged by their PATH only — matching the word "register" in link text caught
//      menu items like "register as a doctor in Australia" (29 Sep).
// Hello Mentor's /webinar list is filled in by JavaScript after the page loads, so
// none of these see it; their Instagram event posts cover it.
type PageEvent = { url: string; title: string; date: string | null };
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// A date written without a year is this year's — unless it is more than ~6 months
// back, i.e. a December page announcing January. (A July date read in September is a
// past event, not next July's: 29 Sep.)
function yearFor(mon: number, day: number): number {
  const now = new Date(), y = now.getFullYear();
  return new Date(y, mon, day).getTime() < now.getTime() - 180 * 86_400_000 ? y + 1 : y;
}
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

function pageEvents(html: string, pageUrl: string): Map<string, PageEvent> {
  const out = new Map<string, PageEvent>();
  // 1. JSON-LD
  for (const blk of html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || []) {
    let j: unknown;
    try { j = JSON.parse(blk.replace(/^<script[^>]*>|<\/script>$/gi, "")); } catch { continue; }
    const walk = (x: unknown) => {
      if (Array.isArray(x)) { x.forEach(walk); return; }
      if (!x || typeof x !== "object") return;
      const o = x as Record<string, unknown>;
      const type = String(o["@type"] || "");
      if (/Event$/.test(type) && type !== "EventSeries" && typeof o.name === "string") {
        const date = typeof o.startDate === "string" ? o.startDate : null;
        const url = typeof o.url === "string" ? o.url : `${pageUrl}#${slug(o.name + (date || ""))}`;
        out.set(`${o.name}|${date || ""}`, { url, title: decode(o.name), date });
      }
      for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
    };
    walk(j);
  }
  // 2. Dated cards in the text
  const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  const card = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)?,?\s+(\d{1,2}):(\d{2})\s*([ap]m)(?:\s*[-–]\s*\d{1,2}:\d{2}\s*[ap]m)?\s+(.{8,160}?)\s+(?:register|join|book|enrol|enroll|rsvp)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = card.exec(text))) {
    const mon = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), day = Number(m[2]);
    let h = Number(m[3]) % 12; if (m[5].toLowerCase() === "pm") h += 12;
    const y = yearFor(mon, day);
    const date = `${y}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:${m[4]}:00+05:30`;
    const title = m[6].trim();
    out.set(`${title}|${date}`, { url: `${pageUrl}#${slug(title + date)}`, title, date });
  }
  // 3. Links to event pages (path only)
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = re.exec(html))) {
    let abs: URL;
    try { abs = new URL(m[1], pageUrl); } catch { continue; }
    if (abs.origin !== new URL(pageUrl).origin || abs.href.replace(/\/$/, "") === pageUrl.replace(/\/$/, "")) continue;
    const first = abs.pathname.split("/").filter(Boolean)[0] || "";
    if (!EVENT_PATH.test(first) || /^(events?|webinars?)$/i.test(first) && abs.pathname.split("/").filter(Boolean).length === 1) continue;
    const t = decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || prettyPath(abs.href);
    if (!out.has(abs.href)) out.set(abs.href, { url: abs.href, title: t.slice(0, 160), date: null });
  }
  return out;
}

// Dates written anywhere on a page ("Bengaluru OCTOBER 4 NIMHANS", "July 26, 2026").
// Used for a section page that has no posts or event cards of its own — Hello
// Mentor's Medical Expo page lists its cities only this way. One item per date, with
// the words around it as the title; a new date appearing on the page is the news.
function pageDates(html: string, pageUrl: string): Map<string, PageEvent> {
  const out = new Map<string, PageEvent>();
  const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  const re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(20\d\d))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.size < 20) {
    const mon = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), day = Number(m[2]);
    if (day < 1 || day > 31) continue;
    const y = m[3] ? Number(m[3]) : yearFor(mon, day);
    const date = `${y}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+05:30`;
    // The same day written with and without a year is one date.
    if ([...out.keys()].some((k) => k.slice(5, 10) === date.slice(5, 10))) continue;
    const before = text.slice(Math.max(0, m.index - 30), m.index).trim().split(" ").slice(-1).join(" ").replace(/^[^\p{L}\p{N}]+/u, "");
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 50).trim().split(" ").slice(0, 4).join(" ");
    out.set(date, { url: `${pageUrl}#d-${date.slice(0, 10)}`, title: `${before} ${m[0]} ${after}`.replace(/\s+/g, " ").trim(), date });
  }
  return out;
}

// ── sections ───────────────────────────────────────────────────────────────────
// Each competitor's site is watched as separate sections (Webinars, Seminars, Medical
// Expo, News & Blogs...), chosen in Manage competitors. A section's items are the
// pages under its path in the sitemap (blog posts), links under its path on the page,
// and events on the page; failing all of those, the dates written on the page.
export type Section = { label: string; url: string };
const ASSET = /\.(svg|png|jpe?g|webp|gif|ico|css|js|pdf|xml|json)$/i;
const pathOf = (u: string) => { try { return new URL(u).pathname.replace(/\/+$/, "") || "/"; } catch { return ""; } };
const under = (u: string, sec: Section) => { const p = pathOf(sec.url); return p !== "/" && pathOf(u).startsWith(p + "/"); };
// No sections chosen yet: the site's one-word event and blog pages, at most 5.
function autoSections(pages: Map<string, string | null>): Section[] {
  return [...pages.keys()].filter((u) => {
    const segs = pathOf(u).split("/").filter(Boolean);
    return segs.length === 1 && (EVENT_PATH.test(segs[0]) || BLOG_PATH.test(`/${segs[0]}/`));
  }).slice(0, 5).map((u) => ({ label: prettyPath(u), url: u }));
}

// ── seen-set helpers ───────────────────────────────────────────────────────────
async function seenKeys(sb: SB, accountId: string, handle: string, source: string): Promise<Set<string> | null> {
  const keys = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("mh_competitor_seen").select("item_key")
      .eq("account_id", accountId).eq("handle", handle).eq("source", source).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of (data || []) as { item_key: string }[]) keys.add(r.item_key);
    if (!data || data.length < 1000) break;
  }
  return keys.size ? keys : null;   // null = never read before → baseline
}
async function remember(sb: SB, accountId: string, handle: string, source: string, keys: string[]) {
  for (let i = 0; i < keys.length; i += 500) {
    const rows = keys.slice(i, i + 500).map((item_key) => ({ account_id: accountId, handle, source, item_key }));
    const { error } = await sb.from("mh_competitor_seen").upsert(rows, { onConflict: "account_id,handle,source,item_key", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
}

// One source: compare what we read now with what we've seen; baseline if new.
async function diff(sb: SB, accountId: string, handle: string, source: string, now: string[], baselined: string[]): Promise<string[]> {
  if (!now.length) return [];                       // empty read: change nothing
  const before = await seenKeys(sb, accountId, handle, source);
  if (!before) { await remember(sb, accountId, handle, source, now); baselined.push(`${handle}:${source}`); return []; }
  const fresh = now.filter((k) => !before.has(k));
  if (fresh.length) await remember(sb, accountId, handle, source, fresh);
  return fresh;
}

// ── the run ────────────────────────────────────────────────────────────────────
export async function runCompetitorWatch(opts: {
  accountId?: string;
  instagram?: boolean;
  /**
   * Check only a window of the competitor list, `size` wide, starting at
   * `offset` (wrapping). Each competitor costs several sequential network
   * round-trips — robots.txt, the sitemap, every watched section page, then a
   * title fetch per new link — so ten of them in one pass runs well past the 30s
   * a serverless request is allowed and the whole run is killed, having saved
   * nothing. A few per run, rotated, finishes comfortably and still covers
   * everyone several times a day. Omit it and the behaviour is unchanged: the
   * Briefing's "Check now" button still sweeps the lot.
   */
  window?: { offset: number; size: number };
} = {}): Promise<WatchResult> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const accountId = opts.accountId || "goocampus";
  const res: WatchResult = { competitors: 0, checked: 0, baselined: [], events: [], listed: [], errors: [] };
  const account = getAccount(accountId);
  const ourHandle = (account?.handle || "").replace(/^@/, "").toLowerCase();

  const { data: comps, error } = await sb.from("mh_competitors").select("handle, name, website, youtube_channel, platform, watch_pages").eq("account_id", accountId);
  if (error) throw new Error(error.message);
  const list = ((comps || []) as { handle: string; name: string | null; website: string | null; youtube_channel: string | null; platform: string; watch_pages: Section[] | null }[])
    .filter((c) => c.platform === "instagram" && c.handle !== ourHandle);
  res.competitors = list.length;

  // Rotate through the list when a window is given, wrapping at the end so a
  // window straddling the boundary still returns `size` competitors rather than
  // a short tail.
  const due = opts.window && list.length
    ? Array.from({ length: Math.min(opts.window.size, list.length) },
                 (_, i) => list[(opts.window!.offset + i) % list.length])
    : list;
  res.checked = due.length;

  for (const c of due) {
    const name = c.name || c.handle;
    const add = (e: Omit<WatchEvent, "handle" | "name">) => res.events.push({ ...e, handle: c.handle, name });

    // Website: sitemap + event listing pages.
    if (c.website) {
      try {
        const origin = new URL(c.website).origin;
        const robots = await robotsFor(origin);
        const pages = await sitemapUrls(origin, robots);
        const sections = (c.watch_pages && c.watch_pages.length ? c.watch_pages : autoSections(pages))
          .filter((x) => x && x.url && x.label).map((x) => ({ label: x.label, url: x.url.replace(/\/+$/, "") || x.url }));
        const sectionOf = (u: string) => sections.find((x) => under(u, x) || pathOf(u) === pathOf(x.url))?.label || null;

        // Anything new in the sitemap that no section covers.
        const fresh = (await diff(sb, accountId, c.handle, "sitemap", [...pages.keys()], res.baselined)).filter((u) => !sectionOf(u));
        for (const url of fresh.slice(0, 40)) {
          const i = fresh.indexOf(url);
          add({ kind: kindOfUrl(url), url, title: i < MAX_TITLES && allowed(robots, url) ? await titleOf(url) : prettyPath(url), publishedAt: pages.get(url) || null });
        }

        // Each section on its own.
        for (const sec of sections) {
          const items = new Map<string, PageEvent & { kind: WatchEvent["kind"] }>();
          // Pages under it in the sitemap, newest first.
          const kids = [...pages.entries()].filter(([u]) => under(u, sec) && !ASSET.test(u))
            .sort((a, b) => (Date.parse(b[1] || "") || 0) - (Date.parse(a[1] || "") || 0));
          for (const [u, lastmod] of kids) items.set(u, { url: u, title: "", date: lastmod, kind: kindOfUrl(u) });
          const html = allowed(robots, sec.url) ? await get(sec.url) : null;
          if (html) {
            // Links under it on the page itself.
            const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
            let m: RegExpExecArray | null;
            while ((m = re.exec(html))) {
              let abs: string;
              try { abs = new URL(m[1], sec.url).href; } catch { continue; }
              if (!under(abs, sec) || ASSET.test(abs) || items.has(abs)) continue;
              items.set(abs, { url: abs, title: decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 160), date: null, kind: kindOfUrl(abs) });
            }
            // Events on the page (schema.org data, dated cards). Section links only —
            // the menu's other event pages are sections of their own.
            for (const [k, e] of pageEvents(html, sec.url)) if (e.date) items.set(k, { ...e, kind: "event" });
            if (!items.size) for (const [k, e] of pageDates(html, sec.url)) items.set(k, { ...e, kind: EVENT_PATH.test(pathOf(sec.url)) ? "event" : "page" });
          }
          if (!items.size) continue;                        // empty read: change nothing
          const source = `section:${sec.url}`;
          const firstRead = !(await seenKeys(sb, accountId, c.handle, source));
          const got = await diff(sb, accountId, c.handle, source, [...items.keys()], res.baselined);
          // First read: store what's there now (shown, not notified) — the newest few
          // posts, or every event. After that, only what's new, and that is notified.
          const picked = firstRead ? [...items.keys()].slice(0, 12) : got.slice(0, 20);
          let titled = 0;
          for (const k of picked) {
            const e = items.get(k)!;
            const title = e.title || (titled++ < MAX_TITLES && allowed(robots, e.url) ? await titleOf(e.url) : prettyPath(e.url));
            (firstRead ? res.listed : res.events).push({ handle: c.handle, name, kind: e.kind, url: e.url, title, publishedAt: e.date, section: sec.label });
          }
        }
      } catch (e) { res.errors.push(`${name} website: ${(e as Error).message}`); }
    }

    // YouTube: the channel's uploads playlist via the Data API (1 quota unit per
    // channel per run). The free feeds/videos.xml started answering 404/500 (29 Sep).
    const ytKey = process.env.YOUTUBE_API_KEY;
    if (c.youtube_channel && ytKey && /^UC/.test(c.youtube_channel)) {
      try {
        const uploads = "UU" + c.youtube_channel.slice(2);
        const r = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=15&playlistId=${uploads}&key=${ytKey}`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
        const j = r.ok ? await r.json() : { items: [] };
        const vids = new Map<string, { title: string; published: string | null }>();
        for (const it of (j.items || []) as { snippet?: { title?: string }; contentDetails?: { videoId?: string; videoPublishedAt?: string } }[]) {
          const id = it.contentDetails?.videoId;
          if (id) vids.set(id, { title: it.snippet?.title || "", published: it.contentDetails?.videoPublishedAt || null });
        }
        const fresh = await diff(sb, accountId, c.handle, "youtube", [...vids.keys()], res.baselined);
        for (const id of fresh) add({ kind: "youtube", url: `https://www.youtube.com/watch?v=${id}`, title: vids.get(id)?.title || "New video", publishedAt: vids.get(id)?.published });
      } catch (e) { res.errors.push(`${name} YouTube: ${(e as Error).message}`); }
    }

    // Instagram: rate-limited by Meta, so only when asked (the cron asks every ~15 min).
    if (opts.instagram && account) {
      try {
        const snap = await fetchCompetitor(account, c.handle);
        const posts = new Map((snap.recent || []).map((m) => [m.id, m] as const));
        const fresh = await diff(sb, accountId, c.handle, "instagram", [...posts.keys()], res.baselined);
        for (const id of fresh) {
          const m = posts.get(id)!;
          const cap = (m.caption || "").replace(/\s+/g, " ").trim();
          add({ kind: EVENT_WORDS.test(cap) ? "event" : "instagram", url: m.permalink || `https://www.instagram.com/${c.handle}/`, title: cap.slice(0, 160) || "New post", publishedAt: m.timestamp });
        }
      } catch (e) { res.errors.push(`${name} Instagram: ${(e as Error).message}`); }
    }
  }

  // Store events (unique on account+handle+kind+url, so a retry can't double them).
  const toStore = [...res.events, ...res.listed];
  if (toStore.length) {
    const rows = toStore.map((e) => ({ account_id: accountId, handle: e.handle, kind: e.kind, title: e.title, url: e.url, section: e.section || null, published_at: e.publishedAt && !Number.isNaN(Date.parse(e.publishedAt)) ? new Date(e.publishedAt).toISOString() : null }));
    const { error: insErr } = await sb.from("mh_competitor_events").upsert(rows, { onConflict: "account_id,handle,kind,url", ignoreDuplicates: true });
    if (insErr) res.errors.push(`saving events: ${insErr.message}`);
  }
  return res;
}
