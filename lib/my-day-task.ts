import { TEAM_NAMES } from "@/lib/team-names";
// Shared My Day row mapping.
//
// mh_posts row -> the card shape the My Day client renders. It lives here rather than
// inside a route file because TWO routes need it — /api/my-day (the main board) and
// /api/my-day/created (the range-filtered "Tasks I created" card) — and Next.js does
// not allow a route module to export anything but its handlers and route config.
// One copy means the two endpoints can never drift into returning different shapes.

const OWNER_NAME = TEAM_NAMES;   // filled from the Team page roster (lib/team-names.ts)
// Mirror of the client PPL map so a collaborator key resolves to the same avatar/colour.
// `photo` (optional) rides along so the client avatar can show a profile picture
// when one exists; today it's unset and the client falls back to the initial.
const PPL_META: Record<string, { name: string; av: string; color: string; photo?: string }> = {
  manya: { name: "Manya", av: "M", color: "#E0791F" },
  praveen: { name: "Praveen", av: "P", color: "#C2410C" },
  nikhil: { name: "Nikhil", av: "N", color: "#3A57E8" },
  nandu: { name: "Nandu", av: "N", color: "#6E48F8" },
  maheen: { name: "Maheen", av: "M", color: "#2F9E6F" },
};
// Statuses still moving through the pipeline (the working view) + the queued
// Ready-to-Publish. Must match every status the client renders as in-view (the
// PreviewMyDay STATUS `inView` set) or a task moved into a missing status would vanish
// from the board after the post-write reconcile. Recently-published rows are fetched
// separately for the Done stat.
// Only real mh_status enum values — "Content - Needs Approval" is NOT in the enum
// and 502s the whole query. "Output - In Progress" (the producer's timer-running
// state) WAS added to the enum on 2026-07-19 and must be included, or a task the
// producer starts working would vanish from the board.
// Statuses that still take someone's time — what a day timeline plans. A writer
// plans pre-approval writing; everyone else plans approved work until it reaches
// Output - Ready. My Day already worked this way; Workload and Team Command kept
// finished, rejected and not-yet-theirs tasks on the timeline (Praveen, 21 Oct).
export function onDayPlan(status: string, writer: boolean): boolean {
  return writer
    ? status === "Content - Pending" || status === "Content - In Progress"
    : ["Content - Needs Approval", "Content - Approved", "Output - In Progress", "Incorporating Feedback"].includes(status);
}

export const WORKING = [
  "Content - Pending", "Content - In Progress", "Content - Approved", "Output - In Progress",
  "Incorporating Feedback", "Output - Ready", "Ready to Publish",
];

function ownerName(key: string | null): string {
  if (!key) return "Unclaimed";
  return OWNER_NAME[key.toLowerCase().trim()] || key;
}
function normPriority(p: string | null): "Urgent" | "High" | "Medium" | "Low" {
  const s = (p || "").toLowerCase();
  if (s.includes("urgent")) return "Urgent";
  if (s.includes("high")) return "High";
  if (s.includes("low")) return "Low";
  return "Medium";
}
function basename(url: string): string {
  try { return decodeURIComponent(url.split("?")[0].split("/").pop() || "file"); } catch { return "file"; }
}
export function isVideo(url: string): boolean {
  return /\.(mp4|mov|webm|m4v|avi)(\?|$)/i.test(url);
}
function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}
function ymd(d: string | null): string {
  return d ? String(d).slice(0, 10) : "";
}

export type Row = {
  id: string; particulars: string | null; type: string | null; status: string;
  sbu: string | null; owner_key: string | null; priority: string | null;
  content: string | null; caption: string | null; media_urls: string[] | null;
  publishing_date: string | null; due_date: string | null; updated_at: string | null;
  reference_links: string[] | null; output_link: string | null;
  created_at: string | null; start_at: string | null; end_at: string | null;
  duration_min: number | null;
  custom: Record<string, unknown> | null;
  created_by: string | null; instagram_url: string | null; facebook_url: string | null;
};
export type RefItem = { kind: "link" | "image"; label: string; url: string; attId?: string };
export type Creative = { name: string; type: "image" | "video" | "doc"; url: string; attId?: string; size?: number };

