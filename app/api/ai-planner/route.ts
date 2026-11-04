import { NextResponse } from "next/server";
import { requireSection, guardRate } from "@/lib/api-guard";
import { getSessionUserId } from "@/lib/auth";
import { rosterById } from "@/lib/team-db";
import { hasCapability } from "@/lib/permissions";
import { hasAI } from "@/lib/ai";
import { buildPlan } from "@/lib/ai-planner";
import { safeError } from "@/lib/errors";

// POST /api/ai-planner  { ids: string[] }  → the AI's plan for those tasks (lib/ai-planner).
// Read-only: nothing on the calendar changes. Applying goes through
// /api/post-planner/apply, which follows the date-approval and history rules.
// Only people with Change dates may run it (same as applying) — it spends AI credit.
export const dynamic = "force-dynamic";
export const maxDuration = 26;

export async function POST(req: Request) {
  const denied = await requireSection("content");
  if (denied) return denied;
  const me = await rosterById(getSessionUserId());
  if (!hasCapability(me, "reschedule")) return NextResponse.json({ error: "Planning with AI needs Change dates (Team & access)." }, { status: 403 });
  const limited = guardRate(req, "ai-planner", 10, 3_600_000);
  if (limited) return limited;
  if (!hasAI()) return NextResponse.json({ error: "AI isn't set up on this dashboard." }, { status: 503 });
  try {
    const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
    if (!ids.length) return NextResponse.json({ error: "Nothing in view to plan." }, { status: 400 });
    return NextResponse.json(await buildPlan(ids));
  } catch (err) {
    return NextResponse.json(safeError(err, "Planning failed — try again."), { status: 502 });
  }
}
