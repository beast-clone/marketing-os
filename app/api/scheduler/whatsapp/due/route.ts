import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";

// GET /api/scheduler/whatsapp/due     header  x-cron-secret: <CRON_SECRET>
//
// What n8n asks for every minute: the messages whose time has come. Each row is
// claimed ("sending") as it is handed over, so a slow run can't hand the same
// message to a second run — the same guard the IG/FB publisher needed.
// The reply carries everything the WAHA node needs and nothing else — including
// `kind` (message | poll | status) so the workflow knows which WAHA call to make.
export const dynamic = "force-dynamic";

const BATCH = 20; // bounded, so one tick can never run away with the whole queue

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    // Reap anything stranded in 'sending' before handing out new work.
    //
    // This endpoint claims rows and hands them to n8n, which reports back via
    // /status. If that run dies after we respond — a WAHA error, the worker
    // restarting — nothing ever revisits the row: the next tick only claims
    // rows still 'scheduled', so a whole batch can sit in 'sending' forever,
    // unsent and unreported.
    //
    // Stranded rows go to 'failed', not back in the queue. We cannot tell from
    // here whether WAHA delivered before the run died, and re-sending a
    // broadcast to a customer list is far worse than asking someone to send it
    // again deliberately.
    const strandedBefore = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: reaped } = await sb
      .from("whatsapp_scheduled_messages")
      .update({ status: "failed", error: "Stranded in sending — the worker did not report back. Check WhatsApp before resending: it may already have gone out." })
      .eq("status", "sending").lt("schedule_time", strandedBefore)
      .select("id");

    const { data: due, error } = await sb
      .from("whatsapp_scheduled_messages")
      .select("id, chat_id, chat_label, body, image_url, schedule_time, kind, payload")
      .eq("status", "scheduled")
      .lte("schedule_time", new Date().toISOString())
      .order("schedule_time", { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(error.message);
    if (!due || !due.length) return NextResponse.json({ ok: true, count: 0, reaped: (reaped || []).length, messages: [] });

    const ids = due.map((m) => m.id);
    const { data: claimed, error: claimErr } = await sb
      .from("whatsapp_scheduled_messages")
      .update({ status: "sending" })
      .in("id", ids).eq("status", "scheduled")   // only rows still unclaimed
      .select("id");
    if (claimErr) throw new Error(claimErr.message);

    const mine = new Set((claimed || []).map((r) => r.id));
    const messages = due.filter((m) => mine.has(m.id));
    return NextResponse.json({ ok: true, count: messages.length, reaped: (reaped || []).length, messages });
  } catch (err) {
    return NextResponse.json(safeError(err, "Failed to read the due queue"), { status: 502 });
  }
}
