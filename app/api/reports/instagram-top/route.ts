import { NextResponse } from "next/server";
import { safeError } from "@/lib/errors";
import { requireSection } from "@/lib/api-guard";
import { instagramTop } from "@/lib/report-month";

// Best-performing Instagram content for the report, ranked by likes + comments.
//   GET /api/reports/instagram-top?from=&to=&limit=6&accountId=
export const dynamic = "force-dynamic";
const isYMD = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const win = (u: URL, defFrom: string) => ({
  to: isYMD(u.searchParams.get("to") || "") ? u.searchParams.get("to")! : new Date().toISOString().slice(0, 10),
  from: isYMD(u.searchParams.get("from") || "") ? u.searchParams.get("from")! : defFrom,
});
const last30 = () => new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);

export async function GET(req: Request) {
  const denied = await requireSection("analytics");
  if (denied) return denied;
  try {
    const u = new URL(req.url);
    const { from, to } = win(u, last30());
    const limit = Math.min(12, Math.max(1, Number(u.searchParams.get("limit")) || 6));
    return NextResponse.json(await instagramTop(from, to, limit, u.searchParams.get("accountId") || undefined));
  } catch (err) {
    return NextResponse.json(safeError(err, "Instagram top-content failed"), { status: 502 });
  }
}
