import { NextResponse } from "next/server";
import { requireCapability, requireSection } from "@/lib/api-guard";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";
import { getSessionUserId } from "@/lib/auth";
import { rosterById } from "@/lib/team-db";
import { needsDateApproval, needsDateReason } from "@/lib/permissions";
import { requestDateChange, supersedeDateChange } from "@/lib/date-approvals";
import { bustMarketingHubCache } from "@/lib/mh-cache";

export const dynamic = "force-dynamic";

// "Apply plan" from the AI Post Planner — write the AI-suggested dates into
// mh_posts.publishing_date for each post, so the team's Publishing Calendar picks
// up the whole sequence at once. Only touches publishing_date (and due_date with it).
//
// Moving a date that was already set follows the same rules as a single move
// (27 Oct wiring audit, A6 — this used to skip both): one reason for the whole plan
// when "Ask why when a date moves" is on, and each move becomes an approval request
// when "Date changes need approval" is on. A post's first date is never a move.
export async function POST(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;
  // Moving publish dates is the "Change dates" switch on Team & access.
  const __noDates = await requireCapability("reschedule");
  if (__noDates) return __noDates;

  // `why` per item: the reason the AI gave for that move (Plan with AI, 4 Nov 2026) —
  // it becomes that task's reason, so no separate reason is asked for.
  let body: { items?: { id: string; dateISO: string; why?: string }[]; reason?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const items = (Array.isArray(body.items) ? body.items : []).filter((it) => it?.id && it.dateISO && !Number.isNaN(Date.parse(it.dateISO)));
  if (items.length === 0) return NextResponse.json({ error: "items required" }, { status: 400 });

  try {
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    const me = (getSessionUserId() || "").toLowerCase();
    const who = await rosterById(me);
    const day = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : null);
    const { data: curRows, error: curErr } = await sb.from("mh_posts")
      .select("id, publishing_date, particulars, type, owner_key, created_at").in("id", items.map((it) => it.id));
    if (curErr) throw new Error(curErr.message);
    const cur = new Map((curRows || []).map((r) => [r.id as string, r]));
    const isMove = (it: { id: string; dateISO: string }) => {
      const c = cur.get(it.id);
      return !!c?.publishing_date && day(c.publishing_date as string) !== day(new Date(it.dateISO).toISOString());
    };
    const reason = String(body.reason || "").trim();
    if (items.some((it) => isMove(it) && !String(it.why || "").trim()) && needsDateReason(who) && !reason) {
      return NextResponse.json({ error: "Add a short reason for moving the dates.", gate: "reason" }, { status: 422 });
    }
    const approval = needsDateApproval(who);
    const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "unset");
    let applied = 0, pending = 0;
    for (const it of items) {
      const c = cur.get(it.id);
      if (!c) continue;
      const when = new Date(it.dateISO).toISOString();
      const moving = isMove(it);
      const why = String(it.why || "").trim().slice(0, 300) || reason;
      if (moving && approval) {
        await requestDateChange(sb, {
          postId: it.id, title: String(c.particulars || "a task"), type: (c.type as string) || undefined,
          owner: (c.owner_key as string) || undefined, createdAt: (c.created_at as string) || undefined,
          from: c.publishing_date as string, to: when, reason: why ? `AI plan · ${why}` : "AI plan", requestedBy: me || "someone",
        });
        pending++;
        continue;
      }
      const { error } = await sb
        .from("mh_posts")
        .update({
          publishing_date: when,
          due_date: when.slice(0, 10),
          planner_note: "Date set from AI plan",
          planner_note_at: new Date().toISOString(),
        })
        .eq("id", it.id);
      if (error) throw new Error(error.message);
      if (moving) {
        await supersedeDateChange(sb, it.id, me || "someone");
        await sb.from("mh_activity").insert({ post_id: it.id, actor_key: me || null, action: "rescheduled", from_value: fmt(c.publishing_date as string), to_value: fmt(when), detail: why ? `AI plan · ${why}` : "AI plan" }).then(() => {}, () => {});
      }
      applied++;
    }
    bustMarketingHubCache();
    return NextResponse.json({ ok: true, applied, pending });
  } catch (err) {
    return NextResponse.json(safeError(err, "Apply plan failed"), { status: 502 });
  }
}
