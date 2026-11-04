import { getSupabase } from "@/lib/supabase";
import { bustMarketingHubCache } from "@/lib/mh-cache";
import { normalizeOwner } from "@/lib/task-create";
import { ALL_TYPES } from "@/lib/mh-content-types";
import { SBU_OPTIONS } from "@/lib/sbus";
import { listItems } from "@/lib/content-radar";
import { rosterById } from "@/lib/team-db";
import { needsDateApproval, needsDateReason, canPublishFromClaude, canClaude, maySchedulePage } from "@/lib/permissions";
import { trashTasks, restoreTasks as restoreFromBin } from "@/lib/task-trash";
import { unschedulePost, reschedulePost, retryPost } from "@/lib/scheduler-actions";
import { activeTeamIds } from "@/lib/team-db";
import { enqueuePost } from "@/lib/scheduler-enqueue";
import { pageForSbu } from "@/lib/sbu-pages";
import { requestDateChange, supersedeDateChange } from "@/lib/date-approvals";
import { freshPublishState } from "@/lib/scheduler-lock";
import { safeFetch } from "@/lib/ssrf";
import { BUCKET, MAX_MB, UUID, asKind, mimeAllowed, mimeRefusal, safeName } from "@/lib/attach-rules";
import { trashFile } from "@/lib/file-trash";
import { TASK_STATUSES, isTaskStatus } from "@/lib/statuses";

// The read and update half of the Claude connector.
//
// create_task alone meant Claude could put things on the board but never look at it —
// so it could not answer "what is Manya working on", and every update had to be done by
// hand in the dashboard afterwards. These give it eyes, and one carefully limited hand.
//
// Deliberately no delete. Agreed with Praveen L on 27 Sep 2026: a model that can remove
// a task is one bad instruction away from removing the wrong one, and the recycle bin is
// a dashboard feature a person should be choosing to use.

const sb = () => {
  const c = getSupabase();
  if (!c) throw new Error("Supabase not configured");
  return c;
};

/** The columns a person actually needs to see. Not select("*") — the row carries caches,
 *  attempt counters and Slack blobs that are noise in a chat reply. */
const COLS = "id, particulars, type, status, sbu, owner_key, priority, publishing_date, due_date, caption, content, instagram_url, facebook_url, linkedin_url, created_at, updated_at";

type Row = {
  id: string; particulars: string | null; type: string | null; status: string | null;
  sbu: string | null; owner_key: string | null; priority: string | null;
  publishing_date: string | null; due_date: string | null;
  caption: string | null; content: string | null;
  instagram_url: string | null; facebook_url: string | null; linkedin_url: string | null;
  created_at: string; updated_at: string | null;
};

/** One task, flattened for a chat reply. Long fields are trimmed — Claude can ask for
 *  the full text with get_task if it needs it, and a list of twenty full captions is
 *  unreadable either way. */
function brief(r: Row, origin: string, full = false) {
  const cut = (s: string | null, n: number) => (!s ? null : s.length > n ? `${s.slice(0, n)}…` : s);
  return {
    id: r.id,
    title: r.particulars,
    type: r.type,
    status: r.status,
    brand: r.sbu,
    owner: r.owner_key,
    priority: r.priority,
    publishing_date: r.publishing_date,
    due_date: r.due_date,
    caption: full ? r.caption : cut(r.caption, 160),
    content: full ? r.content : cut(r.content, 160),
    published: [r.instagram_url, r.facebook_url, r.linkedin_url].filter(Boolean),
    link: `${origin}/dashboard/preview/marketing-hub?tab=master&open=${r.id}`,
  };
}

export async function listTasks(args: Record<string, unknown>, origin: string) {
  const s = (k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : "");
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));

  let q = sb().from("mh_posts").select(COLS);
  const owner = normalizeOwner(s("owner")) || s("owner");
  if (owner) q = q.eq("owner_key", owner);
  if (s("status")) q = q.eq("status", s("status"));
  if (s("brand")) q = q.eq("sbu", s("brand"));
  if (s("type")) q = q.eq("type", s("type"));
  if (s("from")) q = q.gte("publishing_date", s("from"));
  if (s("to")) q = q.lte("publishing_date", s("to"));

  const { data, error } = await q.order("publishing_date", { ascending: true, nullsFirst: false }).limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data as Row[] | null) || [];
  return { count: rows.length, tasks: rows.map((r) => brief(r, origin)) };
}

export async function getTask(args: Record<string, unknown>, origin: string) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) throw new Error("id is required");
  const { data, error } = await sb().from("mh_posts").select(COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`No task with id ${id}.`);
  return { ...brief(data as Row, origin, true), files: await listFiles(id) };
}

export async function searchTasks(args: Record<string, unknown>, origin: string) {
  const q = typeof args.query === "string" ? args.query.trim() : "";
  if (!q) throw new Error("query is required");
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
  // Escape the PostgREST or() separators so a query containing a comma or a bracket
  // cannot break out of the filter it is embedded in.
  const safe = q.replace(/[(),*]/g, " ").trim();
  if (!safe) throw new Error("query had nothing searchable in it");
  const { data, error } = await sb()
    .from("mh_posts").select(COLS)
    .or(`particulars.ilike.%${safe}%,caption.ilike.%${safe}%,content.ilike.%${safe}%`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data as Row[] | null) || [];
  return { count: rows.length, query: q, tasks: rows.map((r) => brief(r, origin)) };
}

