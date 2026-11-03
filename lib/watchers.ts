// Watchers (docs/WATCHERS_SPEC.md) — watch web pages such as the KEA and MCC
// counselling notice pages and tell people the moment something new is posted:
// on the dashboard, by email and on Telegram. Replaces n8n workflow
// lhOaZp9S755bhEvT ("KEA UGNEET 2026 Notification Watcher").
//
// Same two rules as that workflow and the competitor watcher:
//   · The first read of a page is a BASELINE: everything on it is recorded as
//     "already there" and nobody is told.
//   · A read that finds nothing (site down, blocked, error page) changes nothing.
//     Otherwise the next good read would announce every existing notice as new.
//
// A "notice" is any link on the page. Menus and footers are on the page from the
// first read, so after the baseline only genuinely new links show up.
import { getSupabase } from "@/lib/supabase";
import { fetchRoster } from "@/lib/team-db";
import { hasEmail, sendMail } from "@/lib/email";
import { hasTelegram, sendTelegram, syncTelegramChats } from "@/lib/telegram";
import { summarizeNotice } from "@/lib/pdf-summary";
import { isPublicUrl, safeFetch } from "@/lib/ssrf";

export type Watcher = {
  id: string; name: string | null; url: string; category: string | null; auto_category: boolean;
  emails: string[]; telegram: boolean; telegram_chats: string[]; active: boolean;
  created_by: string | null; created_at: string; last_checked_at: string | null; last_error: string | null; last_count: number | null;
};
type Found = { url: string; title: string };
// What actually left the building. The page used to promise every new notice had
// been "sent to the people on this link" whether or not anything was configured —
// with no mail account set up that was simply untrue, and it is the kind of untrue
// nobody notices until a notice is missed.
export type Sent = {
  dashboard: number;   // team members who got a pop-up
  email: number;       // addresses the mail actually went to
  telegram: number;    // chats the message actually reached
  emailOff: boolean;      // addresses are listed but no mail account is configured
  telegramOff: boolean;   // chats are listed but no bot is configured
};
export type CheckResult = { watcher: string; found: number; baseline: boolean; fresh: { title: string; url: string; grp: string; summary?: string | null }[]; sent?: Sent; error?: string };
const MAX_SUMMARIES = 6;   // per check — each is a download plus an AI call (~3–8 s)

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SKIP = /\.(css|js|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)(\?|$)/i;
const MAX_ANNOUNCE = 30;   // a page that suddenly "gains" more than this has changed layout, not posted 30 notices

const decode = (s: string) => s
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const clean = (s: string) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function fetchPage(url: string): Promise<string | null> {
  // A watcher URL is supplied by a person and fetched by the server, so it has
  // to be checked before the request goes out — otherwise this is a proxy into
  // the private network and the cloud metadata address, and linksOn() hands the
  // caller back everything it found. Returning null here means the watcher
  // records "Couldn't open the page", which is the correct outcome.
  if (!(await isPublicUrl(url))) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await safeFetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }, timeoutMs: 25_000, cache: "no-store" });   // checks every redirect hop
      if (r.ok) return await r.text();
    } catch { /* retry once */ }
  }
  return null;
}

// Every link on the page, with its text (or the file name when the link has none).
export function linksOn(html: string, pageUrl: string): Found[] {
  const out = new Map<string, Found>();
  const re = /<a\s([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1]?.trim();
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    let abs: string;
    try { const u = new URL(href, pageUrl); u.hash = ""; abs = u.href; } catch { continue; }
    if (SKIP.test(abs) || out.has(abs)) continue;
    const title = clean(m[2]) || clean(/\btitle\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1] || "") || decodeURIComponent(abs.split("/").filter(Boolean).pop() || abs);
    out.set(abs, { url: abs, title: title.slice(0, 300) });
  }
  return [...out.values()];
}

