import { NextResponse } from "next/server";
import { requireSection, guardRate } from "@/lib/api-guard";
import { getSessionUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";

// Sends a WhatsApp reply from +91 74116 54951. The WhatsApp key lives in n8n (the
// same credential the eBook / lead workflows use), so the dashboard asks n8n
// "WA Inbox — send reply" to send it, then saves the reply in `wa_messages`.

const HOOK = process.env.WA_INBOX_SEND_URL || "https://n8n.srv1046538.hstgr.cloud/webhook/wa-inbox-send";
const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const denied = await requireSection("sales");
  if (denied) return denied;
  const limited = guardRate(req, "wa-inbox-send", 30, 60_000);
  if (limited) return limited;
  const secret = process.env.WA_INBOX_SEND_SECRET;
  const db = getSupabase();
  if (!secret || !db) return NextResponse.json({ error: "WhatsApp sending isn't configured" }, { status: 500 });

  const b = await req.json().catch(() => ({}));
  const to = String(b.to || "").replace(/\D/g, "");
  const text = String(b.text || "").trim();
  if (!to || !text) return NextResponse.json({ error: "Write a message first" }, { status: 400 });
  if (text.length > 4096) return NextResponse.json({ error: "WhatsApp messages can be at most 4096 characters" }, { status: 400 });

  try {
    // WhatsApp only allows a free-text reply within 24h of their last message.
    const { data: lastIn } = await db.from("wa_messages").select("created_at")
      .eq("contact", to).eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!lastIn || Date.now() - Date.parse(lastIn.created_at) > WINDOW_MS) {
      return NextResponse.json({ error: "More than 24 hours since their last message — WhatsApp only allows an approved template now." }, { status: 409 });
    }

    const r = await fetch(HOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-wa-inbox-secret": secret },
      body: JSON.stringify({ to, text }),
      signal: AbortSignal.timeout(20_000),
    });
    const out = await r.json().catch(() => ({}));
    const id: string | undefined = out?.messages?.[0]?.id;
    if (!r.ok || !id) {
      const why = out?.error?.message || out?.error || out?.message || `n8n answered ${r.status}`;
      return NextResponse.json({ error: `WhatsApp didn't send it: ${typeof why === "string" ? why : JSON.stringify(why)}`.slice(0, 300) }, { status: 502 });
    }
    const row = { wa_message_id: id, contact: to, direction: "out", kind: "text", body: text, status: "sent", sent_by: getSessionUserId() };
    const { data, error } = await db.from("wa_messages").insert(row).select("id, direction, kind, body, status, error, sent_by, created_at").single();
    if (error) throw error;
    return NextResponse.json({ message: data });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't send the WhatsApp message"), { status: 500 });
  }
}
