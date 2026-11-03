import { getSupabase } from "@/lib/supabase";
import { fetchRoster } from "@/lib/team-db";
import { TEAM_ROLES, type WorkRole } from "@/lib/team-roles";
import { VIDEO_TYPES } from "@/lib/mh-content-types";
import { fetchContentTypes } from "@/lib/content-types-db";
import { WORKING } from "@/lib/my-day-task";

// Team and individual reports (Praveen, 3 Nov 2026 — docs/team-report-prototype/v1.html).
// One month, counted from what people already do in the dashboard (the activity log).
// Each person's report is their main role on the Team page; work they did in another
// role (an editor who also writes) is listed under "Additional roles":
//   · content writer   → pieces they moved to "Content - Approved"
//   · graphic designer → design tasks (not video) they moved to "Output - Ready"
//   · video editor     → video tasks they moved to "Output - Ready"
// A task counts once per month, on the first time it was delivered that month.
// "Sent back" = the task went back for changes after that delivery. On time = delivered
// on or before its due date (or publishing date when there's no due date). Managers
// approve rather than deliver, so they aren't in it.

type Role = Exclude<WorkRole, "manager">;
const DELIVERED_TO: Record<Role, string> = { writer: "Content - Approved", designer: "Output - Ready", editor: "Output - Ready" };
// Statuses that mean "back for changes" after each role's hand-over.
const BACK: Record<Role, Set<string>> = {
  writer: new Set(["Content - Pending", "Content - In Progress", "Content - Needs Approval"]),
  designer: new Set(["Incorporating Feedback", "Output - In Progress"]),
  editor: new Set(["Incorporating Feedback", "Output - In Progress"]),
};

type Act = { post_id: string; actor_key: string | null; action: string; to_value: string | null; created_at: string };
type Post = { id: string; particulars: string | null; type: string | null; sbu: string | null; due_date: string | null; publishing_date: string | null; start_at: string | null; owner_key: string | null; status: string | null };

export type Delivered = { id: string; title: string; type: string; sbu: string; due: string | null; delivered: string; onTime: boolean | null; sentBack: number; turnaround: number | null };
export type Group = { name: string; delivered: number; onTime: number; onTimeOf: number; sentBack: number; turnaround: number | null };
export type Extra = { role: Role; delivered: number; onTime: number; onTimeOf: number; sentBack: number; items: Delivered[] };
export type Person = {
  key: string; name: string; role: Role; extra: Extra[];
  delivered: number; onTime: number; onTimeOf: number; sentBack: number; turnaround: number | null;
  uploads: number; edits: number; created: number; openNow: number; overdueNow: number;
  byType: Group[]; bySbu: Group[]; items: Delivered[];
};

const istDay = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

function group(items: Delivered[], key: (d: Delivered) => string): Group[] {
  const m = new Map<string, Delivered[]>();
  for (const d of items) m.set(key(d), [...(m.get(key(d)) || []), d]);
  return [...m.entries()].map(([name, ds]) => ({
    name, delivered: ds.length,
    onTime: ds.filter((d) => d.onTime).length, onTimeOf: ds.filter((d) => d.onTime !== null).length,
    sentBack: ds.filter((d) => d.sentBack).length,
    turnaround: avg(ds.map((d) => d.turnaround).filter((t): t is number => t !== null)),
  })).sort((a, b) => b.delivered - a.delivered);
}

