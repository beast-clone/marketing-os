import { NextResponse } from "next/server";
import { keysWithRole } from "@/lib/team-roles";
import { requireSection } from "@/lib/api-guard";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { VIDEO_TYPES } from "@/lib/mh-content-types";
// Row mapping is shared with /api/my-day/created — see lib/my-day-task.
import { toTask, WORKING, isVideo, type Row, type RefItem, type Creative } from "@/lib/my-day-task";
import { fetchRoster } from "@/lib/team-db";
import { fetchContentTypes } from "@/lib/content-types-db";

// GET /api/my-day
// Live per-person task data for the My Day cockpit, straight from mh_posts (Beast
// Clone). Returns every pipeline task the team is actively working — plus this week's
// published rows, for the "Done · 7d" stat — mapped to the My Day card shape, and the
// editors' claim pool (approved video work anyone can grab). The client filters by the
// selected person. Supabase-native, no Airtable.
export const dynamic = "force-dynamic";


export async function GET() {
  await fetchRoster();   // fills the shared id → name map (lib/team-names.ts) for anyone new
  await fetchContentTypes();   // registers dashboard-added types into VIDEO_TYPES (sql/028)
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    const cols =
      "id, particulars, type, status, sbu, owner_key, priority, content, caption, media_urls, publishing_date, due_date, updated_at, reference_links, output_link, created_at, start_at, end_at, duration_min, custom, created_by, instagram_url, facebook_url";
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const createdSince = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const [working, doneRecent, createdRes] = await Promise.all([
      sb.from("mh_posts").select(cols).in("status", WORKING).limit(800),
      sb.from("mh_posts").select(cols).eq("status", "Published/Scheduled").gte("updated_at", since).limit(400),
      // "Created by me": everything anyone created in the last 60 days, any status
      // (incl. published) — the client keeps the viewed person's own.
      sb.from("mh_posts").select(cols).not("created_by", "is", null).gte("created_at", createdSince).order("created_at", { ascending: false }).limit(500),
    ]);
    if (working.error) throw new Error(working.error.message);
    if (doneRecent.error) throw new Error(doneRecent.error.message);

    const rows = [...(working.data || []), ...(doneRecent.data || [])] as Row[];

    // Pull reference images (mh_attachments kind='reference') for these tasks so the
    // My Day References section shows/persists the same set as the Marketing Hub modal.
    // Reference images are rare, so fetch them all (avoids a huge .in() URL over
    // ~1200 task ids) and map by post; only the tasks in view read from it.
    const refByPost = new Map<string, RefItem[]>();
    const creativeByPost = new Map<string, Creative[]>();
    const attByPost = new Map<string, Creative[]>();
    // Explicit bound: PostgREST silently caps unlimited selects (~1000 rows), which
    // would drop attachments arbitrarily as the table grows. Newest-first within the
    // cap so recent creatives always win. ponytail: 5000 flat cap — switch to a
    // per-post-id .in() filter if the table ever outgrows it.
    const { data: atts } = await sb
      .from("mh_attachments")
      .select("id, post_id, filename, storage_path, kind, sort_order, size_bytes")
      .in("kind", ["reference", "creative", "attachment", "thumbnail"])
      .order("uploaded_at", { ascending: false })
      .limit(5000);
    const orderOf = new Map<string, number>();   // the order set by dragging the tiles
    // A reel's own cover (kind 'thumbnail', docs/REEL_THUMBNAIL_SPEC.md) — newest wins.
    const thumbByPost = new Map<string, Creative>();
    (atts || []).forEach((a: { id: string; post_id: string; filename: string; storage_path: string; kind: string; sort_order: number | null; size_bytes: number | null }) => {
      if (a.sort_order != null) orderOf.set(a.id, a.sort_order);
      if (a.kind === "thumbnail") {
        if (!thumbByPost.has(a.post_id)) thumbByPost.set(a.post_id, { name: a.filename, type: "image", url: a.storage_path, attId: a.id });
      } else if (a.kind === "creative") {
        const arr = creativeByPost.get(a.post_id) || [];
        // A PDF is a document, not a picture — typed "image" it rendered as a blank tile.
        const pdf = /\.pdf($|[?#])/i.test(a.storage_path) || /\.pdf$/i.test(a.filename || "");
        // size: the 300 MB warning on a reel's video (Instagram's limit from outside its app).
        arr.push({ name: a.filename, type: pdf ? "doc" : isVideo(a.storage_path) ? "video" : "image", url: a.storage_path, attId: a.id, size: a.size_bytes ?? undefined });
        creativeByPost.set(a.post_id, arr);
      } else if (a.kind === "attachment") {
        // Working files that are never published — the task window's Attachments box.
        const arr = attByPost.get(a.post_id) || [];
        const pdf = /\.pdf($|[?#])/i.test(a.storage_path) || /\.pdf$/i.test(a.filename || "");
        arr.push({ name: a.filename, type: pdf ? "doc" : isVideo(a.storage_path) ? "video" : "image", url: a.storage_path, attId: a.id });
        attByPost.set(a.post_id, arr);
      } else {
        const arr = refByPost.get(a.post_id) || [];
        arr.push({ kind: "image", label: a.filename, url: a.storage_path, attId: a.id });
        refByPost.set(a.post_id, arr);
      }
    });
    // Read newest-first for the cap; shown oldest-first, so slide 1 is first (22 Oct).
    creativeByPost.forEach((arr) => { arr.reverse(); arr.sort((x, y) => (orderOf.get(x.attId!) ?? 1e9) - (orderOf.get(y.attId!) ?? 1e9)); });
    refByPost.forEach((arr) => arr.reverse());
    attByPost.forEach((arr) => arr.reverse());
    // Collaborators from the junction table (the approve-handoff writes here).
    const collabByPost = new Map<string, string[]>();
    if (rows.length) {
      const { data: collabs } = await sb
        .from("mh_post_collaborators")
        .select("post_id, member_key")
        .in("post_id", rows.map((r) => r.id));
      (collabs || []).forEach((c: { post_id: string; member_key: string }) => {
        const arr = collabByPost.get(c.post_id) || [];
        arr.push(c.member_key);
        collabByPost.set(c.post_id, arr);
      });
    }
    // Samvaya / other-platform work (spec §14) is split OUT here so it can never leak
    // into the GooCampus board or Manya's view — it only feeds Nandu's own section.
    const isSamvayaRow = (r: Row) => /samvaya|matrimony/i.test(r.sbu || "");
    // The linked thumbnail task's newest image stands in for an empty Thumbnail box.
    const linkedThumb = (r: Row) => {
      const tid = (r.custom as { thumbnail?: { taskId?: string } } | null)?.thumbnail?.taskId;
      return tid ? [...(creativeByPost.get(tid) || [])].reverse().find((c) => c.type === "image") || null : null;
    };
    const mk = (r: Row) => toTask(r, refByPost.get(r.id) || [], creativeByPost.get(r.id) || [], collabByPost.get(r.id) || [], attByPost.get(r.id) || [],
      { own: thumbByPost.get(r.id) || null, linked: linkedThumb(r) });
    const mainRows = rows.filter((r) => !isSamvayaRow(r));
    const tasks = mainRows.map(mk);
    // Claim pool = approved video work still up for grabs. Once an editor (Nikhil /
    // Nandu) owns it, it's been claimed — so it drops out of the pool.
    const EDITORS = new Set(keysWithRole("editor"));   // Team page role, not names
    const pool = mainRows
      .filter(
        (r) =>
          r.status === "Content - Approved" &&
          VIDEO_TYPES.has(r.type || "") &&
          !EDITORS.has((r.owner_key || "").toLowerCase()),
      )
      .map(mk);
    // Nandu's Samvaya / other-platform tasks — separate, Nandu-only.
    const samvaya = rows.filter((r) => isSamvayaRow(r) && (r.owner_key || "").toLowerCase() === "nandu").map(mk);

    if (createdRes.error) throw new Error(createdRes.error.message);
    const created = ((createdRes.data || []) as Row[]).map((r) => mk(r));
    return NextResponse.json({ tasks, pool, samvaya, created, count: tasks.length });
  } catch (err) {
    return NextResponse.json(safeError(err, "Failed to load My Day"), { status: 502 });
  }
}