// ── grouping ───────────────────────────────────────────────────────────────────
// Read from the notice itself — its title, then its link — so a notice lands in the
// right group even if someone filed the link under the wrong category. Only when
// neither says does the link's own category (or "Other") apply. KEA writes its
// notices in Kannada, but keeps "UGNEET", "PGET" etc. in Latin letters, and its file
// paths say ugneet2026 — so this still works there.
const W = (s: string) => new RegExp(`(?<![a-z])(?:${s})(?![a-z])`, "i");
const PG = W("pg|p\\.g\\.|pget|pgneet|pgcet|neet[\\s_-]?pg|neet[\\s_-]?ss|post[\\s-]?graduat(?:e|ion)|md|ms|mds|md\\/ms|dnb|super[\\s-]?speciality");
const UG = W("ug|u\\.g\\.|ugneet|ugayush|ugcet|neet[\\s_-]?ug|under[\\s-]?graduat(?:e|ion)|mbbs|bds|bams|bhms|bums|bsms|b\\.?\\s?sc\\.?\\s?nursing");
function groupOf(text: string): string | null {
  const pg = PG.test(text), ug = UG.test(text);
  return pg && ug ? "UG & PG" : pg ? "PG" : ug ? "UG" : null;
}
export function groupFor(item: Found, w: Pick<Watcher, "category" | "auto_category">): string {
  if (w.auto_category) {
    const g = groupOf(item.title) || groupOf(decodeURIComponent(new URL(item.url).pathname));
    if (g) return g;
  }
  return w.category?.trim() || "Other";
}

// ── when was it posted? ────────────────────────────────────────────────────────
// Read from the notice itself, so a notice that was already on the page shows its
// real day ("yesterday", "28 Sep") rather than the day we happened to first read it.
// In order: a date in the title (KEA writes "29-09-2026", "(30/09/2026)"), then a
// timestamp in the file name (MCC "202609301551581216.pdf", KEA "k20260917145953"),
// then a ddmmyyyy in the file name (KEA "_29092026kannada.pdf"). Null if none.
const valid = (y: number, m: number, d: number) => y >= 2020 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
function iso(y: number, m: number, d: number, h = 0, mi = 0): string | null {
  if (!valid(y, m, d) || h > 23 || mi > 59) return null;
  const t = Date.UTC(y, m - 1, d, h, mi) - 330 * 60_000;            // written in IST
  return t > Date.now() + 86_400_000 ? null : new Date(t).toISOString();
}
export function noticeDate(title: string | null, url: string): string | null {
  let m = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](20\d{2})(?!\d)/.exec(title || "");
  if (m) { const d = iso(+m[3], +m[2], +m[1]); if (d) return d; }
  const file = decodeURIComponent(url.split("?")[0].split("/").pop() || "");
  m = /(?<!\d)(20\d{2})(\d{2})(\d{2})(\d{2})?(\d{2})?/.exec(file);
  if (m) { const d = iso(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0); if (d) return d; }
  m = /(?<!\d)(\d{2})(\d{2})(20\d{2})(?!\d)/.exec(file);
  if (m) { const d = iso(+m[3], +m[2], +m[1]); if (d) return d; }
  return null;
}

// ── checking ───────────────────────────────────────────────────────────────────
async function knownUrls(watcherId: string): Promise<Set<string>> {
  const sb = getSupabase()!;
  const seen = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("mh_watcher_items").select("item_url").eq("watcher_id", watcherId).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of (data || []) as { item_url: string }[]) seen.add(r.item_url);
    if (!data || data.length < 1000) break;
  }
  return seen;
}

/**
 * @param prefetchedHtml  HTML someone else already fetched, for pages this
 *   server cannot reach. cetonline.karnataka.gov.in answers an Indian IP in
 *   under a second and refuses Netlify's US ones outright, so the KEA watcher
 *   read "Couldn't open the page" on every run while the page itself was
 *   perfectly healthy — no timeout or retry here could ever have fixed that.
 *   n8n runs on a host the site does answer, so it fetches the page and posts
 *   the HTML to /api/cron/watchers-ingest, which hands it in here. Everything after
 *   the fetch — link extraction, diffing, alerts — is the same code path as a
 *   direct check. Pass `null` to mean "the fetch was tried and failed".
 */
