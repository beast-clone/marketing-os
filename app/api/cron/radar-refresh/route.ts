import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { refreshAllActive } from "@/lib/content-radar";

// Keep Content Radar actually current.
//   GET /api/cron/radar-refresh   (header: x-cron-secret: <CRON_SECRET>)
//
// The radar had no scheduled refresh at all — it only updated when somebody pressed
// "Refresh now" on the page. On 27 Sep 2026 the last fetch was 18 Sep, so the freshest
// headline in a 42-item feed was nine days old and not one item was from the past week.
// The screen was not broken; it was simply switched off between visits, and nobody is
// going to remember to press a button every morning.
//
// This is the same shape as the other jobs: the work stays in lib/content-radar
// (refreshAllActive → per active alert), this route is the scheduled entry point, and
// netlify/functions/radar-refresh-cron.mts pokes it hourly.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 26;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const startedAt = Date.now();
  try {
    const sb = getSupabase();

    // How stale was it BEFORE this run? Recorded so the logs answer "is the schedule
    // actually firing" without anyone having to diff two responses — a job that silently
    // stopped is exactly the failure this route exists to prevent.
    let staleHoursBefore: number | null = null;
    if (sb) {
      const { data } = await sb
        .from("content_alerts")
        .select("last_fetched_at")
        .eq("active", true)
        .order("last_fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const prev = (data as { last_fetched_at?: string | null } | null)?.last_fetched_at;
      if (prev) staleHoursBefore = Math.round((Date.now() - new Date(prev).getTime()) / 3_600_000);
    }

    // Count the stored items either side of the run. refreshAlert reports how many rows
    // its UPSERT touched, which is every row it fetched — re-running a minute later
    // reports the same 26 because they were all rewritten. That number would have every
    // hourly log claiming 26 fresh stories, so it is reported as what it is and the
    // genuinely-new figure is measured here instead.
    const countItems = async () => {
      if (!sb) return null;
      const { count } = await sb.from("content_alert_items").select("id", { count: "exact", head: true });
      return count ?? null;
    };
    const before = await countItems();

    const results = await refreshAllActive();
    const rowsWritten = results.reduce((s, r) => s + r.inserted, 0);
    const failed = results.filter((r) => r.error);

    const after = await countItems();
    const newItems = before !== null && after !== null ? after - before : null;

    return NextResponse.json({
      ok: true,
      staleHoursBefore,
      alerts: results.length,
      // What actually arrived, vs what was merely rewritten.
      newItems,
      rowsWritten,
      // Named rather than counted: one alert failing every hour is a broken alert, and
      // that only shows up if the failure is attributed.
      failures: failed.map((r) => ({ alertId: r.alertId, error: r.error })),
      tookMs: Date.now() - startedAt,
    });
  } catch (err) {
    return NextResponse.json(safeError(err, "Radar refresh failed"), { status: 502 });
  }
}
