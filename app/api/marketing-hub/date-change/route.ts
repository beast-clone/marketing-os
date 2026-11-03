import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getSupabase } from "@/lib/supabase";
import { getSessionUserId } from "@/lib/auth";
import { safeError } from "@/lib/errors";
import { bustMarketingHubCache } from "@/lib/mh-cache";
import { listPendingDateChanges, listDateChangeHistory, resolveDateChange, getDateChange } from "@/lib/date-approvals";
import { rosterById } from "@/lib/team-db";

// Publish-date change approvals.
//   GET  /api/marketing-hub/date-change              → pending requests (for the panel)
//        ?history=1 adds every approved / rejected one (the Approvals tab's History)
//        and `moves`: publish dates changed straight away, with no approval — a log
//        only, nothing to decide (Praveen, 3 Nov 2026: approval switched off for now,
//        "let it get logged"). Read from the task history's "rescheduled" entries.
//   POST /api/marketing-hub/date-change { postId, action:"approve"|"reject", actor? }
//        → approve writes the date; reject discards. Any admin may resolve, except
//          the person who asked.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireSection("content");
  if (denied) return denied;
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ requests: [] });
  try {
    const withHistory = new URL(req.url).searchParams.get("history") === "1";
    const [requests, history, moves] = await Promise.all([
      listPendingDateChanges(sb),
      withHistory ? listDateChangeHistory(sb) : Promise.resolve(undefined),
      withHistory ? listDateMoves(sb) : Promise.resolve(undefined),
    ]);
    return NextResponse.json({ requests, ...(history ? { history } : {}), ...(moves ? { moves } : {}) });
  } catch (err) {
    return NextResponse.json(safeError(err, "Could not load date-change requests"), { status: 502 });
  }
}

// The last 60 days of direct publish-date moves, newest first.
async function listDateMoves(sb: NonNullable<ReturnType<typeof getSupabase>>) {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data } = await sb.from("mh_activity").select("post_id, actor_key, from_value, to_value, detail, created_at")
    .eq("action", "rescheduled").gte("created_at", since).order("created_at", { ascending: false }).limit(300);
  const rows = (data || []) as { post_id: string; actor_key: string | null; from_value: string | null; to_value: string | null; detail: unknown; created_at: string }[];
  const ids = [...new Set(rows.map((r) => r.post_id))];
  const titles = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: posts } = await sb.from("mh_posts").select("id, particulars").in("id", ids.slice(i, i + 200));
    for (const p of (posts || []) as { id: string; particulars: string | null }[]) titles.set(p.id, p.particulars || "(no title)");
  }
  return rows.filter((r) => titles.has(r.post_id)).map((r) => ({
    postId: r.post_id, title: titles.get(r.post_id)!, from: r.from_value, to: r.to_value,
    by: r.actor_key, at: r.created_at, why: typeof r.detail === "string" ? r.detail : null,
  }));
}

export async function POST(req: Request) {
  const denied = await requireSection("content");
  if (denied) return denied;
  try {
    const body = (await req.json()) as { postId?: string; action?: "approve" | "reject"; actor?: string; note?: string };
    // Any admin approves (Praveen, 21 Oct — it was Maheen only), but not their own
    // request. Decided from the session; the `actor` pages send is ignored.
    const approver = (getSessionUserId() || "").toLowerCase();
    const who = await rosterById(approver);
    if (!who?.isAdmin) {
      return NextResponse.json({ error: "Only an admin can approve or reject publish-date changes." }, { status: 403 });
    }
    if (!body.postId || (body.action !== "approve" && body.action !== "reject")) {
      return NextResponse.json({ error: "postId and action (approve|reject) are required" }, { status: 400 });
    }
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    const pending = await getDateChange(sb, body.postId);
    if (pending && (pending.requestedBy || "").toLowerCase() === approver) {
      return NextResponse.json({ error: "You asked for this change — another admin has to approve it." }, { status: 403 });
    }

    const r = await resolveDateChange(sb, { postId: body.postId, action: body.action, approverKey: approver, note: typeof body.note === "string" ? body.note : undefined });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    bustMarketingHubCache();
    return NextResponse.json({ ok: true, request: r.request });
  } catch (err) {
    return NextResponse.json(safeError(err, "Could not resolve the date-change request"), { status: 502 });
  }
}
