import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";
import { getSessionUserId } from "@/lib/auth";

// Why a late or high-priority task was pushed back.
//
// Moving work that is already overdue is exactly the decision worth being able to
// look back on — so it is not blocked, it is recorded. The note lands in the task's
// own Activity feed next to every other change, which is where anyone asking
// "why didn't this go out?" is already looking.
//
//   POST { taskId, actor, reason, from, to } -> { ok: true }

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const b = (await req.json()) as { taskId?: string; actor?: string; reason?: string; from?: number; to?: number };
    const taskId = (b.taskId || "").trim();
    const reason = (b.reason || "").trim().slice(0, 500);
    if (!taskId || !reason) return NextResponse.json({ error: "taskId and reason are required" }, { status: 400 });
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "no db" }, { status: 500 });

    await sb.from("mh_activity").insert({
      post_id: taskId,
      actor_key: (getSessionUserId() || "").toLowerCase() || null,   // the session, not the body (security audit, 3 Nov 2026)
      action: "plan_moved",
      from_value: typeof b.from === "number" ? `position ${b.from + 1}` : null,
      to_value: `position ${(b.to ?? 0) + 1} — ${reason}`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(safeError(err, "could not record the reason"), { status: 502 });
  }
}
