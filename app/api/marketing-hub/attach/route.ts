import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { activeTeamIds } from "@/lib/team-db";
import { getSessionUserId, getSessionIsAdmin } from "@/lib/auth";
import { asKind, mimeAllowed, mimeRefusal } from "@/lib/attach-rules";
import { sendBackForReview } from "@/lib/re-review";
import { trashFile } from "@/lib/file-trash";


// Allowed types live in lib/attach-rules.ts (shared with attach/sign + attach/complete,
// which every upload box now uses — this direct route is capped by the host's ~6 MB
// request limit, so it only suits small files).
// POST /api/marketing-hub/attach
// multipart/form-data:
//   postId:       string (required)
//   uploadedBy:   member key (required)
//   file:         File   (required)
//
// Uploads to the scheduler-media bucket under mh-creatives/<postId>/<uuid>-<filename>,
// then inserts a row into mh_attachments and returns it.

const MAX_MB = 25;

export async function POST(req: Request) {
  const VALID_KEYS = await activeTeamIds();   // the Team page roster, not a typed list
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const form = await req.formData();
    const postId = form.get("postId");
    const uploadedBy = form.get("uploadedBy");
    const file = form.get("file");
    // creative = the deliverable (what gets published); reference = mood-board;
    // attachment = working files that are never published.
    const kind = asKind(form.get("kind"));

    if (typeof postId !== "string" || !postId) return NextResponse.json({ error: "postId required" }, { status: 400 });
    // Attribution comes from the SESSION. It used to be read from the form, so
    // any content user could post a file as a colleague — and this is the one
    // audit trail the Marketing Hub keeps (it also writes actor_key into
    // mh_activity), i.e. exactly the record someone would consult to ask who
    // added a creative. An admin may still attribute to someone else.
    const me = (getSessionUserId() || "").toLowerCase();
    const who = getSessionIsAdmin() && typeof uploadedBy === "string" && uploadedBy ? uploadedBy.toLowerCase() : me;
    if (!VALID_KEYS.has(who)) {
      // Deliberately does not name the valid keys: the old message returned the
      // entire active roster to anyone who sent one malformed request.
      return NextResponse.json({ error: "Not a recognised team member." }, { status: 400 });
    }
    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (file.size > MAX_MB * 1024 * 1024) return NextResponse.json({ error: `file exceeds ${MAX_MB}MB` }, { status: 413 });
    const mime = (file.type || "").toLowerCase();
    if (!mimeAllowed(mime, kind)) return NextResponse.json({ error: mimeRefusal(kind) }, { status: 415 });

    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    // postId lands in the storage key — must be a UUID (blocks path traversal and
    // catches bad ids BEFORE the file is uploaded and orphaned).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(postId))) {
      return NextResponse.json({ error: "postId must be a valid task id" }, { status: 400 });
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectPath = `mh-creatives/${postId}/${Date.now()}-${safeName}`;

    const buf = Buffer.from(await file.arrayBuffer());
    const up = await sb.storage.from("scheduler-media").upload(objectPath, buf, {
      // Content-Type is what the browser acts on when the public URL is opened,
      // so it comes from the allow-list check above rather than straight from
      // whatever the uploader declared.
      contentType: mime,
      upsert: false,
    });
    if (up.error) throw new Error(`upload: ${up.error.message}`);

    const publicUrl = sb.storage.from("scheduler-media").getPublicUrl(objectPath).data.publicUrl;

    const { data, error } = await sb
      .from("mh_attachments")
      .insert({
        post_id: postId,
        filename: file.name,
        storage_path: publicUrl,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: who,
        kind,
      })
      .select("id, filename, storage_path, mime_type, size_bytes, uploaded_by, uploaded_at, kind")
      .single();

    if (error) throw new Error(`db insert: ${error.message}`);

    // Log to the task Activity feed so an upload is visible there.
    await sb.from("mh_activity").insert({
      post_id: postId,
      actor_key: who,
      action: `${kind}_added`,
      to_value: file.name,
    });
    const sentBack = kind === "creative" ? await sendBackForReview(sb, postId, who, file.name) : false;

    return NextResponse.json({ attachment: data, sentBack });
  } catch (err) {
    return NextResponse.json(safeError(err, "Upload failed"), { status: 502 });
  }
}

// DELETE /api/marketing-hub/attach?id=<uuid>
// Moves the file to the recycle bin (lib/file-trash.ts).
export async function DELETE(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    // Moved to the recycle bin, not erased: the row is kept in mh_attachments_trash
    // and the file stays in storage, so it can be restored (22 Oct).
    const gone = await trashFile(sb, id, getSessionUserId() || null);
    // Already removed (a double click, or a tile that hadn't refreshed yet) — that's
    // the outcome asked for, not an error (22 Oct: "Cannot coerce the result…").
    if (!gone) return NextResponse.json({ ok: true, alreadyGone: true });
    const row = { data: gone };

    // Log the removal to the task Activity feed.
    await sb.from("mh_activity").insert({
      post_id: row.data.post_id,
      actor_key: getSessionUserId() || null,   // who removed it, not "System"
      action: row.data.kind === "reference" || row.data.kind === "attachment" || row.data.kind === "thumbnail" ? `${row.data.kind}_removed` : "creative_removed",
      to_value: row.data.filename,
      // Why it was deleted (asked before deleting, 27 Oct) — shown in the task's history.
      ...(url.searchParams.get("reason") ? { detail: String(url.searchParams.get("reason")).slice(0, 300) } : {}),
    });
    const sentBack = row.data.kind === "reference" || row.data.kind === "attachment" || row.data.kind === "thumbnail"
      ? false : await sendBackForReview(sb, row.data.post_id, getSessionUserId() || null, row.data.filename);

    return NextResponse.json({ ok: true, sentBack });
  } catch (err) {
    return NextResponse.json(safeError(err, "Delete failed"), { status: 502 });
  }
}
