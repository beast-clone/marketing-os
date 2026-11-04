import { NextResponse } from "next/server";
import { requireSection, requireSchedulerPost, requireCapability } from "@/lib/api-guard";
import { getSupabase } from "@/lib/supabase";
import { notUpdated } from "@/lib/scheduler-lock";
import { reschedulePost } from "@/lib/scheduler-actions";
import { safeError } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Reschedule a queued post — update its schedule_time in Supabase mh_posts.
export async function POST(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;
  // The section alone let anyone with Content past the Edit / Change dates switches (security audit, 3 Nov 2026).
  { const __noCap = await requireCapability("reschedule"); if (__noCap) return __noCap; }

  let body: { recordId?: string; scheduleTime?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.recordId || typeof body.recordId !== "string") {
    return NextResponse.json({ error: "recordId required" }, { status: 400 });
  }
    { const __pages = await requireSchedulerPost(body.recordId); if (__pages) return __pages; }
  if (!body.scheduleTime || typeof body.scheduleTime !== "string" || Number.isNaN(Date.parse(body.scheduleTime))) {
    return NextResponse.json({ error: "scheduleTime required (valid ISO 8601)" }, { status: 400 });
  }

  try {
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    if (!(await reschedulePost(sb, body.recordId, body.scheduleTime))) return notUpdated(sb, body.recordId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(safeError(err, "Reschedule failed"), { status: 502 });
  }
}
