import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { safeError } from "@/lib/errors";
import { storeThumb } from "@/lib/thumbnail";
import { readableName } from "@/lib/attachment-name";
import { getSupabase } from "@/lib/supabase";
import { activeTeamIds } from "@/lib/team-db";
import { getSessionUserId, getSessionIsAdmin } from "@/lib/auth";
import { BUCKET, MAX_MB, UUID, asKind, mimeAllowed, mimeRefusal } from "@/lib/attach-rules";
import { sendBackForReview } from "@/lib/re-review";

// Step 2 of a task-file upload (step 1: attach/sign). The file is already in storage;
// check what actually arrived — its stored type and size, not what the browser
// claimed — and only then record it on the task. Anything that fails the check is
// deleted again, so the public bucket never keeps a file we wouldn't have accepted.
//
// POST { postId, path, filename, kind, uploadedBy? } → { attachment }
export async function POST(req: Request) {
  const VALID_KEYS = await activeTeamIds();
  const denied = await requireSection("content");
  if (denied) return denied;
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  let path = "";
  try {
    const b = (await req.json()) as { postId?: string; path?: string; filename?: string; kind?: string; uploadedBy?: string };
    const kind = asKind(b.kind);
    path = String(b.path || "");
    if (!b.postId || !UUID.test(b.postId)) return NextResponse.json({ error: "postId must be a valid task id" }, { status: 400 });
    // Only a path step 1 could have issued for this task.
    if (!path.startsWith(`mh-creatives/${b.postId}/`) || path.includes("..")) return NextResponse.json({ error: "bad path" }, { status: 400 });

    // Attribution comes from the SESSION; an admin may attribute to someone else.
    const me = (getSessionUserId() || "").toLowerCase();
    const who = getSessionIsAdmin() && b.uploadedBy ? b.uploadedBy.toLowerCase() : me;
    if (!VALID_KEYS.has(who)) return NextResponse.json({ error: "Not a recognised team member." }, { status: 400 });

    const dir = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    const { data: listed, error: listErr } = await sb.storage.from(BUCKET).list(dir, { search: name, limit: 5 });
    if (listErr) throw new Error(`check: ${listErr.message}`);
    const obj = (listed || []).find((o) => o.name === name);
    if (!obj) return NextResponse.json({ error: "The file didn't arrive — try again." }, { status: 400 });
    const meta = (obj.metadata || {}) as { mimetype?: string; size?: number };
    const mime = String(meta.mimetype || "").toLowerCase();
    const size = Number(meta.size || 0);
    if (!mimeAllowed(mime, kind) || size > MAX_MB * 1024 * 1024) {
      // Only remove a file nobody has attached yet — never one already on a task
      // (a request naming an existing file's path must not delete it, bin bypassed).
      const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const { count } = await sb.from("mh_attachments").select("id", { count: "exact", head: true }).eq("storage_path", url);
      if (!count) await sb.storage.from(BUCKET).remove([path]);
      return NextResponse.json({ error: size > MAX_MB * 1024 * 1024 ? `The limit is ${MAX_MB} MB.` : mimeRefusal(kind) }, { status: 415 });
    }

    const publicUrl = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    // The bytes went browser → storage, so they are fetched back once here to
    // make the thumbnail. Once at upload, never per view.
    const thumbUrl = await storeThumb(sb, BUCKET, path, mime);
    // The browser still sends whatever the file was called on disk, so the
    // same rule that named the object names the row.
    const { data: task } = await sb.from("mh_posts").select("particulars").eq("id", b.postId).maybeSingle();
    const { count: already } = await sb.from("mh_attachments").select("id", { count: "exact", head: true }).eq("post_id", b.postId).eq("kind", kind);
    const storedName = readableName(b.filename || name, task?.particulars, kind, (already || 0) + 1);
    const { data, error } = await sb.from("mh_attachments").insert({
      post_id: b.postId, filename: storedName, storage_path: publicUrl,
      thumb_path: thumbUrl,
      mime_type: mime || null, size_bytes: size || null, uploaded_by: who, kind,
    }).select("id, filename, storage_path, mime_type, size_bytes, uploaded_by, uploaded_at, kind").single();
    if (error) { await sb.storage.from(BUCKET).remove([path]); throw new Error(`db insert: ${error.message}`); }

    await sb.from("mh_activity").insert({ post_id: b.postId, actor_key: who, action: `${kind}_added`, to_value: storedName });
    const sentBack = kind === "creative" ? await sendBackForReview(sb, b.postId, who, storedName) : false;
    return NextResponse.json({ attachment: data, sentBack });
  } catch (err) {
    return NextResponse.json(safeError(err, "Upload failed"), { status: 502 });
  }
}
