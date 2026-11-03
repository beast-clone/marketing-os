import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getSupabase } from "@/lib/supabase";
import { saveReportSnapshot, snapshotKey } from "@/lib/report-month";

// Frozen monthly-report snapshot — the assembled live numbers for a month, saved so
// a past month is preserved once the platform APIs can no longer re-fetch it (they
// cap at ~30 days). Stored in discover_cache (no migration), key report-snapshot:<YYYY-MM>.
//   GET  /api/reports/snapshot?month=YYYY-MM   → { exists, month, savedAt, payload }
//   POST /api/reports/snapshot { month, payload }  → { ok, month, savedAt }
export const dynamic = "force-dynamic";
const isMonth = (s: string) => /^\d{4}-\d{2}$/.test(s);

export async function GET(req: Request) {
  const denied = await requireSection("analytics");
  if (denied) return denied;
  const month = new URL(req.url).searchParams.get("month") || "";
  if (!isMonth(month)) return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ exists: false, month });
  const { data } = await sb.from("discover_cache").select("payload, last_fetched").eq("cache_key", snapshotKey(month)).maybeSingle();
  return NextResponse.json({ exists: !!data, month, savedAt: data?.last_fetched ?? null, payload: data?.payload ?? null });
}

export async function POST(req: Request) {
  const denied = await requireSection("analytics");
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { month?: string; payload?: unknown };
  if (!body.month || !isMonth(body.month)) return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  const at = await saveReportSnapshot(body.month, body.payload).catch(() => null);
  if (!at) return NextResponse.json({ error: "database unavailable" }, { status: 502 });
  return NextResponse.json({ ok: true, month: body.month, savedAt: at });
}
