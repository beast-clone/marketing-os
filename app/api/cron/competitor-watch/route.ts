import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { runCompetitorWatch, type WatchEvent } from "@/lib/competitor-watch";
import { getSupabase } from "@/lib/supabase";
import { fetchRoster } from "@/lib/team-db";
import { getSessionIsAdmin, isLoggedIn } from "@/lib/auth";
import { safeError } from "@/lib/errors";

// The competitor watcher, every 5 minutes (netlify/functions/competitor-watch-cron.mts),
// or by hand from the Briefing ("Check now", admins only).
//
//   GET /api/cron/competitor-watch            x-cron-secret: <CRON_SECRET>
//   GET /api/cron/competitor-watch?ig=1       also read Instagram (rate-limited by Meta,
//                                             so the cron asks for it every ~15 min)
//
// Anything new becomes a notification for everyone on the team. Webinars and events
// pop up once; blogs, posts and videos go to the bell quietly — ten competitors
// posting several times a day would otherwise interrupt all day.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LABEL: Record<WatchEvent["kind"], string> = {
  event: "webinar / event", blog: "blog post", page: "page on their site", youtube: "YouTube video", instagram: "Instagram post",
};

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const byCron = sameSecret(req.headers.get("x-cron-secret"), secret);
  if (!byCron && !(isLoggedIn() && getSessionIsAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const t0 = Date.now();
  try {
    const sp = new URL(req.url).searchParams;
    const ig = sp.get("ig") === "1";

    // A scheduled run takes a few competitors at a time; a person pressing
    // "Check now" still gets the whole list.
    //
    // Checking all ten in one request took 31s and was killed by the gateway
    // before anything was saved — it had been failing that way on every run.
    // The offset walks forward with the clock, so consecutive hourly runs pick
    // up where the last left off and everyone is covered a few times a day.
    // Two per run, not more: the gateway cuts a request off around 26s, three
    // took 12s locally and production is slower on every hop. ?size=0 forces the
    // old full sweep if it is ever wanted from cron.
    const size = sp.has("size") ? Math.max(0, Number(sp.get("size")) || 0) : (byCron ? 2 : 0);
    const window = size > 0
      ? { size, offset: sp.has("offset") ? Number(sp.get("offset")) || 0 : Math.floor(Date.now() / 3_600_000) * size }
      : undefined;

    const result = await runCompetitorWatch({ instagram: ig, window });

    // Notify the team.
    const sb = getSupabase();
    if (sb && result.events.length) {
      const people = (await fetchRoster()).filter((u) => u.active).map((u) => u.id);
      const now = new Date().toISOString();
      const rows = result.events.flatMap((e) => people.map((p) => ({
        recipient_key: p,
        source_id: `competitor:${e.kind}:${e.url}`,
        kind: e.kind === "event" ? "competitor_event" : "competitor",
        category: "competitor",
        action_needed: false,
        emoji: e.kind === "event" ? "📣" : "🔎",
        title: e.section ? `${e.name} · new in ${e.section}` : `${e.name} · new ${LABEL[e.kind]}`,
        sub: e.title,
        post_id: null,
        payload: { href: `/dashboard/preview/briefing?c=${encodeURIComponent(e.handle)}`, url: e.url },
        created_at: now,
      })));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await sb.from("mh_notifications").upsert(rows.slice(i, i + 500), { onConflict: "recipient_key,source_id", ignoreDuplicates: true });
        if (error) result.errors.push(`notifications: ${error.message}`);
      }
    }

    console.log(`[competitor-watch] ${result.checked}/${result.competitors} competitors checked, ${result.events.length} new, ${result.baselined.length} baselined, ${result.errors.length} errors, ${Date.now() - t0}ms`);
    return NextResponse.json({ ok: true, ms: Date.now() - t0, ...result });
  } catch (err) {
    console.error("[competitor-watch] failed", err);
    return NextResponse.json(safeError(err, "Competitor watch failed"), { status: 502 });
  }
}
