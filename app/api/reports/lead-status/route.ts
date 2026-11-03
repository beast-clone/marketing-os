import { NextResponse } from "next/server";
import { safeError } from "@/lib/errors";
import { requireSection } from "@/lib/api-guard";
import { leadStatus } from "@/lib/report-month";

// Lead-status grids for the monthly report — leads CREATED in the window by status and SBU.
//   GET /api/reports/lead-status?from=YYYY-MM-DD&to=YYYY-MM-DD
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
    const { from, to } = win(u, new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
    return NextResponse.json(await leadStatus(from, to));
  } catch (err) {
    return NextResponse.json(safeError(err, "Lead-status report failed"), { status: 502 });
  }
}
