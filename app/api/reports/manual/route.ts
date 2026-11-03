import { NextResponse } from "next/server";
import { safeError } from "@/lib/errors";
import { requireSection } from "@/lib/api-guard";
import { getManual, setManual, MANUAL_KEYS, type ManualFields } from "@/lib/report-manual";

// The monthly report's editable narrative sections, per month.
//   GET  /api/reports/manual?month=YYYY-MM        → { month, fields }
//   (month=YYYY for the yearly report's notes)
//   POST /api/reports/manual  { month, patch:{field:value} }  → { month, fields }
export const dynamic = "force-dynamic";
const isMonth = (s: string) => /^\d{4}(-\d{2})?$/.test(s);

export async function GET(req: Request) {
  const denied = await requireSection("analytics");
  if (denied) return denied;
  try {
    const month = new URL(req.url).searchParams.get("month") || "";
    if (!isMonth(month)) return NextResponse.json({ error: "month=YYYY-MM (or YYYY) required" }, { status: 400 });
    return NextResponse.json({ month, fields: await getManual(month) });
  } catch (err) {
    return NextResponse.json(safeError(err, "Could not load report notes"), { status: 502 });
  }
}

export async function POST(req: Request) {
  const denied = await requireSection("analytics");
  if (denied) return denied;
  try {
    const body = (await req.json()) as { month?: string; patch?: Partial<ManualFields> };
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
