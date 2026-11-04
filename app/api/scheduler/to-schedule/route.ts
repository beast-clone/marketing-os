import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { pageForSbu } from "@/lib/sbu-pages";
import { fetchSbus } from "@/lib/sbus-db";

// GET /api/scheduler/to-schedule
// The "To schedule" tab: content that has cleared Content Review and is awaiting a
// publish action — mh_posts rows whose status is "Ready to Publish" (and not yet
// handed to the publish queue). "Output - Ready" no longer lands here directly:
// it waits in Content Review until a reviewer pushes it to schedule (which flips it
// to "Ready to Publish"), so nothing reaches the Scheduler until a human approves it.
// Supabase-native, no Airtable.

// Never cache — must reflect enqueue writes immediately (a just-scheduled post
// should drop off this list on the next refresh).
export const dynamic = "force-dynamic";

const READY_STATUSES = ["Ready to Publish"];

export async function GET() {
  await fetchSbus();   // brand → page comes from the database (sql/040)
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    const { data, error } = await sb
      .from("mh_posts")
      .select("id, particulars, status, sbu, type, caption, content, output_link, media_urls, publish_to, publish_to_page, publishing_date, priority, updated_at, airtable_record_id, custom")
      .in("status", READY_STATUSES)
      // don't re-list anything already pushed into the publish queue
      .is("publish_status", null)
      .order("updated_at", { ascending: false })
      .limit(200); // show the full backlog so the "Ready to schedule" count is real
                   // and decrements by one each time a post is scheduled

    if (error) throw new Error(error.message);

    // A creative may live in mh_attachments (uploaded via the detail modal), not
    // just media_urls / output_link. Content Review already treats an attachment as
    // a valid creative; the Scheduler must too, or a post that cleared review would
    // silently vanish here. Join creative attachments (kind != 'reference' — those
    // are input briefs) and treat their public URLs as schedulable media.
    const ids = (data || []).map((r) => r.id);
    const attByPost = new Map<string, string[]>();
    if (ids.length) {
      const { data: atts } = await sb
        .from("mh_attachments")
        .select("post_id, storage_path, kind")
        .in("post_id", ids)
        .not("kind", "in", "(reference,attachment,thumbnail)")   // attachments are working files, never media;
        .order("sort_order", { ascending: true, nullsFirst: false })   // the order set by dragging the tiles, then
        .order("uploaded_at", { ascending: true })   // first uploaded = first slide (22 Oct)
      for (const a of atts || []) {
        if (!a.storage_path) continue;
        const arr = attByPost.get(a.post_id) || [];
        arr.push(a.storage_path as string);
        attByPost.set(a.post_id, arr);
      }
    }

    // A reel's cover (docs/REEL_THUMBNAIL_SPEC.md): its own Thumbnail box first, then
    // the newest image on its linked thumbnail task. Newest wins in both, so a re-done
    // thumbnail replaces the old one without anyone deleting it.
    const linkOf = new Map<string, string>();
    for (const r of data || []) {
      const tid = (r.custom as { thumbnail?: { taskId?: string } } | null)?.thumbnail?.taskId;
      if (typeof tid === "string" && tid) linkOf.set(r.id, tid);
    }
    const coverOf = new Map<string, string>();
    const lookIn = [...ids, ...linkOf.values()];
    if (lookIn.length) {
      const { data: pics } = await sb
        .from("mh_attachments")
        .select("post_id, storage_path, kind, mime_type")
        .in("post_id", lookIn)
        .in("kind", ["thumbnail", "creative"])
        .like("mime_type", "image/%")
        .order("uploaded_at", { ascending: false });
      const own = new Map<string, string>(), fromTask = new Map<string, string>();
      for (const a of pics || []) {
        if (!a.storage_path) continue;
        if (a.kind === "thumbnail" && !own.has(a.post_id)) own.set(a.post_id, a.storage_path as string);
        if (a.kind === "creative" && !fromTask.has(a.post_id)) fromTask.set(a.post_id, a.storage_path as string);
      }
      for (const id of ids) {
        const c = own.get(id) || fromTask.get(linkOf.get(id) || "");
        if (c) coverOf.set(id, c);
      }
    }

    const posts = (data || [])
      // Only surface rows that actually have a creative to schedule — an uploaded
      // media file (Supabase), a creative attachment, or a legacy asset link
      // (Slack/Drive). Rows with none aren't schedulable yet, so they'd only inflate
      // the count.
      .filter((r) => ((r.media_urls as string[] | null)?.length ?? 0) > 0 || (attByPost.get(r.id)?.length ?? 0) > 0 || !!r.output_link)
      .map((r) => ({
      id: r.id,
      title: r.particulars,
      status: r.status,
      sbu: r.sbu,
      type: r.type,
      caption: r.caption,
      content: r.content,
      // media: prefer uploaded media (Supabase Storage), then creative attachments,
      // then fall back to the legacy Slack/output link until everything's migrated
      // to direct upload. All are public URLs, so publish can use mediaUrls[0].
      // Deduped: once a post has been queued, its media_urls already hold the same
      // attachment URLs, and re-opening it listed every file twice (22 Oct).
      // A task-upload URL (mh-creatives/) that's no longer attached to the task was
      // removed there — e.g. the creative swapped after a failed publish — so drop it.
      mediaUrls: [...new Set([
        ...((r.media_urls as string[] | null) || []).filter((u) => !u.includes("/mh-creatives/") || (attByPost.get(r.id) || []).includes(u)),
        ...(attByPost.get(r.id) || []),
      ])],
      coverUrl: coverOf.get(r.id) || null,
      assetLink: r.output_link || null,
      channel: r.publish_to || null,
      // the page from the primary interest (lib/sbu-pages); "" for Samvaya, which has none of ours
      defaultPage: r.publish_to_page || pageForSbu(r.sbu) || "",
      publishingDate: r.publishing_date,
      priority: r.priority,
      updatedAt: r.updated_at,
      airtableRecordId: r.airtable_record_id || null,
    }));

    return NextResponse.json({ posts, count: posts.length });
  } catch (err) {
    return NextResponse.json(safeError(err, "Failed to load to-schedule list"), { status: 502 });
  }
}
