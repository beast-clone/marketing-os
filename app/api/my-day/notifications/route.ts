import { NextResponse } from "next/server";
import { requireSection, ownPerson } from "@/lib/api-guard";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { buildNotifs } from "@/lib/notifications";

// GET /api/my-day/notifications?person=<key>
// The live feed for My Day and the top-bar bell: the last 3 days, newest first,
// capped at 12. The rules for who hears about what live in lib/notifications.ts,
// shared with /api/notifications (the stored Notifications tab + pop-ups).
// You never get notified about your own action. Read-only.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const person = ownPerson(new URL(req.url).searchParams.get("person"));
    if (!person) return NextResponse.json({ notifs: [] });

    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const { notifs, createdNotifs } = await buildNotifs(sb, person, since);
    // Creator updates first (a few), then the usual feed — so "published" isn't cut off.
    return NextResponse.json({ notifs: [...createdNotifs.slice(0, 5), ...notifs].slice(0, 12) });
  } catch (err) {
    return NextResponse.json(safeError(err, "Failed to load notifications"), { status: 502 });
  }
}
