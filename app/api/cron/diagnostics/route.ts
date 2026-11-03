import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { runDiagnostics } from "@/lib/diagnostics";

// Daily diagnostics cron — point n8n at this once a day (~5 AM IST). Runs the full
// check + auto-repair and stores the report in mh_diagnostics_runs.
//   GET /api/cron/diagnostics   (header: x-cron-secret: <CRON_SECRET>)
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const report = await runDiagnostics("cron");
  return NextResponse.json({ ok: true, ranAt: report.ranAt, summary: report.summary, repairs: report.repairs.length });
}
