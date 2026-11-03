import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { startRun, collect } from "@/lib/geo";
import { safeError } from "@/lib/errors";

// GEO SEO jobs for n8n (x-cron-secret: <CRON_SECRET>):
//   GET /api/cron/geo?do=weekly    Monday morning: queue every active question to the 4 AIs
//   GET /api/cron/geo?do=collect   every 10 min: pick up finished answers
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const what = new URL(req.url).searchParams.get("do");
  try {
    if (what === "weekly") return NextResponse.json(await startRun({ brandId: null, trigger: "weekly", by: null }));
    if (what === "collect") return NextResponse.json(await collect(45_000));
    return NextResponse.json({ error: "do=weekly or do=collect" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(safeError(err, "GEO job failed"), { status: 500 });
  }
}
