import { NextResponse } from "next/server";
import { safeError } from "@/lib/errors";
import { getSessionUserId } from "@/lib/auth";
import { rosterById } from "@/lib/team-db";
import { buildTeamReport } from "@/lib/report-team";

// Team / individual reports (lib/report-team.ts).
//   GET /api/reports/team?month=YYYY-MM → { month, people, all }
// Admins get everyone; anyone else gets only their own report (all=false).
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await rosterById(getSessionUserId());
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const month = new URL(req.url).searchParams.get("month") || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
    const r = await buildTeamReport(month, me.isAdmin ? undefined : me.id);
    return NextResponse.json({ ...r, all: me.isAdmin });
  } catch (err) {
    return NextResponse.json(safeError(err, "Team report failed"), { status: 502 });
  }
}
