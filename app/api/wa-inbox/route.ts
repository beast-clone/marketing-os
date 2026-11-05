import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";

// WhatsApp Inbox for the official number +91 74116 54951.
// Incoming messages land in `wa_messages` through n8n "WA Inbox — receive" (see
// wa_ingest() in Supabase); replies go out through /api/wa-inbox/send.
//
//   GET /api/wa-inbox                  -> conversations, newest first
//   GET /api/wa-inbox?contact=9198...  -> that chat's messages (and marks them read)

const WINDOW_MS = 24 * 60 * 60 * 1000; // WhatsApp allows free-text replies for 24h after their last message

export async function GET(req: Request) {
  const denied = await requireSection("sales");
  if (denied) return denied;
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  const contact = new URL(req.url).searchParams.get("contact");

  try {
    if (contact) {
      const { data, error } = await db.from("wa_messages")
        .select("id, direction, kind, body, status, error, sent_by, created_at")
        .eq("contact", contact).order("created_at", { ascending: true }).limit(500);
      if (error) throw error;
      await db.from("wa_messages").update({ read_at: new Date().toISOString() })
        .eq("contact", contact).eq("direction", "in").is("read_at", null);
      return NextResponse.json({ messages: data ?? [] });
    }

    const { data, error } = await db.from("wa_messages")
      .select("contact, contact_name, direction, kind, body, read_at, created_at")
      .order("created_at", { ascending: false }).limit(3000);
    if (error) throw error;
    type Conv = { contact: string; name: string | null; last: string; lastAt: string; lastDir: string; unread: number; lastInAt: string | null; open: boolean };
    const by = new Map<string, Conv>();
    for (const m of data ?? []) {
      let c = by.get(m.contact);
      if (!c) by.set(m.contact, c = { contact: m.contact, name: null, last: m.body || `[${m.kind}]`, lastAt: m.created_at, lastDir: m.direction, unread: 0, lastInAt: null, open: false });
      if (!c.name && m.contact_name) c.name = m.contact_name;
      if (m.direction === "in") {
        if (!c.lastInAt) c.lastInAt = m.created_at;
        if (!m.read_at) c.unread++;
      }
    }
    const now = Date.now();
    const conversations = [...by.values()].map((c) => ({ ...c, open: !!c.lastInAt && now - Date.parse(c.lastInAt) < WINDOW_MS }));
    return NextResponse.json({ conversations, unread: conversations.reduce((s, c) => s + c.unread, 0) });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't load WhatsApp messages"), { status: 500 });
  }
}
