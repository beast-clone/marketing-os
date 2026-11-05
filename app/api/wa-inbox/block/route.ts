import { NextResponse } from "next/server";
import { requireSection, guardRate } from "@/lib/api-guard";
import { getSessionUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";

// Stop a number reaching the business number, or let it back in.
//
//   POST /api/wa-inbox/block   { contact, blocked: true | false }
//
// This is Meta's own block list on the phone number, not us hiding a chat:
// a blocked number's messages never arrive at all. Confirmed against the live
// number — GET /{phone}/block_users answers, so the API is available here.
//
// The WhatsApp token lives in n8n, so the call goes through the bridge.

const HOOK = process.env.WA_TEMPLATES_URL || "https://n8n.srv1046538.hstgr.cloud/webhook/wa-inbox-templates";

export async function POST(req: Request) {
  const denied = await requireSection("sales");
  if (denied) return denied;
  const limited = guardRate(req, "wa-block", 20, 60_000);
  if (limited) return limited;
  const db = getSupabase();
  const secret = process.env.WA_INBOX_SEND_SECRET;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  if (!secret) return NextResponse.json({ error: "WhatsApp isn't configured on this server (WA_INBOX_SEND_SECRET)." }, { status: 500 });

  const b = await req.json().catch(() => ({}));
  const contact = String(b.contact || "").replace(/\D/g, "");
  const blocked = b.blocked !== false;
  if (!contact) return NextResponse.json({ error: "Which number?" }, { status: 400 });

  try {
    const r = await fetch(HOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-wa-inbox-secret": secret },
      body: JSON.stringify({ action: blocked ? "block" : "unblock", contact }),
      signal: AbortSignal.timeout(20_000),
    });
    const out = await r.json().catch(() => ({}));
    // Meta answers with per-number results; an error there means it did not happen,
    // so don't record it as though it did.
    const failed = out?.error || out?.block_users?.failed_users?.length;
    if (!r.ok || failed) {
      const why = out?.error?.message || out?.block_users?.failed_users?.[0]?.errors?.[0]?.message || `WhatsApp answered ${r.status}`;
      return NextResponse.json({ error: `Couldn't ${blocked ? "block" : "unblock"} them: ${String(why).slice(0, 200)}` }, { status: 502 });
    }

    // Remember it, so the inbox can show it without asking Meta on every load.
    const { data, error } = await db.from("wa_contacts").upsert(
      { contact, blocked, updated_at: new Date().toISOString(), updated_by: getSessionUserId() },
      { onConflict: "contact" },
    ).select("contact, blocked").single();
    if (error) throw error;
    return NextResponse.json({ contact: data.contact, blocked: data.blocked });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't change the block"), { status: 502 });
  }
}