export function toTask(r: Row, refImages: RefItem[] = [], creativeAtts: Creative[] = [], collabKeys: string[] = [], workAtts: Creative[] = [], cover: { own: Creative | null; linked: Creative | null } = { own: null, linked: null }) {
  const owner = ownerName(r.owner_key);
  const type = r.type || "Post";
  const media = r.media_urls || [];
  const references: RefItem[] = [
    ...(r.reference_links || []).map((l) => ({ kind: "link" as const, label: l.replace(/^https?:\/\//i, ""), url: l })),
    ...refImages,
  ];
  // Creatives = the post's own media (media_urls) + any uploaded creative attachments.
  const creatives: Creative[] = [
    ...media.map((u) => ({ name: basename(u), type: (isVideo(u) ? "video" : "image") as "image" | "video", url: u })),
    ...creativeAtts,
  ];
  return {
    id: r.id,
    title: r.particulars || "Untitled",
    meta: owner === "Unclaimed" ? `${type} · unclaimed` : `${type} · owned by ${owner}`,
    status: r.status,
    // Overdue/due chip tracks the PUBLISHING DATE — that's the date the writer sets and
    // the team tracks. due_date is only a fallback (legacy tasks with no publishing date),
    // so a stray/stale due_date can't show a false "overdue" against the real publish date.
    due: ymd(r.publishing_date) || ymd(r.due_date) || "",
    detail: {
      typeLine: type,
      publishes: fmtDate(r.publishing_date),
      owner,
      priority: normPriority(r.priority),
      brand: r.sbu || "GooCampus",
      content: r.content || r.caption || "",
      creatives,
      // Collaborator (MY_DAY_SPEC §4). Primary source = the mh_post_collaborators
      // junction table (what the approve-handoff writes); custom.collaborator is a
      // harmless fallback for hand-seeded rows.
      collaborators: (() => {
        const keys = new Set<string>(collabKeys.map((k) => k.toLowerCase().trim()));
        const c = typeof r.custom?.collaborator === "string" ? (r.custom.collaborator as string).toLowerCase().trim() : "";
        if (c) keys.add(c);
        // Someone not in PPL_META (added on the Team page later) still gets a chip —
        // named from the roster, initial as avatar, neutral colour — rather than vanishing.
        return [...keys].map((k) => PPL_META[k] ?? { name: TEAM_NAMES[k] || k, av: (TEAM_NAMES[k] || k).charAt(0).toUpperCase(), color: "#8A92A6" });
      })(),
      // Who will be on camera, when someone registered for that without claiming
      // the task (the editor claims it and owns it; the presenter collaborates).
      presenter: typeof r.custom?.presenter_key === "string" ? (r.custom.presenter_key as string) : "",
      // Feedback notes shown highlighted on the producer's Incorporating-Feedback task.
      feedback: typeof r.custom?.incorporating_feedback === "string" ? (r.custom.incorporating_feedback as string) : "",
      activity: [] as unknown[],
      references,
      attachments: workAtts,                      // working files, never published
      // A reel's cover: its own Thumbnail box, and the linked thumbnail task's image
      // that stands in while the box is empty (docs/REEL_THUMBNAIL_SPEC.md).
      coverFile: cover.own,
      coverLinked: cover.linked,
      outputLink: r.output_link || "",
      createdAt: r.created_at || "",
      startAt: r.start_at || "",
      endAt: r.end_at || "",
      // Why the allotted time was raised, and by how much, each time it happened.
      extensions: Array.isArray(r.custom?.time_extensions) ? (r.custom.time_extensions as unknown[]) : [],
      // The companion thumbnail this video carries, if the writer asked for one. The
      // claim screen needs it to know whether to hand the thumbnail over with the video
      // or ask who should make it — docs/THUMBNAIL_FLOW_SPEC.md.
      thumbnail: (r.custom?.thumbnail && typeof r.custom.thumbnail === "object")
        ? (r.custom.thumbnail as { taskId?: string; decision?: string; type?: string })
        : null,
      duration: r.duration_min ?? undefined,
      createdBy: r.created_by || "",               // username of whoever created it
      ownerKey: r.owner_key || "",
      liveUrl: r.instagram_url || r.facebook_url || "", // once published
    },
  };
}
