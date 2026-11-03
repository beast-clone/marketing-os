import { NextResponse } from "next/server";
import { requireSection, ownPerson } from "@/lib/api-guard";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";
import { MH_NAME } from "@/lib/mh-chat";
import { getSessionUserId } from "@/lib/auth";
import { postSlack, slackTaskLink } from "@/lib/slack";
import { activeTeamIds } from "@/lib/team-db";
import { keysWithRole } from "@/lib/team-roles";

// POST /api/my-day/swap-request
// A packed producer does NOT pick which task to move — they send their whole
// NOT-STARTED list to Manya ("swap any of these for the incoming task") and SHE
// chooses. Stored as mh_activity 'swap_requested' (detail = candidate list) so
// it persists into Manya's Requests feed (and her notifications); also posts to Slack.
// Body: { pendingId, from, candidates: [{ id, title, dur, due }] }
export const dynamic = "force-dynamic";


export async function POST(req: Request) {
  const TEAM = await activeTeamIds();   // the Team page roster, not a typed list
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const b = (await req.json()) as { pendingId?: string; from?: string; candidates?: { id: string; title: string; dur: number; due?: string }[] };
    // Your own day, or (admins) the day you have open — not any name in the body.
    const from = ownPerson(b.from);
    if (!b.pendingId || !TEAM.has(from)) return NextResponse.json({ error: "pendingId and a valid from are required" }, { status: 400 });
    const candidates = (b.candidates || [])
      .filter((c) => c && typeof c.id === "string" && typeof c.title === "string")
      .slice(0, 20)
      .map((c) => ({ id: c.id, title: String(c.title).slice(0, 140), dur: Number(c.dur) || 0, due: c.due || "" }));
    if (!candidates.length) return NextResponse.json({ error: "no candidates to offer" }, { status: 400 });

    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    const { error } = await sb.from("mh_activity").insert({
      post_id: b.pendingId,
      actor_key: from,
      action: "swap_requested",
      detail: candidates,
    });
    if (error) throw new Error(error.message);

    // Slack, not a chat DM — the DM landed in Messages in the producer's name even
    // when someone else pressed Swap on their day. Say who actually pressed it.
    try {
      const pending = await sb.from("mh_posts").select("particulars").eq("id", b.pendingId).single();
      const by = (getSessionUserId() || "").toLowerCase();
      const name = (k: string) => MH_NAME[k] || k;
      const list = candidates.map((c) => `“${c.title}”`).join(", ");
      const writerNames = keysWithRole("writer").map(name).join(" / ") || "writer";
      await postSlack(
        `🔁 *${name(from)} is packed — ${writerNames}, pick a task to move*\n` +
        `*Incoming:* <${slackTaskLink(b.pendingId)}|${pending.data?.particulars || "the queued task"}>\n` +
        `*Can swap:* ${list}` +
        (by && by !== from ? `\n_Sent by ${name(by)} from ${name(from)}'s My Day._` : ""));
    } catch { /* the ping is a courtesy */ }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(safeError(err, "Swap request failed"), { status: 502 });
  }
}
