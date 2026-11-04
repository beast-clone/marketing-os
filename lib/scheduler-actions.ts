import type { SupabaseClient } from "@supabase/supabase-js";
import { NOT_PUBLISHING, freshPublishState } from "@/lib/scheduler-lock";
import { logQueueAction, istTime } from "@/lib/publish-history";
import { trashTasks } from "@/lib/task-trash";
import { FRAME_STEP_MS } from "@/lib/scheduler-enqueue";

// Unschedule / reschedule / retry a queued post — shared by the Scheduler's routes and
// the Claude connector (4 Nov 2026), so both do exactly the same thing. Callers check
// who may act on which page first. `false` = nothing changed: the post is gone, or the
// publisher is sending it right now (callers say which, e.g. scheduler-lock notUpdated).

/** Out of the queue and back to "Ready to schedule". Its Story / extra story frames
 *  go to the recycle bin unless already out (a Story left queued would post alone). */
export async function unschedulePost(sb: SupabaseClient, id: string, actor: string, reason?: string): Promise<boolean> {
  const { data: was } = await sb.from("mh_posts").select("publish_status, schedule_time, custom").eq("id", id).maybeSingle();
  const { data, error } = await sb.from("mh_posts")
    // failure_reason too: a failed post sent back to be fixed starts clean (22 Oct).
    .update({ publish_status: null, schedule_time: null, failure_reason: null, custom: freshPublishState(was?.custom) })
    .eq("id", id).or(NOT_PUBLISHING).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) return false;
  await logQueueAction(sb, id, "removed_from_queue", was?.publish_status || null, null, reason?.trim() ? reason.trim().slice(0, 300) : undefined);
  const { data: stories } = await sb.from("mh_posts").select("id, publish_status").eq("custom->>story_of", id);
  const open = (stories || []).filter((s) => s.publish_status !== "published" && s.publish_status !== "publishing").map((s) => s.id);
  if (open.length) await trashTasks(sb, open, actor);
  return true;
}

/** A new time. Its Story moves with it; a multi-frame story's frames keep their order. */
export async function reschedulePost(sb: SupabaseClient, id: string, iso: string): Promise<boolean> {
  const { data: was } = await sb.from("mh_posts").select("schedule_time, custom").eq("id", id).maybeSingle();
  const { data, error } = await sb.from("mh_posts")
    // A failed post rescheduled must not go back to its old (failed) upload or carry
    // its old try count; what already went out stays marked so it isn't re-posted.
    .update({ schedule_time: new Date(iso).toISOString(), publish_status: "scheduled", failure_reason: null, custom: freshPublishState(was?.custom) })
    .eq("id", id).or(NOT_PUBLISHING).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) return false;
  await logQueueAction(sb, id, "publish_rescheduled", istTime(was?.schedule_time), istTime(iso));
  const { data: linked } = await sb.from("mh_posts").select("id, custom").eq("custom->>story_of", id).eq("publish_status", "scheduled");
  const base = new Date(iso).getTime();
  for (const r of (linked || []) as { id: string; custom: Record<string, unknown> | null }[]) {
    const frame = Number(r.custom?.frame) || 0;
    await sb.from("mh_posts").update({ schedule_time: new Date(base + (frame > 1 ? (frame - 1) * FRAME_STEP_MS : 0)).toISOString() }).eq("id", r.id);
  }
  return true;
}

/** Try a stuck / failed post again: a fresh upload and try count, never while it's being
 *  sent, and what already went out stays marked so it isn't posted twice. */
export async function retryPost(sb: SupabaseClient, id: string): Promise<boolean> {
  const { data: cur } = await sb.from("mh_posts").select("custom").eq("id", id).maybeSingle();
  const { data, error } = await sb.from("mh_posts")
    .update({ publish_status: "scheduled", failure_reason: null, custom: freshPublishState(cur?.custom) })
    .eq("id", id).or(NOT_PUBLISHING).select("id");
  if (error) throw new Error(error.message);
  return !!data?.length;
}
