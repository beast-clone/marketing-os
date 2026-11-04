import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { getSupabase } from "@/lib/supabase";
import { sendDateChangeRoundup } from "@/lib/date-approvals";

// Publish-date change round-up — n8n calls this at 12:30 PM and 4 PM IST (Praveen,
// 4 Nov 2026). Emails the approvers every request still waiting that hasn't been
// emailed yet (urgent ones already went out when they were asked). Quiet → no email.
//   GET /api/cron/date-change-roundup   (header: x-cron-secret: <CRON_SECRET>)
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  try {
    return NextResponse.json({ ok: true, ...(await sendDateChangeRoundup(sb)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
