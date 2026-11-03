import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { runWatchers } from "@/lib/watchers";
import { runPublishAnnounce } from "@/lib/publish-announce";
import { syncCloneLinks } from "@/lib/mh-linkback";
import { getSessionIsAdmin, isLoggedIn } from "@/lib/auth";
import { safeError } from "@/lib/errors";

// Watchers, every 15 minutes (netlify/functions/watchers-cron.mts).
//   GET /api/cron/watchers      x-cron-secret: <CRON_SECRET>   (or an admin session, by hand)
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const byCron = sameSecret(req.headers.get("x-cron-secret"), secret);
  if (!byCron && !(isLoggedIn() && getSessionIsAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const t0 = Date.now();
  try {
    const out = await runWatchers();
    const fresh = out.results.reduce((n, r) => n + r.fresh.length, 0);
    // Same 15-minute beat: tell the team group about posts that just went live.
    // Links from a post's extra-page copies onto the task itself, before announcing.
    const linksCopied = await syncCloneLinks().catch((e) => { console.error("[clone-links] failed", e); return 0; });
    const announced = await runPublishAnnounce().catch((e) => { console.error("[publish-announce] failed", e); return { sent: 0 }; });
    console.log(`[watchers] ${out.checked} checked, ${fresh} new, ${out.results.filter((r) => r.error).length} errors, ${Date.now() - t0}ms`);
    return NextResponse.json({ ok: true, ms: Date.now() - t0, ...out, announced, linksCopied });
  } catch (err) {
    console.error("[watchers] failed", err);
    return NextResponse.json(safeError(err, "Watchers check failed"), { status: 502 });
  }
}
