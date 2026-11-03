import type { SupabaseClient } from "@supabase/supabase-js";
import { VIDEO_TYPES } from "@/lib/mh-content-types";
import { TEAM_NAMES } from "@/lib/team-names";
import { activeTeamIds } from "@/lib/team-db";
import { fetchContentTypes } from "@/lib/content-types-db";
import { keysWithRole, isEditor, isDesigner, isWriter, siblingOf as siblingOfRole } from "@/lib/team-roles";

// Notification GENERATION — who hears about what, derived from the mh_activity
// event log (and mh_status_log for "your task moved"). Lifted verbatim out of
// /api/my-day/notifications so two callers share one set of rules:
//   · /api/my-day/notifications — the original live feed (My Day + the bell)
//   · /api/notifications        — persists these into mh_notifications for the
//                                 Notifications tab, pop-ups and re-pop
// Each notification now also carries its category, whether it needs action, and
// when the underlying event happened. See docs/NOTIFICATIONS_SPEC.md §2.

const NAME = TEAM_NAMES;   // filled from the Team page roster (lib/team-names.ts)
// Who is an editor / the designer / a writer / an approver comes from the Team page
// (lib/team-roles.ts), not from names typed here (27 Oct).
const editors = () => keysWithRole("editor");
// No actor on the event = an automation did it (link write-backs, schedulers…)
// → say "System", never a vague "Someone" (same convention as the activity feed).
const nameOf = (k: string | null) => (k ? NAME[k.toLowerCase()] || k : "System");
/** The other video editor, or null for anybody who is not one. */
export const siblingOf = (k: string) => siblingOfRole(k);

type Act = {
  id: number; post_id: string; actor_key: string | null; action: string;
  from_value: string | null; to_value: string | null; created_at: string;
  // Free-form payload per action — a time_extended row carries its minutes and reason.
  detail?: { minutes?: number; reason?: string; undo?: boolean } | null;
};
type Post = { id: string; particulars: string | null; owner_key: string | null; type: string | null };
export type SwapCand = { id: string; title: string; dur: number; due?: string };
export type NotifCategory = "action" | "assigned" | "pool" | "progress" | "dates";
export type Notif = {
  id: string; kind: string; emoji: string; title: string; sub: string;
  cat: NotifCategory; at: string;
  // The task this is about — ALWAYS set. Distinct from postId, which My Day reads as
  // "this notification has an Accept button"; reusing postId would put Accept on
  // every notification. The stored Notifications tab links and resolves off this.
  taskId?: string;
  postId?: string; accept?: boolean; swap?: { from: string; candidates: SwapCand[] };
  // Who holds the task and what it moved to. The name is already written into `sub`
  // as "· with Nandu", but prose is no basis for a link — reading it back would break
  // the first time the wording changed. Carried here so the Notifications tab can
  // group by person and link to exactly their tasks at that status.
  owner?: string;        // display name, for the label
  ownerKey?: string;     // the team key, which is what the Master sheet filter matches
  statusTo?: string;     // the mh_posts status, e.g. "Content - Approved"
};
export const isActionNeeded = (n: Pick<Notif, "cat">) => n.cat === "action";

/** Everything `person` should be told about since `since` (ISO). */
export const STAGES: Record<string, { emoji: string; title: string }> = {
  "Content - Approved":     { emoji: "✅", title: "approved" },
  "Output - In Progress":   { emoji: "🎨", title: "being made" },
  "Output - Ready":         { emoji: "📦", title: "ready for review" },
  "Incorporating Feedback": { emoji: "↩️", title: "back for changes" },
  "Ready to Publish":       { emoji: "📅", title: "scheduled to publish" },
  "Published/Scheduled":    { emoji: "🎉", title: "published" },
};

// Title back to status, for anything that has only the title to go on.
export const STATUS_FOR_TITLE: Record<string, string> = Object.fromEntries(
  Object.entries(STAGES).map(([status, v]) => [`Your task is ${v.title}`, status]),
);

