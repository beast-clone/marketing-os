import type { SupabaseClient } from "@supabase/supabase-js";

// Recycle bin for Marketing Hub tasks (sql/011_task_recycle_bin.sql).
//
// A deleted task is MOVED, not erased: its mh_posts row and every child row are
// written to mh_posts_trash as a snapshot, and only once that write has succeeded
// are the live rows removed. So a failure part-way leaves the task where it was —
// never gone from both places. Restore writes the snapshot back under the same id.
//
// Child tables that reference a task (found by scanning the schema, 18 Sep 2026):
//   mh_post_collaborators · mh_attachments · mh_activity · mh_comments — kept and restored
//   mh_slack_queue — pending Slack messages; dropped, not restored (they'd be stale)
// Attachment FILES stay in storage untouched, so they come back with the task.

const KEPT = [
  ["collaborators", "mh_post_collaborators"],
  ["attachments", "mh_attachments"],
  ["activity", "mh_activity"],
  ["comments", "mh_comments"],
] as const;

export class TrashNotReady extends Error {
  constructor() {
    super("The recycle bin isn't set up yet — run sql/011_task_recycle_bin.sql in the Supabase SQL editor. Nothing was deleted.");
  }
}

// PostgREST reports a missing table as PGRST205 / 42P01 / "schema cache".
const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST205" || e.code === "42P01" || /mh_posts_trash|schema cache/i.test(e.message || ""));

export async function assertTrashReady(sb: SupabaseClient): Promise<void> {
  const { error } = await sb.from("mh_posts_trash").select("id").limit(1);
  if (missingTable(error)) throw new TrashNotReady();
  if (error) throw new Error(error.message);
}

export type TrashOutcome = { done: string[]; missing: string[]; failed: { id: string; error: string }[] };

