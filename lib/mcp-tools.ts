import { getSupabase } from "@/lib/supabase";
import { bustMarketingHubCache } from "@/lib/mh-cache";
import { normalizeOwner } from "@/lib/task-create";
import { ALL_TYPES } from "@/lib/mh-content-types";
import { SBU_OPTIONS } from "@/lib/sbus";
import { listItems } from "@/lib/content-radar";
import { rosterById } from "@/lib/team-db";
import { needsDateApproval, needsDateReason, canPublishFromClaude, maySchedulePage } from "@/lib/permissions";
import { enqueuePost } from "@/lib/scheduler-enqueue";
import { pageForSbu } from "@/lib/sbu-pages";
import { requestDateChange, supersedeDateChange } from "@/lib/date-approvals";
import { freshPublishState } from "@/lib/scheduler-lock";

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
  return brief(data as Row, origin, true);
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
const UPDATABLE = ["status", "publishing_date", "due_date", "priority", "owner", "caption", "content", "type"] as const;

export async function updateTask(args: Record<string, unknown>, userId: string, origin: string, via?: string) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) throw new Error("id is required");

  const s = (k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : undefined);
  const patch: Record<string, unknown> = {};

  if (s("status") !== undefined) patch.status = s("status");
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
  if (Object.keys(patch).length === 0 && pending) {
    return { updated: [], pendingApproval: pending, task: brief(before.data as Row, origin, true) };
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

  return {
    updated: Object.keys(patch).filter((k) => k !== "updated_at"),
    ...(pending ? { pendingApproval: `The publishing date move to ${pending} is waiting for an admin's approval.` } : {}),
    task: brief(data as Row, origin, true),
  };
}

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

  // "now", or a date and time in India (UTC+5:30) unless it carries its own offset.
  let scheduleTimeISO = "";
  if (whenRaw.toLowerCase() !== "now") {
    const m = whenRaw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/);
    const t = m ? Date.parse(`${m[1]}T${m[2].padStart(2, "0")}:${m[3]}:00+05:30`) : Date.parse(whenRaw);
    if (!Number.isFinite(t)) throw new Error("when must be \"now\" or like \"2026-11-05 18:30\" (India time).");
    if (t < Date.now() + 60_000) throw new Error("That time has passed — use \"now\" to post straight away, or a later time.");
    scheduleTimeISO = new Date(t).toISOString();
  }

  const res = await enqueuePost(sb(), {
    taskId: id, particulars: post.particulars || "Post", pages, publishToPage: pages[0],
    caption: post.caption || "", mediaUrls: media, format, sbu: post.sbu || undefined,
    scheduleTimeISO, alsoStory: args.also_story === true,
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
