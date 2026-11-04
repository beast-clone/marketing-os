import { isVideoType } from "@/lib/mh-content-types";
import { firstWithRole, isEditor } from "@/lib/team-roles";
import { uploadTaskFile } from "@/lib/upload-task-file";
import type { NewTaskDraft, NewTaskThumbnail } from "./NewTaskForm";

// The network sequence that turns a NewTaskDraft into a real row, in the one order
// that is safe. It mirrors My Day's own create path step for step:
//
//   1. POST /create            — the row is ALWAYS created at "Content - Pending".
//   2. PATCH reference/output links, POST attachments — these need the real post id,
//      so they can only happen once the row exists.
//   3. POST collaborators      — BEFORE any status move, so a Content-Approved
//      handoff never lands on a half-built team.
//   4. PATCH status            — only if the form asked for a later status. This is
//      the ordinary status route, so the SERVER does the assigning; the form's
//      routing card only predicted it. Going through /update (rather than creating
//      at the target status) is what makes the handoff fire exactly once.
//
// Steps 2-4 are best-effort in the same sense My Day treats them: the task already
// exists and a missing collaborator is fixable by hand, whereas a failed retry that
// creates a second row is not. The result says what actually happened so the caller
// can tell the truth rather than claim a clean save.

export class CreateGateError extends Error {
  constructor(public missing: string[], public taskTitle: string) {
    super("Some required fields are missing.");
    this.name = "CreateGateError";
  }
}

export type SaveResult = {
  id: string;
  /** The status the row ended up at — the requested one, or Pending if the move failed. */
  status: string;
  /** True when a later status was asked for and the move did not go through. */
  statusMoveFailed: boolean;
  /** Set when a thumbnail was asked for: who holds it now, or null while it waits. */
  thumbnail?: { id: string; owner: string | null };
};

// Creates the companion thumbnail task and ties the two rows together.
//
// Owner: only the "Praveen" answer names one. "editor" and "ask" leave it UNOWNED on
// purpose — the editor who claims the video hasn't been decided yet, and an unowned
// row shows up in nobody's task list while still existing, so the brief can't be lost.
// It doesn't reach the claim pool either: the pool is video work, and a thumbnail is
// not a video type. See docs/THUMBNAIL_FLOW_SPEC.md.
//
// The link lives in the existing `custom` jsonb bag rather than a new column:
//   thumbnail row → custom.thumbnail_for = <video id>
//   video row     → custom.thumbnail     = { taskId, decision, type }
// `custom.thumbnail_for` is also what tells the database trigger (sql/020) to stop
// forcing this task onto Praveen — without it, an editor's thumbnail is taken away
// again the moment it passes Content - Approved.
export async function attachThumbnailTask(
  v: { thumbnail: NewTaskThumbnail; sbu: string; publishDate: string; priority: string },
  videoId: string, writerKey: string,
): Promise<{ id: string; owner: string | null } | null> {
  const thumb = v.thumbnail;
  // "The designer" option → whoever has the Designer role on the Team page.
  const owner = thumb.who === "praveen" ? firstWithRole("designer") : null;
  const res = await fetch("/api/marketing-hub/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: thumb.title,
      type: thumb.type,
      sbu: v.sbu,
      owner: owner || undefined,
      publishingDate: v.publishDate || undefined,
      dueDate: v.publishDate || undefined,
      priority: v.priority,
      content: thumb.content,
    }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { id?: string };
  if (!j.id) return null;

  await fetch("/api/marketing-hub/update", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: j.id, actor: writerKey, fields: { custom: { thumbnail_for: videoId } } }),
  }).catch(() => {});
  await fetch("/api/marketing-hub/update", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: videoId, actor: writerKey,
      fields: { custom: { thumbnail: { taskId: j.id, decision: thumb.who, type: thumb.type } } },
    }),
  }).catch(() => {});
  return { id: j.id, owner };
}

// The claim pool lists approved videos that no EDITOR owns (app/api/my-day). A
// new task starts on its creator, so a video Nikhil or Nandu files straight into
// the pool would have stayed theirs and never shown up there — while the form and
// the toast said "in the editors' claim pool" (Nandu, 13 Oct). Let go of it.
export async function releaseToPoolIfEditor(postId: string, creatorKey: string, type: string, status: string): Promise<void> {
  if (status !== "Content - Approved" || !isVideoType(type) || !isEditor(creatorKey)) return;
  await fetch("/api/marketing-hub/update", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: postId, actor: creatorKey, fields: { owner_key: null } }),
  }).catch(() => {});
}

