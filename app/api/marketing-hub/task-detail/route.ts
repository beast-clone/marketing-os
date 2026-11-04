import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { fetchContentCalendarBody } from "@/lib/content-calendar";
import { getSessionUserId } from "@/lib/auth";

// GET /api/marketing-hub/task-detail?id=<uuid>
// Bundles everything the My Day detail panel needs in one call:
//   - collaborators (with role + display name from mh_team_members)
//   - attachments (reference / mood-board files)
//   - comments (inline thread, most recent 20)
//   - activity (log, most recent 10)

export async function GET(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    const [collabsRes, attachRes, commentsRes, activityRes, ownerRes, teamRes, trashRes] = await Promise.all([
      sb.from("mh_post_collaborators").select("member_key, added_at").eq("post_id", id),
      sb.from("mh_attachments").select("id, filename, storage_path, mime_type, size_bytes, uploaded_by, uploaded_at, kind, sort_order").eq("post_id", id).order("sort_order", { ascending: true, nullsFirst: false }).order("uploaded_at", { ascending: true }),   // first uploaded first (22 Oct)
      sb.from("mh_comments").select("id, author_key, body, resolved, created_at").eq("post_id", id).order("created_at", { ascending: false }).limit(20),
      sb.from("mh_activity").select("id, actor_key, action, from_value, to_value, detail, created_at").eq("post_id", id).gte("created_at", new Date(Date.now() - 366 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(400),
      sb.from("mh_posts").select("owner_key, start_at, synced_to_scheduler, airtable_record_id, status, content, caption, additional_info, instagram_url, facebook_url, linkedin_url, output_link, platforms, reference_links, custom").eq("id", id).single(),
      sb.from("mh_team_members").select("key, display_name, role"),
      // Files taken off the task (still in the recycle bin) — the history shows what
      // was removed, not just a file name (Praveen, 26 Oct).
      sb.from("mh_attachments_trash").select("row").eq("row->>post_id", id).limit(200),
    ]);

    if (collabsRes.error) throw new Error(collabsRes.error.message);
    if (attachRes.error) throw new Error(attachRes.error.message);
    if (commentsRes.error) throw new Error(commentsRes.error.message);
    if (activityRes.error) throw new Error(activityRes.error.message);

    type Team = { key: string; display_name: string; role: string };
    const team = (teamRes.data as Team[] | null) || [];
    const teamMap = new Map(team.map((t) => [t.key, t]));

    // Proper-cased, because several display_names are stored lower-cased and the
    // fallback is the raw key ("nikhil"). Only all-lowercase words are capitalised, so
    // "Manya B M" survives untouched.
    const titleCase = (s: string) => s.split(" ").map((w) => (w && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
    const nameOf = (k: string | null) => titleCase((k && teamMap.get(k)?.display_name) || k || "—");
    const roleOf = (k: string | null) => (k && teamMap.get(k)?.role) || null;

    const ownerKey = ownerRes.data?.owner_key || null;

    // Writer's long-form body. The Supabase mirror rarely carries it, so when the
    // stored content is empty and we have an Airtable source row, pull it live.
    let content = (ownerRes.data?.content || "").trim();
    let notes = (ownerRes.data?.additional_info || "").trim();
    const airtableId = ownerRes.data?.airtable_record_id || null;
    if (!content && airtableId) {
      const body = await fetchContentCalendarBody(airtableId);
      if (body.content) content = body.content;
      if (!notes && body.notes) notes = body.notes;
    }
    const collabList = (collabsRes.data || []).map((c: { member_key: string; added_at: string }) => ({
      key: c.member_key,
      name: nameOf(c.member_key),
      role: roleOf(c.member_key),
      addedAt: c.added_at,
    }));

    // Prepend owner as writer/primary if not already in collab list
    const collaborators = ownerKey && !collabList.find((c) => c.key === ownerKey)
      ? [{ key: ownerKey, name: nameOf(ownerKey), role: roleOf(ownerKey) || "writer", addedAt: null as string | null }, ...collabList]
      : collabList;

    // A reel's linked thumbnail task (docs/REEL_THUMBNAIL_SPEC.md): its newest image
    // stands in for the reel's own Thumbnail box while that's empty.
    let linkedThumbnail: { storage_path: string; filename: string } | null = null;
    const thumbTask = (ownerRes.data?.custom as { thumbnail?: { taskId?: string } } | null)?.thumbnail?.taskId;
    if (typeof thumbTask === "string" && thumbTask) {
      const { data: pic } = await sb.from("mh_attachments").select("storage_path, filename").eq("post_id", thumbTask)
        .eq("kind", "creative").like("mime_type", "image/%").order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
      if (pic?.storage_path) linkedThumbnail = { storage_path: pic.storage_path as string, filename: (pic.filename as string) || "Thumbnail" };
    }

    return NextResponse.json({
      linkedThumbnail,
      content,
      caption: (ownerRes.data?.caption || "").trim(),
      notes,
      instagramUrl: ownerRes.data?.instagram_url || "",
      facebookUrl: ownerRes.data?.facebook_url || "",
      linkedinUrl: ownerRes.data?.linkedin_url || "",
      outputLink: ownerRes.data?.output_link || "",
      platforms: (ownerRes.data?.platforms as string[] | null) || [],
      // The modal edits the status, so it needs the SAVED one — the row it was
      // opened from is a snapshot of the board and goes stale the moment you change it.
      status: (ownerRes.data?.status as string | null) || null,
      referenceLinks: (ownerRes.data?.reference_links as string[] | null) || [],
      collaborators,
      attachments: attachRes.data || [],
      trashedFiles: ((trashRes.data || []) as { row: { filename?: string; storage_path?: string; mime_type?: string } }[])
        .map((t) => ({ filename: t.row?.filename || "", storage_path: t.row?.storage_path || "", mime_type: t.row?.mime_type || "" })).filter((f) => f.filename && f.storage_path),
      comments: (commentsRes.data || []).map((c: { author_key: string; body: string; resolved: boolean; created_at: string; id: string }) => ({
        ...c,
        authorName: nameOf(c.author_key),
      })),
      activity: (activityRes.data || []).map((a: { actor_key: string; action: string; from_value: string; to_value: string; detail: string; created_at: string; id: string }) => ({
        ...a,
        actorName: nameOf(a.actor_key),
      })),
      scheduler: {
        syncedToScheduler: ownerRes.data?.synced_to_scheduler || false,
        startAt: ownerRes.data?.start_at || null,
      },
      me: getSessionUserId(),
    });
  } catch (err) {
    return NextResponse.json(safeError(err, "Task detail fetch failed"), { status: 502 });
  }
}
