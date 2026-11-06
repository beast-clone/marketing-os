import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";

// What a status change WOULD do, without doing it (Praveen, 6 Nov 2026).
//
//   POST /api/marketing-hub/status-preview  { id, status }
//     -> { before: { status, owner, collaborators }, after: { ... } }
//
// The database runs the real update — every trigger and Rules-page rule — inside a
// sub-transaction and rolls it back (sql/050, mh_status_preview), so the preview
// can never disagree with what saving actually does.

export async function POST(req: Request) {
  const denied = await requireSection("content");
  if (denied) return denied;
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  const b = await req.json().catch(() => ({}));
  const id = String(b.id || "");
  const status = String(b.status || "");
  if (!id || !status) return NextResponse.json({ error: "id and status required" }, { status: 400 });
  try {
    const { data, error } = await db.rpc("mh_status_preview", { p_id: id, p_status: status });
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't preview the change"), { status: 500 });
  }
}
