import { NextResponse } from "next/server";
import { requireSection, requireCapability } from "@/lib/api-guard";
import { getSupabase } from "@/lib/supabase";
import { NOT_PUBLISHING, notUpdated, freshPublishState } from "@/lib/scheduler-lock";
import { sendBackForReview } from "@/lib/re-review";
import { getSessionUserId } from "@/lib/auth";
import { safeError } from "@/lib/errors";

// POST /api/scheduler/set-media  { postId, mediaUrls: string[] }
// Saves directly-uploaded media (Supabase Storage URLs) onto an mh_posts row so
// the "To schedule" card shows the real thumbnail — no more Slack link.
export async function POST(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;
  // The section alone let anyone with Content past the Edit / Change dates switches (security audit, 3 Nov 2026).
  { const __noCap = await requireCapability("edit_tasks"); if (__noCap) return __noCap; }

  try {
    const { postId, mediaUrls: incoming, append } = (await req.json()) as { postId?: string; mediaUrls?: string[]; append?: boolean };
    let mediaUrls = incoming;
    if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });
    if (!Array.isArray(mediaUrls)) return NextResponse.json({ error: "mediaUrls must be an array" }, { status: 400 });

    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    // Swapping the media is a creative change: an approved / queued post goes back to
    // Content Review (lib/re-review.ts), and any upload made from the old files is dropped.
    const { data: before } = await sb.from("mh_posts").select("media_urls, publish_status").eq("id", postId).maybeSingle();
    if (before?.publish_status === "publishing") return notUpdated(sb, postId);
    // Uploading from a Scheduler card ADDS to what the post already has; it used to
    // replace the list, which dropped earlier uploads (22 Oct review).
    if (append) mediaUrls = [...new Set([...(((before?.media_urls as string[] | null) || [])), ...mediaUrls])];
    const changed = JSON.stringify(before?.media_urls || []) !== JSON.stringify(mediaUrls);
    // Out of the queue / back to review FIRST, then the new files — so there is no
    // moment where the publisher can claim the post with the unreviewed file.
    const sentBack = changed ? await sendBackForReview(sb, postId, getSessionUserId() || null, null) : false;
    const { data: cur } = await sb.from("mh_posts").select("custom").eq("id", postId).maybeSingle();
    const { data, error } = await sb
      .from("mh_posts")
      .update({ media_urls: mediaUrls.length ? mediaUrls : null, ...(changed ? { custom: freshPublishState(cur?.custom) } : {}) })
      .eq("id", postId)
      .or(NOT_PUBLISHING)   // never while the publisher is sending it
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) return notUpdated(sb, postId);

    return NextResponse.json({ ok: true, count: mediaUrls.length, sentBack });
  } catch (err) {
    return NextResponse.json(safeError(err, "Failed to save media"), { status: 502 });
  }
}