export async function whatsDue(args: Record<string, unknown>, origin: string) {
  const days = Math.min(30, Math.max(0, Number(args.days ?? 1)));
  // The team's day, in IST — "due tomorrow" has to mean their tomorrow.
  const istNow = Date.now() + 5.5 * 3_600_000;
  const today = new Date(istNow).toISOString().slice(0, 10);
  const until = new Date(istNow + days * 86_400_000).toISOString().slice(0, 10);

  const { data, error } = await sb()
    .from("mh_posts").select(COLS)
    .lte("publishing_date", until)
    .not("publishing_date", "is", null)
    .order("publishing_date", { ascending: true })
    .limit(60);
  if (error) throw new Error(error.message);

  const rows = (data as Row[] | null) || [];
  const done = new Set(["Published/Scheduled", "Ready to Publish"]);
  const open = rows.filter((r) => !done.has(r.status || ""));
  return {
    today, until,
    overdue: open.filter((r) => (r.publishing_date || "") < today).map((r) => brief(r, origin)),
    due: open.filter((r) => (r.publishing_date || "") >= today).map((r) => brief(r, origin)),
  };
}

// The fields Claude may change. Content and caption are here because rewriting copy is
// the point of the thing; the brand is NOT, because moving a task between brands changes
// who is accountable for it and which page it publishes to.
const UPDATABLE = ["title", "status", "publishing_date", "due_date", "priority", "owner", "caption", "content", "type"] as const;

export async function updateTask(args: Record<string, unknown>, userId: string, origin: string, via?: string) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) throw new Error("id is required");

  const s = (k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : undefined);
  const patch: Record<string, unknown> = {};

  if (s("status") !== undefined) {
    if (!isTaskStatus(s("status"))) throw new Error(`"${s("status")}" isn't a status. Use one of: ${TASK_STATUSES.join(", ")}.`);
    patch.status = s("status");
  }
  // Rename (4 Nov 2026 — "Samvaya 3 Nov · Post…" becomes "Samvaya 4 Nov · Post…" when dates move).
  if (s("title") !== undefined) {
    if (!s("title")) throw new Error("title can't be empty.");
    patch.particulars = s("title")!.slice(0, 200);
  }
  if (s("priority") !== undefined) patch.priority = s("priority");
  if (s("caption") !== undefined) patch.caption = s("caption");
  if (s("content") !== undefined) patch.content = s("content");
  if (s("type") !== undefined) {
    const t = s("type")!;
    // ALL_TYPES includes dashboard-added types; the MCP server warms it (fetchContentTypes).
    if (!ALL_TYPES.includes(t)) {
      throw new Error(`"${t}" isn't a content type. Valid: ${ALL_TYPES.join(", ")}`);
    }
    patch.type = t;
  }
  for (const [k, col] of [["publishing_date", "publishing_date"], ["due_date", "due_date"]] as const) {
    const v = s(k);
    if (v !== undefined) {
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${k} must be YYYY-MM-DD.`);
      patch[col] = v || null;
    }
  }
  if (s("owner") !== undefined) {
    const o = normalizeOwner(s("owner"));
    if (!o) throw new Error(`"${s("owner")}" isn't someone on the team.`);
    patch.owner_key = o;
  }

  if (!Object.keys(patch).length) {
    throw new Error(`Nothing to change. You can set: ${UPDATABLE.join(", ")}.`);
  }

  const before = await sb().from("mh_posts").select(COLS).eq("id", id).maybeSingle();
  if (before.error) throw new Error(before.error.message);
  if (!before.data) throw new Error(`No task with id ${id}.`);

  // The same rules the dashboard applies (22 Oct review — this tool skipped them).
  const extra = await sb().from("mh_posts").select("publish_status, custom, end_at").eq("id", id).maybeSingle();
  const ps = (extra.data?.publish_status as string | null) ?? null;
  const day = (d: unknown) => (d ? String(d).slice(0, 10) : null);
  let pending: string | null = null;
  // Moving an existing publishing date: a reason when the person's switch is on, an
  // admin's approval when theirs needs it, and due_date kept in step.
  if ("publishing_date" in patch && before.data.publishing_date && day(patch.publishing_date) !== day(before.data.publishing_date)) {
    const who = await rosterById(userId);
    const reason = s("reason") || "";
    if (needsDateReason(who) && !reason) throw new Error("Moving the publishing date needs a short reason — ask the user why and pass it as `reason`.");
    if (needsDateApproval(who)) {
      await requestDateChange(sb(), {
        postId: id, title: String(before.data.particulars || "a task"), type: before.data.type || undefined,
        owner: before.data.owner_key || undefined, createdAt: before.data.created_at || undefined,
        from: before.data.publishing_date, to: (patch.publishing_date as string | null) ?? null, reason: reason || undefined, requestedBy: userId,
      });
      pending = String(patch.publishing_date || "unset");
      delete patch.publishing_date;
    } else {
      if (!("due_date" in patch)) patch.due_date = patch.publishing_date;
      await supersedeDateChange(sb(), id, userId);
    }
  }
  // A post being published can't have its caption changed mid-way; a queued one drops
  // the upload made with the old caption.
  if ("caption" in patch && ps === "publishing") throw new Error("That post is being published right now — try again in a minute.");
  if ("caption" in patch && ps && ps !== "published" && patch.caption !== before.data.caption) patch.custom = freshPublishState(extra.data?.custom);
  // Finishing / starting work stamps the task clock, as the dashboard does.
  const DONE = new Set(["Output - Ready", "Ready to Publish", "Published/Scheduled"]);
  if (typeof patch.status === "string" && patch.status !== before.data.status) {
    if (DONE.has(patch.status) && (!extra.data?.end_at || !DONE.has(String(before.data.status)))) patch.end_at = new Date().toISOString();
    if (patch.status === "Output - In Progress") { patch.start_at = new Date().toISOString(); patch.end_at = null; }
  }
  const waiting = pending
    ? `The publishing date was NOT changed yet: moving it ${fmtDay(before.data.publishing_date)} → ${fmtDay(pending)} needs an admin's approval, so it was sent to the Approvals page. The date changes when they approve it.`
    : undefined;
  if (Object.keys(patch).length === 0 && pending) {
    return { updated: [], changes: [] as string[], pendingApproval: waiting, task: brief(before.data as Row, origin, true) };
  }

  patch.updated_at = new Date().toISOString();
  const { data, error } = await sb().from("mh_posts").update(patch).eq("id", id).select(COLS).single();
  if (error) throw new Error(error.message);

  // The trail matters more here than anywhere else in the dashboard: this is a change
  // nobody watched happen. Best-effort, because the edit is already committed and a
  // logging hiccup must not report a successful change as failed.
  try {
    const changed = Object.keys(patch).filter((k) => k !== "updated_at");
    await sb().from("mh_activity").insert({
      post_id: id, actor_key: (await rosterById(userId)) ? userId : null, action: "updated",   // connectors: named in detail.via
      to_value: changed.join(", "),
      detail: { source: "claude-connector", ...(via ? { via } : {}), fields: changed },
    });
  } catch { /* courtesy trail */ }
  bustMarketingHubCache();

  // Say what changed, from → to, so an empty or partial save can't look like success.
  const LABEL: Record<string, string> = { particulars: "title", publishing_date: "publishing date", due_date: "due date", owner_key: "owner" };
  const updated = Object.keys(patch).filter((k) => !["updated_at", "custom", "start_at", "end_at"].includes(k));
  const before0 = before.data as Record<string, unknown>;
  const changes = updated.map((k) => {
    if (k === "caption" || k === "content") return k;
    const show = (v: unknown) => (k.endsWith("_date") ? fmtDay(v) : v == null || v === "" ? "—" : String(v));
    return `${LABEL[k] || k} ${show(before0[k])} → ${show((data as Record<string, unknown>)[k])}`;
  });
  return { updated, changes, ...(waiting ? { pendingApproval: waiting } : {}), task: brief(data as Row, origin, true) };
}
const fmtDay = (d: unknown) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "no date");