export async function buildNotifs(sb: SupabaseClient, person: string, since: string): Promise<{ notifs: Notif[]; createdNotifs: Notif[] }> {
  const team = await activeTeamIds();   // also fills NAME for anyone new
  await fetchContentTypes();   // registers dashboard-added types into VIDEO_TYPES (sql/028)
  const { data: acts, error } = await sb
    .from("mh_activity")
    .select("id, post_id, actor_key, action, from_value, to_value, detail, created_at")
    // All edits now log as status_changed / owner_changed / claim (app-attributed).
    .in("action", ["claim", "status_changed", "owner_changed", "due_date_changed", "rescheduled", "date_change_approved", "swap_requested", "date_change_requested", "time_extended"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(160);
  if (error) throw new Error(error.message);

  const events = (acts || []) as Act[];

  // A reassignment (owner_changed) that is really a claim or an approval-handoff
  // is already announced by its own event — don't double-notify. Collect those
  // post_ids so the owner_changed branch below skips them.
  const claimedOrHandedOff = new Set(
    events.filter((e) => e.action === "claim" || (e.action === "status_changed" && e.to_value === "Content - Approved")).map((e) => e.post_id),
  );
  const ids = [...new Set(events.map((e) => e.post_id).filter(Boolean))];
  const postMap = new Map<string, Post>();
  if (ids.length) {
    const { data: posts } = await sb
      .from("mh_posts")
      .select("id, particulars, owner_key, type")
      .in("id", ids);
    (posts || []).forEach((p) => postMap.set((p as Post).id, p as Post));
  }

  const notifs: Notif[] = [];
  const seen = new Set<string>();

  for (const e of events) {
    const post = postMap.get(e.post_id);
    const t = post?.particulars || "a task";
    // Was 46 characters, which cut most task names in half (Praveen, 23 Sep). The
  // pop-up card clamps its own lines, so the full name is safe to carry here.
  const short = t.length > 110 ? `${t.slice(0, 108)}…` : t;

    let target: string[] = [];
    let n: Omit<Notif, "id" | "at"> | null = null;

    if (e.action === "date_change_requested") {
      // Publish-date change awaiting Maheen's approval.
      target = keysWithRole("manager");   // whoever approves dates (Team page role)
      n = { cat: "action", kind: "message", emoji: "📅", title: "Publish-date change to approve", sub: `${nameOf(e.actor_key)} wants “${short}” moved ${e.from_value} → ${e.to_value}. Approve in My Day.`, postId: e.post_id };
    } else if (e.action === "claim") {
      const sib = e.actor_key ? siblingOf(e.actor_key.toLowerCase()) : null;
      if (sib) {
        target = [sib];
        n = { cat: "pool", kind: "claim", emoji: "✓", title: `${nameOf(e.actor_key)} claimed a video`, sub: `"${short}" is off the board — you're clear on that one.` };
      }
    } else if (e.action === "status_changed" && e.to_value === "Content - Approved") {
      // Approval = the handoff. Design → Praveen; video → the editor pool.
      if (VIDEO_TYPES.has(post?.type || "")) {
        // Only advertise as "up for grabs" while still unclaimed. Once an editor
        // owns it (claimed via takeover), stop telling editors to claim it.
        if (post && !isEditor(post.owner_key)) {
          target = editors();
          n = { cat: "pool", kind: "message", emoji: "🎬", title: "New video up for grabs", sub: `"${short}" was approved — claim it from the pool.` };
        }
      } else if (post?.owner_key && !isDesigner(post.owner_key) && !isWriter(post.owner_key)) {
        // The Rules page handed it to someone else (12thPlus design → Nandu, 30 Oct) —
        // tell them, not the designer. Treating every non-designer owner as "queued for
        // the designer" sent Praveen "Waiting in your pipeline" for Nandu's tasks.
        target = [post.owner_key];
        n = { cat: "assigned", kind: "message", emoji: "📥", title: "Approved — handed to you", sub: `"${short}" is ready for you to produce.`, postId: e.post_id };
      } else if (post && !isDesigner(post.owner_key)) {
        // Deferred handoff (assigner saw "day full" and queued it): ownership is
        // still with the writer — the designer must ACCEPT to take it. postId powers
        // the Accept button; the task joins their board only via that takeover.
        target = keysWithRole("designer");
        n = { cat: "action", kind: "message", emoji: "⏳", title: "Waiting in your pipeline", sub: `"${short}" is approved and queued for you — accept when you have room.`, postId: e.post_id, accept: true };
      } else {
        target = keysWithRole("designer");
        n = { cat: "assigned", kind: "message", emoji: "📥", title: "Approved — handed to you", sub: `"${short}" is ready for you to produce.` };
      }
    } else if (e.action === "status_changed" && e.to_value === "Incorporating Feedback") {
      if (post?.owner_key) {
        target = [post.owner_key];
        n = { cat: "action", kind: "message", emoji: "↩️", title: "Sent back for changes", sub: `"${short}" was returned from review — needs changes.` };
      }
    } else if (e.action === "status_changed" && e.to_value === "Ready to Publish") {
      if (post?.owner_key) {
        target = [post.owner_key];
        n = { cat: "progress", kind: "message", emoji: "📅", title: "Cleared review → scheduled", sub: `"${short}" is queued in the Scheduler.` };
      }
    } else if (e.action === "swap_requested") {
      // A packed producer offered their not-started list — MANYA picks which
      // task to move; the candidates travel in the activity's detail payload.
      //
      // RESOLVED-CHECK: the request is done once the pending task now belongs to
      // the requester (Manya moved a task + handed it over — the takeover set
      // owner_key = the requester). Skip it so a handled request doesn't keep
      // re-appearing on reload (the request count then correctly drops to zero).
      if (post && post.owner_key === e.actor_key) {
        n = null;
      } else {
        let candidates: SwapCand[] = [];
        try {
          const d = (e as { detail?: unknown }).detail;
          candidates = (typeof d === "string" ? JSON.parse(d) : d) as SwapCand[] || [];
        } catch { candidates = []; }
        if (candidates.length && e.actor_key) {
          target = keysWithRole("writer");
          n = { cat: "action", kind: "message", emoji: "🔁", title: `${nameOf(e.actor_key)} is packed — pick a task to move`, sub: `Offers ${candidates.length} not-started task${candidates.length > 1 ? "s" : ""} to swap for "${short}".`, postId: e.post_id, swap: { from: e.actor_key, candidates } };
        }
      }
    } else if (e.action === "time_extended") {
      // Everyone else on the team, because a day that just got longer changes what
      // the rest of them can expect from it. The actor is filtered out below.
      target = [...team];
      // Somebody needed longer on a task. Everyone else sees it, because a day that
      // just got longer changes what the rest of the team can expect from it.
      const mins = Number(e.detail?.minutes ?? 0);
      const why = String(e.detail?.reason || "");
      const abs = Math.abs(mins);
      const asText = abs >= 60 ? `${Math.floor(abs / 60)}h${abs % 60 ? ` ${abs % 60}m` : ""}` : `${abs}m`;
      n = mins < 0
        ? { cat: "progress", kind: "message", emoji: "↩️", title: `Time taken back — ${asText}`, sub: `${nameOf(e.actor_key)} removed ${asText} from “${short}”${why ? ` — ${why}` : ""}.`, postId: e.post_id }
        : { cat: "progress", kind: "message", emoji: "⏱️", title: `Task extended — +${asText}`, sub: `${nameOf(e.actor_key)} needs ${asText} longer on “${short}”${why ? ` — ${why}` : ""}.`, postId: e.post_id };
    } else if (e.action === "date_change_approved") {
      // An admin approved a requested publish-date change (lib/date-approvals).
      target = keysWithRole("writer");
      n = { cat: "dates", kind: "message", emoji: "📅", title: `${nameOf(e.actor_key)} approved a date change`, sub: `"${short}" → ${e.to_value || "updated"}${e.from_value ? ` (was ${e.from_value})` : ""}.` };
    } else if (e.action === "due_date_changed" || e.action === "rescheduled") {
      // A producer moved a date (e.g. make-room rolled a task to tomorrow) →
      // Manya, who created/plans the work, gets the change request in HER
      // Requests feed. Her own date edits don't notify her (self-filter below).
      target = keysWithRole("writer");
      n = { cat: "dates", kind: "message", emoji: "📅", title: `${nameOf(e.actor_key)} moved a date`, sub: `"${short}" → ${e.to_value || "updated"}${e.from_value ? ` (was ${e.from_value})` : ""}.` };
    } else if (e.action === "owner_changed") {
      // Plain reassignment (not a claim/handoff): tell the new owner it's theirs.
      if (e.to_value && !claimedOrHandedOff.has(e.post_id)) {
        target = [e.to_value];
        n = { cat: "assigned", kind: "message", emoji: "📌", title: "Assigned to you", sub: `"${short}" was handed to you by ${nameOf(e.from_value)}.` };
      } else if (!e.to_value && !claimedOrHandedOff.has(e.post_id) && VIDEO_TYPES.has(postMap.get(e.post_id)?.type || "")) {
        // Released back to the claim pool ("Nobody — claim pool" in the task window,
        // Nandu 9 Oct). Without this the video sat in the pool and nobody heard.
        target = editors();
        n = { cat: "pool", kind: "message", emoji: "🎬", title: "Back in the claim pool", sub: `${nameOf(e.actor_key)} put "${short}" back in the pool — claim it if you can take it.` };
      }
    }

    if (!n) continue;
    if (!target.map((x) => x.toLowerCase()).includes(person)) continue;
    if (e.actor_key && e.actor_key.toLowerCase() === person) continue; // never notify yourself
    const key = `${e.action}:${e.post_id}:${e.to_value || ""}`;
    if (seen.has(key)) continue; // collapse repeats of the same event on the same post
    seen.add(key);
    notifs.push({ id: `a${e.id}`, ...n, at: e.created_at, taskId: e.post_id });
  }

  // "Created by me" — the task someone made is moving through other hands. Read from
  // mh_status_log, which the DATABASE writes on every status change (dashboard,
  // Sync from Airtable, n8n…), so a publish made outside the dashboard still counts.
  const STAGE = STAGES;
  const createdNotifs: Notif[] = [];
  const { data: mine } = await sb.from("mh_posts").select("id, particulars, owner_key").eq("created_by", person).limit(500);
  const mineById = new Map(((mine || []) as { id: string; particulars: string | null; owner_key: string | null }[]).map((p) => [p.id, p]));
  if (mineById.size) {
    const { data: log } = await sb.from("mh_status_log").select("id, post_id, to_status, changed_at")
      .in("post_id", [...mineById.keys()]).gte("changed_at", since).order("changed_at", { ascending: false }).limit(60);
    const seenCreated = new Set<string>();
    for (const l of (log || []) as { id: number; post_id: string; to_status: string; changed_at: string }[]) {
      const post = mineById.get(l.post_id);
      const stage = STAGE[l.to_status];
      if (!post || !stage) continue;
      if ((post.owner_key || "").toLowerCase() === person) continue; // their own work: covered above
      if (seenCreated.has(l.post_id)) continue; // newest stage per task only
      seenCreated.add(l.post_id);
      const t = post.particulars || "a task";
      // Was 46 characters, which cut most task names in half (Praveen, 23 Sep). The
  // pop-up card clamps its own lines, so the full name is safe to carry here.
  const short = t.length > 110 ? `${t.slice(0, 108)}…` : t;
      // No postId: in My Day a notification with a postId acts as "Accept" (takeover).
      createdNotifs.push({ id: `s${l.id}`, cat: "progress", at: l.changed_at, taskId: l.post_id, kind: "message", emoji: stage.emoji, title: `Your task is ${stage.title}`,
        sub: `"${short}"${post.owner_key ? ` · with ${nameOf(post.owner_key)}` : ""}.`,
        owner: post.owner_key ? nameOf(post.owner_key) : undefined,
        ownerKey: post.owner_key || undefined, statusTo: l.to_status });
    }
  }

  // Creator updates first (a few), then the usual feed — so "published" isn't cut off.
  return { notifs, createdNotifs };
}
