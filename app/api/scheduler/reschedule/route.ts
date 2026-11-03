import { NextResponse } from "next/server";
import { requireSection, requireSchedulerPost, requireCapability } from "@/lib/api-guard";
import { getSupabase } from "@/lib/supabase";
import { NOT_PUBLISHING, notUpdated, freshPublishState } from "@/lib/scheduler-lock";
import { safeError } from "@/lib/errors";
import { logQueueAction, istTime } from "@/lib/publish-history";

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
    const { data: was } = await sb.from("mh_posts").select("schedule_time, custom").eq("id", body.recordId).maybeSingle();
    const { data, error } = await sb
      .from("mh_posts")
      // A failed post rescheduled must not go back to its old (failed) upload or carry
      // its old try count; what already went out stays marked so it isn't re-posted.
      .update({ schedule_time: new Date(body.scheduleTime).toISOString(), publish_status: "scheduled", failure_reason: null, custom: freshPublishState(was?.custom) })
      .eq("id", body.recordId)
      .or(NOT_PUBLISHING)   // never while the publisher is sending it
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) return notUpdated(sb, body.recordId);
    await logQueueAction(sb, body.recordId, "publish_rescheduled", istTime(was?.schedule_time), istTime(body.scheduleTime));
    // Its "also as a Story" moves with it (enqueue syncStory, 27 Oct), and a
    // multi-frame story's other frames keep their minute apart (syncFrames, 3 Nov).
    const { data: linked } = await sb.from("mh_posts").select("id, custom").eq("custom->>story_of", body.recordId).eq("publish_status", "scheduled");
    const base = new Date(body.scheduleTime).getTime();
    for (const r of (linked || []) as { id: string; custom: Record<string, unknown> | null }[]) {
      const frame = Number(r.custom?.frame) || 0;
      await sb.from("mh_posts").update({ schedule_time: new Date(base + (frame > 1 ? (frame - 1) * 60_000 : 0)).toISOString() }).eq("id", r.id);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(safeError(err, "Reschedule failed"), { status: 502 });
  }
}