/** What Content Radar is showing right now. Read-only — acting on an item is
 *  create_task's job, so that the usual rules and the activity trail still apply. */
export async function listRadar(args: Record<string, unknown>) {
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 15));
  const items = await listItems({ limit: limit * 2 });
  const MAX_AGE_DAYS = 30;
  const fresh = items.filter((i) => (Date.now() - new Date(i.publishedAt).getTime()) / 86_400_000 <= MAX_AGE_DAYS);
  return {
    count: Math.min(fresh.length, limit),
    items: fresh.slice(0, limit).map((i) => ({
      title: i.title,
      source: i.source || i.alertName,
      topic: i.primaryInterest,
      published: i.publishedAt,
      url: i.link,
      snippet: i.snippet ? i.snippet.slice(0, 200) : null,
    })),
  };
}

export const VALID_BRANDS = SBU_OPTIONS;

/* ---------------------------------------------------------------- schedule_post
 *
 * Claude scheduling or publishing a post (Praveen, 3 Nov 2026). Only for people with
 * "Publish from Claude" on (Team & access), only to their own Scheduler pages, and
 * only a post that cleared review ("Ready to Publish") or is already in the queue.
 * It goes through lib/scheduler-enqueue — the same code as the Scheduler page — so
 * the publisher, its checks and the publish history are exactly the same.
 */
