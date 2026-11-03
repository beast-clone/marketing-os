import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";
import { WA_COLS, WA_STATUSES, nextOccurrence, repeatOf, type WaMessage, type WaStatus } from "@/lib/whatsapp";

// POST /api/scheduler/whatsapp/status   header  x-cron-secret: <CRON_SECRET>
//   { id, status, wa_message_id?, error? }
//
// How n8n reports back after a WAHA send. "sent" stamps sent_at; "delivered" can
// arrive later from a WAHA webhook and only updates the status. A failure carries
// its reason so the UI can show it on the row instead of a bare red pill.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const b = (await req.json().catch(() => ({}))) as { id?: string; status?: string; wa_message_id?: string; error?: string };
    const id = (b.id || "").trim();
    const status = (b.status || "").trim() as WaStatus;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    if (!WA_STATUSES.includes(status)) {
      return NextResponse.json({ error: `status must be one of: ${WA_STATUSES.join(", ")}` }, { status: 400 });
    }

    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    const patch: Record<string, unknown> = { status };
    if (b.wa_message_id) patch.wa_message_id = b.wa_message_id;
    // Keep the reason on a failure, clear a stale one when a retry works.
    patch.error = status === "failed" ? (b.error || "").slice(0, 500) || "WhatsApp send failed" : null;
    if (status === "sent" || status === "delivered") patch.sent_at = new Date().toISOString();

    const { data, error } = await sb
      .from("whatsapp_scheduled_messages")
      .update(patch).eq("id", id)
      .select(WA_COLS).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "message not found" }, { status: 404 });

    // A repeating message queues its NEXT occurrence once this one is done — one
    // row pending per series, never a calendar generated months ahead.
    //
    // A failure still queues the next one: a daily reminder that goes quiet
    // forever because WhatsApp hiccuped once is worse than a visible failed row,
    // which stays in the rail either way.
    let queuedNext: string | null = null;
    if (status === "sent" || status === "failed") {
      queuedNext = await queueNextOccurrence(sb, data);
    }

    return NextResponse.json({ ok: true, message: { id: data.id, status: data.status }, queuedNext });
  } catch (err) {
    return NextResponse.json(safeError(err, "Failed to record the status"), { status: 502 });
  }
}

/** Insert the next run of a repeating message. Returns its time, or null. */
async function queueNextOccurrence(
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  row: WaMessage,
): Promise<string | null> {
  const repeat = repeatOf(row.payload);
  if (!repeat) return null;

  const next = nextOccurrence(row.schedule_time, repeat.rule, repeat.anchorDay);
  if (!next) return null;
  if (repeat.until && next.getTime() > new Date(repeat.until).getTime()) return null;  // series over

  const at = next.toISOString();

  // n8n can report the same send twice (a retry, a webhook replay). Without this
  // the series would fork into two parallel chains.
  const { data: existing } = await sb
    .from("whatsapp_scheduled_messages")
    .select("id").eq("chat_id", row.chat_id).eq("schedule_time", at).eq("status", "scheduled").limit(1);
  if (existing && existing.length) return at;

  const { error } = await sb.from("whatsapp_scheduled_messages").insert({
    chat_id: row.chat_id, chat_label: row.chat_label,
    body: row.body, image_url: row.image_url,
    schedule_time: at, status: "scheduled",
    kind: row.kind, payload: row.payload,
    created_by: row.created_by,
  });
  if (error) return null;   // the send already succeeded; never fail the report over this
  return at;
}
