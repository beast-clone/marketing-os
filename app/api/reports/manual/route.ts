import { NextResponse } from "next/server";
import { safeError } from "@/lib/errors";
import { requireSection } from "@/lib/api-guard";
import { getSessionUserId } from "@/lib/auth";
import { rosterById } from "@/lib/team-db";
import { getManual, setManual, MANUAL_KEYS, type ManualFields } from "@/lib/report-manual";

// The monthly report's editable narrative sections, per month.
//   GET  /api/reports/manual?month=YYYY-MM        → { month, fields }
//   (month=YYYY for the yearly report's notes; YYYY-MM~person or ~team for team reports)
//   POST /api/reports/manual  { month, patch:{field:value} }  → { month, fields }
export const dynamic = "force-dynamic";
const isMonth = (s: string) => /^\d{4}(-\d{2})?(~[a-z0-9_-]{1,40})?$/.test(s);

// Team-report notes (…~person / …~team) follow the team report's own rule — admins
// for everyone, others only their own; everything else needs the Analytics section.
async function guard(key: string): Promise<NextResponse | null> {
  const who = key.split("~")[1];
  if (!who) return requireSection("analytics");
  const me = await rosterById(getSessionUserId());
  if (me && (me.isAdmin || me.id === who)) return null;
  return NextResponse.json({ error: "Those notes belong to someone else's report." }, { status: 403 });
}

export async function GET(req: Request) {
  try {
    const month = new URL(req.url).searchParams.get("month") || "";
    const denied = await guard(month);
    if (denied) return denied;
    if (!isMonth(month)) return NextResponse.json({ error: "month=YYYY-MM (or YYYY) required" }, { status: 400 });
    return NextResponse.json({ month, fields: await getManual(month) });
  } catch (err) {
    return NextResponse.json(safeError(err, "Could not load report notes"), { status: 502 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { month?: string; patch?: Partial<ManualFields> };
    const denied = await guard(body.month || "");
    if (denied) return denied;
    if (!body.month || !isMonth(body.month)) return NextResponse.json({ error: "month=YYYY-MM (or YYYY) required" }, { status: 400 });
    const patch: Partial<ManualFields> = {};
    for (const k of MANUAL_KEYS) {
      const v = body.patch?.[k];
      if (typeof v === "string") patch[k] = v.slice(0, 8000); // cap
    }
    if (Array.isArray(body.patch?.sections)) patch.sections = body.patch.sections; // setManual cleans + caps
    const fields = await setManual(body.month, patch);
    return NextResponse.json({ month: body.month, fields });
  } catch (err) {
    return NextResponse.json(safeError(err, "Could not save report notes"), { status: 502 });
  }
}