export async function schedulePost(args: Record<string, unknown>, userId: string, via?: string) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  const whenRaw = typeof args.when === "string" ? args.when.trim() : "";
  if (!id) throw new Error("id is required — find the task with search_tasks first.");
  if (!whenRaw) throw new Error("when is required: \"now\", or a date and time in India time like \"2026-11-05 18:30\". Ask the user.");

  const me = await rosterById(userId);
  if (!canPublishFromClaude(me)) throw new Error("Publishing from Claude isn't switched on for you. An admin can turn on \"Publish from Claude\" for you on Team & access.");

  const { data: post } = await sb().from("mh_posts")
    .select("id, particulars, status, sbu, type, caption, media_urls, publish_status, publish_to_page, publish_to_pages, custom")
    .eq("id", id).maybeSingle();
  if (!post) throw new Error("No task with that id.");
  if (post.publish_status === "published") throw new Error("That post has already been published.");
  if (post.publish_status === "publishing") throw new Error("That post is being published right now.");
  if (post.status !== "Ready to Publish" && !post.publish_status) throw new Error(`It isn't ready yet — it's in "${post.status}". It has to clear Content Review (Ready to Publish) first.`);

  // Same media as the Scheduler shows: uploaded files, then creative attachments.
  const { data: atts } = await sb().from("mh_attachments").select("storage_path, kind")
    .eq("post_id", id).not("kind", "in", "(reference,attachment)")
    .order("sort_order", { ascending: true, nullsFirst: false }).order("uploaded_at", { ascending: true });
  const attUrls = ((atts || []) as { storage_path: string | null }[]).map((a) => a.storage_path).filter((u): u is string => !!u);
  const media = [...new Set([...((post.media_urls as string[] | null) || []).filter((u) => !u.includes("/mh-creatives/") || attUrls.includes(u)), ...attUrls])]
    .filter((u) => !/\.pdf(\?|#|$)/i.test(u));
  if (!media.length) throw new Error("It has no image or video to post — upload the creative to the task first.");

  const isStory = /story/i.test(post.type || "");
  const isVideo = (u: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u);
  const format = typeof args.format === "string" && ["post", "reel", "story"].includes(args.format) ? args.format
    : isStory ? "story" : media.length === 1 && isVideo(media[0]) ? "reel" : "post";
  if (format !== "story" && !(post.caption || "").trim()) throw new Error("It has no caption yet. Ask the user for one and set it with update_task first.");
  // Several files as a story → one story per file, in order (lib/scheduler-enqueue syncFrames).
  if (format === "story" && media.length > 10) throw new Error("A story can have at most 10 frames — this task has more.");

  const asked = Array.isArray(args.pages) ? (args.pages as unknown[]).filter((p): p is string => typeof p === "string" && !!p.trim()) : [];
  const pages = asked.length ? asked
    : (Array.isArray(post.publish_to_pages) && post.publish_to_pages.length ? post.publish_to_pages as string[]
      : [post.publish_to_page || pageForSbu(post.sbu) || ""].filter(Boolean));
  if (!pages.length) throw new Error(`No page is linked to "${post.sbu}". Ask the user which page to post to (pages).`);
  const notMine = pages.filter((p) => !maySchedulePage(me, p));
  if (notMine.length) throw new Error(`You can't post to ${notMine.join(", ")} — it isn't in your Scheduler pages on Team & access.`);

  const scheduleTimeISO = whenRaw.toLowerCase() === "now" ? "" : parseWhen(whenRaw);

  const res = await enqueuePost(sb(), {
    taskId: id, particulars: post.particulars || "Post", pages, publishToPage: pages[0],
    caption: post.caption || "", mediaUrls: media, format, sbu: post.sbu || undefined,
    scheduleTimeISO, alsoStory: args.also_story === true,
    ...(Array.isArray(args.channels) && args.channels.length ? { channels: (args.channels as unknown[]).filter((c): c is string => c === "instagram" || c === "facebook") } : {}),
  }, userId);
  if ("error" in res) throw new Error(res.error);
  await sb().from("mh_activity").insert({
    post_id: id, actor_key: userId, action: res.when === "now" ? "publish_requested" : "schedule_requested",
    to_value: res.when === "now" ? "now" : res.scheduleTime, detail: { source: "claude-connector", ...(via ? { via } : {}), pages },
  }).then(() => {}, () => {});
  bustMarketingHubCache();
  const at = new Date(res.scheduleTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return {
    title: post.particulars, format, pages,
    message: res.when === "now"
      ? `Queued to publish now to ${pages.join(", ")} — it goes live within a couple of minutes.`
      : `Scheduled for ${at} (India time) on ${pages.join(", ")}.`,
  };
}

/** A date and time in India (UTC+5:30) unless it carries its own offset; must be ahead. */
function parseWhen(whenRaw: string): string {
  const m = whenRaw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/);
  const t = m ? Date.parse(`${m[1]}T${m[2].padStart(2, "0")}:${m[3]}:00+05:30`) : Date.parse(whenRaw);
  if (!Number.isFinite(t)) throw new Error("when must be \"now\" or like \"2026-11-05 18:30\" (India time).");
  if (t < Date.now() + 60_000) throw new Error("That time has passed — use \"now\" to post straight away, or a later time.");
  return new Date(t).toISOString();
}

const ist = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null);
const idsFrom = (args: Record<string, unknown>, max: number): string[] => {
  const raw = Array.isArray(args.ids) ? args.ids : typeof args.id === "string" ? [args.id] : [];
  const ids = [...new Set((raw as unknown[]).filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()))];
  if (!ids.length) throw new Error("Give the task id(s) — find them with search_tasks first.");
  if (ids.length > max) throw new Error(`At most ${max} at a time.`);
  return ids;
};

/* ------------------------------------------------- delete / restore (4 Nov 2026)
 * Recycle bin only — never erased — and never without a reason, which is saved in the
 * task's history before it moves (so it's there again if the task is restored). Needs
 * "Delete tasks" on Team & access → Connectors and the Delete tasks permission. */
export async function deleteTasks(args: Record<string, unknown>, userId: string, via?: string) {
  const me = await rosterById(userId);
  if (!canClaude(me, "delete")) throw new Error("Deleting from Claude isn't switched on for you. An admin can turn on Connectors → Delete tasks on Team & access.");
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (reason.length < 3) throw new Error("A reason is required to delete — ask the user why, then pass it as `reason`. Nothing was deleted.");
  const ids = idsFrom(args, 50);
  const { data: rows } = await sb().from("mh_posts").select("id, particulars, publish_status").in("id", ids);
  const found = (rows || []) as { id: string; particulars: string | null; publish_status: string | null }[];
  const busy = found.filter((r) => r.publish_status === "publishing").map((r) => r.id);
  const go = found.filter((r) => !busy.includes(r.id)).map((r) => r.id);
  for (const id of go) {
    await sb().from("mh_activity").insert({ post_id: id, actor_key: userId, action: "deleted", detail: { reason: reason.slice(0, 500), source: "claude-connector", ...(via ? { via } : {}) } }).then(() => {}, () => {});
  }
  const out = go.length ? await trashTasks(sb(), go, userId) : { done: [] as string[], missing: [] as string[], failed: [] as { id: string; error: string }[] };
  bustMarketingHubCache();
  const title = (id: string) => found.find((r) => r.id === id)?.particulars || id;
  return {
    moved_to_recycle_bin: out.done.map(title),
    not_found: [...ids.filter((id) => !found.some((r) => r.id === id)), ...out.missing],
    being_published_now: busy.map(title),
    failed: out.failed.map((f) => `${title(f.id)}: ${f.error}`),
    reason,
  };
}

