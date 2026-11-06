import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getSessionUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";

// WhatsApp chats in the Recycle bin (Praveen, 6 Nov 2026).
//
//   GET  /api/wa-inbox/bin                          -> chats deleted from the inbox
//   POST /api/wa-inbox/bin { contacts: [...] }      -> restore them to the inbox
//
// Deleting for good is DELETE /api/wa-inbox/contact?contact=…&forever=1.
// A chat whose person wrote again after it was deleted is back in the inbox,
// so it is not listed here.

export async function GET() {
  const denied = await requireSection("sales");
  if (denied) return denied;
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  try {
    const { data: rows, error } = await db.from("wa_contacts")
      .select("contact, display_name, deleted_at, deleted_by")
      .not("deleted_at", "is", null).order("deleted_at", { ascending: false });
    if (error) throw error;
    const contacts = (rows ?? []).map((r) => r.contact);
    if (!contacts.length) return NextResponse.json({ items: [] });

    const { data: conv } = await db.from("wa_conversations")
      .select("contact, contact_name, last_at, last_body").in("contact", contacts);
    const byC = new Map((conv ?? []).map((c) => [c.contact, c]));
    const counts = await Promise.all(contacts.map((c) =>
      db.from("wa_messages").select("id", { count: "exact", head: true }).eq("contact", c).then((r) => r.count ?? 0)));

    const items = (rows ?? []).map((r, i) => {
      const c = byC.get(r.contact);
      return {
        contact: r.contact,
        name: r.display_name || c?.contact_name || null,
        lastBody: c?.last_body ?? null,
        lastAt: c?.last_at ?? null,
        messages: counts[i],
        deletedAt: r.deleted_at as string,
        deletedBy: r.deleted_by as string | null,
      };
    }).filter((x) => !x.lastAt || Date.parse(x.deletedAt) >= Date.parse(x.lastAt));
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't load deleted chats"), { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await requireSection("sales");
  if (denied) return denied;
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  const b = await req.json().catch(() => ({}));
  const contacts: string[] = (Array.isArray(b.contacts) ? b.contacts : []).map((c: unknown) => String(c).replace(/\D/g, "")).filter(Boolean);
  if (!contacts.length) return NextResponse.json({ error: "Which chats?" }, { status: 400 });
  try {
    const { error } = await db.from("wa_contacts")
      .update({ deleted_at: null, deleted_by: null, updated_at: new Date().toISOString(), updated_by: getSessionUserId() })
      .in("contact", contacts);
    if (error) throw error;
    return NextResponse.json({ ok: true, restored: contacts.length });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't restore those chats"), { status: 500 });
  }
}
