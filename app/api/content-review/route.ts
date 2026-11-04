import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";

// GET /api/content-review
// The "Content Review" queue: produced content awaiting a final human check before
// it can be scheduled. These are mh_posts rows whose status is "Output - Ready" and
// which haven't already been pushed to the publish queue. The social-media reviewer
// then either pushes to schedule (status -> "Ready to Publish", which is the ONLY
// status the Scheduler picks up) or sends it back (status -> "Incorporating Feedback").
// Supabase-native, no Airtable.
export const dynamic = "force-dynamic";

export async function GET() {
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    const { data, error } = await sb
      .from("mh_posts")
      .select(
        "id, particulars, status, sbu, type, owner_key, caption, content, output_link, media_urls, publishing_date, updated_at, custom",
      )
      .eq("status", "Output - Ready")
      // don't surface anything already handed to the publish queue
      .is("publish_status", null)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);

    // Creatives may live in the mh_attachments table (uploaded via the detail modal),
    // not just in media_urls / output_link. Join the actual creative attachments
    // (kind != 'reference' — reference images are input briefs, not the finished
    // creative) so a post whose only creative is an attachment isn't wrongly flagged
    // "no creative" and blocked from the Scheduler.
    const ids = (data || []).map((r) => r.id);
    const attByPost = new Map<string, string[]>();
    if (ids.length) {
      const { data: atts } = await sb
        .from("mh_attachments")
        .select("post_id, storage_path, kind, mime_type, uploaded_at")
        .in("post_id", ids)
        .order("sort_order", { ascending: true, nullsFirst: false })   // the order set by dragging the tiles
        .order("uploaded_at", { ascending: true })
        .not("kind", "in", "(reference,attachment,thumbnail)")   // attachments are working files, never media;
      for (const a of atts || []) {
        if (!a.storage_path) continue;
        const arr = attByPost.get(a.post_id) || [];
        arr.push(a.storage_path as string);
        attByPost.set(a.post_id, arr);
      }
    }

    const posts = (data || []).map((r) => {
      const media = (r.media_urls as string[] | null) || [];
      const attUrls = attByPost.get(r.id) || [];
      return {
        id: r.id,
        title: r.particulars,
        status: r.status,
        sbu: r.sbu,
        type: r.type,
        owner: r.owner_key,
        caption: r.caption,
        content: r.content,
        // Every finished creative is a slide — the post's media AND the files uploaded
        // as creatives. Only media_urls used to count, so an uploaded carousel showed
        // as one cropped picture (Praveen, 21 Oct). In upload order.
        mediaUrls: [...media, ...attUrls.filter((u) => !media.includes(u))],
        assetLink: r.output_link || null,
        thumbnailUrl: media[0] || attUrls[0] || null,
        // The Scheduler requires a creative, so a post with no uploaded media, no
        // legacy asset link, AND no creative attachment can be reviewed but not yet
        // pushed to schedule.
        hasCreative: media.length > 0 || !!r.output_link || attUrls.length > 0,
        publishingDate: r.publishing_date,
        updatedAt: r.updated_at,
        // Back here because its creative changed after it was approved (lib/re-review.ts).
        changedAfterApproval: ((r.custom as Record<string, unknown> | null)?.changed_after_approval as string) || null,
      };
    });

    return NextResponse.json({ posts, count: posts.length });
  } catch (err) {
    return NextResponse.json(safeError(err, "Failed to load content review queue"), { status: 502 });
  }
}