export async function listRecycleBin(args: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
  const { data } = await sb().from("mh_posts_trash").select("id, particulars, deleted_by, deleted_at, activity")
    .is("purged_at", null).order("deleted_at", { ascending: false }).limit(limit);
  return { count: (data || []).length, items: ((data || []) as { id: string; particulars: string | null; deleted_by: string | null; deleted_at: string; activity: { action?: string; detail?: { reason?: string } }[] | null }[]).map((r) => ({
    id: r.id, title: r.particulars, deleted_by: r.deleted_by, deleted_at: ist(r.deleted_at),
    reason: [...(r.activity || [])].reverse().find((a) => a.action === "deleted" && a.detail?.reason)?.detail?.reason || null,
  })) };
}

export async function restoreTasks(args: Record<string, unknown>, userId: string) {
  const me = await rosterById(userId);
  if (!canClaude(me, "delete")) throw new Error("Restoring from the recycle bin needs Connectors → Delete tasks on Team & access.");
  const ids = idsFrom(args, 50);
  const out = await restoreFromBin(sb(), ids, userId);
  bustMarketingHubCache();
  return { restored: out.done, not_in_bin: out.missing, failed: out.failed.map((f) => `${f.id}: ${f.error}`) };
}

/* -------------------------------------------- the Scheduler queue (4 Nov 2026) */
const QUEUE_COLS = "id, particulars, type, publish_status, schedule_time, publish_to_pages, failure_reason, custom, instagram_url, facebook_url";
export async function listQueue(args: Record<string, unknown>) {
  const want = typeof args.status === "string" && ["scheduled", "published", "failed", "draft"].includes(args.status) ? args.status : "scheduled";
  const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
  let q = sb().from("mh_posts").select(QUEUE_COLS).eq("publish_status", want);
  q = want === "published" ? q.order("schedule_time", { ascending: false }) : q.order("schedule_time", { ascending: true });
  const { data } = await q.limit(limit);
  return { status: want, count: (data || []).length, posts: ((data || []) as Record<string, unknown>[]).map((r) => {
    const c = (r.custom || {}) as Record<string, unknown>;
    return {
      id: r.id, title: r.particulars, format: c.publish_format || "post", pages: r.publish_to_pages,
      when: ist(r.schedule_time as string | null), status: r.publish_status,
      ...(c.frame ? { story_frame_of: c.story_of, frame: c.frame } : c.story_of ? { story_of: c.story_of } : {}),
      ...(r.failure_reason ? { failure: r.failure_reason } : {}),
      ...channelResults(r, c),
    };
  }) };
}

// Instagram and Facebook are sent one after the other, and either can fail on its own —
// a "failed" post may still be live on Instagram (4 Nov: the 3 Nov Samvaya post). The
// publisher marks each one as it lands (custom.ig_media_id / fb_done), so say each.
function channelResults(r: Record<string, unknown>, c: Record<string, unknown>) {
  const wanted = Array.isArray(c.channels) && c.channels.length ? (c.channels as string[]) : ["instagram", "facebook"];
  const pending = r.publish_status === "failed" ? "failed" : r.publish_status === "published" ? "published" : "waiting";
  const out: Record<string, string> = {};
  if (wanted.includes("instagram")) out.instagram = c.ig_media_id ? `published${r.instagram_url ? ` (${r.instagram_url})` : ""}` : pending;
  if (wanted.includes("facebook")) out.facebook = c.fb_done ? `published${r.facebook_url ? ` (${r.facebook_url})` : ""}` : pending;
  return out;
}

// A queued post this person may act on: Schedule & publish switched on, and every page
// it goes to is one of their Scheduler pages.
async function queuedPostFor(userId: string, id: string) {
  const me = await rosterById(userId);
  if (!canPublishFromClaude(me)) throw new Error("Scheduling from Claude isn't switched on for you. An admin can turn on Connectors → Schedule & publish on Team & access.");
  if (!id) throw new Error("id is required — find it with list_queue first.");
  const { data: post } = await sb().from("mh_posts").select("id, particulars, publish_status, schedule_time, publish_to_pages").eq("id", id).maybeSingle();
  if (!post) throw new Error("No post with that id.");
  const pages = (post.publish_to_pages as string[] | null) || [];
  const notMine = pages.filter((p) => !maySchedulePage(me, p));
  if (notMine.length) throw new Error(`You can't change posts for ${notMine.join(", ")} — it isn't in your Scheduler pages.`);
  if (post.publish_status === "publishing") throw new Error("It's being published right now — try again in a minute.");
  if (post.publish_status === "published") throw new Error("That post has already been published.");
  return post;
}

export async function unscheduleTool(args: Record<string, unknown>, userId: string) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  const post = await queuedPostFor(userId, id);
  if (!post.publish_status) throw new Error("It isn't in the queue.");
  const reason = typeof args.reason === "string" ? args.reason : undefined;
  if (!(await unschedulePost(sb(), id, userId, reason))) throw new Error("It couldn't be taken out — it may be publishing right now.");
  return `Took “${post.particulars}” out of the queue — it's back in Ready to schedule.`;
}

