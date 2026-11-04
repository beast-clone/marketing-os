import { NextResponse } from "next/server";
import { requireSection, requireSchedulerPost } from "@/lib/api-guard";
import { notUpdated } from "@/lib/scheduler-lock";
import { retryPost } from "@/lib/scheduler-actions";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Retry a stuck/failed post — re-arm it in Supabase mh_posts (publish_status back to
// 'scheduled', clear the failure reason) so the worker attempts it again.
export async function POST(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  let body: { recordId?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.recordId || typeof body.recordId !== "string") {
    return NextResponse.json({ error: "recordId required" }, { status: 400 });
  }
  try {
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    { const __pages = await requireSchedulerPost(body.recordId); if (__pages) return __pages; }
    // Like Publish now on a failed post: a fresh upload and try count (the old failed
    // upload is what made a retried reel fail again at once), never while it's being
    // sent, and what already went out stays marked so it isn't posted twice.
    if (!(await retryPost(sb, body.recordId))) return notUpdated(sb, body.recordId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(safeError(err, "Retry failed"), { status: 502 });
  }
}
