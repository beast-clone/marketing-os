import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { getSupabase } from "@/lib/supabase";
import { sendDateChangeDaily } from "@/lib/date-approvals";

// Today's publish-date changes, one email at 9 PM IST — n8n calls this daily (the
// admin, 4 Nov 2026: no approving, just one email a day). Quiet day → no email.
//   GET /api/cron/date-change-daily   (header: x-cron-secret: <CRON_SECRET>)
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  try {
    return NextResponse.json({ ok: true, ...(await sendDateChangeDaily(sb)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