export async function rescheduleTool(args: Record<string, unknown>, userId: string) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  const whenRaw = typeof args.when === "string" ? args.when.trim() : "";
  if (!whenRaw || whenRaw.toLowerCase() === "now") throw new Error("when must be a date and time like \"2026-11-05 18:30\" (India time). To post now, use schedule_post with when \"now\".");
  const post = await queuedPostFor(userId, id);
  if (!post.publish_status) throw new Error("It isn't in the queue yet — use schedule_post to schedule it.");
  const iso = parseWhen(whenRaw);
  if (!(await reschedulePost(sb(), id, iso))) throw new Error("It couldn't be moved — it may be publishing right now.");
  return `Moved “${post.particulars}” from ${ist(post.schedule_time as string | null) || "no time"} to ${ist(iso)} (India time).`;
}

export async function retryTool(args: Record<string, unknown>, userId: string) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  const post = await queuedPostFor(userId, id);
  if (post.publish_status !== "failed") throw new Error(`Only a failed post can be retried — this one is "${post.publish_status || "not queued"}".`);
  if (!(await retryPost(sb(), id))) throw new Error("It couldn't be retried — it may be publishing right now.");
  return `Retrying “${post.particulars}” — the publisher picks it up within a minute.`;
}

/* ---------------------------------------- collaborators and comments (4 Nov 2026) */
export async function setCollaborators(args: Record<string, unknown>, userId: string) {
  const me = await rosterById(userId);
  if (!canClaude(me, "edit")) throw new Error("Editing tasks from Claude isn't switched on for you (Team & access → Connectors → Edit tasks).");
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) throw new Error("id is required.");
  const team = await activeTeamIds();
  const list = (k: string) => (Array.isArray(args[k]) ? (args[k] as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase().trim()) : []);
  const add = list("add"), remove = list("remove");
  const bad = [...add, ...remove].filter((k) => !team.has(k));
  if (bad.length) throw new Error(`Not on the team: ${bad.join(", ")}. Use one of: ${[...team].join(", ")}.`);
  if (!add.length && !remove.length) throw new Error("Say who to add and/or remove.");
  const { data: post } = await sb().from("mh_posts").select("particulars").eq("id", id).maybeSingle();
  if (!post) throw new Error("No task with that id.");
  if (add.length) { const { error } = await sb().from("mh_post_collaborators").upsert(add.map((k) => ({ post_id: id, member_key: k })), { onConflict: "post_id,member_key", ignoreDuplicates: true }); if (error) throw new Error(error.message); }
  if (remove.length) { const { error } = await sb().from("mh_post_collaborators").delete().eq("post_id", id).in("member_key", remove); if (error) throw new Error(error.message); }
  const { data: now } = await sb().from("mh_post_collaborators").select("member_key").eq("post_id", id);
  bustMarketingHubCache();
  return `Collaborators on “${post.particulars}” are now: ${((now || []) as { member_key: string }[]).map((r) => r.member_key).join(", ") || "nobody"}.`;
}

export async function addComment(args: Record<string, unknown>, userId: string) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  const text = typeof args.text === "string" ? args.text.trim() : "";
  if (!id || !text) throw new Error("id and text are required.");
  const { data: post } = await sb().from("mh_posts").select("particulars").eq("id", id).maybeSingle();
  if (!post) throw new Error("No task with that id.");
  const { error } = await sb().from("mh_comments").insert({ post_id: id, author_key: userId, body: text.slice(0, 4000) });
  if (error) throw new Error(error.message);
  return `Comment added to “${post.particulars}” as ${userId}.`;
}

// Put a creative on a task from a link (Praveen, 4 Nov 2026 — Claude had no way to add
// files). Claude can't hand over the bytes of a picture in the chat, but it can pass a
// link: Google Drive and Dropbox share links are turned into direct downloads; any
// other public link to the file works as it is. Same checks as a dashboard upload —
// allowed types only, judged from what actually arrived — and the same side effects
// (activity line, sent back for review when it's a creative).
const LINK_MAX_MB = 100;   // the file passes through a server function, so lower than the 2 GB dashboard limit
function directLink(raw: string): string {
  const u = new URL(raw);
  const drive = raw.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]{20,})/);
  if (drive) return `https://drive.usercontent.google.com/download?id=${drive[1]}&export=download&confirm=t`;
  if (/(^|\.)dropbox\.com$/.test(u.hostname)) { u.searchParams.set("dl", "1"); return u.href; }
  return u.href;
}
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov", "application/pdf": "pdf" };

export async function attachFromLink(args: Record<string, unknown>, userId: string) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  const url = typeof args.url === "string" ? args.url.trim() : "";
  const kind = asKind(args.kind);
  if (!UUID.test(id) || !/^https?:\/\//i.test(url)) throw new Error("id (a task id) and url (a link to the file) are required.");
  const { data: post } = await sb().from("mh_posts").select("particulars").eq("id", id).maybeSingle();
  if (!post) throw new Error("No task with that id.");

  const r = await safeFetch(directLink(url), { timeoutMs: 20_000, headers: { "User-Agent": "Mozilla/5.0 GooCampus-Dashboard" } })
    .catch((e: Error) => { throw new Error(/blocked/.test(e.message) ? "That link isn't a public web address." : `Couldn't reach that link: ${e.message}`); });
  await notPublishing(id);
  if (!r.ok) throw new Error(`Couldn't download it (${r.status}). Make sure the link is shared as "Anyone with the link".`);
  const mime = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (mime === "text/html") throw new Error("That link opens a web page, not the file. Share it as \"Anyone with the link\" (Google Drive files over ~100 MB can't be fetched this way — upload those in the dashboard).");
  if (!mimeAllowed(mime, kind)) throw new Error(mimeRefusal(kind));
  if (Number(r.headers.get("content-length") || 0) > LINK_MAX_MB * 1024 * 1024) throw new Error(`It's over ${LINK_MAX_MB} MB — upload it in the dashboard instead.`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > LINK_MAX_MB * 1024 * 1024) throw new Error(`It's over ${LINK_MAX_MB} MB — upload it in the dashboard instead.`);

  const given = typeof args.filename === "string" && args.filename.trim() ? args.filename.trim() : "";
  const fromHeader = (r.headers.get("content-disposition") || "").match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1];
  let filename = given || (fromHeader ? decodeURIComponent(fromHeader) : "") || `creative.${EXT[mime] || "bin"}`;
  if (!/\.\w{2,4}$/.test(filename)) filename += `.${EXT[mime] || "bin"}`;
  const path = `mh-creatives/${id}/${Date.now()}-${safeName(filename)}`;
  const { error: upErr } = await sb().storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: false });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
  return recordFile(id, String(post.particulars), path, filename, mime, buf.length, kind, userId, args.position);
}

