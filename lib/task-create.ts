import { getSupabase } from "@/lib/supabase";
import { DEFAULT_STATUS, isTaskStatus } from "@/lib/statuses";
import { bustMarketingHubCache } from "@/lib/mh-cache";
import { pageForSbu } from "@/lib/sbu-pages";
import { VIDEO_TYPES } from "@/lib/mh-content-types";
import { TEAM_NAMES } from "@/lib/team-names";
import { fetchRoster } from "@/lib/team-db";
import { fetchContentTypes } from "@/lib/content-types-db";
import { fetchSbus } from "@/lib/sbus-db";
import { rulesEngineOn } from "@/lib/rules-engine";

// Creates ONE task (mh_posts row) — shared by the New task form
// (app/api/marketing-hub/create) and the Claude connector (app/api/mcp), so both
// follow the same rules, stamp the creator and write the same activity trail.
// CREATE only. Required: title + SBU (a brand-less row can't be routed or reported).

export type TaskInput = {
  title: string; sbu?: string; type?: string; owner?: string; status?: string;
  publishingDate?: string; dueDate?: string; priority?: string; platforms?: string[];
  content?: string; caption?: string; needsReview?: boolean;
};
export type CreatedTask = { id: string; particulars: string; status: string; owner_key: string | null; publishing_date: string | null; created_at: string };

// The form sends Airtable-style display names; map to team keys.
const OWNER_ALIASES: Record<string, string> = {
  "manya b m": "manya", "manya": "manya",
  "praveen l": "praveen", "praveen": "praveen",
  "nikhil shyamraj": "nikhil", "nikhi shyamraj": "nikhil", "nikhil": "nikhil",
  "nandu c": "nandu", "nandu": "nandu",
  "maheen ejaz": "maheen", "maheen": "maheen",
};
export function normalizeOwner(v: string | undefined): string | null {
  if (!v) return null;
  const k = v.toLowerCase().trim();
  if (OWNER_ALIASES[k]) return OWNER_ALIASES[k];
  // Anyone on the Team page, by id or first name — so a new teammate can own work.
  // TEAM_NAMES is filled by fetchRoster(); callers warm it first.
  if (TEAM_NAMES[k]) return k;
  const byFirst = Object.entries(TEAM_NAMES).find(([, first]) => first.toLowerCase() === k);
  return byFirst ? byFirst[0] : null;
}

// Who is attached to a new task besides its owner.
//
// This USED to be typed here — Nandu on 12thPlus, Manya on everything else — so
// "Nandu has left, it is X now" meant editing this file and deploying. It is a row
// in mh_rules now (sql/019), editable from Marketing Hub → Automations.
//
// Nobody is ever both owner and collaborator, so when the rule names the owner the
// task simply starts with none. The claim flow adds the other editor on top of this
// when a video is shot by one person and cut by another.
//
// The hard-coded pair is kept as a fallback for the one case that matters: the
// rules table unreachable. Starting a task with NO collaborator because a query
// failed is worse than starting it with the one we have always used.
export async function defaultCollaboratorFor(
  sbu: string | null | undefined, ownerKey: string | null, type?: string | null,
): Promise<string | null> {
  let key: string | null = null;
  try {
    await fetchContentTypes();   // so VIDEO_TYPES knows dashboard-added types
    await fetchSbus();           // brand → page from the database (sql/040)
    const sb = getSupabase();
    if (sb) {
      const { data } = await sb
        .from("mh_rules")
        .select("sbu, content_kind, assign_to")
        .eq("kind", "collaborator").eq("active", true);
      const rows = (data || []) as { sbu: string | null; content_kind: string | null; assign_to: string | null }[];
      // Same order as the owner trigger (sql/026): brand, then exact type, then
      // design/video, then the catch-all. No type yet → only type-less rules match.
      const kind = type ? (VIDEO_TYPES.has(type) ? "video" : "design") : null;
      const spec = (ck: string | null) => (!ck ? 0 : ck === "video" || ck === "design" ? 1 : 2);
      const hit = rows
        .filter((r) => (!r.sbu || r.sbu === sbu) && (!r.content_kind || r.content_kind === kind || (!!type && r.content_kind === type)))
        .sort((a, b) => Number(!!b.sbu) - Number(!!a.sbu) || spec(b.content_kind) - spec(a.content_kind))[0];
      if (hit) key = hit.assign_to;
    }
  } catch { /* fall through to the old pair */ }
  if (key === null) key = pageForSbu(sbu) === "12Plus / GC India" ? "nandu" : "manya";
  return key === ownerKey ? null : key;
}

export function missingForCreate(t: TaskInput): string[] {
  const missing: string[] = [];
  if (!t.title || !t.title.trim()) missing.push("Title");
  if (!t.sbu || !String(t.sbu).trim()) missing.push("SBU (which brand it's for)");
  return missing;
}

export async function createTask(t: TaskInput, actorId: string | null, source: string, via?: string): Promise<CreatedTask> {
  await fetchRoster();   // so normalizeOwner knows anyone added on the Team page
  await fetchContentTypes();   // registers dashboard-added types into VIDEO_TYPES (sql/028)
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data, error } = await sb.from("mh_posts").insert({
    particulars: t.title.trim(),
    // Content Studio lets the writer pick where it lands — "Show the content status
    // drop down here" (Manya, 28 Sept). Anything unrecognised falls back to the
    // default rather than being sent to Postgres, where a bad enum value 502s.
    status: isTaskStatus(t.status) ? t.status : DEFAULT_STATUS,
    type: t.type || null,
    sbu: t.sbu || null,
    owner_key: normalizeOwner(t.owner),
    publishing_date: t.publishingDate || null,
    due_date: t.dueDate || null,
    priority: t.priority || null,
    // Default a new task to the three channels the team publishes to.
    platforms: t.platforms && t.platforms.length > 0 ? t.platforms : ["Instagram", "Facebook", "LinkedIn"],
    content: t.content || null,
    caption: t.caption || null,
    needs_review: t.needsReview === true,
    // Who made it — fixed forever, whoever owns it later ("Tasks I created" in My Day).
    created_by: actorId,
    // NOTE: do NOT stamp start_at here — the update route sets it when work starts.
  }).select("id, particulars, status, owner_key, publishing_date, created_at").single();
  if (error) throw new Error(error.message);
  // Attach the default collaborator. Best-effort for the same reason as the
  // activity row below: the task is already committed, and a task missing a
  // collaborator is fixable by hand — a duplicate task is not.
  // With the rules engine on, the database already added the rule's collaborator.
  try {
    if (!(await rulesEngineOn())) {
      const collab = await defaultCollaboratorFor(t.sbu, (data as CreatedTask).owner_key, t.type);
      if (collab) await sb.from("mh_post_collaborators").insert({ post_id: data.id, member_key: collab });
    }
  } catch { /* the + control can add them by hand */ }
  // Best-effort: the task is committed; a logging hiccup must not fail the create
  // (the caller would retry → duplicate task).
  try {
    await sb.from("mh_activity").insert({ post_id: data.id, actor_key: actorId || normalizeOwner(t.owner), action: "created", to_value: "Content - Pending", detail: { source, ...(via ? { via } : {}) } });
  } catch { /* courtesy trail */ }
  bustMarketingHubCache();
  return data as CreatedTask;
}
