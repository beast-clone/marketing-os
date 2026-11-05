"use client";
import { onDayPlan } from "@/lib/my-day-task";
import { useDraft } from "@/lib/use-draft";
import { openRefPreview } from "@/components/RefPreview";
import { Fragment, Suspense, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { SyncFromAirtable } from "./SyncFromAirtable";
import { AiPlanPanel, AiPlanBar, Brief, type Plan } from "./AiPlanner";
import { fmtDate, fmtDateShort, fmtDateTime } from "@/lib/date";
import { estimateTaskMinutes } from "@/lib/task-estimate";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { isTyping } from "@/app/(dashboard)/dashboard/preview/Shortcuts";

import { useUndo } from "@/app/(dashboard)/dashboard/preview/Undo";
import { LiveIndicator } from "@/components/LiveIndicator";
import { LoadingBlock } from "@/components/LoadingBlock";
import { NewTaskDialog } from "@/components/new-task/NewTaskDialog";
import { useSbus } from "@/lib/use-sbus";
import { FilterBuilder } from "@/components/FilterBuilder";
import { MultiPick, isPickNone } from "@/components/MultiPick";
import { RichTextField } from "@/components/RichTextField";
import { ClampBox } from "@/components/ClampBox";
import { PdfThumb } from "@/components/PdfThumb";
import { FilesCard, type FileTile } from "@/components/FilesCard";
import { linkify } from "@/components/Markdown";
import { EMPTY_FILTER, OPS_BY_TYPE, countConditions, evalFilter as evalFilterShared, summarizeFilter as summarizeFilterShared,
  type FieldType, type FilterCondition, type FilterFieldDef, type FilterModel, type FilterOp } from "@/lib/filter-model";
import { useApi } from "@/lib/use-api";
import type { TrashItem } from "@/lib/task-trash";
import { IconRestore, IconSearch, IconPaperclip, IconBrandInstagram, IconBrandFacebook, IconBrandLinkedin, IconBrandYoutube, IconFilter, IconLayoutList, IconPalette, IconBookmark, IconDeviceFloppy, IconUser, IconUsers, IconLock, IconDots, IconPencil, IconFileDescription, IconCopy, IconClipboardCopy, IconUserShare, IconDownload, IconPrinter, IconTrash, IconCheck, IconPlus, IconPhoto, IconCloudUpload, IconMessageCircle2, IconHistory, IconCalendarEvent, IconExternalLink, IconFileText, IconChevronLeft, IconChevronRight, IconChevronDown, IconX, IconPlayerPlay, IconArrowsSort, IconColumns, IconAlertTriangle, IconArrowRight, IconLink, IconSparkles } from "@tabler/icons-react";
import MissingFieldsModal, { gateFromResponse, type GateBlock } from "../MissingFieldsModal";
import { alertDialog, confirmDialog, promptDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";
import { pageForSbu } from "@/lib/sbu-pages";
import { pageInfo } from "@/lib/publish-pages";
import { usePublishPages } from "@/lib/use-publish-pages";
import { compressImage } from "@/lib/compress-image";
import { useUploadQueue } from "@/lib/use-upload-queue";
import { removeTaskFile, reorderTaskFiles } from "@/lib/upload-task-file";
import { showToast } from "../Toast";
import { useTeam, mergeTeam, NEWCOMER_COLOR, type TeamPerson } from "@/lib/use-team";
import { hubRoleFor } from "@/lib/hub-role";
import { sanitizeRichText } from "@/lib/sanitize-rich-text";
import { isVideoType, ALL_TYPES } from "@/lib/mh-content-types";
import { needsDateApproval, needsDateReason, hasCapability, canEditCalendar } from "@/lib/permissions";
import { shiftStartMin } from "@/lib/team-roles";
import { useAppSettings } from "@/lib/use-app-settings";
import { SoundVideo } from "@/components/SoundVideo";

export type Row = {
  id: string;
  particulars: string;
  type: string;
  status: string;
  sbu: string;
  owner: string;
  createdBy?: string;
  collaborators: string[];
  platforms: string[];
  publishTo: string;
  publishToPage: string;
  priority: string;
  publishingDate: string;
  dueDate: string;
  completionTime: string;
  createdDate: string;
  lastModified: string;
  startAt: string;
  endAt: string;
  durationMin?: number | null;
  needsReview: boolean;
  syncedToScheduler: boolean;
  caption: string;
  content: string;
  additionalInfo: string;
  outputLink: string;
  instagramUrl: string;
  facebookUrl: string;
  linkedinUrl: string;
  link: string;
  slackLink: string;
  attachments: { url: string; filename: string; type?: string }[];
  custom?: Record<string, unknown>;
};

export type Facets = {
  sbu: string[]; type: string[]; status: string[]; owner: string[];
  priority: string[]; platforms: string[]; publishTo: string[];
};

export type Data = {
  range: { from: string; to: string; days: number };
  totalInRange: number;
  rows: Row[];
  facets: Facets;
  generatedAt: string;
  latencyMs: number;
  cached?: boolean;
  openId?: string | null;
};

// One color per SBU — stable across renders so the calendar reads consistently.
const SBU_COLORS = ["#378ADD", "#5DCAA5", "#EF9F27", "#D4537E", "#7F77DD", "#F5C4B3", "#9FE1CB", "#FAC775", "#B5D4F4", "#F4C0D1", "#B4B2A9", "#F0997B"];

function sbuColor(sbu: string, all: string[]): string {
  const i = all.indexOf(sbu);
  if (i < 0) return "#B4B2A9";
  return SBU_COLORS[i % SBU_COLORS.length];
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-IN");
}

// Friendly date: "2026-07-06" → "6 Jul 2026" (the format the team uses).
// Friendly dates come from the shared helper (lib/date) so the whole dashboard
// reads the same: fmtDate = "Tuesday, 28 July 2026" (prominent), fmtDateShort =
// "Tue, 28 Jul 2026" (table cells), fmtDateTime = date + time (timestamps).

type Role = "writer" | "designer" | "editor" | "manager";
type TeamMember = { key: string; label: string; role: Role; aliases: string[]; color: string; displayRole: string; av: string };

// Same roster + roles/colours/avatars as the My Day team (PreviewMyDay.tsx), so the
// workload reads consistently with the team's day view. Maheen assigns work, doesn't
// receive it — kept out of the workload cards.
// Today's team, with the colours/aliases the roster doesn't carry. Anyone added on
// the Team page is appended at runtime by MarketingHubShell (mergeTeam), so they
// appear in the owner picker, filters, views and Team tab without a code change.
const TEAM: TeamMember[] = [
  { key: "manya", label: "Manya", role: "writer",   aliases: ["Manya B M", "Manya BM", "Manya"],                    color: "#E0791F", displayRole: "Content writer", av: "M" },
  { key: "praveen", label: "Praveen", role: "designer", aliases: ["Praveen L", "Praveen"],                          color: "#C2410C", displayRole: "Designer", av: "P" },
  { key: "nikhil", label: "Nikhil", role: "editor", aliases: ["NIKHI Shyamraj", "Nikhil Shyamraj", "Nikhil"],       color: "#3A57E8", displayRole: "Video editor", av: "N" },
  { key: "nandu", label: "Nandu", role: "editor", aliases: ["Nandu C", "Nandu"],                                   color: "#3A57E8", displayRole: "Video editor", av: "Nd" },
];

const ROLE_LABEL: Record<Role, string> = {
  writer: "Content writer",
  designer: "Graphic designer",
  editor: "Video editor",
  manager: "Manager",
};

const ROLE_HIGHLIGHT: Record<Role, string> = {
  writer: "Content pending",
  designer: "Designs pending",
  editor: "Videos to edit",
  manager: "Awaiting approval",
};

function newcomer(p: TeamPerson): TeamMember {
  return { key: p.id, label: p.first, role: hubRoleFor(p.role), aliases: [p.name, p.first],
    color: NEWCOMER_COLOR, displayRole: p.role, av: p.initials || p.first.charAt(0).toUpperCase() };
}

/** Add Team-page newcomers to TEAM and re-render once they arrive. Call at the top
 *  of any screen built from this file (the Hub itself, My Day's MemberHub). */
export function useHubTeam() {
  const team = useTeam();
  const [, bump] = useState(0);
  useEffect(() => {
    if (mergeTeam(TEAM, team, (m) => m.key, newcomer, ["maheen"])) bump((n) => n + 1);
  }, [team]);
}

function ownerMatches(owner: string, m: TeamMember): boolean {
  if (!owner) return false;
  return m.aliases.some((a) => owner.toLowerCase() === a.toLowerCase());
}

const PENDING_STATUSES = ["Content - Pending", "Content - Approved"];
const DONE_STATUSES = ["Ready to Publish", "Published/Scheduled"];

// The one shared list (lib/mh-content-types) — this file had its own copy without
// "Meta Ads - Video" and "Story (Video)", so Workload counted and coloured those as design.
const VIDEO_TYPES = { includes: (t: string) => isVideoType(t) };
const DESIGN_TYPES = ["Post", "Carousel", "Reel Thumbnail", "YouTube Thumbnail", "Meta Ads", "Story (Image)"];

// --- Planned-day timeline (Workload tab) ---------------------------------------
// The team doesn't log start/stop times, so we lay each person's real pending tasks
// into a suggested day-plan (9 AM–6 PM, 1h lunch). It's a PLAN, not live tracking.
const WORK_START_H = 9, WORK_END_H = 19;   // 9 AM – 7 PM (covers both shifts: 9–6 and 10–7)
const SPAN_MIN = (WORK_END_H - WORK_START_H) * 60; // 600 — the width the timeline DRAWS

// Nobody actually works all ten of those hours. A shift is 8h of work plus an hour
// of lunch, and the span is wide only so the 9–6 and 10–7 shifts can share one
// timeline. Capacity has to come from the person's own shift, not the drawing
// width — using SPAN_MIN gave everyone on the 9–6 shift a phantom extra hour and
// made this screen disagree with My Day about the same person's free time.
const SHIFT_MIN = 9 * 60;                  // 540 = 8h work + 1h lunch
// Each person's start comes from "Shift starts" on the Team page (was: Nandu 10–7,
// typed in). Kept inside the 9 AM–7 PM drawing.
const shiftStart = (m: { key: string }) => Math.min(SPAN_MIN - SHIFT_MIN, Math.max(0, shiftStartMin(m.key) - 9 * 60));
const shiftEnd = (m: { key: string }) => shiftStart(m) + SHIFT_MIN;
const LUNCH_AT_MIN = 240;                  // ~1 PM
const LUNCH_MIN = 60;
const HOUR_TICKS = ["9 AM", "10", "11", "12", "1 PM", "2", "3", "4", "5", "6"];

// Rough time each content type takes to produce — just for laying out the plan bar.
// Shared with My Day (lib/task-estimate) so a task's estimated length is identical
// in the Workload timeline and the personal Today's-plan.
const taskDurMin = estimateTaskMinutes;
// A task's length on the timeline: the duration its person set in My Day when there
// is one, otherwise the estimate for its type — so Workload and My Day show the same
// task the same length (Praveen, 22 Oct: "is it working according to the timelines
// of the task, or is it demo data?").
const rowDurMin = (r: Row) => (r.durationMin && r.durationMin > 0 ? r.durationMin : taskDurMin(r.type));
// Minutes after 9 AM that a task was actually started today, or null.
function startedTodayMin(r: Row): number | null {
  if (r.status !== "Output - In Progress" || !r.startAt) return null;
  const d = new Date(r.startAt);
  if (Number.isNaN(d.getTime()) || ymd(d) !== ymd(new Date())) return null;
  return Math.max(0, (d.getHours() - WORK_START_H) * 60 + d.getMinutes());
}
// On camera counts on the presenter's workload too, as a one-hour shoot — the
// editor owns the task and its duration (Nikhil, 9 & 13 Oct; same rule as My Day).
const SHOOT_MIN = 60;
function presentsOn(r: Row, m: TeamMember): boolean {
  const p = typeof r.custom?.presenter_key === "string" ? (r.custom.presenter_key as string).toLowerCase() : "";
  return p === m.key && !ownerMatches(r.owner, m) && (r.status === "Content - Approved" || r.status === "Output - In Progress");
}
function blockColor(type: string): { bg: string; fg: string } {
  if (VIDEO_TYPES.includes(type)) return { bg: "#DDE3FB", fg: "#2A3EA8" };  // blue — video
  if (DESIGN_TYPES.includes(type)) return { bg: "#EDE9FE", fg: "#5B4AC4" }; // violet — design
  return { bg: "#E1F5EE", fg: "#0F6E56" };                                   // teal — writing/other
}

// Every status a task can be moved to. PIPELINE_STAGES is the BOARD (the columns
// people drag between); this list is what /api/marketing-hub/update will accept,
// which also includes "Content - In Progress" — a real stage that has no column.
// Anything outside this set is rejected by the API with a 400.
const PRIORITY_CHOICES = ["Urgent", "High", "Medium", "Low"];

// Where the Master sheet remembers how you left it, per browser.
const MASTER_VIEW_KEY = "mh-master-view";

// Where the Content Calendar remembers its SBU / status filters, per browser.
const CAL_FILTER_KEY = "mh-cal-filters";

const STATUS_CHOICES = [
  "Content - Pending", "Content - In Progress", "Content - Needs Approval",
  "Content - Approved", "Output - In Progress", "Incorporating Feedback",
  "Output - Ready", "Ready to Publish", "Published/Scheduled",
  "Rejected/Not Published", "Failed",
];

// Muted, cohesive stage palette (all one tone — no neon, no harsh navy).
const PIPELINE_STAGES = [
  { key: "Content - Pending",     label: "Content Pending",     color: "#94A3B8" },
  { key: "Content - Approved",    label: "Approved",            color: "#D9A05B" },
  { key: "Output - In Progress",  label: "In Progress",         color: "#D9836E" },
  { key: "Incorporating Feedback", label: "Incorporating Feedback", color: "#DD6B7B" },
  { key: "Output - Ready",        label: "Output Ready",        color: "#6F9BD1" },
  { key: "Ready to Publish",      label: "Ready to Publish",    color: "#5FB196" },
  { key: "Published/Scheduled",   label: "Published",           color: "#7A74C9" },
];

// The board above is the seven columns people drag between. The SIDEBAR lists every
// status a task can be in — all eleven Airtable offers — because a status with no
// board column (Needs Approval, Rejected, Failed) is exactly the one you go looking
// for and cannot find (the team, 28 Sep).
/** One hue per content family — reels blue, carousels violet, and so on. */
function typeColour(t: string): string {
  const s = t.toLowerCase();
  if (s.includes("thumbnail")) return "#0F9E75";
  if (s.includes("reel")) return "#3A57E8";
  if (s.includes("carousel")) return "#6D5CE7";
  if (s.includes("youtube") || s.includes("long-form") || s.includes("short")) return "#2138B0";
  if (s.includes("story")) return "#C2410C";
  if (s.includes("ad")) return "#B0778A";
  if (s.includes("essay")) return "#8A92A6";
  return "#E0791F";
}

const ALL_STATUSES = [
  { key: "Content - Pending",      label: "Content Pending",      color: "#94A3B8" },
  { key: "Content - In Progress",  label: "Content In Progress",  color: "#B8927A" },
  { key: "Content - Needs Approval", label: "Needs Approval",     color: "#C9954F" },
  { key: "Content - Approved",     label: "Approved",             color: "#D9A05B" },
  { key: "Output - In Progress",   label: "In Progress",          color: "#D9836E" },
  { key: "Incorporating Feedback", label: "Incorporating Feedback", color: "#DD6B7B" },
  { key: "Output - Ready",         label: "Output Ready",         color: "#6F9BD1" },
  { key: "Ready to Publish",       label: "Ready to Publish",     color: "#5FB196" },
  { key: "Published/Scheduled",    label: "Published",            color: "#7A74C9" },
  { key: "Rejected/Not Published", label: "Rejected",             color: "#B0778A" },
  { key: "Failed",                 label: "Failed",               color: "#C0392B" },
];

// SINGLE source of truth for status pill colours — soft themed pills, each hue
// tinted from its PIPELINE_STAGES dot, so a status reads identically in the
// Pipeline (dot), Master sheet (pill) and Calendar (bar). Was 3 separate maps.
// Status colours, taken from the Content Calendar's own Status field in Airtable.
//
// "Change the content status colours to same like airtable so that it's clearly
// visible, now everything is looking the same" (Manya, 5 Oct, on the calendar).
// She was right: the old set were all pastels around 94% lightness, so at the size
// of a calendar chip they really did read as one off-white — and four statuses were
// missing from the map entirely and came out grey like the rest.
//
// Two of Airtable's choices could not be copied literally. Airtable gives only six
// distinct colours to these eleven statuses: blueBright covers Content-In Progress,
// Output-In Progress, Output-Ready AND Incorporating Feedback, and grayDark1 covers
// both Content-Pending and Rejected. Copying that exactly would have reproduced the
// problem she reported. So the colours Airtable does distinguish are kept exactly,
// and the collisions are spread across Airtable's own shades of the same hue — its
// blue ramp for the four blues, its grey ramp for the two greys. It still looks like
// Airtable, and every status is now tellable apart.
const STATUS_TINT: Record<string, { bg: string; text: string; border: string }> = {
  "Content - Pending":      { bg: "var(--st-pending-bg, #444444)",   text: "var(--st-pending-fg, #FFFFFF)",   border: "var(--st-pending-bd, #333333)" },   // grayDark1
  "Content - In Progress":  { bg: "var(--st-cinprog-bg, #CFDFFF)",   text: "var(--st-cinprog-fg, #1B3A6B)",   border: "var(--st-cinprog-bd, #AFC8F5)" },   // blueBright -> blueLight2
  "Content - Needs Approval": { bg: "var(--st-needsappr-bg, #F82B60)", text: "var(--st-needsappr-fg, #FFFFFF)", border: "var(--st-needsappr-bd, #D81B4C)" }, // redBright
  "Content - Approved":     { bg: "var(--st-approved-bg, #D1F7C4)",  text: "var(--st-approved-fg, #1D4D12)",  border: "var(--st-approved-bd, #B3E8A0)" },  // greenLight2
  "Output - In Progress":   { bg: "var(--st-inprog-bg, #2D7FF9)",    text: "var(--st-inprog-fg, #FFFFFF)",    border: "var(--st-inprog-bd, #1E66D0)" },    // blueBright
  "Output - Ready":         { bg: "var(--st-ready-bg, #9CC7FF)",     text: "var(--st-ready-fg, #17457F)",     border: "var(--st-ready-bd, #7FB2F5)" },     // blueBright -> blueLight1
  "Incorporating Feedback": { bg: "var(--st-feedback-bg, #2750AE)",  text: "var(--st-feedback-fg, #FFFFFF)",  border: "var(--st-feedback-bd, #1E3F8C)" },  // blueBright -> blueDark1
  "Ready to Publish":       { bg: "var(--st-topublish-bg, #20C933)", text: "var(--st-topublish-fg, #FFFFFF)", border: "var(--st-topublish-bd, #18A528)" }, // greenBright
  "Published/Scheduled":    { bg: "var(--st-published-bg, #93E088)", text: "var(--st-published-fg, #1D4D12)", border: "var(--st-published-bd, #76CE6A)" }, // greenLight1
  "Rejected/Not Published": { bg: "var(--st-rejected-bg, #CFCFCF)",  text: "var(--st-rejected-fg, #3A3A3A)",  border: "var(--st-rejected-bd, #B8B8B8)" },  // grayDark1 -> grayLight1
  "Failed":                 { bg: "var(--st-failed-bg, #BA1E45)",    text: "var(--st-failed-fg, #FFFFFF)",    border: "var(--st-failed-bd, #991736)" },    // redDark1
};
const STATUS_TINT_FALLBACK = { bg: "var(--st-unknown-bg, #EEEEEE)", text: "var(--st-unknown-fg, #3A3A3A)", border: "var(--st-unknown-bd, #D6D6D6)" };
// (bg/text/border read --st-* vars, set only in the dark theme — globals.css.)

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// --- Work-week helpers (Workload tab) ------------------------------------------
// The team works Mon–Fri. "Week" means the REST of THIS work-week — today through
// Friday — never a rolling 7 days into next week. On a weekend it's empty.
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Thursday · 30 Jul 2026"
function friendlyDate(d: Date): string {
  return `${WEEKDAY_LONG[d.getDay()]} · ${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}
// Monday–Friday of the current work-week (always all 5 days). Weekend → [].
function currentWorkWeek(from: Date = new Date()): Date[] {
  const dow = from.getDay();                        // 0 Sun … 6 Sat
  if (dow === 0 || dow === 6) return [];            // weekend — no work days left
  const monday = new Date(from.getFullYear(), from.getMonth(), from.getDate() - (dow - 1));
  return Array.from({ length: 5 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
}

// Subtab → breadcrumb label, so the header reads "Marketing Hub › Pipeline" etc.
// and you always know which subtab you're on.
const SUBTAB_LABEL: Record<string, string> = {
  team: "Workload", master: "Master sheet", pipeline: "Pipeline", calendar: "Content Calendar",
};
const SUBTAB_SUBTITLE: Record<string, string> = {
  team: "Each teammate's plan and capacity for the day.",
  master: "The master sheet — every task, every column. Filter, sort, save views.",
  pipeline: "How many pieces of content are at each step right now.",
  calendar: "The team's publishing schedule, month at a glance — drag to reschedule.",
};

function MarketingHubShell() {
  useHubTeam();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") || "team";
  const tab = ["team", "master", "pipeline", "calendar"].includes(tabParam) ? tabParam : "master";
  const mentorship = tab === "calendar" && searchParams.get("channel") === "goocampusworld";
  return (
    <PreviewDashboardShell
      active="marketing-hub"
      // Each sub-tab its own intro: all four used to show the Master sheet's.
      // A key with no TAB_INTRO entry (pipeline, calendar for now) shows none.
      introTab={tab === "master" ? "marketing-hub" : `marketing-hub-${tab}`}
      title={`Marketing Hub › ${mentorship ? "Mentorship Calendar" : SUBTAB_LABEL[tab]}`}
      subtitle={mentorship ? "Mentorship Platform and 10K Mentorship only — month at a glance, drag to reschedule." : SUBTAB_SUBTITLE[tab]}
      hideAccountPicker
      hideRange
    >
      {({ range, setRange }) => <Inner range={range} setRange={setRange} />}
    </PreviewDashboardShell>
  );
}

export function MarketingHubPage() {
  useAppSettings();   // task times from the Rules page (Workload timeline)
  return (
    <Suspense fallback={null}>
      <MarketingHubShell />
    </Suspense>
  );
}

// ── Publish-date approval (requester side) ─────────────────────────────────────
// Moving a task's PUBLISH DATE is the one edit that needs Maheen's sign-off. When
// a non-admin (e.g. Manya) changes it, we pop a modal for the reason and send the
// change for approval instead of applying it; the new date only lands once Maheen
// approves it (in My Day → Publish-date approvals). Maheen's own edits apply at
// once. Both the Master-sheet cell and the calendar drag route through this so the
// popup + confirmation behave identically wherever the date is touched.
type ApprovalOutcome = "applied" | "pending" | "cancelled" | "error";
type PublishApprovalCtx = {
  ready: boolean;
  isAdmin: boolean;
  // Change a task's publish date with the approval gate. `to` = new yyyy-mm-dd (or
  // null to clear). Returns what happened so the caller can refresh or revert.
  changePublishDate: (args: { id: string; title: string; from: string | null; to: string | null; source?: "calendar" }) => Promise<ApprovalOutcome>;
};
const PublishApprovalContext = createContext<PublishApprovalCtx | null>(null);
const dayOf = (d: string | null) => (d ? String(d).slice(0, 10) : null);

export function PublishApprovalProvider({ children }: { children: React.ReactNode }) {
  const [viewer, setViewer] = useState<{ ready: boolean; isAdmin: boolean; needsApproval: boolean; needsReason: boolean }>({ ready: false, isAdmin: false, needsApproval: true, needsReason: true });
  // The open reason-modal, with the promise resolver that changePublishDate awaits.
  const [ask, setAsk] = useState<null | { id: string; title: string; from: string | null; to: string | null; resolve: (reason: string | null) => void }>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // One dashboard-wide toast, top centre (see preview/Toast.tsx) — this tab used to
  // draw its own at the bottom of the screen.
  const setToast = useCallback((t: string | null) => showToast(t ? { who: t, color: "#3A57E8", av: "✓" } : null), []);

  useEffect(() => {
    // Whether MY date changes wait for approval is set per person (Team & access).
    fetch("/api/me").then((r) => r.json()).then((d) => setViewer({ ready: true, isAdmin: !!d?.user?.isAdmin, needsApproval: needsDateApproval(d?.user), needsReason: needsDateReason(d?.user) })).catch(() => setViewer({ ready: true, isAdmin: false, needsApproval: true, needsReason: true }));
  }, []);


  const changePublishDate = useCallback(async (a: { id: string; title: string; from: string | null; to: string | null; source?: "calendar" }): Promise<ApprovalOutcome> => {
    const src = a.source ? { source: a.source } : {};
    if (dayOf(a.from) === dayOf(a.to)) return "applied"; // no-op: same day
    // A dateless task getting its first date isn't a move — no popup (the server agrees).
    if (!a.from) {
      const r = await saveField(a.id, { publishing_date: a.to }, src);
      if (!r.ok) return "error";
      if (r.pendingApproval) { setToast(`Sent for admin approval — “${a.title}” moves to ${fmtDateShort(a.to || "")} once it's approved.`); return "pending"; }
      return "applied";
    }
    // A date MOVE asks why — the reason lands in the task's history (Praveen, 22 Oct),
    // and with approval on it also goes to the admin. Asking is a switch per person on
    // Team & access ("Ask why when a date moves"); with it off and no approval needed
    // the date just changes, and with approval needed the popup still confirms the
    // request but the reason is optional.
    if (!viewer.needsReason && !viewer.needsApproval) {
      const r0 = await saveField(a.id, { publishing_date: a.to }, src);
      return r0.ok ? (r0.pendingApproval ? "pending" : "applied") : "error";
    }
    const reasonText = await new Promise<string | null>((resolve) => { setReason(""); setAsk({ ...a, resolve }); });
    if (reasonText === null) return "cancelled";
    const r = await saveField(a.id, { publishing_date: a.to }, { reason: reasonText, ...src });
    if (!r.ok) return "error";
    if (r.pendingApproval) { setToast(`Sent for admin approval — “${a.title}” moves to ${fmtDateShort(a.to || "")} once it's approved.`); return "pending"; }
    return "applied";
  }, [viewer.needsApproval, viewer.needsReason]);

  const submit = async () => {
    if (!ask) return;
    setBusy(true);
    const resolve = ask.resolve;
    setAsk(null); setBusy(false);
    resolve(reason.trim()); // required unless the person's "Ask why" switch is off
  };
  const cancel = () => { if (!ask) return; const resolve = ask.resolve; setAsk(null); resolve(null); };

  return (
    <PublishApprovalContext.Provider value={{ ready: viewer.ready, isAdmin: viewer.isAdmin, changePublishDate }}>
      {children}
      {ask && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/30 px-4" data-overlay onClick={cancel}>
          <div className="w-full max-w-md bg-white rounded-2xl border border-gray-100 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-brand-light text-brand flex items-center justify-center flex-shrink-0"><IconCalendarEvent size={18} stroke={1.8} /></div>
              <div className="min-w-0">
                <div className="text-[15px] font-medium text-[#232D42]">{viewer.needsApproval ? "Change needs admin approval" : "Why is the date changing?"}</div>
                <div className="text-[13px] text-[#8A92A6] mt-0.5">{viewer.needsApproval ? "You’re moving the publish date. An admin approves it before it goes live." : "Add a short reason — it’s saved in the task’s history."}</div>
              </div>
            </div>
            <div className="mt-4 rounded-xl bg-[#F6F7FB] border border-gray-100 px-3 py-2.5">
              <div className="text-[13px] font-medium text-[#232D42] truncate">{ask.title}</div>
              <div className="text-[13px] text-[#232D42] mt-1"><IconCalendarEvent size={14} stroke={1.8} className="inline -mt-0.5 mr-1" /><b>{ask.from ? fmtDateShort(ask.from) : "unset"}</b> <IconArrowRight size={13} className="inline -mt-0.5 text-gray-400" /> <b className="text-brand">{ask.to ? fmtDateShort(ask.to) : "unset"}</b></div>
            </div>
            <label className="block text-[12.5px] font-medium text-[#232D42] mt-4 mb-1">Reason for the change{!viewer.needsReason && <span className="font-normal text-[#8A92A6]"> (optional)</span>}</label>
            <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="e.g. Client moved the campaign launch to mid-October…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] resize-none focus:outline-none focus:border-brand" />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={cancel} disabled={busy} className="px-3.5 py-2 rounded-lg text-[13px] font-medium text-[#232D42] border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button onClick={submit} disabled={busy || (viewer.needsReason && !reason.trim())} className="px-3.5 py-2 rounded-lg text-[13px] font-medium text-white bg-brand hover:bg-brand-dark disabled:opacity-60">{viewer.needsApproval ? "Send for approval" : "Change date"}</button>
            </div>
          </div>
        </div>
      )}
    </PublishApprovalContext.Provider>
  );
}

function usePublishApproval(): PublishApprovalCtx {
  const ctx = useContext(PublishApprovalContext);
  // Fallback keeps the components usable outside the provider (e.g. isolated tests):
  // no gate, edits apply straight through.
  return ctx ?? { ready: true, isAdmin: true, changePublishDate: async ({ id, from, to }) => {
    if (dayOf(from) === dayOf(to)) return "applied";
    const r = await saveField(id, { publishing_date: to }); return r.ok ? "applied" : "error";
  } };
}

function Inner({ range, setRange }: { range: { from: string; to: string }; setRange: (r: { from: string; to: string }) => void }) {
  // Deep-link: /dashboard/preview/marketing-hub?open=<mh_posts.id> opens that task.
  const openParam = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("open") || "" : "";

  // Sub-tab is driven by ?tab= so the sidebar folder (Master sheet · Team ·
  // Pipeline · Content calendar · Next 7 days) deep-links reactively — Next's
  // <Link> updates useSearchParams without a reload (a URL #hash would not fire
  // a hashchange on Link's pushState, so tabs wouldn't switch until refresh).
  const searchParams = useSearchParams();
  const TABS = ["team", "master", "pipeline", "calendar"];
  const tabParam = searchParams.get("tab") || "team";
  const tab = TABS.includes(tabParam) ? tabParam : "master";

  // The Content Calendar is forward-looking: it must show UPCOMING scheduled
  // content, not the retrospective "last N days" window (to = today) that the
  // Master/Workload/Pipeline tabs share. Without this the whole future half of
  // the visible month renders empty even though posts are scheduled there.
  // Fetch a wide past+future window instead (mh_posts is small, so this is cheap).
  // ponytail: fixed ±window; months outside it render empty (see byDay note ~L1070).
  const fetchRange = tab === "calendar"
    ? { from: ymd(new Date(Date.now() - 180 * 86_400_000)), to: ymd(new Date(Date.now() + 365 * 86_400_000)) }
    : tab === "team"
    // Workload plans each person's day from ALL their open work, as My Day does — a
    // task publishing in three weeks or overdue by two months is still on their plan.
    // (It used to read only ~30 days back and 7 ahead, so the bar showed free time
    // the person didn't have.)
    ? { from: ymd(new Date(Date.now() - 120 * 86_400_000)), to: ymd(new Date(Date.now() + 120 * 86_400_000)) }
    : tab === "pipeline"
    // Pipeline counts ALL open work whatever its date (a post stuck since September must
    // not drop off), so look a year back; Published is cut to the last 30 days in the view.
    ? { from: ymd(new Date(Date.now() - 365 * 86_400_000)), to: ymd(new Date(Date.now() + 365 * 86_400_000)) }
    // Master sheet / Pipeline: the range picks how far BACK to look; everything
    // planned ahead is always included (imported Airtable tasks are mostly future).
    : { from: range.from, to: ymd(new Date(Date.now() + 365 * 86_400_000)) };
  const qs = new URLSearchParams({ from: fetchRange.from, to: fetchRange.to, ...(openParam ? { open: openParam } : {}) }).toString();
  const { data, error, isLoading, refresh } = useApi<Data>(`/api/marketing-hub?${qs}`);
  // Stamp when data lands so the Live chip shows a real "fetched Ns ago" instead of "…".
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  useEffect(() => { if (data) setFetchedAt(Date.now()); }, [data]);

  const [filters, setFilters] = useState<{ sbu: string; type: string; status: string; owner: string; priority: string }>({
    sbu: "", type: "", status: "", owner: "", priority: "",
  });
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // The task you arrived for. Survives the modal closing, so the sheet can still say
  // "this one" — otherwise a freshly created task is a row like any other in 145.
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (filters.sbu && r.sbu !== filters.sbu) return false;
      if (filters.type && r.type !== filters.type) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.owner && r.owner !== filters.owner) return false;
      if (filters.priority && r.priority !== filters.priority) return false;
      if (q) {
        const hay = `${r.particulars} ${r.caption} ${r.content} ${r.sbu}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, filters, search]);

  const openRow = openId ? data?.rows.find((r) => r.id === openId) || null : null;

  // Auto-open the deep-linked task (from /me), once, when its row arrives.
  useEffect(() => {
    if (openParam && data?.openId) {
      setOpenId(data.openId);
      setHighlightId(data.openId);
      // strip ?open so closing the modal doesn't reopen it and a manual refresh stays put
      if (typeof window !== "undefined") {
        const u = new URL(window.location.href);
        u.searchParams.delete("open");
        window.history.replaceState({}, "", u.pathname + (u.search ? u.search : ""));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.openId]);

  return (
    <PublishApprovalProvider>
    <div className="space-y-6">
      {/* Top bar: entries count · global search · live. Workload + Master drive their
          own filtering (person cards / views rail), so they hide the count + search. */}
      <div className="flex items-center gap-4">
        {tab !== "team" && tab !== "master" && (
          <>
            <div className="text-base text-gray-500 flex-shrink-0">
              {tab === "pipeline" ? null : data ? <>{fmtInt(filtered.length)} of {fmtInt(data.totalInRange)} entries in this range{data.cached ? " · cached" : ""}</> : isLoading ? "Loading…" : ""}
            </div>
            <div className="relative flex-1 max-w-md">
              <IconSearch size={16} stroke={1.8} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tasks by title, caption…"
                className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm"
              />
            </div>
          </>
        )}
        <div className="ml-auto flex-shrink-0 flex items-center gap-2">
          {/* Up here with the page's other actions — a floating button at the bottom
              was easy to miss (Praveen, 26 Oct). */}
          {tab !== "pipeline" && <HubNewTaskButton onCreated={refresh} />}
          {/* The plan lives in Airtable; this is how a window of it gets here. */}
          {tab === "master" && <SyncFromAirtable onImported={refresh} />}
          {/* Not on the Master sheet (it refreshes itself after every edit) — except the
              red "Not live" state, so a failed load is never silent. */}
          {(tab !== "master" || error) && <LiveIndicator fetchedAt={fetchedAt} loading={isLoading} onRefresh={refresh} error={error ? error.message : null} />}
        </div>
      </div>

      {/* The Content Calendar filters inside its own card (brand chips + view toggle),
          so there's no redundant floating filter row above it — matches the Publishing
          Calendar's clean layout. Master/Workload/Pipeline have their own controls. */}

      {tab === "master" && (
        <MasterTab allRows={data?.rows || []} facets={data?.facets} range={range} setRange={setRange} onOpen={setOpenId} onSaved={refresh} loading={isLoading} highlightId={highlightId} />
      )}

      {tab === "team" && (
        <TeamView rows={filtered} allRows={data?.rows || []} facets={data?.facets} onOpen={setOpenId} loading={isLoading} />
      )}

      {tab === "pipeline" && (
        <PipelineView rows={filtered} facets={data?.facets} onOpen={setOpenId} loading={isLoading} />
      )}

      {tab === "calendar" && (
        <CalendarView rows={filtered} facets={data?.facets} onOpen={setOpenId} onSaved={refresh} loading={isLoading} />
      )}

      {openRow && <DetailModal key={openRow.id} row={openRow} onClose={() => setOpenId(null)} />}

      {data && (
        <div className="text-xs text-gray-400 text-right">
          Generated {new Date(data.generatedAt).toLocaleString("en-IN")} · {data.latencyMs}ms
        </div>
      )}
    </div>
    </PublishApprovalProvider>
  );
}

// Was a native <select>, which renders the OS widget and reads as V1 on sight.
// PreviewSelect is the themed one the Scheduler already uses.
function CompactFacet({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <PreviewSelect
      value={value}
      onChange={onChange}
      placeholder={label}
      options={options.map((o) => ({ value: o, label: o }))}
    />
  );
}

// A choice that survives switching hub tabs and reloads, like the calendar's filters
// (each tab is rebuilt when you come back to it). `ok` rejects stale saved values.
function useSticky<T>(key: string, initial: T, ok: (v: unknown) => boolean): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(key) || "null"); if (s !== null && ok(s)) setV(s as T); } catch { /* private mode */ }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [v, (next: T) => { setV(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private mode */ } }];
}

// TEAM sub-tab — one card per teammate; click a card to open their full task
// list INLINE below the cards (all statuses), not a pop-up.
export function TeamView({ rows, allRows, facets, onOpen, loading }: { rows: Row[]; allRows: Row[]; facets?: Facets; onOpen: (id: string) => void; loading: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useSticky<"today" | "week">("mh-team-view", "today", (x) => x === "today" || x === "week");
  const todayDate = new Date();
  const today = ymd(todayDate);
  const friendlyToday = friendlyDate(todayDate);
  const weekdays = currentWorkWeek(todayDate);                    // Mon–Fri of this week (empty on weekend)
  const weekStart = weekdays.length ? ymd(weekdays[0]) : today;
  const weekEnd = weekdays.length ? ymd(weekdays[weekdays.length - 1]) : today;
  const weekAgo = ymd(new Date(Date.now() - 7 * 86_400_000));

  const teamCards = useMemo(() => TEAM.map((m) => {
    // Everyone's own work regardless of the page's SBU/owner/search filters (it's their
    // day), and Samvaya work only on Nandu's — the same set My Day plans from.
    const mine = allRows.filter((r) => (ownerMatches(r.owner, m) || presentsOn(r, m)) && (m.label === "Nandu" || !/samvaya|matrimony/i.test(r.sbu || "")));
    let today_ = 0, week = 0, overdue_ = 0, done_ = 0, roleHighlight = 0;
    for (const r of mine) {
      const pd = r.publishingDate?.slice(0, 10) || "";
      const dd = r.dueDate?.slice(0, 10) || "";
      // Output - Ready is finished as far as the person who made it is concerned — it is
      // waiting on Content Review, not on them — so it no longer counts as their
      // today / this week / overdue work (Praveen, 22 Oct). A rejected task is not work
      // anyone owes either — it was counting as overdue.
      const isDone = DONE_STATUSES.includes(r.status) || r.status === "Output - Ready" || r.status === "Rejected/Not Published";
      if (pd === today && !isDone) today_ += 1;
      // "This week" = Monday through Friday of the current work-week.
      if (pd && pd >= weekStart && pd <= weekEnd && !isDone) week += 1;
      // Overdue = its date (publishing, else due) has passed, it isn't done, and it's at
      // this person's stage — work waiting on someone else isn't their overdue. Same
      // rule as the Overdue table below the bar.
      const onMyStage = presentsOn(r, m) || onDayPlan(r.status, m.role === "writer");
      if (!isDone && onMyStage && (pd || dd) && (pd || dd) < today && startedTodayMin(r) == null) overdue_ += 1;
      if (r.completionTime && r.completionTime.slice(0, 10) >= weekAgo) done_ += 1;
    }
    if (m.role === "writer") {
      roleHighlight = mine.filter((r) => r.status === "Content - Pending").length;
    } else if (m.role === "designer") {
      roleHighlight = mine.filter((r) => DESIGN_TYPES.includes(r.type) && PENDING_STATUSES.includes(r.status)).length;
    } else if (m.role === "editor") {
      roleHighlight = mine.filter((r) => VIDEO_TYPES.includes(r.type) && PENDING_STATUSES.includes(r.status)).length;
    } else if (m.role === "manager") {
      roleHighlight = rows.filter((r) => r.needsReview).length;
    }
    return { member: m, mine, today: today_, week, overdue: overdue_, done: done_, roleHighlight };
    // TEAM.length: a Team-page newcomer is appended to TEAM after load (useHubTeam).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [allRows, rows, today, weekAgo, weekStart, weekEnd, TEAM.length]);

  if (loading && rows.length === 0) {
    return <div className="bg-white border border-gray-100 rounded-lg"><LoadingBlock label="Loading team…" /></div>;
  }

  const selMember = selected ? TEAM.find((m) => m.key === selected) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-lg p-1 gap-1">
          <button onClick={() => setView("today")} className={`text-xs font-medium px-3.5 py-1.5 rounded-md transition ${view === "today" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>Today</button>
          <button onClick={() => setView("week")} className={`text-xs font-medium px-3.5 py-1.5 rounded-md transition ${view === "week" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>Week</button>
        </div>
        <span className="text-[12px] font-medium text-[#232D42]">
          {view === "today"
            ? <>{friendlyToday.split(" · ")[0]} <span className="text-gray-400 font-normal">({friendlyToday.split(" · ")[1]}) · today</span></>
            : weekdays.length
              ? <>This week <span className="text-gray-400 font-normal">· Mon–Fri · {weekdays[0].getDate()}–{weekdays[weekdays.length - 1].getDate()} {MONTH_SHORT[weekdays[weekdays.length - 1].getMonth()]}</span></>
              : <span className="text-gray-400 font-normal">Weekend — the work-week is done</span>}
        </span>
      </div>

      {view === "today" ? (
        <div className="space-y-3">
          {teamCards.map((c) => <PersonTimelineRow key={c.member.key} card={c} />)}
        </div>
      ) : weekdays.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center">
          <div className="text-[15px] font-semibold text-[#232D42] mb-1">No work days left this week</div>
          <div className="text-[13px] text-gray-500">The team works Monday–Friday. Check back Monday for the next week&apos;s plan.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {teamCards.map((c) => (
            <PersonWeekRow
              key={c.member.key}
              member={c.member}
              mine={c.mine}
              weekdays={weekdays}
              onOpenPanel={() => setSelected((prev) => (prev === c.member.key ? null : c.member.key))}
            />
          ))}
          {selMember && (
            <PersonPanel member={selMember} allRows={allRows} facets={facets} onOpen={onOpen} onClose={() => setSelected(null)} />
          )}
        </div>
      )}
    </div>
  );
}

// One teammate as a full-width row: a planned day-plan timeline built from their real
// pending tasks (like the My Day "Team capacity" view, but data-backed), plus the
// now/next line and the real Today / This week / Overdue / Done counts.
function blockGradient(type: string): string {
  if (VIDEO_TYPES.includes(type)) return "linear-gradient(135deg,#5A6FF0,#3A57E8)";   // video — blue
  if (DESIGN_TYPES.includes(type)) return "linear-gradient(135deg,#8E7BF0,#6D5CE7)";  // design — violet
  return "linear-gradient(135deg,#2FB98D,#0F9E75)";                                    // writing/other — teal
}
const fmtDur = (m: number) => { const h = Math.floor(m / 60), mm = m % 60; return `${h ? h + "h " : ""}${mm}m`; };

type PlanBlk = { kind: "task" | "lunch" | "free" | "buffer"; label: string; dur: number; row?: Row; start: number };
const PLAN_BUFFER_MIN = 60;   // the hour My Day keeps free for urgent work at the end of the day
const isHotPrio = (p: string) => p === "Urgent" || p === "High";
// Shared day-plan layout: sequence a person's not-done tasks across the 9 AM–7 PM
// span around the pinned 1–2 PM lunch. Used by both the Today row (all pending work)
// and each Week mini-day (that day's tasks). A task running into lunch splits around
// it; anything past 7 PM overflows (spills to another day).
// Today's first login per person (minutes after 9 AM), shared by every Workload row.
// The day is planned from max(shift start, login) — same rule as My Day.
function useTodayLogins(): Record<string, number> {
  const { data } = useApi<{ logins: Record<string, number> }>("/api/my-day/logins", { refreshInterval: 5 * 60_000 });
  return data?.logins || {};
}

// `asMyDay`: lay it out exactly as the person's own My Day "Today's plan" does — rows
// already in their order, whole tasks only (what doesn't fit spills over), and the
// last hour kept as a buffer for urgent work unless the task is High/Urgent.
function buildDayPlan(queueRows: Row[], member: TeamMember, loginMin?: number, asMyDay = false): { blocks: PlanBlk[]; taskBlocks: PlanBlk[]; free: number; overflow: number } {
  const filtered = queueRows
    .filter((r) => presentsOn(r, member) || onDayPlan(r.status, member.role === "writer"))
    .map((r) => ({ r, due: (r.dueDate || r.publishingDate || "").slice(0, 10) || "9999" }));
  const queue = asMyDay ? filtered : filtered.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const blocks: PlanBlk[] = [];
  const LUNCH_END = LUNCH_AT_MIN + LUNCH_MIN;
  const dayEnd = shiftEnd(member);
  let cur = Math.max(shiftStart(member), loginMin ?? shiftStart(member)), lunchDone = false, overflow = 0;
  const pushLunch = () => { blocks.push({ kind: "lunch", label: "Lunch", dur: LUNCH_MIN, start: LUNCH_AT_MIN }); cur = LUNCH_END; lunchDone = true; };
  // Working minutes left in the day from `cur` (lunch excluded) — My Day's capacity.
  const startCur = cur;
  const avail = dayEnd - startCur - Math.max(0, Math.min(dayEnd, LUNCH_END) - Math.max(startCur, LUNCH_AT_MIN));
  let used = 0, placed = 0;

  for (const q of queue) {
    if (cur >= dayEnd) { overflow++; continue; }
    const shoot = presentsOn(q.r, member);
    let remaining = shoot ? SHOOT_MIN : rowDurMin(q.r);
    if (asMyDay) {
      const cap = isHotPrio(q.r.priority) ? avail : Math.max(0, avail - PLAN_BUFFER_MIN);
      if (placed > 0 && used + remaining > cap) { overflow++; continue; }
      used += remaining; placed++;
    }
    const label = (shoot ? "On camera · " : "") + (q.r.particulars || q.r.type || "Task");
    if (!lunchDone && cur >= LUNCH_AT_MIN && cur < LUNCH_END) pushLunch();
    if (!lunchDone && cur < LUNCH_AT_MIN) {
      const before = Math.min(remaining, LUNCH_AT_MIN - cur);
      if (before > 0) { blocks.push({ kind: "task", label, dur: before, row: q.r, start: cur }); cur += before; remaining -= before; }
      if (remaining > 0) pushLunch();
    }
    if (remaining > 0) { blocks.push({ kind: "task", label, dur: remaining, row: q.r, start: cur }); cur += remaining; }
  }
  if (!lunchDone) {
    if (cur < LUNCH_AT_MIN) { blocks.push({ kind: "free", label: "Free", dur: LUNCH_AT_MIN - cur, start: cur }); cur = LUNCH_AT_MIN; }
    pushLunch();
  }
  if (asMyDay) {
    const bufStart = Math.max(cur, dayEnd - PLAN_BUFFER_MIN);
    if (bufStart > cur) blocks.push({ kind: "free", label: "Free", dur: bufStart - cur, start: cur });
    if (bufStart < dayEnd) blocks.push({ kind: "buffer", label: "Buffer", dur: dayEnd - bufStart, start: bufStart });
  } else if (cur < dayEnd) blocks.push({ kind: "free", label: "Free", dur: dayEnd - cur, start: cur });
  const seenT = new Set<string>();
  const taskBlocks = blocks.filter((b) => b.kind === "task" && b.row != null && !seenT.has(b.row.id) && (seenT.add(b.row.id), true));
  const free = blocks.reduce((s, b) => s + (b.kind === "free" ? b.dur : 0), 0);
  return { blocks, taskBlocks, free, overflow };
}

// A single compact day-plan for the Week view — one weekday's tasks for one person.
// Tasks are matched to the day by publishing date (falling back to due date).
function MiniDayTimeline({ date, rows, member, isToday, isPast }: { date: Date; rows: Row[]; member: TeamMember; isToday: boolean; isPast: boolean }) {
  const key = ymd(date);
  const dayRows = rows.filter((r) => ((r.publishingDate || r.dueDate || "").slice(0, 10)) === key && !DONE_STATUSES.includes(r.status));
  const logins = useTodayLogins();
  const { blocks, taskBlocks, free, overflow } = buildDayPlan(dayRows, member, isToday ? logins[member.key] : undefined);
  const booked = taskBlocks.length;
  const now = new Date();
  const nowMin = (now.getHours() - WORK_START_H) * 60 + now.getMinutes();
  const nowPct = isToday && nowMin >= 0 && nowMin <= SPAN_MIN ? (nowMin / SPAN_MIN) * 100 : null;
  const badge = overflow > 0 ? { t: `+${overflow} over`, c: "bg-rose-50 text-rose-600" }
    : booked === 0 ? { t: "Open", c: "bg-gray-50 text-gray-400" }
    : free <= 0 ? { t: "Full", c: "bg-rose-50 text-rose-600" }
    : { t: `${fmtDur(free)} free`, c: "bg-emerald-50 text-emerald-600" };
  return (
    <div className={`rounded-xl border p-2.5 ${isToday ? "border-brand/40 bg-brand-light/40" : "border-gray-100 bg-white"} ${isPast ? "opacity-45" : ""}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] font-semibold text-[#232D42]">{WEEKDAY_SHORT[date.getDay()]} {date.getDate()}{isToday ? <span className="text-brand font-medium"> · today</span> : ""}</span>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badge.c}`}>{badge.t}</span>
      </div>
      <div className="relative h-14 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
        {blocks.map((b, i) => {
          const pos = { position: "absolute" as const, top: 0, bottom: 0, left: `${(b.start / SPAN_MIN) * 100}%`, width: `${(b.dur / SPAN_MIN) * 100}%` };
          if (b.kind === "lunch") return <div key={i} style={pos} className="border-r border-white/50 bg-[repeating-linear-gradient(45deg,#EAEDF5,#EAEDF5_5px,#DFE3EE_5px,#DFE3EE_10px)]" title="Lunch 1–2 PM" />;
          if (b.kind === "free") return <div key={i} style={pos} className="bg-[repeating-linear-gradient(45deg,#F3F5F9,#F3F5F9_5px,#E9ECF2_5px,#E9ECF2_10px)]" />;
          return (
            <div key={i} style={{ ...pos, backgroundImage: blockGradient(b.row?.type || "") }} className="min-w-0 flex items-center px-1.5 text-white border-r border-white/20" title={`${b.label} · ${b.row?.type || "Task"}`}>
              <span className="text-[10px] font-medium leading-tight truncate">{b.label}</span>
            </div>
          );
        })}
        {nowPct != null && <div className="absolute top-0 bottom-0 w-0.5 bg-[#DC2E2E] z-10" style={{ left: `${nowPct}%` }} />}
      </div>
      <div className="mt-1 text-[11px] text-gray-500">{booked === 0 ? "No tasks" : `${booked} task${booked > 1 ? "s" : ""}`}</div>
    </div>
  );
}

// One teammate for the Week view: a row of compact mini-day plans, today → Friday.
function PersonWeekRow({ member, mine, weekdays, onOpenPanel }: { member: TeamMember; mine: Row[]; weekdays: Date[]; onOpenPanel: () => void }) {
  const todayKey = ymd(new Date());
  const weekStart = weekdays.length ? ymd(weekdays[0]) : todayKey;
  const weekEnd = weekdays.length ? ymd(weekdays[weekdays.length - 1]) : todayKey;
  const weekTasks = mine.filter((r) => {
    const pd = (r.publishingDate || r.dueDate || "").slice(0, 10);
    return pd && pd >= weekStart && pd <= weekEnd && !DONE_STATUSES.includes(r.status);
  }).length;
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4">
      <button onClick={onOpenPanel} className="flex items-center gap-3 mb-3 w-full text-left group" title="Open full task list">
        <span className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-semibold flex-shrink-0" style={{ background: member.color }}>{member.av}</span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-gray-900 leading-tight group-hover:text-brand transition">{member.label}</div>
          <div className="text-[13px] text-gray-500">{member.displayRole}</div>
        </div>
        <span className="ml-auto text-[11px] font-medium px-2.5 py-1 rounded-full bg-gray-50 text-gray-600">{weekTasks} task{weekTasks === 1 ? "" : "s"} this week</span>
      </button>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${weekdays.length}, minmax(0, 1fr))` }}>
        {weekdays.map((d) => { const k = ymd(d); return <MiniDayTimeline key={k} date={d} rows={mine} member={member} isToday={k === todayKey} isPast={k < todayKey} />; })}
      </div>
    </div>
  );
}

function PersonTimelineRow({ card }: {
  card: { member: TeamMember; mine: Row[]; today: number; week: number; overdue: number; done: number; roleHighlight: number };
}) {
  const { member, mine, today, week, overdue, done, roleHighlight } = card;

  // Today's card shows TODAY (Praveen, 22 Oct): what is due today or was worked on
  // today — finished ones stay, marked Completed — then what's overdue, then what's
  // coming up. It used to lay every open task, whatever its date, into today's plan,
  // so a Saturday carousel read as today's work and finished work vanished.
  const todayKey = ymd(new Date());
  const groups = useMemo(() => {
    const dayOf = (r: Row) => (r.publishingDate || r.dueDate || "").slice(0, 10);
    const finishedAt = (r: Row) => (r.endAt || r.completionTime || "").slice(0, 10);
    const finishedToday: Row[] = [], todayOpen: Row[] = [], overdueL: Row[] = [], upcoming: Row[] = [];
    for (const r of mine) {
      if (r.status === "Rejected/Not Published") continue;
      const done = r.status === "Output - Ready" || DONE_STATUSES.includes(r.status);
      const d = dayOf(r);
      if (done) { if (finishedAt(r) === todayKey || (d === todayKey && r.status === "Output - Ready")) finishedToday.push(r); continue; }
      const onMyStage = presentsOn(r, member) || onDayPlan(r.status, member.role === "writer");
      if (d === todayKey || startedTodayMin(r) != null) todayOpen.push(r);
      else if (d && d < todayKey && onMyStage) overdueL.push(r);
      else upcoming.push(r);
    }
    upcoming.sort((a, b) => (dayOf(a) || "9999").localeCompare(dayOf(b) || "9999"));
    overdueL.sort((a, b) => dayOf(a).localeCompare(dayOf(b)));
    return { finishedToday, todayOpen, overdueL, upcoming };
  }, [mine, todayKey, member]);

  // Same rule as My Day's Today's plan (23 Oct): the day is laid out from login and
  // doesn't slide with the clock. Finished work comes first, greyed, each shrunk to
  // the time it really took (never more than planned); what's left follows it.
  const logins = useTodayLogins();
  const dayFrom = Math.max(shiftStart(member), logins[member.key] ?? shiftStart(member));
  const doneBlocks: { start: number; dur: number; row: Row }[] = [];
  {
    let cur = dayFrom;
    const finishedSorted = [...groups.finishedToday].sort((a, b) => (a.endAt || a.completionTime || "").localeCompare(b.endAt || b.completionTime || ""));
    for (const r of finishedSorted) {
      const t = new Date(r.endAt || r.completionTime || "");
      if (Number.isNaN(t.getTime()) || ymd(t) !== todayKey) continue;
      if (cur >= LUNCH_AT_MIN && cur < LUNCH_AT_MIN + LUNCH_MIN) cur = LUNCH_AT_MIN + LUNCH_MIN;
      const to = (t.getHours() - WORK_START_H) * 60 + t.getMinutes();
      // Working minutes from its slot to when it was finished — lunch isn't work.
      const worked = to - cur - Math.max(0, Math.min(to, LUNCH_AT_MIN + LUNCH_MIN) - Math.max(cur, LUNCH_AT_MIN));
      let dur = Math.min(rowDurMin(r), Math.max(10, worked));
      if (cur < LUNCH_AT_MIN && cur + dur > LUNCH_AT_MIN) {
        doneBlocks.push({ start: cur, dur: LUNCH_AT_MIN - cur, row: r });
        dur -= LUNCH_AT_MIN - cur; cur = LUNCH_AT_MIN + LUNCH_MIN;
      }
      if (cur + dur > SPAN_MIN) dur = Math.max(0, SPAN_MIN - cur);
      if (dur > 0) doneBlocks.push({ start: cur, dur, row: r });
      cur += dur;
    }
  }
  const lastDone = doneBlocks.reduce((m, b) => Math.max(m, b.start + b.dur), 0);
  const planFrom = Math.max(dayFrom, lastDone);
  // The bar is the person's My Day "Today's plan", not a list of tasks due today:
  // all their open work, in the order they dragged it into (saved per day), the rest
  // as My Day seeds it — late first, then High/Urgent, then by publishing date.
  const { data: savedOrder } = useApi<{ order: string[] }>(`/api/my-day/plan-order?person=${encodeURIComponent(member.key)}`, { refreshInterval: 5 * 60_000 });
  const planRows = useMemo(() => {
    const open = mine.filter((r) => !(r.status === "Output - Ready" || r.status === "Rejected/Not Published" || DONE_STATUSES.includes(r.status)));
    const order = savedOrder?.order || [];
    const kept = order.map((id) => open.find((r) => r.id === id)).filter((r): r is Row => !!r);
    const due = (r: Row) => (r.publishingDate || r.dueDate || "").slice(0, 10) || "9999";
    const PR: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
    const late = (r: Row) => due(r) < todayKey;
    const restAll = open.filter((r) => !kept.includes(r))
      .sort((a, b) => due(a).localeCompare(due(b)) || ((PR[a.priority] ?? 4) - (PR[b.priority] ?? 4)));
    const first = restAll.filter((r) => late(r) || isHotPrio(r.priority))
      .sort((a, b) => (Number(!late(a)) - Number(!late(b))) || (Number(!isHotPrio(a.priority)) - Number(!isHotPrio(b.priority))));
    // New late / High work goes AHEAD of the saved order, as My Day does.
    return [...first, ...kept, ...restAll.filter((r) => !first.includes(r))];
  }, [mine, savedOrder, todayKey]);
  const { blocks, taskBlocks, free, overflow } = buildDayPlan(planRows, member, planFrom, true);

  const now = new Date();
  const nowMin = (now.getHours() - WORK_START_H) * 60 + now.getMinutes();
  const nowPct = nowMin >= 0 && nowMin <= SPAN_MIN ? (nowMin / SPAN_MIN) * 100 : null;
  const currentBlk = blocks.find((b) => b.kind === "task" && nowMin >= b.start && nowMin < b.start + b.dur) || null;
  const nextBlk = blocks.find((b) => b.kind === "task" && b.start >= nowMin) || blocks.find((b) => b.kind === "task") || null;
  const focus = currentBlk || nextBlk;

  const freeH = Math.floor(free / 60);
  const allDoneToday = groups.todayOpen.length === 0 && groups.finishedToday.length > 0 && taskBlocks.length === 0 && overflow === 0;
  const badge = allDoneToday
    ? { text: "Today's work done", cls: "bg-emerald-50 text-emerald-700" }
    : overflow > 0
    ? { text: `Overbooked · ${overflow} spill over`, cls: "bg-rose-50 text-rose-700" }
    : free <= 0
    ? { text: "Fully booked", cls: "bg-rose-50 text-rose-700" }
    : { text: `${fmtDur(free)} free`, cls: freeH >= 2 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700" };

  const dueLabel = (r: Row) => {
    const d = (r.publishingDate || r.dueDate || "").slice(0, 10);
    if (!d) return "No date";
    if (d === todayKey) return "Today";
    const dt = new Date(`${d}T00:00:00`);
    return `${WEEKDAY_SHORT[dt.getDay()]} ${dt.getDate()} ${MONTH_SHORT[dt.getMonth()]}`;
  };
  const statusOf = (r: Row, overdueRow: boolean): { t: string; c: string } => {
    if (DONE_STATUSES.includes(r.status)) return { t: "Completed", c: "bg-emerald-50 text-emerald-700" };
    if (r.status === "Output - Ready") return { t: "Completed · in review", c: "bg-emerald-50 text-emerald-700" };
    if (r.status === "Content - Needs Approval") return { t: "Waiting for approval", c: "bg-amber-50 text-amber-700" };
    if (!presentsOn(r, member) && !onDayPlan(r.status, member.role === "writer")) return { t: "With the team", c: "bg-brand-light text-[#2138B0]" };
    if (overdueRow) return { t: "Overdue", c: "bg-rose-50 text-rose-600" };
    if (r.status === "Output - In Progress" || r.status === "Content - In Progress") return { t: "In progress", c: "bg-blue-50 text-blue-700" };
    if (r.status === "Incorporating Feedback") return { t: "Fixing feedback", c: "bg-amber-50 text-amber-700" };
    if (r.status === "Content - Needs Approval") return { t: "Waiting for approval", c: "bg-amber-50 text-amber-700" };
    return { t: "Pending", c: "bg-gray-100 text-gray-600" };
  };
  const TaskTable = ({ title, rows: list, tone, overdueRows, more }: { title: string; rows: Row[]; tone?: string; overdueRows?: boolean; more?: number }) => (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <div className={`text-[12px] uppercase tracking-wide font-semibold mb-1.5 ${tone || "text-gray-400"}`}>{title} <span className="normal-case tracking-normal font-normal text-gray-400">· {list.length + (more || 0)}</span></div>
      <table className="w-full text-[13.5px] table-fixed">
        <thead>
          <tr className="text-left text-[11px] text-gray-400">
            <th className="font-normal pb-1">Task</th>
            <th className="font-normal pb-1 w-[24%]">Primary Interest</th>
            <th className="font-normal pb-1 w-[14%]">Due</th>
            <th className="font-normal pb-1 w-[20%] text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const st = statusOf(r, !!overdueRows);
            const shoot = presentsOn(r, member);
            return (
              <tr key={r.id} className="border-t border-gray-50">
                <td className="py-1.5 pr-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundImage: blockGradient(r.type) }} />
                    <span className={`truncate ${st.t.startsWith("Completed") ? "text-gray-500" : "text-gray-800 font-medium"}`} title={r.particulars}>{shoot ? "On camera · " : ""}{r.particulars || r.type || "Task"}</span>
                  </span>
                </td>
                <td className="py-1.5 pr-2 text-gray-500 truncate">{r.sbu || "—"}</td>
                <td className={`py-1.5 pr-2 tabular-nums whitespace-nowrap ${overdueRows ? "text-rose-600" : "text-gray-500"}`}>{dueLabel(r)}</td>
                {/* The task's own status, in the Master sheet's words and colours — "Completed · in
                    review" and the like had to be translated back (Praveen, 4 Nov 2026). */}
                <td className="py-1.5 text-right">{r.status
                  ? <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: statusPill(r.status).bg, color: statusPill(r.status).text }}>{r.status}</span>
                  : <span className="text-gray-300">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!!more && <div className="text-[12px] text-gray-400 mt-1">+{more} more later</div>}
    </div>
  );

  const todayRows = [...groups.finishedToday, ...groups.todayOpen];
  const UPCOMING_MAX = 6;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4">
      <div className="flex items-center gap-3 mb-2.5">
        <span className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-semibold flex-shrink-0" style={{ background: member.color }}>{member.av}</span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-gray-900 leading-tight">{member.label}</div>
          <div className="text-[13px] text-gray-500">{member.displayRole} · <span className="font-medium text-gray-700">{roleHighlight}</span> {ROLE_HIGHLIGHT[member.role].toLowerCase()}</div>
        </div>
        <span className={`ml-auto text-[11px] font-medium px-2.5 py-1 rounded-full ${badge.cls}`}>{badge.text}</span>
      </div>

      {/* Today's bar: finished work at the time it was finished (grey, ticked), then
          the plan for what's left of today, around the 1–2 PM lunch. */}
      <div className="flex font-mono text-[11px] text-gray-400 mb-1.5 select-none px-px">
        {HOUR_TICKS.map((h, i) => <div key={i} className="flex-1 text-left">{h}</div>)}
      </div>
      <div className="relative h-28 rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
        {blocks.map((b, i) => {
          const pos = { position: "absolute" as const, top: 0, bottom: 0, left: `${(b.start / SPAN_MIN) * 100}%`, width: `${(b.dur / SPAN_MIN) * 100}%` };
          if (b.kind === "lunch") return (
            <div key={i} style={pos} className="min-w-0 flex flex-col justify-center px-3 text-gray-500 border-r border-white/50 bg-[repeating-linear-gradient(45deg,#EAEDF5,#EAEDF5_6px,#DFE3EE_6px,#DFE3EE_12px)]">
              <span className="text-[14px] font-semibold leading-tight truncate">Lunch</span>
              <span className="text-[11px] opacity-90 mt-0.5 truncate">1h · protected</span>
            </div>
          );
          if (b.kind === "free" || b.kind === "buffer") return (
            <div key={i} style={pos} className="min-w-0 flex flex-col justify-center px-3 text-gray-400 bg-[repeating-linear-gradient(45deg,#F3F5F9,#F3F5F9_6px,#E9ECF2_6px,#E9ECF2_12px)]">
              <span className="text-[14px] font-semibold leading-tight truncate">{b.kind === "buffer" ? "Buffer" : "Free"}</span>
              <span className="text-[11px] opacity-90 mt-0.5 truncate">{b.kind === "buffer" ? "Kept free for urgent work" : `${fmtDur(b.dur)} open`}</span>
            </div>
          );
          const isNow = b === currentBlk;
          return (
            <div key={i} style={{ ...pos, backgroundImage: blockGradient(b.row?.type || "") }}
              className={`min-w-0 flex flex-col justify-center px-3 text-white border-r border-white/20 ${isNow ? "ring-2 ring-inset ring-white/70" : ""}`} title={b.label}>
              <span className="text-[14px] font-semibold leading-tight truncate">{b.label}</span>
              <span className="text-[11px] opacity-85 mt-0.5 truncate">{b.row?.type || "Task"} · {fmtDur(b.dur)}{isNow ? " · now" : ""}</span>
            </div>
          );
        })}
        {doneBlocks.map((b) => (
          <div key={`done-${b.row.id}-${b.start}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${(b.start / SPAN_MIN) * 100}%`, width: `${(b.dur / SPAN_MIN) * 100}%` }}
            className="min-w-0 flex flex-col justify-center px-3 bg-[#E4E8F0] text-[#6B7489] border-r border-white z-[1]" title={`${b.row.particulars} · completed`}>
            <span className="text-[13px] font-medium leading-tight truncate flex items-center gap-1"><IconCheck size={13} stroke={2.2} className="text-emerald-600 flex-shrink-0" />{b.row.particulars || "Task"}</span>
            <span className="text-[11px] mt-0.5 truncate">Completed</span>
          </div>
        ))}
        {nowPct != null && (
          <div className="absolute top-0 bottom-0 w-0.5 bg-[#DC2E2E] z-10" style={{ left: `${nowPct}%` }}>
            <span className="absolute -top-[3px] -left-[3px] w-2 h-2 rounded-full bg-[#DC2E2E]" />
          </div>
        )}
      </div>

      <div className="mt-2 text-[13px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5">
        {focus
          ? <><span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500 align-middle mr-1.5" />{currentBlk ? "Now" : "Next up"}: <b className="text-gray-900">{focus.label}</b></>
          : allDoneToday
          ? <span className="text-emerald-700">Everything due today is done.</span>
          : groups.todayOpen.length
          ? <span className="text-gray-500">Nothing left for {member.label} today — the rest is with the team.</span>
          : <span className="text-gray-400">Nothing due today.</span>}
      </div>

      {todayRows.length > 0
        ? <TaskTable title="Today" rows={todayRows} />
        : <div className="mt-3 border-t border-gray-100 pt-3 text-[13.5px] text-gray-500">Nothing due today{taskBlocks.length === 0 && free > 0 ? ` — ${fmtDur(free)} free for new work` : ""}.</div>}
      {groups.overdueL.length > 0 && <TaskTable title="Overdue" rows={groups.overdueL} tone="text-rose-500" overdueRows />}
      {groups.upcoming.length > 0 && <TaskTable title="Coming up" rows={groups.upcoming.slice(0, UPCOMING_MAX)} more={Math.max(0, groups.upcoming.length - UPCOMING_MAX)} />}

      <div className="flex items-center justify-end gap-3 mt-2.5 pt-2.5 border-t border-gray-100 text-[11px] text-gray-500 tabular-nums">
        <span>Today <b className="text-gray-900">{today}</b></span>
        <span>This week <b className="text-gray-900">{week}</b></span>
        <span>Overdue <b className={overdue ? "text-rose-600" : "text-gray-900"}>{overdue}</b></span>
        <span>Done · 7d <b className="text-gray-900">{done}</b></span>
      </div>
    </div>
  );
}

// PIPELINE sub-tab — "how many pieces of content are at each step right now", by status.
// Rewritten 27 Oct so anyone can read it (Praveen: "make it so a normal person understands
// what the pipeline is for"): each step says what it means and who acts next, steps are
// grouped Writing → Making → Publishing, and the old separate "Needs chasing" list is folded
// into the step's table (longest-waiting first).
const STEP_HELP: Record<string, { phase: "Writing" | "Making" | "Publishing"; means: string; next: string }> = {
  "Content - Pending":      { phase: "Writing",    means: "Copy being written or waiting for sign-off", next: "Writer" },
  "Content - Approved":     { phase: "Making",     means: "Copy approved — design / video not started", next: "Designer or editor" },
  "Output - In Progress":   { phase: "Making",     means: "Being designed or edited right now",         next: "Designer or editor" },
  "Incorporating Feedback": { phase: "Making",     means: "Changes were asked for — being fixed",       next: "Designer or editor" },
  "Output - Ready":         { phase: "Making",     means: "Finished — waiting for the final check",     next: "Content Review" },
  "Ready to Publish":       { phase: "Publishing", means: "Approved — waiting to be scheduled",         next: "Scheduler" },
  "Published/Scheduled":    { phase: "Publishing", means: "Posted or scheduled in the last 30 days",    next: "Nobody — done" },
};
const PHASES = [
  { name: "Writing", span: "xl:col-span-1", cols: "grid-cols-1" },
  { name: "Making", span: "xl:col-span-4", cols: "grid-cols-2 md:grid-cols-4" },
  { name: "Publishing", span: "xl:col-span-2", cols: "grid-cols-2" },
] as const;

export function PipelineView({ rows: allRows, facets, onOpen, loading }: { rows: Row[]; facets?: Facets; onOpen: (id: string) => void; loading: boolean }) {
  const today = ymd(new Date());
  const allSbus = facets?.sbu || [];
  // This week / This month = posts whose PUBLISH date falls in it (Mon–Sun, calendar
  // month). All = every unfinished post whatever its date (old stuck work included),
  // plus Published for the last 30 days — it would otherwise pile up for ever.
  const [period, setPeriod] = useSticky<"week" | "month" | "all" | "custom">("mh-pipeline-period", "month", (x) => ["week", "month", "all", "custom"].includes(x as string));
  const [custom, setCustom] = useSticky("mh-pipeline-custom", (() => {
    const n = new Date();
    return { from: ymd(new Date(n.getFullYear(), n.getMonth(), 1)), to: ymd(new Date(n.getFullYear(), n.getMonth() + 1, 0)) };
  })(), (x) => !!x && typeof (x as { from?: unknown }).from === "string" && typeof (x as { to?: unknown }).to === "string");
  const span = useMemo(() => {
    const n = new Date();
    if (period === "custom") return custom.from && custom.to && custom.from <= custom.to ? custom : null;
    if (period === "week") {
      const mon = new Date(n.getFullYear(), n.getMonth(), n.getDate() - ((n.getDay() + 6) % 7));
      return { from: ymd(mon), to: ymd(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6)) };
    }
    if (period === "month") return { from: ymd(new Date(n.getFullYear(), n.getMonth(), 1)), to: ymd(new Date(n.getFullYear(), n.getMonth() + 1, 0)) };
    return null;
  }, [period, custom]);
  const monthAgo = ymd(new Date(Date.now() - 30 * 86_400_000));
  const rows = useMemo(() => allRows.filter((r) => {
    const pd = (r.publishingDate || "").slice(0, 10);
    if (span) return !!pd && pd >= span.from && pd <= span.to;
    return r.status !== "Published/Scheduled" || (pd >= monthAgo && pd <= today);
  }), [allRows, span, monthAgo, today]);
  const fmtDay = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

  // We don't record when a task entered a step, so "waiting" = days since it was last
  // changed (fallback: created).
  const ageDays = useCallback((r: Row) => {
    const base = (r.lastModified || r.createdDate || "").slice(0, 10);
    if (!base) return 0;
    return Math.max(0, Math.round((Date.parse(today) - Date.parse(base)) / 86_400_000));
  }, [today]);

  const steps = useMemo(() => PIPELINE_STAGES.map((s, i) => {
    const inStep = rows.filter((r) => r.status === s.key);
    const oldest = inStep.length ? Math.max(...inStep.map(ageDays)) : 0;
    const help = STEP_HELP[s.key];
    const means = s.key === "Published/Scheduled" && span ? "Posted or scheduled — done" : help.means;
    // Who the posts at this step are under — most first.
    const byOwner = new Map<string, number>();
    for (const r of inStep) { const o = r.owner || "Unassigned"; byOwner.set(o, (byOwner.get(o) || 0) + 1); }
    const owners = [...byOwner.entries()].sort((a, b) => b[1] - a[1]);
    return { ...s, ...help, means, owners, n: i + 1, count: inStep.length, oldest, done: DONE_STATUSES.includes(s.key) };
  }), [rows, ageDays, span]);
  const total = steps.reduce((a, s) => a + s.count, 0);

  const [selected, setSelected] = useState<string>(PIPELINE_STAGES[0].key);
  const [owner, setOwner] = useState<string | null>(null);   // a name clicked on a box
  const pick = (key: string, who: string | null = null) => { setSelected(key); setOwner(who); };
  const step = steps.find((s) => s.key === selected) || steps[0];
  const stepRows = useMemo(
    () => rows.filter((r) => r.status === selected && (!owner || (r.owner || "Unassigned") === owner))
      .map((r) => ({ r, age: ageDays(r) })).sort((a, b) => b.age - a.age),
    [rows, selected, owner, ageDays],
  );

  if (loading && rows.length === 0) {
    return <div className="bg-white border border-gray-100 rounded-xl"><LoadingBlock label="Loading pipeline…" /></div>;
  }

  return (
    <div className="space-y-5">
      {/* What this page is — plain words, so nobody has to guess. */}
      <div className="flex flex-wrap items-start gap-3 bg-brand-light/60 border border-brand/10 rounded-xl px-4 py-3">
        <IconColumns size={18} stroke={1.7} className="text-[#3A57E8] flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-[260px] text-[13px] text-[#232D42] leading-relaxed">
          {span ? (
            <><span className="font-medium">Posts publishing {period === "custom" ? <>from {fmtDay(span.from)} to {fmtDay(span.to)}</> : <>{period === "week" ? "this week" : "this month"} ({fmtDay(span.from)} – {fmtDay(span.to)})</>} — {fmtInt(total)} in all.</span>{" "}
              Each box shows how many of them are at that step today. Posts due earlier and still stuck are under <span className="font-medium">All</span>.</>
          ) : (
            <><span className="font-medium">Every unfinished post, whatever its date</span> — old stuck ones and ones with no publish date yet — plus everything published in the last 30 days.</>
          )}{" "}
          Click a box to see which ones, longest-waiting first.
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
            {([["week", "This week"], ["month", "This month"], ["custom", "Custom"], ["all", "All"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setPeriod(k)}
                className={`px-3 py-1 text-[13px] rounded-md transition ${period === k ? "bg-brand text-white" : "text-gray-600 hover:bg-gray-50"}`}>
                {label}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-1.5 text-[13px] text-gray-600">
              <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })}
                className="border border-gray-200 rounded-md px-2 py-1 bg-white text-[13px]" aria-label="From date" />
              <span>to</span>
              <input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })}
                className="border border-gray-200 rounded-md px-2 py-1 bg-white text-[13px]" aria-label="To date" />
            </div>
          )}
        </div>
      </div>

      {/* The steps, grouped Writing → Making → Publishing. One row on a wide screen. */}
      <div className="grid grid-cols-1 xl:grid-cols-7 gap-3">
        {PHASES.map((ph) => (
          <div key={ph.name} className={`${ph.span} min-w-0 flex flex-col`}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-[#8A92A6] mb-1.5">{ph.name}</div>
            <div className={`grid gap-3 flex-1 ${ph.cols}`}>
              {steps.filter((s) => s.phase === ph.name).map((s) => {
                const isSel = s.key === selected;
                return (
                  <div key={s.key} role="button" tabIndex={0} onClick={() => pick(s.key)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(s.key); } }}
                    className={`text-left rounded-xl border p-3 transition flex flex-col gap-1 min-w-0 cursor-pointer ${isSel ? "border-brand bg-brand-light/50" : "border-gray-100 bg-white hover:border-gray-200"}`}>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#8A92A6]">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />Step {s.n}
                    </div>
                    <div className={`text-[26px] font-medium leading-none mt-1 ${s.count === 0 ? "text-gray-300" : "text-[#232D42]"}`}>{fmtInt(s.count)}</div>
                    <div className="text-[13px] font-medium text-[#232D42] leading-tight mt-1">{s.label}</div>
                    <div className="text-[12px] text-gray-600 leading-snug">{s.means}</div>
                    {/* Who it is under — click a name to see just their posts. */}
                    {s.owners.length > 0 && (
                      <div className="flex flex-col gap-0.5 mt-1.5">
                        {s.owners.slice(0, 4).map(([who, c]) => {
                          const on = isSel && owner === who;
                          return (
                            <button key={who} onClick={(e) => { e.stopPropagation(); pick(s.key, on ? null : who); }}
                              title={`Show only posts under ${who}`}
                              className={`flex items-center justify-between gap-2 rounded-md px-1.5 py-0.5 !min-h-0 h-6 text-[12px] text-left ${on ? "bg-brand text-white" : "text-[#232D42] hover:bg-gray-100"}`}>
                              <span className="truncate">{who}</span>
                              <span className={on ? "text-white/90" : "text-[#8A92A6]"}>{c}</span>
                            </button>
                          );
                        })}
                        {s.owners.length > 4 && <span className="px-1.5 text-[11px] text-[#8A92A6]">+{s.owners.length - 4} more</span>}
                      </div>
                    )}
                    <div className="mt-auto pt-2 border-t border-gray-100 text-[11px] leading-relaxed">
                      <div className="text-[#8A92A6] truncate">Next: <span className="text-gray-600">{s.next}</span></div>
                      {s.done || s.count === 0
                        ? <div className="text-gray-300">{s.count === 0 ? "Nothing waiting" : "Done"}</div>
                        : <div className={s.oldest >= 7 ? "text-rose-600 font-medium" : "text-amber-600"}>Oldest waiting {s.oldest} {s.oldest === 1 ? "day" : "days"}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* The posts at the chosen step — longest-waiting first, so the ones to chase are on top. */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2.5 border-b border-gray-100 bg-brand-light/40">
          <span className="w-3 h-3 rounded-sm" style={{ background: step.color }} />
          <span className="text-[14px] font-medium text-[#232D42]">Step {step.n} · {step.label}</span>
          {owner && (
            <button onClick={() => setOwner(null)} className="inline-flex items-center gap-1 text-[12px] bg-brand text-white rounded-full px-2.5 py-0.5" title="Show everyone">
              {owner} <IconX size={12} stroke={2} />
            </button>
          )}
          <span className="text-sm text-[#8A92A6]">· {fmtInt(stepRows.length)} {stepRows.length === 1 ? "post" : "posts"} · {step.means}</span>
          <span className="ml-auto text-xs text-[#8A92A6]">Next: <span className="text-gray-600">{step.next}</span></span>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 sticky top-0">
              <tr className="text-gray-500 text-left">
                <th className="px-4 py-2.5 font-normal">Title</th>
                <th className="px-4 py-2.5 font-normal">Waiting</th>
                <th className="px-4 py-2.5 font-normal">Owner</th>
                <th className="px-4 py-2.5 font-normal">Type</th>
                <th className="px-4 py-2.5 font-normal">SBU</th>
                <th className="px-4 py-2.5 font-normal">Publish</th>
              </tr>
            </thead>
            <tbody>
              {stepRows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Nothing at this step right now.</td></tr>
              )}
              {stepRows.map(({ r, age }) => {
                const pd = r.publishingDate?.slice(0, 10) || "";
                const late = !!pd && pd < today && !step.done;
                return (
                  <tr key={r.id} onClick={() => onOpen(r.id)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-2.5 text-[#232D42]">{r.particulars || "(untitled)"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {step.done ? <span className="text-gray-400">—</span>
                        : <span className={`text-[11px] font-medium rounded-md px-2 py-0.5 ${age >= 7 ? "bg-rose-50 text-rose-700" : "bg-gray-100 text-gray-600"}`}>{age} {age === 1 ? "day" : "days"}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.owner || "Unassigned"}</td>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.type || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: sbuColor(r.sbu, allSbus) }} />
                        {r.sbu || "—"}
                      </span>
                    </td>
                    <td className={`px-4 py-2.5 whitespace-nowrap ${late ? "text-rose-600 font-medium" : "text-gray-500"}`}>
                      {fmtDateShort(r.publishingDate)}{late && " · late"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TeamMemberCard({ card, onOpenPanel, selected }: {
  card: { member: TeamMember; mine: Row[]; today: number; week: number; overdue: number; done: number; roleHighlight: number };
  onOpenPanel: () => void;
  selected?: boolean;
}) {
  const { member: m } = card;

  return (
    <div
      onClick={onOpenPanel}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenPanel(); } }}
      className={`bg-white border rounded-lg p-5 flex flex-col cursor-pointer hover:border-brand hover:shadow-sm transition ${selected ? "border-brand ring-1 ring-brand/30" : "border-gray-100"}`}
    >
      <div className="flex items-center gap-3 mb-4 w-full">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0" style={{ background: m.color }}>
          {m.av}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-medium">{m.label}</div>
          <div className="text-xs text-gray-500 truncate">{m.displayRole}</div>
        </div>
        <div className={`text-xs ${selected ? "text-brand font-medium" : "text-gray-400"}`}>{selected ? "Showing ↓" : "Open ↓"}</div>
      </div>

      <div className="rounded p-3 mb-3" style={{ background: m.color + "11" }}>
        <div className="text-xs uppercase tracking-wide" style={{ color: m.color }}>{ROLE_HIGHLIGHT[m.role]}</div>
        <div className="text-2xl font-medium mt-1">{fmtInt(card.roleHighlight)}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <MiniStat label="Today" value={card.today} />
        <MiniStat label="This week" value={card.week} />
        <MiniStat label="Overdue" value={card.overdue} alarm={card.overdue > 0} />
        <MiniStat label="Done · 7d" value={card.done} />
      </div>
    </div>
  );
}

function MiniStat({ label, value, alarm }: { label: string; value: number; alarm?: boolean }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-medium mt-0.5 ${alarm ? "text-rose-600" : ""}`}>{fmtInt(value)}</div>
    </div>
  );
}

const DATE_PRESETS: [string, string][] = [
  ["all", "All"], ["today", "Today"], ["tomorrow", "Tomorrow"], ["yesterday", "Yesterday"],
  ["last3", "Last 3 days"], ["week", "This week"], ["custom", "Custom"],
];
function statusColor(status: string): string {
  return PIPELINE_STAGES.find((s) => s.key === status)?.color || "#94A3B8";
}
function priorityColor(p: string): string {
  const v = (p || "").toLowerCase();
  if (v.includes("high") || v.includes("urgent")) return "#E24B4A";
  if (v.includes("med")) return "#EF9F27";
  return "#B4B2A9";
}

// Renders INLINE below the team cards (not a modal): one person's whole workload
// — colored KPI chips, a date filter (presets + custom range), a Group-by
// dropdown, status pills, and a colour-differentiated task table.
function PersonPanel({ member, allRows, facets, onOpen, onClose }: {
  member: TeamMember;
  allRows: Row[];
  facets?: Facets;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const allSbus = facets?.sbu || [];
  const todayStr = ymd(new Date());
  const weekAhead = ymd(new Date(Date.now() + 7 * 86_400_000));
  const weekAgo = ymd(new Date(Date.now() - 7 * 86_400_000));
  const off = (n: number) => ymd(new Date(Date.now() + n * 86_400_000));

  const mine = useMemo(() => allRows.filter((r) => ownerMatches(r.owner, member) || presentsOn(r, member)), [allRows, member]);

  // Mutually-exclusive urgency buckets for the drill-down. A task lands in exactly
  // one of: overdue → due today → this week → upcoming; done (completed) is separate.
  const sections = useMemo(() => {
    const overdue: Row[] = [], today_: Row[] = [], week: Row[] = [], upcoming: Row[] = [], done: Row[] = [];
    for (const r of mine) {
      if (DONE_STATUSES.includes(r.status)) { done.push(r); continue; }
      const pd = r.publishingDate?.slice(0, 10) || "";
      const dd = r.dueDate?.slice(0, 10) || "";
      const ref = pd || dd;
      // Overdue = past its due date OR its publishing date (whichever exists).
      if ((dd && dd < todayStr) || (pd && pd < todayStr)) overdue.push(r);
      else if (ref && ref === todayStr) today_.push(r);
      else if (ref && ref > todayStr && ref <= weekAhead) week.push(r);
      else upcoming.push(r);
    }
    const byRef = (a: Row, b: Row) => (a.publishingDate || a.dueDate || "9999").localeCompare(b.publishingDate || b.dueDate || "9999");
    // Sort overdue by the earliest past date (most overdue first).
    const overdueKey = (r: Row) => {
      const past = [(r.dueDate || "").slice(0, 10), (r.publishingDate || "").slice(0, 10)].filter((d) => d && d < todayStr).sort();
      return past[0] || "9999";
    };
    overdue.sort((a, b) => overdueKey(a).localeCompare(overdueKey(b)));
    [today_, week, upcoming].forEach((g) => g.sort(byRef));
    done.sort((a, b) => (b.completionTime || "").localeCompare(a.completionTime || ""));
    return { overdue, today: today_, week, upcoming, done };
  }, [mine, todayStr, weekAhead]);

  const openCount = sections.overdue.length + sections.today.length + sections.week.length + sections.upcoming.length;

  const renderRow = (r: Row, opts?: { overdue?: boolean; done?: boolean }) => {
    const sp = statusPill(r.status);
    // Days overdue counts from the earliest past date (due date or publishing date).
    const pastRef = [(r.dueDate || "").slice(0, 10), (r.publishingDate || "").slice(0, 10)].filter((d) => d && d < todayStr).sort()[0] || null;
    const daysOver = opts?.overdue && pastRef ? Math.max(0, Math.round((Date.parse(todayStr) - Date.parse(pastRef)) / 86_400_000)) : null;
    const dateShown = opts?.done ? r.completionTime : (r.publishingDate || r.dueDate);
    return (
      <div key={r.id} onClick={() => onOpen(r.id)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
        <span className="text-sm text-gray-800 flex-1 min-w-0 truncate" title={r.particulars}>{r.particulars || <span className="text-gray-400 italic">Untitled</span>}</span>
        <span className="text-xs text-gray-500 flex-shrink-0 whitespace-nowrap hidden sm:inline">{r.sbu || "—"}</span>
        {r.status && <span className="text-xs px-2 py-0.5 rounded-md flex-shrink-0 whitespace-nowrap" style={{ background: sp.bg, color: sp.text }}>{r.status}</span>}
        {daysOver != null && <span className="text-xs px-2 py-0.5 rounded-md flex-shrink-0 whitespace-nowrap bg-rose-100 text-rose-700">{daysOver}d overdue</span>}
        <span className="text-xs text-gray-400 flex-shrink-0 w-24 text-right">{opts?.done ? "done · " : ""}{fmtDateShort(dateShown)}</span>
      </div>
    );
  };

  const GROUPS: { key: string; label: string; dot: string; text: string; bg: string; rows: Row[]; opts?: { overdue?: boolean; done?: boolean } }[] = [
    { key: "overdue", label: "Overdue", dot: "#D8342F", text: "#B4231F", bg: "#FCEBEC", rows: sections.overdue, opts: { overdue: true } },
    { key: "today", label: "Due today", dot: "#3A57E8", text: "#2138B0", bg: "#E6F1FB", rows: sections.today },
    { key: "week", label: "This week", dot: "#6D5CE7", text: "#4F3FC0", bg: "#EEEDFE", rows: sections.week },
    { key: "upcoming", label: "Upcoming", dot: "#7A8290", text: "#5A6472", bg: "#F1F2F5", rows: sections.upcoming },
    { key: "done", label: "Done", dot: "#0F9E75", text: "#0F6E56", bg: "#E1F5EE", rows: sections.done, opts: { done: true } },
  ];

  return (
    <div className="space-y-3">
      {/* Header bar (its own box) */}
      <div className="bg-white border border-gray-100 rounded-xl px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold" style={{ background: member.color }}>
            {member.av}
          </div>
          <div>
            <div className="text-base font-medium">{member.label} · full task list</div>
            <div className="text-sm text-gray-500">{member.displayRole} · everything in the selected range</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-md px-2.5 py-1 whitespace-nowrap">{openCount} open · <span className={sections.overdue.length ? "text-rose-600 font-medium" : ""}>{sections.overdue.length} overdue</span></span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none" aria-label="Close">×</button>
        </div>
      </div>

      {/* One separate box per urgency group: Overdue → Due today → This week → Upcoming → Done */}
      {openCount === 0 && sections.done.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-10 text-center text-gray-400 text-sm">No tasks for {member.label} in this range.</div>
      ) : GROUPS.map((g) => g.rows.length > 0 && (
        <div key={g.key} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100" style={{ background: g.bg }}>
            <span className="w-2 h-2 rounded-full" style={{ background: g.dot }} />
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: g.text }}>{g.label}</span>
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-white/70" style={{ color: g.text }}>{g.rows.length}</span>
          </div>
          <div className="divide-y divide-gray-50">{g.rows.map((r) => renderRow(r, g.opts))}</div>
        </div>
      ))}
    </div>
  );
}

const MHCAL_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];   // by getDay()
// Weeks run Monday → Sunday, not Sunday → Saturday (Manya, 15 Oct). The header uses
// this; MHCAL_DAY_LABELS stays indexed by getDay() for naming a given date.
const MHCAL_WEEK_HEADER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const mondayOffset = (d: Date) => (d.getDay() + 6) % 7;   // days since Monday
const MHCAL_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Status → pill palette. Mirrors the dashboard publishing calendar's approach: soft-tinted
// bg + matching border + colored text so status is legible at a glance across the grid.
// Unmapped statuses fall through to the neutral gray.
// Near-white fills (a hint of tint, never a saturated block) + a matching border and
// DARK text — so a bar reads white-ish at a glance but still colour-codes its status.
function calStatusStyle(s: string): { bg: string; text: string; border: string } {
  return STATUS_TINT[s] || STATUS_TINT_FALLBACK;
}

// Mirrors the Publishing Calendar (calendar/PreviewCalendar.tsx / theme reference) so the two
// pages read as siblings: soft-tinted event bars with dark readable text, a toolbar INSIDE
// the card (‹ › Today · title · Month/Week/Day/List), taller cells. Tokens hardcoded to the
// PreviewShell values since the Marketing Hub renders under PreviewDashboardShell.
const MHCAL_CSS = `
.mhcal{--cal-panel:#fff;--cal-panel2:#F7F8FC;--cal-raised:#EDEFF5;--cal-line:#EEF0F4;--cal-line2:#F3F5F9;--cal-line3:#D3D8E1;
  --cal-ink:#232D42;--cal-ink2:#4A5468;--cal-muted:#8A92A6;--cal-faint:#A6ACBE;--cal-brandsoft:#E9ECFB;--cal-brandsoft2:#DFE3FA}
html[data-theme="dark"] .mhcal{--cal-panel:#1F2332;--cal-panel2:#191D2A;--cal-raised:#272C3E;--cal-line:#2C3246;--cal-line2:#262B3C;--cal-line3:#3A4159;
  --cal-ink:#E8EBF3;--cal-ink2:#C2C8D6;--cal-muted:#959DB1;--cal-faint:#858DA1;--cal-brandsoft:#2C3666;--cal-brandsoft2:#2C3666}

.mhcal-daynum{display:flex;align-items:center;justify-content:space-between;min-height:22px}
.mhcal-add{opacity:0;width:20px;height:20px;border-radius:6px;border:1px solid var(--cal-brandsoft);background:var(--cal-panel);color:#3A57E8;font-size:14px;line-height:1;display:inline-grid;place-items:center;cursor:pointer;transition:opacity .12s}
.mhcal-cell:hover .mhcal-add,.mhcal-weekcol:hover .mhcal-add{opacity:1}
.mhcal-add:hover{background:var(--cal-brandsoft)}

.mhcal{color:var(--cal-ink)}
.mhcal button{font-family:inherit;cursor:pointer}
/* Hero band — indigo→violet ramp, distinct from the publishing calendar's blue */
.mhcal-hero{position:relative;background:linear-gradient(115deg,#4C4CE2 0%,#6F5BEA 50%,#8B6DF2 100%);border-radius:16px;padding:1.35rem 1.7rem 3.2rem;color:#fff;overflow:hidden;display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}
.mhcal-hero::after{content:"";position:absolute;right:-40px;top:-60px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.16),transparent 62%)}
.mhcal-hero::before{content:"";position:absolute;right:120px;bottom:-90px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.10),transparent 62%)}
.mhcal-hero-txt{position:relative;z-index:1;max-width:640px}
.mhcal-hero-tag{display:inline-block;font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.09em;background:rgba(255,255,255,.22);padding:.22rem .6rem;border-radius:20px;margin-bottom:.5rem}
.mhcal-hero-txt h1{margin:0;font-size:1.35rem;font-weight:800;letter-spacing:-.018em;line-height:1.15;color:#fff}
.mhcal-hero-txt p{margin:.32rem 0 0;font-size:.88rem;color:rgba(255,255,255,.95);line-height:1.45}
.mhcal-hero-stat{position:relative;z-index:1;display:flex;flex-direction:column;align-items:flex-end;gap:.15rem;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);padding:.7rem 1rem;border-radius:12px;backdrop-filter:blur(2px);min-width:125px}
.mhcal-hero-statv{font-size:1.55rem;font-weight:800;letter-spacing:-.02em;line-height:1}
.mhcal-hero-statl{font-size:.64rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.82)}
/* Title card, pulled up to overlap the hero — mirrors the reference's "Calendar" card */
.mhcal-titlecard{position:relative;z-index:2;margin:0;background:var(--cal-panel);border:1px solid var(--cal-line);border-radius:14px;padding:.9rem 1.3rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}
.mhcal-tc-right{display:flex;align-items:center;gap:1rem}
.mhcal-tc-count{font-size:.8rem;font-weight:600;color:var(--cal-muted)}
/* Multi-pick dropdown (SBUs, statuses) — several at once, the way an Airtable view filters */
.mhcal-titlecard h4{margin:0;font-size:1.15rem;font-weight:700;color:var(--cal-ink);letter-spacing:-.012em}
.mhcal-live{display:inline-flex;align-items:center;gap:.4rem;font-size:.76rem;font-weight:600;color:var(--cal-muted)}
.mhcal-live .dot{width:7px;height:7px;border-radius:50%;background:#1AA053}
/* Brand filter — pill chips, one-click SBU isolate */
.mhcal-brands{display:flex;align-items:center;gap:.4rem;margin-top:.8rem;padding:.65rem .8rem;background:var(--cal-panel);border:1px solid var(--cal-line);border-radius:12px;overflow-x:auto;scrollbar-width:thin}
.mhcal-brands::-webkit-scrollbar{height:6px}
.mhcal-brands::-webkit-scrollbar-thumb{background:var(--cal-line3);border-radius:3px}
.mhcal-brands-lbl{font-size:.66rem;text-transform:uppercase;letter-spacing:.09em;color:var(--cal-faint);font-weight:700;padding-right:.5rem;flex:0 0 auto}
.mhcal-brand{display:inline-flex;align-items:center;gap:.42rem;padding:.4rem .78rem;border-radius:99px;background:var(--cal-panel2);color:var(--cal-ink2);font-size:.75rem;font-weight:500;border:1px solid transparent;flex:0 0 auto;transition:.15s;white-space:nowrap}
.mhcal-brand:hover{background:var(--cal-raised);color:var(--cal-ink)}
.mhcal-brand.on{background:var(--cal-ink);color:#fff}
.mhcal-brand .bdot{width:8px;height:8px;border-radius:50%;flex:0 0 8px}
.mhcal-brand .bcount{opacity:.7;font-weight:500;font-size:.68rem;font-variant-numeric:tabular-nums}
.mhcal-brand.on .bcount{opacity:.85}
/* Calendar card + toolbar (toolbar INSIDE the card, like the reference) */
.mhcal-card{background:var(--cal-panel);border:1px solid var(--cal-line);border-radius:16px;box-shadow:0 10px 30px rgba(35,45,66,.06);overflow:hidden;margin-top:.9rem}
.mhcal-toolbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.1rem;flex-wrap:wrap}
.mhcal-nav{display:flex;align-items:center;gap:.4rem}
.mhcal-navbtn{width:40px;height:36px;border-radius:4px;border:none;background:#3A57E8;color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(58,87,232,.22)}
.mhcal-navbtn:hover{background:#2f49c9}
.mhcal-today{border:none;background:var(--cal-brandsoft);color:#2138B0;font-weight:500;font-size:14px;height:36px;padding:0 12px;border-radius:4px;margin-left:.2rem}
.mhcal-today:hover{background:var(--cal-brandsoft2)}
.mhcal-title{font-size:1.35rem;font-weight:700;color:var(--cal-ink);text-align:center;flex:1;min-width:180px}
.mhcal-views{display:flex;align-items:stretch;height:36px;overflow:hidden;background:var(--cal-panel2);border:1px solid var(--cal-line);border-radius:4px;padding:0;gap:0}
.mhcal-viewbtn{border:none;background:none;font-size:12px;font-weight:500;color:var(--cal-ink2);padding:0 14px;border-radius:0}
.mhcal-viewbtn:hover{color:var(--cal-ink)}
.mhcal-viewbtn.on{background:#3A57E8;color:#fff;box-shadow:0 3px 8px rgba(58,87,232,.24)}
/* month grid */
.mhcal-dow{display:grid;grid-template-columns:repeat(7,1fr);border-top:1px solid var(--cal-line);background:var(--cal-panel2)}
.mhcal-dow span{padding:.55rem .6rem;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--cal-muted);border-right:1px solid var(--cal-line)}
.mhcal-dow span:last-child{border-right:none}
.mhcal-grid{display:grid;grid-template-columns:repeat(7,1fr);grid-auto-rows:minmax(134px,1fr)}
.mhcal-cell{border-right:1px solid var(--cal-line);border-top:1px solid var(--cal-line);padding:.35rem;position:relative;min-width:0;transition:background .15s}
.mhcal-cell:nth-child(7n){border-right:none}
.mhcal-cell.out{background:var(--cal-panel2)}
.mhcal-cell.today{background:rgba(58,87,232,.05)}
.mhcal-cell.over{background:rgba(58,87,232,.10);box-shadow:inset 0 0 0 2px rgba(58,87,232,.35)}
.mhcal-daynum{text-align:right;font-size:12px;font-weight:600;color:var(--cal-ink2);padding:.05rem .25rem .2rem;font-variant-numeric:tabular-nums}
.mhcal-cell.out .mhcal-daynum{color:var(--cal-faint)}
.mhcal-cell.today .mhcal-dnum{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:#3A57E8;color:#fff}
.mhcal-events{display:flex;flex-direction:column;gap:3px;clear:both}
/* Event bar — soft-tinted fill + matching border + DARK readable text (matches the
   reference exactly). SBU shows as a small left dot; brand lives in the filter chips. */
.mhcal-ev{display:flex;align-items:center;gap:6px;width:100%;text-align:left;border:1px solid;border-radius:6px;padding:4px 8px;overflow:hidden;transition:filter .1s;cursor:grab}
.mhcal-ev:hover{filter:brightness(.97)}
.mhcal-ev:active{cursor:grabbing}
.mhcal-ev.block .mhcal-evtitle{white-space:normal}
.mhcal-evdot{width:8px;height:8px;border-radius:2px;flex:0 0 8px}
/* Hover card. The browser's own title tooltip is a black bar in the OS font that
   ignores the theme — and since the chips lost their brand square it is the only
   place the brand shows, so it had to look like the rest of the dashboard. */
.mhcal-tip{position:fixed;z-index:60;width:264px;background:var(--cal-panel,#fff);border:1px solid var(--cal-line,#EEF0F4);border-radius:12px;padding:10px 12px;pointer-events:none;font-size:12px;line-height:17px}
.mhcal-tip-title{font-size:13px;font-weight:500;color:var(--cal-ink,#232D42);margin-bottom:6px}
.mhcal-tip-row{display:flex;gap:8px;align-items:baseline}
.mhcal-tip-k{width:56px;flex:0 0 56px;color:var(--cal-muted,#8A92A6)}
.mhcal-tip-v{flex:1;min-width:0;color:var(--cal-ink2,#4A5468)}
.mhcal-tip-status{display:inline-block;border:1px solid;border-radius:999px;padding:0 7px;font-size:11px;line-height:17px}
.mhcal-tip-hint{margin-top:7px;padding-top:6px;border-top:1px solid var(--cal-line,#EEF0F4);color:var(--cal-muted,#8A92A6)}
.mhcal-evtitle{font-size:12px;line-height:16px;font-weight:500;flex:1;min-width:0;overflow:hidden;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;letter-spacing:-.006em}
.mhcal-more{border:none;background:none;font-size:12px;color:var(--cal-muted);text-align:left;padding:2px 6px;font-weight:600}
.mhcal-more:hover{color:#3A57E8}
/* week */
.mhcal-week{display:grid;grid-template-columns:repeat(7,1fr);border-top:1px solid var(--cal-line)}
.mhcal-weekcol{border-right:1px solid var(--cal-line);min-height:360px;transition:background .15s}
.mhcal-weekcol:last-child{border-right:none}
.mhcal-weekcol.today{background:rgba(58,87,232,.04)}
.mhcal-weekcol.over{background:rgba(58,87,232,.09);box-shadow:inset 0 0 0 2px rgba(58,87,232,.3)}
.mhcal-weekhead{display:flex;flex-direction:column;align-items:center;gap:2px;padding:.5rem;border-bottom:1px solid var(--cal-line)}
.mhcal-weekdow{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--cal-muted)}
.mhcal-weeknum{font-size:1rem;font-weight:700;color:var(--cal-ink)}
.mhcal-weeknum.today{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#3A57E8;color:#fff}
.mhcal-weekbody{display:flex;flex-direction:column;gap:4px;padding:.45rem}
.mhcal-empty{color:var(--cal-faint);font-size:.78rem;text-align:center;padding-top:.6rem}
/* day */
.mhcal-day{border-top:1px solid var(--cal-line);padding:.7rem 1rem 1rem}
.mhcal-dayrow{display:flex;align-items:center;gap:.8rem;width:100%;text-align:left;border-bottom:1px solid var(--cal-line2);padding:.55rem .2rem}
.mhcal-dayempty{padding:2.5rem 1rem;text-align:center;color:var(--cal-muted);font-size:.85rem}
/* list / agenda */
.mhcal-agenda{border-top:1px solid var(--cal-line);padding:.4rem 0}
.mhcal-agroup{display:flex;gap:1rem;padding:.7rem 1.1rem;border-bottom:1px solid var(--cal-line2)}
.mhcal-adate{display:flex;flex-direction:column;align-items:center;flex:0 0 46px;padding-top:.2rem}
.mhcal-adow{font-size:.6rem;font-weight:700;text-transform:uppercase;color:var(--cal-muted)}
.mhcal-aday{font-size:1.25rem;font-weight:800;color:var(--cal-ink);line-height:1.1}
.mhcal-amon{font-size:.6rem;color:var(--cal-faint);text-transform:uppercase}
.mhcal-aitems{flex:1;display:flex;flex-direction:column;gap:.35rem}
.mhcal-arow{display:flex;align-items:center;gap:.6rem;width:100%;text-align:left;background:none;border:none;padding:.3rem .1rem;border-radius:8px}
.mhcal-arow:hover{background:var(--cal-panel2)}
.mhcal-abar{width:4px;height:26px;border-radius:2px;flex:0 0 4px}
.mhcal-atitle{font-size:.86rem;font-weight:500;color:var(--cal-ink);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mhcal-apill{font-size:.62rem;font-weight:600;padding:.1rem .45rem;border-radius:20px;flex:0 0 auto}
.mhcal-aowner{font-size:.68rem;color:var(--cal-muted);flex:0 0 auto}
@media(max-width:640px){.mhcal-apill,.mhcal-aowner{display:none}}
/* Status legend — compact strip so the bar colour→meaning is obvious */
.mhcal-slegend{margin-top:.75rem;padding:.7rem 1rem;background:var(--cal-panel);border:1px solid var(--cal-line);border-radius:12px;display:flex;flex-wrap:wrap;gap:.6rem 1.1rem;font-size:.72rem;color:var(--cal-ink2);font-weight:500}
.mhcal-slegend-item{display:inline-flex;align-items:center;gap:.45rem}
.mhcal-slegend-chip{width:14px;height:14px;border-radius:4px;border:1px solid;flex:0 0 14px}
`;

const MHCAL_DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MHCAL_MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
type CalView = "month" | "week" | "day" | "list";

// ── Channels (docs/CALENDAR_SPEC.md) ──
// Each Instagram account, worked out from the SBU via lib/sbu-pages (the same list the
// Scheduler uses): the GooCampus accounts plus every brand linked on the Brands page
// (lib/publish-pages.ts), so a newly linked brand gets its own calendar by itself.
type CalChannel = string;   // "all" or an account id
function useCalChannels(): { value: CalChannel; label: string }[] {
  const pages = usePublishPages();
  return [{ value: "all", label: "All accounts" },
    ...pages.map((p) => ({ value: p.accountId, label: p.value === "12Plus / GC India" ? "12th Plus" : p.label }))];
}
const channelOfSbu = (sbu: string): string | null => { const p = pageForSbu(sbu); return (p && pageInfo(p).accountId) || null; };

// Pick several at once — "I don't select single SBU each time to see, I want see all
// the SBUs of my together" (Manya, 5 Oct). An empty selection means everything, so the
// calendar opens unfiltered and the button can always say what is being left out.
export function CalendarView({ rows, facets, onOpen, onSaved, loading }: { rows: Row[]; facets?: Facets; onOpen: (id: string) => void; onSaved: () => void; loading: boolean }) {
  const sbus = useSbus();   // live brand list (sql/027)
  const calChannels = useCalChannels();
  // The Mentorship calendar (sidebar → "Mentorship calendar", ?channel=goocampusworld):
  // the same calendar locked to the GooCampus World SBUs — "please create a separate
  // content calendar for mentorship because this is confusing for me" (Manya, 10 Oct).
  // It keeps its own saved filters, so a brand picked on the main calendar can't
  // leave this one empty.
  const worldOnly = useSearchParams().get("channel") === "goocampusworld";
  const filterKey = worldOnly ? `${CAL_FILTER_KEY}:world` : CAL_FILTER_KEY;
  // Brand quick-filter — "" = All. Isolates a single SBU across the whole grid without
  // touching the master hub-level filter, so the calendar can drill into one brand cheaply.
  // Both filters hold what to SHOW, with empty meaning everything. Statuses are
  // phrased that way rather than as a hide-list because the button can then say
  // "8 of 11 statuses" — a filter you can forget you left on is worse than none.
  // They stick per browser, like the Master sheet's, so walking to another tab and
  // back doesn't reset them.
  const [brandSel, setBrandSel] = useState<string[]>([]);
  const [statusSel, setStatusSel] = useState<string[]>([]);
  const [channelPick, setChannel] = useState<CalChannel>("all");
  const [calReady, setCalReady] = useState(false);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(filterKey) || "null");
      if (v && typeof v === "object") {
        if (Array.isArray(v.brands)) setBrandSel(v.brands.filter((x: unknown) => typeof x === "string"));
        if (Array.isArray(v.statuses)) setStatusSel(v.statuses.filter((x: unknown) => typeof x === "string"));
      }
      // The account: saved with the filters since 28 Oct; before that, read it off the
      // calendar highlighted in the left list ("acc-goocampus" → GooCampus).
      const ch = (v && typeof v === "object" && v.channel) || (localStorage.getItem(CAL_VIEW_KEY) || "").replace(/^acc-/, "") || "all";
      // Any saved account is kept — a linked brand's is only in the list once it loads.
      if (typeof ch === "string" && ch) setChannel(ch);
    } catch { /* private mode, or an older shape — open unfiltered */ }
    setCalReady(true);
  }, [filterKey]);
  useEffect(() => {
    if (!calReady) return;
    try {
      localStorage.setItem(filterKey, JSON.stringify({ brands: brandSel, statuses: statusSel, channel: channelPick }));
      // Each account keeps its own SBU picks, so going to another calendar and back
      // doesn't tick every SBU again (Praveen, 28 Oct).
      const by = JSON.parse(localStorage.getItem(`${filterKey}:sbus`) || "{}");
      localStorage.setItem(`${filterKey}:sbus`, JSON.stringify({ ...(by && typeof by === "object" ? by : {}), [channelPick]: brandSel }));
    } catch { /* private mode */ }
  }, [calReady, brandSel, statusSel, channelPick, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const sbusFor = (ch: CalChannel): string[] => {
    try { const v = JSON.parse(localStorage.getItem(`${filterKey}:sbus`) || "{}")?.[ch]; return Array.isArray(v) ? v.filter((x: unknown) => typeof x === "string") : []; }
    catch { return []; }
  };
  const channel: CalChannel = worldOnly ? "goocampusworld" : channelPick;
  const [createDate, setCreateDate] = useState<string | null>(null); // the + on a date
  // A day showing every task instead of the first four. Creating a task on a busy
  // day used to file it behind "+1 more", so it looked like nothing was added
  // ("I am creating a task in the calendar it doesn't show up" — Manya, 23 Sep).
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [tip, setTip] = useState<{ r: Row; x: number; y: number } | null>(null);
  const me = useApi<{ user?: { isAdmin?: boolean; permissions?: Record<string, boolean> } }>("/api/me");
  const canCreate = hasCapability(me.data?.user as never, "create_tasks");
  // Team & access → "Edit calendar" (22 Oct). Off = view only: no dragging, no drops.
  const canMove = !me.data ? false : canEditCalendar(me.data.user as never);
  const canChangeDates = hasCapability(me.data?.user as never, "reschedule");   // Plan with AI
  const [view, setView] = useState<CalView>("month");
  // Anchor date drives every view; ‹ › shifts by month/week/day, Today resets it.
  const [anchor, setAnchor] = useState(() => new Date());

  // Arrow keys move through the calendar the way they do in every other calendar,
  // and M/W/D/L pick the view. Shared with the ? card in Shortcuts.tsx.
  //
  // Bare letters, so the same rule applies as everywhere else: not while you are
  // typing, and never with a modifier held — Ctrl+W closes the browser tab and
  // Ctrl+D bookmarks the page, and neither should go anywhere near this.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === "ArrowLeft") { e.preventDefault(); shift(-1); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); shift(1); return; }
      if (k === "t") { e.preventDefault(); jumpToday(); return; }
      const view = k === "m" ? "month" : k === "w" ? "week" : k === "d" ? "day" : k === "l" ? "list" : null;
      if (view) { e.preventDefault(); setView(view as CalView); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag-to-reschedule: drop a task on a day to set its publishing date there.
  const [dragOver, setDragOver] = useState<string | null>(null);
  // A refused drop used to leave the card sitting on the old day with no word about
  // why; surface the reason instead.
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const { changePublishDate } = usePublishApproval();
  // A drop that needs Maheen's approval used to leave the card on the OLD day until
  // she approved, so dragging looked broken ("no option to drag and drop the task to
  // a different date", Manya, 10 Oct). The approval stays; the card now moves to the
  // requested day straight away, dashed, and goes back if she rejects.
  const pendingMoves = useApi<{ requests?: { postId: string; from: string | null; to: string | null; status: string }[] }>("/api/marketing-hub/date-change");
  const movedTo = useMemo(() => {
    const m = new Map<string, { from: string | null; to: string }>();
    for (const q of pendingMoves.data?.requests || []) if (q.status === "pending" && q.to) m.set(q.postId, { from: q.from, to: q.to.slice(0, 10) });
    return m;
  }, [pendingMoves.data]);
  // Plan with AI (4 Nov 2026, AiPlanner.tsx): the AI's version sits beside the
  // calendar; the switch shows it, and only what's applied is saved.
  const [aiPlan, setAiPlan] = useState<Plan | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiView, setAiView] = useState(false);
  const [aiApplying, setAiApplying] = useState(false);
  const [aiOff, setAiOff] = useState<Set<string>>(new Set());
  const [aiPick, setAiPick] = useState<string | null>(null);
  const aiTo = useMemo(() => {
    const m = new Map<string, { from: string; to: string }>();
    for (const mv of aiPlan?.moves || []) if (mv.ok && !aiOff.has(mv.id)) m.set(mv.id, { from: mv.from, to: mv.to });
    return m;
  }, [aiPlan, aiOff]);
  const dayMon = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const aiBlocked = useMemo(() => new Map((aiPlan?.moves || []).filter((m) => !m.ok).map((m) => [m.id, m])), [aiPlan]);
  const runAiPlan = async (ids: string[]) => {
    setAiOpen(true); setAiRunning(true); setAiError(""); setAiPlan(null); setAiOff(new Set()); setAiView(false);
    try {
      const r = await fetch("/api/ai-planner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Planning failed — try again.");
      setAiPlan(j as Plan);
    } catch (e) { setAiError((e as Error).message); }
    finally { setAiRunning(false); }
  };
  const applyAiPlan = async (only?: string) => {
    const moves = (aiPlan?.moves || []).filter((m) => m.ok && !aiOff.has(m.id) && (!only || m.id === only));
    if (!moves.length) return;
    setAiApplying(true);
    try {
      const r = await fetch("/api/post-planner/apply", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: moves.map((m) => ({ id: m.id, dateISO: m.to, why: m.why })) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't apply — try again.");
      showToast({ who: only ? "AI move applied" : "AI plan applied", body: `${j.applied || 0} moved${j.pending ? ` · ${j.pending} sent to Approvals` : ""} · each move is in the task's history as "AI plan".`, color: "#6D4AE8", av: "✓" });
      if (only) { setAiOff((s) => new Set(s).add(only)); setAiPlan((p) => p && { ...p, moves: p.moves.filter((m) => m.id !== only) }); }
      else { setAiPlan(null); setAiView(false); }
      setAiPick(null); await pendingMoves.refresh(); onSaved();
    } catch (e) { setFailure({ kind: "error", message: (e as Error).message }); }
    finally { setAiApplying(false); }
  };
  const dropOn = async (e: React.DragEvent, dayKey: string) => {
    e.preventDefault();
    setDragOver(null);
    if (!canMove) return;
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    const row = rows.find((r) => r.id === id);
    if (row && (movedTo.get(row.id)?.to ?? row.publishingDate?.slice(0, 10)) === dayKey) return; // no-op: same day
    // Non-admins get the reason popup → the drop is sent for Maheen's approval (the
    // card stays put until she approves); admins apply it immediately.
    const outcome = await changePublishDate({ id, title: row?.particulars || "This task", from: row?.publishingDate || null, to: dayKey, source: "calendar" });
    if (outcome === "pending") {
      await pendingMoves.refresh();
      showToast({ who: "Moved — waiting for approval", body: "It shows on the new day now; an admin approves the date.", color: "#3A57E8", av: "✓" });
      onSaved(); return;
    }
    if (outcome === "applied") { onSaved(); return; }
    if (outcome === "cancelled") return;
    setFailure({ kind: "error", message: "couldn't move that task — try again." });
  };

  // Channel first, then the brand chip, then bucket by yyyy-mm-dd.
  const channelRows = useMemo(() => channel === "all" ? rows : rows.filter((r) => channelOfSbu(r.sbu) === channel), [rows, channel]);
  const filteredRows = useMemo(() => {
    let out = brandSel.length ? channelRows.filter((r) => brandSel.includes(r.sbu)) : channelRows;
    if (statusSel.length) out = out.filter((r) => statusSel.includes(r.status));
    return out;
  }, [channelRows, brandSel, statusSel]);
  const byDay = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of filteredRows) {
      const d = (aiView ? aiTo.get(r.id)?.to : undefined) ?? movedTo.get(r.id)?.to ?? r.publishingDate?.slice(0, 10);
      if (!d) continue;
      let list = m.get(d);
      if (!list) { list = []; m.set(d, list); }
      list.push(r);
    }
    return m;
  }, [filteredRows, movedTo, aiView, aiTo]);

  // Per-brand counts across the current (unfiltered) range — powers the chip badges.
  const brandCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of channelRows) m.set(r.sbu, (m.get(r.sbu) || 0) + 1);
    return m;
  }, [channelRows]);

  // Which statuses actually exist in the current view — legend only surfaces those.
  const statusesInView = useMemo(() => {
    const s = new Set<string>();
    for (const r of filteredRows) if (r.status) s.add(r.status);
    return Array.from(s);
  }, [filteredRows]);

  // 42-cell month grid (always 6 full rows, prev/next-month spillover greyed out).
  const monthGrid = useMemo(() => {
    const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = new Date(firstOfMonth);
    start.setDate(start.getDate() - mondayOffset(firstOfMonth));
    const today = ymd(new Date());
    const cells: { date: Date; inMonth: boolean; isToday: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      cells.push({ date: d, inMonth: d.getMonth() === anchor.getMonth(), isToday: ymd(d) === today });
    }
    return cells;
  }, [anchor]);

  const weekDays = useMemo(() => {
    const start = new Date(anchor); start.setDate(anchor.getDate() - mondayOffset(anchor));
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [anchor]);

  // List view: every dated day in the anchor month that has tasks.
  const agenda = useMemo(() => {
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const days: { date: Date; items: Row[] }[] = [];
    for (let day = 1; day <= 31; day++) {
      const d = new Date(y, m, day); if (d.getMonth() !== m) break;
      const items = byDay.get(ymd(d)) || [];
      if (items.length) days.push({ date: d, items });
    }
    return days;
  }, [anchor, byDay]);

  const shift = (dir: number) => setAnchor((cur) => {
    const d = new Date(cur);
    if (view === "week") d.setDate(d.getDate() + dir * 7);
    else if (view === "day") d.setDate(d.getDate() + dir);
    else d.setMonth(d.getMonth() + dir);
    return d;
  });
  const jumpToday = () => setAnchor(new Date());

  const title = useMemo(() => {
    if (view === "day") return `${MHCAL_DAY_FULL[anchor.getDay()]}, ${MHCAL_MONTH_ABBR[anchor.getMonth()]} ${anchor.getDate()}`;
    if (view === "week") {
      const s = weekDays[0], e = weekDays[6];
      const sM = MHCAL_MONTH_ABBR[s.getMonth()], eM = MHCAL_MONTH_ABBR[e.getMonth()];
      return sM === eM ? `${sM} ${s.getDate()} – ${e.getDate()}, ${e.getFullYear()}` : `${sM} ${s.getDate()} – ${eM} ${e.getDate()}, ${e.getFullYear()}`;
    }
    return `${MHCAL_MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`;
  }, [view, anchor, weekDays]);

  const allSbus = facets?.sbu || [];

  // Shared soft-tinted event bar (dark readable text). Draggable so any view that
  // shows day cells can reschedule.
  const EvBar = (r: Row, block?: boolean) => {
    const st = calStatusStyle(r.status);
    const moved = movedTo.get(r.id);
    const ai = aiView ? aiTo.get(r.id) : undefined;
    const aiNo = aiView ? aiBlocked.get(r.id) : undefined;
    if (ai || aiNo) return (
      <button key={r.id} onClick={() => setAiPick(r.id)} className={`mhcal-ev${block ? " block" : ""}`}
        style={ai ? { background: "#E7E0FD", borderColor: "#6D4AE8", borderWidth: 1.5, color: "#2A1C6E" } : { background: st.bg, borderColor: "#E58B80", borderWidth: 2, color: st.text }}>
        <span className="mhcal-evtitle">
          <span style={{ background: ai ? "#6D4AE8" : "#C03221", color: "#fff", fontSize: 10, fontWeight: 600, borderRadius: 4, padding: "0 4px", marginRight: 4 }}>
            {ai ? `AI · was ${dayMon(ai.from)}` : `AI wanted ${dayMon(aiNo!.to)} — not allowed`}
          </span>{r.particulars || "(untitled)"}
        </span>
      </button>
    );
    return (
      <button
        key={r.id}
        title={moved ? `Moved from ${moved.from ? fmtDate(moved.from) : "no date"} — waiting for an admin to approve` : undefined}
        draggable={canMove}
        onDragStart={canMove ? (e) => { e.dataTransfer.setData("text/plain", r.id); e.dataTransfer.effectAllowed = "move"; } : undefined}
        onClick={() => onOpen(r.id)}
        onMouseEnter={(e) => { const b = e.currentTarget.getBoundingClientRect(); setTip({ r, x: b.left, y: b.bottom + 6 }); }}
        onMouseLeave={() => setTip((t) => (t?.r.id === r.id ? null : t))}
        onDragEnd={() => setTip(null)}
        className={`mhcal-ev${block ? " block" : ""}`}
        style={{ background: st.bg, borderColor: moved ? "#3A57E8" : st.border, borderStyle: moved ? "dashed" : undefined, color: st.text, opacity: aiView ? 0.45 : undefined }}
      >
        {/* Just the title. The chip is already tinted by status (with a legend
            below), so a second brand-coloured square only made the grid busy
            — "no need for the coloured tiny boxes ... it is looking a bit messy"
            (Manya, 23 Sep). Brand is still in the hover tooltip and the SBU filter. */}
        <span className="mhcal-evtitle">{r.particulars || "(untitled)"}</span>
      </button>
    );
  };
  const AddBtn = (key: string) => canCreate && (
    <button className="mhcal-add" title="Create a task on this date" onClick={(e) => { e.stopPropagation(); setCreateDate(key); }}>+</button>
  );

  return (
    <div className="flex gap-4 items-start">
    {/* An old "Mentorship calendar" link (?channel=goocampusworld) still opens its
        locked view; everywhere else the rail of views replaces separate calendars. */}
    {!worldOnly && <CalendarViewsRail rows={rows} current={{ channel, brands: brandSel, statuses: statusSel }}
      apply={(c) => { setChannel(c.channel); setBrandSel(c.brands); setStatusSel(c.statuses); }} sbusFor={sbusFor} />}
    <div className="mhcal flex-1 min-w-0">
      <style dangerouslySetInnerHTML={{ __html: MHCAL_CSS }} />

      {/* Header card — the page already shows the "Marketing Hub › Content Calendar"
          banner above, so no second hero here; just the calendar title + count + live. */}
      <div className="mhcal-titlecard">
        <h4>Calendar</h4>
        <div className="mhcal-tc-right">
          {!worldOnly && (
            <div style={{ width: 190 }}>
              <PreviewSelect value={channel} onChange={(v) => { setChannel(v as CalChannel); setBrandSel(sbusFor(v as CalChannel)); }} options={calChannels} />
            </div>
          )}
          <div style={{ width: 240 }}>
            {/* Every SBU, always (user). Choosing brands drops the account filter back to
                All, so a pick can never land on an empty calendar — which is what the old
                single-select guarded against by switching accounts for you. */}
            <MultiPick label="Primary Interests" selected={brandSel} total={channelRows.length}
              // Stays on the account unless every SBU picked belongs to another one
              // (that would leave an empty calendar).
              onChange={(next) => { setBrandSel(next); if (next.length && !isPickNone(next) && !worldOnly && channel !== "all" && !next.some((b) => channelOfSbu(b) === channel)) setChannel("all"); }}
              options={Array.from(new Set([...allSbus, ...sbus])).filter((x) => !worldOnly || channelOfSbu(x) === "goocampusworld").sort((a, b) => a.localeCompare(b))
                .map((x) => ({ value: x, count: channelRows.filter((r) => r.sbu === x).length }))} />
          </div>
          <div style={{ width: 215 }}>
            {/* "Give me the content status filter here so that I can filter the status
                which I don't want to see" (Manya, 5 Oct). Swatches match the chips on the
                grid, so the list reads the same way the calendar does. */}
            <MultiPick label="statuses" selected={statusSel} onChange={setStatusSel} total={channelRows.length}
              options={ALL_STATUSES.map((st) => ({ value: st.key, count: channelRows.filter((r) => r.status === st.key).length, swatch: statusPill(st.key).bg }))} />
          </div>
          <span className="mhcal-tc-count">{fmtInt(filteredRows.length)} tasks in view</span>
          <span className="mhcal-live"><span className="dot" />{loading ? "Syncing…" : "Live"}</span>
          {canChangeDates && (
            <button onClick={() => (aiPlan ? setAiOpen(true) : runAiPlan(filteredRows.map((r) => r.id)))} disabled={aiRunning}
              title="Suggest better days for the next two weeks, based on what's timely — nothing changes until you apply"
              className="inline-flex items-center gap-1.5 bg-[#6D4AE8] hover:brightness-95 text-white text-[13px] font-medium rounded-lg px-3.5 py-2 disabled:opacity-50">
              <IconSparkles size={15} />{aiRunning ? "Planning…" : aiPlan ? "AI plan" : "Plan with AI"}
            </button>
          )}
        </div>
      </div>

      {aiPlan && (
        <AiPlanBar aiView={aiView} setAiView={setAiView} count={aiTo.size} applying={aiApplying}
          onWhy={() => setAiOpen(true)} onApply={() => applyAiPlan()}
          onDiscard={() => { setAiPlan(null); setAiView(false); showToast({ who: "AI plan discarded", body: "The calendar is unchanged.", color: "#6D4AE8", av: "✓" }); }} />
      )}
      <AiPlanPanel open={aiOpen} onClose={() => setAiOpen(false)} plan={aiPlan} running={aiRunning} error={aiError}
        excluded={aiOff} onToggle={(id, on) => setAiOff((s) => { const n = new Set(s); if (on) n.delete(id); else n.add(id); return n; })}
        onSeeCalendar={() => { setAiOpen(false); setAiView(true); }} />
      {aiPick && (() => {
        const mv = aiPlan?.moves.find((m) => m.id === aiPick);
        const r = rows.find((x) => x.id === aiPick);
        if (!mv || !r) return null;
        return (
          <div className="fixed inset-0 z-50 bg-[#232D42]/35 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setAiPick(null); }}>
            <div className="bg-white rounded-2xl border border-gray-100 w-full max-w-[520px]">
              <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
                <div><div className="text-[16px] font-semibold text-[#232D42]">{r.particulars}</div><div className="text-[12.5px] text-[#8A92A6] mt-0.5">{r.sbu} · {r.status} · on the calendar: {fmtDateShort(mv.from)}</div></div>
                <button onClick={() => setAiPick(null)} className="p-1.5 rounded-lg text-[#8A92A6] hover:bg-[#F6F7FB]" aria-label="Close"><IconX size={18} /></button>
              </div>
              <div className="px-5 py-4">
                <div className={`rounded-xl border px-3 py-2.5 ${mv.ok ? "border-[#D9CEFB] bg-[#FAF8FF]" : "border-[#F5C9C3] bg-[#FDECEC]"}`}>
                  <div className={`text-[13px] font-semibold ${mv.ok ? "text-[#3F2A9C]" : "text-[#C03221]"}`}>{mv.ok ? `AI plan: ${fmtDateShort(mv.from)} → ${fmtDateShort(mv.to)} (not applied yet)` : `AI wanted ${fmtDateShort(mv.to)} — not allowed`}</div>
                  <div className="text-[12.5px] text-[#4A5468] mt-1">{mv.ok ? mv.why : mv.blocked}</div>
                  {mv.ok && <Brief m={mv} open />}
                  {mv.ok && (
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => applyAiPlan(mv.id)} disabled={aiApplying} className="inline-flex items-center gap-1.5 bg-[#6D4AE8] text-white rounded-lg px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-40"><IconCheck size={14} />Apply just this move</button>
                      <button onClick={() => { setAiOff((s) => new Set(s).add(mv.id)); setAiPick(null); }} className="border border-gray-200 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-[#4A5468]">Leave it out</button>
                      <button onClick={() => { setAiPick(null); onOpen(r.id); }} className="ml-auto border border-gray-200 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-[#4A5468]">Open task</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Calendar card — toolbar INSIDE the card, then the active view */}
      <div className="mhcal-card">
        <div className="mhcal-toolbar">
          <div className="mhcal-nav">
            <button className="mhcal-navbtn" onClick={() => shift(-1)} aria-label="Previous">‹</button>
            <button className="mhcal-navbtn" onClick={() => shift(1)} aria-label="Next">›</button>
            <button className="mhcal-today" onClick={jumpToday}>Today</button>
          </div>
          <div className="mhcal-title">{title}</div>
          <div className="mhcal-views">
            {(["month", "week", "day", "list"] as CalView[]).map((v) => (
              <button key={v} className={`mhcal-viewbtn ${view === v ? "on" : ""}`} onClick={() => setView(v)}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {view === "month" && (
          <>
            <div className="mhcal-dow">{MHCAL_WEEK_HEADER.map((d) => <span key={d}>{d}</span>)}</div>
            <div className="mhcal-grid">
              {monthGrid.map((cell) => {
                const key = ymd(cell.date);
                const list = byDay.get(key) || [];
                const bars = list.map((r) => EvBar(r));
                // AI plan view: where a moved task used to be.
                if (aiView) for (const r of filteredRows) { const mv = aiTo.get(r.id); if (mv && mv.from === key) bars.unshift(
                  <button key={`ghost-${r.id}`} onClick={() => setAiPick(r.id)} className="mhcal-ev" style={{ background: "repeating-linear-gradient(135deg,#fff,#fff 6px,#F7F4FF 6px,#F7F4FF 12px)", border: "1.5px dashed #C9C0F5", color: "#8C7FD9" }}>
                    <span className="mhcal-evtitle">→ {dayMon(mv.to)} · {r.particulars || "(untitled)"}</span>
                  </button>); }
                const cls = `mhcal-cell${cell.inMonth ? "" : " out"}${cell.isToday ? " today" : ""}${dragOver === key ? " over" : ""}`;
                return (
                  <div key={key} className={cls}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(key); }}
                    onDragLeave={() => setDragOver((prev) => (prev === key ? null : prev))}
                    onDrop={(e) => dropOn(e, key)}>
                    <div className="mhcal-daynum"><span className="mhcal-dnum">{cell.date.getDate()}</span>{AddBtn(key)}</div>
                    <div className="mhcal-events">
                      {expandedDay === key ? bars : bars.slice(0, 4)}
                      {bars.length > 4 && (
                        <button className="mhcal-more" onClick={() => setExpandedDay(expandedDay === key ? null : key)}>
                          {expandedDay === key ? "Show less" : `+${bars.length - 4} more`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {view === "week" && (
          <div className="mhcal-week">
            {weekDays.map((d) => {
              const key = ymd(d);
              const list = byDay.get(key) || [];
              const isToday = key === ymd(new Date());
              return (
                <div key={key} className={`mhcal-weekcol${isToday ? " today" : ""}${dragOver === key ? " over" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(key); }}
                  onDragLeave={() => setDragOver((prev) => (prev === key ? null : prev))}
                  onDrop={(e) => dropOn(e, key)}>
                  <div className="mhcal-weekhead">
                    <span className="mhcal-weekdow">{MHCAL_DAY_LABELS[d.getDay()]}</span>
                    <span className={`mhcal-weeknum${isToday ? " today" : ""}`}>{d.getDate()}</span>{AddBtn(key)}
                  </div>
                  <div className="mhcal-weekbody">
                    {list.length === 0 ? <span className="mhcal-empty">—</span> : list.map((r) => EvBar(r, true))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view === "day" && (
          <div className="mhcal-day">
            {(() => {
              const list = byDay.get(ymd(anchor)) || [];
              const add = canCreate && <button className="mhcal-today" style={{ marginBottom: ".5rem" }} onClick={() => setCreateDate(ymd(anchor))}>+ New task on this day</button>;
              if (list.length === 0) return <>{add}<div className="mhcal-dayempty">No tasks scheduled for this day.</div></>;
              return <>{add}{list.map((r) => <div key={r.id} className="mhcal-dayrow">{EvBar(r, true)}</div>)}</>;
            })()}
          </div>
        )}

        {view === "list" && (
          <div className="mhcal-agenda">
            {agenda.length === 0 ? <div className="mhcal-dayempty">No tasks this month.</div>
              : agenda.map(({ date, items }) => (
                <div key={ymd(date)} className="mhcal-agroup">
                  <div className="mhcal-adate">
                    <span className="mhcal-adow">{MHCAL_DAY_LABELS[date.getDay()]}</span>
                    <span className="mhcal-aday">{date.getDate()}</span>
                    <span className="mhcal-amon">{MHCAL_MONTH_ABBR[date.getMonth()]}</span>
                  </div>
                  <div className="mhcal-aitems">
                    {items.map((r) => {
                      const st = calStatusStyle(r.status);
                      return (
                        <button key={r.id} className="mhcal-arow" onClick={() => onOpen(r.id)}>
                          <span className="mhcal-abar" style={{ background: sbuColor(r.sbu, allSbus) }} />
                          <span className="mhcal-atitle">{r.particulars || "(untitled)"}</span>
                          <span className="mhcal-apill" style={{ background: st.bg, color: st.text }}>{r.status}</span>
                          <span className="mhcal-aowner">{r.owner || "—"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Status legend — only surfaces statuses actually present in the current view */}
      {statusesInView.length > 0 && (
        <div className="mhcal-slegend">
          {statusesInView.map((s) => {
            const st = calStatusStyle(s);
            return (
              <div key={s} className="mhcal-slegend-item">
                <span className="mhcal-slegend-chip" style={{ background: st.bg, borderColor: st.border }} />
                {s}
              </div>
            );
          })}
        </div>
      )}
      {tip && (() => {
        // Keep the card on screen: flip left near the right edge, above near the bottom.
        const W = 264, H = 150;
        const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
        const vh = typeof window === "undefined" ? 800 : window.innerHeight;
        const left = Math.max(8, Math.min(tip.x, vw - W - 8));
        const top = tip.y + H > vh ? Math.max(8, tip.y - H - 14) : tip.y;
        const st = calStatusStyle(tip.r.status);
        return (
          <div className="mhcal-tip" style={{ left, top }} role="tooltip">
            <div className="mhcal-tip-title">{tip.r.particulars || "(untitled)"}</div>
            {tip.r.status && (
              <div className="mhcal-tip-row" style={{ marginBottom: 5 }}>
                <span className="mhcal-tip-k">Status</span>
                <span className="mhcal-tip-status" style={{ background: st.bg, borderColor: st.border, color: st.text }}>{tip.r.status}</span>
              </div>
            )}
            <div className="mhcal-tip-row"><span className="mhcal-tip-k">Primary Interest</span><span className="mhcal-tip-v">{tip.r.sbu || "—"}</span></div>
            <div className="mhcal-tip-row"><span className="mhcal-tip-k">Format</span><span className="mhcal-tip-v">{tip.r.type || "—"}</span></div>
            <div className="mhcal-tip-row"><span className="mhcal-tip-k">Owner</span><span className="mhcal-tip-v">{tip.r.owner || "—"}</span></div>
            <div className="mhcal-tip-hint">{canMove ? "Click to open · drag to reschedule" : "Click to open · view only"}</div>
          </div>
        );
      })()}
      <SaveFailureOverlay failure={failure} onClose={() => setFailure(null)} />
      {createDate && (
        <NewTaskDialog onClose={() => setCreateDate(null)}
          onCreated={() => { setExpandedDay(createDate); onSaved(); }}
          initial={{ publishDate: createDate, sbu: (brandSel.length === 1 && !isPickNone(brandSel) ? brandSel[0] : "") || (channel === "12thplusdotcom" ? "12thPlus.com" : channel === "goocampusworld" ? "Mentorship Platform" : undefined) }} />
      )}
    </div>
    </div>
  );
}

// ── Calendar views rail (26 Oct) ──
// Saved views for the Content calendar, the same idea as the Master sheet's rail:
// "one content calendar, and they create the calendars they need inside it" instead
// of a new sidebar page each time (Praveen). A view is the account + brands +
// statuses; it lives in mh_views with config.kind = "calendar". Personal views show
// only to their creator; collaborative/locked ones to the whole team.
type CalFilters = { channel: CalChannel; brands: string[]; statuses: string[] };
const CAL_VIEW_KEY = "mh-cal-view";
const CAL_ACCOUNT_SECTION = "By account";   // mh_views.section for views filed under By account
const calCfg = (v: SavedView) => v.config as unknown as Partial<CalFilters>;
const sameFilters = (a: CalFilters, b: Partial<CalFilters>) =>
  a.channel === (b.channel || "all") &&
  [...a.brands].sort().join("|") === [...(b.brands || [])].sort().join("|") &&
  [...a.statuses].sort().join("|") === [...(b.statuses || [])].sort().join("|");
const matchCal = (r: Row, f: Partial<CalFilters>) =>
  (!f.channel || f.channel === "all" || channelOfSbu(r.sbu) === f.channel) &&
  (!f.brands?.length || f.brands.includes(r.sbu)) &&
  (!f.statuses?.length || f.statuses.includes(r.status));

// "+ New view" — one form: name, where it shows (Saved views / By account), the
// account, brands and statuses, and who sees it (Praveen, 26 Oct). Starts from the
// filters on screen, with a live count of what the view will show.
function NewCalViewDialog({ rows, initial, onClose, onSave }: {
  rows: Row[]; initial: CalFilters; onClose: () => void;
  onSave: (d: { name: string; group: "saved" | "account"; access: "personal" | "collaborative"; f: CalFilters }) => Promise<void>;
}) {
  const sbus = useSbus();
  const calChannels = useCalChannels();
  const [name, setName] = useState("");
  const [group, setGroup] = useState<"saved" | "account">("saved");
  const [access, setAccess] = useState<"personal" | "collaborative">("personal");
  const [f, setF] = useState<CalFilters>({ ...initial, brands: [] });   // brands start unticked
  const [busy, setBusy] = useState(false);
  const accRows = f.channel === "all" ? rows : rows.filter((r) => channelOfSbu(r.sbu) === f.channel);
  const brandOpts = Array.from(new Set([...rows.map((r) => r.sbu).filter(Boolean), ...sbus])).sort((a, b) => a.localeCompare(b))
    .map((x) => ({ value: x, count: accRows.filter((r) => r.sbu === x).length }));
  const n = rows.filter((r) => matchCal(r, f)).length;
  const Choice = <T extends string>({ value, set, opts }: { value: T; set: (v: T) => void; opts: [T, string, string][] }) => (
    <div className="grid grid-cols-2 gap-2">
      {opts.map(([v, label, hint]) => (
        <button key={v} type="button" onClick={() => set(v)}
          className={`text-left rounded-xl border px-3 py-2.5 transition ${value === v ? "border-brand bg-brand-light" : "border-gray-200 hover:border-gray-300"}`}>
          <div className={`text-[13px] font-medium ${value === v ? "text-brand" : "text-[#232D42]"}`}>{label}</div>
          <div className="text-[11.5px] text-[#8A92A6]">{hint}</div>
        </button>
      ))}
    </div>
  );
  const Label = ({ t }: { t: string }) => <div className="text-[12px] font-medium text-[#8A92A6] mb-1.5">{t}</div>;
  const submit = async () => { if (!name.trim() || busy) return; setBusy(true); await onSave({ name: name.trim(), group, access, f }); setBusy(false); };
  return (
    <div className="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-gray-100 w-full max-w-[520px]" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-3 border-b border-gray-100">
          <div className="text-[17px] font-medium text-[#232D42]">New calendar view</div>
          <div className="text-[12.5px] text-[#8A92A6]">Pick what this calendar shows. It opens from the left rail.</div>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <Label t="Name" />
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onClose(); }}
              placeholder="e.g. Australia, NEET PG, GooCampus UK"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[14px] outline-none focus:border-brand" />
          </div>
          <div>
            <Label t="Show it under" />
            <Choice value={group} set={setGroup} opts={[["saved", "Saved views", "A filter you use often"], ["account", "By account", "A page / account of its own"]]} />
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label t="Account" />
              <div className="w-full [&>*]:w-full"><PreviewSelect value={f.channel} onChange={(v) => setF({ ...f, channel: v as CalChannel, brands: [] })} options={calChannels} /></div>
            </div>
            <div>
              <Label t="Primary Interests" />
              {/* Starts with nothing ticked; tick the brands this view is for (Praveen, 26
                  Oct). The calendar's own picker starts all-ticked, so clicking there
                  REMOVES a brand — the wrong way round for building a view. */}
              <div className="border border-gray-200 rounded-lg max-h-[168px] overflow-auto py-1">
                {brandOpts.map((o) => {
                  const on = f.brands.includes(o.value);
                  return (
                    <label key={o.value} className={`flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer hover:bg-gray-50 ${on ? "text-[#232D42] font-medium" : "text-[#4A5468]"}`}>
                      <input type="checkbox" checked={on} className="w-4 h-4 accent-[#3A57E8]"
                        onChange={() => { const next = on ? f.brands.filter((b) => b !== o.value) : [...f.brands, o.value]; setF({ ...f, brands: next, channel: next.length ? "all" : f.channel }); }} />
                      <span className="flex-1 truncate">{o.value}</span>
                      <span className="text-[11px] text-[#8A92A6]">{o.count}</span>
                    </label>
                  );
                })}
              </div>
              <div className="text-[11.5px] text-[#8A92A6] mt-1">{f.brands.length ? `${f.brands.length} picked` : "None ticked = every Primary Interest"}</div>
            </div>
            <div>
              <Label t="Statuses" />
              <MultiPick label="statuses" selected={f.statuses} total={accRows.length} onChange={(next) => setF({ ...f, statuses: next })}
                options={ALL_STATUSES.map((st) => ({ value: st.key, count: accRows.filter((r) => r.status === st.key).length, swatch: statusPill(st.key).bg }))} />
            </div>
          </div>
          <div>
            <Label t="Who can see it" />
            <Choice value={access} set={setAccess} opts={[["personal", "Just me", "Only you see this view"], ["collaborative", "Whole team", "Everyone sees and can use it"]]} />
          </div>
        </div>
        <div className="px-6 py-3.5 border-t border-gray-100 flex items-center gap-3">
          <span className="text-[12.5px] text-[#8A92A6]">{fmtInt(n)} task{n === 1 ? "" : "s"} match</span>
          <button onClick={onClose} className="ml-auto text-[13px] font-medium text-[#4A5468] px-3 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={!name.trim() || busy}
            className="text-[13px] font-medium bg-brand text-white px-4 py-2 rounded-lg hover:bg-brand-dark disabled:opacity-50">{busy ? "Saving…" : "Save view"}</button>
        </div>
      </div>
    </div>
  );
}

function CalendarViewsRail({ rows, current, apply, sbusFor }: { rows: Row[]; current: CalFilters; apply: (f: CalFilters) => void; sbusFor: (ch: CalChannel) => string[] }) {
  const { data, refresh } = useApi<{ views: SavedView[]; me: string | null }>("/api/marketing-hub/views");
  const me = data?.me ?? null;
  // Newest first — a view you just made lands at the top, not under the others (Praveen, 26 Oct).
  const saved = (data?.views || []).filter((v) => (v.config as { kind?: string }).kind === "calendar" && (v.access !== "personal" || v.created_by === me)).reverse();
  // A view can be filed under "By account" (a new page/account) or "Saved views".
  const isAccount = (v: SavedView) => v.section === CAL_ACCOUNT_SECTION;
  const savedViews = saved.filter((v) => !isAccount(v));
  const accountViews = saved.filter(isAccount);
  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState("all");
  useEffect(() => { try { const v = localStorage.getItem(CAL_VIEW_KEY); if (v) setActive(v); } catch { /* private mode */ } }, []);
  const choose = (id: string, f: CalFilters) => { setActive(id); apply(f); try { localStorage.setItem(CAL_VIEW_KEY, id); } catch { /* private mode */ } };
  const ALL: CalFilters = { channel: "all", brands: [], statuses: [] };
  const calChannels = useCalChannels();
  const builtIn = calChannels.filter((c) => c.value !== "all").map((c) => ({ id: `acc-${c.value}`, label: c.label, f: { ...ALL, channel: c.value } as CalFilters }));
  // A remembered view that has since been deleted falls back to All tasks — its
  // filters too, not just the highlight.
  useEffect(() => {
    if (data && active !== "all" && !active.startsWith("acc-") && !saved.some((v) => v.id === active)) choose("all", { ...ALL, statuses: current.statuses });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  // The account can also change from the dropdown above the calendar (or by picking
  // only another account's SBUs); move the highlight with it so the list never says
  // GooCampus while the calendar shows 12th Plus (28 Oct). Saved views keep theirs —
  // they show "Save changes / Undo" instead. Skips the first run: the remembered
  // highlight is still being read then.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (active !== "all" && !active.startsWith("acc-")) return;
    const id = current.channel === "all" ? "all" : `acc-${current.channel}`;
    if (id !== active) { setActive(id); try { localStorage.setItem(CAL_VIEW_KEY, id); } catch { /* private mode */ } }
  }, [current.channel]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeSaved = saved.find((v) => v.id === active);
  const changed = !!activeSaved && !sameFilters(current, calCfg(activeSaved));

  const save = async (body: Record<string, unknown>, method: "POST" | "PATCH") => {
    const res = await fetch("/api/marketing-hub/views", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { alertDialog(j.error || "Could not save the view."); return null; }
    await refresh();
    return j.view as SavedView | undefined;
  };
  const createView = async (d: { name: string; group: "saved" | "account"; access: "personal" | "collaborative"; f: CalFilters }) => {
    const v = await save({ name: d.name, section: d.group === "account" ? CAL_ACCOUNT_SECTION : "Calendar", access: d.access, config: { kind: "calendar", ...d.f } }, "POST");
    if (v) { setCreating(false); choose(v.id, d.f); }
  };
  const onAction = async (action: string, v: SavedView, payload?: string) => {
    switch (action) {
      case "access": await save({ id: v.id, access: payload }, "PATCH"); break;
      case "rename": { const n = await promptDialog({ title: "Rename view", defaultValue: v.name }); if (n && n.trim()) await save({ id: v.id, name: n.trim() }, "PATCH"); break; }
      case "description": { const d = await promptDialog({ title: "View description", defaultValue: v.description || "" }); if (d !== null) await save({ id: v.id, description: d }, "PATCH"); break; }
      case "duplicate": await save({ name: `${v.name} copy`, section: v.section, access: "personal", config: v.config }, "POST"); break;
      case "copyConfig": { const src = saved.find((c) => c.id === payload); if (src) await save({ id: v.id, config: src.config }, "PATCH"); break; }
      case "reassign": await save({ id: v.id, createdBy: payload }, "PATCH"); break;
      case "csv": downloadText(`${v.name.replace(/[^a-z0-9]+/gi, "-")}.csv`, viewRowsToCsv(rows.filter((r) => matchCal(r, calCfg(v))))); break;
      case "print": choose(v.id, { ...ALL, ...calCfg(v) } as CalFilters); setTimeout(() => window.print(), 150); break;
      case "delete":
        if (!(await confirmDialog({ title: `Delete view "${v.name}"?`, action: "Delete view", danger: true }))) break;
        { const res = await fetch(`/api/marketing-hub/views?id=${v.id}`, { method: "DELETE" });
          if (!res.ok) { const j = await res.json().catch(() => ({})); alertDialog(j.error || "Could not delete the view."); break; } }
        if (active === v.id) choose("all", ALL);
        await refresh();
        break;
    }
  };
  const Item = ({ id, label, f, color }: { id: string; label: string; f: CalFilters; color: string }) => {
    const on = active === id;
    return (
      // All tasks / an account switch the account and bring back that account's own
      // SBU picks; the statuses you picked stay ("when I change the calendar it's
      // coming back to the old filters", 28 Oct).
      <button onClick={() => choose(id, { ...f, brands: sbusFor(f.channel), statuses: current.statuses })}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition ${on ? "bg-brand-light text-brand font-medium" : "text-gray-700 hover:bg-gray-50"}`}>
        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: color }} />
        <span className="truncate flex-1 text-left">{label}</span>
        <span className={`text-[11px] ${on ? "text-brand/70" : "text-gray-400"}`}>{fmtInt(rows.filter((r) => matchCal(r, f)).length)}</span>
      </button>
    );
  };
  const Head = ({ t }: { t: string }) => <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t}</div>;
  const ACC_COLOR: Record<string, string> = { "acc-goocampus": "#3A57E8", "acc-goocampusworld": "#06B6D4", "acc-12thplusdotcom": "#E11D48" };
  return (
    <div className="w-56 flex-shrink-0 bg-white border border-gray-100 rounded-xl p-2">
      <button onClick={() => setCreating(true)} title="Make a calendar view — pick its account, brands and statuses"
        className="w-full flex items-center justify-center gap-1.5 mb-1 bg-brand text-white rounded-lg py-2 text-[14px] font-medium hover:brightness-105">
        <IconPlus size={15} stroke={2} />New view
      </button>
      {savedViews.length > 0 && (
        <div className="mb-2">
          <Head t="Saved views" />
          {savedViews.map((v) => <SavedItem key={v.id} v={v} />)}
        </div>
      )}
      <Head t="Default" />
      <Item id="all" label="All tasks" f={ALL} color="#94A3B8" />
      <div className="mt-2" />
      <Head t="By account" />
      {builtIn.map((b) => <Item key={b.id} id={b.id} label={b.label} f={b.f} color={ACC_COLOR[b.id] || "#8B5CF6"} />)}
      {accountViews.map((v) => <SavedItem key={v.id} v={v} />)}
      {creating && <NewCalViewDialog rows={rows} initial={current} onClose={() => setCreating(false)} onSave={createView} />}
    </div>
  );
  function SavedItem({ v }: { v: SavedView }) {
            const on = v.id === active;
            const AccessIcon = ACCESS_META[v.access].icon;
            const f = { ...ALL, ...calCfg(v) } as CalFilters;
            return (
              <div key={v.id}>
                <div className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] ${on ? "bg-brand-light text-brand font-medium" : "text-gray-700 hover:bg-gray-50"}`}>
                  <button onClick={() => choose(v.id, f)} className="flex items-center gap-2 flex-1 min-w-0 text-left" title={v.description || ACCESS_META[v.access].label}>
                    <AccessIcon size={13} stroke={1.8} className="flex-shrink-0" />
                    <span className="truncate flex-1">{v.name}</span>
                  </button>
                  <span className={`text-[11px] ${on ? "text-brand/70" : "text-gray-400"} group-hover:hidden`}>{fmtInt(rows.filter((r) => matchCal(r, f)).length)}</span>
                  <ViewMenu view={v} otherViews={saved.filter((o) => o.id !== v.id)} onAction={(a, p) => onAction(a, v, p)} />
                </div>
                {/* The filters were changed while this view was open — keep or drop. */}
                {on && changed && (
                  <div className="flex items-center gap-2 px-2 pb-1 text-[11.5px]">
                    {v.canEdit && <button className="text-brand hover:underline" onClick={() => save({ id: v.id, config: { kind: "calendar", ...current } }, "PATCH")}>Save changes</button>}
                    <button className="text-gray-500 hover:underline" onClick={() => apply(f)}>Undo</button>
                  </div>
                )}
              </div>
            );
  }
}


// Status → pill colours (mirrors the pipeline stage palette; unknown = neutral).
function statusPill(s: string): { bg: string; text: string } {
  return STATUS_TINT[s] || STATUS_TINT_FALLBACK;
}
function priorityPill(p: string): { bg: string; text: string } {
  const v = p.toLowerCase();
  if (v.includes("high") || v.includes("urgent")) return { bg: "#FCEBEB", text: "#A32D2D" };
  if (v.includes("med")) return { bg: "#FAEEDA", text: "#854F0B" };
  return { bg: "#F1EFE8", text: "#5F5E5A" };
}
function PlatformIcons({ platforms }: { platforms: string[] }) {
  if (!platforms.length) return <span className="text-gray-300">—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {platforms.map((p, i) => {
        const k = p.toLowerCase();
        if (k.includes("insta")) return <IconBrandInstagram key={i} size={15} className="text-gray-400" />;
        if (k.includes("face")) return <IconBrandFacebook key={i} size={15} className="text-gray-400" />;
        if (k.includes("linked")) return <IconBrandLinkedin key={i} size={15} className="text-gray-400" />;
        if (k.includes("you")) return <IconBrandYoutube key={i} size={15} className="text-gray-400" />;
        return <span key={i} className="text-[10px] text-gray-400">{p}</span>;
      })}
    </span>
  );
}

// Persist a single field edit to Supabase (whitelisted update API), then refresh.
//
// Returns the failure too, never a bare boolean: a completeness gate answers
// 422 { missing } and the caller has to be able to show it. This used to swallow
// the body, so setting a row to "Content - Approved" without a brief just snapped
// the dropdown back with no explanation at all.
type PendingApproval = { from: string | null; to: string | null };
type SaveResult = { ok: true; pendingApproval?: PendingApproval } | { ok: false; status: number; body: unknown; error: string };

async function saveField(id: string, fields: Record<string, unknown>, opts?: { reason?: string; source?: "calendar" }): Promise<SaveResult> {
  try {
    const res = await fetch("/api/marketing-hub/update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, fields, ...(opts?.reason !== undefined ? { reason: opts.reason } : {}), ...(opts?.source ? { source: opts.source } : {}) }),
    });
    if (res.ok) {
      const okBody = await res.json().catch(() => ({}));
      // The ownership rule changed what was asked for (or moved the task) — say so.
      const warning = (okBody as { warning?: string }).warning;
      if (warning) alertDialog("Owner", warning);
      return { ok: true, pendingApproval: (okBody as { pendingApproval?: PendingApproval }).pendingApproval };
    }
    const body = await res.json().catch(() => ({}));
    const error = (body as { error?: string }).error || `HTTP ${res.status}`;
    return { ok: false, status: res.status, body, error };
  } catch (e) {
    return { ok: false, status: 0, body: {}, error: e instanceof Error ? e.message : String(e) };
  }
}

// What to show when a save is refused. A completeness gate (422 + missing[]) gets
// the shared itemized popup; anything else gets a plain visible toast — the one
// thing it must never do is disappear without a word.
type SaveFailure = { kind: "gate"; block: GateBlock } | { kind: "error"; message: string };

function failureFrom(r: Extract<SaveResult, { ok: false }>, title: string): SaveFailure {
  const block = gateFromResponse(r.status, r.body, title);
  return block ? { kind: "gate", block } : { kind: "error", message: r.error };
}

function SaveFailureOverlay({ failure, onClose }: { failure: SaveFailure | null; onClose: () => void }) {
  if (!failure) return null;
  if (failure.kind === "gate") return <MissingFieldsModal {...failure.block} onClose={onClose} />;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] flex items-center gap-3 bg-white border border-red-200 rounded-xl shadow-lg px-4 py-3 max-w-md">
      <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
      <span className="text-[13px] text-[#232D42]">Couldn&apos;t save — {failure.message}</span>
      <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none ml-1">×</button>
    </div>
  );
}

// Click-to-edit cell — shows `display`; clicking swaps in `editControl`. All
// clicks stopPropagation so editing never fires the row's open-modal handler.
function EditableCell({ display, editControl }: { display: React.ReactNode; editControl: (done: () => void) => React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <span onClick={(e) => e.stopPropagation()}>{editControl(() => setEditing(false))}</span>;
  }
  return (
    <span
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className="cursor-pointer rounded px-1 -mx-1 hover:bg-gray-100 hover:ring-1 hover:ring-gray-200 inline-flex items-center"
      title="Click to edit"
    >
      {display}
    </span>
  );
}

const EDIT_SELECT_CLS = "border border-gray-300 rounded px-1.5 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-brand/30";

// MASTER SHEET sub-tab — the single source of truth: every creative, every SBU,
// mirrored from Airtable. Status · Owner · Priority · Date edit inline; click a
// row (title/type/etc.) to open the full task.
// Views layer over the Master sheet — an Airtable-style left rail of views. Defaults
// (All + per-teammate + by status + by content type) sit alongside "My views": shared,
// user-saved filter sets persisted in mh_views (Supabase). A 7/30/90d/1y period switcher
// drives the fetch range. The table + inline editing come from MasterSheet (bare).
type MasterDraft = { owner: string; status: string; type: string; sbu: string; priority: string };
type MasterViewDef = { id: string; label: string; av?: string; color?: string; match?: (r: Row) => boolean; filter?: FilterModel };
type ViewAccess = "personal" | "collaborative" | "locked";
type SavedView = { id: string; name: string; section: string; config: { filter?: FilterModel; filters?: Partial<MasterDraft>; sorts?: SortSpec[]; hiddenCols?: string[]; color?: string; group?: string; search?: string; rangeDays?: number }; position: number; access: ViewAccess; description: string | null; created_by: string | null; canEdit: boolean; canManage: boolean };
const ACCESS_META: Record<ViewAccess, { label: string; hint: string; icon: typeof IconBookmark }> = {
  personal: { label: "Personal view", hint: "Only you can edit the view configuration", icon: IconUser },
  collaborative: { label: "Collaborative view", hint: "Any teammate can edit the view configuration", icon: IconUsers },
  locked: { label: "Locked view", hint: "Nobody can edit the view configuration", icon: IconLock },
};

// CSV of the given rows for a view's Download CSV action.
function viewRowsToCsv(rows: Row[]): string {
  const cols: [string, (r: Row) => string | undefined][] = [
    ["Particulars", (r) => r.particulars], ["SBU", (r) => r.sbu], ["Type", (r) => r.type],
    ["Status", (r) => r.status], ["Owner", (r) => r.owner], ["Priority", (r) => r.priority],
    ["Publishing Date", (r) => r.publishingDate?.slice(0, 10)], ["Due Date", (r) => r.dueDate?.slice(0, 10)],
  ];
  const esc = (s?: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  return [cols.map((c) => esc(c[0])).join(","), ...rows.map((r) => cols.map((c) => esc(c[1](r))).join(","))].join("\n");
}
function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Airtable-style filter engine ────────────────────────────────────────────
// A view's filter is a set of conditions (Field → Operator → Value) joined by
// AND/OR. Operators adapt to the field's type. Pure + data-driven so the same
// model powers the builder UI, row filtering, and saved-view config.
// The choices for a select/owner field here: the hub's live facets when it has
// them, the canonical lists otherwise. Used to live inside the builder, which is
// why the builder knew about tasks at all.
function hubOptionsFor(fields: FilterFieldDef<Row>[], facets?: Facets) {
  return (fieldKey: string): { value: string; label: string }[] => {
    const def = fields.find((f) => f.key === fieldKey);
    if (!def) return [];
    if (def.type === "owner") return TEAM.map((m) => ({ value: m.key, label: m.label }));
    if (def.options && def.options.length) return def.options.map((o) => ({ value: o, label: o }));
    if (def.type === "select") {
      const src = fieldKey === "status" ? (facets?.status || PIPELINE_STAGES.map((s) => s.key))
        : fieldKey === "type" ? (facets?.type || [])
        : fieldKey === "sbu" ? (facets?.sbu || [])
        : fieldKey === "priority" ? (facets?.priority || ["Urgent", "High", "Medium", "Low"]) : [];
      return src.map((o) => ({ value: o, label: o }));
    }
    return [];
  };
}
const FILTER_FIELDS: FilterFieldDef<Row>[] = [
  { key: "particulars", label: "Task name", type: "text", get: (r) => r.particulars || "" },
  { key: "status", label: "Status", type: "select", get: (r) => r.status || "" },
  { key: "type", label: "Type", type: "select", get: (r) => r.type || "" },
  { key: "sbu", label: "SBU / interest", type: "select", get: (r) => r.sbu || "" },
  { key: "createdBy", label: "Created by", type: "owner", get: (r) => r.createdBy || "" },
  { key: "owner", label: "Owner", type: "owner", get: (r) => r.owner || "" },
  // Owner OR collaborator — what "<person>'s work" means (Nandu, 15 Oct).
  { key: "involved", label: "Owner or collaborator", type: "owner", get: (r) => [r.owner, ...(r.collaborators || [])].filter(Boolean).join("|") },
  { key: "priority", label: "Priority", type: "select", get: (r) => r.priority || "" },
  { key: "publishingDate", label: "Publishing date", type: "date", get: (r) => (r.publishingDate || "").slice(0, 10) },
  { key: "dueDate", label: "Due date", type: "date", get: (r) => (r.dueDate || "").slice(0, 10) },
  { key: "caption", label: "Caption", type: "text", get: (r) => r.caption || "" },
  { key: "needsReview", label: "Needs review", type: "checkbox", get: (r) => !!r.needsReview },
];
// The Row-shaped wrappers. The engine and the operator table live in
// lib/filter-model.ts so Sales Ops uses the same ones.
// "|" joins several people (the "involved" field); a match on any of them counts.
export const ownerMatchesKey = (owner: string, key: string) => { const m = TEAM.find((t) => t.key === key); return m ? owner.split("|").some((o) => ownerMatches(o, m)) : false; };
const ownerLabel = (key: string) => TEAM.find((m) => m.key === key)?.label || key;
function evalFilter(r: Row, f: FilterModel, fields: FilterFieldDef<Row>[] = FILTER_FIELDS): boolean {
  return evalFilterShared(r, f, fields, ownerMatchesKey);
}
function summarizeFilter(f: FilterModel, fields: FilterFieldDef<Row>[] = FILTER_FIELDS): string[] {
  return summarizeFilterShared(f, fields, ownerLabel);
}
// Back-compat: convert the old simple {owner,status,type,sbu,priority} to a FilterModel.
function legacyToFilter(f?: Partial<MasterDraft>): FilterModel {
  if (!f) return EMPTY_FILTER;
  const conds: FilterCondition[] = [];
  (["owner", "status", "type", "sbu", "priority"] as const).forEach((k) => { if (f[k]) conds.push({ field: k, op: "is", value: f[k] }); });
  return { conjunction: "and", conditions: conds };
}
// ── Sort (multi-field) ──────────────────────────────────────────────────────
type SortSpec = { field: string; dir: "asc" | "desc" };
function sortRows(rows: Row[], sorts: SortSpec[], fields: FilterFieldDef<Row>[] = FILTER_FIELDS): Row[] {
  if (!sorts.length) return rows;
  const idx = rows.map((r, i) => [r, i] as const);
  idx.sort(([a, ai], [b, bi]) => {
    for (const s of sorts) {
      const def = fields.find((f) => f.key === s.field);
      if (!def) continue;
      const av = def.get(a), bv = def.get(b);
      let cmp: number;
      if (typeof av === "boolean" || typeof bv === "boolean") cmp = (av === true ? 1 : 0) - (bv === true ? 1 : 0);
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      if (cmp !== 0) return s.dir === "desc" ? -cmp : cmp;
    }
    return ai - bi;
  });
  return idx.map(([r]) => r);
}

// ── Grid columns (order + labels; render lives in MasterSheet) ──────────────
const MASTER_COLUMNS: { key: string; label: string }[] = [
  { key: "particulars", label: "Task name" },
  { key: "sbu", label: "SBU / interest" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "owner", label: "Owner" },
  { key: "createdBy", label: "Created by" },
  { key: "priority", label: "Priority" },
  { key: "publishingDate", label: "Publishing" },
  { key: "dueDate", label: "Due date" },
  { key: "platforms", label: "Platforms" },
  { key: "attachments", label: "Files" },
  { key: "caption", label: "Caption" },
  { key: "needsReview", label: "Needs review" },
];
// Fields you can colour rows by (each has a colour map).
const COLOR_FIELDS: { key: string; label: string }[] = [
  { key: "status", label: "Status" }, { key: "sbu", label: "SBU / interest" }, { key: "priority", label: "Priority" },
];
// Fields you can group rows by (Airtable-style collapsible groups).
const GROUP_FIELDS: { key: string; label: string }[] = [
  { key: "sbu", label: "SBU / interest" }, { key: "type", label: "Type" }, { key: "status", label: "Status" },
  { key: "owner", label: "Owner" }, { key: "priority", label: "Priority" }, { key: "publishingDate", label: "Publishing date" },
];

// ── Custom columns (Phase 2) — user-defined fields stored in mh_posts.custom ─
type CustomColType = "text" | "number" | "select" | "date" | "checkbox";
type CustomColumn = { id: string; key: string; label: string; type: CustomColType; options: string[]; canDelete?: boolean };
const customFieldType = (t: CustomColType): FieldType => (t === "select" ? "select" : t === "date" ? "date" : t === "checkbox" ? "checkbox" : "text");
function customFieldDefs(cols: CustomColumn[]): FilterFieldDef<Row>[] {
  return cols.map((c) => ({
    key: c.key, label: c.label, type: customFieldType(c.type), custom: true, options: c.options,
    get: (r: Row) => { const v = (r.custom || {})[c.key]; return c.type === "checkbox" ? !!v : String(v ?? ""); },
  }));
}
const customVal = (r: Row, key: string) => (r.custom || {})[key];

// Per-view ⋯ menu (mirrors Airtable): access level, reassign, rename, description,
// duplicate, copy-another-view's-config, download CSV, print, delete. Edit actions
// disable when the API says the current user can't edit/manage this view.
const DEFAULT_SECTION = "My views";          // where views without a section live
const RAIL_FOLD_KEY = "mh-rail-folded";      // which rail sections are folded (per browser)

// Airtable's small "new view" pop-over: name, who can edit, which section.
function GridViewPop({ defaultName, sections, defaultSection, onClose, onCreate }: {
  defaultName: string; sections: string[]; defaultSection: string; onClose: () => void;
  onCreate: (d: { name: string; access: ViewAccess; section: string }) => Promise<void>;
}) {
  const [name, setName] = useState(defaultName);
  const [access, setAccess] = useState<ViewAccess>("personal");
  const [section, setSection] = useState(defaultSection);
  const [busy, setBusy] = useState(false);
  const go = async () => { if (!name.trim() || busy) return; setBusy(true); await onCreate({ name: name.trim(), access, section }); setBusy(false); };
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-full top-1 ml-2 z-50 w-[300px] bg-white border border-gray-200 rounded-xl shadow-lg p-4">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => { if (e.key === "Enter") go(); if (e.key === "Escape") onClose(); }}
          className="w-full border border-brand rounded-lg px-3 py-2 text-[14px] outline-none" />
        <div className="text-[13px] font-medium text-[#232D42] mt-3 mb-1.5">Who can edit</div>
        <div className="flex items-center gap-3 flex-wrap">
          {(["collaborative", "personal", "locked"] as ViewAccess[]).map((a) => (
            <label key={a} className="flex items-center gap-1.5 text-[13px] text-gray-700 cursor-pointer">
              <input type="radio" checked={access === a} onChange={() => setAccess(a)} className="accent-[#3A57E8]" />
              {ACCESS_META[a].label.replace(" view", "")}
            </label>
          ))}
        </div>
        <div className="text-[11.5px] text-[#8A92A6] mt-1">{ACCESS_META[access].hint}</div>
        <div className="text-[13px] font-medium text-[#232D42] mt-3 mb-1.5">Put it in</div>
        <select value={section} onChange={(e) => setSection(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px] bg-white outline-none focus:border-brand">
          {sections.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-[13px] font-medium text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={go} disabled={!name.trim() || busy} className="text-[13px] font-medium bg-brand text-white px-3.5 py-1.5 rounded-lg hover:bg-brand-dark disabled:opacity-50">{busy ? "Creating…" : "Create new view"}</button>
        </div>
      </div>
    </>
  );
}

// ⋯ on a section of your own: rename or delete it (its views move, never deleted).
function SectionMenu({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex-shrink-0">
      <button onClick={() => setOpen((o) => !o)} title="Section options" className={`${open ? "flex" : "hidden group-hover:flex"} text-gray-400 hover:text-gray-700`}><IconDots size={14} /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-5 z-50 w-44 bg-white border border-gray-200 rounded-xl shadow-lg py-1">
            <button onClick={() => { setOpen(false); onRename(); }} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50"><IconPencil size={14} stroke={1.7} />Rename section</button>
            <button onClick={() => { setOpen(false); onDelete(); }} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-rose-600 hover:bg-rose-50"><IconTrash size={14} stroke={1.7} />Delete section</button>
          </div>
        </>
      )}
    </div>
  );
}

function ViewMenu({ view, otherViews, onAction, sections }: {
  view: SavedView; otherViews: SavedView[]; onAction: (action: string, payload?: string) => void;
  sections?: string[];   // Master sheet only — offers "Move to section"
}) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<null | "copy" | "reassign" | "move">(null);
  const close = () => { setOpen(false); setSub(null); };
  const act = (a: string, p?: string) => { close(); onAction(a, p); };
  const { canEdit, canManage } = view;

  const item = (key: string, Ic: typeof IconPencil, label: string, onClick: () => void, opts: { disabled?: boolean; danger?: boolean } = {}) => (
    <button key={key} disabled={opts.disabled} onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[14px] text-left ${opts.disabled ? "text-gray-300 cursor-not-allowed" : opts.danger ? "text-rose-600 hover:bg-rose-50" : "text-gray-700 hover:bg-gray-50"}`}>
      <Ic size={15} stroke={1.7} className="flex-shrink-0" />{label}
    </button>
  );

  return (
    <div className="relative flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      <button onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} title="View options"
        className={`${open ? "flex" : "hidden group-hover:flex"} text-gray-400 hover:text-gray-700`}><IconDots size={15} /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className="absolute right-0 top-6 z-50 w-64 bg-white border border-gray-200 rounded-xl shadow-lg py-1">
            <div className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Access</div>
            {(["personal", "collaborative", "locked"] as ViewAccess[]).map((a) => {
              const M = ACCESS_META[a]; const Ic = M.icon; const cur = view.access === a;
              return (
                <button key={a} disabled={!canManage} onClick={() => act("access", a)}
                  className={`w-full flex items-start gap-2.5 px-3 py-1.5 text-left ${!canManage ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-50"}`}>
                  <Ic size={15} stroke={1.7} className="flex-shrink-0 mt-0.5 text-gray-600" />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5 text-[14px] text-gray-800">{M.label}{cur && <IconCheck size={13} className="text-brand" />}</span>
                    <span className="block text-[11px] text-gray-400 leading-tight">{M.hint}</span>
                  </span>
                </button>
              );
            })}
            <div className="my-1 border-t border-gray-100" />
            {item("reassign", IconUserShare, "Reassign to someone else", () => setSub(sub === "reassign" ? null : "reassign"), { disabled: !canManage })}
            {sub === "reassign" && (
              <div className="pl-8 pr-2 pb-1">
                {TEAM.map((m) => <button key={m.key} onClick={() => act("reassign", m.key)} className="w-full text-left px-2 py-1 text-[12px] rounded hover:bg-gray-50">{m.label}</button>)}
              </div>
            )}
            {sections && sections.length > 1 && item("move", IconLayoutList, "Move to section", () => setSub(sub === "move" ? null : "move"))}
            {sub === "move" && sections && (
              <div className="pl-8 pr-2 pb-1">
                {sections.map((n) => (
                  <button key={n} disabled={n === view.section} onClick={() => act("move", n)}
                    className="w-full text-left px-2 py-1 text-[12px] rounded hover:bg-gray-50 disabled:text-gray-300 truncate">{n}{n === view.section ? " · here" : ""}</button>
                ))}
              </div>
            )}
            {item("rename", IconPencil, "Rename view", () => act("rename"), { disabled: !canEdit })}
            {item("description", IconFileDescription, "Edit view description", () => act("description"), { disabled: !canEdit })}
            <div className="my-1 border-t border-gray-100" />
            {item("duplicate", IconCopy, "Duplicate view", () => act("duplicate"))}
            {item("copy", IconClipboardCopy, "Copy another view's configuration", () => setSub(sub === "copy" ? null : "copy"), { disabled: !canEdit || otherViews.length === 0 })}
            {sub === "copy" && (
              <div className="pl-8 pr-2 pb-1 max-h-40 overflow-auto">
                {otherViews.map((v) => <button key={v.id} onClick={() => act("copyConfig", v.id)} className="w-full text-left px-2 py-1 text-[12px] rounded hover:bg-gray-50 truncate">{v.name}</button>)}
              </div>
            )}
            <div className="my-1 border-t border-gray-100" />
            {item("csv", IconDownload, "Download CSV", () => act("csv"))}
            {item("print", IconPrinter, "Print view", () => act("print"))}
            <div className="my-1 border-t border-gray-100" />
            {item("delete", IconTrash, "Delete view", () => act("delete"), { danger: true, disabled: !canManage })}
          </div>
        </>
      )}
    </div>
  );
}

// Multi-select checklist (for "is any of" / "is none of") — compact dropdown.
// Portals a dropdown to <body> with fixed positioning under an anchor, so it can
// never be clipped by a scrollable/overflow-hidden ancestor (e.g. the DetailModal
// scroll body). Re-wraps in .preview-scope so brand tokens still apply outside the
// modal tree, and re-anchors on scroll/resize so it stays glued to its trigger.
function PortalMenu({ open, onClose, anchorRef, align = "left", children }: {
  open: boolean; onClose: () => void; anchorRef: React.RefObject<HTMLElement | null>; align?: "left" | "right"; children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  useEffect(() => {
    if (!open) { setPos(null); return; }
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos(align === "right" ? { top: r.bottom + 4, right: window.innerWidth - r.right } : { top: r.bottom + 4, left: r.left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, anchorRef, align]);
  if (!open || typeof document === "undefined" || !pos) return null;
  return createPortal(
    <div className="preview-scope">
      <div className="fixed inset-0 z-[64]" onClick={onClose} />
      <div className="fixed z-[65]" style={{ top: pos.top, left: pos.left, right: pos.right }}>{children}</div>
    </div>,
    document.body,
  );
}

// Toolbar button + popover wrapper (Filter / Sort / Columns / Colour).
function ToolButton({ icon: Ic, label, active, open, onToggle, children }: {
  icon: typeof IconFilter; label: string; active: boolean; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button onClick={onToggle} className={`flex items-center gap-1.5 text-[12px] font-medium rounded-lg border px-3 py-1.5 ${active ? "border-brand/40 bg-brand-light/50 text-brand" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}>
        <Ic size={14} />{label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onToggle} />
          <div className="absolute left-0 top-[calc(100%+6px)] z-50">{children}</div>
        </>
      )}
    </div>
  );
}

// Multi-field sort builder.
function SortBuilder({ sorts, fields, onChange }: { sorts: SortSpec[]; fields: FilterFieldDef<Row>[]; onChange: (s: SortSpec[]) => void }) {
  const update = (i: number, patch: Partial<SortSpec>) => onChange(sorts.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-[380px] max-w-[92vw]">
      {sorts.length === 0 && <div className="text-[12px] text-gray-400 px-1 pb-2">No sort — default order.</div>}
      <div className="space-y-2">
        {sorts.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400 w-8">{i === 0 ? "Sort" : "then"}</span>
            <div className="flex-1 min-w-0"><PreviewSelect value={s.field} onChange={(v) => update(i, { field: v })} options={fields.map((f) => ({ value: f.key, label: f.label }))} /></div>
            <div className="w-[132px] flex-shrink-0"><PreviewSelect value={s.dir} onChange={(v) => update(i, { dir: v as "asc" | "desc" })} options={[{ value: "asc", label: "First → last" }, { value: "desc", label: "Last → first" }]} /></div>
            <button onClick={() => onChange(sorts.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-rose-500 flex-shrink-0"><IconTrash size={14} /></button>
          </div>
        ))}
      </div>
      <button onClick={() => onChange([...sorts, { field: "publishingDate", dir: "asc" }])} className="mt-2.5 flex items-center gap-1.5 text-[12px] font-medium text-brand"><IconPlus size={14} />Add sort</button>
    </div>
  );
}

// Show/hide columns + add / delete custom columns.
function ColumnsMenu({ columns, hidden, onChange, onAddColumn, onDeleteColumn }: { columns: { key: string; label: string; custom?: boolean; id?: string; canDelete?: boolean }[]; hidden: string[]; onChange: (h: string[]) => void; onAddColumn: () => void; onDeleteColumn: (id: string, label: string) => void }) {
  const toggle = (k: string) => onChange(hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k]);
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-1.5 w-[250px] max-h-80 overflow-auto">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Columns</div>
      {columns.map((c) => {
        const show = !hidden.includes(c.key);
        return (
          <div key={c.key} className="group w-full flex items-center gap-2.5 px-2 py-1.5 text-[14px] rounded hover:bg-gray-50">
            <button onClick={() => toggle(c.key)} disabled={c.key === "particulars"} className="flex items-center gap-2.5 flex-1 min-w-0 text-left disabled:opacity-50">
              <span className={`relative w-8 h-4 rounded-full flex-shrink-0 transition ${show ? "bg-brand" : "bg-gray-200"}`}><span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${show ? "left-[18px]" : "left-0.5"}`} /></span>
              <span className="text-gray-700 flex-1 truncate">{c.label}</span>
            </button>
            {c.custom && <span className="text-[9px] text-brand bg-brand-light/60 rounded px-1 flex-shrink-0">custom</span>}
            {c.custom && c.id && c.canDelete && <button onClick={() => onDeleteColumn(c.id!, c.label)} title="Delete column" className="hidden group-hover:flex text-gray-400 hover:text-rose-500 flex-shrink-0"><IconTrash size={13} /></button>}
          </div>
        );
      })}
      <div className="border-t border-gray-100 my-1" />
      <button onClick={onAddColumn} className="w-full flex items-center gap-2 px-2 py-1.5 text-[14px] rounded hover:bg-gray-50 text-left font-medium text-brand"><IconPlus size={14} />Add column</button>
    </div>
  );
}

// Colour rows by a select field.
function ColorMenu({ colorField, onChange }: { colorField: string; onChange: (f: string) => void }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-1.5 w-[210px]">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Colour rows by</div>
      <button onClick={() => onChange("")} className="w-full flex items-center gap-2 px-2 py-1.5 text-[14px] rounded hover:bg-gray-50 text-left text-gray-700">
        <span className="w-3.5 h-3.5 rounded border border-gray-300 flex-shrink-0" />None{colorField === "" && <IconCheck size={13} className="text-brand ml-auto" />}
      </button>
      {COLOR_FIELDS.map((f) => (
        <button key={f.key} onClick={() => onChange(f.key)} className="w-full flex items-center gap-2 px-2 py-1.5 text-[14px] rounded hover:bg-gray-50 text-left text-gray-700">
          <span className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ background: "linear-gradient(90deg,#3A57E8,#0F9E75)" }} />{f.label}{colorField === f.key && <IconCheck size={13} className="text-brand ml-auto" />}
        </button>
      ))}
    </div>
  );
}

// Group rows by a field — Airtable-style collapsible groups.
function GroupMenu({ groupField, onChange }: { groupField: string; onChange: (f: string) => void }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-1.5 w-[210px]">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Group rows by</div>
      <button onClick={() => onChange("")} className="w-full flex items-center gap-2 px-2 py-1.5 text-[14px] rounded hover:bg-gray-50 text-left text-gray-700">
        None{groupField === "" && <IconCheck size={13} className="text-brand ml-auto" />}
      </button>
      {GROUP_FIELDS.map((f) => (
        <button key={f.key} onClick={() => onChange(f.key)} className="w-full flex items-center gap-2 px-2 py-1.5 text-[14px] rounded hover:bg-gray-50 text-left text-gray-700">
          {f.label}{groupField === f.key && <IconCheck size={13} className="text-brand ml-auto" />}
        </button>
      ))}
    </div>
  );
}

// Define a new custom column (name + type + options).
function AddColumnModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomColType>("text");
  const [optionsText, setOptionsText] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const create = async () => {
    if (!label.trim()) return;
    setSaving(true);
    try {
      const options = type === "select" ? optionsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) : [];
      const res = await fetch("/api/marketing-hub/columns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: label.trim(), type, options }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alertDialog(j.error || "Could not add column."); return; }
      onCreated();
    } finally { setSaving(false); }
  };
  const TYPE_META: { t: CustomColType; label: string }[] = [{ t: "text", label: "Text" }, { t: "number", label: "Number" }, { t: "select", label: "Select" }, { t: "date", label: "Date" }, { t: "checkbox", label: "Checkbox" }];
  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-6 preview-scope" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2"><IconPlus size={18} className="text-brand" /><h2 className="text-[16px] font-semibold text-[#232D42]">Add column</h2></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[#232D42] mb-1.5">Column name</label>
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Campaign, Est. hours, Reviewed by"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#232D42] mb-1.5">Type</label>
            <div className="grid grid-cols-5 gap-1.5">
              {TYPE_META.map((tm) => (
                <button key={tm.t} onClick={() => setType(tm.t)} className={`rounded-lg border px-1 py-2 text-[11px] font-medium transition ${type === tm.t ? "border-brand bg-brand-light/50 text-brand" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}>{tm.label}</button>
              ))}
            </div>
          </div>
          {type === "select" && (
            <div>
              <label className="block text-[12px] font-medium text-[#232D42] mb-1.5">Options <span className="text-gray-400 font-normal">(one per line or comma-separated)</span></label>
              <textarea value={optionsText} onChange={(e) => setOptionsText(e.target.value)} rows={3} placeholder={"Option A\nOption B"} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none outline-none focus:border-brand" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="text-[13px] font-medium text-gray-600 hover:text-gray-900 px-3 py-2">Cancel</button>
          <button onClick={create} disabled={saving || !label.trim()} className="bg-brand text-white text-[13px] font-medium rounded-lg px-4 py-2 hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed">{saving ? "Adding…" : "Add column"}</button>
        </div>
      </div>
    </div>
  );
}

export function MasterTab({ allRows, facets, range, setRange, onOpen, onSaved, loading, highlightId }: {
  allRows: Row[]; facets?: Facets; range: { from: string; to: string }; setRange: (r: { from: string; to: string }) => void;
  onOpen: (id: string) => void; onSaved: () => void; loading: boolean; highlightId?: string | null;
}) {
  // Arriving from a notification: ?owner=nandu&status=Content%20-%20Approved opens the
  // sheet showing that person's tasks at that status and nothing else.
  //
  // It has to be the Master sheet's own draft rather than the filters further up —
  // those feed Workload, Pipeline and Calendar, and setting them here changed nothing
  // at all. The value is a team KEY, not a name, because evalFilter matches owners
  // through their aliases: "nandu" finds "Nandu C", "Nandu" finds nothing.
  const deepLink = useMemo(() => {
    if (typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search);
    const owner = q.get("owner") || "";
    const status = q.get("status") || "";
    return owner || status ? legacyToFilter({ owner, status }) : null;
  }, []);
  // Not one of the saved views, so matchFn falls through to the draft.
  const [activeId, setActiveId] = useState(deepLink ? "link" : "all");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<FilterModel>(deepLink || EMPTY_FILTER);
  const [sorts, setSorts] = useState<SortSpec[]>([]);
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);
  const [colorField, setColorField] = useState<string>("");
  const [groupField, setGroupField] = useState<string>("");

  // The sheet remembers how you left it. "After adding a filter, when going to the
  // content calendar or anywhere and coming back, the filter is not there. In
  // Airtable, if I add a filter to any view, it will stay until I change it."
  // (Nandu, 6 Oct.) The hub mounts one tab at a time, so switching tabs threw all
  // of this away and you came back to the unfiltered sheet.
  //
  // The whole view goes, not just the filter — sort, hidden columns, colour and
  // grouping are the same act of arranging the sheet, and keeping only some of it
  // would be stranger than keeping none. Search is deliberately left out: a search
  // box that quietly still holds last week's words looks like missing data.
  //
  // Per browser, not per account: this is where you left the furniture, not team
  // data. Saved views remain the shared, named thing.
  //
  // Read in an effect rather than in the initialisers so the server and the first
  // client render agree, and the write is held until that read has happened, or the
  // empty starting state would overwrite what was saved before it is restored.
  //
  // "Restored" has to be state, not a ref. Both effects below run in the same
  // commit, so the saving one closes over the values from BEFORE the restore; with
  // a ref it would see the flag already flipped and write the empty default
  // straight over what was just read. As state it instead re-runs once the
  // restored values have actually rendered.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    // A notification link is an explicit instruction about what to show, so it
    // beats whatever was left behind.
    if (!deepLink) {
      try {
        const v = JSON.parse(localStorage.getItem(MASTER_VIEW_KEY) || "null");
        if (v && typeof v === "object") {
          if (typeof v.activeId === "string") setActiveId(v.activeId);
          if (v.draft && Array.isArray(v.draft.conditions)) setDraft(v.draft as FilterModel);
          if (Array.isArray(v.sorts)) setSorts(v.sorts as SortSpec[]);
          if (Array.isArray(v.hiddenCols)) setHiddenCols(v.hiddenCols as string[]);
          if (typeof v.color === "string") setColorField(v.color);
          if (typeof v.group === "string") setGroupField(v.group);
        }
      } catch { /* private mode, or a shape from an older build — open unfiltered */ }
    }
    setRestored(true);
  }, [deepLink]);
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(MASTER_VIEW_KEY, JSON.stringify({
        // "link" only means something while those query params are in the URL; the
        // filter it produced is kept as an ordinary ad-hoc one.
        activeId: activeId === "link" ? "draft" : activeId,
        draft, sorts, hiddenCols, color: colorField, group: groupField,
      }));
    } catch { /* private mode */ }
  }, [restored, activeId, draft, sorts, hiddenCols, colorField, groupField]);

  const [openTool, setOpenTool] = useState<null | "filter" | "sort" | "cols" | "color" | "group">(null);
  const [newViewOpen, setNewViewOpen] = useState(false);
  const [createMenu, setCreateMenu] = useState(false);   // "Create new…" menu
  const [gridPop, setGridPop] = useState(false);         // the new Grid view pop-over
  const [findQ, setFindQ] = useState("");                // "Find a view"
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  useEffect(() => { try { setFolded(JSON.parse(localStorage.getItem(RAIL_FOLD_KEY) || "{}") || {}); } catch { /* private mode */ } }, []);
  const toggleFold = (t: string) => setFolded((f) => { const n = { ...f, [t]: !f[t] }; try { localStorage.setItem(RAIL_FOLD_KEY, JSON.stringify(n)); } catch { /* private mode */ } return n; });
  const [addColOpen, setAddColOpen] = useState(false);
  // Delete → recycle bin. Only people with the delete_tasks capability see the
  // checkboxes or the bin; the API enforces the same gate.
  const { data: meData } = useApi<{ user?: { isAdmin?: boolean; permissions?: Record<string, boolean> } }>("/api/me");
  const canDelete = hasCapability(meData?.user as never, "delete_tasks");
  const { data: binData, refresh: refreshBin } = useApi<{ items: TrashItem[]; notReady?: boolean; error?: string }>(canDelete ? "/api/marketing-hub/trash" : null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmDel, setConfirmDel] = useState(false);
  const onPick = (ids: string[], on: boolean) => setPicked((prev) => { const n = new Set(prev); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  const { data: viewsData, refresh: refreshViews } = useApi<{ views: SavedView[]; me: string | null }>("/api/marketing-hub/views");
  // Calendar views live in the same table; they belong to the Content calendar's rail.
  // Sections (Airtable's folders) are rows too, with config.kind = "section" (26 Oct).
  const kindOf = (v: SavedView) => (v.config as { kind?: string }).kind;
  const custom = (viewsData?.views || []).filter((v) => !kindOf(v));
  const sectionRows = (viewsData?.views || []).filter((v) => kindOf(v) === "section");
  const sectionNames = [DEFAULT_SECTION, ...sectionRows.map((r) => r.name).filter((n) => n !== DEFAULT_SECTION)];
  const meKey = viewsData?.me || "";
  const meName = TEAM.find((m) => m.key === meKey)?.label || "My";
  const { data: colsData, refresh: refreshCols } = useApi<{ columns: CustomColumn[] }>("/api/marketing-hub/columns");
  const customCols = useMemo(() => colsData?.columns || [], [colsData]);
  const fields = useMemo(() => [...FILTER_FIELDS, ...customFieldDefs(customCols)], [customCols]);
  const columns = useMemo(() => [...MASTER_COLUMNS.map((c) => ({ key: c.key, label: c.label, custom: false })), ...customCols.map((c) => ({ key: c.key, label: c.label, custom: true, id: c.id, canDelete: c.canDelete }))], [customCols]);

  const daysRange = (n: number) => ({ from: ymd(new Date(Date.now() - (n - 1) * 86_400_000)), to: ymd(new Date()) });
  const activeDays = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;

  const oneCond = (field: string, value: string): FilterModel => ({ conjunction: "and", conditions: [{ field, op: "is", value }] });
  const allView: MasterViewDef = { id: "all", label: "Master sheet", color: "#3A57E8", filter: EMPTY_FILTER };
  // A task stays in "<person>'s work" after it's handed on: approval moves design work
  // to Praveen (a database rule), and the writer is kept as a collaborator — but this
  // view used to match the owner only, so approved work vanished from it.
  const teamViews: MasterViewDef[] = TEAM.map((m) => ({ id: `team-${m.key}`, label: `${m.label}'s work`, av: m.av, color: m.color, filter: oneCond("involved", m.key) }));
  const statusViews: MasterViewDef[] = ALL_STATUSES.map((s) => ({ id: `status-${s.key}`, label: s.label, color: s.color, filter: oneCond("status", s.key) }));
  // Every content type actually in the sheet, one row each — not five buckets that
  // lumped a Reel Thumbnail in with a YouTube Long-Form (the team, 28 Sep). Read
  // from the rows rather than a hard-coded list, so a type added in Airtable turns
  // up here on its own and a type nobody uses never clutters the rail.
  const typeViews: MasterViewDef[] = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of allRows) {
      const t = (r.type || "").trim();
      if (t) seen.set(t, (seen.get(t) || 0) + 1);
    }
    return [...seen.keys()].sort((a, b) => a.localeCompare(b)).map((t) => ({
      id: `type-${t}`, label: t, color: typeColour(t),
      match: (r: Row) => (r.type || "").trim() === t,
    }));
  }, [allRows]);
  const everyDef = [allView, ...teamViews, ...statusViews, ...typeViews];
  const curDef = everyDef.find((v) => v.id === activeId);
  const activeCustom = custom.find((c) => c.id === activeId);

  const matchFn = curDef?.match ? curDef.match : (r: Row) => evalFilter(r, draft, fields);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = allRows.filter(matchFn).filter((r) => !q || `${r.particulars} ${r.caption} ${r.sbu} ${r.type} ${r.owner}`.toLowerCase().includes(q));
    return sortRows(filtered, sorts, fields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, activeId, draft, search, sorts, fields]);
  const visibleCols = columns.filter((c) => !hiddenCols.includes(c.key)).map((c) => c.key);
  const pickedRows = rows.filter((r) => picked.has(r.id));
  const currentConfig = { filter: draft, sorts, hiddenCols, color: colorField, group: groupField, rangeDays: activeDays };

  const countOf = (v: MasterViewDef) => allRows.filter(v.match ? v.match : (r) => evalFilter(r, v.filter || EMPTY_FILTER, fields)).length;
  const countCustom = (c: SavedView) => allRows.filter((r) => evalFilter(r, c.config.filter || legacyToFilter(c.config.filters), fields)).length;

  const selectDef = (v: MasterViewDef) => { setActiveId(v.id); setDraft(v.filter || EMPTY_FILTER); setSorts([]); setHiddenCols([]); setColorField(""); setGroupField(""); };
  const selectCustom = (c: SavedView) => {
    setActiveId(c.id);
    setDraft(c.config.filter || legacyToFilter(c.config.filters));
    setSorts(c.config.sorts || []); setHiddenCols(c.config.hiddenCols || []); setColorField(c.config.color || ""); setGroupField(c.config.group || "");
    if (c.config.rangeDays) setRange(daysRange(c.config.rangeDays));
  };
  // The latest saved version of a view wins (Praveen, 28 Oct): reopening the sheet on
  // a saved view used to run this browser's old copy of it, so a teammate's change
  // didn't show and your next edit saved the old copy back over theirs. Once the
  // views have loaded, the remembered view is opened from what's saved. Ad-hoc
  // filters ("draft") and built-in views still come back from this browser.
  const syncedView = useRef(false);
  useEffect(() => {
    if (!restored || !viewsData || syncedView.current) return;
    syncedView.current = true;
    const c = custom.find((v) => v.id === activeId);
    if (c) selectCustom(c);
  }, [restored, viewsData]); // eslint-disable-line react-hooks/exhaustive-deps
  // Like Airtable: changing the filter/sort/colour/group while on a view you can edit
  // changes THAT view (saved a moment later). On a built-in or locked view it becomes
  // an unsaved draft you can "Save as view".
  const activeCustomView = custom.find((c) => c.id === activeId);
  const onEditableView = !!activeCustomView?.canEdit;
  const setFilter = (f: FilterModel) => { setDraft(f); if (!onEditableView) setActiveId("draft"); };
  useEffect(() => {
    if (!activeCustomView?.canEdit) return;
    const c = activeCustomView.config;
    const same = JSON.stringify([c.filter || legacyToFilter(c.filters), c.sorts || [], c.hiddenCols || [], c.color || "", c.group || ""])
      === JSON.stringify([draft, sorts, hiddenCols, colorField, groupField]);
    if (same) return;
    const t = setTimeout(async () => {
      const res = await fetch("/api/marketing-hub/views", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: activeCustomView.id, config: { ...c, filter: draft, sorts, hiddenCols, color: colorField, group: groupField } }) });
      if (res.ok) refreshViews();
    }, 700);
    return () => clearTimeout(t);
  }, [draft, sorts, hiddenCols, colorField, groupField]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasFilter = draft.conditions.length > 0;
  const dirty = hasFilter || sorts.length > 0 || hiddenCols.length > 0 || !!colorField || !!groupField;

  // "New view" / "Save as view" open the branded builder modal (no native prompt).
  const newView = () => setNewViewOpen(true);
  const saveView = () => setNewViewOpen(true);
  const deleteView = async (id: string) => {
    const res = await fetch(`/api/marketing-hub/views?id=${id}`, { method: "DELETE" });
    if (!res.ok) { const j = await res.json().catch(() => ({})); alertDialog(j.error || "Could not delete view."); return; }
    if (activeId === id) { setActiveId("all"); setDraft(EMPTY_FILTER); setSorts([]); setHiddenCols([]); setColorField(""); setGroupField(""); }
    await refreshViews();
  };
  // Create a Grid view the Airtable way: it starts as all tasks; you then filter /
  // sort / group it with the toolbar and that is saved to the view as you go.
  const createGrid = async (d: { name: string; access: ViewAccess; section: string }) => {
    const res = await fetch("/api/marketing-hub/views", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: d.name, access: d.access, section: d.section, config: { filter: EMPTY_FILTER, sorts: [], hiddenCols: [], color: "", group: "", rangeDays: activeDays } }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { alertDialog(j.error || "Could not create the view."); return; }
    setGridPop(false);
    if (folded[d.section]) toggleFold(d.section);
    await refreshViews();
    if (j.view) selectCustom(j.view as SavedView);
  };
  // Sections are shared with the whole team, like Airtable's.
  const newSection = async () => {
    const name = (await promptDialog({ title: "New section", defaultValue: "" }))?.trim();
    if (!name) return;
    if (sectionNames.some((n) => n.toLowerCase() === name.toLowerCase())) { alertDialog(`There's already a section called "${name}".`); return; }
    const res = await fetch("/api/marketing-hub/views", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, section: name, access: "collaborative", config: { kind: "section" } }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); alertDialog(j.error || "Could not create the section."); return; }
    await refreshViews();
  };
  const renameSection = async (row: SavedView) => {
    const name = (await promptDialog({ title: "Rename section", defaultValue: row.name }))?.trim();
    if (!name || name === row.name) return;
    await patchView(row.id, { name, section: name });
    for (const v of custom.filter((c) => c.section === row.name)) await patchView(v.id, { section: name });
  };
  // Deleting a section never deletes views — they move back to the default section.
  const deleteSection = async (row: SavedView) => {
    const inside = custom.filter((c) => c.section === row.name);
    if (!(await confirmDialog({ title: `Delete the section "${row.name}"?`, body: inside.length ? `Its ${inside.length} view${inside.length > 1 ? "s move" : " moves"} to "${DEFAULT_SECTION}". No view is deleted.` : "It's empty.", action: "Delete section", danger: true }))) return;
    for (const v of inside) await patchView(v.id, { section: DEFAULT_SECTION });
    const res = await fetch(`/api/marketing-hub/views?id=${row.id}`, { method: "DELETE" });
    if (!res.ok) { const j = await res.json().catch(() => ({})); alertDialog(j.error || "Could not delete the section."); }
    await refreshViews();
  };
  const deleteColumn = async (id: string, label: string) => {
    if (!await confirmDialog({ title: `Delete the column "${label}"?`, body: "Its values are removed from the sheet for everyone.", action: "Delete column", danger: true })) return;
    const res = await fetch(`/api/marketing-hub/columns?id=${id}`, { method: "DELETE" });
    if (!res.ok) { const j = await res.json().catch(() => ({})); alertDialog(j.error || "Could not delete column."); return; }
    await refreshCols();
  };

  // Per-view menu actions (Airtable's ⋯ menu). Config/name/desc edits and access
  // changes are permission-gated in the API; on 403 we surface the message.
  const patchView = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch("/api/marketing-hub/views", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); alertDialog(j.error || "Could not update view."); return; }
    await refreshViews();
  };
  const rowsForConfig = (cfg: SavedView["config"]) => allRows.filter((r) => evalFilter(r, cfg.filter || legacyToFilter(cfg.filters), fields));
  const doViewAction = async (action: string, v: SavedView, payload?: string) => {
    switch (action) {
      case "access": await patchView(v.id, { access: payload }); break;
      case "rename": { const n = await promptDialog({ title: "Rename view", defaultValue: v.name }); if (n && n.trim()) await patchView(v.id, { name: n.trim() }); break; }
      case "description": { const d = await promptDialog({ title: "View description", defaultValue: v.description || "" }); if (d !== null) await patchView(v.id, { description: d }); break; }
      case "duplicate":
        await fetch("/api/marketing-hub/views", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: `${v.name} copy`, config: v.config, description: v.description, access: "personal" }) });
        await refreshViews();
        break;
      case "copyConfig": { const src = custom.find((c) => c.id === payload); if (src) await patchView(v.id, { config: src.config }); break; }
      case "reassign": await patchView(v.id, { createdBy: payload }); break;
      case "move": if (payload) await patchView(v.id, { section: payload }); break;
      case "csv": downloadText(`${v.name.replace(/[^a-z0-9]+/gi, "-")}.csv`, viewRowsToCsv(rowsForConfig(v.config))); break;
      case "print": selectCustom(v); setTimeout(() => window.print(), 150); break;
      case "delete": if (await confirmDialog({ title: `Delete view "${v.name}"?`, action: "Delete view", danger: true })) await deleteView(v.id); break;
    }
  };

  const RailItem = ({ v }: { v: MasterViewDef }) => {
    const on = v.id === activeId;
    return (
      <button onClick={() => selectDef(v)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition ${on ? "bg-brand-light text-brand font-medium" : "text-gray-700 hover:bg-gray-50"}`}>
        {v.av
          ? <span className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-semibold flex-shrink-0" style={{ background: v.color }}>{v.av}</span>
          : <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: v.color || "#94A3B8" }} />}
        <span className="truncate flex-1 text-left">{v.label}</span>
        <span className={`text-[11px] ${on ? "text-brand/70" : "text-gray-400"}`}>{countOf(v)}</span>
      </button>
    );
  };
  const Section = ({ title, views }: { title: string; views: MasterViewDef[] }) => {
    const vs = views.filter((v) => found(v.label));
    if (findQ && !vs.length) return null;
    return (
      <div className="mb-1">
        <FoldHead title={title} />
        {!isFolded(title) && vs.map((v) => <RailItem key={v.id} v={v} />)}
      </div>
    );
  };
  // Folding sections (remembered per browser) and the Find box.
  const found = (name: string) => !findQ.trim() || name.toLowerCase().includes(findQ.trim().toLowerCase());
  const isFolded = (t: string) => !findQ.trim() && !!folded[t];
  const FoldHead = ({ title, menu }: { title: string; menu?: React.ReactNode }) => (
    <div className="group flex items-center gap-1 px-1 pt-2 pb-1">
      <button onClick={() => toggleFold(title)} className="flex items-center gap-1 flex-1 min-w-0 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-600">
        <IconChevronDown size={12} stroke={2} className={`flex-shrink-0 transition-transform ${isFolded(title) ? "-rotate-90" : ""}`} />
        <span className="truncate">{title}</span>
      </button>
      {menu}
    </div>
  );

  const title = curDef ? curDef.label : activeCustom ? activeCustom.name : "Custom filter";
  const headColor = curDef?.color || "#3A57E8";
  const headAv = curDef?.av;

  return (
    <div className="flex gap-4 items-stretch">
      {/* Views rail */}
      <div className="w-56 flex-shrink-0 bg-white border border-gray-100 rounded-xl p-2 relative">
        {/* Airtable's rail (26 Oct): Create new… (Grid / Section), Find a view, then
            folding sections — the team's own first, the built-in ones after. */}
        <button onClick={() => setCreateMenu((o) => !o)}
          className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-[14px] font-medium text-[#232D42] hover:bg-gray-50">
          <IconPlus size={15} stroke={2} className="text-brand" />Create new…
        </button>
        {createMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setCreateMenu(false)} />
            <div className="absolute left-full top-1 ml-2 z-50 w-48 bg-white border border-gray-200 rounded-xl shadow-lg py-1">
              <button onClick={() => { setCreateMenu(false); setGridPop(true); }} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[14px] text-gray-700 hover:bg-gray-50">
                <IconColumns size={15} stroke={1.7} />Grid
              </button>
              <div className="my-1 border-t border-gray-100" />
              <button onClick={() => { setCreateMenu(false); newSection(); }} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[14px] text-gray-700 hover:bg-gray-50">
                <IconLayoutList size={15} stroke={1.7} />Section
              </button>
            </div>
          </>
        )}
        {gridPop && (
          <GridViewPop defaultName={`${meName}'s Grid`} sections={sectionNames} defaultSection={DEFAULT_SECTION}
            onClose={() => setGridPop(false)} onCreate={createGrid} />
        )}
        <div className="flex items-center gap-1.5 border border-gray-100 rounded-lg px-2 py-1.5 mt-1 mb-1">
          <IconSearch size={14} stroke={1.8} className="text-gray-400 flex-shrink-0" />
          <input value={findQ} onChange={(e) => setFindQ(e.target.value)} placeholder="Find a view"
            className="flex-1 min-w-0 text-[13px] outline-none bg-transparent" />
          {findQ && <button onClick={() => setFindQ("")} className="text-gray-400 hover:text-gray-700"><IconX size={13} /></button>}
        </div>
        {sectionNames.map((sec) => {
          const vs = custom.filter((c) => (sectionNames.includes(c.section) ? c.section : DEFAULT_SECTION) === sec).filter((c) => found(c.name)).reverse();
          const row = sectionRows.find((r) => r.name === sec);
          if (findQ && !vs.length) return null;
          if (!row && !vs.length) return null;   // the default section shows once it has a view
          return (
            <div key={sec} className="mb-1">
              <FoldHead title={sec} menu={row && (
                <SectionMenu onRename={() => renameSection(row)} onDelete={() => deleteSection(row)} />
              )} />
              {!isFolded(sec) && (vs.length ? vs.map((c) => {
                const on = c.id === activeId;
                const AccessIcon = ACCESS_META[c.access].icon;
                return (
                  <div key={c.id} className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] ${on ? "bg-brand-light text-brand font-medium" : "text-gray-700 hover:bg-gray-50"}`}>
                    <button onClick={() => selectCustom(c)} className="flex items-center gap-2 flex-1 min-w-0 text-left" title={c.description || undefined}>
                      <AccessIcon size={13} stroke={1.8} className="flex-shrink-0" />
                      <span className="truncate flex-1">{c.name}</span>
                    </button>
                    <span className={`text-[11px] ${on ? "text-brand/70" : "text-gray-400"} group-hover:hidden`}>{countCustom(c)}</span>
                    <ViewMenu view={c} otherViews={custom.filter((v) => v.id !== c.id)} sections={sectionNames} onAction={(a, p) => doViewAction(a, c, p)} />
                  </div>
                );
              }) : <div className="px-2 py-1 text-[12px] text-gray-400 italic">No views yet</div>)}
            </div>
          );
        })}
        <Section title="Default" views={[allView]} />
        <Section title="Team" views={teamViews} />
        <Section title="By status" views={statusViews} />
        <Section title="By content type" views={typeViews} />
        {canDelete && (
          <div className="mt-1 pt-1 border-t border-gray-100">
            <button onClick={() => setActiveId("trash")}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition ${activeId === "trash" ? "bg-brand-light text-brand font-medium" : "text-gray-700 hover:bg-gray-50"}`}>
              <IconTrash size={14} stroke={1.8} className="flex-shrink-0" />
              <span className="truncate flex-1 text-left">Recycle bin</span>
              <span className={`text-[11px] ${activeId === "trash" ? "text-brand/70" : "text-gray-400"}`}>{binData?.items.length ?? ""}</span>
            </button>
          </div>
        )}
      </div>

      {activeId === "trash" ? (
        <RecycleBin items={binData?.items} notReady={binData?.notReady} error={binData?.error} onChanged={() => { refreshBin(); onSaved(); }} />
      ) : (<>
      {/* Active view — overflow-visible so the toolbar's Filter/Sort/Columns popovers
          aren't clipped when a filter shrinks the table; corner-rounding moves to the
          table wrapper below. */}
      <div className="flex-1 min-w-0 bg-white border border-gray-100 rounded-xl">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100 flex-wrap">
          {headAv
            ? <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[12px] font-semibold flex-shrink-0" style={{ background: headColor }}>{headAv}</span>
            : <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: headColor }} />}
          <div>
            <div className="text-base font-medium">{title}</div>
            <div className="text-[11px] text-gray-500">{fmtInt(rows.length)} tasks · last {activeDays} days + upcoming</div>
          </div>
          <div className="ml-auto inline-flex bg-white border border-gray-200 rounded-lg p-0.5 gap-0.5">
            {([[7, "7d"], [30, "30d"], [90, "90d"], [365, "1y"]] as [number, string][]).map(([n, lab]) => (
              <button key={n} onClick={() => setRange(daysRange(n))}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition ${activeDays === n ? "bg-brand text-white" : "text-gray-600 hover:bg-gray-50"}`}>{lab}</button>
            ))}
          </div>
        </div>

        {/* Search bar — searches the whole Master sheet (task name · interest · type · owner). */}
        <div className="px-5 py-2.5 border-b border-gray-100">
          <div className="relative">
            <IconSearch size={16} stroke={1.8} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the Marketing Hub — task, interest, type, owner…"
              className="w-full border border-gray-200 rounded-lg pl-9 pr-8 py-2 text-sm" />
            {search && <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>}
          </div>
        </div>

        {/* Toolbar — Airtable-style Filter / Sort / Columns / Colour; save the result as a view */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-gray-100 flex-wrap">
          <ToolButton icon={IconFilter} active={hasFilter} label={hasFilter ? `Filtered · ${countConditions(draft)}` : "Filter"} open={openTool === "filter"} onToggle={() => setOpenTool(openTool === "filter" ? null : "filter")}>
            <FilterBuilder<Row> filter={draft} fields={fields} optionsFor={hubOptionsFor(fields, facets)}
              onChange={setFilter} title="In this view, show tasks" emptyNote="No conditions — showing every task. Add one below."
              colorFor={(field, v) => field === "status" ? statusPill(v) : field === "sbu" ? { bg: sbuColor(v, facets?.sbu || []) + "26", text: "#232D42" } : null}
              copyFrom={custom.filter((c) => c.id !== activeId).map((c) => ({ name: c.name, filter: c.config.filter || legacyToFilter(c.config.filters) })).filter((v) => v.filter.conditions.length)} />
          </ToolButton>
          <ToolButton icon={IconArrowsSort} active={sorts.length > 0} label={sorts.length ? `Sorted · ${sorts.length}` : "Sort"} open={openTool === "sort"} onToggle={() => setOpenTool(openTool === "sort" ? null : "sort")}>
            <SortBuilder sorts={sorts} fields={fields} onChange={setSorts} />
          </ToolButton>
          <ToolButton icon={IconColumns} active={hiddenCols.length > 0} label={hiddenCols.length ? `Columns · ${columns.length - hiddenCols.length}` : "Columns"} open={openTool === "cols"} onToggle={() => setOpenTool(openTool === "cols" ? null : "cols")}>
            <ColumnsMenu columns={columns} hidden={hiddenCols} onChange={setHiddenCols} onAddColumn={() => { setOpenTool(null); setAddColOpen(true); }} onDeleteColumn={(id, label) => { setOpenTool(null); deleteColumn(id, label); }} />
          </ToolButton>
          <ToolButton icon={IconPalette} active={!!colorField} label={colorField ? `Colour · ${COLOR_FIELDS.find((f) => f.key === colorField)?.label || colorField}` : "Colour"} open={openTool === "color"} onToggle={() => setOpenTool(openTool === "color" ? null : "color")}>
            <ColorMenu colorField={colorField} onChange={setColorField} />
          </ToolButton>
          <ToolButton icon={IconLayoutList} active={!!groupField} label={groupField ? `Grouped · ${GROUP_FIELDS.find((f) => f.key === groupField)?.label || groupField}` : "Group"} open={openTool === "group"} onToggle={() => setOpenTool(openTool === "group" ? null : "group")}>
            <GroupMenu groupField={groupField} onChange={setGroupField} />
          </ToolButton>
          {dirty && <button onClick={() => selectDef(allView)} className="text-[12px] text-gray-500 hover:text-gray-800 px-1">Clear</button>}
          <button onClick={saveView} disabled={!dirty}
            className="ml-auto flex items-center gap-1.5 text-[12px] font-medium text-brand disabled:text-gray-300 disabled:cursor-not-allowed">
            <IconDeviceFloppy size={14} />Save as view
          </button>
        </div>

        <div className="rounded-b-xl overflow-hidden">
          {pickedRows.length > 0 && (
            <div className="flex items-center gap-3 px-5 py-2 bg-brand-light border-b border-gray-100 text-[14px] text-[#232D42]">
              <span className="font-medium">{pickedRows.length} selected</span>
              <button onClick={() => setPicked(new Set())} className="text-[12px] text-gray-500 hover:text-gray-800">Clear</button>
              <button onClick={() => setConfirmDel(true)}
                className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded text-[14px] font-medium text-white bg-[#C0392B] hover:brightness-110">
                <IconTrash size={16} stroke={1.8} />Delete {pickedRows.length}
              </button>
            </div>
          )}
          <MasterSheet rows={rows} facets={facets} onOpen={onOpen} onSaved={onSaved} loading={loading} bare visibleCols={visibleCols} colorField={colorField} groupField={groupField} customCols={customCols}
            picked={canDelete ? picked : undefined} onPick={canDelete ? onPick : undefined} highlightId={highlightId} />
        </div>
      </div>
      </>)}

      {confirmDel && (
        <ConfirmTrash
          title={`Move ${pickedRows.length} task${pickedRows.length === 1 ? "" : "s"} to the recycle bin?`}
          body="They disappear from the Master sheet, My Day and the calendars for everyone. You can put them back from Recycle bin at any time."
          names={pickedRows.map((r) => r.particulars || "(untitled)")}
          action="Move to recycle bin"
          onCancel={() => setConfirmDel(false)}
          onConfirm={async () => {
            const res = await fetch("/api/marketing-hub/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: pickedRows.map((r) => r.id) }) });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) return j.error || "Delete failed.";
            setPicked(new Set()); refreshBin(); onSaved();
            if (j.failed?.length) return `${j.moved} moved, ${j.failed.length} couldn't be moved: ${j.failed[0].error}`;
            setConfirmDel(false); return null;
          }}
        />
      )}

      {newViewOpen && (
        <NewViewModal
          config={currentConfig} fields={fields} totalCols={columns.length}
          onClose={() => setNewViewOpen(false)}
          onCreated={() => { setNewViewOpen(false); refreshViews(); }}
        />
      )}
      {addColOpen && <AddColumnModal onClose={() => setAddColOpen(false)} onCreated={() => { setAddColOpen(false); refreshCols(); onSaved(); }} />}
    </div>
  );
}

// Row checkbox for the Master sheet / recycle bin. A span, not an <input>, so the
// dashboard's 36px control rule leaves it at 16px.
function PickBox({ on, partial, label }: { on: boolean; partial?: boolean; label: string }) {
  return (
    <span role="checkbox" aria-checked={partial ? "mixed" : on} aria-label={label}
      className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer ${on || partial ? "bg-brand border-brand text-white" : "border-gray-300 bg-white hover:border-gray-400"}`}>
      {on ? <IconCheck size={11} stroke={3} /> : partial ? <span className="w-2 h-0.5 bg-white rounded" /> : null}
    </span>
  );
}

// Confirmation popup for moving to / deleting from the bin. onConfirm returns an
// error message to show, or null when done (the caller closes the popup).
function ConfirmTrash({ title, body, names, action, danger, onCancel, onConfirm }: {
  title: string; body: string; names: string[]; action: string; danger?: boolean;
  onCancel: () => void; onConfirm: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const go = async () => { setBusy(true); setMsg(null); try { setMsg(await onConfirm()); } finally { setBusy(false); } };
  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-6 preview-scope" onClick={onCancel}>
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 pt-5">
          <span className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${danger ? "bg-[#FDECEA] text-[#C0392B]" : "bg-brand-light text-brand"}`}>
            {danger ? <IconAlertTriangle size={18} stroke={1.8} /> : <IconTrash size={18} stroke={1.8} />}
          </span>
          <div className="min-w-0">
            <h2 className="text-[16px] font-medium text-[#232D42]">{title}</h2>
            <p className="text-[14px] text-[#8A92A6] mt-1">{body}</p>
          </div>
        </div>
        <ul className="mx-5 mt-4 max-h-40 overflow-y-auto rounded border border-gray-100 bg-[#F6F7FB] px-3 py-2 text-[14px] text-[#232D42] space-y-1">
          {names.slice(0, 50).map((n, i) => <li key={i} className="truncate">{n}</li>)}
          {names.length > 50 && <li className="text-[#8A92A6]">and {names.length - 50} more</li>}
        </ul>
        {msg && <div className="mx-5 mt-3 rounded bg-[#FDECEA] text-[#8a2e28] text-[14px] px-3 py-2">{msg}</div>}
        <div className="flex items-center justify-end gap-2 px-5 py-4 mt-4 border-t border-gray-100">
          <button onClick={onCancel} className="h-9 px-3 rounded text-[14px] font-medium text-gray-600 hover:text-gray-900">{msg ? "Close" : "Cancel"}</button>
          <button onClick={go} disabled={busy}
            className={`h-9 px-4 rounded text-[14px] font-medium text-white disabled:opacity-50 ${danger ? "bg-[#C0392B]" : "bg-brand"} hover:brightness-110`}>
            {busy ? "Working…" : action}
          </button>
        </div>
      </div>
    </div>
  );
}

// Recycle bin view: everything deleted from the Master sheet / My Day, newest first.
// Restore puts a task back exactly as it was; Delete forever is the only real erase.
function RecycleBin({ items, notReady, error, onChanged }: { items?: TrashItem[]; notReady?: boolean; error?: string; onChanged: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | "restore" | "purge">(null);
  const list = items || [];
  const chosen = list.filter((t) => picked.has(t.id));
  const allOn = list.length > 0 && chosen.length === list.length;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ownerLabel = (k: string | null) => (k && TEAM.find((m) => m.key === k)?.label) || k || "—";
  const run = async (kind: "restore" | "purge") => {
    const res = await fetch(`/api/marketing-hub/trash/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: chosen.map((t) => t.id) }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return j.error || "Something went wrong.";
    setPicked(new Set()); onChanged();
    if (j.failed?.length) return `${j.failed.length} couldn't be ${kind === "restore" ? "restored" : "deleted"}: ${j.failed[0].error}`;
    setConfirm(null); return null;
  };

  return (
    <div className="flex-1 min-w-0 bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100">
        <IconTrash size={20} stroke={1.8} className="text-[#8A92A6]" />
        <div>
          <div className="text-base font-medium">Recycle bin</div>
          <div className="text-[12px] text-gray-500">{fmtInt(list.length)} deleted task{list.length === 1 ? "" : "s"} · restore puts a task back with its comments and history</div>
        </div>
        {chosen.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setConfirm("restore")} className="inline-flex items-center gap-1.5 h-9 px-3 rounded text-[14px] font-medium text-white bg-brand hover:brightness-110">
              <IconRestore size={16} stroke={1.8} />Restore {chosen.length}
            </button>
            <button onClick={() => setConfirm("purge")} className="inline-flex items-center gap-1.5 h-9 px-3 rounded text-[14px] font-medium text-[#C0392B] border border-[#F3C6CE] bg-white hover:bg-[#FDECEA]">
              <IconTrash size={16} stroke={1.8} />Delete forever
            </button>
          </div>
        )}
      </div>

      {notReady ? (
        <div className="px-5 py-10 text-center text-[14px] text-[#8A92A6]">{error}</div>
      ) : items === undefined ? (
        <LoadingBlock />
      ) : list.length === 0 ? (
        <div className="px-5 py-10 text-center text-[14px] text-[#8A92A6]">The recycle bin is empty.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr className="text-gray-500 text-left">
                <th className="pl-4 pr-0 py-2.5 w-8 font-normal" onClick={() => setPicked(allOn ? new Set() : new Set(list.map((t) => t.id)))}>
                  <PickBox on={allOn} partial={chosen.length > 0 && !allOn} label="Select all" />
                </th>
                <th className="px-4 py-2.5 font-normal">Task</th>
                <th className="px-4 py-2.5 font-normal">Primary Interest / SBU</th>
                <th className="px-4 py-2.5 font-normal">Type</th>
                <th className="px-4 py-2.5 font-normal">Status</th>
                <th className="px-4 py-2.5 font-normal">Owner</th>
                <th className="px-4 py-2.5 font-normal">Deleted</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} onClick={() => toggle(t.id)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                  <td className="pl-4 pr-0 py-2.5 w-8"><PickBox on={picked.has(t.id)} label={`Select ${t.particulars || "task"}`} /></td>
                  <td className="px-4 py-2.5"><span className="text-gray-800 block max-w-[320px] truncate">{t.particulars || "(untitled)"}</span></td>
                  <td className="px-4 py-2.5 text-gray-600">{t.sbu || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600">{t.type || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600">{t.status || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600">{ownerLabel(t.owner)}</td>
                  <td className="px-4 py-2.5 text-gray-500">{fmtDateTime(t.deletedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirm && (
        <ConfirmTrash
          danger={confirm === "purge"}
          title={confirm === "restore"
            ? `Restore ${chosen.length} task${chosen.length === 1 ? "" : "s"}?`
            : `Delete ${chosen.length} task${chosen.length === 1 ? "" : "s"} forever?`}
          body={confirm === "restore"
            ? "They go back to the Master sheet exactly as they were: same owner, status, comments and history."
            : "This can't be undone. The tasks, their comments and their history are erased for good."}
          names={chosen.map((t) => t.particulars || "(untitled)")}
          action={confirm === "restore" ? "Restore" : "Delete forever"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => run(confirm)}
        />
      )}
    </div>
  );
}

// Branded "New view" builder — replaces the native window.prompt. Names the view,
// picks an access level + optional description, and shows exactly what it captures.
function NewViewModal({ config, fields, totalCols, onClose, onCreated }: {
  config: { filter: FilterModel; sorts: SortSpec[]; hiddenCols: string[]; color: string; rangeDays: number }; fields: FilterFieldDef<Row>[]; totalCols: number; onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [access, setAccess] = useState<ViewAccess>("personal");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chips = summarizeFilter(config.filter, fields);
  if (!chips.length) chips.push("All tasks");
  if (config.sorts.length) chips.push(`Sorted · ${config.sorts.length}`);
  if (config.hiddenCols.length) chips.push(`${totalCols - config.hiddenCols.length} columns`);
  if (config.color) chips.push(`Coloured by ${COLOR_FIELDS.find((f) => f.key === config.color)?.label || config.color}`);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/marketing-hub/views", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, access, config }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alertDialog(j.error || "Could not create view."); return; }
      onCreated();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-6 preview-scope" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2"><IconPlus size={18} className="text-brand" /><h2 className="text-[16px] font-semibold text-[#232D42]">New view</h2></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[#232D42] mb-1.5">View name</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") create(); }}
              placeholder="e.g. Manya · approved reels"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#232D42] mb-1.5">Description <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              placeholder="What is this view for?"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none outline-none focus:border-brand" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#232D42] mb-1.5">Access</label>
            <div className="grid grid-cols-3 gap-2">
              {(["personal", "collaborative", "locked"] as ViewAccess[]).map((a) => {
                const M = ACCESS_META[a]; const Ic = M.icon; const on = access === a;
                return (
                  <button key={a} onClick={() => setAccess(a)} title={M.hint}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-[11px] font-medium transition ${on ? "border-brand bg-brand-light/50 text-brand" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}>
                    <Ic size={16} />{M.label.replace(" view", "")}
                  </button>
                );
              })}
            </div>
            <div className="text-[11px] text-gray-400 mt-1.5">{ACCESS_META[access].hint}</div>
          </div>
          <div className="rounded-lg bg-[#F6F7FB] border border-gray-100 px-3 py-2.5">
            <div className="text-[11px] font-medium text-[#8A92A6] uppercase tracking-wide mb-1.5">Captures</div>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c, i) => <span key={i} className="text-[11px] bg-white border border-gray-200 rounded-full px-2 py-0.5 text-gray-700">{c}</span>)}
              <span className="text-[11px] bg-white border border-gray-200 rounded-full px-2 py-0.5 text-gray-700">Last {config.rangeDays} days</span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="text-[13px] font-medium text-gray-600 hover:text-gray-900 px-3 py-2">Cancel</button>
          <button onClick={create} disabled={saving || !name.trim()}
            className="bg-brand text-white text-[13px] font-medium rounded-lg px-4 py-2 hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? "Creating…" : "Create view"}
          </button>
        </div>
      </div>
    </div>
  );
}

// `picked` + `onPick` switch on the checkbox column (only passed when the viewer may delete).
function MasterSheet({ rows, facets, onOpen, onSaved, loading, bare, visibleCols, colorField, groupField, customCols, picked, onPick, highlightId }: { rows: Row[]; facets?: Facets; onOpen: (id: string) => void; onSaved: () => void; loading: boolean; bare?: boolean; visibleCols?: string[]; colorField?: string; groupField?: string; customCols?: CustomColumn[]; picked?: Set<string>; onPick?: (ids: string[], on: boolean) => void; highlightId?: string | null }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (k: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allSbus = facets?.sbu || [];
  const statusOptions = facets?.status || PIPELINE_STAGES.map((s) => s.key);
  const priorityOptions = facets?.priority || ["Urgent", "High", "Medium", "Low"];
  // Inline-cell save. On refusal the cell reverts on its own (it renders from the
  // row prop, which never changed) — the overlay is what tells you why.
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const save = async (id: string, fields: Record<string, unknown>) => {
    const r = await saveField(id, fields);
    if (r.ok) { onSaved(); return; }
    setFailure(failureFrom(r, rows.find((x) => x.id === id)?.particulars || "This task"));
  };
  // Publish date is the gated field — route it through the approval flow (reason
  // popup for non-admins), never the plain `save`.
  const { changePublishDate } = usePublishApproval();
  const changeDate = async (id: string, to: string | null) => {
    const row = rows.find((x) => x.id === id);
    const outcome = await changePublishDate({ id, title: row?.particulars || "This task", from: row?.publishingDate || null, to });
    if (outcome === "applied" || outcome === "pending") onSaved();
    else if (outcome === "error") setFailure({ kind: "error", message: "couldn't change the publish date — try again." });
  };
  const saveCustom = async (id: string, key: string, value: unknown) => {
    const res = await fetch("/api/marketing-hub/set-custom", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId: id, key, value }) });
    if (res.ok) onSaved();
  };
  const customByKey = new Map((customCols || []).map((c) => [c.key, c]));
  const allCols = [...MASTER_COLUMNS, ...(customCols || []).map((c) => ({ key: c.key, label: c.label }))];
  const cols = allCols.filter((c) => !visibleCols || visibleCols.includes(c.key));
  const selectable = !!(picked && onPick);
  const span = cols.length + (selectable ? 1 : 0);
  const allPicked = selectable && rows.length > 0 && rows.every((r) => picked!.has(r.id));
  const somePicked = selectable && !allPicked && rows.some((r) => picked!.has(r.id));
  const colorOf = (r: Row): string | undefined =>
    colorField === "status" ? statusColor(r.status)
    : colorField === "sbu" ? sbuColor(r.sbu, allSbus)
    : colorField === "priority" ? priorityColor(r.priority) : undefined;

  const customCell = (cc: CustomColumn, r: Row) => {
    const v = r.custom?.[cc.key];
    if (cc.type === "checkbox") return <button onClick={(e) => { e.stopPropagation(); saveCustom(r.id, cc.key, !v); }} className={`w-4 h-4 rounded border flex items-center justify-center ${v ? "bg-brand border-brand text-white" : "border-gray-300"}`}>{v ? <IconCheck size={11} stroke={3} /> : null}</button>;
    return <EditableCell display={v != null && v !== "" ? <span className="text-gray-700">{cc.type === "date" ? fmtDateShort(String(v)) : String(v)}</span> : <span className="text-gray-300">—</span>} editControl={(done) => (
      cc.type === "select" ? <PreviewSelect defaultOpen size="sm" onClose={done} value={String(v ?? "")} options={[{ value: "", label: "—" }, ...cc.options.map((o) => ({ value: o, label: o }))]} onChange={async (val) => { await saveCustom(r.id, cc.key, val); done(); }} />
      : cc.type === "date" ? <input type="date" autoFocus defaultValue={String(v ?? "").slice(0, 10)} onBlur={done} className={EDIT_SELECT_CLS} onChange={async (e) => { await saveCustom(r.id, cc.key, e.target.value); done(); }} />
      : <input type={cc.type === "number" ? "number" : "text"} autoFocus defaultValue={String(v ?? "")} onBlur={done} className={EDIT_SELECT_CLS} onChange={async (e) => { await saveCustom(r.id, cc.key, e.target.value); done(); }} />
    )} />;
  };

  const cell = (key: string, r: Row) => {
    const custom = customByKey.get(key);
    if (custom) return customCell(custom, r);
    const sp = statusPill(r.status); const pp = priorityPill(r.priority);
    const ownerKey = TEAM.find((m) => ownerMatches(r.owner, m))?.key ?? "";
    switch (key) {
      case "particulars": return <span className="text-gray-800 block max-w-[280px] truncate">{r.particulars || "(untitled)"}</span>;
      case "sbu": return <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: sbuColor(r.sbu, allSbus) }} />{r.sbu || "—"}</span>;
      case "type": return <span className="text-gray-600">{r.type || "—"}</span>;
      case "status": return <EditableCell display={r.status ? <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: sp.bg, color: sp.text }}>{r.status}</span> : <span className="text-gray-300">— set</span>} editControl={(done) => (<PreviewSelect defaultOpen size="sm" onClose={done} value={r.status || ""} options={statusOptions.map((o) => ({ value: o, label: o }))} onChange={async (val) => { await save(r.id, { status: val }); done(); }} />)} />;
      case "owner": return <EditableCell display={r.owner ? <span className="inline-flex items-center gap-2"><span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium" style={{ background: "#EEEDFE", color: "#3C3489" }}>{r.owner.trim().slice(0, 1).toUpperCase()}</span>{r.owner}</span> : <span className="text-gray-300">— assign</span>} editControl={(done) => (<PreviewSelect defaultOpen size="sm" onClose={done} value={ownerKey} options={[{ value: "", label: isVideoType(r.type) && r.status === "Content - Approved" ? "Nobody — claim pool" : "Unassigned" }, ...TEAM.map((m) => ({ value: m.key, label: m.label }))]} onChange={async (val) => { await save(r.id, { owner_key: val || null }); done(); }} />)} />;
      case "priority": return <EditableCell display={r.priority ? <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: pp.bg, color: pp.text }}>{r.priority}</span> : <span className="text-gray-300">— set</span>} editControl={(done) => (<PreviewSelect defaultOpen size="sm" onClose={done} value={r.priority || ""} options={priorityOptions.map((o) => ({ value: o, label: o }))} onChange={async (val) => { await save(r.id, { priority: val }); done(); }} />)} />;
      case "publishingDate": return <EditableCell display={r.publishingDate ? <span className="text-gray-500">{fmtDateShort(r.publishingDate)}</span> : <span className="text-gray-300">— set date</span>} editControl={(done) => (<input type="date" autoFocus defaultValue={r.publishingDate?.slice(0, 10) || ""} onBlur={done} className={EDIT_SELECT_CLS} onChange={async (e) => { done(); await changeDate(r.id, e.target.value || null); }} />)} />;
      case "createdBy": return r.createdBy ? <span className="text-gray-600">{r.createdBy}</span> : <span className="text-gray-300">—</span>;
      case "dueDate": return <span className="text-gray-500">{r.dueDate ? fmtDateShort(r.dueDate) : "—"}</span>;
      case "platforms": return <PlatformIcons platforms={r.platforms} />;
      case "attachments": return r.attachments.length ? <span className="inline-flex items-center gap-0.5 text-gray-400"><IconPaperclip size={13} />{r.attachments.length}</span> : <span className="text-gray-300">—</span>;
      case "caption": return <span className="text-gray-500 block max-w-[220px] truncate">{r.caption || "—"}</span>;
      case "needsReview": return r.needsReview ? <span className="text-[11px] bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">Yes</span> : <span className="text-gray-300">—</span>;
      default: return <span className="text-gray-300">—</span>;
    }
  };

  // Scroll it into view once it exists. Runs on highlightId rather than on mount
  // because the rows arrive from a fetch, so the element is not there on the first pass.
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => highlightRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 120);
    return () => clearTimeout(t);
  }, [highlightId, rows]);

  const rowEl = (r: Row) => {
    const cc = colorOf(r);
    const lit = r.id === highlightId;
    return (
      // The row you came for keeps a brand tint and a left bar until you navigate away.
      // Deliberately not a fading flash: the point is to still be findable in a minute,
      // when you have read the task, closed it and are looking for where it went.
      <tr key={r.id} ref={lit ? highlightRef : undefined} onClick={() => onOpen(r.id)}
        className={`border-b border-gray-50 cursor-pointer ${lit ? "bg-brand-light/60 hover:bg-brand-light" : "hover:bg-gray-50"}`}
        style={lit ? { boxShadow: "inset 3px 0 0 #3A57E8" } : cc ? { boxShadow: `inset 3px 0 0 ${cc}` } : undefined}>
        {selectable && (
          <td className="pl-4 pr-0 py-2.5 w-8" onClick={(e) => { e.stopPropagation(); onPick!([r.id], !picked!.has(r.id)); }}>
            <PickBox on={picked!.has(r.id)} label={`Select ${r.particulars || "task"}`} />
          </td>
        )}
        {cols.map((c) => <td key={c.key} className="px-4 py-2.5">{cell(c.key, r)}</td>)}
      </tr>
    );
  };

  // Group rows (Airtable-style). Each group has a value key, a display label, and
  // an optional colour swatch when the field carries one.
  const groupOf = (r: Row): { key: string; label: string; color?: string } => {
    switch (groupField) {
      case "sbu": return { key: r.sbu || "", label: r.sbu || "No interest", color: r.sbu ? sbuColor(r.sbu, allSbus) : undefined };
      case "type": return { key: r.type || "", label: r.type || "No type" };
      case "status": return { key: r.status || "", label: r.status || "No status", color: r.status ? statusColor(r.status) : undefined };
      case "owner": return { key: r.owner || "", label: r.owner || "Unassigned" };
      case "priority": return { key: r.priority || "", label: r.priority || "No priority", color: r.priority ? priorityColor(r.priority) : undefined };
      case "publishingDate": { const d = (r.publishingDate || "").slice(0, 10); return { key: d, label: d ? fmtDate(d) : "No date" }; }
      default: return { key: "", label: "" };
    }
  };
  const groups = useMemo(() => {
    if (!groupField) return [] as { key: string; label: string; color?: string; rows: Row[] }[];
    const gs: { key: string; label: string; color?: string; rows: Row[] }[] = [];
    const idx = new Map<string, number>();
    for (const r of rows) {
      const g = groupOf(r);
      let i = idx.get(g.key);
      if (i === undefined) { i = gs.length; idx.set(g.key, i); gs.push({ ...g, rows: [] }); }
      gs[i].rows.push(r);
    }
    // Order groups sensibly: status / priority / interest by their reference order,
    // dates chronologically; the empty ("No …") group always sinks to the bottom.
    const ref = groupField === "status" ? statusOptions : groupField === "priority" ? priorityOptions : groupField === "sbu" ? allSbus : null;
    if (groupField === "publishingDate") gs.sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    else if (ref) gs.sort((a, b) => { const ai = a.key === "" ? 1e6 : (ref.indexOf(a.key) + 1 || 1e5); const bi = b.key === "" ? 1e6 : (ref.indexOf(b.key) + 1 || 1e5); return ai - bi; });
    else gs.sort((a, b) => (a.key === "" ? 1 : 0) - (b.key === "" ? 1 : 0));
    return gs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, groupField]);

  const table = (
    <div className="overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead className="border-b border-gray-100 bg-gray-50">
          <tr className="text-gray-500 text-left">
            {selectable && (
              <th className="pl-4 pr-0 py-2.5 w-8 font-normal" onClick={() => onPick!(rows.map((r) => r.id), !allPicked)}>
                <PickBox on={allPicked} partial={somePicked} label="Select all" />
              </th>
            )}
            {cols.map((c) => <th key={c.key} className="px-4 py-2.5 font-normal">{c.key === "attachments" ? <IconPaperclip size={14} className="text-gray-400" /> : c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={span} className="px-4 py-10 text-center text-gray-400">{loading ? <LoadingBlock className="!py-0" /> : "No entries match"}</td></tr>
          )}
          {groupField
            ? groups.map((g) => {
                const isCol = collapsed.has(g.key);
                return (
                  <Fragment key={g.key || "∅"}>
                    <tr className="bg-gray-50 border-y border-gray-100 cursor-pointer select-none hover:bg-gray-100/70" onClick={() => toggleGroup(g.key)}>
                      <td colSpan={span} className="px-4 py-2">
                        <span className="inline-flex items-center gap-2 text-[13px] font-medium text-[#232D42]">
                          <IconChevronDown size={15} className={`text-gray-400 transition-transform ${isCol ? "-rotate-90" : ""}`} />
                          {g.color && <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: g.color }} />}
                          {g.label}
                          <span className="text-gray-400 font-normal">· {g.rows.length}</span>
                        </span>
                      </td>
                    </tr>
                    {!isCol && g.rows.map((r) => rowEl(r))}
                  </Fragment>
                );
              })
            : rows.map((r) => rowEl(r))}
        </tbody>
      </table>
    </div>
  );

  const overlay = <SaveFailureOverlay failure={failure} onClose={() => setFailure(null)} />;
  if (bare) return <>{table}{overlay}</>;
  return (
    <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div className="text-base font-medium">Master sheet</div>
        <div className="text-sm text-gray-400">{fmtInt(rows.length)} records · edit inline · click a row to open</div>
      </div>
      {table}
      {overlay}
    </div>
  );
}

type DetailAttachment = { id: string; filename: string; storage_path: string; thumb_path?: string | null; mime_type: string | null; kind?: string; size_bytes?: number | null };
type TaskDetail = {
  content: string; caption: string; notes: string;
  instagramUrl?: string; facebookUrl?: string; linkedinUrl?: string; outputLink?: string; platforms?: string[]; referenceLinks?: string[];
  status?: string | null;
  collaborators: { key: string; name: string; role: string | null }[];
  attachments: DetailAttachment[];
  trashedFiles?: { filename: string; storage_path: string; mime_type: string }[];
  comments: { id: string; body: string; resolved: boolean; created_at: string; authorName: string; author_key: string }[];
  activity: { id: string; action: string; from_value: string | null; to_value: string | null; created_at: string; actorName: string; actor_key: string | null }[];
  scheduler: { syncedToScheduler: boolean; startAt: string | null };
  me?: string | null;
  linkedThumbnail?: { storage_path: string; filename: string } | null;   // the reel's thumbnail task's image
};
// "Mon 17 Aug, 9:51 pm" — the year only when it is not the current one. The shared
// fmtDateTime spells the weekday and month out in full, which is more than this
// 240px column can hold.
const fmtWhen = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  return `${date}, ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })}`;
};
// How long a task took (start → end), e.g. "2h 15m" or "3d 4h".
function durationBetween(start?: string | null, end?: string | null): string {
  if (!start || !end) return "";
  let ms = new Date(end).getTime() - new Date(start).getTime();
  if (isNaN(ms) || ms < 0) return "";
  const d = Math.floor(ms / 86_400_000); ms -= d * 86_400_000;
  const h = Math.floor(ms / 3_600_000); ms -= h * 3_600_000;
  const m = Math.floor(ms / 60_000);
  const parts = [d && `${d}d`, h && `${h}h`, (!d && m) && `${m}m`].filter(Boolean);
  return parts.join(" ") || "0m";
}
const isImageCreative = (name: string, type: string) => type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif)$/i.test(name);
type CreativeKind = "image" | "video" | "pdf" | "file";
const creativeKind = (name: string, type: string): CreativeKind => {
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name)) return "image";
  if (type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(name)) return "video";
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  return "file";
};
type Creative = { id: string | undefined; url: string; name: string; type: string; removable: boolean; thumb?: string | null };

// In-dashboard creative viewer: images/videos render large; PDFs open in an
// embedded iframe (never a new tab); prev/next arrows + ←/→ keys for multiple.
function CreativeViewer({ creatives, index, setIndex, onClose }: {
  creatives: Creative[]; index: number; setIndex: (i: number) => void; onClose: () => void;
}) {
  const many = creatives.length > 1;
  const go = (d: number) => setIndex((index + d + creatives.length) % creatives.length);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && many) setIndex((index + 1) % creatives.length);
      else if (e.key === "ArrowLeft" && many) setIndex((index - 1 + creatives.length) % creatives.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, many, creatives.length, onClose, setIndex]);

  const c = creatives[index];
  const kind = creativeKind(c.name, c.type);
  return (
    <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-6" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 text-white/80 hover:text-white p-1"><IconX size={26} /></button>
      <div className="absolute top-5 left-5 text-white/80 text-[13px] font-medium">{index + 1} / {creatives.length}</div>
      {many && <button onClick={(e) => { e.stopPropagation(); go(-1); }} className="absolute left-3 md:left-6 top-1/2 -translate-y-1/2 bg-white/15 hover:bg-white/25 text-white rounded-full p-2.5"><IconChevronLeft size={24} /></button>}
      <div className="max-w-[92vw] max-h-[88vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.url} alt={c.name} className="max-w-[92vw] max-h-[82vh] object-contain rounded-lg" loading="lazy" decoding="async" />
        ) : kind === "video" ? (
          <div className="relative"><SoundVideo src={c.url} open loop={false} className="max-w-[92vw] max-h-[82vh] rounded-lg bg-black" /></div>
        ) : kind === "pdf" ? (
          <iframe src={c.url} title={c.name} className="w-[90vw] h-[84vh] bg-white rounded-lg" />
        ) : (
          <div className="bg-white rounded-xl px-8 py-10 text-center">
            <IconFileText size={40} className="text-gray-400 mx-auto mb-3" />
            <div className="text-sm text-gray-700 mb-3">{c.name}</div>
            <a href={c.url} download className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand"><IconDownload size={15} />Download</a>
          </div>
        )}
        <div className="mt-3 text-white/80 text-[12px] truncate max-w-[80vw]">{c.name}</div>
      </div>
      {many && <button onClick={(e) => { e.stopPropagation(); go(1); }} className="absolute right-3 md:right-6 top-1/2 -translate-y-1/2 bg-white/15 hover:bg-white/25 text-white rounded-full p-2.5"><IconChevronRight size={24} /></button>}
    </div>
  );
}

// A page section (Pipeline): the heading on its own line above the content. Panel is a
// task-window field row — its 174px label column cut "Needs chasing — oldest first"
// short and sat the heading beside its own description (23 Oct).
function PageSection({ icon: Ic, title, right, children }: {
  icon?: typeof IconPhoto; title: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-gray-100 rounded-2xl px-5 py-4">
      <div className="flex items-center gap-2 mb-2">
        {Ic && <Ic size={16} stroke={1.7} className="text-[#3A57E8] flex-shrink-0" />}
        <h3 className="text-[15px] font-medium text-[#232D42]">{title}</h3>
        {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
      </div>
      {children}
    </section>
  );
}

// Themed card: white surface, hairline border, rounded-xl, labelled header (optional
// brand accent + trailing slot). The building block that gives the modal real sections.
function Panel({ icon: Ic, title, right, accent, children }: {
  icon?: typeof IconPhoto; title: string; right?: React.ReactNode; accent?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="mh-prow flex items-start py-2">
      {/* Airtable's field row: 16px icon, 13px label in a 174px column, value beside it.
          With a file preview open the label goes on top (components/RefPreview). */}
      <div className="mh-plabel w-[174px] flex-shrink-0 flex items-center gap-1.5 pt-[3px] pl-2">
        {Ic && <Ic size={16} stroke={1.6} className="text-[#616670] flex-shrink-0" />}
        <span className="text-[13px] text-[#565A62] truncate">{title}</span>
      </div>
      <div className={`flex-1 min-w-0 ${accent ? "" : ""}`}>
        {right && <div className="float-right ml-2 flex items-center gap-2">{right}</div>}
        {children}
      </div>
    </div>
  );
}

// ---------- Activity feed (Airtable-style: who · what changed · when) ----------
// Fixed per-person avatar colours (like Airtable's coloured initials).
const PERSON_AV: Record<string, [string, string]> = {
  manya: ["#FCEEE0", "#B45309"], praveen: ["#FDEBE3", "#C2410C"],
  nikhil: ["#E4ECFF", "#2138B0"], nandu: ["#E7EEFE", "#1E3FA8"], maheen: ["#EEEDFE", "#3C3489"],
};
const FEED_AV = ["#EEEDFE:#3C3489", "#E1F5EE:#0F6E56", "#E4ECFF:#2138B0", "#FDECEC:#B4232D", "#FDF2E2:#9A6212", "#E9F6FE:#0E5E86"];
// system = an un-attributed / imported change (Airtable shows these as "Automations").
function feedAvatar(key: string | null, name: string): { bg: string; fg: string; initials: string; system: boolean } {
  const k = (key || "").toLowerCase();
  const nameOk = !!name && name !== "—" && name !== "?";
  if (!k && !nameOk) return { bg: "#EEF0F4", fg: "#8A92A6", initials: "", system: true };
  const initials = (name || k).trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";
  const pc = PERSON_AV[k];
  if (pc) return { bg: pc[0], fg: pc[1], initials, system: false };
  const s = (k || name).toLowerCase(); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const [bg, fg] = FEED_AV[h % FEED_AV.length].split(":");
  return { bg, fg, initials, system: false };
}
export function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
// Word-level diff: added words green, removed words red-strikethrough (LCS). Only the
// part that changed is compared and shown, with a few words either side — a link pasted
// into a long brief showed the WHOLE brief struck out and re-added, because the full
// texts were too big to compare (Praveen, 26 Oct). Spacing-only differences count as equal.
function wordDiff(oldStr: string, newStr: string): React.ReactNode {
  const a = (oldStr || "").split(/(\s+)/), b = (newStr || "").split(/(\s+)/);
  const key = (t: string) => (/^\s*$/.test(t) ? (t.includes("\n") ? "\n" : " ") : t);
  let pre = 0;
  while (pre < a.length && pre < b.length && key(a[pre]) === key(b[pre])) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && key(a[a.length - 1 - suf]) === key(b[b.length - 1 - suf])) suf++;
  const am = a.slice(pre, a.length - suf), bm = b.slice(pre, b.length - suf);
  if (!am.some((t) => t.trim()) && !bm.some((t) => t.trim())) return <span className="text-gray-400">Only the spacing changed.</span>;
  const CTX = 14;   // tokens of unchanged text shown either side
  const before = b.slice(Math.max(0, pre - CTX), pre).join(""), after = b.slice(b.length - suf, b.length - suf + CTX).join("");
  const out: React.ReactNode[] = []; let k = 0;
  // The brief is stored as Markdown; its ** bold marks are noise here.
  const push = (t: string, cls: string) => { const v = t.replace(/\*\*/g, ""); if (v) out.push(<span key={k++} className={cls}>{v}</span>); };
  if (pre > CTX) push("… ", "text-gray-400");
  push(before, "text-gray-500");
  const n = am.length, m = bm.length;
  if (n * m > 400_000) {   // a very large rewrite — show the changed part as before / after
    push(am.join(""), "bg-red-50 text-red-600 line-through"); push(bm.join(""), "bg-emerald-50 text-emerald-700");
  } else {
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = key(am[i]) === key(bm[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (key(am[i]) === key(bm[j])) { push(bm[j], ""); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { push(am[i], "bg-red-50 text-red-600 line-through"); i++; }
      else { push(bm[j], "bg-emerald-50 text-emerald-700"); j++; }
    }
    while (i < n) { push(am[i], "bg-red-50 text-red-600 line-through"); i++; }
    while (j < m) { push(bm[j], "bg-emerald-50 text-emerald-700"); j++; }
  }
  push(after, "text-gray-500");
  if (suf > CTX) push(" …", "text-gray-400");
  return <span className="whitespace-pre-wrap break-words leading-relaxed">{out}</span>;
}
// The "(design work → … when approved)" hint under a task's title (30 Oct): read from the
// Rules page when its rules are switched on, so a 12thPlus carousel says Nandu, not the
// old fixed "Praveen". Owner rules are checked top-down, first fit wins — as the database
// does (mh_rules_engine_before). A rule that depends on something this hint can't know
// (who wrote it, the previous status…) stops the guess, and the old wording is shown.
type HintRule = { active: boolean; trigger_spec: { on?: string; statuses?: string[] }; conditions?: { conditions?: { field: string; op: string; value?: unknown }[]; conjunction?: string }; actions?: { type: string; to?: string }[] };
let hintRulesP: Promise<{ on: boolean; rules: HintRule[]; people: Record<string, string> }> | null = null;
function loadHintRules() {
  hintRulesP ??= fetch("/api/marketing-hub/rules-engine", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
    .then((j) => ({ on: !!j?.engineOn, rules: (j?.rules || []) as HintRule[], people: Object.fromEntries(((j?.people || []) as { value: string; label: string }[]).map((p) => [p.value, p.label])) }))
    .catch(() => ({ on: false, rules: [], people: {} }));
  return hintRulesP;
}
/** `who` is the person the rules hand it to (null when the hint can't tell — then the old wording). */
function useApprovalHint(type: string, sbu: string): { hint: string; who: string | null } {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadHintRules>> | null>(null);
  useEffect(() => { let alive = true; loadHintRules().then((d) => { if (alive) setData(d); }); return () => { alive = false; }; }, []);
  return approvalHintFor(data, type, sbu);
}
function approvalHintFor(data: Awaited<ReturnType<typeof loadHintRules>> | null, type: string, sbu: string): { hint: string; who: string | null } {
  const fallback = { hint: isVideoType(type) ? "video work → editors" : "design work → Praveen when approved", who: null };
  if (!data?.on || !type) return fallback;
  const kind = isVideoType(type) ? "video" : "design";
  const val = (f: string) => (f === "type" ? type : f === "sbu" ? sbu : f === "kind" ? kind : f === "status" ? "Content - Approved" : undefined);
  for (const r of data.rules) {
    const owner = (r.actions || []).find((a) => a.type === "owner");
    if (!r.active || !owner) continue;
    if (r.trigger_spec?.on !== "status" || !(r.trigger_spec.statuses || []).includes("Content - Approved")) continue;
    const conds = r.conditions?.conditions || [];
    if (conds.some((c) => val(c.field) === undefined)) return fallback;   // can't tell from here
    const test = (c: { field: string; op: string; value?: unknown }) => {
      const v = val(c.field) || "", list = Array.isArray(c.value) ? (c.value as string[]) : [String(c.value ?? "")];
      return c.op === "is" ? v === list[0] : c.op === "isNot" ? v !== list[0] : c.op === "isAnyOf" ? list.includes(v) : c.op === "isNoneOf" ? !list.includes(v)
        : c.op === "isEmpty" ? !v : c.op === "isNotEmpty" ? !!v : false;
    };
    const fits = r.conditions?.conjunction === "or" ? conds.some(test) : conds.every(test);
    if (!fits) continue;
    if (owner.to === "__pool__") return { hint: `${kind} work → the claim pool when approved`, who: null };
    if (!owner.to || owner.to.startsWith("__")) return fallback;
    const who = data.people[owner.to] || owner.to.charAt(0).toUpperCase() + owner.to.slice(1);
    return { hint: `${kind} work → ${who} when approved`, who };
  }
  return fallback;
}

export const ACT_VERB: Record<string, string> = {
  created: "created this", status_changed: "changed the status", owner_changed: "reassigned this",
  rescheduled: "rescheduled this", due_date_changed: "changed the due date", renamed: "renamed this",
  // Publish-date approvals (lib/date-approvals): the approver accepts a request, they don't reschedule.
  date_change_requested: "asked to change the publish date", date_change_approved: "approved the date change request",
  date_change_rejected: "declined the date change request",
  priority_changed: "changed the priority", type_changed: "changed the type", content_edited: "edited the content",
  caption_edited: "edited the caption", notes_edited: "edited the notes", sbu_changed: "changed the Primary Interest",
  platforms_changed: "changed platforms", review_changed: "toggled review", output_link_changed: "updated the output link",
  creative_added: "added a creative", creative_removed: "removed a creative", thumbnail_added: "added the thumbnail", thumbnail_removed: "removed the thumbnail", post_media_removed: "took a file off the post in the Scheduler (it stays on the task)", creatives_reordered: "changed the order of the creatives", attachments_reordered: "changed the order of the attachments", claim: "claimed this",
  reference_added: "added a reference", reference_removed: "removed a reference",
  attachment_added: "added an attachment", attachment_removed: "removed an attachment", reference_links_changed: "updated the references",
  instagram_url_changed: "updated the Instagram link", facebook_url_changed: "updated the Facebook link", linkedin_url_changed: "updated the LinkedIn link",
  // Publishing history (22 Oct): people's queue actions, then what the publisher did.
  publish_scheduled: "scheduled it to publish", publish_now: "pressed Publish now", publish_draft_saved: "saved it as a scheduler draft",
  publish_rescheduled: "changed the publish time", removed_from_queue: "took it out of the publish queue",
  sent_back_for_review: "sent it back to Content Review",
  publish_started: "started publishing", publish_processing: "is waiting for Instagram to process the video · try",
  published: "published it", publish_failed: "couldn't publish it",
};
// Rows the n8n publisher writes (no person) read as "Publisher", not "System".
const PUBLISHER_ACTIONS = new Set(["publish_started", "publish_processing", "published", "publish_failed"]);
// People's names, written the way a name is written. The activity feed reads them
// from the team table, where several are stored lower-cased, and a key ("nikhil") is
// used when there is no display name at all — so the history said "nikhil claimed
// this". Only all-lowercase words are touched, which leaves "Manya B M" and any
// deliberate casing exactly as entered.
export function properName(n: string): string {
  return (n || "").split(" ").map((w) => (w && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

const DIFF_FIELDS = new Set(["content_edited", "caption_edited", "notes_edited"]);
// File and link changes show the thing itself (Praveen, 26 Oct): an added file as a green
// tile with its preview, a removed one in red and struck through — still viewable from the
// recycle bin — and links one by one, added in green, removed struck through in red.
const FILE_EVENT = /^(creative|reference|attachment)_(added|removed)$/;
const LINK_FIELDS = new Set(["reference_links_changed", "output_link_changed", "instagram_url_changed", "facebook_url_changed", "linkedin_url_changed"]);
const splitLinks = (v: string | null | undefined) => (v || "").split(/,\s+(?=https?:\/\/|www\.)/).map((x) => x.trim()).filter(Boolean);
const isImg = (name: string, mime?: string) => (mime || "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(name);
// What to put in a small tile.
//
// Prefer the WebP thumbnail made when the file was uploaded — it costs nothing
// to serve. Failing that, fall back to Supabase's resize endpoint, which is
// what the 515 images uploaded before thumbnails existed still need. That
// endpoint is billed per origin image, so it is the fallback and not the
// first choice.
const smallThumb = (u: string) => (u.includes("/storage/v1/object/public/") ? `${u.replace("/object/public/", "/render/image/public/")}?width=120&resize=contain&quality=70` : u);
const tileSrc = (a: { thumb_path?: string | null; storage_path: string }) => a.thumb_path || smallThumb(a.storage_path);
function FileChange({ name, url, thumb, mime, removed }: { name: string; url?: string; thumb?: string | null; mime?: string; removed: boolean }) {
  const body = (
    <span className={`inline-flex items-center gap-2 max-w-full rounded-lg border px-1.5 py-1 ${removed ? "border-red-200 bg-red-50/60" : "border-emerald-200 bg-emerald-50/60"}`}>
      {url && isImg(name, mime)
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={thumb || smallThumb(url)} alt="" className={`w-10 h-10 rounded-md object-cover bg-white flex-shrink-0 ${removed ? "opacity-50 grayscale" : ""}`} loading="lazy" decoding="async" />
        : <span className={`w-10 h-10 rounded-md bg-white flex items-center justify-center flex-shrink-0 ${removed ? "text-red-400" : "text-emerald-600"}`}><IconFileText size={18} stroke={1.6} /></span>}
      <span className={`text-[12px] truncate ${removed ? "line-through text-red-500" : "text-emerald-700"}`}>{removed ? "− " : "+ "}{name}</span>
    </span>
  );
  return <div className="mt-1" data-ref-preview data-ref-from={removed ? "Removed file" : "Added file"}>{url ? <a href={url} target="_blank" rel="noreferrer" data-ref-title={name} className="inline-block max-w-full hover:opacity-90">{body}</a> : body}</div>;
}
function LinkChange({ from, to }: { from: string | null; to: string | null }) {
  const before = splitLinks(from), after = splitLinks(to);
  const removed = before.filter((l) => !after.includes(l)), added = after.filter((l) => !before.includes(l));
  if (!removed.length && !added.length) return null;
  const href = (l: string) => (/^https?:\/\//i.test(l) ? l : `https://${l}`);
  return (
    <div className="mt-1 space-y-1" data-ref-preview data-ref-from="Link in history">
      {removed.map((l) => <a key={`r-${l}`} href={href(l)} target="_blank" rel="noreferrer" className="block text-[12px] truncate rounded-md px-2 py-1 bg-red-50/70 text-red-500 line-through hover:opacity-90">− {l}</a>)}
      {added.map((l) => <a key={`a-${l}`} href={href(l)} target="_blank" rel="noreferrer" className="block text-[12px] truncate rounded-md px-2 py-1 bg-emerald-50/70 text-emerald-700 hover:opacity-90">+ {l}</a>)}
    </div>
  );
}
const PILL_FIELDS = new Set(["status_changed"]);
type FeedItem =
  | { id: string; kind: "activity"; at: string; name: string; key: string | null; action: string; from: string | null; to: string | null; note?: string | null }
  | { id: string; kind: "comment"; at: string; name: string; key: string | null; body: string; resolved: boolean };

// A shareable link to one task, the way Airtable gives you a record link.
//
// Before this the only way to point somebody at a task was to tell them its name and
// let them search a 145-row sheet for it. The URL already worked as a deep link — it
// just lived in the address bar, where nobody thought to look, and got stripped once
// the modal opened (so by the time you thought to copy it, it was gone).
//
// Absolute, because this gets pasted into Slack and WhatsApp.
function CopyTaskLink({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    const href = `${window.location.origin}/dashboard/preview/marketing-hub?tab=master&open=${id}`;
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      // Clipboard needs a secure context and permission; neither is guaranteed. Fall
      // back to a selected textarea so the link is still copyable by hand rather than
      // the button silently doing nothing.
      const t = document.createElement("textarea");
      t.value = href; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } catch { /* user copies it themselves */ }
      document.body.removeChild(t);
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <button onClick={copy} title="Copy a link to this task — paste it in Slack or WhatsApp"
      className={`inline-flex items-center gap-1.5 text-[12px] font-medium rounded-lg px-2.5 py-1.5 border transition ${
        done ? "border-[#BFE6CD] bg-[#E3F5EA] text-[#0F6E3C]"
             : "border-gray-200 text-[#4A5468] hover:border-brand hover:text-brand"}`}>
      {done ? <IconCheck size={14} stroke={2} /> : <IconLink size={14} stroke={1.8} />}
      {done ? "Copied" : "Copy task link"}
    </button>
  );
}

// The task's activity timeline + comments — the right-hand column of the Master
// sheet's task popup, lifted out so My Day's task panel shows the SAME thing
// (Praveen, 28 Sep: "how master sheet has that, I need it for this task also").
// One component, so the two can't drift apart. The caller owns loading the detail
// (/api/marketing-hub/task-detail) and says who is commenting.
export function TaskActivityFeed({ postId, detail, loading, reload, author, authorLabel, onError }: {
  postId: string;
  detail: (Pick<TaskDetail, "activity" | "comments"> & Partial<Pick<TaskDetail, "attachments" | "trashedFiles">>) | null;
  loading: boolean;
  reload: () => void | Promise<void>;
  author: string;
  authorLabel: (key: string) => string;
  onError: (message: string) => void;
}) {
  // Filter (All activity / Revision history / Comments), resolved toggle,
  // expand-diff set, and a Show-more cap.
  const [feedFilter, setFeedFilter] = useState<"all" | "revisions" | "comments">("all");
  const [showResolved, setShowResolved] = useState(true);
  const [feedFilterOpen, setFeedFilterOpen] = useState(false);
  const feedFilterBtnRef = useRef<HTMLButtonElement>(null);
  const [expandedDiffs, setExpandedDiffs] = useState<Set<string>>(new Set());
  const [feedLimit, setFeedLimit] = useState(25);
  // Merge activity + comments into one chronological feed, honouring the filter.
  const feed = useMemo<FeedItem[]>(() => {
    const acts: FeedItem[] = (detail?.activity || []).map((a) => ({ id: a.id, kind: "activity", at: a.created_at, name: a.actorName, key: a.actor_key, action: a.action, from: a.from_value, to: a.to_value,
      // Only text notes — some rows keep an object here (e.g. {source} on imports).
      note: typeof (a as { detail?: unknown }).detail === "string" ? ((a as { detail?: string }).detail || null) : null }));
    const coms: FeedItem[] = (detail?.comments || []).filter((c) => showResolved || !c.resolved).map((c) => ({ id: `c${c.id}`, kind: "comment", at: c.created_at, name: c.authorName, key: c.author_key, body: c.body, resolved: c.resolved }));
    let items: FeedItem[] = [...acts, ...coms];
    if (feedFilter === "revisions") items = items.filter((i) => i.kind === "activity");
    else if (feedFilter === "comments") items = items.filter((i) => i.kind === "comment");
    // Newest first HERE so "show more" always reveals older entries; the timeline
    // below flips it to read top-to-bottom.
    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [detail, feedFilter, showResolved]);
  // What the timeline works on: the most recent `feedLimit` entries in the order they
  // happened (grouping and "what changed overall" need that order). It is SHOWN newest
  // first — "the latest change on top, older ones below" (Praveen, 26 Oct).
  const feedShown = useMemo(() => feed.slice(0, feedLimit).slice().reverse(), [feed, feedLimit]);
  // Group a run of 4+ similar changes by the same person, each within 30 minutes of the
  // last (Praveen, 26 Oct: five screenshots pasted and removed filled the whole history).
  // Files of one kind group together, edits to one text field, changes to one link field.
  const groupedFeed = useMemo(() => {
    type Act = Extract<FeedItem, { kind: "activity" }>;
    const fam = (it: FeedItem) => it.kind !== "activity" ? null : FILE_EVENT.test(it.action) ? `file:${it.action.split("_")[0]}` : (DIFF_FIELDS.has(it.action) || LINK_FIELDS.has(it.action)) ? it.action : null;
    const out: ({ type: "one"; it: FeedItem } | { type: "group"; id: string; fam: string; items: Act[] })[] = [];
    let i = 0;
    while (i < feedShown.length) {
      const f = fam(feedShown[i]);
      let j = i + 1;
      while (f && j < feedShown.length && fam(feedShown[j]) === f && feedShown[j].key === feedShown[i].key
        && new Date(feedShown[j].at).getTime() - new Date(feedShown[j - 1].at).getTime() <= 30 * 60_000) j++;
      if (f && j - i >= 4) { out.push({ type: "group", id: `g${feedShown[i].id}`, fam: f, items: feedShown.slice(i, j) as Act[] }); i = j; }
      else { out.push({ type: "one", it: feedShown[i] }); i++; }
    }
    return out;
  }, [feedShown]);
  const fileOf = (name: string) => (detail?.attachments || []).find((x) => x.filename === name) || (detail?.trashedFiles || []).find((x) => x.filename === name);
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const renderGroup = (g: { id: string; fam: string; items: Extract<FeedItem, { kind: "activity" }>[] }, isLatest: boolean) => {
    const first = g.items[0], last = g.items[g.items.length - 1];
    const av = feedAvatar(first.key, first.name);
    let verb: string;
    let body: React.ReactNode;
    if (g.fam.startsWith("file:")) {
      const noun = g.fam.slice(5);
      const added = g.items.filter((x) => x.action.endsWith("_added")).length, removed = g.items.length - added;
      verb = [added && `added ${added}`, removed && `removed ${removed}`].filter(Boolean).join(" and ") + ` ${noun}${g.items.length === 1 ? "" : "s"}`;
      body = (
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-ref-preview data-ref-from="History">
          {g.items.map((x) => {
            const name = x.to || x.from || ""; const fl = fileOf(name); const rm = x.action.endsWith("_removed");
            const tile = (
              <span className={`relative block w-11 h-11 rounded-md overflow-hidden border-2 ${rm ? "border-red-300" : "border-emerald-300"} bg-white`}>
                {fl?.storage_path && isImg(name, fl.mime_type || undefined)
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={tileSrc(fl)} alt="" className={`w-full h-full object-cover ${rm ? "opacity-40 grayscale" : ""}`} loading="lazy" decoding="async" />
                  : <span className="w-full h-full flex items-center justify-center text-gray-400"><IconFileText size={16} /></span>}
                <span className={`absolute bottom-0 right-0 text-[10px] leading-none font-semibold text-white px-1 py-0.5 rounded-tl ${rm ? "bg-red-500" : "bg-emerald-600"}`}>{rm ? "−" : "+"}</span>
              </span>
            );
            return <span key={x.id} title={`${rm ? "Removed" : "Added"} ${name} · ${hhmm(x.at)}`}>{fl?.storage_path ? <a href={fl.storage_path} target="_blank" rel="noreferrer" data-ref-title={name}>{tile}</a> : tile}</span>;
          })}
        </div>
      );
    } else if (DIFF_FIELDS.has(g.fam)) {
      verb = `${ACT_VERB[g.fam] || g.fam} ${g.items.length} times`;
      body = (
        <div className="mt-1">
          {expandedDiffs.has(g.id) && <div className="text-[14px] border border-gray-100 rounded-lg p-2 bg-gray-50/60 mb-1">{wordDiff(first.from || "", last.to || "")}</div>}
          <button onClick={() => setExpandedDiffs((st) => { const n = new Set(st); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })} className="text-[11px] text-brand hover:underline">{expandedDiffs.has(g.id) ? "Hide changes" : "Show what changed overall"}</button>
        </div>
      );
    } else {
      verb = `${ACT_VERB[g.fam] || g.fam} ${g.items.length} times`;
      body = <LinkChange from={first.from || null} to={last.to || null} />;
    }
    return (
      <div key={g.id} className="flex gap-2.5">
        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-semibold flex-shrink-0 mt-0.5 ring-[3px] ring-white relative z-10" style={{ background: av.bg, color: av.fg }} title={properName(first.name)}>{av.system ? <IconHistory size={11} /> : av.initials}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] text-gray-700">
            <span className="font-medium text-[#232D42]">{av.system ? "System" : properName(first.name)}</span>{" "}{verb}
            <span className="text-gray-400" title={`${new Date(first.at).toLocaleString("en-IN")} – ${new Date(last.at).toLocaleString("en-IN")}`}> · {hhmm(first.at)}–{hhmm(last.at)} · {relTime(last.at)}</span>
            {isLatest && <span className="ml-1.5 text-[10px] bg-brand-light text-[#2138B0] px-1.5 py-0.5 rounded-full font-medium">latest</span>}
          </div>
          {body}
        </div>
      </div>
    );
  };

  // Post a comment as the selected author (the "acting as" picker).
  const [commentText, setCommentText] = useState("");
  const commentDraft = useDraft(`comment:${postId}`, commentText, setCommentText);
  const [posting, setPosting] = useState(false);
  const postComment = async () => {
    const text = commentText.trim();
    if (!text) return;
    setPosting(true);
    try {
      const res = await fetch("/api/marketing-hub/comments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, authorKey: author, body: text }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); onError((j as { error?: string }).error || "couldn't post that comment"); return; }
      setCommentText(""); commentDraft.clear();
      await reload();
    } finally { setPosting(false); }
  };

  // Unified activity feed — edits + comments, filterable (Airtable-style). The
  // filter sits alone at the top, the feed runs full width beneath it, the comment
  // box closes it off.
  return (
    <div>
      <div className="flex items-center mb-3 px-1">
      <div className="relative">
        <button ref={feedFilterBtnRef} onClick={() => setFeedFilterOpen((v) => !v)} className="text-[11px] text-gray-500 hover:text-gray-800 flex items-center gap-1 border border-gray-200 rounded-md px-2 py-1">
          {feedFilter === "all" ? "All activity" : feedFilter === "revisions" ? "Revision history" : "Comments"}
          <IconChevronDown size={12} />
        </button>
        <PortalMenu open={feedFilterOpen} onClose={() => setFeedFilterOpen(false)} anchorRef={feedFilterBtnRef} align="right">
          <div className="w-52 bg-white border border-gray-100 rounded-lg shadow-lg py-1 text-[14px]">
            {(([["all", "All activity"], ["revisions", "Revision history"], ["comments", "Comments"]]) as [typeof feedFilter, string][]).map(([v, l]) => (
              <button key={v} onClick={() => { setFeedFilter(v); setFeedFilterOpen(false); }} className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 flex items-center justify-between ${feedFilter === v ? "text-brand font-medium" : "text-gray-700"}`}>{l}{feedFilter === v && <IconCheck size={13} />}</button>
            ))}
            <div className="border-t border-gray-100 my-1" />
            <button onClick={() => setShowResolved((s) => !s)} className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex items-center justify-between text-gray-700">Show resolved comments{showResolved && <IconCheck size={13} />}</button>
          </div>
        </PortalMenu>
      </div>
      </div>
      {loading ? <LoadingBlock className="!py-6" size={28} />
        : feed.length === 0 ? <div className="text-sm text-gray-400 italic py-2">No activity yet.</div>
        : (
          <div>
            {/* The rail. It sits under the avatars, which each carry a white
                ring so the line reads as a series of stops rather than one
                unbroken stroke. */}
            <div className="relative">
              <div className="absolute left-3 top-3 bottom-3 w-px bg-gray-300" aria-hidden />
              <div className="space-y-5 relative">
            {[...groupedFeed].reverse().map((entry, gIdx) => {
              if (entry.type === "group") return renderGroup(entry, gIdx === 0);
              const it = entry.it;
              const av = feedAvatar(it.key, it.name);
              const isLatest = gIdx === 0;
              const stFrom = it.kind === "activity" && PILL_FIELDS.has(it.action) ? calStatusStyle(it.from || "") : null;
              const stTo = it.kind === "activity" && PILL_FIELDS.has(it.action) ? calStatusStyle(it.to || "") : null;
              return (
                <div key={it.id} className="flex gap-2.5">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-semibold flex-shrink-0 mt-0.5 ring-[3px] ring-white relative z-10" style={{ background: av.bg, color: av.fg }} title={av.system ? "System / imported" : properName(it.name)}>{av.system ? <IconHistory size={11} /> : av.initials}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] text-gray-700">
                      <span className="font-medium text-[#232D42]">{av.system ? (it.kind === "activity" && PUBLISHER_ACTIONS.has(it.action) ? "Publisher" : "System") : properName(it.name)}</span>{" "}
                      {it.kind === "comment" ? "commented" : (ACT_VERB[it.action] || it.action.replace(/_/g, " "))}
                      <span className="text-gray-400" title={new Date(it.at).toLocaleString("en-IN")}> · {relTime(it.at)}</span>
                      {/* The top of the timeline is where it is up to, so say
                          so rather than making people work it out from the times. */}
                      {isLatest && <span className="ml-1.5 text-[10px] bg-brand-light text-[#2138B0] px-1.5 py-0.5 rounded-full font-medium">latest</span>}
                      {it.kind === "comment" && it.resolved && <span className="ml-1.5 text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full">resolved</span>}
                    </div>
                    {it.kind === "comment" ? (
                      <div className="text-[14px] text-gray-800 whitespace-pre-wrap mt-0.5" data-ref-preview data-ref-from="Comment">{linkify(it.body || "")}</div>
                    ) : stFrom || stTo ? (
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {it.from && <span className="text-[11px] px-2 py-0.5 rounded-full line-through" style={{ background: stFrom!.bg, color: stFrom!.text }}>{it.from}</span>}
                        {it.from && it.to && <IconChevronRight size={12} className="text-gray-400" />}
                        {it.to && <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: stTo!.bg, color: stTo!.text }}>{it.to}</span>}
                      </div>
                    ) : it.kind === "activity" && FILE_EVENT.test(it.action) ? (() => {
                      const name = it.to || it.from || "";
                      const f = (detail?.attachments || []).find((x) => x.filename === name) || (detail?.trashedFiles || []).find((x) => x.filename === name);
                      return <FileChange name={name} url={f?.storage_path || undefined} thumb={(f as { thumb_path?: string | null } | undefined)?.thumb_path} mime={f?.mime_type || undefined} removed={it.action.endsWith("_removed")} />;
                    })() : it.kind === "activity" && LINK_FIELDS.has(it.action) ? (
                      <LinkChange from={it.from || null} to={it.to || null} />
                    ) : DIFF_FIELDS.has(it.action) ? (
                      <div className="mt-1">
                        {expandedDiffs.has(it.id) && <div className="text-[14px] border border-gray-100 rounded-lg p-2 bg-gray-50/60 mb-1">{wordDiff(it.from || "", it.to || "")}</div>}
                        <button onClick={() => setExpandedDiffs((s) => { const n = new Set(s); if (n.has(it.id)) n.delete(it.id); else n.add(it.id); return n; })} className="text-[11px] text-brand hover:underline">{expandedDiffs.has(it.id) ? "Hide changes" : "Show what changed"}</button>
                      </div>
                    ) : (it.from || it.to) ? (
                      <div className="text-[12px] mt-0.5">
                        {it.from && <span className="line-through text-red-500">{it.from}</span>}
                        {it.from && it.to && <span className="text-gray-400"> → </span>}
                        {it.to && <span className="text-emerald-700">{it.to}</span>}
                      </div>
                    ) : null}
                    {/* Why a date moved / why a request was declined (22 Oct). */}
                    {it.kind === "activity" && it.note && it.note.trim() !== "—" && <div className="text-[12px] text-[#4A5468] mt-1 bg-[#F6F7FB] rounded-md px-2 py-1">Reason: {it.note}</div>}
                  </div>
                </div>
              );
            })}
              </div>
            </div>
            {/* Older entries are BELOW now, so the button that reveals them is too. */}
            {feed.length > feedLimit && (
              <button onClick={() => setFeedLimit((l) => l + 25)} className="text-[12px] text-brand hover:underline mt-4">
                Show earlier activity ({feed.length - feedLimit})
              </button>
            )}
          </div>
        )}

      {/* Composer — account-specific: comments + edits are stamped with the
          logged-in user (no manual picker). Extra spacing so the section breathes. */}
      <div className="mt-5 pt-4 border-t border-gray-100 space-y-2">
        <div className="flex items-center gap-1.5 text-[11.5px] text-gray-500">
          {(() => { const a = feedAvatar(author, authorLabel(author)); return <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold" style={{ background: a.bg, color: a.fg }}>{a.initials}</span>; })()}
          <span>Commenting as <span className="font-medium text-[#232D42]">{authorLabel(author)}</span></span>
        </div>
        <div className="flex items-start gap-2.5">
          {(() => { const a = feedAvatar(author, authorLabel(author)); return <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0" style={{ background: a.bg, color: a.fg }}>{a.initials}</span>; })()}
          <div className="flex-1 min-w-0">
            <textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} rows={3}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); postComment(); } }}
              placeholder="Leave a comment…  (⌘/Ctrl + Enter to post)"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-[14.5px] resize-none outline-none focus:border-brand" />
            {commentDraft.restored && <div className="text-[11.5px] text-[#8A92A6] mt-1">Restored your unsaved draft · <button type="button" className="text-brand hover:underline" onClick={commentDraft.discard}>Discard</button></div>}
            <div className="flex justify-end mt-2">
              <button onClick={postComment} disabled={posting || !commentText.trim()}
                className="bg-brand text-white text-[12px] font-medium rounded-lg px-4 py-1.5 hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed">
                {posting ? "Posting…" : "Comment"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// From here on the creative is the thing to look at — the file preview opens on it.
const OUTPUT_STAGES = new Set(["Output - Ready", "Ready to Publish", "Published/Scheduled"]);

export function DetailModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  // Refused save → the shared missing-fields popup (422) or a visible toast.
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [lightbox, setLightbox] = useState<{ items: Creative[]; index: number } | null>(null);
  // "Which live post is this?" — see app/api/marketing-hub/link-suggest.
  type LinkCandidate = { id: string; url: string; caption: string; timestamp: string | null; score: number };
  type LinkPick = { key: "instagram" | "facebook" | "linkedin"; label: string; field: string; candidates: LinkCandidate[] };
  const [linkHunt, setLinkHunt] = useState<{ state: "idle" | "looking" | "done"; note: string; picks: LinkPick[] }>({ state: "idle", note: "", picks: [] });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadDetail = async () => {
    setLoadingDetail(true);
    try { const r = await fetch(`/api/marketing-hub/task-detail?id=${row.id}`); setDetail(r.ok ? await r.json() : null); }
    catch { setDetail(null); }
    finally { setLoadingDetail(false); }
  };
  useEffect(() => { loadDetail(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [row.id]);

  // Ctrl+Z for the edits made in this panel (see preview/Undo.tsx).
  const { record: recordUndo } = useUndo();
  // The task-detail endpoint does not return priority, so the only copy is the one
  // on the board row — and that does not refresh while the panel is open. Changing
  // the priority therefore left the pill showing the OLD value until the board
  // reloaded, and would have had undo record a stale "previous" if you changed it
  // twice. Hold what we last set, and drop it the moment the row catches up.
  const [prioritySet, setPrioritySet] = useState<string | null>(null);
  useEffect(() => { setPrioritySet(null); }, [row.priority]);
  const priorityCur = prioritySet ?? row.priority;
  const content = (detail?.content || row.content || "").trim();
  const caption = (detail?.caption ?? row.caption ?? "").trim();
  const notes = (detail?.notes || row.additionalInfo || "").trim();

  const collaborators = detail?.collaborators?.length ? detail.collaborators : null;
  // The SAVED status once the detail has loaded, falling back to the board row.
  // Reading row.status directly left the pill showing the old stage after a change
  // — it looked like nothing had happened (Manya, 23 Sep).
  const statusCur = detail?.status ?? row.status;
  const isDone = DONE_STATUSES.includes(statusCur) || !!row.completionTime;
  const sp = statusPill(statusCur);
  const pp = priorityPill(priorityCur);
  const uploaderKey = TEAM.find((m) => ownerMatches(row.owner, m))?.key || "maheen";
  // Account-specific: every comment + edit is stamped with the LOGGED-IN user
  // (detail.me from the session), never a manual picker. Whoever is signed in owns
  // the action, so the feed reads by their real name.
  const activeAuthor = (detail?.me && (detail.me === "maheen" || TEAM.some((m) => m.key === detail.me))) ? detail.me : "maheen";
  const AUTHOR_LABELS: Record<string, string> = { manya: "Manya", praveen: "Praveen", nikhil: "Nikhil", nandu: "Nandu", maheen: "Maheen" };
  const authorLabel = (k: string) => AUTHOR_LABELS[k] || TEAM.find((m) => m.key === k)?.label || k;

  // Editable post URLs + platforms (Instagram / Facebook / LinkedIn). Read fresh
  // from detail after a save, falling back to the list row.
  const igUrl = detail?.instagramUrl ?? row.instagramUrl ?? "";
  const fbUrl = detail?.facebookUrl ?? row.facebookUrl ?? "";
  const liUrl = detail?.linkedinUrl ?? row.linkedinUrl ?? "";
  const platformsCur = detail?.platforms ?? row.platforms ?? [];
  const [statusEdit, setStatusEdit] = useState(false);
  const [priorityEdit, setPriorityEdit] = useState(false);
  // Owner was display-only, so nobody could hand a video back to the editors — "give
  // me option to change owner to claim pool" (Nandu, 9 Oct). Same local override as
  // priority: the board row doesn't refresh while the panel is open.
  // Title, format and SBU are edited in the header, freely, as in Airtable — "there
  // is no option to change the content heading or the content format … neither the
  // SBU" (Manya, 10 Oct). Local values, like priority: the row doesn't refresh.
  const sbuList = useSbus();
  const [titleSet, setTitleSet] = useState<string | null>(null);
  const [sbuSet, setSbuSet] = useState<string | null>(null);
  const [typeSet, setTypeSet] = useState<string | null>(null);
  useEffect(() => { setTitleSet(null); setSbuSet(null); setTypeSet(null); }, [row.id, row.particulars, row.sbu, row.type]);
  const titleCur = titleSet ?? row.particulars ?? "";
  const sbuCur = sbuSet ?? row.sbu ?? "";
  const typeCur = typeSet ?? row.type ?? "";
  const [titleDraft, setTitleDraft] = useState(titleCur);
  useEffect(() => { setTitleDraft(titleCur); }, [titleCur]);
  const saveTitle = async () => {
    const v = titleDraft.trim();
    if (!v || v === titleCur) { setTitleDraft(titleCur); return; }
    setTitleSet(v);
    await saveOne("particulars", v, { value: titleCur, label: "Task name" });
  };
  const changeSbu = async (v: string) => {
    if (!v || v === sbuCur) return;
    setSbuSet(v);
    await saveOne("sbu", v, { value: sbuCur, label: "SBU" });
  };
  // An editor picked as owner while this was still design work — the database keeps
  // it with Praveen and remembers the editor (custom.intended_owner) for when the
  // format becomes a video type (sql/design_owner_remembers_editor).
  // What the last save returned (the ownership rule can change owner and custom).
  const [savedCustom, setSavedCustom] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { setSavedCustom(null); }, [row.id]);
  const customNow = savedCustom ?? row.custom ?? {};
  const rememberedKey = typeof customNow.intended_owner === "string" ? customNow.intended_owner : "";
  const rememberedEditor = rememberedKey ? (TEAM.find((m) => m.key === rememberedKey)?.label || rememberedKey) : "";
  const [guideOpen, setGuideOpen] = useState(false);
  const approvalHint = useApprovalHint(typeCur, sbuCur);
  const changeType = async (v: string) => {
    if (!v || v === typeCur) return;
    // Past approval the type decides who produces it — a database rule hands design
    // work to Praveen — so a video ↔ design switch there moves the task. Say so first.
    const handedOn = !["Content - Pending", "Content - In Progress", "Content - Needs Approval"].includes(statusCur || "");
    if (handedOn && isVideoType(v) !== isVideoType(typeCur)) {
      const ok = await confirmDialog({
        title: `Change to ${v}?`,
        body: isVideoType(v)
          ? (rememberedEditor ? `This is approved, so it goes to ${rememberedEditor} (picked as owner earlier).` : "This is approved, so it goes to the video editors' claim pool.")
          : `This is approved, so it is handed to ${approvalHintFor(await loadHintRules(), v, sbuCur).who || "Praveen"} as design work.`,
        action: "Change format",
      });
      if (!ok) return;
    }
    setTypeSet(v);
    await saveOne("type", v, { value: typeCur, label: "Format" });
  };
  // Show the owner (and remembered editor) the server actually saved.
  const showSavedOwner = (f?: { owner_key?: string | null; custom?: Record<string, unknown> | null }) => {
    if (!f) return;
    if ("owner_key" in f) { const k = f.owner_key || ""; setOwnerSet({ key: k, label: k ? (TEAM.find((m) => m.key === k)?.label || k) : "" }); }
    if (f.custom) setSavedCustom(f.custom);
  };
  const [ownerEdit, setOwnerEdit] = useState(false);
  const [ownerSet, setOwnerSet] = useState<{ key: string; label: string } | null>(null);
  useEffect(() => { setOwnerSet(null); }, [row.owner]);
  const ownerKeyCur = ownerSet ? ownerSet.key : (TEAM.find((m) => ownerMatches(row.owner, m))?.key ?? "");
  const ownerLabelCur = ownerSet ? ownerSet.label : row.owner;
  // The pool takes approved videos only (app/api/my-day); one already under way goes
  // back to Content - Approved, which also stops its clock.
  const poolable = isVideoType(row.type) && (statusCur === "Content - Approved" || statusCur === "Output - In Progress");
  const POOL = "__pool";
  const changeOwner = async (to: string) => {
    setOwnerEdit(false);
    if (to === ownerKeyCur) return;
    const toPool = to === POOL;
    const fields: Record<string, unknown> = { owner_key: toPool || !to ? null : to };
    if (toPool && statusCur !== "Content - Approved") fields.status = "Content - Approved";
    const res = await fetch("/api/marketing-hub/update", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, actor: activeAuthor, fields }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const block = gateFromResponse(res.status, j, row.particulars || "This task");
      setFailure(block ? { kind: "gate", block } : { kind: "error", message: (j as { error?: string }).error || `HTTP ${res.status}` });
      return;
    }
    const ok = await res.json().catch(() => ({})) as { warning?: string; fields?: { owner_key?: string | null; custom?: Record<string, unknown> | null } };
    // The ownership rule may have kept it with Praveen — show the owner that was saved.
    showSavedOwner(ok.fields ?? { owner_key: toPool ? null : to });
    if (ok.warning) alertDialog("Owner", ok.warning);
    if (toPool) showToast({ who: "Back in the claim pool", body: "Nikhil and Nandu have been told.", color: "#3A57E8", av: "✓" });
    await loadDetail();
  };
  const [urlEdit, setUrlEdit] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState("");
  // `prev` is passed ONLY where the caller genuinely knows the old value. An undo
  // that writes a guessed "previous" over a real one is worse than no undo at all,
  // so a save without it simply is not recorded.
  const saveOne = async (field: string, value: unknown, prev?: { value: unknown; label: string }) => {
    const res = await fetch("/api/marketing-hub/update", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, actor: activeAuthor, fields: { [field]: value } }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      // 422 = a completeness gate. Name the missing fields rather than alerting
      // the one-line summary and dropping the list on the floor.
      const block = gateFromResponse(res.status, j, row.particulars || "This task");
      if (block) setFailure({ kind: "gate", block });
      else setFailure({ kind: "error", message: (j as { error?: string }).error || `HTTP ${res.status}` });
      return;
    }
    // e.g. a format change that moved the task to the claim pool / an editor.
    const okBody = await res.json().catch(() => ({})) as { warning?: string; fields?: { owner_key?: string | null; custom?: Record<string, unknown> | null } };
    if (okBody.warning) alertDialog("Owner", okBody.warning);
    showSavedOwner(okBody.fields);
    await loadDetail();
    // Recorded only once the server has taken it, so Ctrl+Z can never offer to undo
    // something that was refused.
    if (prev) {
      const write = async (v: unknown) => {
        const r = await fetch("/api/marketing-hub/update", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: row.id, actor: activeAuthor, fields: { [field]: v } }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setFailure({ kind: "error", message: (j as { error?: string }).error || `Couldn't undo — HTTP ${r.status}` });
          return false;
        }
        // Undo is a write like any other, so the panel has to follow it — otherwise
        // the row goes back and the pill keeps showing what you had just set.
        if (field === "priority") setPrioritySet(v == null ? null : String(v));
        await loadDetail();
        return true;
      };
      recordUndo({
        label: `${prev.label}: ${String(prev.value ?? "—")} → ${String(value ?? "—")}`,
        undo: () => write(prev.value),
        redo: () => write(value),
      });
    }
  };
  // Filling a published link is NOT an ordinary field edit: it also means the post is
  // live, so published_at gets stamped and the read cache is busted. Going through the
  // same seam the publishers and the nightly job use is what stops two kinds of linked
  // task existing — one stamped, one not, depending on who filled it.
  const saveLink = async (platform: "instagram" | "facebook" | "linkedin", url: string) => {
    const res = await fetch("/api/scheduler/link-back", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: row.id, platform, url, actor: activeAuthor }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setFailure({ kind: "error", message: (j as { error?: string }).error || `HTTP ${res.status}` });
      return;
    }
    await loadDetail();
  };
  // Everyone on the roster who is not already on this task, and not its owner —
  // owner and collaborator are different jobs, never the same person.
  const addableCollaborators = TEAM.filter((m) =>
    !(collaborators || []).some((c) => c.key === m.key) && !ownerMatchesKey(row.owner || "", m.key));
  const postCollaborators = async (method: "POST" | "DELETE", memberKey: string) => {
    const url = method === "DELETE"
      ? `/api/marketing-hub/collaborators?postId=${encodeURIComponent(row.id)}&memberKey=${encodeURIComponent(memberKey)}`
      : "/api/marketing-hub/collaborators";
    const res = await fetch(url, method === "DELETE" ? { method } : {
      method, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: row.id, memberKey }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setFailure({ kind: "error", message: (j as { error?: string }).error || `HTTP ${res.status}` });
      return;
    }
    await loadDetail();
  };
  const addCollaborator = (memberKey: string) => postCollaborators("POST", memberKey);
  const removeCollaborator = (memberKey: string) => postCollaborators("DELETE", memberKey);
  const togglePlatform = (p: string) => {
    const next = platformsCur.includes(p) ? platformsCur.filter((x) => x !== p) : [...platformsCur, p];
    saveOne("platforms", next);
  };
  const platformChips = Array.from(new Set(["Instagram", "Facebook", "LinkedIn", ...platformsCur]));
  // Ask the server which live posts this task is — Instagram, Facebook and LinkedIn
  // together, because a task usually goes out on more than one and each has its own
  // link to find. A certain answer is applied straight away; that is the whole point,
  // nobody should have to paste a link they already published. An uncertain one is
  // offered as a list instead of guessed, because a wrong link looks right and so
  // never gets re-checked.
  const PLATFORMS: { key: "instagram" | "facebook" | "linkedin"; label: string; field: string }[] = [
    { key: "instagram", label: "Instagram", field: "instagram_url" },
    { key: "facebook", label: "Facebook", field: "facebook_url" },
    { key: "linkedin", label: "LinkedIn", field: "linkedin_url" },
  ];
  const findPublishedPost = async () => {
    setLinkHunt({ state: "looking", note: "", picks: [] });
    try {
      const r = await fetch(`/api/marketing-hub/link-suggest?id=${row.id}`, { cache: "no-store" });
      type PlatformRes = { alreadyLinked?: string; reason?: string; scanned?: number; confident?: LinkCandidate | null; candidates?: LinkCandidate[] };
      const j = await r.json() as Record<string, PlatformRes> & { error?: string; reason?: string };
      if (!r.ok) { setLinkHunt({ state: "done", note: j.error || `Couldn't look it up (HTTP ${r.status}).`, picks: [] }); return; }
      if (j.reason === "no-publishing-date") { setLinkHunt({ state: "done", note: "No publishing date on this task, so there's nothing to search around.", picks: [] }); return; }
      if (j.reason === "no-account-for-brand") { setLinkHunt({ state: "done", note: "This Primary Interest doesn't go out on any of our accounts.", picks: [] }); return; }

      const linked: string[] = [];
      const picks: LinkPick[] = [];
      const searchedNothing: string[] = [];   // we looked and there was no match
      const notApplicable: string[] = [];     // we could not look at all
      for (const pf of PLATFORMS) {
        const res = j[pf.key];
        if (!res || res.alreadyLinked) continue;          // nothing to do for this one
        if (res.confident) {
          // Applied one at a time so each write is its own logged change, exactly as
          // if a person had pasted it.
          await saveLink(pf.key, res.confident.url);
          linked.push(pf.label);
        } else if (res.candidates && res.candidates.length) {
          picks.push({ ...pf, candidates: res.candidates });
        } else if (res.reason) {
          // "This brand has no LinkedIn page" is not the same as "we searched and
          // found nothing" — saying the second when the first is true claims a search
          // that never happened, and sends someone hunting for a post that cannot exist.
          notApplicable.push(pf.label);
        } else {
          searchedNothing.push(pf.label);
        }
      }
      const parts: string[] = [];
      if (linked.length) parts.push(`Linked ${linked.join(" and ")}.`);
      if (picks.length) parts.push(`Not certain on ${picks.map((x) => x.label).join(" and ")} — pick the right post:`);
      if (searchedNothing.length) parts.push(`Nothing matching on ${searchedNothing.join(" or ")} around this date.`);
      if (notApplicable.length) parts.push(`This brand doesn't post on ${notApplicable.join(" or ")}.`);
      if (!parts.length) parts.push("Everything already has a link.");
      setLinkHunt({ state: "done", note: parts.join(" "), picks });
    } catch (e) {
      setLinkHunt({ state: "done", note: e instanceof Error ? e.message : String(e), picks: [] });
    }
  };

  const urlRow = (field: string, label: string, value: string, Icon?: typeof IconBrandInstagram) => (
    // Read left to right: the label, then the link right after it — not pushed to the
    // far edge with a gap in the middle (Praveen, 22 Oct).
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0 text-[14px]">
      <span className="text-[#8A92A6] flex items-center gap-2 flex-shrink-0 w-[104px] pt-1">{Icon && <Icon size={16} stroke={1.8} />}{label}</span>
      {urlEdit === field ? (
        <span className="flex-1 flex items-center gap-1 min-w-0">
          <input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} autoFocus placeholder="Paste URL…"
            onKeyDown={(e) => { if (e.key === "Enter") { setUrlEdit(null); saveOne(field, urlDraft.trim() || null); } if (e.key === "Escape") setUrlEdit(null); }}
            className="flex-1 min-w-0 border border-gray-200 rounded px-1.5 py-1 text-[13px] outline-none focus:border-brand" />
          <button onClick={() => { setUrlEdit(null); saveOne(field, urlDraft.trim() || null); }} className="text-brand flex-shrink-0"><IconCheck size={14} /></button>
        </span>
      ) : value ? (
        <span className="flex items-start gap-1.5 min-w-0 flex-1">
          {/* The whole link, in a box, opening on click — not a bare "Open" (Praveen, 21 Oct). */}
          {/* Several pages = several links in one field (" , "); one box each. */}
          <span className="flex flex-col gap-1.5 min-w-0" data-ref-preview data-ref-from="Published post">
            {value.split(/\s*,\s*(?=https?:)/).map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" title="Open in a new tab"
                className="min-w-0 break-all rounded-lg border border-gray-100 bg-[#F7F8FC] px-2 py-1 text-[13px] leading-[18px] text-brand hover:border-brand hover:underline">{u}</a>
            ))}
          </span>
          <button onClick={() => { setUrlDraft(value); setUrlEdit(field); }} className="text-gray-400 hover:text-brand flex-shrink-0"><IconPencil size={12} /></button>
        </span>
      ) : (
        <button onClick={() => { setUrlDraft(""); setUrlEdit(field); }} className="text-gray-400 hover:text-brand pt-1">+ Add</button>
      )}
    </div>
  );

  // Attachments split by kind: creatives (the deliverable), references (mood-board)
  // and attachments (working files, never published — Manya, 10 Oct).
  const attMap = (a: DetailAttachment) => ({ id: a.id as string | undefined, url: a.storage_path, name: a.filename, type: a.mime_type || "", removable: true, thumb: a.thumb_path || null });
  const creatives = [
    ...(detail?.attachments || []).filter((a) => a.kind !== "reference" && a.kind !== "attachment" && a.kind !== "thumbnail").map(attMap),
    ...row.attachments.map((a) => ({ id: undefined as string | undefined, url: a.url, name: a.filename, type: a.type || "", removable: false, thumb: null })),
  ];
  const refImages = (detail?.attachments || []).filter((a) => a.kind === "reference").map(attMap);
  const workFiles = (detail?.attachments || []).filter((a) => a.kind === "attachment").map(attMap);
  // A reel's cover (docs/REEL_THUMBNAIL_SPEC.md): its own Thumbnail box, newest first;
  // the linked thumbnail task's image stands in while it's empty.
  const isReelTask = /reel/i.test(typeCur) && !/thumbnail/i.test(typeCur);
  const ownThumb = [...(detail?.attachments || [])].reverse().find((a) => a.kind === "thumbnail") || null;
  const shownThumb = ownThumb ? attMap(ownThumb) : detail?.linkedThumbnail ? { id: undefined as string | undefined, url: detail.linkedThumbnail.storage_path, name: `${detail.linkedThumbnail.filename} (thumbnail task)`, type: "image/", removable: false, thumb: null } : null;
  const bigVideos = (detail?.attachments || []).filter((a) => a.kind === "creative" && /^video\//.test(a.mime_type || "") && (a.size_bytes || 0) > 300 * 1024 * 1024);
  // A task opens with its files already showing, small, between the content and
  // History (Praveen, 26 Oct): the CREATIVES once the output is ready (that's what
  // people open it to look at), else the attachments. Neither → no column.
  const contentCol = useRef<HTMLDivElement | null>(null);
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !detail || !contentCol.current) return;
    autoOpened.current = true;
    const asItems = (fs: { url: string; name: string }[], from: string) => fs.filter((f) => f.url).map((f) => ({ url: f.url, title: f.name, from }));
    const cre = OUTPUT_STAGES.has(String(statusCur)) ? asItems(creatives, "Creatives") : [];
    // Slides first, the LinkedIn PDF last — it opens on slide 1, not on the PDF (27 Oct).
    cre.sort((x, y) => Number(/\.pdf(\?|#|$)/i.test(x.url.split("?")[0])) - Number(/\.pdf(\?|#|$)/i.test(y.url.split("?")[0])));
    const items = cre.length ? cre : asItems(workFiles, "Attachments");
    if (items.length) openRefPreview(items, 0, contentCol.current);
  }, [detail]); // eslint-disable-line react-hooks/exhaustive-deps
  const refLinks = detail?.referenceLinks ?? [];

  // One upload queue per section (22 Oct): tiles/progress show at once, files go up in
  // number order, and a name already on the task is called out first. Same compression
  // the composer uses — a 5 MB slide export helps nobody.
  const qOpts = { postId: row.id, uploadedBy: uploaderKey, onSaved: () => { loadDetail(); }, prepare: compressImage,
    onError: (name: string, msg: string) => setFailure({ kind: "error", message: `${name}: ${msg}` }) };
  const qCre = useUploadQueue({ ...qOpts, kind: "creative", existing: creatives.map((c) => c.name) });
  const qRef = useUploadQueue({ ...qOpts, kind: "reference", existing: refImages.map((c) => c.name) });
  const qAtt = useUploadQueue({ ...qOpts, kind: "attachment", existing: workFiles.map((c) => c.name) });
  // A new thumbnail replaces the old one (to the Recycle bin) — the reel has one cover.
  const qThumb = useUploadQueue({ ...qOpts, kind: "thumbnail", existing: [],
    onSaved: async () => { if (ownThumb?.id) await removeTaskFile(ownThumb.id, "Replaced by a new thumbnail"); loadDetail(); } });
  const upload = (files: FileList | File[], kind: "creative" | "reference" | "attachment" = "creative") =>
    (kind === "reference" ? qRef : kind === "attachment" ? qAtt : qCre).add(files);
  const uploading = qCre.busy || qRef.busy || qAtt.busy;
  const removeCreative = async (id: string, why?: string) => {
    const res = await removeTaskFile(id, why);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setFailure({ kind: "error", message: (j as { error?: string }).error || "couldn't remove that file" }); return; }
    await loadDetail();
  };
  // Paste a copied image straight into the task — "I have to download and then upload
  // the images. Please also give copy paste option" (Manya, 16 Oct). It lands in the
  // section the pointer was last over (Creatives unless References / Attachments).
  const pasteKind = useRef<"creative" | "reference" | "attachment">("creative");
  const onPasteFiles = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/") || pasteKind.current === "attachment");
    if (!files.length) return;   // ordinary text paste — leave it alone
    // Pasting while typing in the brief, caption or a comment belongs to that field —
    // a screenshot pasted into the brief was silently uploaded as an attachment (26 Oct).
    const tgt = e.target as HTMLElement;
    if (tgt.isContentEditable || tgt.closest?.("[contenteditable=true], input, textarea")) return;
    e.preventDefault();
    // A screenshot pastes as "image.png" every time; give it a name worth keeping.
    const d = new Date(), p2 = (x: number) => String(x).padStart(2, "0");
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const named = files.map((f, i) => (/^image\.(png|jpe?g|gif|webp)$/i.test(f.name) ? new File([f], `pasted-${stamp}${files.length > 1 ? `-${i + 1}` : ""}.${f.name.split(".").pop()}`, { type: f.type }) : f));
    upload(named, pasteKind.current);
  };
  const removeRefLink = async (link: string) => { await saveOne("reference_links", refLinks.filter((l) => l !== link)); };
  // Content and Caption are always editable (RichTextField) and save themselves —
  // "remove both edit and save button" (Manya, 10 Oct). Saving writes to mh_posts,
  // which the activity trigger records (content_edited / caption_edited).
  const saveText = (field: "content" | "caption") => async (next: string) => {
    const res = await fetch("/api/marketing-hub/update", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, actor: activeAuthor, fields: { [field]: next } }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const block = gateFromResponse(res.status, j, row.particulars || "This task");
      setFailure(block ? { kind: "gate", block } : { kind: "error", message: (j as { error?: string }).error || `HTTP ${res.status}` });
      throw new Error("save refused");
    }
    loadDetail(); // the new Activity entry
  };
  // Until the first load lands, content may still be on its way from Airtable — an
  // empty box you could type into would then overwrite it.
  const firstLoad = loadingDetail && !detail;

  const detailRow = (label: string, value: React.ReactNode) => (
    <div className="flex items-start py-2">
      <span className="w-[174px] flex-shrink-0 text-[13px] text-[#565A62] pl-[30px] pt-[3px]">{label}</span>
      <span className="flex-1 min-w-0 text-[13px] text-[#1D1F25]">{value || <span className="text-gray-300">—</span>}</span>
    </div>
  );

  return (
    <>
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6 preview-scope" onClick={onClose}>
      <div className="hub-airtable bg-white rounded-lg w-full max-w-[1104px] h-[829px] max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()} onPaste={onPasteFiles}>
        {/* Header — Themed hero band: brand-tinted, large title */}
        <div className="relative flex items-start justify-between gap-4 pt-8 pr-5 pb-5 pl-[66px] border-b border-gray-100 flex-shrink-0 bg-white">
          
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} aria-label="Task name" placeholder="Task name"
                onBlur={saveTitle} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setTitleDraft(titleCur); e.currentTarget.blur(); } }}
                size={Math.max(12, titleDraft.length + 1)}
                className="hub-modal-title bg-transparent border border-transparent rounded-md -ml-1.5 px-1.5 outline-none hover:border-gray-200 focus:border-brand max-w-full" />
              {statusCur && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2.5 py-1" style={{ background: sp.bg, color: sp.text }}>
                  {isDone && <IconCheck size={12} stroke={2.5} />}{statusCur}
                </span>
              )}
              {row.needsReview && <span className="text-[11px] font-medium bg-amber-50 text-amber-700 rounded-full px-2.5 py-1">Needs review</span>}
            </div>
            <div className="flex items-center gap-2 mt-1 text-[13px] text-[#8A92A6] flex-wrap">
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: sbuColor(sbuCur, []) }} />
                <PreviewSelect bare value={sbuCur || ""} onChange={changeSbu} ariaLabel="SBU" title="Change the SBU" placeholder="— SBU"
                  options={Array.from(new Set([...(sbuCur ? [sbuCur] : []), ...sbuList])).map((o) => ({ value: o, label: o }))} />
              </span>
              <span className="text-gray-300">·</span>
              <PreviewSelect bare value={typeCur || ""} onChange={changeType} ariaLabel="Format" title="Change the format" placeholder="— format"
                options={Array.from(new Set([...(typeCur ? [typeCur] : []), ...ALL_TYPES])).map((o) => ({ value: o, label: o }))} />
              {typeCur && <span className="text-[11.5px] text-[#8A92A6]">({approvalHint.hint})</span>}
              <button type="button" onClick={() => setGuideOpen((o) => !o)} title="How tasks are assigned"
                className="w-[18px] h-[18px] rounded-full border border-gray-200 text-[11px] leading-none text-[#8A92A6] hover:text-brand hover:border-brand">?</button>
              <span className="text-gray-300">·</span><span className="inline-flex items-center gap-1"><IconCalendarEvent size={14} />Publishing {fmtDate(row.publishingDate)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <CopyTaskLink id={row.id} />
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
          </div>
        </div>

        {/* Body — light canvas so the white cards read as real sections.
            Creatives sits in the content column (compact), so the Details + Activity
            column reaches the top and the feed is visible without deep scrolling. */}
        {guideOpen && (
            <div className="mx-6 mb-2 rounded-xl border border-gray-100 bg-[#F7F8FC] px-3.5 py-3 text-[12.5px] text-[#4A5468] leading-relaxed">
              <div className="flex items-center justify-between mb-1"><b className="font-medium text-[#232D42]">How tasks are assigned</b><button type="button" onClick={() => setGuideOpen(false)} className="text-gray-400 hover:text-gray-700">×</button></div>
              <div>Design formats (Post, Carousel, Meta Ads, Story (Image), thumbnails) go to <b className="font-medium">Praveen</b> once approved.</div>
              <div>Video formats (Reels, YouTube, Story (Video), Meta Ads - Video) go to the <b className="font-medium">editors&apos; claim pool</b> once approved — Nikhil or Nandu claims it.</div>
              <div>Changing an approved task from design to video sends it to the claim pool — or straight to Nikhil / Nandu if you picked them as owner first. Video to design sends it to Praveen.</div>
              <div>A design task can&apos;t be given to anyone but Praveen; pick an editor and change the format to a video type, in either order.</div>
            </div>
          )}
        <div className="flex-1 flex min-h-0 bg-white">
          {/* A file opened from here previews between the content and History &
              comments (Praveen, 26 Oct) — the content column is the dock. */}
          <div ref={contentCol} className="flex-1 min-w-0 overflow-auto pl-[66px] pr-6 py-4" data-ref-dock data-ref-ratio="0.25">
            <div>
              {/* Content and Caption come FIRST.
                  "The entire content should appear in full when I open it" (Manya, 5 Oct,
                  asking a second time). Opening a task used to show the Creatives
                  drop-zone and an empty References box, with the writing itself below the
                  fold — so the one thing the record is actually about was the one thing
                  you could not see without scrolling.

                  This does reverse an earlier decision to sit References above Content as
                  a mood-board; the panels are all still here, in a different order. */}
              <Panel icon={IconFileText} title="Content">
                {firstLoad ? <LoadingBlock size={18} className="!py-2 !flex-row !justify-start !gap-2" label="Loading content…" />
                  : <RichTextField key={`c-${row.id}`} maxHeight={420} value={content} onSave={saveText("content")} placeholder="Write the content — slides, points, links…" />}
              </Panel>

              <Panel icon={IconMessageCircle2} title="Caption">
                {firstLoad ? <LoadingBlock size={18} className="!py-2 !flex-row !justify-start !gap-2" label="Loading caption…" />
                  : <RichTextField key={`k-${row.id}`} maxHeight={260} mode="plain" value={caption} onSave={saveText("caption")} placeholder="Write the post caption…" />}
              </Panel>

              {/* Creatives · References · Attachments — the same files card as My Day
                  (components/FilesCard), so a task's files look the same everywhere. */}
              <div className="space-y-3 py-2">
                <div onMouseOver={() => { pasteKind.current = "creative"; }}>
                  <FilesCard icon={<IconPhoto size={15} stroke={1.8} />} title="Creatives & files" drop numbered splitPdf askWhy zipName={`${row.particulars || "Task"} - creatives`}
                    count={`${creatives.length} file${creatives.length === 1 ? "" : "s"}${(detail?.outputLink ?? row.outputLink) ? " · 1 link" : ""}`}
                    accept="image/*,video/*,.pdf" onFiles={(f) => upload(f)} busyText={qCre.busy ? qCre.status : undefined}
                    tiles={creatives.map((c, i): FileTile => {
                      const k = creativeKind(c.name, c.type);
                      return { key: c.id || `${c.url}-${i}`, name: c.name, url: c.url, preview: c.thumb || undefined, kind: k,
                        onOpen: k === "image" || k === "video" ? () => setLightbox({ items: creatives, index: i }) : undefined,
                        onRemove: c.removable && c.id ? (why) => removeCreative(c.id!, why) : undefined };
                    })}
                    pending={qCre.pending} onDismiss={qCre.dismiss}
                    onRemoveAll={async (why, keys) => {
                      let failed = 0;
                      for (const c of creatives) if (c.removable && c.id && keys.includes(c.id) && !(await removeTaskFile(c.id, why)).ok) failed++;
                      if (failed) setFailure({ kind: "error", message: `${failed} file${failed === 1 ? "" : "s"} couldn't be removed — try those one by one` });
                      await loadDetail();
                    }}
                    onReorder={creatives.length > 1 && creatives.every((c) => c.id) ? async (ids) => {
                      const res = await reorderTaskFiles(row.id, ids);
                      if (!res.ok) { const j = await res.json().catch(() => ({})); setFailure({ kind: "error", message: (j as { error?: string }).error || "couldn't save the new order" }); }
                      await loadDetail();
                    } : undefined}
                    links={(detail?.outputLink ?? row.outputLink) ? [String(detail?.outputLink ?? row.outputLink)] : []} singleLink
                    linkPlaceholder="Paste the output link (Drive / Canva)…"
                    onAddLink={(v) => { saveOne("output_link", v); }} onRemoveLink={() => saveOne("output_link", null)} />
                  {/* Instagram takes videos up to 300 MB from outside its app (4 Nov). */}
                  {isReelTask && (bigVideos.length
                    ? <div className="text-[12px] text-[#C03221] mt-1.5 px-0.5">{bigVideos.map((a) => `${a.filename} is ${Math.round((a.size_bytes || 0) / 1048576)} MB`).join(" · ")} — over 300 MB, so it will post to Facebook only. Export it under 300 MB to post on Instagram too.</div>
                    : <div className="text-[12px] text-[#8A92A6] mt-1.5 px-0.5">Keep the video under 300 MB to post on Instagram and Facebook.</div>)}
                </div>
                {isReelTask && (
                  <div>
                    <FilesCard icon={<IconPhoto size={15} stroke={1.8} />} title="Thumbnail"
                      count={ownThumb ? "the reel's cover" : shownThumb ? "from the thumbnail task" : "the reel's cover · 1 image"}
                      accept="image/*" onFiles={(f) => qThumb.add([...f].slice(0, 1))} busyText={qThumb.busy ? qThumb.status : undefined}
                      addLabel={shownThumb ? "Replace" : "+ Add thumbnail"} addSub="one image" askWhy
                      tiles={shownThumb ? [{ key: shownThumb.id || shownThumb.url, name: shownThumb.name, url: shownThumb.url, preview: shownThumb.thumb || undefined, kind: "image",
                        onOpen: () => setLightbox({ items: [shownThumb], index: 0 }),
                        onRemove: shownThumb.removable && shownThumb.id ? (why) => removeCreative(shownThumb.id!, why) : undefined }] : []}
                      pending={qThumb.pending} onDismiss={qThumb.dismiss} />
                    <div className="text-[12px] text-[#8A92A6] mt-1.5 px-0.5">Used as the reel&apos;s cover when it&apos;s scheduled — Instagram and Facebook.</div>
                  </div>
                )}
                <div onMouseOver={() => { pasteKind.current = "reference"; }}>
                  <FilesCard icon={<IconBookmark size={15} stroke={1.8} />} title="References"
                    count={`${refImages.length} file${refImages.length === 1 ? "" : "s"} · ${refLinks.length} link${refLinks.length === 1 ? "" : "s"}`}
                    accept="image/*,video/*,.pdf" onFiles={(f) => upload(f, "reference")} busyText={qRef.busy ? qRef.status : undefined}
                    tiles={refImages.map((c, i): FileTile => {
                      const k = creativeKind(c.name, c.type);
                      return { key: c.id || `${c.url}-${i}`, name: c.name, url: c.url, preview: c.thumb || undefined, kind: k,
                        onOpen: k === "image" ? () => setLightbox({ items: refImages, index: i }) : undefined,
                        onRemove: c.id ? () => removeCreative(c.id!) : undefined };
                    })}
                    pending={qRef.pending} onDismiss={qRef.dismiss}
                    links={refLinks} linkPlaceholder="Paste a reference link…"
                    onAddLink={(v) => { saveOne("reference_links", [...refLinks, v]); }} onRemoveLink={(l) => removeRefLink(l)} />
                </div>
                {/* Working files that are never published — "references are different and
                    attachments are different" (Manya, 10 Oct). Same card, own section. */}
                <div onMouseOver={() => { pasteKind.current = "attachment"; }}>
                  <FilesCard icon={<IconPaperclip size={15} stroke={1.8} />} title="Attachments"
                    count={`${workFiles.length} file${workFiles.length === 1 ? "" : "s"} · never published`}
                    accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv" onFiles={(f) => upload(f, "attachment")} busyText={qAtt.busy ? qAtt.status : undefined}
                    tiles={workFiles.map((c, i): FileTile => ({ key: c.id || `${c.url}-${i}`, name: c.name, url: c.url, preview: c.thumb || undefined, kind: creativeKind(c.name, c.type),
                      onRemove: c.id ? () => removeCreative(c.id!) : undefined }))}
                    onReorder={workFiles.length > 1 && workFiles.every((c) => c.id) ? async (ids) => {
                      const res = await reorderTaskFiles(row.id, ids);
                      if (!res.ok) { const j = await res.json().catch(() => ({})); setFailure({ kind: "error", message: (j as { error?: string }).error || "couldn't save the new order" }); }
                      await loadDetail();
                    } : undefined}
                    pending={qAtt.pending} onDismiss={qAtt.dismiss} />
                </div>
              </div>

              {notes && (
                <Panel icon={IconFileDescription} title="Additional info">
                  <ClampBox maxHeight={260}><div data-ref-preview data-ref-from="Additional info" className="text-[14px] prose prose-sm max-w-none [&_*]:text-[14px]" dangerouslySetInnerHTML={{ __html: sanitizeRichText(notes) }} /></ClampBox>
                </Panel>
              )}

            </div>

                {/* Status is the field people come here to change, and it was display-only —
                    "I can't change the content status, options are not showing" (Manya, 23 Sep).
                    Click the pill to pick a stage; saveOne already surfaces the completeness
                    gates ("can't approve yet — X missing") and logs the change to Activity. */}
                {detailRow("Status", statusEdit ? (
                  <PreviewSelect defaultOpen size="sm" onClose={() => setStatusEdit(false)} value={statusCur || ""}
                    onChange={async (val) => { setStatusEdit(false); await saveOne("status", val, { value: statusCur, label: "Status" }); }}
                    options={Array.from(new Set([...(statusCur ? [statusCur] : []), ...STATUS_CHOICES])).map((o) => ({ value: o, label: o }))} />
                ) : (
                  <button onClick={() => setStatusEdit(true)} title="Change the status"
                    className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 hover:ring-1 hover:ring-brand/40"
                    style={statusCur ? { background: sp.bg, color: sp.text } : { background: "#F1F3F8", color: "#8A92A6" }}>
                    {isDone && <IconCheck size={11} stroke={2.5} />}{statusCur || "— set"}
                  </button>
                ))}
                {detailRow("Owner", ownerEdit ? (
                  <PreviewSelect defaultOpen size="sm" onClose={() => setOwnerEdit(false)} value={ownerKeyCur}
                    onChange={(val) => changeOwner(val)}
                    options={[poolable ? { value: POOL, label: "Nobody — put in claim pool" } : { value: "", label: "Nobody" }, ...TEAM.map((m) => ({ value: m.key, label: m.label }))]} />
                ) : (
                  <button onClick={() => setOwnerEdit(true)} title={poolable ? "Change the owner, or put it back in the claim pool" : "Change the owner"}
                    className="inline-flex items-center gap-1.5 rounded-full px-1 py-0.5 hover:ring-1 hover:ring-brand/40">
                    {ownerLabelCur ? (<><span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium" style={{ background: "#EEEDFE", color: "#3C3489" }}>{ownerLabelCur.trim().slice(0, 1).toUpperCase()}</span><span className="text-[13px] text-[#1D1F25]">{ownerLabelCur}</span></>)
                      : <span className="text-[12px] text-[#8A92A6]">{isVideoType(row.type) && statusCur === "Content - Approved" ? "In the claim pool" : "— set"}</span>}
                  </button>
                ))}
                {(() => {
                  const handed = !["Content - Pending", "Content - In Progress", "Content - Needs Approval"].includes(statusCur || "");
                  const note = !typeCur ? null
                    : !isVideoType(typeCur)
                      ? (rememberedEditor
                        ? `Stays with Praveen while it's design work — goes to ${rememberedEditor} when the format is changed to a video type.`
                        : handed ? `Went to ${approvalHint.who || "Praveen"} when it was approved. You can still change the owner and it will stay.`
                          : `Once approved, design work goes to ${approvalHint.who || "Praveen"}.`)
                      : handed ? "Video work: pick an editor, or leave it in the claim pool for Nikhil / Nandu."
                        : "Once approved, video work goes to the editors' claim pool.";
                  return note ? <div className="pl-[174px] -mt-1.5 pb-1 text-[11.5px] text-[#8A92A6]">{note}</div> : null;
                })()}
                {detailRow("Priority", priorityEdit ? (
                  <PreviewSelect defaultOpen size="sm" onClose={() => setPriorityEdit(false)} value={priorityCur || ""} placeholder="— set priority"
                    onChange={async (val) => {
                      setPriorityEdit(false);
                      if (!val) return;
                      const was = priorityCur;
                      setPrioritySet(val);
                      await saveOne("priority", val, { value: was, label: "Priority" });
                    }}
                    options={PRIORITY_CHOICES.map((o) => ({ value: o, label: o }))} />
                ) : (
                  <button onClick={() => setPriorityEdit(true)} title="Change the priority"
                    className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 hover:ring-1 hover:ring-brand/40"
                    style={priorityCur ? { background: pp.bg, color: pp.text } : { background: "#F1F3F8", color: "#8A92A6" }}>
                    {priorityCur || "— set"}
                  </button>
                ))}
                {detailRow("Publish to page", row.publishToPage)}
                {detailRow("Platforms", (
                  <div className="flex flex-wrap gap-1">
                    {platformChips.map((p) => {
                      const on = platformsCur.includes(p);
                      return <button key={p} onClick={() => togglePlatform(p)} className={`text-[10.5px] px-2 py-0.5 rounded-full border transition ${on ? "bg-brand-light text-brand border-brand/30" : "bg-white text-gray-400 border-gray-200 hover:border-gray-300"}`}>{p}</button>;
                    })}
                  </div>
                ))}
                {detailRow("Due date", fmtDate(row.dueDate))}
                {detailRow("Completed", row.completionTime ? fmtWhen(row.completionTime) : null)}
                {detailRow("Publishing", fmtDate(row.publishingDate))}
                {detailRow("Start", row.startAt ? fmtWhen(row.startAt) : null)}
                {detailRow("End", row.endAt ? fmtWhen(row.endAt) : null)}
                {row.startAt && row.endAt && detailRow("Time taken", durationBetween(row.startAt, row.endAt))}
                {detailRow("Created", row.createdDate ? fmtWhen(row.createdDate) : null)}
                {detailRow("Last modified", row.lastModified ? fmtWhen(row.lastModified) : null)}

              {/* Add and remove, not just read: "Give delete or add collaborator
                  button" (Nandu, 26 Sept). The API already did both — only the
                  controls were missing. Shown even with nobody on it yet, so the
                  first collaborator can be added from here too. */}
              <Panel icon={IconUsers} title="Collaborators">
                <div className="space-y-2">
                  {(collaborators || []).map((c) => (
                    <div key={c.key} className="flex items-center gap-2 text-[14px] group">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0" style={{ background: "#EEEDFE", color: "#3C3489" }}>{c.name.trim().slice(0, 1).toUpperCase()}</span>
                      <span className="text-[#232D42]">{c.name}</span>{c.role && <span className="text-[11px] text-gray-400">· {c.role}</span>}
                      <button onClick={() => removeCollaborator(c.key)} title={`Remove ${c.name}`}
                        className="ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-400 hover:text-rose-500 transition">
                        <IconX size={14} stroke={2} />
                      </button>
                    </div>
                  ))}
                  {!(collaborators || []).length && (
                    <div className="text-[13px] text-gray-400 italic">Nobody yet.</div>
                  )}
                  {addableCollaborators.length > 0 && (
                    <div className="pt-1">
                      <PreviewSelect value="" onChange={(k) => k && addCollaborator(k)}
                        placeholder="+ Add collaborator"
                        options={[{ value: "", label: "+ Add collaborator" }, ...addableCollaborators.map((m) => ({ value: m.key, label: m.label }))]} />
                    </div>
                  )}
                </div>
              </Panel>

              {/* Published-post links — its own section. Paste the live URL once published;
                  a weekly job can later find these + compress the creative images. */}
              <Panel icon={IconExternalLink} title="Published links">
                {urlRow("instagram_url", "Instagram", igUrl, IconBrandInstagram)}
                {urlRow("facebook_url", "Facebook", fbUrl, IconBrandFacebook)}
                {urlRow("linkedin_url", "LinkedIn", liUrl, IconBrandLinkedin)}
                {/* Offered whenever any of the three is still blank: the task went
                    out but nothing reported the link back, which is the normal case
                    for anything published from the apps rather than from here. */}
                {(!igUrl || !fbUrl || !liUrl) && (
                  <div className="pt-3 mt-1 border-t border-gray-50">
                    {linkHunt.state === "idle" ? (
                      <button onClick={findPublishedPost} className="text-[13px] text-brand hover:underline inline-flex items-center gap-1.5">
                        <IconSearch size={13} stroke={1.8} /> Find the published posts
                      </button>
                    ) : linkHunt.state === "looking" ? (
                      <div className="text-[13px] text-[#8A92A6]">Checking what actually went out…</div>
                    ) : (
                      <div className="space-y-3">
                        {linkHunt.note && <div className="text-[13px] text-[#8A92A6]">{linkHunt.note}</div>}
                        {linkHunt.picks.map((pick) => (
                          <div key={pick.key} className="space-y-1.5">
                            <div className="text-[11px] uppercase tracking-wide text-[#8A92A6] font-medium">{pick.label}</div>
                            {pick.candidates.map((c) => (
                              <button key={c.id}
                                onClick={async () => {
                                  await saveLink(pick.key, c.url);
                                  setLinkHunt((h) => ({ ...h, picks: h.picks.filter((x) => x.key !== pick.key), note: "Linked." }));
                                }}
                                className="block w-full text-left border border-gray-200 rounded-lg px-2.5 py-2 hover:border-brand transition">
                                <span className="block text-[13px] text-[#232D42] truncate">{c.caption || "(no caption)"}</span>
                                <span className="block text-[11px] text-[#8A92A6] mt-0.5">
                                  {c.timestamp ? new Date(c.timestamp).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—"}
                                </span>
                              </button>
                            ))}
                          </div>
                        ))}
                        <button onClick={() => setLinkHunt({ state: "idle", note: "", picks: [] })} className="text-[12px] text-[#8A92A6] hover:text-brand">Close</button>
                      </div>
                    )}
                  </div>
                )}
              </Panel>
          </div>
          <div className="mh-hist w-[287px] flex-shrink-0 border-l border-gray-100 overflow-auto px-2 py-4">

              <TaskActivityFeed postId={row.id} detail={detail} loading={loadingDetail} reload={loadDetail}
                author={activeAuthor} authorLabel={authorLabel} onError={(message) => setFailure({ kind: "error", message })} />
            </div>
          </div>
        </div>
      </div>
    {lightbox && lightbox.items[lightbox.index] && (
      <CreativeViewer creatives={lightbox.items} index={lightbox.index} setIndex={(n) => setLightbox((l) => l ? { items: l.items, index: n } : null)} onClose={() => setLightbox(null)} />
    )}
    <SaveFailureOverlay failure={failure} onClose={() => setFailure(null)} />
    </>
  );
}

function ModalLink({ label, href }: { label: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[13px] group">
      <span className="text-[#8A92A6] w-16 flex-shrink-0">{label}</span>
      <span className="text-brand group-hover:underline truncate">{href}</span>
    </a>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-sm mt-1">{value || "—"}</div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">{label}</div>
      {children}
    </div>
  );
}

function LinkRow({ label, href }: { label: string; href: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-500 w-20">{label}</span>
      <a href={href} target="_blank" rel="noreferrer" className="text-brand hover:underline truncate">{href}</a>
    </div>
  );
}

// The hub's own "+ New task" affordance. It only owns the button and the open/closed
// state — the form inside is the shared one, the same component My Day renders, so
// the two can't drift apart.
function HubNewTaskButton({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-brand text-white rounded-lg hover:bg-brand-dark transition px-4 py-2 text-sm font-medium flex items-center gap-1.5"
      >
        <span className="text-lg leading-none">+</span> New task
      </button>
      {open && <NewTaskDialog onClose={() => setOpen(false)} onCreated={onCreated} />}
    </>
  );
}