export async function checkWatcher(w: Watcher, prefetchedHtml?: string | null): Promise<CheckResult> {
  const sb = getSupabase()!;
  const label = w.name || new URL(w.url).hostname;
  const res: CheckResult = { watcher: label, found: 0, baseline: false, fresh: [] };
  const html = prefetchedHtml !== undefined ? prefetchedHtml : await fetchPage(w.url);
  const items = html ? linksOn(html, w.url) : [];
  res.found = items.length;
  if (!items.length) {
    res.error = html ? "No links found on the page" : "Couldn't open the page";
    await sb.from("mh_watchers").update({ last_checked_at: new Date().toISOString(), last_error: res.error }).eq("id", w.id);
    return res;                                        // empty read: change nothing
  }
  const seen = await knownUrls(w.id);
  res.baseline = seen.size === 0;
  const fresh = items.filter((i) => !seen.has(i.url));
  if (fresh.length) {
    const rows = fresh.map((i) => ({ watcher_id: w.id, item_url: i.url, title: i.title, grp: groupFor(i, w), baseline: res.baseline || fresh.length > MAX_ANNOUNCE }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from("mh_watcher_items").upsert(rows.slice(i, i + 500), { onConflict: "watcher_id,item_url", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    if (!res.baseline && fresh.length <= MAX_ANNOUNCE) res.fresh = rows.map((r) => ({ title: r.title, url: r.item_url, grp: r.grp }));
  }
  await sb.from("mh_watchers").update({
    last_checked_at: new Date().toISOString(), last_count: items.length,
    last_error: !res.baseline && fresh.length > MAX_ANNOUNCE ? `${fresh.length} links changed at once — the page layout probably changed; recorded quietly` : null,
  }).eq("id", w.id);
  if (res.fresh.length) {
    // A one-line summary of each new notice, before anyone is told — so the email and
    // Telegram message carry it. A summary that fails just leaves the title.
    for (const f of res.fresh.slice(0, MAX_SUMMARIES)) {
      const s = await summarizeNotice(f.title, f.url).catch(() => null);
      if (!s?.text) continue;
      f.summary = s.text;
      await sb.from("mh_watcher_items").update({ summary: s.text, summary_from: s.from }).eq("watcher_id", w.id).eq("item_url", f.url);
    }
    res.sent = await announce(w, res.fresh);
  }
  return res;
}

// ── telling people ─────────────────────────────────────────────────────────────
async function announce(w: Watcher, fresh: CheckResult["fresh"]): Promise<Sent> {
  const sb = getSupabase()!;
  const label = w.name || new URL(w.url).hostname;
  const now = new Date().toISOString();
  const groups = [...new Set(fresh.map((f) => f.grp))];
  const heading = `${groups.join(" / ")} news · ${fresh.length} new on ${label}`;

  // 1. Dashboard: a pop-up notification for every team member on the email list.
  const roster = (await fetchRoster()).filter((u) => u.active);
  const wanted = new Set(w.emails.map((e) => e.toLowerCase()));
  const people = roster.filter((u) => wanted.has(u.email.toLowerCase()));
  const notifs = fresh.flatMap((f) => people.map((p) => ({
    recipient_key: p.id, source_id: `watcher:${w.id}:${f.url}`, kind: "watcher_news", category: "watcher",
    action_needed: false, emoji: "📰", title: `${f.grp} news · ${label}`, sub: f.title, post_id: null,
    payload: { href: `/dashboard/preview/watchers?w=${w.id}`, url: f.url }, created_at: now,
  })));
  if (notifs.length) await sb.from("mh_notifications").upsert(notifs, { onConflict: "recipient_key,source_id", ignoreDuplicates: true });
  const canEmail = await hasEmail();
  const canTelegram = await hasTelegram();
  const sent: Sent = {
    dashboard: people.length, email: 0, telegram: 0,
    emailOff: w.emails.length > 0 && !canEmail,
    telegramOff: w.telegram && w.telegram_chats.length > 0 && !canTelegram,
  };

  // 2. Email — one message per check listing everything new, grouped.
  if (w.emails.length && canEmail) {
    try {
      await sendMail({ to: w.emails.join(", "), subject: heading, html: emailHtml(label, w.url, fresh), text: fresh.map((f) => `[${f.grp}] ${f.title}${f.summary ? `\n${f.summary}` : ""}\n${f.url}`).join("\n\n") });
      await sb.from("mh_watcher_items").update({ emailed_at: now }).eq("watcher_id", w.id).in("item_url", fresh.map((f) => f.url));
      sent.email = w.emails.length;
    } catch (e) { await sb.from("mh_watchers").update({ last_error: `Email failed: ${(e as Error).message}` }).eq("id", w.id); }
  }

  // 3. Telegram — short, one line per notice.
  if (w.telegram && w.telegram_chats.length && canTelegram) {
    const msg = `<b>${esc(heading)}</b>\n\n` + fresh.map((f) => `• <b>[${esc(f.grp)}]</b> <a href="${esc(f.url)}">${esc(f.title.slice(0, 200))}</a>${f.summary ? `\n   ${esc(f.summary)}` : ""}`).join("\n\n") + `\n\nSource: ${esc(w.url)}`;
    let ok = false;
    for (const chat of w.telegram_chats) { try { await sendTelegram(chat, msg); ok = true; } catch { /* one bad chat must not stop the others */ } }
    if (ok) { await sb.from("mh_watcher_items").update({ telegram_at: now }).eq("watcher_id", w.id).in("item_url", fresh.map((f) => f.url)); sent.telegram = w.telegram_chats.length; }
  }
  return sent;
}

// Branded like the n8n version the counselling desk is used to — on the dashboard's
// brand blue, grouped by UG / PG.
function emailHtml(label: string, source: string, fresh: CheckResult["fresh"]): string {
  const byGroup = new Map<string, CheckResult["fresh"]>();
  for (const f of fresh) byGroup.set(f.grp, [...(byGroup.get(f.grp) || []), f]);
  const blocks = [...byGroup.entries()].map(([g, list]) => `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#8A92A6;margin:18px 0 8px">${esc(g)} news</div>
    ${list.map((f) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E9ECF2;border-left:4px solid #3A57E8;border-radius:6px;margin-bottom:10px"><tr><td style="padding:14px 16px">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#232D42;margin-bottom:${f.summary ? 4 : 10}px">${esc(f.title)}</div>
      ${f.summary ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#4A5468;margin-bottom:10px">${esc(f.summary)}</div>` : ""}
      <a href="${esc(f.url)}" style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#ffffff;background:#3A57E8;text-decoration:none;padding:8px 16px;border-radius:4px">${/\.pdf(\?|$)/i.test(f.url) ? "Open PDF" : "Open page"} &rarr;</a>
    </td></tr></table>`).join("")}`).join("");
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px 12px;background:#F6F7FB">
  <table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="max-width:100%;background:#ffffff;border-radius:10px;overflow:hidden">
    <tr><td style="background:#232D42;padding:20px 24px"><div style="font-family:Arial,Helvetica,sans-serif;font-size:19px;color:#ffffff">GooCampus</div>
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#B8C0D6;margin-top:3px;letter-spacing:1px;text-transform:uppercase">Watchers · ${esc(label)}</div></td></tr>
    <tr><td style="background:#3A57E8;padding:10px 24px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#ffffff">${fresh.length} new notice${fresh.length === 1 ? "" : "s"} just posted</td></tr>
    <tr><td style="padding:8px 24px 20px">${blocks}</td></tr>
    <tr><td style="background:#F6F7FB;padding:16px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8A92A6">Source: <a href="${esc(source)}" style="color:#232D42">${esc(source)}</a><br>Checked every 30 minutes, 6am–11:30pm IST · GooCampus Marketing OS</td></tr>
  </table></body></html>`;
}

// Every active watcher, a few at a time (government sites can be slow).
export async function runWatchers(): Promise<{ checked: number; results: CheckResult[] }> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  await syncTelegramChats().catch(() => {});
  const { data, error } = await sb.from("mh_watchers").select("*").eq("active", true);
  if (error) throw new Error(error.message);
  const list = (data || []) as Watcher[];
  const results: CheckResult[] = [];
  for (let i = 0; i < list.length; i += 4) {
    results.push(...await Promise.all(list.slice(i, i + 4).map((w) => checkWatcher(w).catch((e) => ({ watcher: w.name || w.url, found: 0, baseline: false, fresh: [], error: (e as Error).message })))));
  }
  return { checked: list.length, results };
}
