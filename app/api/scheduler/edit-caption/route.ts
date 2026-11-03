import { NextResponse } from "next/server";
import { requireSection, requireCapability } from "@/lib/api-guard";
import { getSupabase } from "@/lib/supabase";
import { NOT_PUBLISHING, notUpdated, freshPublishState } from "@/lib/scheduler-lock";
import { safeError } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Edit a post's caption from the queue view — writes mh_posts.caption in Supabase.
export async function POST(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;
  // The section alone let anyone with Content past the Edit / Change dates switches (security audit, 3 Nov 2026).
  { const __noCap = await requireCapability("edit_tasks"); if (__noCap) return __noCap; }

  let body: { recordId?: string; caption?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.recordId || typeof body.recordId !== "string") {
    return NextResponse.json({ error: "recordId required" }, { status: 400 });
  }
  if (typeof body.caption !== "string") {
    return NextResponse.json({ error: "caption required (string)" }, { status: 400 });
  }
  if (body.caption.length > 2200) {
    return NextResponse.json({ error: "Caption exceeds 2200 char limit" }, { status: 400 });
  }

  try {
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    // The caption is baked into an Instagram upload that is waiting or sent ahead —
    // drop it, or the old caption goes out.
    const { data: cur } = await sb.from("mh_posts").select("custom").eq("id", body.recordId).maybeSingle();
    const { data, error } = await sb
      .from("mh_posts")
      .update({ caption: body.caption, custom: freshPublishState(cur?.custom) })
      .eq("id", body.recordId)
      .or(NOT_PUBLISHING)   // never while the publisher is sending it
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) return notUpdated(sb, body.recordId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(safeError(err, "Caption update failed"), { status: 502 });
  }
}
