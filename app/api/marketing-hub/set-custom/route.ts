import { NextResponse } from "next/server";
import { requireSection, requireCapability } from "@/lib/api-guard";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";

// Set one custom-column value on a task. Body: { postId, key, value }
// Merges into mh_posts.custom (jsonb) so other custom values are preserved.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;
  // The section alone let anyone with Content past the Edit / Change dates switches (security audit, 3 Nov 2026).
  { const __noCap = await requireCapability("edit_tasks"); if (__noCap) return __noCap; }

  try {
    const body = (await req.json()) as { postId?: string; key?: string; value?: unknown };
    if (!body.postId || !body.key) return NextResponse.json({ error: "postId and key required" }, { status: 400 });
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    const cur = await sb.from("mh_posts").select("custom, publish_status").eq("id", body.postId).single();
    if (cur.error) throw new Error(cur.error.message);
    // The publisher writes the whole custom bag when it finishes; an edit landing in
    // the same moment would be lost (or lose what went out). Wait until it's done.
    if (cur.data?.publish_status === "publishing") return NextResponse.json({ error: "It's being published right now — try again in a minute." }, { status: 409 });
    const custom = { ...((cur.data?.custom as Record<string, unknown>) || {}) };
    if (body.value === "" || body.value === null || body.value === undefined) delete custom[body.key];
    else custom[body.key] = body.value;

    const { error } = await sb.from("mh_posts").update({ custom, updated_at: new Date().toISOString() }).eq("id", body.postId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, custom });
  } catch (e) {
    return NextResponse.json({ error: safeError(e) }, { status: 500 });
  }
}
