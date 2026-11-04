import type { SupabaseClient } from "@supabase/supabase-js";
import { sendBackForReview } from "@/lib/re-review";

// Recycle bin for task files — creatives, references, attachments (sql/mh_attachments_trash.sql).
// Removing a file from a task MOVES its row here; the file stays in storage, so
// Restore puts it back on the task exactly as it was (Praveen, 22 Oct: "whatever we
// delete on this dashboard, it should go to the recycle bin"). Same two-tier rule as
// the task bin (lib/task-trash.ts): "Delete from bin" only stamps purged_at.

export type FileTrashItem = {
  id: string; postId: string | null; postTitle: string | null; filename: string | null;
  kind: string | null; url: string | null; deletedAt: string; deletedBy: string | null;
};

/** Move one task file to the bin. Returns its snapshot, or null if it was already gone. */
export async function trashFile(sb: SupabaseClient, id: string, actor: string | null) {
  const row = await sb.from("mh_attachments").select("*").eq("id", id).maybeSingle();
  if (row.error) throw new Error(row.error.message);
  if (!row.data) return null;
  const post = row.data.post_id
    ? await sb.from("mh_posts").select("particulars").eq("id", row.data.post_id).maybeSingle()
    : { data: null };
  // 1) Snapshot into the bin; if that fails the file stays on the task.
  const ins = await sb.from("mh_attachments_trash").upsert({
    id, post_id: row.data.post_id, post_title: post.data?.particulars ?? null,
    filename: row.data.filename, kind: row.data.kind, storage_path: row.data.storage_path,
    row: row.data, deleted_by: actor, deleted_at: new Date().toISOString(), purged_at: null, purged_by: null,
  });
  if (ins.error) throw new Error(`bin: ${ins.error.message}`);
  // 2) Only now take it off the task.
  const del = await sb.from("mh_attachments").delete().eq("id", id);
  if (del.error) throw new Error(del.error.message);
  return row.data as { post_id: string; filename: string; kind: string };
}

export async function listFileTrash(sb: SupabaseClient): Promise<FileTrashItem[]> {
  const { data, error } = await sb.from("mh_attachments_trash")
    .select("id, post_id, post_title, filename, kind, storage_path, deleted_at, deleted_by")
    .is("purged_at", null).order("deleted_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    id: r.id, postId: r.post_id, postTitle: r.post_title, filename: r.filename, kind: r.kind,
    url: r.storage_path, deletedAt: r.deleted_at, deletedBy: r.deleted_by,
  }));
}

export async function restoreFiles(sb: SupabaseClient, ids: string[], actor: string) {
  const out = { done: [] as string[], failed: [] as { id: string; error: string }[] };
  for (const id of ids) {
    try {
      const t = await sb.from("mh_attachments_trash").select("row, post_id, filename, kind").eq("id", id).is("purged_at", null).maybeSingle();
      if (t.error) throw new Error(t.error.message);
      if (!t.data) throw new Error("not in the bin");
      if (!t.data.post_id) throw new Error("it isn't attached to any task");
      const live = await sb.from("mh_posts").select("id").eq("id", t.data.post_id).maybeSingle();
      if (!live.data) throw new Error("its task is deleted — restore the task first");
      const put = await sb.from("mh_attachments").insert(t.data.row);
      if (put.error) throw new Error(put.error.message);
      const gone = await sb.from("mh_attachments_trash").delete().eq("id", id);
      if (gone.error) throw new Error(`restored, but still listed in the bin: ${gone.error.message}`);
      await sb.from("mh_activity").insert({ post_id: t.data.post_id, actor_key: actor, action: "file_restored",
        to_value: t.data.filename, detail: `restored a ${t.data.kind || "file"} from the recycle bin` }).then(() => {}, () => {});
      // A creative coming back onto an approved post is a creative change like any other.
      if (t.data.kind !== "reference" && t.data.kind !== "attachment" && t.data.kind !== "thumbnail") await sendBackForReview(sb, t.data.post_id, actor, t.data.filename);
      out.done.push(id);
    } catch (e) {
      out.failed.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** Files emptied from the bin — kept anyway, for an admin to bring back. */
export async function listPurgedFiles(sb: SupabaseClient): Promise<(FileTrashItem & { purgedAt: string | null; purgedBy: string | null })[]> {
  const { data, error } = await sb.from("mh_attachments_trash")
    .select("id, post_id, post_title, filename, kind, storage_path, deleted_at, deleted_by, purged_at, purged_by")
    .not("purged_at", "is", null).order("purged_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    id: r.id, postId: r.post_id, postTitle: r.post_title, filename: r.filename, kind: r.kind,
    url: r.storage_path, deletedAt: r.deleted_at, deletedBy: r.deleted_by, purgedAt: r.purged_at, purgedBy: r.purged_by,
  }));
}

/** Admin: put an emptied file back into the bin, ready to restore. */
export async function recoverPurgedFiles(sb: SupabaseClient, ids: string[]) {
  const { data, error } = await sb.from("mh_attachments_trash")
    .update({ purged_at: null, purged_by: null }).in("id", ids).not("purged_at", "is", null).select("id");
  if (error) throw new Error(error.message);
  return { done: (data || []).map((r: { id: string }) => r.id), failed: [] as { id: string; error: string }[] };
}

export async function purgeFiles(sb: SupabaseClient, ids: string[], actor: string) {
  const { data, error } = await sb.from("mh_attachments_trash")
    .update({ purged_at: new Date().toISOString(), purged_by: actor })
    .in("id", ids).is("purged_at", null).select("id");
  if (error) throw new Error(error.message);
  return { done: (data || []).map((r: { id: string }) => r.id), failed: [] as { id: string; error: string }[] };
}