export async function saveNewTask(draft: NewTaskDraft, writerKey: string): Promise<SaveResult> {
  const res = await fetch("/api/marketing-hub/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: draft.title,
      type: draft.type,
      sbu: draft.sbu,
      owner: writerKey,
      publishingDate: draft.publishDate || undefined,
      dueDate: draft.publishDate || undefined,
      priority: draft.priority,
      content: draft.content,
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string; missing?: unknown[]; gate?: string };
  if (!res.ok) {
    // 422 = the create completeness gate. Name the fields rather than show a
    // one-line failure, so the same missing-fields popup can be reused.
    if (res.status === 422 && Array.isArray(j.missing) && j.missing.length) {
      throw new CreateGateError(j.missing.map(String), draft.title || "This task");
    }
    throw new Error(j.error || `HTTP ${res.status}`);
  }
  const postId = j.id as string;

  // 2 — references / output the writer attached in the form.
  const fields: Record<string, unknown> = {};
  if (draft.assets.refLinks.length) fields.reference_links = draft.assets.refLinks;
  if (draft.assets.outLink) fields.output_link = draft.assets.outLink;
  if (Object.keys(fields).length) {
    await fetch("/api/marketing-hub/update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: postId, actor: writerKey, fields }),
    }).catch(() => {});
  }
  const upload = async (file: File, kind: "reference" | "creative" | "attachment" | "thumbnail") => {
    await uploadTaskFile(postId, file, kind, writerKey).catch(() => null);
  };
  for (const f of draft.assets.refFiles) await upload(f, "reference");
  for (const f of draft.assets.outFiles) await upload(f, "creative");
  for (const f of draft.assets.attFiles || []) await upload(f, "attachment");
  for (const f of draft.assets.thumbFiles || []) await upload(f, "thumbnail");   // a reel's cover

  // 3 — hand-picked collaborators, before any status move.
  if (draft.collaborators.length) {
    await fetch("/api/marketing-hub/collaborators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, memberKeys: draft.collaborators }),
    }).catch(() => {});
  }

  // 4 — filed at a later status → move it there now.
  let statusMoveFailed = false;
  if (draft.status !== "Content - Pending") {
    const moved = await fetch("/api/marketing-hub/update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: postId, actor: writerKey, fields: { status: draft.status } }),
    }).catch(() => null);
    if (!moved || !moved.ok) {
      statusMoveFailed = true;
    } else {
      await releaseToPoolIfEditor(postId, writerKey, draft.type, draft.status);
    }
  }

  // 5 — the companion thumbnail, last: the video is the thing being created, and a
  // thumbnail that fails must not cost the writer the task she just filled in.
  let thumbnail: { id: string; owner: string | null } | undefined;
  if (draft.thumbnail) {
    thumbnail = (await attachThumbnailTask(
      { thumbnail: draft.thumbnail, sbu: draft.sbu, publishDate: draft.publishDate, priority: draft.priority },
      postId, writerKey,
    )) || undefined;
  }
  return {
    id: postId,
    status: statusMoveFailed ? "Content - Pending" : draft.status,
    statusMoveFailed,
    thumbnail,
  };
}

// Settles who owns a companion thumbnail, once that is actually known — either the
// editor claimed the video and the answer was "whoever edits it", or they were asked
// and chose. Writes both halves: the owner on the thumbnail, and the decision back
// onto the video so the claim screen never asks a second time.
export async function assignThumbnail(
  thumbId: string, videoId: string, ownerKey: string, actorKey: string,
): Promise<boolean> {
  const res = await fetch("/api/marketing-hub/takeover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postId: thumbId, newOwnerKey: ownerKey }),
  }).catch(() => null);
  if (!res || !res.ok) return false;
  await fetch("/api/marketing-hub/update", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: videoId, actor: actorKey,
      fields: { custom: { thumbnail: { taskId: thumbId, decision: ownerKey } } },
    }),
  }).catch(() => {});
  return true;
}