// ── Task files from Claude (Praveen, 4 Nov 2026 — docs: marketing-os-mcp-blockers.md) ──
// Unlike a dashboard upload, a change made here leaves the task's status alone (Praveen
// chose this, 4 Nov: Claude replaces creatives in bulk and each would otherwise go
// back to review). A post already in the Scheduler queue is taken out, though, so it
// can never go out with the old files — schedule_post puts it back.
const QUEUED = new Set(["scheduled", "failed", "draft"]);
async function notPublishing(id: string) {
  const { data } = await sb().from("mh_posts").select("publish_status").eq("id", id).maybeSingle();
  if (data?.publish_status === "publishing") throw new Error("It's being published right now — try again in a minute.");
  if (data?.publish_status === "published") throw new Error("That post is already live — its files can't change now.");
}
async function afterFileChange(id: string, userId: string, what: string): Promise<string> {
  bustMarketingHubCache();
  const { data } = await sb().from("mh_posts").select("publish_status").eq("id", id).maybeSingle();
  if (!QUEUED.has(String(data?.publish_status))) return "";
  const out = await unschedulePost(sb(), id, userId, `Files changed through Claude (${what}) — schedule it again`);
  return out ? " It was in the Scheduler queue, so it was taken out — schedule it again with schedule_post once the files are right." : "";
}

/** A task's files, in the order they're posted. */
async function listFiles(id: string) {
  const { data } = await sb().from("mh_attachments").select("id, filename, kind, mime_type, size_bytes, sort_order, uploaded_at, uploaded_by, storage_path")
    .eq("post_id", id).order("sort_order", { ascending: true, nullsFirst: false }).order("uploaded_at", { ascending: true });
  const n: Record<string, number> = {};
  return ((data || []) as Record<string, unknown>[]).map((f) => ({
    id: f.id, filename: f.filename, kind: f.kind, position: (n[String(f.kind)] = (n[String(f.kind)] || 0) + 1),
    type: f.mime_type, size: f.size_bytes ? (Number(f.size_bytes) < 1048576 ? `${Math.max(1, Math.round(Number(f.size_bytes) / 1024))} KB` : `${(Number(f.size_bytes) / 1048576).toFixed(1)} MB`) : null,
    uploaded: ist(f.uploaded_at as string | null), uploaded_by: f.uploaded_by, url: f.storage_path,
  }));
}

/** Put one kind of file (creatives, references or attachments — whichever the ids are)
 *  in this order: the ids first, any others of that kind after, as they were. */
async function setOrder(id: string, firstIds: string[]) {
  const { data } = await sb().from("mh_attachments").select("id, kind").eq("post_id", id)
    .order("sort_order", { ascending: true, nullsFirst: false }).order("uploaded_at", { ascending: true });
  const rows = (data || []) as { id: string; kind: string }[];
  const group = (k: string) => (k === "reference" || k === "attachment" ? k : "creative");
  const kinds = new Set(rows.filter((f) => firstIds.includes(f.id)).map((f) => group(f.kind)));
  if (kinds.size > 1) throw new Error("Order one kind at a time — creatives, references and attachments each have their own order.");
  const creatives = rows.filter((f) => group(f.kind) === ([...kinds][0] || "creative")).map((f) => f.id);
  const unknown = firstIds.filter((x) => !creatives.includes(x));
  if (unknown.length) throw new Error(`Not files on this task: ${unknown.join(", ")}. get_task lists them.`);
  const order = [...firstIds, ...creatives.filter((x) => !firstIds.includes(x))];
  for (let i = 0; i < order.length; i++) {
    const { error } = await sb().from("mh_attachments").update({ sort_order: i + 1 }).eq("id", order[i]).eq("post_id", id);
    if (error) throw new Error(error.message);
  }
  return order;
}

async function recordFile(id: string, title: string, path: string, filename: string, mime: string, size: number, kind: ReturnType<typeof asKind>, userId: string, position: unknown) {
  const publicUrl = sb().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const { data: row, error } = await sb().from("mh_attachments").insert({ post_id: id, filename, storage_path: publicUrl, mime_type: mime, size_bytes: size, uploaded_by: userId, kind }).select("id").single();
  if (error || !row) { await sb().storage.from(BUCKET).remove([path]); throw new Error(error?.message || "Couldn't save it"); }
  await sb().from("mh_activity").insert({ post_id: id, actor_key: userId, action: `${kind}_added`, to_value: filename, detail: "via Claude" });
  const pos = Number(position);
  if (kind === "creative" && Number.isInteger(pos) && pos >= 1) {
    const { data } = await sb().from("mh_attachments").select("id, kind").eq("post_id", id).neq("id", row.id)
      .order("sort_order", { ascending: true, nullsFirst: false }).order("uploaded_at", { ascending: true });
    const others = ((data || []) as { id: string; kind: string }[]).filter((f) => f.kind !== "reference" && f.kind !== "attachment").map((f) => f.id);
    others.splice(Math.min(pos - 1, others.length), 0, row.id);
    await setOrder(id, others);
  }
  const note = await afterFileChange(id, userId, `added ${filename}`);
  return `Added ${kind} “${filename}” (${(size / 1048576).toFixed(1)} MB, ${mime}) to “${title}” — file id ${row.id}.${note}`;
}

