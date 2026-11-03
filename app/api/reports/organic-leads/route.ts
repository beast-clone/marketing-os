import { NextResponse } from "next/server";
import { safeError } from "@/lib/errors";
import { requireSection } from "@/lib/api-guard";
import { organicLeads } from "@/lib/report-month";

// Total Organic Leads by month from the CRM Lead Source (an ESTIMATE).
//   GET /api/reports/organic-leads?from=YYYY-MM-DD&to=YYYY-MM-DD
export const dynamic = "force-dynamic";
const isYMD = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const win = (u: URL, defFrom: string) => ({
  to: isYMD(u.searchParams.get("to") || "") ? u.searchParams.get("to")! : new Date().toISOString().slice(0, 10),
  from: isYMD(u.searchParams.get("from") || "") ? u.searchParams.get("from")! : defFrom,
});

export async function GET(req: Request) {
  const denied = await requireSection("sales");
  if (denied) return denied;
  try {
    const u = new URL(req.url);
    const { from, to } = win(u, "2026-06-01");
    return NextResponse.json(await organicLeads(from, to));
  } catch (err) {
    return NextResponse.json(safeError(err, "Organic-leads report failed"), { status: 502 });
  }
}
