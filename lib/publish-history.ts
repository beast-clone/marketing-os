import type { SupabaseClient } from "@supabase/supabase-js";
import { getSessionUserId } from "@/lib/auth";

// A person's action on the publish queue, written to the task's history with who did
// it. What the publisher itself does (publishing, processing, published, failed) is
// recorded by the mh_publish_status_log trigger on mh_posts instead.
export function istTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// Outside a request (a script) there is no session to read — record no one rather
// than fail the queue change.
function actor(): string | null {
  try { return getSessionUserId() || null; } catch { return null; }
}

export async function logQueueAction(sb: SupabaseClient, postId: string, action: string, from: string | null, to: string | null, detail?: string) {
  await sb.from("mh_activity").insert({
    post_id: postId, actor_key: actor(), action,
    from_value: from, to_value: to, ...(detail ? { detail } : {}),
  }).then(() => {}, () => {});   // history must never block the queue change itself
}
