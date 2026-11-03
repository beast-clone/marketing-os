import { NextResponse } from "next/server";
import { safeError } from "@/lib/errors";
import { requireSection } from "@/lib/api-guard";
import { buildYearReport } from "@/lib/report-year";

// The yearly report (lib/report-year.ts).
//   GET /api/reports/yearly?year=2026
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireSection("analytics");
  if (denied) return denied;
  try {
    const y = new URL(req.url).searchParams.get("year") || String(new Date().getFullYear());
    if (!/^\d{4}$/.test(y)) return NextResponse.json({ error: "year=YYYY required" }, { status: 400 });
    return NextResponse.json(await buildYearReport(y));
  } catch (err) {
    return NextResponse.json(safeError(err, "Yearly report failed"), { status: 502 });
  }
}
