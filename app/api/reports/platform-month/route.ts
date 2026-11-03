import { NextResponse } from "next/server";
import { safeError } from "@/lib/errors";
import { requireSection } from "@/lib/api-guard";
import { youtubeMonth, linkedinMonth } from "@/lib/report-month";

// YouTube / LinkedIn row for the monthly report — REAL live data only
// ({ available:false } when the platform can't be reached).
//   GET /api/reports/platform-month?platform=youtube|linkedin&from=&to=&key=goocampus
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
    const key = (u.searchParams.get("key") || "goocampus").toLowerCase();
    const platform = (u.searchParams.get("platform") || "").toLowerCase();
    if (platform === "youtube") return NextResponse.json(await youtubeMonth(from, to, key));
    if (platform === "linkedin") return NextResponse.json(await linkedinMonth(from, to, key));
    return NextResponse.json({ available: false, reason: "unknown platform" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(safeError(err, "Platform month report failed"), { status: 502 });
  }
}
