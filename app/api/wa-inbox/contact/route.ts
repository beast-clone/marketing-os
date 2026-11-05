import { NextResponse } from "next/server";
import { requireSection, guardRate } from "@/lib/api-guard";
import { getSessionUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";
import { contactMeta, leadForNumber, EMPTY_META } from "@/lib/wa-inbox";

// What we know about one chat, and how to change it.
//
//   GET  /api/wa-inbox/contact?contact=9198…  -> { meta, lead }
//   POST /api/wa-inbox/contact                -> { meta }   (upsert)
//
// The Sales Hub lead is fetched here and not in the conversation list, because
// that is an Airtable round trip per number — fine when a chat is opened, far
// too slow across a whole inbox.

export async function GET(req: Request) {
  const denied = await requireSection("sales");
  if (denied) return denied;
  const contact = (new URL(req.url).searchParams.get("contact") || "").replace(/\D/g, "");
  if (!contact) return NextResponse.json({ error: "Which number?" }, { status: 400 });
  try {
    // In parallel: ours is a single Supabase row, theirs is Airtable over the
    // network. Run together the panel opens in the slower of the two, not both.
    const [meta, lead] = await Promise.all([contactMeta(contact), leadForNumber(contact)]);
    return NextResponse.json({ meta, lead });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't load this contact"), { status: 500 });
  }
}

const STATUSES = new Set(["open", "closed", "spam"]);

export async function POST(req: Request) {
  const denied = await requireSection("sales");
  if (denied) return denied;
  const limited = guardRate(req, "wa-inbox-contact", 60, 60_000);
  if (limited) return limited;
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const b = await req.json().catch(() => ({}));
  const contact = String(b.contact || "").replace(/\D/g, "");
  if (!contact) return NextResponse.json({ error: "Which number?" }, { status: 400 });

  // Only the fields actually sent are changed. Assigning a chat must not wipe the
  // note somebody else wrote a second earlier, so an absent key means "leave it",
  // and null means "clear it" — the two are different on purpose.
  const patch: Record<string, unknown> = { contact, updated_at: new Date().toISOString(), updated_by: getSessionUserId() };
  if ("assigned_to" in b) patch.assigned_to = b.assigned_to ? String(b.assigned_to) : null;
  if ("display_name" in b) patch.display_name = b.display_name ? String(b.display_name).slice(0, 120) : null;
  if ("note" in b) patch.note = b.note ? String(b.note).slice(0, 2000) : null;
  if ("status" in b) {
    const s = String(b.status);
    if (!STATUSES.has(s)) return NextResponse.json({ error: "Unknown status" }, { status: 400 });
    patch.status = s;
  }
  if ("labels" in b) {
    if (!Array.isArray(b.labels)) return NextResponse.json({ error: "Labels must be a list" }, { status: 400 });
    // Trimmed, de-duplicated, capped. Labels are typed by hand into a shared
    // list, so without this one stray space makes "Fees " a second label that
    // looks identical to "Fees" and filters separately.
    const labels = [...new Set(b.labels.map((l: unknown) => String(l).trim()).filter(Boolean).map((l: string) => l.slice(0, 40)))].slice(0, 12);
    patch.labels = labels;
  }

  try {
    const { data, error } = await db.from("wa_contacts").upsert(patch, { onConflict: "contact" })
      .select("contact, display_name, assigned_to, labels, note, status, updated_at, updated_by").single();
    if (error) throw error;
    return NextResponse.json({ meta: { ...EMPTY_META(contact), ...data, labels: data.labels ?? [] } });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't save this contact"), { status: 500 });
  }
}