export async function removeFile(args: Record<string, unknown>, userId: string) {
  const fileId = typeof args.file_id === "string" ? args.file_id.trim() : "";
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (!UUID.test(fileId)) throw new Error("file_id is required — get_task lists each file's id.");
  if (!reason) throw new Error("Say why it's being removed (reason) — it's shown in the task's history.");
  const { data: f } = await sb().from("mh_attachments").select("post_id").eq("id", fileId).maybeSingle();
  if (!f) throw new Error("No file with that id (it may already be removed).");
  await notPublishing(f.post_id);
  const gone = await trashFile(sb(), fileId, userId);
  if (!gone) throw new Error("It was already removed.");
  await sb().from("mh_activity").insert({ post_id: gone.post_id, actor_key: userId, action: gone.kind === "reference" || gone.kind === "attachment" ? `${gone.kind}_removed` : "creative_removed", to_value: gone.filename, detail: `${reason.slice(0, 280)} (via Claude)` });
  const note = await afterFileChange(gone.post_id, userId, `removed ${gone.filename}`);
  return `Moved “${gone.filename}” to the recycle bin (it can be restored from the dashboard).${note}`;
}

export async function reorderFiles(args: Record<string, unknown>, userId: string) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  const ids = Array.isArray(args.file_ids) ? (args.file_ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (!UUID.test(id) || !ids.length) throw new Error("id (the task) and file_ids (in the new order) are required.");
  await notPublishing(id);
  const order = await setOrder(id, ids);
  const { data: k } = await sb().from("mh_attachments").select("kind").eq("id", order[0]).maybeSingle();
  await sb().from("mh_activity").insert({ post_id: id, actor_key: userId, action: k?.kind === "attachment" ? "attachments_reordered" : "creatives_reordered", detail: "via Claude" });
  const note = await afterFileChange(id, userId, "reordered");
  const { data: named } = await sb().from("mh_attachments").select("id, filename").in("id", order);
  const nameOf = new Map(((named || []) as { id: string; filename: string }[]).map((f) => [f.id, f.filename]));
  return `New order: ${order.map((x, i) => `${i + 1}. ${nameOf.get(x) || x}`).join(", ")}.${note}`;
}

/** Step 1 of uploading a file from the user's computer: a one-time upload link. */
export async function startUpload(args: Record<string, unknown>) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  const filename = typeof args.filename === "string" ? args.filename.trim() : "";
  if (!UUID.test(id) || !filename) throw new Error("id (the task) and filename are required.");
  const { data: post } = await sb().from("mh_posts").select("id").eq("id", id).maybeSingle();
  if (!post) throw new Error("No task with that id.");
  await notPublishing(id);
  const path = `mh-creatives/${id}/${Date.now()}-${safeName(filename)}`;
  const { data, error } = await sb().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Couldn't start the upload: ${error?.message || "no link"}`);
  return {
    upload_url: data.signedUrl, path,
    how: `Send the file with an HTTP PUT to upload_url, the file's bytes as the body and its Content-Type header (e.g. curl -X PUT -H "Content-Type: image/png" --data-binary @file.png "<upload_url>"). Then call finish_upload with this id and path. The link works once, for about 2 hours. Up to ${MAX_MB} MB.`,
  };
}

/** Step 2: check what arrived (type and size from storage, not from the caller) and put it on the task. */
export async function finishUpload(args: Record<string, unknown>, userId: string) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  const path = typeof args.path === "string" ? args.path.trim() : "";
  const kind = asKind(args.kind);
  if (!UUID.test(id) || !path.startsWith(`mh-creatives/${id}/`) || path.includes("..")) throw new Error("Use the id and path that start_upload gave.");
  const { data: post } = await sb().from("mh_posts").select("particulars").eq("id", id).maybeSingle();
  if (!post) throw new Error("No task with that id.");
  const dir = path.slice(0, path.lastIndexOf("/")), name = path.slice(path.lastIndexOf("/") + 1);
  const { data: listed } = await sb().storage.from(BUCKET).list(dir, { search: name, limit: 5 });
  const obj = (listed || []).find((o) => o.name === name);
  if (!obj) throw new Error("The file hasn't arrived — PUT it to upload_url first.");
  const meta = (obj.metadata || {}) as { mimetype?: string; size?: number };
  const mime = String(meta.mimetype || "").toLowerCase(), size = Number(meta.size || 0);
  if (!mimeAllowed(mime, kind) || size > MAX_MB * 1024 * 1024) {
    await sb().storage.from(BUCKET).remove([path]);
    throw new Error(size > MAX_MB * 1024 * 1024 ? `The limit is ${MAX_MB} MB.` : `${mimeRefusal(kind)} (It arrived as "${mime || "unknown"}" — send the right Content-Type header.)`);
  }
  const given = typeof args.filename === "string" && args.filename.trim() ? args.filename.trim() : name.replace(/^\d+-/, "");
  return recordFile(id, String(post.particulars), path, given, mime, size, kind, userId, args.position);
}
