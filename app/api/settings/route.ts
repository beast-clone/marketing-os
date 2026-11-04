import { NextResponse } from "next/server";
import { isLoggedIn, getSessionIsAdmin, getSessionUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";
import { cleanSetting } from "@/lib/app-settings";

// Rules-page settings (sql/042). Anyone signed in reads them (the screens need them);
// only an admin changes them. GET → { settings, meta }; PATCH { key, value }.
export const dynamic = "force-dynamic";
const KEYS = new Set(["posting", "taskMinutes", "remindHours", "geoMonthlyUsd", "approvalEmails"]);

export async function GET() {
  if (!isLoggedIn()) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ settings: {} });
  const { data } = await sb.from("mh_settings").select("key, value, updated_at, updated_by");
  const rows = data || [];
  return NextResponse.json({
    settings: Object.fromEntries(rows.map((r) => [r.key, r.value])),
    meta: Object.fromEntries(rows.map((r) => [r.key, { at: r.updated_at, by: r.updated_by }])),
    canEdit: getSessionIsAdmin(),
  });
}

export async function PATCH(req: Request) {
  if (!isLoggedIn()) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!getSessionIsAdmin()) return NextResponse.json({ error: "Only an admin can change these." }, { status: 403 });
  try {
    const b = (await req.json()) as { key?: string; value?: unknown };
    if (!b.key || !KEYS.has(b.key)) return NextResponse.json({ error: "Unknown setting." }, { status: 400 });
    const value = cleanSetting(b.key, b.value);
    if (value === null) return NextResponse.json({ error: b.key === "approvalEmails" ? "One of those isn't a valid email address." : "Those numbers don't add up — check them and try again." }, { status: 400 });
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "no db" }, { status: 500 });
    const { error } = await sb.from("mh_settings").upsert({ key: b.key, value, updated_at: new Date().toISOString(), updated_by: getSessionUserId() || null });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(safeError(err, "Could not save"), { status: 400 });
  }
}
