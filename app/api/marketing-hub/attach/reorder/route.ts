import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { getSessionUserId } from "@/lib/auth";
import { NOT_PUBLISHING, freshPublishState } from "@/lib/scheduler-lock";

// POST /api/marketing-hub/attach/reorder { postId, ids }
// Saves the order a task's creatives were dragged into (Praveen, 23 Oct). That order
// is the slide order everywhere: the task, Content Review, the Scheduler and the
// published carousel. A post already in the queue gets its media in the new order and
// a fresh publish state, so the publisher re-sends it; refused while it is publishing.
export async function POST(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;
  try {
    const { postId, ids } = (await req.json()) as { postId?: string; ids?: string[] };
    if (!postId || !Array.isArray(ids) || !ids.length) return NextResponse.json({ error: "postId and ids required" }, { status: 400 });
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    const { data: post } = await sb.from("mh_posts").select("media_urls, publish_status, custom").eq("id", postId).maybeSingle();
    if (!post) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if (post.publish_status === "publishing") return NextResponse.json({ error: "This post is being published right now — try again in a minute." }, { status: 409 });

    const { data: atts } = await sb.from("mh_attachments").select("id, storage_path, kind").eq("post_id", postId).in("id", ids);
    if ((atts || []).length !== new Set(ids).size) return NextResponse.json({ error: "Some of these files aren't on this task any more — refresh and try again." }, { status: 409 });

    // Each file needs its own position, so these cannot be one statement — but
    // they are independent rows, so they go together rather than one after the
    // other. Dragging a 20-file carousel was 20 sequential round trips.
    const moved = await Promise.all(ids.map((id, i) =>
      sb.from("mh_attachments").update({ sort_order: i + 1 }).eq("id", id).eq("post_id", postId)));
    const failed = moved.find((m) => m.error);
    if (failed?.error) throw failed.error;

    // Already queued: put its media in the same order.
    const media = (post.media_urls as string[] | null) || [];
    if (media.length > 1) {
      const pathOf = new Map((atts || []).map((a) => [a.id, a.storage_path as string]));
      const ordered = ids.map((id) => pathOf.get(id)).filter((u): u is string => !!u && media.includes(u));
      const next = [...ordered, ...media.filter((u) => !ordered.includes(u))];
      if (JSON.stringify(next) !== JSON.stringify(media)) {
        await sb.from("mh_posts").update({ media_urls: next, custom: freshPublishState(post.custom) }).eq("id", postId).or(NOT_PUBLISHING);
      }
    }

    // Attachments have their own order too (Manya, 4 Nov) — say which was reordered.
    const allAttachments = (atts || []).every((a) => a.kind === "attachment");
    await sb.from("mh_activity").insert({ post_id: postId, actor_key: getSessionUserId() || null, action: allAttachments ? "attachments_reordered" : "creatives_reordered" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't save the order"), { status: 502 });
  }
}
