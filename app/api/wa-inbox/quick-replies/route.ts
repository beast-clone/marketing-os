import { NextResponse } from "next/server";
import { requireSection, guardRate } from "@/lib/api-guard";
import { getSessionUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";

// The answers the team types over and over — address, fees, timings.
//
//   GET    /api/wa-inbox/quick-replies      -> the list, newest first
//   POST   /api/wa-inbox/quick-replies      -> save one   { text }
//   DELETE /api/wa-inbox/quick-replies?id=  -> remove one
//
// Anyone can add one by typing a reply in the composer and saving it, so the
// feature needs no wording agreed up front — it fills up from real use.

export async function GET() {
  const denied = await requireSection("sales");
  if (denied) return denied;
  const db = getSupabase();
  if (!db) return NextResponse.json({ replies: [] });
  const { data, error } = await db.from("wa_quick_replies")
    .select("id, text, created_by").order("created_at", { ascending: false }).limit(40);
  if (error) return NextResponse.json(safeError(error, "Couldn't load quick replies"), { status: 500 });
  return NextResponse.json({ replies: data ?? [] });
}

export async function POST(req: Request) {
  const denied = await requireSection("sales");
  if (denied) return denied;
  const limited = guardRate(req, "wa-quick-replies", 30, 60_000);
  if (limited) return limited;
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const b = await req.json().catch(() => ({}));
  const text = String(b.text || "").trim();
  if (!text) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  // Same ceiling as a WhatsApp message — a quick reply that can't be sent is no use.
  if (text.length > 4096) return NextResponse.json({ error: "Too long for a WhatsApp message" }, { status: 400 });

  // Saving the same answer twice is the obvious accident: you reuse a reply,
  // tweak nothing, and press save again. Hand back the existing one instead of
  // growing a list of duplicates.
  const { data: dupe } = await db.from("wa_quick_replies").select("id, text, created_by").eq("text", text).maybeSingle();
  if (dupe) return NextResponse.json({ reply: dupe, already: true });

  const { data, error } = await db.from("wa_quick_replies")
    .insert({ text, created_by: getSessionUserId() }).select("id, text, created_by").single();
  if (error) return NextResponse.json(safeError(error, "Couldn't save it"), { status: 500 });
  return NextResponse.json({ reply: data });
}

export async function DELETE(req: Request) {
  const denied = await requireSection("sales");
  if (denied) return denied;
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which one?" }, { status: 400 });
  const { error } = await db.from("wa_quick_replies").delete().eq("id", id);
  if (error) return NextResponse.json(safeError(error, "Couldn't remove it"), { status: 500 });
  return NextResponse.json({ ok: true });
}
