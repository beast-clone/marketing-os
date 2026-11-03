import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { listItems } from "@/lib/content-radar";
import { searchWebMentions } from "@/lib/web-mentions";
import { getReviews, isNegativeReview } from "@/lib/google-reviews";
import { listAlerts } from "@/lib/content-radar";
import { getDomainTrends } from "@/lib/google-trends";
import { actionsByItem, loggedKeys, radarItemKey } from "@/lib/radar-actions";

// End of day: close the radar and write down what happened.
//   GET /api/cron/radar-rolloff   (header: x-cron-secret: <CRON_SECRET>)
//
// Everything currently on the Radar is written into the day's log with whatever was
// done about it — written, useful, not useful, or nothing at all. Once logged, an item
// no longer appears on the Radar: it had its day, and it now belongs to the report.
// That is what stops the tab becoming a pile nobody can ever finish, and it is what
// makes "no action taken" a recorded fact rather than an absence nobody can see.
//
// Runs at 11:59 PM IST. See sql/022_radar_report.sql.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BRAND_QUERY = "GooCampus";
const MAX_AGE_DAYS = 30;
const ageDays = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000;

// An item has to have been on the Radar this long before its silence means anything. A
// story that landed at 11 PM has had no chance, and recording it as "no action taken" an
// hour later would make the report accuse people of ignoring things they never saw. Late
// arrivals stay on the Radar and are closed by tomorrow's run, with a full day behind them.
const MIN_VISIBLE_HOURS = 6;
const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3_600_000;

// Same rule the Radar uses to decide what carries an "act now" badge — kept in step
// with lib/content-radar's flag words. Stored on the row rather than recomputed later,
// because age keeps growing and "urgent" has to mean urgent WHEN IT WAS SHOWN.
const DEADLINE_WORDS = ["last date", "deadline", "closes", "closing", "ends", "ending", "today", "tomorrow", "expires", "extended", "window"];
function isTimeSensitive(title: string, publishedAt: string): boolean {
  const hay = (title || "").toLowerCase();
  if (DEADLINE_WORDS.some((w) => hay.includes(w))) return true;
  return ageDays(publishedAt) <= 1;
}

type LogRow = {
  day: string; item_key: string; item_kind: string; title: string;
  source: string | null; url: string | null; interest: string | null;
  time_sensitive: boolean; action: string | null; actor_key: string | null; task_id: string | null;
  reason: string | null;
};

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    const url = new URL(req.url);
    const dry = url.searchParams.get("dry") === "1";
    // The day being closed, in IST — the team's day, not UTC's. Run at 11:59 PM IST
    // this is today; run late it still closes the day it belongs to.
    const day = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

    const [news, brand, revs, trends, actions, already] = await Promise.all([
      listItems({ limit: 500 }),
      searchWebMentions(BRAND_QUERY, { limit: 30 }).catch(() => null),
      getReviews().catch(() => null),
      // Same seeds the Trends lane uses on the page — the topics being watched.
      listAlerts()
        .then((a) => a.filter((x) => x.active).map((x) => x.searchQuery || x.name).filter(Boolean) as string[])
        .then((seeds) => getDomainTrends({ seeds: seeds.length ? seeds : ["NEET PG 2026", "AMC exam", "PLAB 2"] }))
        .catch(() => null),
      actionsByItem(),
      loggedKeys(),
    ]);

    const rows: LogRow[] = [];
    const push = (
      kind: "news" | "mention" | "search" | "review", rawKey: string, title: string,
      source: string | null, link: string | null, interest: string | null, urgent: boolean,
    ) => {
      const key = radarItemKey(kind, rawKey);
      // Already logged on an earlier day — it had its day, leave that record alone.
      if (already.has(key)) return;
      const a = actions[key];
      rows.push({
        day, item_key: key, item_kind: kind, title,
        source, url: link, interest, time_sensitive: urgent,
        // NULL is the point of this whole job: shown, and nothing was done.
        action: a?.action || null, actor_key: a?.actor_key || null, task_id: a?.task_id || null,
        reason: a?.reason || null,
      });
    };

    let heldBack = 0;
    for (const it of news) {
      if (ageDays(it.publishedAt) > MAX_AGE_DAYS) continue;   // never shown, never logged
      // fetchedAt is when we first pulled it in — i.e. when it appeared on the Radar —
      // and the upsert leaves it alone on conflict, so it stays the first-seen time.
      if (it.fetchedAt && hoursSince(it.fetchedAt) < MIN_VISIBLE_HOURS) { heldBack++; continue; }
      push("news", it.id, it.title, it.source, it.link, it.primaryInterest,
           isTimeSensitive(it.title, it.publishedAt));
    }
    for (const m of brand?.mentions || []) {
      // Mentions come from a live search, so there is no first-seen date to lean on. The
      // thread's own date is the nearest thing: a thread posted in the last few hours gets
      // the same benefit of the doubt as a late news story.
      if (m.publishedAt && hoursSince(m.publishedAt) < MIN_VISIBLE_HOURS) { heldBack++; continue; }
      // A negative mention is chased like a deadline: it is the one that costs money
      // while nobody answers it.
      push("mention", m.url, m.title, m.source, m.url, "Brand", m.sentiment === "negative");
    }

    for (const r of revs?.reviews || []) {
      // All reviews are logged now, not only complaints — the Log tab is a record of
      // everything the radar produced that day. Only a complaint is time_sensitive
      // though, so the report and the briefing still chase only those.
      // Same 90-day window the Radar shows them in — see the page's NEGATIVE_WINDOW_DAYS.
      if (r.publishedAt && ageDays(r.publishedAt) > 90) continue;
      push("review", r.id, r.text || `${r.rating}-star rating, no comment`,
           "Google Reviews", r.link, `${r.rating}-star`, isNegativeReview(r));
    }

    // Google Trends rising searches. They were never logged, so a day's record was
    // missing an entire lane — one that the Radar shows and people can act on.
    for (const g of trends?.ideas || []) {
      for (const term of g.ideas || []) {
        push("search", term, term, "Google Trends", null, "Rising search", false);
      }
    }

    if (dry) {
      return NextResponse.json({
        ok: true, dry, day, wouldLog: rows.length, heldBack,
        noActionTaken: rows.filter((r) => !r.action).length,
        timeSensitiveMissed: rows.filter((r) => !r.action && r.time_sensitive).length,
      });
    }

    // Idempotent: a re-run on the same day updates rather than duplicating, so a retry
    // after a timeout is safe.
    const { error } = await sb.from("radar_day_log").upsert(rows, { onConflict: "day,item_key" });
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });

    return NextResponse.json({
      ok: true, day, logged: rows.length,
      // Too new to judge — left on the Radar for tomorrow's run.
      heldBack,
      written: rows.filter((r) => r.action === "written").length,
      useful: rows.filter((r) => r.action === "useful").length,
      notUseful: rows.filter((r) => r.action === "not_useful").length,
      noActionTaken: rows.filter((r) => !r.action).length,
      timeSensitiveMissed: rows.filter((r) => !r.action && r.time_sensitive).length,
    });
  } catch (err) {
    return NextResponse.json(safeError(err, "Radar roll-off failed"), { status: 502 });
  }
}