export async function trashTasks(sb: SupabaseClient, ids: string[], actor: string): Promise<TrashOutcome> {
  await assertTrashReady(sb);
  const out: TrashOutcome = { done: [], missing: [], failed: [] };

  for (const id of ids) {
    try {
      const post = await sb.from("mh_posts").select("*").eq("id", id).maybeSingle();
      if (post.error) throw new Error(post.error.message);
      if (!post.data) { out.missing.push(id); continue; }

      const snap: Record<string, unknown> = {};
      for (const [key, table] of KEPT) {
        const r = await sb.from(table).select("*").eq("post_id", id);
        if (r.error) throw new Error(`${table}: ${r.error.message}`);
        snap[key] = r.data || [];
      }

      // 1) Snapshot into the bin. If this fails, stop — the task stays live.
      const ins = await sb.from("mh_posts_trash").upsert({
        id,
        particulars: post.data.particulars ?? null,
        airtable_record_id: post.data.airtable_record_id ?? null,
        post: post.data,
        ...snap,
        deleted_by: actor,
        deleted_at: new Date().toISOString(),
      });
      if (ins.error) throw new Error(`bin: ${ins.error.message}`);

      // 2) Only now remove the live rows. Children first, in case FKs don't cascade.
      for (const [, table] of KEPT) await sb.from(table).delete().eq("post_id", id).then(() => {}, () => {});
      await sb.from("mh_slack_queue").delete().eq("post_id", id).then(() => {}, () => {});
      const del = await sb.from("mh_posts").delete().eq("id", id);
      if (del.error) throw new Error(del.error.message);

      out.done.push(id);
    } catch (e) {
      out.failed.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export async function restoreTasks(sb: SupabaseClient, ids: string[], actor: string): Promise<TrashOutcome> {
  await assertTrashReady(sb);
  const out: TrashOutcome = { done: [], missing: [], failed: [] };

  for (const id of ids) {
    try {
      const t = await sb.from("mh_posts_trash").select("*").eq("id", id).maybeSingle();
      if (t.error) throw new Error(t.error.message);
      if (!t.data) { out.missing.push(id); continue; }

      const put = await sb.from("mh_posts").insert(t.data.post);
      if (put.error) throw new Error(/duplicate|already exists/i.test(put.error.message)
        ? "a task with this id already exists" : put.error.message);

      for (const [key, table] of KEPT) {
        const rows = (t.data[key] as unknown[]) || [];
        if (rows.length) {
          // Skip rows already there: re-inserting the task fires the rules engine,
          // which can add the same collaborator back before we do — a plain insert
          // then failed the restore halfway (4 Nov 2026).
          const r = await sb.from(table).upsert(rows, { ignoreDuplicates: true });
          if (r.error) throw new Error(`${table}: ${r.error.message}`);
        }
      }
      await sb.from("mh_activity").insert({ post_id: id, actor_key: actor, action: "restored", detail: "restored from the recycle bin" }).then(() => {}, () => {});
      await sb.from("mh_posts_trash").delete().eq("id", id);
      out.done.push(id);
    } catch (e) {
      out.failed.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

// The only permanent delete. Files in storage are left alone, as before.
/**
 * "Delete forever" from the recycle bin. It does NOT delete: it stamps the snapshot
 * as purged, which takes it out of the bin and leaves it visible only to an admin,
 * who can always recover it. There is no hard-delete path anywhere — losing a task
 * for good was the one irreversible thing in the dashboard, and it was a mis-click
 * away. See sql/019_trash_two_tier.sql.
 */
export async function purgeTasks(sb: SupabaseClient, ids: string[], actor: string): Promise<TrashOutcome> {
  await assertTrashReady(sb);
  const up = await sb.from("mh_posts_trash")
    .update({ purged_at: new Date().toISOString(), purged_by: actor })
    .in("id", ids)
    .is("purged_at", null)        // never re-stamp something already archived
    .select("id");
  // Refuse rather than fall back to the old hard delete: destroying the snapshot is
  // exactly what this change exists to prevent, so a missing migration must stop the
  // action, not quietly do the dangerous version of it.
  if (up.error && missingPurgeCols(up.error)) throw new PurgeNotReady();
  if (up.error) throw new Error(up.error.message);
  const done = (up.data || []).map((r: { id: string }) => r.id);
  return { done, missing: ids.filter((i) => !done.includes(i)), failed: [] };
}

/** Admin-only: pull an archived snapshot back into the recycle bin, ready to restore. */
export async function recoverPurged(sb: SupabaseClient, ids: string[]): Promise<TrashOutcome> {
  await assertTrashReady(sb);
  const up = await sb.from("mh_posts_trash")
    .update({ purged_at: null, purged_by: null })
    .in("id", ids)
    .not("purged_at", "is", null)
    .select("id");
  if (up.error && missingPurgeCols(up.error)) throw new PurgeNotReady();
  if (up.error) throw new Error(up.error.message);
  const done = (up.data || []).map((r: { id: string }) => r.id);
  return { done, missing: ids.filter((i) => !done.includes(i)), failed: [] };
}

export type TrashItem = {
  id: string; particulars: string | null; type: string | null; status: string | null;
  owner: string | null; sbu: string | null; publishingDate: string | null;
  deletedBy: string | null; deletedAt: string;
  purgedBy?: string | null; purgedAt?: string | null;
};

const TRASH_COLS = "id, particulars, deleted_by, deleted_at, purged_by, purged_at, type:post->>type, status:post->>status, owner:post->>owner_key, sbu:post->>sbu, publishing_date:post->>publishing_date";
// The same list without the two-tier columns, for a database where
// sql/019_trash_two_tier.sql hasn't been run yet.
const TRASH_COLS_V1 = "id, particulars, deleted_by, deleted_at, type:post->>type, status:post->>status, owner:post->>owner_key, sbu:post->>sbu, publishing_date:post->>publishing_date";

/** Postgres/PostgREST for "that column doesn't exist" — i.e. migration 019 not run. */
const missingPurgeCols = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /purged_at|purged_by/i.test(e.message || ""));

export class PurgeNotReady extends Error {
  constructor() {
    super("The two-tier recycle bin isn't set up yet — run sql/019_trash_two_tier.sql in the Supabase SQL editor. Nothing was deleted.");
  }
}

const toItem = (x: Record<string, string | null>): TrashItem => ({
  id: x.id as string, particulars: x.particulars, type: x.type, status: x.status, owner: x.owner,
  sbu: x.sbu, publishingDate: x.publishing_date, deletedBy: x.deleted_by, deletedAt: x.deleted_at as string,
  purgedBy: x.purged_by ?? null, purgedAt: x.purged_at ?? null,
});

/** The recycle bin: deleted, not yet archived. Anyone with delete_tasks sees this. */
export async function listTrash(sb: SupabaseClient): Promise<TrashItem[]> {
  await assertTrashReady(sb);
  const r = await sb.from("mh_posts_trash").select(TRASH_COLS)
    .is("purged_at", null)
    .order("deleted_at", { ascending: false });
  // Before migration 019 the columns don't exist. Fall back to the old shape so the
  // bin keeps working rather than going blank the moment this ships.
  if (r.error && missingPurgeCols(r.error)) {
    const v1 = await sb.from("mh_posts_trash").select(TRASH_COLS_V1).order("deleted_at", { ascending: false });
    if (v1.error) throw new Error(v1.error.message);
    return (v1.data || []).map(toItem);
  }
  if (r.error) throw new Error(r.error.message);
  return (r.data || []).map(toItem);
}

/** The archive: emptied from the bin, kept anyway. Admins only. */
export async function listPurged(sb: SupabaseClient): Promise<TrashItem[]> {
  await assertTrashReady(sb);
  const r = await sb.from("mh_posts_trash").select(TRASH_COLS)
    .not("purged_at", "is", null)
    .order("purged_at", { ascending: false });
  if (r.error && missingPurgeCols(r.error)) return []; // migration not run: nothing archived
  if (r.error) throw new Error(r.error.message);
  return (r.data || []).map(toItem);
}

// Airtable record ids sitting in the bin — the import skips these.
export async function trashedAirtableIds(sb: SupabaseClient): Promise<Set<string>> {
  const r = await sb.from("mh_posts_trash").select("airtable_record_id").not("airtable_record_id", "is", null);
  if (r.error) return new Set(); // bin not set up yet: nothing to skip
  return new Set((r.data || []).map((x: { airtable_record_id: string }) => x.airtable_record_id));
}
