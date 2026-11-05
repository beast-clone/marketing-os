import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { getSessionUserId } from "@/lib/auth";
import { BUCKET, MAX_MB, UUID, asKind, mimeAllowed, mimeRefusal, safeName } from "@/lib/attach-rules";
import { readableName } from "@/lib/attachment-name";

// Step 1 of a task-file upload: check it, then hand back a one-time upload URL so the
// browser sends the file STRAIGHT to storage. Going through this server capped every
// upload at Netlify's ~6 MB request limit — a carousel PDF failed with no reason given
// (Praveen, 21 Oct). Step 2 is attach/complete, which records it on the task.
//
// POST { postId, filename, mime, size, kind } → { path, signedUrl }
export async function POST(req: Request) {
  const denied = await requireSection("content");
  if (denied) return denied;
  try {
    if (!getSessionUserId()) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const b = (await req.json()) as { postId?: string; filename?: string; mime?: string; size?: number; kind?: string };
    const kind = asKind(b.kind);
    if (!b.postId || !UUID.test(b.postId)) return NextResponse.json({ error: "postId must be a valid task id" }, { status: 400 });
    if (!b.filename) return NextResponse.json({ error: "filename required" }, { status: 400 });
    if (!mimeAllowed(b.mime || "", kind)) return NextResponse.json({ error: mimeRefusal(kind) }, { status: 415 });
    if (typeof b.size !== "number" || b.size <= 0) return NextResponse.json({ error: "size required" }, { status: 400 });
    if (b.size > MAX_MB * 1024 * 1024) return NextResponse.json({ error: `That file is ${(b.size / 1048576).toFixed(0)} MB — the limit is ${MAX_MB} MB. Share a Drive link instead.` }, { status: 413 });

    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    // The object is named after the task, so the bucket reads as something
    // other than a wall of "15.png". attach/complete derives the same name
    // from the same inputs, so the row and the object agree.
    const { data: task } = await sb.from("mh_posts").select("particulars").eq("id", b.postId).maybeSingle();
    const { count } = await sb.from("mh_attachments").select("id", { count: "exact", head: true }).eq("post_id", b.postId).eq("kind", kind);
    const stored = readableName(b.filename, task?.particulars, kind, (count || 0) + 1);
    const path = `mh-creatives/${b.postId}/${Date.now()}-${safeName(stored)}`;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(`sign: ${error?.message || "no url"}`);
    return NextResponse.json({ path, signedUrl: data.signedUrl });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't start the upload"), { status: 502 });
  }
}