/** The month's report for everyone (`only` = one person's key, for people who may see only their own). */
export async function buildTeamReport(month: string, only?: string) {
  const sb = getSupabase();
  if (!sb) throw new Error("database unavailable");
  const [roster] = await Promise.all([fetchRoster(), fetchContentTypes()]);
  const start = new Date(`${month}-01T00:00:00+05:30`).toISOString();
  const endD = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1));
  const end = new Date(`${endD.toISOString().slice(0, 7)}-01T00:00:00+05:30`).toISOString();
  const today = istDay(new Date().toISOString());

  const people = Object.entries(TEAM_ROLES)
    .filter(([k, r]) => r.active && r.role !== "manager" && (!only || k === only))
    .map(([key, r]) => ({ key, role: r.role as Role, name: roster.find((u) => u.id === key)?.name || key }));
  const keys = people.map((p) => p.key);
  if (!keys.length) return { month, people: [] as Person[] };

  // This month's activity by these people.
  const acts: Act[] = [];
  for (let a = 0; ; a += 1000) {
    const { data, error } = await sb.from("mh_activity").select("post_id, actor_key, action, to_value, created_at")
      .gte("created_at", start).lt("created_at", end).in("actor_key", keys).order("created_at").range(a, a + 999);
    if (error) throw new Error(error.message);
    acts.push(...((data || []) as Act[]));
    if (!data || data.length < 1000) break;
  }
  // Every hand-over by these people, in any role (main role and additional ones).
  const delivers = acts.filter((x) => x.action === "status_changed" && (x.to_value === "Content - Approved" || x.to_value === "Output - Ready"));
  const postIds = [...new Set(delivers.map((x) => x.post_id))];

  // Those tasks, and every status change on them (to see "sent back" and when work started).
  const posts = new Map<string, Post>();
  const history = new Map<string, Act[]>();
  for (let i = 0; i < postIds.length; i += 200) {
    const ids = postIds.slice(i, i + 200);
    const [p, h] = await Promise.all([
      sb.from("mh_posts").select("id, particulars, type, sbu, due_date, publishing_date, start_at, owner_key, status").in("id", ids),
      sb.from("mh_activity").select("post_id, actor_key, action, to_value, created_at").in("post_id", ids).eq("action", "status_changed").order("created_at"),
    ]);
    for (const r of (p.data || []) as Post[]) posts.set(r.id, r);
    for (const r of (h.data || []) as Act[]) history.set(r.post_id, [...(history.get(r.post_id) || []), r]);
  }

  // Open now / overdue now, for each person's own stage.
  const { data: open } = await sb.from("mh_posts").select("owner_key, type, status, due_date, publishing_date").in("owner_key", keys).in("status", WORKING);
  const { data: made } = await sb.from("mh_posts").select("created_by").in("created_by", keys).gte("created_at", start).lt("created_at", end);

  // One person's hand-overs in one role: writers' approvals, or design / video "ready".
  const deliveredAs = (key: string, role: Role): Delivered[] => {
    const isRole = (type: string | null) => role === "writer" || (role === "editor") === VIDEO_TYPES.has(type || "");
    const seen = new Set<string>();
    const items: Delivered[] = [];
    for (const d of delivers) {
      if (d.actor_key !== key || d.to_value !== DELIVERED_TO[role] || seen.has(d.post_id)) continue;
      const post = posts.get(d.post_id);
      if (!post || !isRole(post.type)) continue;
      seen.add(d.post_id);
      const due = post.due_date || post.publishing_date;
      const day = istDay(d.created_at);
      const h = history.get(d.post_id) || [];
      const sentBack = h.filter((x) => x.created_at > d.created_at && BACK[role].has(x.to_value || "")).length;
      // Designers / editors: from the last "Output - In Progress" before delivery (or the task's start).
      let turnaround: number | null = null;
      if (role !== "writer") {
        const began = [...h].reverse().find((x) => x.created_at < d.created_at && x.to_value === "Output - In Progress")?.created_at || post.start_at;
        if (began && began < d.created_at) turnaround = Math.round(((Date.parse(d.created_at) - Date.parse(began)) / 86_400_000) * 10) / 10;
      }
      items.push({ id: d.post_id, title: post.particulars || "(no title)", type: post.type || "No type", sbu: post.sbu || "No Primary Interest", due, delivered: day, onTime: due ? day <= due : null, sentBack, turnaround });
    }
    return items.sort((x, y) => y.delivered.localeCompare(x.delivered));
  };

  const out: Person[] = people.map((p) => {
    const isMine = (type: string | null) => p.role === "writer" || (p.role === "editor") === VIDEO_TYPES.has(type || "");
    const items = deliveredAs(p.key, p.role);
    const extra: Extra[] = (["writer", "designer", "editor"] as Role[]).filter((r) => r !== p.role)
      .map((role) => { const its = deliveredAs(p.key, role); return { role, delivered: its.length, onTime: its.filter((d) => d.onTime).length, onTimeOf: its.filter((d) => d.onTime !== null).length, sentBack: its.filter((d) => d.sentBack).length, items: its }; })
      .filter((e) => e.delivered > 0);
    const mineNow = (open || []).filter((o) => o.owner_key === p.key && isMine(o.type) &&
      (p.role === "writer" ? ["Content - Pending", "Content - In Progress"].includes(o.status) : ["Content - Approved", "Output - In Progress", "Incorporating Feedback"].includes(o.status)));
    const mine = acts.filter((x) => x.actor_key === p.key);
    return {
      ...p, extra,
      delivered: items.length,
      onTime: items.filter((d) => d.onTime).length, onTimeOf: items.filter((d) => d.onTime !== null).length,
      sentBack: items.filter((d) => d.sentBack).length,
      turnaround: avg(items.map((d) => d.turnaround).filter((t): t is number => t !== null)),
      uploads: mine.filter((x) => x.action === "creative_added").length,
      edits: mine.filter((x) => x.action === "content_edited" || x.action === "caption_edited").length,
      created: (made || []).filter((m) => m.created_by === p.key).length,
      openNow: mineNow.length,
      overdueNow: mineNow.filter((o) => (o.due_date || o.publishing_date || "9999") < today).length,
      byType: group(items, (d) => d.type),
      bySbu: group(items, (d) => d.sbu),
      items,
    };
  });
  return { month, people: out };
}
