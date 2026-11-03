import { NextResponse } from "next/server";
import { safeError } from "@/lib/errors";
import { requireSection } from "@/lib/api-guard";
import { instagramMonth } from "@/lib/report-month";

// Instagram row for the monthly report (real Meta data).
//   GET /api/reports/instagram-month?from=YYYY-MM-DD&to=YYYY-MM-DD&accountId=
//     → { available, window, followers, followersAsOf, reach, reachFrom,
//         contentInteractions, post, reel, story, leads }
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
    return NextResponse.json(await instagramMonth(from, to, u.searchParams.get("accountId") || undefined));
  } catch (err) {
    return NextResponse.json(safeError(err, "Instagram month report failed"), { status: 502 });
  }
}
