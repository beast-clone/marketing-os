import { NextResponse } from "next/server";
import { requireSection, requireSchedulerPost } from "@/lib/api-guard";
import { getSupabase } from "@/lib/supabase";
import { notUpdated } from "@/lib/scheduler-lock";
import { unschedulePost } from "@/lib/scheduler-actions";
import { safeError } from "@/lib/errors";
import { getSessionUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/scheduler/cancel  { recordId }
// Removes a post from the publish queue: clears publish_status + schedule_time so it
// no longer shows as scheduled/publishing/failed. The content row itself is kept and
// drops back into the "Ready to schedule" backlog (reversible — nothing is destroyed).
export async function POST(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const { recordId, reason } = (await req.json()) as { recordId?: string; reason?: string };
    if (!recordId) return NextResponse.json({ error: "recordId required" }, { status: 400 });
    { const __pages = await requireSchedulerPost(recordId); if (__pages) return __pages; }
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    const ok = await unschedulePost(sb, recordId, (getSessionUserId() || "scheduler").toLowerCase(), typeof reason === "string" ? reason : undefined);
    if (!ok) return notUpdated(sb, recordId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(safeError(err, "Cancel failed"), { status: 502 });
  }
}
