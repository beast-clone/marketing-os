"use client";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { PreviewDatePicker } from "@/app/(dashboard)/dashboard/preview/PreviewDatePicker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconSunHigh, IconLayoutGrid, IconChartBar, IconCalendarEvent, IconWand, IconBrandInstagram, IconBrandLinkedin, IconBrandYoutube, IconBrandFacebook, IconUsers, IconSpeakerphone, IconSettings, IconPencil, IconArrowsExchange, IconTrash, IconLink, IconUpload, IconPaperclip, IconPin, IconBolt, IconFileText, IconHourglass, IconArrowsSort, IconX, IconHistory, IconReport, IconCheck, IconArrowRight, IconCircleCheck } from "@tabler/icons-react";
import { estimateTaskMinutes } from "@/lib/task-estimate";
import { CONTENT_TYPES, VIDEO_TYPES as VIDEO_TYPE_SET } from "@/lib/mh-content-types";
import { MemberHub } from "./MemberHub";
import { hasCapability, needsDateReason, type Capability, type Permissions } from "@/lib/permissions";
import MissingFieldsModal, { gateFromResponse, type GateBlock } from "../MissingFieldsModal";
import { useSbus } from "@/lib/use-sbus";
import { Overlay } from "../Overlay";
import { confirmDialog, promptDialog } from "../ConfirmDialog";
import { showToast } from "../Toast";
import { uploadTaskFile, removeTaskFile, reorderTaskFiles } from "@/lib/upload-task-file";
import { useUploadQueue } from "@/lib/use-upload-queue";
import { openRefPreview, closeRefPreview } from "@/components/RefPreview";
import { FilesCard, type FileTile } from "@/components/FilesCard";
import { useDraft } from "@/lib/use-draft";
import { isPdf } from "@/components/PdfThumb";
import { RichTextField } from "@/components/RichTextField";
import { ClampBox } from "@/components/ClampBox";
import { Markdown } from "@/components/Markdown";
import { playChime } from "../notifChime";
import { NOTIF_COUNT, NOTIF_CENTER } from "../NotificationHost";
import { notifIconFor } from "../NotifIcon";
import { Avatar, DatePicker, MenuDropdown, PendingAssets, PHOTOS, PPL, EMPTY_ASSET, usePplTeam, type Person, type PendingAsset, type NewTaskAssets } from "@/components/new-task/parts";
import { useTeam, mergeTeam, NEWCOMER_COLOR } from "@/lib/use-team";
import { NewTaskForm, routeFor, type NewTaskDraft } from "@/components/new-task/NewTaskForm";
import { assignThumbnail, attachThumbnailTask, releaseToPoolIfEditor } from "@/components/new-task/save";
import { MY_DAY_CSS as CSS } from "./myDayCss";
import { useRadarMissed, RadarMissedList, dayLabel } from "./RadarCrumb";
import { NOTIF_REFRESH } from "@/app/(dashboard)/dashboard/preview/NotificationHost";
import { TaskActivityFeed, properName } from "../marketing-hub/MarketingHub";
import { shouldPoll } from "@/lib/quiet-hours";
import { useOwnUndo } from "@/app/(dashboard)/dashboard/preview/Undo";
import { editPartnerOf, firstWithRole, isDesigner, isEditor as isEditorKey, isWriter, keysWithRole, presenterFor, roleOf, shiftStartMin, type WorkRole } from "@/lib/team-roles";
import { SETTINGS } from "@/lib/app-settings";
import { useAppSettings } from "@/lib/use-app-settings";
import { SoundVideo } from "@/components/SoundVideo";

function NavGroup({ label }: { label: string }) { return <div className="navgroup">{label}</div>; }

// Date/name formatting for the publish-date approvals portal.
const apprDate = (d?: string | null) => (d ? new Date(String(d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "unset");
const apprDateTime = (d?: string | null) => (d ? new Date(String(d)).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const nameCap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "—");
function NavItem({ icon: Icon, label, active, href }: { icon: React.ComponentType<{ size?: number; stroke?: number }>; label: string; active?: boolean; href?: string }) {
  const inner = <><Icon size={16} stroke={1.8} /> <span>{label}</span></>;
  const cls = `navitem ${active ? "active" : ""}`;
  return href ? <a className={cls} href={href}>{inner}</a> : <div className={cls}>{inner}</div>;
}

// ── Themed "My Day" (Version 2 preview) ────────────────────────────────
// Faithful build of the approved decluttered My Day mockup in the exact the dashboard theme
// theme (blue #3A57E8, Inter). Layout v2 per Praveen:
//   • Team chat is a COLLAPSIBLE right panel (slides in) — closed by default so
//     the work area gets full width; opens on click, auto-opens on a new message
//     (gentle: badge + toast), auto-collapses after you reply, with a Pin to keep
//     it open.
//   • The top bar carries three icon triggers with count badges:
//     🔔 notifications/handoffs · 📋 reminders · 💬 team chat.
//   • Work row is now My tasks | Up next detail (wider); Reminders moved into the
//     📋 popover; handoffs into the 🔔 popover.
// Self-contained sample content so the design/behaviour can be reviewed; real
// task/chat/handoff data wiring is a follow-up. V1 (components/MyDayView.tsx) is
// untouched.

type Tone = "good" | "info" | "brand" | "warn" | "bad" | "muted";
// Status follows the Airtable Content Calendar single-select EXACTLY (the source
// of truth being migrated to Supabase mh_posts). The status dropdown on the task
// card offers this exact list, in this order. `stage` maps to the 5-step pipeline;
// `inView` = still needs work (shows in the working view). Queued/terminal states
// (Ready to Publish, Published, Rejected, Failed) drop out of the working view.
type CCStatus =
  | "Content - Pending" | "Content - In Progress" | "Content - Needs Approval"
  | "Content - Approved" | "Output - In Progress" | "Output - Ready"
  | "Incorporating Feedback" | "Ready to Publish" | "Published/Scheduled"
  | "Rejected/Not Published" | "Failed";
// ONLY real mh_status enum values — offering anything else in a picker would 502
// the save. Every stage in the mh_status enum is now selectable except "Failed",
// which the publisher owns — see the note on CC_STATUS_ORDER below.
// "I don't see all the content status options. Add everything here." (Nandu,
// 6 Oct). Three stages were held back because the update route's allow-list had
// drifted below the mh_status enum and rejected them with a 400. That list was
// corrected on 4 Oct, so the reason for hiding them is gone.
//
// "Failed" stays out on purpose: the publisher sets it when a publish attempt
// errors. Letting someone choose it by hand would put a failure on the record
// that never happened.
const CC_STATUS_ORDER: CCStatus[] = [
  "Content - Pending", "Content - In Progress", "Content - Needs Approval",
  "Content - Approved", "Output - In Progress", "Incorporating Feedback",
  "Output - Ready", "Ready to Publish", "Published/Scheduled",
  "Rejected/Not Published",
];
const STATUS: Record<CCStatus, { label: string; tone: Tone; stage: number; inView: boolean }> = {
  "Content - Pending":        { label: "Content - Pending",        tone: "muted", stage: 0, inView: true },
  "Content - In Progress":    { label: "Content - In Progress",    tone: "warn",  stage: 1, inView: true },
  "Content - Needs Approval": { label: "Content - Needs Approval", tone: "warn",  stage: 1, inView: true },
  "Content - Approved":       { label: "Content - Approved",       tone: "good",  stage: 2, inView: true },
  "Output - In Progress":     { label: "In Progress",              tone: "info",  stage: 3, inView: true },
  "Output - Ready":           { label: "Output - Ready",           tone: "info",  stage: 3, inView: true },
  "Incorporating Feedback":   { label: "Incorporating Feedback",   tone: "warn",  stage: 2, inView: true },
  "Ready to Publish":         { label: "Ready to Publish",         tone: "brand", stage: 4, inView: false },
  "Published/Scheduled":      { label: "Published/Scheduled",      tone: "good",  stage: 4, inView: false },
  "Rejected/Not Published":   { label: "Rejected/Not Published",   tone: "bad",   stage: 4, inView: false },
  "Failed":                   { label: "Failed",                   tone: "bad",   stage: 4, inView: false },
};
// Per-person status tabs (MY_DAY_SPEC §5). Each tab shows exactly ONE stage and
// lists tasks where the person is owner OR collaborator. Manya (the writer) works the
// content stages + watches claims; producers work only their approved output.
type TabDef = { key: string; label: string; short: string; statuses: CCStatus[]; videoOnly?: boolean; nonVideoOnly?: boolean };
const MANYA_TABS: TabDef[] = [
  { key: "pending",  label: "Content Pending",        short: "Pending",  statuses: ["Content - Pending", "Content - In Progress"] },
  { key: "approved", label: "Content Approved",       short: "Approved", statuses: ["Content - Approved"], nonVideoOnly: true },
  { key: "feedback", label: "Incorporating Feedback", short: "Feedback", statuses: ["Incorporating Feedback"] },
  { key: "claimed",  label: "Claimed Task",           short: "Claimed",  statuses: ["Content - Approved"], videoOnly: true },
];
// In progress has its own view now, next to Approved (Praveen, 22 Oct).
const PRODUCER_TABS: TabDef[] = [
  { key: "approved",   label: "Approved",               short: "Approved",     statuses: ["Content - Approved"] },
  { key: "inprogress", label: "In progress",            short: "In progress",  statuses: ["Output - In Progress"] },
  { key: "output",     label: "Output ready",           short: "Output ready", statuses: ["Output - Ready"] },
  { key: "feedback",   label: "Feedback",               short: "Feedback",     statuses: ["Incorporating Feedback"] },
];
// Saved views — the person's own filters, kept as a tab in the View picker. Stored in
// this browser per person (they're personal, like a remembered sort).
type MyView = { id: string; name: string; statuses: CCStatus[]; types: string[]; when: "any" | "overdue" | "today" | "week" };
const VIEWS_KEY = (p: string) => `gc-myday-views:${p}`;
function inMyView(t: { status: string; due: string; detail: { typeLine: string } }, v: MyView, today: string): boolean {
  if (v.statuses.length && !v.statuses.includes(t.status as CCStatus)) return false;
  if (v.types.length && !v.types.includes(t.detail.typeLine)) return false;
  if (v.when === "any") return true;
  if (!t.due) return false;
  if (v.when === "overdue") return t.due < today;
  if (v.when === "today") return t.due === today;
  const end = new Date(today + "T00:00:00"); end.setDate(end.getDate() + 6);
  const endKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  return t.due >= today && t.due <= endKey;
}
function tabsForPerson(name: string): TabDef[] {
  const r = roleOf(keyOfName(name));
  return r === "writer" || r === "manager" ? MANYA_TABS : PRODUCER_TABS;
}
function isVideoTask(typeLine: string): boolean {
  return isVideoType(typeLine);
}
function matchesTab(t: { status: string; detail: { typeLine: string } }, tab: TabDef): boolean {
  if (!tab.statuses.includes(t.status as CCStatus)) return false;
  if (tab.videoOnly && !isVideoTask(t.detail.typeLine)) return false;
  if (tab.nonVideoOnly && isVideoTask(t.detail.typeLine)) return false;
  return true;
}
// `today` is its own state, not a flavour of overdue: work due today is still savable,
// work that is late already isn't. They were rendered identically, so a task you could
// still finish looked exactly like one you had already missed.
function dueInfo(due: string, today: string): { label: string; overdue: boolean; today: boolean; tomorrow?: boolean } {
  if (!due) return { label: "", overdue: false, today: false };
  const d = Math.round((new Date(due + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86_400_000);
  // The date itself leads, the relative part follows in brackets — "Due today" alone
  // never said which day it was (Praveen, 21 Oct).
  const date = new Date(due + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  if (d < 0) return { label: `${date} (${d === -1 ? "overdue · yesterday" : `overdue · ${-d} days`})`, overdue: true, today: false };
  if (d === 0) return { label: `${date} (due today)`, overdue: false, today: true };
  if (d === 1) return { label: `${date} (due tomorrow)`, overdue: false, today: false, tomorrow: true };
  return { label: `${date} (in ${d} days)`, overdue: false, today: false };
}
// A reference the team drops on a task — either a URL (mood board, doc, tweet…) or
// an image. Mirrors the Airtable "References" field.
type RefItem = { kind: "link" | "image"; label: string; url?: string; attId?: string };
type Task = {
  id: string; title: string; meta: string;
  status: CCStatus; due: string; // YYYY-MM-DD
  detail: {
    typeLine: string; publishes: string; owner: string;
    priority: "Urgent" | "High" | "Medium" | "Low"; brand: string;
    duration?: number;                                  // minutes — the producer sets how long it'll take → feeds Today's plan
    createdBy?: string; ownerKey?: string; liveUrl?: string; // "Tasks I created" tracking
    content: string;                                    // full write-up (paragraphs split on blank lines)
    creatives: { name: string; type: "image" | "video" | "doc"; url?: string; attId?: string }[]; // post media + uploaded assets
    references?: RefItem[];                             // links + images the team adds for context
    attachments?: CreativeItem[];                       // working files, never published (kind='attachment')
    outputLink?: string;                                // the finished-creative link (Drive/Canva) — output_link
    collaborators: Person[];
    activity: { who: string; text: string; time: string }[];
    createdAt?: string; modifiedAt?: string; startAt?: string; endAt?: string; // task clock (captured on create → done)
    // Every time the allotted minutes were raised, and why — written by the timer
    // strip's Extend control, read back so the task can show the trail.
    // `undoOf` carries the `at` of the entry this one reverses. Undoing never deletes:
    // it appends a correction, so an overrun added by mistake is still visible as
    // something that happened and was put right, not something that quietly vanished.
    extensions?: { at: string; by: string; fromMin: number; toMin: number; reason: string; undoOf?: string }[];
    thumbnail?: { taskId?: string; decision?: string; type?: string } | null;
    feedback?: string;                                    // Manya's Incorporating-Feedback notes (spec §7)
    presenter?: string;                                   // member key of whoever registered to present it
  };
};

const PIPELINE = ["Draft", "In progress", "Approved", "Output ready", "Published"];

// The person switcher. Anyone added on the Team page is appended at runtime
// (PreviewMyDay → mergeTeam), Maheen left out as before — she has no producer day.
const TEAM = [
  { key: "manya", name: "Manya", role: "Content writer", av: "M", color: "#E0791F" },
  { key: "praveen", name: "Praveen", role: "Designer", av: "P", color: "#C2410C" },
  { key: "nikhil", name: "Nikhil", role: "Video editor", av: "N", color: "#3A57E8" },
  { key: "nandu", name: "Nandu", role: "Video editor", av: "N", color: "#6E48F8" },
];
// Only an editor can be holding claimable video work. Read off the roster rather
// than naming the two of them, so this stays true when the team changes.
const EDITOR_NAMES = new Set(TEAM.filter((t) => t.role === "Video editor").map((t) => t.name));


// Today's plan is time-proportional across an 8-hour workday (9 AM–6 PM) with a
// protected 1-hour lunch. Tasks are reorderable — drag a block, or use the ◀ ▸
// nudges to push it front/back.
const DAY_START_H = 9, DAY_END_H = 19;             // 9 AM – 7 PM span (covers both shifts: 9–6 and 10–7)
const DAY_MINS = (DAY_END_H - DAY_START_H) * 60;   // 600 — the width the timeline DRAWS,
                                                   // wide enough for both the 9–6 and 10–7 shifts.
                                                   // A shift itself is 540 (8h work + 1h lunch).
const LUNCH_MIN = 60;                              // 1-hour lunch, never compromised
const LUNCH_AT = (13 - DAY_START_H) * 60;          // lunch fixed at 1 PM – 2 PM
const fmtDur = (m: number) => { const h = Math.floor(m / 60), mm = m % 60; return h ? `${h}h${mm ? ` ${mm}m` : ""}` : `${mm}m`; };
// Short form — "Thu, 23 Jul 2026, 10:05 am". The shared fmtDateTime spells the
// weekday and month out in full, which wrapped to two lines in a sixth of the row
// and is more than a created-on stamp needs. Local to this tab: the Scheduler and
// the calendar still use the long one.
const fmtDT = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  // The year is dropped for this year and kept for any other. With it, the string
  // measures 182px in a 181px cell — one pixel over, so it wrapped "am" onto a line
  // of its own. Without it, 140.
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${date}, ${time}`;
};
function durBetween(a?: string, b?: string): string {
  if (!a || !b) return "—";
  let ms = new Date(b).getTime() - new Date(a).getTime();
  if (isNaN(ms) || ms < 0) return "—";
  const d = Math.floor(ms / 86_400_000); ms -= d * 86_400_000;
  const h = Math.floor(ms / 3_600_000); ms -= h * 3_600_000;
  const m = Math.floor(ms / 60_000);
  return [d && `${d}d`, h && `${h}h`, (!d && m) && `${m}m`].filter(Boolean).join(" ") || "0m";
}
// Minutes-since-9AM → a clock label like "2:00 PM" (for the drag drop-guide).
const clockOf = (m: number) => { const t = DAY_START_H * 60 + m; const h = Math.floor(t / 60), mm = t % 60; const ap = h >= 12 ? "PM" : "AM"; const h12 = ((h + 11) % 12) + 1; return `${h12}:${String(mm).padStart(2, "0")} ${ap}`; };
const HOUR_TICKS = ["9 AM", "10", "11", "12", "1 PM", "2", "3", "4", "5", "6"];

type PlanItem = { key: string; taskId: string; label: string; dur: number };
// (Today's plan seeds itself from the person's real in-view tasks — no demo plan.)

// REAL team chat (mh_messages via /api/my-day/chat). WhatsApp-style: a Team
// group + 1-on-1 DMs, derived from the fetched messages relative to `person`.
// kind='system' rows are server-posted pipeline events (handoff/claim/publish).
type ChatMsg = { who: string; av: string; color: string; tm: string; body: string; me: boolean; sys?: boolean };
type Convo = { id: string; name: string; group?: boolean; av?: string; color?: string; online?: boolean; unread: number; msgs: ChatMsg[] };
type ServerMsg = { id: string; convo: string; sender: string; body: string; kind: "chat" | "system"; at: string };
const dmConvo = (a: string, b: string) => [a, b].sort().join("~");
// One card per task, however many lists it arrived in. The claim buffer and the
// server list could both hold a task — and a repeated claim added another copy —
// so the same video showed three times in Approved (Praveen, 28 Sep). The first
// copy wins; callers put the claim buffer first, as before.
const uniqById = <T extends { id: string }>(list: T[]): T[] => {
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
};

const TONE: Record<Tone, { bg: string; fg: string }> = {
  // bg/fg read --tone-* (defined only in the dark theme) and fall back to the light colour.
  good: { bg: "var(--tone-good-bg, #E3F5EA)", fg: "var(--tone-good-fg, #1AA053)" },
  info: { bg: "var(--tone-info-bg, #E1F4F5)", fg: "var(--tone-info-fg, #079AA2)" },
  brand: { bg: "var(--tone-brand-bg, #E9ECFB)", fg: "var(--tone-brand-fg, #3A57E8)" },
  warn: { bg: "var(--tone-warn-bg, #FEF3E2)", fg: "var(--tone-warn-fg, #D97706)" },
  bad: { bg: "var(--tone-bad-bg, #FBE7E4)", fg: "var(--tone-bad-fg, #C03221)" },
  muted: { bg: "var(--tone-muted-bg, #F0F2F8)", fg: "var(--tone-muted-fg, #8A92A6)" },
};

const PRIO: Record<"Urgent" | "High" | "Medium" | "Low", { bg: string; fg: string }> = {
  Urgent: { bg: "var(--tone-urgent-bg, #FCE0E6)", fg: "var(--tone-urgent-fg, #B0203A)" },
  High: { bg: "var(--tone-bad-bg, #FBE7E4)", fg: "var(--tone-bad-fg, #C03221)" },
  Medium: { bg: "var(--tone-info-bg, #E1F4F5)", fg: "var(--tone-info-fg, #079AA2)" },
  Low: { bg: "var(--tone-muted-bg, #F0F2F8)", fg: "var(--tone-muted-fg, #8A92A6)" },
};
// Urgent + High both count as "hot" — front of the plan + pipeline trigger (spec §9).
const isHot = (p: string) => p === "Urgent" || p === "High";

// Content Calendar Type options. Design/static types route to the designer
// (Praveen); video types drop into the editors' claim pool.
// Both lists come from lib/mh-content-types — the same source the approval handoff
// (api/marketing-hub/update) and the DB trigger (sql/013_design_work_owner.sql) use.
// They used to be re-typed here and had drifted: "Meta Ads - Video" was missing from
// the local video list, so My Day read it as design work while the server routed it
// as video.
const CC_TYPES: readonly string[] = [...CONTENT_TYPES];
const DESIGN_TYPES: readonly string[] = CC_TYPES.filter((t) => !VIDEO_TYPE_SET.has(t));
const isVideoType = (t: string) => VIDEO_TYPE_SET.has(t);

// The auto-assignment rule: given a Type, who owns the task? Design/thumbnail work
// auto-assigns to the single designer (Praveen); video work is NOT auto-assigned to
// one editor — it goes into the shared pool that Nikhil & Nandu can claim.
function autoAssign(type: string): { owner: string; toPool: boolean; note: string } {
  const designer = nameOfRole("designer", "Praveen");
  if (DESIGN_TYPES.includes(type)) return { owner: designer, toPool: false, note: `${type} is design work → auto-assigned to ${designer} (designer).` };
  if (isVideoType(type)) return { owner: "Unclaimed", toPool: true, note: `${type} is video → dropped into the editors' claim pool (${keysWithRole("editor").map((k) => PPL[k]?.name || k).join(" / ")}).` };
  return { owner: nameOfRole("writer", "Manya"), toPool: false, note: "Stays with the writer." };
}

// ── Capacity model ─────────────────────────────────────────────────────────
// An editor's working day is 9 AM–6 PM minus a protected 1h lunch = 8h (480 min).
// A task's estimate is checked against the room left in their Today's plan: if it
// fits it just auto-adds; if it doesn't, it surfaces through the pipeline.
const WORK_MIN = 480;
// The last hour of Today's plan is kept free for emergencies: routine work fills
// 7h, and only Urgent/High tasks may use the buffer hour.
const BUFFER_MIN = 60;
// How long before the end of the day a task due TODAY starts nudging its owner.
// Early enough to still finish it, late enough not to nag all morning.
// Set on the Rules page (Notifications → Due-today reminder); 3 hours by default.
const remindBeforeEndMin = () => SETTINGS.remindHours * 60;
const DAY_END_LABEL = "6:00 PM";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const WEEK_DAY_CAP = 7 * 60;                       // 7 productive hours per weekday
// Per-person shift start (minutes after 9 AM), from "Shift starts" on the Team page
// (was typed in: Nandu 10 AM, everyone else 9 AM). The day grid begins at 9 AM.
const shiftStartOf = (name: string) => Math.max(0, shiftStartMin(keyOfName(name)) - 9 * 60);
// Working minutes left in a shift when the day actually starts at `start` (minutes
// after 9 AM) — the shift still ends at its usual time and lunch never counts.
function workAvailFrom(start: number, shift: number): number {
  const end = shift + WORK_MIN + LUNCH_MIN;
  if (start >= end) return 0;
  const lunch = Math.max(0, Math.min(end, LUNCH_AT + LUNCH_MIN) - Math.max(start, LUNCH_AT));
  return end - start - lunch;
}
// Whose TIMELINE a task belongs on, by status. Manya (writer) keeps only her
// pre-approval work — the moment she marks it Content-Approved her part is done, so
// it leaves her timeline and lands on the producer's side. Producers get everything
// from Content-Approved onward. (Mirrors the dayFor capacity-board rule.)
const onTimelineFor = (name: string, status: string) =>
  nameIsWriter(name)
    ? status === "Content - Pending" || status === "Content - In Progress"
    : status !== "Content - Pending" && status !== "Content - In Progress";
// Shared with the Marketing-Hub Workload timeline (lib/task-estimate) so a task's
// estimated length is identical in My Day and Workload.
const estMins = estimateTaskMinutes;
// Being on camera is real time on your day, even though the editor owns the task.
// The timeline counted owners only, so whoever presented never saw the shoot on
// their plan or their workload (Nikhil, 9 & 13 Oct). A presenter's block is the
// shoot, not the edit — the task's duration is the editor's, so it isn't reused.
const SHOOT_MIN = 60;
const presentsOn = (t: Task, key: string, name: string) =>
  !!t.detail.presenter && t.detail.presenter.toLowerCase() === key && t.detail.owner !== name
  && (t.status === "Content - Approved" || t.status === "Output - In Progress");
const planMins = (t: Task, key: string, name: string) =>
  presentsOn(t, key, name) ? SHOOT_MIN : (t.detail.duration || estMins(t.detail.typeLine));
const keyOfName = (name: string) => Object.keys(PPL).find((k) => PPL[k].name === name) || name.toLowerCase();
// Workflow roles come from the Team page (lib/team-roles); My Day mostly holds first names.
const nameIsWriter = (name: string) => isWriter(keyOfName(name));
const nameOfRole = (role: WorkRole, fallback: string) => { const k = firstWithRole(role); return (k && PPL[k]?.name) || fallback; };
function fmtMins(m: number): string { const h = Math.floor(m / 60), mm = m % 60; return h ? `${h}h${mm ? ` ${mm}m` : ""}` : `${mm}m`; }
// A duration CHANGE, with its sign. fmtMins alone can't take a negative (-30 comes out
// as "-1h -30m"), and a correction in the time log has to read as a subtraction.
const signedMins = (m: number): string => `${m < 0 ? "−" : "+"}${fmtMins(Math.abs(m))}`;
// minutes-past-9AM of the finish time → "6:30 PM"
function finishLabel(committed: number, addMin: number): string {
  const total = 9 * 60 + committed + addMin + 60; // + 1h lunch
  const h = Math.floor(total / 60), mm = total % 60;
  const ap = h >= 12 ? "PM" : "AM"; const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(mm).padStart(2, "0")} ${ap}`;
}

// A seeded urgent task (for the demo) that lands mid-day and doesn't fit — the
// entry point for the Accept & Work pipeline. Kept a 1h "cut" so a packed day
// tips ~30 min over (mirrors the storyboard).
const URGENT_TASK: Task = {
  id: "urgent1", title: "12thPlus Exam Alert — Reel Cut", meta: "Reel - Cut · urgent · today",
  status: "Content - Approved", due: "",
  detail: { typeLine: "Reel - Cut", publishes: "Today", owner: "Unclaimed", priority: "High", brand: "12thPlus.com",
    content: "Exam-notification reel — the board just released dates. Fast turnaround, must publish today.",
    creatives: [], collaborators: [PPL.manya], activity: [{ who: "Manya", text: "flagged this urgent", time: "now" }] },
};
// The editor's low-priority, no-fixed-date tasks Manya could slide to tomorrow.
const MOVABLE = [
  { id: "m1", title: "Evergreen Study Tips — Reel", note: "Evergreen · no fixed date", mins: 90 },
  { id: "m2", title: "Motivation Monday — Reel", note: "Filler content · flexible", mins: 90 },
];

// A notification in the chat-panel stack. `urgent`/`freed` carry an action.
type SwapCand = { id: string; title: string; dur: number; due?: string };
type Notif = { id: string; kind: "urgent" | "claim" | "message" | "freed"; emoji: string; title: string; sub: string; task?: Task; postId?: string; accept?: boolean; swap?: { from: string; candidates: SwapCand[] };
  // The time-is-nearly-up alert answers itself: finished, or extend. Both act on
  // the task from wherever the person happens to be looking.
  timeUp?: { taskId: string } };

function greetingFor(h: number) {
  if (h < 5) return { word: "Hello", emoji: "👋" };
  if (h < 12) return { word: "Good morning", emoji: "☀️" };
  if (h < 17) return { word: "Good afternoon", emoji: "👋" };
  if (h < 21) return { word: "Good evening", emoji: "🌆" };
  return { word: "Hello", emoji: "👋" };
}

const BELL = <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M13.7 21a2 2 0 0 1-3.4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
const CLIP = <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><path d="M9 4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6H9V4.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="m8.5 13 2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const CHATIC = <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const CLOCK = <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.9" /><path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>;
// Inline chrome icons (baseline-aligned) — replace emojis in buttons/labels so the
// whole cockpit uses outline glyphs, never emoji.
const ICLOCK = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ verticalAlign: "-2px" }}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.9" /><path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const IWARN = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ display: "inline-block", verticalAlign: "-2px" }}><path d="M12 3 2.5 20h19L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M12 10v4.5M12 17.6v.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
const IHOURGLASS = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ verticalAlign: "-2px" }}><path d="M6.5 3h11M6.5 21h11M7.5 3c0 5 4.5 6 4.5 9s-4.5 4-4.5 9M16.5 3c0 5-4.5 6-4.5 9s4.5 4 4.5 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const IPOWER = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ verticalAlign: "-2px" }}><path d="M12 3v8.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /><path d="M7.5 6a7.5 7.5 0 1 0 9 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>;
const IUSERS = <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="M15.5 5.9a3 3 0 0 1 0 5.2M16 14.2A5.5 5.5 0 0 1 19.5 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
const CHEV = <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{ verticalAlign: "-1px", opacity: 0.55 }}><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const IPLAY = <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6a1 1 0 0 0 1.52.85l11-6.8a1 1 0 0 0 0-1.7l-11-6.8A1 1 0 0 0 8 5.2Z" /></svg>;
const ILOCK = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2.5" stroke="currentColor" strokeWidth="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
const ISTOP = <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>;

// One due-date chip everywhere so the clock icon + label read uniformly on every
// task card (My tasks, claimable, Output-Ready). Renders nothing when there's no due.
// Pull the "+15m" / "-30m" out of an event line and colour it, so how much time was
// added (or given back) is the thing the eye lands on.
function highlightMins(text: string): React.ReactNode {
  const parts = text.split(/([+−-]\d+(?:h(?:\s?\d+m)?|m))/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    /^[+−-]\d+(h(\s?\d+m)?|m)$/.test(part)
      ? <b key={i} className={`chat-mins ${part.startsWith("+") ? "up" : "down"}`}>{part}</b>
      : <span key={i}>{part}</span>);
}

function DueChip({ due, today }: { due: string; today: string }) {
  const di = dueInfo(due, today);
  if (!di.label) return null;
  return <span className={`due-chip ${di.overdue ? "od" : di.today ? "today" : ""}`}>{CLOCK}{di.label}</span>;
}

// The full task detail — shared by the inline "Up next" panel and the Today's-plan
// popup, so both show the complete picture (title, meta, team, content, files,
// progress, activity).

// Custom status dropdown — a styled menu (not a native <select>, which can't be
// themed) so it matches the themed card: each row shows the status's own tone dot.
function StatusDropdown({ value, onChange }: { value: CCStatus; onChange: (s: CCStatus) => void }) {
  const [open, setOpen] = useState(false);
  const tone = TONE[STATUS[value].tone];
  return (
    <div className="status-dd">
      <button className="status-dd-btn" style={{ background: tone.bg, color: tone.fg }} onClick={() => setOpen((o) => !o)}>
        <span className="status-dot" style={{ background: tone.fg }} />
        <span className="status-dd-val">{STATUS[value].label}</span>
        <span className="status-caret" style={{ borderTopColor: tone.fg }} />
      </button>
      {open && (
        <>
          <div className="status-dd-back" onClick={() => setOpen(false)} />
          <div className="status-dd-menu">
            {CC_STATUS_ORDER.map((s) => {
              const t = TONE[STATUS[s].tone];
              return (
                <button key={s} className={`status-dd-item ${s === value ? "on" : ""}`} onClick={() => { onChange(s); setOpen(false); }}>
                  <span className="status-dot" style={{ background: t.fg }} />
                  <span className="status-dd-item-lbl">{STATUS[s].label}</span>
                  {s === value && <span className="status-dd-check">✓</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}


// References — links + images the team drops on a task for context. Paste a URL
// or upload image files; both persist to the same backend as the Marketing Hub
// modal (reference links → mh_posts.reference_links, images → mh_attachments
// kind='reference'). Seeded from the task's own references; remounted per task.

function ReferencesSection({ initial, postId, uploadedBy, onSaved }: { initial: RefItem[]; postId: string; uploadedBy: string; onSaved: () => void }) {
  const [refs, setRefs] = useState<RefItem[]>(initial);
  // Follow the server's list after a reload, so a new upload replaces its preview tile.
  useEffect(() => { setRefs(initial); }, [JSON.stringify(initial)]); // eslint-disable-line react-hooks/exhaustive-deps
  const currentLinks = () => refs.filter((r) => r.kind === "link" && r.url).map((r) => r.url!) as string[];
  const saveLinks = (links: string[]) =>
    fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: postId, actor: uploadedBy, fields: { reference_links: links } }) });
  const addUrl = async (href: string) => {
    setRefs((r) => [...r, { kind: "link", label: href.replace(/^https?:\/\//i, ""), url: href }]);
    await saveLinks([...currentLinks(), href]); onSaved();
  };
  const q = useUploadQueue({ postId, kind: "reference", uploadedBy, onSaved,
    existing: refs.filter((r) => r.kind === "image").map((r) => r.label),
    onError: (name, msg) => showToast({ who: `Couldn't add ${name}`, body: msg, color: "#C03221", av: "!" }) });
  const files = refs.filter((r) => r.kind === "image");
  const links = refs.filter((r) => r.kind !== "image");
  const removeRef = async (item: RefItem) => {
    setRefs((r) => r.filter((x) => x !== item));
    if (item.kind === "image" && item.attId) {
      // Say so when it didn't go, instead of the tile vanishing and coming back on reload.
      const res = await removeTaskFile(item.attId);
      if (!res.ok) { const j = await res.json().catch(() => ({})); showToast({ who: "Couldn't remove it", body: (j as { error?: string }).error || `HTTP ${res.status}`, color: "#C03221", av: "!" }); }
    }
    else if (item.kind === "link" && item.url) await saveLinks(currentLinks().filter((l) => l !== item.url));
    onSaved();
  };
  // The shared files card (components/FilesCard) — same look in the task window and
  // the New task form.
  return (
    <div className="up-wrap">
      <FilesCard icon={<IconFileText size={15} stroke={1.8} />} title="References"
        count={`${files.length} file${files.length === 1 ? "" : "s"} · ${links.length} link${links.length === 1 ? "" : "s"}`}
        accept="image/*,.pdf,application/pdf" onFiles={(f) => q.add(f)} busyText={q.busy ? q.status : undefined}
        tiles={files.map((r, i): FileTile => ({ key: r.attId || r.url || String(i), name: r.label, url: r.url,
          kind: /\.pdf($|\?)/i.test(r.url || r.label) ? "pdf" : "image", onRemove: () => removeRef(r) }))}
        pending={q.pending} onDismiss={q.dismiss}
        links={links.map((r) => r.url || r.label)} linkPlaceholder="Paste a reference link…"
        onAddLink={addUrl} onRemoveLink={(l) => { const it = links.find((r) => (r.url || r.label) === l); if (it) removeRef(it); }} />
    </div>
  );
}

type CreativeItem = { name: string; type: "image" | "video" | "doc"; url?: string; attId?: string };
// PDFs as well as images and videos — "I can't add PDFs as creatives; they're greyed
// out" (Praveen, 21 Oct). The server always took PDFs; only the picker refused them.
const UPLOAD_ACCEPT = "image/*,video/*,.pdf,application/pdf";

// Creatives & files — the task's post media + uploaded creative files. Upload (click
// or drag-drop) persists to mh_attachments (kind='creative') and shows immediately;
// click any creative to open the preview (image / carousel slideshow / video play).
function CreativesSection({ creatives, outputLink, postId, uploadedBy, onSaved, title }: { creatives: CreativeItem[]; outputLink?: string; postId: string; uploadedBy: string; onSaved: () => void; title?: string }) {
  const [preview, setPreview] = useState<number | null>(null);
  const [link, setLink] = useState(outputLink || "");   // the output link (Drive/Canva) — output_link
  const viewable = creatives.filter((c) => c.url && c.type !== "doc");
  const saveLink = async (url: string) => {
    setLink(url);
    await fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: postId, actor: uploadedBy, fields: { output_link: url } }) }).catch(() => {});
    onSaved();
  };
  // Tiles appear at once with a progress ring; duplicates are called out first (22 Oct).
  const q = useUploadQueue({ postId, kind: "creative", uploadedBy, onSaved,
    existing: creatives.map((c) => c.name),
    onError: (name, msg) => showToast({ who: `Couldn't add ${name}`, body: msg, color: "#C03221", av: "!" }) });
  const remove = async (attId: string, why?: string) => {
    const res = await removeTaskFile(attId, why);
    if (!res.ok) { const j = await res.json().catch(() => ({})); showToast({ who: "Couldn't remove it", body: (j as { error?: string }).error || `HTTP ${res.status}`, color: "#C03221", av: "!" }); }
    else showToast({ who: "Moved to the Recycle bin", body: "It can be restored from System → Recycle bin.", color: "#3A57E8", av: "✓" });
    onSaved();
  };
  const openPreview = (c: CreativeItem) => { const idx = viewable.indexOf(c); if (idx >= 0) setPreview(idx); };
  const nFiles = creatives.length;
  return (
    <div className="up-wrap">
      <FilesCard icon={<IconUpload size={15} stroke={1.8} />} title="Creatives & files" drop numbered splitPdf askWhy zipName={title ? `${title} - creatives` : undefined}
        count={`${nFiles} file${nFiles === 1 ? "" : "s"}${link ? " · 1 link" : ""}`}
        accept={UPLOAD_ACCEPT} onFiles={(f) => q.add(f)} busyText={q.busy ? q.status : undefined}
        tiles={creatives.map((f, i): FileTile => {
          const pdf = !!f.url && (f.type === "doc" || isPdf(f.url, null));
          return { key: f.attId || f.url || String(i), name: f.name, url: f.url,
            kind: pdf ? "pdf" : f.type === "video" ? "video" : f.type === "image" ? "image" : "file",
            onOpen: !pdf && f.url && f.type !== "doc" ? () => openPreview(f) : undefined,
            onRemove: f.attId ? (why) => remove(f.attId!, why) : undefined };
        })}
        pending={q.pending} onDismiss={q.dismiss}
        onRemoveAll={async (why, keys) => {
          let failed = 0;
          for (const c of creatives) if (c.attId && keys.includes(c.attId) && !(await removeTaskFile(c.attId, why)).ok) failed++;
          showToast(failed ? { who: `${failed} file${failed === 1 ? "" : "s"} couldn't be removed`, body: "Try those again one by one.", color: "#C03221", av: "!" }
            : { who: "All files moved to the Recycle bin", body: "They can be restored from System → Recycle bin.", color: "#3A57E8", av: "✓" });
          onSaved();
        }}
        onReorder={nFiles > 1 && creatives.every((c) => c.attId) ? async (ids) => {
          const res = await reorderTaskFiles(postId, ids);
          if (!res.ok) { const j = await res.json().catch(() => ({})); showToast({ who: "Couldn't save the new order", body: (j as { error?: string }).error || `HTTP ${res.status}`, color: "#C03221", av: "!" }); }
          onSaved();
        } : undefined}
        links={link ? [link] : []} singleLink linkPlaceholder="Paste the output link (Drive / Canva)…"
        onAddLink={(v) => saveLink(v)} onRemoveLink={() => saveLink("")} />
      {preview !== null && viewable.length > 0 && (
        <CreativePreview items={viewable} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

// Attachments — working files that are never published (mh_attachments kind='attachment'),
// the same box the task window has. Missing here, a task with only attachments looked
// empty in My Day while the task window showed them (Praveen, 26 Oct).
function AttachmentsSection({ files, postId, uploadedBy, onSaved }: { files: CreativeItem[]; postId: string; uploadedBy: string; onSaved: () => void }) {
  const [preview, setPreview] = useState<number | null>(null);
  const viewable = files.filter((c) => c.url && c.type !== "doc");
  const q = useUploadQueue({ postId, kind: "attachment", uploadedBy, onSaved,
    existing: files.map((c) => c.name),
    onError: (name, msg) => showToast({ who: `Couldn't add ${name}`, body: msg, color: "#C03221", av: "!" }) });
  const remove = async (attId: string) => {
    const res = await removeTaskFile(attId);
    if (!res.ok) { const j = await res.json().catch(() => ({})); showToast({ who: "Couldn't remove it", body: (j as { error?: string }).error || `HTTP ${res.status}`, color: "#C03221", av: "!" }); }
    onSaved();
  };
  return (
    <div className="up-wrap">
      <FilesCard icon={<IconPaperclip size={15} stroke={1.8} />} title="Attachments"
        count={`${files.length} file${files.length === 1 ? "" : "s"} · never published`}
        accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv" onFiles={(f) => q.add(f)} busyText={q.busy ? q.status : undefined}
        tiles={files.map((f, i): FileTile => {
          const pdf = !!f.url && (f.type === "doc" || isPdf(f.url, null));
          return { key: f.attId || f.url || String(i), name: f.name, url: f.url,
            kind: pdf ? "pdf" : f.type === "video" ? "video" : f.type === "image" ? "image" : "file",
            onOpen: !pdf && f.url ? () => { const idx = viewable.indexOf(f); if (idx >= 0) setPreview(idx); } : undefined,
            onRemove: f.attId ? () => remove(f.attId!) : undefined };
        })}
        pending={q.pending} onDismiss={q.dismiss} />
      {preview !== null && viewable.length > 0 && (
        <CreativePreview items={viewable} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

// Fullscreen creative preview — image / carousel slideshow (‹ › + dots) / video play.
function CreativePreview({ items, index, onIndex, onClose }: { items: CreativeItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const cur = items[Math.min(index, items.length - 1)];
  const prev = () => onIndex((index - 1 + items.length) % items.length);
  const next = () => onIndex((index + 1) % items.length);
  return (
    <div className="cv-bg" onClick={onClose}>
      <div className="cv-box" onClick={(e) => e.stopPropagation()}>
        <button className="cv-x" onClick={onClose}>×</button>
        <div className="cv-stage">
          {cur.type === "video"
            ? <SoundVideo className="cv-el" src={cur.url || ""} open loop={false} />
            : <img className="cv-el" src={cur.url} alt={cur.name} />}
          {items.length > 1 && (
            <>
              <button className="cv-nav prev" onClick={prev} aria-label="Previous">‹</button>
              <button className="cv-nav next" onClick={next} aria-label="Next">›</button>
              <span className="cv-count">{index + 1}/{items.length}</span>
            </>
          )}
        </div>
        <div className="cv-name">
          <span className="cv-fname">{cur.name}</span>
          {items.length > 1 && <span className="cv-dots">{items.map((_, i) => <button key={i} className={`cv-dot ${i === index ? "on" : ""}`} onClick={() => onIndex(i)} aria-label={`Item ${i + 1}`} />)}</span>}
        </div>
      </div>
    </div>
  );
}

// Extend-time control on the live timer: quick presets + a custom-minutes box.
// Each pick ADDS to the current planned duration (accumulates) → onExtend, which
// persists the new duration and reshuffles Today's plan. The overrun vs the
// original estimate stays visible in the Created/Started/Time-taken record.
// Extending the time now asks WHY. Overruns were invisible before — the minutes just
// went up and nobody could tell a fiddly brief from a slow afternoon. The reason is
// required, because an optional one is never filled in.
function ExtendPicker({ onExtend }: { onExtend: (mins: number, reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [mins, setMins] = useState<number | null>(null);   // the chosen amount, pending a reason
  const [reason, setReason] = useState("");
  const close = () => { setOpen(false); setMins(null); setReason(""); setCustom(""); };
  const commit = () => { if (mins && reason.trim()) { onExtend(mins, reason.trim()); close(); } };
  return (
    <span className="ext-wrap">
      <button className="btn sm" onClick={() => (open ? close() : setOpen(true))}>+ Extend {CHEV}</button>
      {open && (
        <div className="ext-menu" onClick={(e) => e.stopPropagation()}>
          <div className="ext-row">{[15, 30, 45, 60, 90].map((m) => (
            <button key={m} className={`btn sm ${mins === m ? "primary" : ""}`} onClick={() => setMins(m)}>+{m}m</button>
          ))}</div>
          <div className="ext-row">
            <input className="nt-input ext-in" inputMode="numeric" placeholder="custom min" value={custom}
              onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ""); setCustom(v); setMins(v ? parseInt(v, 10) : null); }} />
          </div>
          {mins ? (
            <div className="ext-reason">
              <label className="nt-label">Why the extra {fmtMins(mins)}? <span className="nt-req">required</span></label>
              <textarea className="nt-input nt-textarea" rows={2} autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. client sent new copy · 3 extra slides · export kept failing"
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit(); }} />
              <div className="ext-row" style={{ justifyContent: "flex-end" }}>
                <button className="btn sm" onClick={close}>Cancel</button>
                <button className="btn sm primary" disabled={!reason.trim()} onClick={commit}
                  title={reason.trim() ? undefined : "Add a reason first"}>Add {fmtMins(mins)}</button>
              </div>
            </div>
          ) : <div className="nt-hint" style={{ display: "block", marginTop: ".4rem" }}>Pick how much time, then say why.</div>}
        </div>
      )}
    </span>
  );
}

// ── My tasks sort ──
type TaskSort = "plan" | "date" | "priority" | "status" | "recent";
const TASK_SORTS: Record<TaskSort, string> = { plan: "Today's plan", date: "Publishing date", priority: "Priority", status: "Status", recent: "Recently added" };
const PRIO_RANK: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const STATUS_RANK = Object.keys(STATUS) as CCStatus[];
/**
 * `planOrder` is only used by the "Today's plan" sort: task id -> its place on the
 * timeline. Dragging a block reorders the day, and the list has to agree with it —
 * a list still sorted by publishing date after a drag tells you a different thing
 * is next (Praveen, 25 Sep).
 */
function taskComparator(by: TaskSort, planOrder?: Map<string, number>, todayStr?: string) {
  const due = (a: Task, b: Task) => (a.due || "9999").localeCompare(b.due || "9999");
  const hot = (t: Task) => (t.detail.priority === "Urgent" || t.detail.priority === "High" ? 0 : 1);
  // Work that should already have gone out comes first, whatever its priority.
  // A High task due tomorrow used to jump ahead of two tasks that were overdue
  // yesterday (Praveen, 25 Sep) — late work is the more urgent thing by definition.
  const late = (t: Task) => (todayStr && t.due && t.due < todayStr ? 0 : 1);
  // What you're working on right now sits on top in every sort (Praveen, 21 Oct).
  const live = (t: Task) => (t.status === "Output - In Progress" ? 0 : 1);
  return (a: Task, b: Task) => live(a) - live(b) || sortBy(a, b);
  function sortBy(a: Task, b: Task): number {
    if (by === "plan") {
      // Anything not on today's timeline sits after everything that is — and among
      // those, the same order as the timeline itself: overdue, then Urgent/High, then
      // date. Plain date alone left late work below on-time work (Nandu, 13 Oct).
      const ia = planOrder?.get(a.id) ?? Infinity, ib = planOrder?.get(b.id) ?? Infinity;
      return (ia - ib) || (late(a) - late(b)) || (hot(a) - hot(b)) || due(a, b);
    }
    if (by === "priority") return (PRIO_RANK[a.detail.priority] - PRIO_RANK[b.detail.priority]) || due(a, b);
    if (by === "status") return (STATUS_RANK.indexOf(a.status) - STATUS_RANK.indexOf(b.status)) || due(a, b);
    if (by === "recent") return (b.detail.createdAt || "").localeCompare(a.detail.createdAt || "") || due(a, b);
    // Publishing date: overdue first, then Urgent/High, then earliest date.
    return (late(a) - late(b)) || (hot(a) - hot(b)) || due(a, b) || (PRIO_RANK[a.detail.priority] - PRIO_RANK[b.detail.priority]);
  }
}

// "My report" (prototype D, 22 Oct): what someone finished, over a date range —
// last 2 days by default, or Today / Yesterday / Last 7 days / Custom.
type ReportData = { done: { id: string; title: string; type: string; status: string; day: string; start: string | null; end: string | null; mins: number | null }[]; open: { id: string; title: string; type: string; status: string; due: string | null }[]; totals: { completed: number; minutes: number; open: number } };
type RangeKey = "today" | "yday" | "two" | "week" | "custom";
const ymdIST = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
const shiftDay = (ymd: string, n: number) => { const d = new Date(ymd + "T12:00:00+05:30"); d.setDate(d.getDate() + n); return ymdIST(d); };
const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }) : "");
const dayHead = (ymd: string, today: string) => {
  const nice = new Date(ymd + "T12:00:00+05:30").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return ymd === today ? `Today · ${nice}` : ymd === shiftDay(today, -1) ? `Yesterday · ${nice}` : nice;
};
function ReportPanel({ person, name, onClose }: { person: string; name: string; onClose: () => void }) {
  const today = ymdIST(new Date());
  const [range, setRange] = useState<RangeKey>("two");
  const [cFrom, setCFrom] = useState(shiftDay(today, -6));
  const [cTo, setCTo] = useState(today);
  const [data, setData] = useState<ReportData | null>(null);
  const [from, to] = range === "today" ? [today, today] : range === "yday" ? [shiftDay(today, -1), shiftDay(today, -1)]
    : range === "two" ? [shiftDay(today, -1), today] : range === "week" ? [shiftDay(today, -6), today] : [cFrom, cTo];
  useEffect(() => {
    let alive = true; setData(null);
    fetch(`/api/my-day/report?person=${encodeURIComponent(person)}&from=${from}&to=${to}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => { if (alive) setData(d.error ? { done: [], open: [], totals: { completed: 0, minutes: 0, open: 0 } } : d); })
      .catch(() => { if (alive) setData({ done: [], open: [], totals: { completed: 0, minutes: 0, open: 0 } }); });
    return () => { alive = false; };
  }, [person, from, to]);
  const days = data ? Array.from(new Set(data.done.map((d) => d.day))).sort().reverse() : [];
  const title = range === "custom" ? `${dayHead(from, today)} – ${dayHead(to, today)}` : range === "today" ? dayHead(today, today) : range === "yday" ? dayHead(shiftDay(today, -1), today) : range === "two" ? "Last 2 days" : "Last 7 days";
  const summary = () => !data ? "" : [
    `${name} — report · ${title}`,
    `${data.totals.completed} completed · ${fmtMins(data.totals.minutes)} on tasks · ${data.totals.open} still open`,
    ...days.flatMap((d) => [``, dayHead(d, today), ...data.done.filter((x) => x.day === d).map((x) => `• ${x.title}${x.mins ? ` (${fmtMins(x.mins)})` : ""}`)]),
    ...(data.open.length ? [``, `Still open`, ...data.open.map((o) => `• ${o.title}${o.due ? ` — due ${o.due}` : ""}`)] : []),
  ].join("\n");
  const print = () => {
    const w = window.open("", "_blank"); if (!w) return;
    const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    w.document.write(`<html><head><title>${esc(name)} — report</title><style>body{font-family:Inter,system-ui,sans-serif;color:#232D42;padding:32px;line-height:1.6}pre{font:inherit;white-space:pre-wrap}</style></head><body><pre>${esc(summary())}</pre></body></html>`);
    w.document.close(); w.focus(); w.print();
  };
  return (
    <div className="rpt-bg" onClick={onClose}>
      <aside className="rpt-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="My report">
        <div className="rpt-h">
          <div><div className="lbl">My report</div><b>{title}</b></div>
          <button type="button" className="closebtn" onClick={onClose} title="Close"><IconX size={15} stroke={2} /></button>
        </div>
        <div className="rpt-rng">
          {([["today", "Today"], ["yday", "Yesterday"], ["two", "Last 2 days"], ["week", "Last 7 days"], ["custom", "Custom…"]] as const).map(([k, l]) => (
            <button key={k} type="button" className={range === k ? "on" : ""} onClick={() => setRange(k)}>{l}</button>
          ))}
        </div>
        {range === "custom" && (
          <div className="rpt-cust">From <input type="date" value={cFrom} max={cTo} onChange={(e) => setCFrom(e.target.value)} /> to <input type="date" value={cTo} min={cFrom} max={today} onChange={(e) => setCTo(e.target.value)} /></div>
        )}
        {!data ? <div className="empty" style={{ padding: "2rem 0" }}>Loading…</div> : (
          <>
            <div className="rpt-tot">
              <div><div className="n g">{data.totals.completed}</div><div className="k">Completed</div></div>
              <div><div className="n">{fmtMins(data.totals.minutes)}</div><div className="k">Time on tasks</div></div>
              <div><div className="n w">{data.totals.open}</div><div className="k">Still open</div></div>
            </div>
            {days.length === 0 && <div className="empty" style={{ padding: "1rem 0" }}>Nothing finished in this range.</div>}
            {days.map((d) => (
              <div key={d}>
                <div className="rpt-day"><span>{dayHead(d, today)}</span><span>{data.done.filter((x) => x.day === d).length} done</span></div>
                {data.done.filter((x) => x.day === d).map((x) => (
                  <div key={x.id} className="rpt-it">
                    <div className="rpt-tm">{x.start ? `${hm(x.start)} – ${hm(x.end)}` : `finished ${hm(x.end)}`}</div>
                    <div><div className="rpt-t">{x.title}</div><div className="rpt-s">{[x.type, x.mins ? fmtMins(x.mins) : "", STATUS[x.status as CCStatus]?.label || x.status].filter(Boolean).join(" · ")}</div></div>
                  </div>
                ))}
              </div>
            ))}
            {data.open.length > 0 && (
              <div>
                <div className="rpt-day" style={{ marginTop: "1.2rem" }}><span>Still open</span><span>{data.open.length}</span></div>
                {data.open.map((o) => (
                  <div key={o.id} className="rpt-it">
                    <div className="rpt-tm">{o.due ? (o.due < today ? "overdue" : o.due === today ? "due today" : `due ${o.due.slice(8)}/${o.due.slice(5, 7)}`) : "no date"}</div>
                    <div><div className="rpt-t">{o.title}</div><div className="rpt-s">{[o.type, STATUS[o.status as CCStatus]?.label || o.status].filter(Boolean).join(" · ")}</div></div>
                  </div>
                ))}
              </div>
            )}
            <div className="rpt-acts">
              <button type="button" className="btn sm" onClick={print}>Download as PDF</button>
              <button type="button" className="btn sm" onClick={() => { navigator.clipboard?.writeText(summary()); showToast({ who: "Copied", body: "The report summary is on your clipboard.", color: "#1AA053", av: "✓" }); }}>Copy summary</button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

// The My tasks "View" picker (approved prototype D, 22 Oct).
function ViewPicker({ current, statusViews, myViews, typeOptions, statusOptions, onPick, onSave, onDelete }: {
  current: string;
  statusViews: { key: string; label: string; n: number }[];
  myViews: { key: string; label: string; n: number; id: string }[];
  typeOptions: string[]; statusOptions: CCStatus[];
  onPick: (key: string) => void; onSave: (v: Omit<MyView, "id">) => void; onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [making, setMaking] = useState(false);
  const [draft, setDraft] = useState<Omit<MyView, "id">>({ name: "", statuses: [], types: [], when: "any" });
  const all = [...statusViews, ...myViews];
  const cur = all.find((v) => v.key === current) || statusViews[0];
  const toggle = <T,>(list: T[], x: T) => list.includes(x) ? list.filter((y) => y !== x) : [...list, x];
  return (
    <div className="vpick">
      <button type="button" className="vpick-btn" onClick={() => { setOpen((o) => !o); setMaking(false); }} aria-expanded={open}>
        <span className="lbl">View</span><b>{cur?.label}</b><span className="vpick-n">{cur?.n ?? 0}</span><span className="vpick-car" aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="backdrop" onClick={() => setOpen(false)} />
          <div className="vpick-menu">
            {!making ? (
              <>
                <div className="vpick-h">Status</div>
                {statusViews.map((v) => (
                  <button key={v.key} type="button" className={`vpick-i ${v.key === current ? "on" : ""}`} onClick={() => { onPick(v.key); setOpen(false); }}><span>{v.label}</span><span className="vpick-n">{v.n}</span></button>
                ))}
                <div className="vpick-h">My views</div>
                {myViews.length === 0 && <div className="vpick-empty">Save your own filter as a view.</div>}
                {myViews.map((v) => (
                  <div key={v.key} className={`vpick-i ${v.key === current ? "on" : ""}`} onClick={() => { onPick(v.key); setOpen(false); }} role="button">
                    <span>{v.label}</span><span className="vpick-n">{v.n}</span>
                    <button type="button" className="vpick-x" title="Delete this view" onClick={(e) => { e.stopPropagation(); onDelete(v.id); }}>✕</button>
                  </div>
                ))}
                <button type="button" className="vpick-i vpick-add" onClick={() => { setMaking(true); setDraft({ name: "", statuses: [], types: [], when: "any" }); }}>+ New view…</button>
              </>
            ) : (
              <div className="vpick-form">
                <b>New view</b>
                <div className="muted" style={{ fontSize: ".72rem", margin: ".1rem 0 .6rem" }}>Saved as a view, only for you.</div>
                <div className="lbl">Status</div>
                <div className="vpick-chips">{statusOptions.map((st) => <button key={st} type="button" className={draft.statuses.includes(st) ? "on" : ""} onClick={() => setDraft((d) => ({ ...d, statuses: toggle(d.statuses, st) }))}>{STATUS[st]?.label || st}</button>)}</div>
                <div className="lbl">Type</div>
                <div className="vpick-chips">{typeOptions.map((ty) => <button key={ty} type="button" className={draft.types.includes(ty) ? "on" : ""} onClick={() => setDraft((d) => ({ ...d, types: toggle(d.types, ty) }))}>{ty}</button>)}</div>
                <div className="lbl">Publishing</div>
                <div className="vpick-chips">{([["any", "Any time"], ["overdue", "Overdue"], ["today", "Today"], ["week", "Next 7 days"]] as const).map(([k, l]) => <button key={k} type="button" className={draft.when === k ? "on" : ""} onClick={() => setDraft((d) => ({ ...d, when: k }))}>{l}</button>)}</div>
                <div className="lbl">Name</div>
                <input className="vpick-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Carousels this week" />
                <div className="vpick-acts">
                  <button type="button" className="btn sm" onClick={() => setMaking(false)}>Cancel</button>
                  <button type="button" className="btn primary sm" disabled={!draft.name.trim()} onClick={() => { onSave({ ...draft, name: draft.name.trim() }); setMaking(false); setOpen(false); }}>Save view</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Whether the signed-in person is asked why when they move a date — their "Ask why
// when a date moves" switch on Team & access. Read once per page load.
let askWhyOnce: Promise<boolean> | null = null;
const asksWhyOnDateMove = () => (askWhyOnce ||= fetch("/api/me", { cache: "no-store" })
  .then((r) => r.json()).then((d) => needsDateReason(d?.user)).catch(() => true));

function TaskBody({ task, label, onStatusChange, onSetDuration, uploadedBy, onSaved, timing, canEdit, canDelete, canAssign, onDeleted }: { task: Task; label?: string; onStatusChange?: (s: CCStatus) => void; onSetDuration?: (mins: number, reason?: string, undoOf?: string) => void; canSchedule?: boolean; uploadedBy?: string; onSaved?: () => void; timing?: { planned: number; elapsed: number }; canEdit?: boolean; canDelete?: boolean; canAssign?: boolean; onDeleted?: () => void }) {
  // A task opens with its files already showing beside the content, the same as the
  // task window (Praveen, 26 Oct): creatives once the output is ready, else the
  // attachments. Neither → no column. Once per task.
  const dockRef = useRef<HTMLDivElement | null>(null);
  const autoOpenedFor = useRef<string | null>(null);
  useEffect(() => {
    if (autoOpenedFor.current === task.id || !dockRef.current) return;
    autoOpenedFor.current = task.id;
    const asItems = (fs: { url?: string; name: string }[], from: string) => fs.filter((f) => f.url).map((f) => ({ url: f.url!, title: f.name, from }));
    const outputStage = ["Output - Ready", "Ready to Publish", "Published/Scheduled"].includes(String(task.status));
    const cre = outputStage ? asItems(task.detail.creatives || [], "Creatives") : [];
    // Slides first, the LinkedIn PDF last — it opens on slide 1, not on the PDF (27 Oct).
    cre.sort((x, y) => Number(/\.pdf(\?|#|$)/i.test(x.url.split("?")[0])) - Number(/\.pdf(\?|#|$)/i.test(y.url.split("?")[0])));
    const items = cre.length ? cre : asItems(task.detail.attachments || [], "Attachments");
    // Another task's file must not stay open over this one.
    if (items.length) openRefPreview(items, 0, dockRef.current); else closeRefPreview(dockRef.current);
  }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Start with no time set opens Set duration first (#23).
  const [durOpen, setDurOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [startAfterPick, setStartAfterPick] = useState(false);
  // Permission-gated task actions (edit / reassign / delete). Only rendered when
  // the viewed person's Team capabilities allow them.
  const actor = uploadedBy || "maheen";
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prio, setPrio] = useState(task.detail.priority);
  const [due, setDue] = useState(task.due || "");
  // Edit turns the fields themselves editable rather than opening a panel of its
  // own. One field at a time, opened by the pencil that sits beside its label.
  const [editField, setEditField] = useState<null | "owner" | "prio" | "due">(null);
  // When this task was last changed. Seeded from the row and then refreshed from
  // what the save endpoint hands back, so it is the server's timestamp rather than
  // the browser's guess at one.
  const [modifiedAt, setModifiedAt] = useState<string | undefined>(task.detail.modifiedAt);
  const Pen = ({ field }: { field: "owner" | "prio" | "due" }) => (
    <button type="button" className="fld-pen" title="Change this"
      onClick={() => setEditField((f) => (f === field ? null : field))}>
      <IconPencil size={12} stroke={1.9} />
    </button>
  );
  // A publish-date move that is waiting for an admin, so the field can say so
  // instead of looking as if the change was ignored.
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/marketing-hub/date-change", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!alive) return; const q = (d?.requests || []).find((x: { postId: string; status: string }) => x.postId === task.id && x.status === "pending"); setPendingDate(q?.to ? String(q.to).slice(0, 10) : null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [task.id, task.due]);
  const saveEdit = async () => {
    setBusy(true);
    try {
      // The picker shows the PUBLISHING date, so that is what it changes. It used to
      // write due_date — a field nobody sees here — so the date "changed but didn't
      // reflect" (Nandu, 21 Oct). due_date follows publishing_date on the server.
      // Only what actually changed. The panel used to carry the PREVIOUS task's form
      // state into the next one (no key per task), so Save wrote another task's brief,
      // priority and date over this one (Karnataka NEET PG Cut Off, 21 Oct). Keyed per
      // task now; sending only changes is the second guard.
      const fields: Record<string, unknown> = {};
      if (prio !== task.detail.priority) fields.priority = prio;
      // Moving a date asks why — every time, approval or not — and the reason goes in
      // the task's history (Praveen, 22 Oct). A first date isn't a move.
      let reason = "";
      if ((due || "") !== (task.due || "")) {
        if (task.due && await asksWhyOnDateMove()) {
          const why = await promptDialog({ title: "Why is the date changing?", body: "Add a short reason — it's saved in the task's history.", placeholder: "e.g. Waiting for the speaker's photos", action: "Change date" });
          if (why === null) return;
          if (!why.trim()) { showToast({ who: "Reason needed", body: "Add a short reason to change the date.", color: "#C03221", av: "!" }); return; }
          reason = why.trim();
        }
        fields.publishing_date = due || null;
      }
      if (!Object.keys(fields).length) { setEditing(false); return; }
      const res = await fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: task.id, actor, fields, ...(reason ? { reason } : {}) }) });
      const saved = await res.json().catch(() => null);
      if (!res.ok) { showToast({ who: "Couldn't save", body: (saved as { error?: string } | null)?.error || `HTTP ${res.status}`, color: "#C03221", av: "!" }); return; }
      if (saved?.updatedAt) setModifiedAt(saved.updatedAt);
      if (saved?.pendingApproval?.to) {
        setPendingDate(String(saved.pendingApproval.to).slice(0, 10));
        showToast({ who: "Sent for admin approval", body: `The new publishing date shows once an admin approves it.`, color: "#3A57E8", av: "✓" });
      }
      setEditing(false); onSaved?.();
    } finally { setBusy(false); }
  };
  // Give an approved / under-way video back to the editors' claim pool (Nandu, 9 &
  // 13 Oct). The owner may do this without "Assign to others"; the server allows it.
  const ownsIt = !!uploadedBy && task.detail.ownerKey === uploadedBy;
  const poolable = isVideoType(task.detail.typeLine) && (task.status === "Content - Approved" || task.status === "Output - In Progress");
  const releaseToPool = async () => {
    setBusy(true);
    try {
      const fields: Record<string, unknown> = { owner_key: null };
      if (task.status !== "Content - Approved") fields.status = "Content - Approved";
      const r = await fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: task.id, actor: uploadedBy, fields }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); showToast({ who: "Couldn't put it back", body: (j as { error?: string }).error || `HTTP ${r.status}`, color: "#C03221", av: "!" }); return; }
      showToast({ who: "Back in the claim pool", body: "Nikhil and Nandu have been told.", color: "#3A57E8", av: "✓" });
      setAssigning(false); onSaved?.();
    } finally { setBusy(false); }
  };
  const canOpenOwner = canAssign || ownsIt;
  const reassign = async (key: string) => {
    setBusy(true);
    try {
      await fetch("/api/marketing-hub/takeover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId: task.id, newOwnerKey: key }) });
      setAssigning(false); onSaved?.();
    } finally { setBusy(false); }
  };
  // Registering as presenter AFTER the task has been claimed.
  //
  // "Present on camera" only exists on cards sitting unclaimed in the pool, so
  // the moment an editor claims a video there is no way left to say you are on
  // camera — even though that is exactly the pairing the workflow wants (the
  // editor owns it, the presenter collaborates). Nikhil hit this on a YouTube
  // Long-Form already owned by Nandu, 7 Oct.
  //
  // Same write the pool buttons make, so the two routes cannot drift.
  const setPresenter = async (key: string) => {
    setBusy(true);
    try {
      await fetch("/api/marketing-hub/update", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, actor: uploadedBy, fields: { custom: { presenter_key: key, claim_role: key ? "present" : "" } } }),
      });
      onSaved?.();
    } finally { setBusy(false); }
  };
  const [delError, setDelError] = useState<string | null>(null);
  const doDelete = async () => {
    setBusy(true); setDelError(null);
    try {
      const res = await fetch("/api/marketing-hub/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: task.id, actor }) })
        .catch(() => null);
      if (!res || !res.ok) { const j = res ? await res.json().catch(() => ({})) : {}; setDelError(j.error || "Couldn't delete this task — try again."); return; }
      setConfirmDel(false); (onDeleted || onSaved)?.();
    } finally { setBusy(false); }
  };
  // Add a collaborator to this task (writes mh_post_collaborators via the CRUD route),
  // then resync so the new avatar chip appears. Same junction table the handoff uses.
  const [addingCollab, setAddingCollab] = useState(false);
  const addCollab = async (key: string) => {
    setBusy(true);
    try {
      await fetch("/api/marketing-hub/collaborators", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId: task.id, memberKey: key }) });
      setAddingCollab(false); onSaved?.();
    } finally { setBusy(false); }
  };
  // Remove a collaborator. Defaults get added automatically (Manya on every task,
  // Nandu on every 12thPlus one), so a wrong or accidental one has to come off
  // again — the DELETE route already existed, nothing exposed it.
  const removeCollab = async (key: string) => {
    setBusy(true);
    try {
      await fetch(`/api/marketing-hub/collaborators?postId=${encodeURIComponent(task.id)}&memberKey=${encodeURIComponent(key)}`, { method: "DELETE" });
      onSaved?.();
    } finally { setBusy(false); }
  };
  const tone = TONE[STATUS[task.status].tone];
  // Collaborators = the writer(s)/helpers on the task — kept separate from Owner
  // (the single person who claimed / does it), mirroring the Airtable model.
  const collabs = task.detail.collaborators;
  // Owner shown with the same avatar chip as collaborators — resolve the name back to
  // a PPL entry for its initials/colour ("Unclaimed" has no chip).
  const ownerP = Object.values(PPL).find((p) => p.name === task.detail.owner);
  // Candidates for the "+ add collaborator" menu: everyone not already the owner or a
  // collaborator on this task.
  const addable = Object.entries(PPL).filter(
    ([, p]) => p.name !== task.detail.owner && !collabs.some((c) => c.name === p.name),
  );
  return (
    // One column (prototype D, 22 Oct): History & comments slide in from the right
    // only when asked for, so the brief and files get the whole width.
    <div ref={dockRef} className={`tb-d ${histOpen ? "hopen" : ""}`} data-ref-dock data-ref-ratio="0.2" data-ref-stack="1">
    <div style={{ minWidth: 0 }}>
      {/* One line on top (Praveen, 22 Oct): status, duration, Start, then Edit /
          Reassign / Delete, with History & comments at the far right — every control the
          same size as that button. The title sits under it as the real heading. */}
      <div className="d-bar">
          <div className="status-row">
          {onStatusChange ? (
            <StatusDropdown value={task.status} onChange={onStatusChange} />
          ) : (
            <span className="pill cap" style={{ background: tone.bg, color: tone.fg }}>{STATUS[task.status].label}</span>
          )}
          {onSetDuration && (
            // Set duration is the PLAN — what the task should take. It is free to set
            // BEFORE work starts, and locked once the clock is running: an accidental
            // click on it must not be able to move the target. From then on the only
            // way to add time is "+ Extend", which always asks why.
            timing ? (
              <span className="cap dur-locked" title={`Locked while the clock runs — use + Extend to add time (with a reason)`}>
                {ICLOCK} {fmtMins(timing.planned)} {ILOCK}
              </span>
            ) : (
              <DurationPicker value={task.detail.duration} open={durOpen} onOpenChange={(o) => { setDurOpen(o); if (!o) setStartAfterPick(false); }}
                title={startAfterPick ? "How long will this take? The timer starts when you pick." : undefined}
                onChange={(m) => {
                  onSetDuration(m);
                  if (startAfterPick) { setStartAfterPick(false); onStatusChange?.("Output - In Progress"); }
                }} />
            )
          )}
          {/* Stopwatch: Content-Approved → Start (begins the clock); running → Stop
              (marks Output-Ready). Sits right after Set duration, per the agreed order. */}
          {onStatusChange && task.status === "Content - Approved" && (
            <button className="cap sw-btn start" title={task.detail.duration ? "Start working — starts the timer" : "Pick how long it will take, then the timer starts"}
              onClick={() => {
                // No time picked yet → ask for it first; the pick then starts the clock.
                if (!task.detail.duration && onSetDuration) { setStartAfterPick(true); setDurOpen(true); return; }
                onStatusChange("Output - In Progress");
              }}>{IPLAY} Start</button>
          )}
          {/* "Stop" said one thing and did another — it marked the task finished. Next
              to a running clock that reads as "stop the timer", which is how a task
              nobody had finished got marked Output-Ready. It says Done now. */}
          {onStatusChange && timing && (
            <button className="cap sw-btn stop" title="Finished — marks it Output Ready and stops the clock" onClick={() => onStatusChange("Output - Ready")}>{ISTOP} Done</button>
          )}
          {/* The way out of an accidental start. Opening a task starts it, so there has
              to be one obvious button that says "I'm not working on this" — putting it
              back where it was and wiping the clock, in a single click. */}
          {onStatusChange && timing && (
            <button className="cap sw-btn cancel" title="Not working on this — put it back and clear the clock"
              onClick={async () => {
                if (!(await confirmDialog({
                  title: "Not working on this?",
                  body: `The clock will be cleared (${fmtMins(timing.elapsed)} so far) and the task goes back to ${STATUS["Content - Approved"].label}. Nothing else changes.`,
                  action: "Put it back",
                }))) return;
                onStatusChange("Content - Approved");
              }}>{<IconX size={12} stroke={2.4} />} Cancel</button>
          )}
          {/* LIVE COUNTDOWN capsule — same height as the others; only while running */}
          {timing && (
            <span className={`cap cap-timer ${timing.elapsed >= timing.planned ? "over" : ""}`} title="Time left vs the planned duration">
              {ICLOCK} {timing.elapsed >= timing.planned ? `+${fmtMins(timing.elapsed - timing.planned)} over` : `${fmtMins(timing.planned - timing.elapsed)} left`}
            </span>
          )}
        </div>
        <div className="d-tools">
              {canEdit && !editing && <button className="btn sm" onClick={() => { setEditing(true); setAssigning(false); setConfirmDel(false); setEditField(null); }}><IconPencil size={14} stroke={1.8} /> Edit</button>}
              {canEdit && editing && <>
                <button className="btn sm primary" disabled={busy} onClick={saveEdit}>{busy ? "Saving…" : "Save changes"}</button>
                <button className="btn sm" onClick={() => { setEditing(false); setEditField(null); setPrio(task.detail.priority); setDue(task.due || ""); }}>Cancel</button>
              </>}
              {canAssign && <button className="btn sm" onClick={() => { setAssigning((a) => !a); setEditing(false); setConfirmDel(false); }}><IconArrowsExchange size={14} stroke={1.8} /> Reassign</button>}
              {canDelete && <button className="btn sm" style={{ color: "#C0392B", borderColor: "#F3C6CE" }} onClick={() => { setConfirmDel((c) => !c); setEditing(false); setAssigning(false); }}><IconTrash size={14} stroke={1.8} /> Delete</button>}
            </div>
        <button type="button" className={`btn sm hist-btn ${histOpen ? "on" : ""}`} onClick={() => setHistOpen((v) => !v)}><IconHistory size={14} stroke={1.8} /> History &amp; comments</button>
      </div>
      <div className="d-head-main">
        {label && <div className="lbl" style={{ marginBottom: ".35rem" }}>{label}</div>}
        <div className="d-sub">{task.detail.typeLine && <span className="type-chip lg">{task.detail.typeLine}</span>}{task.detail.brand && <span className="sbu-chip lg">{task.detail.brand}</span>}</div>
        {/* Copy link sits beside the title, as in the task window, so the button row doesn't wrap. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}><div className="d-title" style={{ flex: 1, minWidth: 0 }}>{task.title}</div><CopyTaskLink id={task.id} /></div>
      </div>

      <>



          {assigning && (
            <div style={{ marginTop: ".5rem", border: "1px solid var(--line)", borderRadius: 10, padding: ".7rem" }}>
              <div className="mlbl" style={{ marginBottom: ".45rem" }}>Reassign to</div>
              <div style={{ display: "flex", gap: ".35rem", flexWrap: "wrap" }}>
                {Object.entries(PPL).map(([key, p]) => (
                  <button key={key} className="btn sm" disabled={busy} onClick={() => reassign(key)}>
                    <span style={{ marginRight: ".35rem", display: "inline-flex" }}><Avatar p={p} /></span>{p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Confirmation popup — same wording and look as the Master sheet's. Portalled
              to <body> (Overlay), so it sits above the task modal too. */}
          {confirmDel && (
            <Overlay onClose={() => { if (!busy) { setConfirmDel(false); setDelError(null); } }}
              className="fixed inset-0 bg-black/40 z-[300] flex items-center justify-center p-6">
              <div onClick={(e) => e.stopPropagation()} style={{ boxShadow: "0 24px 60px rgba(35,45,66,.24)" }}
                className="w-full max-w-md bg-white rounded-2xl overflow-hidden">
                <div className="flex items-start gap-3 px-5 pt-5">
                  <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-[#E9ECFB] text-[#3A57E8]"><IconTrash size={18} stroke={1.8} /></span>
                  <div className="min-w-0">
                    <h2 className="text-[16px] font-medium text-[#232D42]">Move this task to the recycle bin?</h2>
                    <p className="text-[14px] text-[#8A92A6] mt-1">It disappears from My Day, the Master sheet and the calendars for everyone. You can put it back from Master sheet → Recycle bin.</p>
                  </div>
                </div>
                <div className="mx-5 mt-4 rounded border border-gray-100 bg-[#F6F7FB] px-3 py-2 text-[14px] text-[#232D42] truncate">{task.title}</div>
                {delError && <div className="mx-5 mt-3 rounded bg-[#FDECEA] text-[#8a2e28] text-[14px] px-3 py-2">{delError}</div>}
                <div className="flex items-center justify-end gap-2 px-5 py-4 mt-4 border-t border-gray-100">
                  <button onClick={() => { setConfirmDel(false); setDelError(null); }} disabled={busy} className="h-9 px-3 rounded text-[14px] font-medium text-gray-600 hover:text-gray-900">Cancel</button>
                  <button onClick={doDelete} disabled={busy} className="h-9 px-4 rounded text-[14px] font-medium text-white bg-[#3A57E8] hover:brightness-110 disabled:opacity-50">
                    {busy ? "Moving…" : "Move to recycle bin"}
                  </button>
                </div>
              </div>
            </Overlay>
          )}
        </>

      {/* Owner (claimer) and Collaborators (writer) are distinct fields */}
      <div className="meta-grid" style={{ marginTop: "1.1rem" }}>
        <div>
          <div className="mlbl">Owner{editing && canOpenOwner && <Pen field="owner" />}</div>
          {editing && editField === "owner" && (
            <div className="fld-edit">
              {canAssign && Object.entries(PPL).map(([key, pp]) => (
                <button key={key} className="btn sm" disabled={busy} onClick={() => { reassign(key); setEditField(null); }}>
                  <span style={{ marginRight: ".35rem", display: "inline-flex" }}><Avatar p={pp} /></span>{pp.name}
                </button>
              ))}
              {poolable && (
                <button className="btn sm" disabled={busy} onClick={() => { releaseToPool(); setEditField(null); }}>Nobody — claim pool</button>
              )}
              {/* The pool is video work only (agreed 21 Oct): approved design work goes
                  to Praveen by rule. Say so where people look for it (Nandu, 13 Oct). */}
              {!isVideoType(task.detail.typeLine) && (
                <div style={{ fontSize: 12, color: "#8A92A6", marginTop: 4, width: "100%" }}>The claim pool is for video work — approved design work goes to whoever the Rules page hands it to.</div>
              )}
            </div>
          )}
          {/* Clicking the owner opens the picker. Reassigning was only reachable
              through the Reassign button in the header or by entering Edit mode
              first and finding the pencil, so clicking the name itself — the
              obvious thing — did nothing. "Give me change option or delete and
              add button" (Nandu, 6 Oct), clicked directly on the owner. */}
          {ownerP ? (
            <div className="collab-cell"
              onClick={canOpenOwner ? () => { setEditing(true); setEditField("owner"); } : undefined}
              style={canOpenOwner ? { cursor: "pointer" } : undefined}
              title={canAssign ? "Click to hand this to someone else" : canOpenOwner ? "Click to put it back in the claim pool" : undefined}>
              <Avatar p={ownerP} />
              <span className="collab-names">{ownerP.name}</span>
            </div>
          ) : (
            <div className="mval"
              onClick={canOpenOwner ? () => { setEditing(true); setEditField("owner"); } : undefined}
              style={canOpenOwner ? { cursor: "pointer" } : undefined}
              title={canOpenOwner ? "Click to assign an owner" : undefined}>
              {task.detail.owner}
            </div>
          )}
        </div>
        {/* Who is on camera. Only video has a presenter, and until now this was
            invisible once a task left the pool — so "who is doing what" could
            not be answered from the task itself. */}
        {isVideoType(task.detail.typeLine) && (
          <div>
            <div className="mlbl">On camera</div>
            {task.detail.presenter && PPL[task.detail.presenter] ? (
              <div className="collab-cell">
                <Avatar p={PPL[task.detail.presenter]} />
                <span className="collab-names">{PPL[task.detail.presenter].name}</span>
                {uploadedBy === task.detail.presenter && (
                  <button className="btn sm" disabled={busy} style={{ marginLeft: ".4rem" }}
                    onClick={() => setPresenter("")} title="You are no longer presenting this">Not me</button>
                )}
              </div>
            ) : uploadedBy && PPL[uploadedBy] ? (
              <button className="btn sm" disabled={busy} onClick={() => setPresenter(uploadedBy)}
                title="Record that you will be on camera — the editor still owns the task">I&rsquo;m on camera</button>
            ) : <div className="mval">Nobody yet</div>}
          </div>
        )}
        <div>
          <div className="mlbl">Collaborators{editing && addable.length > 0 && <span className="fld-hint" title="Use the + to add one">＋</span>}</div>
          <div className="collab-cell" style={{ position: "relative" }}>
            {collabs.length ? collabs.map((c, i) => {
              const ckey = Object.entries(PPL).find(([, pp]) => pp.name === c.name)?.[0];
              return (
                <span key={i} className="collab-chip">
                  <Avatar p={c} />
                  <span className="collab-names">{c.name}</span>
                  {ckey && (
                    <button type="button" className="collab-del" title={`Remove ${c.name}`} disabled={busy}
                      onClick={() => removeCollab(ckey)}>×</button>
                  )}
                </span>
              );
            }) : <span className="collab-names" style={{ color: "var(--faint)" }}>None yet</span>}
            {addable.length > 0 && (
              <button
                type="button"
                className="collab-add"
                title="Add a collaborator"
                disabled={busy}
                onClick={() => setAddingCollab((v) => !v)}
              >+</button>
            )}
            {addingCollab && (
              <div className="collab-menu">
                {addable.map(([key, p]) => (
                  <button key={key} type="button" className="collab-opt" disabled={busy} onClick={() => addCollab(key)}>
                    <Avatar p={p} />{p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <div className="mlbl">Priority{editing && <Pen field="prio" />}</div>
          <span className="pill" style={{ background: PRIO[prio].bg, color: PRIO[prio].fg }}>{prio}</span>
          {editing && editField === "prio" && (
            <div className="fld-dd">
              {Object.keys(PRIO).map((k) => (
                <button key={k} className={`fld-dd-item ${k === prio ? "on" : ""}`} onClick={() => { setPrio(k as typeof prio); setEditField(null); }}>
                  <span className="pill" style={{ background: PRIO[k as keyof typeof PRIO].bg, color: PRIO[k as keyof typeof PRIO].fg }}>{k}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Task clock — captured on create → done, so you can see how long it took.
            Same row as owner/collaborators/priority: they are read together. */}
        <div>
          <div className="mlbl">Created</div>
          <div className="mval">{fmtDT(task.detail.createdAt)}</div>
        </div>
        {modifiedAt && (
          <div>
            <div className="mlbl">Modified</div>
            <div className="mval">{fmtDT(modifiedAt)}</div>
          </div>
        )}
        <div>
          <div className="mlbl">Published Date{editing && <Pen field="due" />}</div>
          <div className="mval" style={{ color: "#2138B0", fontWeight: 500 }}>{task.detail.publishes}</div>
          {pendingDate && pendingDate !== task.due && (
            <div style={{ fontSize: 11.5, color: "#B7791F", marginTop: 2 }}>
              → {new Date(pendingDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, waiting for admin approval
            </div>
          )}
          {editing && editField === "due" && <div className="fld-edit"><DatePicker value={due} onChange={(v) => setDue(v)} /></div>}
        </div>
        <div><div className="mlbl">{task.detail.endAt ? "Time taken" : "Status"}</div><div className="mval">{task.detail.endAt ? durBetween(task.detail.startAt, task.detail.endAt) : "In progress"}</div></div>
      </div>

      {/* LIVE TIMER — only runs once the task is set to "In Progress" (start_at is
          stamped then). Counts real time vs the planned duration; nearing/over it
          asks INLINE (no popup): finished, or extend? Extending reshuffles the day. */}
      {timing && (
        // One line (Praveen, 27 Oct): planned · on the clock, a progress bar, what's
        // left (or how far over), then Output ready and Extend — always there, not only
        // in the last 15 minutes.
        <div className={`timer-strip ${timing.elapsed >= timing.planned ? "over" : ""}`}>
          <span className="timer-num">{ICLOCK} {fmtMins(timing.planned)} planned · <b>{fmtMins(timing.elapsed)}</b> on the clock</span>
          <span className="timer-track"><span className="timer-fill" style={{ width: `${Math.min(100, timing.planned ? (timing.elapsed / timing.planned) * 100 : 0)}%` }} /></span>
          <span className="timer-msg">{timing.elapsed >= timing.planned ? `Over by ${fmtMins(timing.elapsed - timing.planned)} — wrap up or add time?` : `${fmtMins(timing.planned - timing.elapsed)} left`}</span>
          {onStatusChange && onSetDuration && (
            <span className="timer-acts">
              <button className="btn sm primary" onClick={() => onStatusChange("Output - Ready")}><IconCheck size={14} stroke={2.2} /> Output ready</button>
              <ExtendPicker onExtend={(m, why) => onSetDuration(timing.planned + m, why)} />
            </span>
          )}
        </div>
      )}

      {/* Why this task got more time. Visible on the task itself, so an overrun is a
          short explanation anyone can read rather than a number nobody can account for. */}
      {(task.detail.extensions?.length ?? 0) > 0 && (() => {
        const log = task.detail.extensions!;
        // Net, not total: two +15s and one −30 is a task that ended up where it started,
        // and the header should say so rather than claiming half an hour was added.
        const net = log.at(-1)!.toMin - log[0].fromMin;
        const undone = new Set(log.map((e) => e.undoOf).filter(Boolean) as string[]);
        return (
          <div className="ext-log">
            <div className="mlbl" style={{ marginBottom: ".4rem" }}>
              {net === 0 ? "Time changed · back where it started" : `Time ${net > 0 ? "added" : "removed"} · ${signedMins(net)}`}
              {" "}over {log.length} {log.length === 1 ? "change" : "changes"}
            </div>
            {log.map((x, i) => {
              const delta = x.toMin - x.fromMin;
              const isUndo = !!x.undoOf;
              const wasUndone = undone.has(x.at);
              return (
                <div key={i} className={`ext-log-row${wasUndone ? " undone" : ""}`}>
                  <span className={`ext-log-amt${delta < 0 ? " neg" : ""}`}>{signedMins(delta)}</span>
                  <span className="ext-log-why">{isUndo && <span className="ext-log-tag">correction</span>}{x.reason}</span>
                  <span className="ext-log-who">{PPL[x.by]?.name || x.by} · {fmtDT(x.at)}</span>
                  {/* Only a real increase that hasn't been reversed can be undone, and
                      undoing appends the reversal rather than removing this row. */}
                  {onSetDuration && delta > 0 && !wasUndone && (
                    <button type="button" className="ext-log-undo" title={`Put back the ${signedMins(delta)}`}
                      onClick={async () => {
                        const why = await promptDialog({
                          title: `Take back ${signedMins(delta)}?`,
                          body: "This doesn't erase the original entry — it records a correction underneath it, so the task still shows what happened.",
                          action: "Take it back", defaultValue: "Added by mistake",
                        });
                        if (!why || !why.trim()) return;
                        onSetDuration(x.toMin - delta, why.trim(), x.at);
                      }}>Undo</button>
                  )}
                  {wasUndone && <span className="ext-log-undone-tag">taken back</span>}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Incorporating-Feedback notes from Manya (spec §7) — highlighted so the
          producer can't miss what to fix. */}
      {task.status === "Incorporating Feedback" && task.detail.feedback && (
        <div style={{ margin: "0 0 .9rem", padding: ".7rem .85rem", borderRadius: 10, background: "#FCE8EC", border: "1px solid #F3C0CB" }}>
          <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: ".04em", color: "#B0203A", marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}>{IWARN} Feedback from Manya</div>
          <ClampBox maxHeight={200}><div style={{ fontSize: 13, color: "#7A1327", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{task.detail.feedback}</div></ClampBox>
        </div>
      )}

      <div className="section-head">
        <span className="section-lbl">Content brief</span>
      </div>
      {/* The same always-editable editor as the hub's task window — headings, bullets,
          shortcuts, pasted lists kept — saving by itself (Praveen, 21 Oct: "add the
          editor in My Day too"). Edit → Save changes no longer touches the brief, so
          it can't write an older copy over what was typed here. */}
      <div className="brief" data-ref-preview data-ref-from="Brief">
        {canEdit !== false
          ? <RichTextField key={`brief-${task.id}`} maxHeight={360} value={task.detail.content || ""} placeholder="The write-up / brief — hook, body, CTA, specs…"
              onSave={async (next) => {
                const r = await fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: task.id, actor, fields: { content: next } }) });
                if (!r.ok) { const j = await r.json().catch(() => ({})); showToast({ who: "Couldn't save the brief", body: (j as { error?: string }).error || `HTTP ${r.status}`, color: "#C03221", av: "!" }); throw new Error("save refused"); }
                const saved = await r.json().catch(() => null);
                if (saved?.updatedAt) setModifiedAt(saved.updatedAt);
                onSaved?.();
              }} />
          : <Markdown value={task.detail.content || ""} />}
      </div>

      <CreativesSection key={`cr-${task.id}`} title={task.title} creatives={task.detail.creatives} outputLink={task.detail.outputLink} postId={task.id} uploadedBy={uploadedBy || "maheen"} onSaved={onSaved || (() => {})} />

      <ReferencesSection key={task.id} initial={task.detail.references || []} postId={task.id} uploadedBy={uploadedBy || "maheen"} onSaved={onSaved || (() => {})} />

      <AttachmentsSection key={`at-${task.id}`} files={task.detail.attachments || []} postId={task.id} uploadedBy={uploadedBy || "maheen"} onSaved={onSaved || (() => {})} />


    </div>
    {/* History & comments — closed until asked for; opens as a column inside this
        panel, not over the screen (prototype D, 22 Oct). */}
    {histOpen && (
      <aside className="hist-drawer" role="dialog" aria-label="History and comments">
        <div className="hist-drawer-h">
          <b>History &amp; comments</b>
          <button type="button" className="closebtn" onClick={() => setHistOpen(false)} title="Close"><IconX size={15} stroke={2} /></button>
        </div>
        <div className="hist-drawer-b"><TaskFeed key={`feed-${task.id}`} postId={task.id} /></div>
      </aside>
    )}
    </div>
  );
}

// My Day's copy of the Master sheet's activity timeline (TaskActivityFeed). My Day
// used to render task.detail.activity, which the server always sends empty, so
// every task here showed a blank history (Praveen, 28 Sep). This loads the same
// task-detail the Master sheet popup does; comments are posted as whoever is
// signed in (detail.me), exactly as there.
function TaskFeed({ postId }: { postId: string }) {
  type Detail = Parameters<typeof TaskActivityFeed>[0]["detail"] & { me?: string };
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/marketing-hub/task-detail?id=${encodeURIComponent(postId)}`, { credentials: "same-origin" });
      setDetail(r.ok ? await r.json() : null);
    } catch { setDetail(null); } finally { setLoading(false); }
  }, [postId]);
  useEffect(() => { reload(); }, [reload]);
  return (
    <div style={{ marginTop: ".4rem" }}>
      {err && <div style={{ color: "#C03221", fontSize: ".78rem", marginBottom: ".4rem" }}>{err}</div>}
      <TaskActivityFeed postId={postId} detail={detail} loading={loading} reload={reload}
        author={detail?.me || "maheen"} authorLabel={(k) => PPL[k]?.name || properName(k)} onError={setErr} />
    </div>
  );
}

// Custom Themed date picker (replaces the OS-native <input type=date> calendar).
// Task duration — quick presets PLUS a custom hours/minutes entry (no fixed set).
function DurationPicker({ value, onChange, open: openProp, onOpenChange, title }: { value?: number; onChange: (mins: number) => void; open?: boolean; onOpenChange?: (o: boolean) => void; title?: string }) {
  const [openOwn, setOpenOwn] = useState(false);
  const open = openProp ?? openOwn;
  const setOpen = (o: boolean | ((x: boolean) => boolean)) => { const v = typeof o === "function" ? o(open) : o; setOpenOwn(v); onOpenChange?.(v); };
  const [h, setH] = useState("");
  const [m, setM] = useState("");
  const PRESETS = [15, 30, 45, 60, 90, 120, 180];
  const applyCustom = () => {
    const mins = (parseInt(h || "0", 10) || 0) * 60 + (parseInt(m || "0", 10) || 0);
    if (mins > 0) { onChange(mins); setOpen(false); setH(""); setM(""); }
  };
  const chipStyle = (on: boolean): React.CSSProperties => ({ fontSize: 12, fontWeight: 500, padding: "5px 9px", borderRadius: 7, cursor: "pointer", border: on ? "1px solid #3A57E8" : "1px solid #E6E8EE", background: on ? "#3A57E8" : "#fff", color: on ? "#fff" : "#232D42" });
  const S: Record<string, React.CSSProperties> = {
    trigger: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500, color: value ? "var(--ink, #232D42)" : "var(--muted, #8A92A6)", background: "var(--panel, #fff)", border: "1px solid var(--line, #E6E8EE)", borderRadius: 9, padding: "0 12px", height: 36, boxSizing: "border-box", cursor: "pointer", whiteSpace: "nowrap" },
    pop: { position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 60, background: "var(--panel, #fff)", border: "1px solid var(--line, #E6E8EE)", borderRadius: 12, padding: 12, width: 244, boxShadow: "0 8px 24px rgba(20,30,60,.10)", textAlign: "left" },
    chips: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 },
    row: { display: "flex", alignItems: "center", gap: 6, borderTop: "1px solid #F0F1F5", paddingTop: 10 },
    num: { width: 46, textAlign: "center", fontSize: 13, border: "1px solid #E6E8EE", borderRadius: 7, padding: "5px 4px", outline: "none" },
    set: { marginLeft: "auto", fontSize: 12, fontWeight: 500, background: "#3A57E8", color: "#fff", border: "none", borderRadius: 7, padding: "6px 12px", cursor: "pointer" },
    lbl: { fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: ".04em", color: "#8A92A6", marginBottom: 6 },
  };
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button type="button" style={S.trigger} onClick={() => setOpen((o) => !o)}>
        <span title="Task duration">{ICLOCK}</span> {value ? fmtDur(value) : "Set duration…"} {CHEV}
      </button>
      {open && (
        <>
          <span style={{ position: "fixed", inset: 0, zIndex: 59 }} onClick={() => setOpen(false)} />
          <div style={S.pop} onClick={(e) => e.stopPropagation()}>
            {title && <div style={{ fontSize: 13, fontWeight: 500, color: "#232D42", marginBottom: 8 }}>{title}</div>}
            <div style={S.lbl}>Quick pick</div>
            <div style={S.chips}>
              {PRESETS.map((p) => (
                <button key={p} type="button" style={chipStyle(value === p)} onClick={() => { onChange(p); setOpen(false); }}>{fmtDur(p)}</button>
              ))}
            </div>
            <div style={S.lbl}>Custom</div>
            <div style={S.row}>
              <input type="number" min={0} max={12} value={h} onChange={(e) => setH(e.target.value)} placeholder="0" style={S.num} /><span style={{ fontSize: 12, color: "#8A92A6" }}>h</span>
              <input type="number" min={0} max={59} value={m} onChange={(e) => setM(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyCustom(); }} placeholder="0" style={S.num} /><span style={{ fontSize: 12, color: "#8A92A6" }}>m</span>
              <button type="button" style={S.set} onClick={applyCustom}>Set</button>
            </div>
          </div>
        </>
      )}
    </span>
  );
}

// One swap candidate in Manya's Requests — she can move it to the default +1-day
// date OR pick ANY custom date, then hand the queued task over.
function SwapCandidateRow({ c, defaultDate, onMove }: { c: SwapCand; defaultDate: string; onMove: (date: string) => void }) {
  const [date, setDate] = useState(defaultDate);
  const todayISO = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const label = (() => { try { return new Date(date + "T00:00:00").toLocaleDateString("en-US", { day: "numeric", month: "short" }); } catch { return date; } })();
  return (
    <div className="claim-row" style={{ borderBottom: "none", padding: ".35rem 0", gap: ".5rem", alignItems: "center" }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="claim-title">{c.title}</div>
        <div className="claim-meta">{fmtMins(c.dur)}{c.due ? ` · due ${c.due}` : ""} · <b style={{ color: "#3A57E8" }}>→ moves to {label}</b></div>
      </div>
      <input type="date" value={date} min={todayISO} onChange={(e) => setDate(e.target.value)} title="Pick the date to move it to (today or later)" style={{ fontSize: 12, border: "1px solid #E6E8EE", borderRadius: 7, padding: "4px 6px", color: "#232D42" }} />
      <button className="btn primary sm" disabled={!date} onClick={() => onMove(date)}>Move · hand over</button>
    </div>
  );
}


// Create-task flow (writer/Manya only). On submit it runs the Type→owner routing
// so you can watch where the task lands — design types to Praveen, video to the
// editors' claim pool. The routing preview updates live as you change the Type.

// "Tasks I created" — the window the card measures over. The keys are the ones
// /api/my-day/created's windowFor() understands; `empty` finishes the sentence
// "You haven't created anything …" when a window comes back with nothing.
type CreatedRange = "today" | "yesterday" | "2d" | "7d" | "30d" | "this-month" | "last-month" | "3m" | "6m" | "year" | "all" | "custom" | "dates";
const CREATED_RANGE_OPTIONS: { value: CreatedRange; label: string; empty: string }[] = [
  { value: "today", label: "Today", empty: "today" },
  { value: "yesterday", label: "Yesterday", empty: "yesterday" },
  { value: "2d", label: "Last 2 days", empty: "in the last 2 days" },
  { value: "7d", label: "Last 7 days", empty: "in the last 7 days" },
  { value: "30d", label: "Last 30 days", empty: "in the last 30 days" },
  { value: "this-month", label: "This month", empty: "this month" },
  { value: "last-month", label: "Last month", empty: "last month" },
  { value: "3m", label: "Last 3 months", empty: "in the last 3 months" },
  { value: "6m", label: "Last 6 months", empty: "in the last 6 months" },
  { value: "year", label: "This year", empty: "this year" },
  { value: "all", label: "All time", empty: "yet" },
  { value: "custom", label: "Last … hours / days", empty: "in that window" },
  { value: "dates", label: "Pick dates…", empty: "between those dates" },
];
// The custom window is a ROLLING one — "last 6 hours" means the last 6 hours, not
// since 6 AM. Capped server-side at 2 years either way; these are the same caps so the
// input can't offer a number the server would silently shrink.
const CUSTOM_UNIT_MAX = { hours: 17520, days: 730 };




// The notification stack — sits at the TOP of the chat panel and pushes the chat
// down (never overlays it). Urgent/freed notifications carry an Accept & Work
// action; claims and messages are informational.
function NotificationStack({ notifs, onAccept, onDismiss, onClearAll, onTimeUp }: { notifs: Notif[]; onAccept: (n: Notif) => void; onDismiss: (id: string) => void; onClearAll: () => void; onTimeUp?: (n: Notif, choice: "done" | "extend") => void }) {
  if (!notifs.length) return null;
  return (
    <div className="notif-stack">
      <div className="nstack-head"><span>{notifs.length} notification{notifs.length > 1 ? "s" : ""}</span><button className="nstack-clear" onClick={onClearAll}>Clear all</button></div>
      {notifs.map((n) => (
        <div key={n.id} className={`pnotif ${n.kind}`}>
          <div className={`pn-ic ${n.kind}`}>{(() => { const I = notifIconFor(n.emoji); return <I size={15} stroke={1.9} />; })()}</div>
          <div className="pn-body">
            {n.kind === "urgent" && <div className="pn-eyebrow">Urgent · must publish today</div>}
            <div className="pn-title">{n.title}</div>
            <div className="pn-sub">{n.sub}</div>
            {n.timeUp ? (
              <div className="pn-acts">
                <button className="btn primary sm" onClick={() => onTimeUp?.(n, "done")}>Task completed</button>
                <button className="btn sm" onClick={() => onTimeUp?.(n, "extend")}>Extend</button>
              </div>
            ) : (n.kind === "urgent" || n.kind === "freed" || n.accept) && (
              <div className="pn-acts">
                <button className="btn primary sm" onClick={() => onAccept(n)}>Accept &amp; work</button>
                {n.kind === "urgent" && <button className="btn sm" onClick={() => onDismiss(n.id)}>Later</button>}
              </div>
            )}
          </div>
          <button className="pn-x" onClick={() => onDismiss(n.id)} title="Dismiss"><IconX size={13} stroke={2} /></button>
        </div>
      ))}
    </div>
  );
}

// Accept & Work — does the capacity math against the person's Today's plan and
// offers the two honest choices: take the overtime, or ask Manya to free room.
function AcceptWorkModal({ task, committed, onAcceptWork, onAskManya, onClose }: { task: Task; committed: number; onAcceptWork: () => void; onAskManya: () => void; onClose: () => void }) {
  const add = estMins(task.detail.typeLine);
  const free = Math.max(0, WORK_MIN - committed);
  const fits = add <= free;
  const over = Math.max(0, committed + add - WORK_MIN);
  const finish = finishLabel(committed, add);
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card aw-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} title="Close"><IconX size={14} stroke={2} /></button>
        <div className="aw-h">Accept this task?</div>
        <div className="aw-task"><div className="tt">{task.title}</div><div className="tm">{task.detail.typeLine} · adds ~{fmtMins(add)} to your day</div></div>
        <div className={`impact ${fits ? "ok" : ""}`}>
          <span>{ICLOCK}</span>
          {fits
            ? <span>You have <b>{fmtMins(free)}</b> free today — this fits. You&rsquo;d still finish by <b>{DAY_END_LABEL}</b>.</span>
            : <span>Your day is <b>9:00 AM–{DAY_END_LABEL}</b>. Adding this pushes you to <b className="over">{finish}</b> — you&rsquo;d work <b>{fmtMins(over)} over</b> your usual checkout.</span>}
        </div>
        <div className="aw-choice">
          <button className="btn primary" onClick={onAcceptWork}>{fits ? "Accept & work" : `Accept & work — finish ${finish}`}</button>
          {/* The swap option is ALWAYS available — and the producer never picks:
              their whole not-started list is sent to MANYA, who chooses the swap. */}
          <div className="aw-or">{fits ? "or, if you'd rather swap" : "or, if you can't stretch"}</div>
          <button className="btn" onClick={onAskManya}>Send my not-started list to Manya — she picks the swap</button>
        </div>
      </div>
    </div>
  );
}

// Ask Manya — shows the editor's low-priority, movable tasks so Manya can slide one
// to tomorrow. (Stage 1 simulates her freeing room right after sending.)
function AskManyaModal({ onSend, onClose }: { onSend: () => void; onClose: () => void }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card aw-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} title="Close"><IconX size={14} stroke={2} /></button>
        <div className="aw-h">Ask Manya to free up room</div>
        <p className="aw-p">These of yours can slip to tomorrow — Manya picks one to move so the urgent reel fits. Must-go-today tasks stay put.</p>
        <div className="tchips">
          {MOVABLE.map((m) => (
            <div key={m.id} className="tchip movable"><div className="cmid"><div className="ct">{m.title}</div><div className="cs">{m.note}</div></div><span className="pri low">Low · can move</span></div>
          ))}
        </div>
        <div className="aw-choice"><button className="btn primary" onClick={onSend}>Send request to Manya</button></div>
      </div>
    </div>
  );
}

// Manya's reschedule card — she sees the packed editor's movable tasks, slides one
// to tomorrow, and confirms. Confirming frees room in his plan (pipeline → freed).
function ManyaReschedule({ task, editorName, movedId, onMove, onConfirm }: { task: Task; editorName: string; movedId: string | null; onMove: (id: string) => void; onConfirm: () => void }) {
  return (
    <div className="card pad manya-resched">
      <div className="mr-h">
        <div className="mr-ic">{ICLOCK}</div>
        <div><div className="mr-t">{editorName} is packed — needs room for an urgent task</div><div className="mr-d">Slide one of {editorName}&apos;s low-priority reels to tomorrow so <b>{task.title}</b> fits. Must-go-today tasks stay put.</div></div>
      </div>
      <div className="tchips" style={{ marginTop: ".9rem" }}>
        {MOVABLE.map((m) => (
          <div key={m.id} className={`tchip ${movedId === m.id ? "" : "movable"}`}>
            <div className="cmid"><div className="ct">{m.title}</div><div className="cs">{movedId === m.id ? <b style={{ color: "var(--good)" }}>Moved to tomorrow ✓</b> : m.note}</div></div>
            <span className="pri low">Low</span>
            {movedId === m.id ? <span className="cap-badge some">Moved</span> : <button className="btn sm" onClick={() => onMove(m.id)}>Move to tomorrow</button>}
          </div>
        ))}
      </div>
      <div className="mr-foot">
        <span className="mr-note">{movedId ? `Frees ~1h 30m on ${editorName}'s day.` : "Pick one to move to tomorrow."}</span>
        <button className="btn primary" disabled={!movedId} onClick={onConfirm}>✓ Changes done</button>
      </div>
    </div>
  );
}

// The Team-capacity PAGE (opened from the 👥 button, next to the bell) — its own
// screen so Manya never confuses it with her own plan. Each teammate shows their
// day planner (done faded, current highlighted + now-line) and what they're on now.
type CapBlock = { k: string; l: string; f: number; s?: "done" | "now"; start?: number; durMin?: number };
// REAL data: each producer's day is laid out from their actual in-production tasks
// (duration = estimate by type), sequential from 9 AM around the fixed 1 PM lunch.
// done/now flags come from the real clock. No fabricated schedules.
function TeamCapacityPage({ onBack, tasks, nowMin, logins }: { onBack: () => void; tasks: Task[]; nowMin: number | null; logins: Record<string, number> }) {
  const PRODUCERS = [
    { key: "praveen", name: "Praveen", role: "Designer", av: "P", color: "#C2410C" },
    { key: "nikhil", name: "Nikhil", role: "Video editor", av: "N", color: "#3A57E8" },
    { key: "nandu", name: "Nandu", role: "Video editor", av: "N", color: "#6E48F8" },
  ];
  // Day = what's actually on their plate TODAY (due today / overdue). Week = the
  // whole approved backlog against a 5-day (40h) capacity — one person can't do a
  // week's load in a day, so the two must never be conflated.
  const [span, setSpan] = useState<"today" | "week">("today");
  // Week capacity = Mon–Fri ONLY (no Sat/Sun), 7 productive hours a day with the
  // 1–2 PM lunch excluded → 35h. Today stays the 8h working day.
  const WEEK_MIN = 7 * 60 * 5;
  const capacity = span === "today" ? WORK_MIN : WEEK_MIN;
  const d0 = new Date();
  const todayStr = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(d0.getDate()).padStart(2, "0")}`;
  const now = Math.max(0, Math.min(nowMin ?? 0, DAY_MINS));
  const rows = PRODUCERS.map((p) => {
    const mine = tasks
      // Producers work only APPROVED content (role rule) …
      .filter((t) => t.detail.owner === p.name && (t.status === "Content - Approved" || t.status === "Incorporating Feedback"))
      // … and the Day view narrows to what's actually due by today.
      .filter((t) => span === "week" || !t.due || t.due <= todayStr)
      .map((t) => ({ label: t.title, dur: t.detail.duration || estMins(t.detail.typeLine), video: /reel|short|video|long-form/i.test(t.detail.typeLine), due: t.due }));
    const committed = mine.reduce((s, t) => s + t.dur, 0);
    // Today's day starts at max(shift, login) — a 10 AM login leaves less room.
    const shift = shiftStartOf(p.name);
    const dayFrom = Math.max(shift, logins[p.key] ?? shift);
    const rowCap = span === "today" ? workAvailFrom(dayFrom, shift) : capacity;
    const freeMin = rowCap - committed;
    const blocks: CapBlock[] = [];
    let cursor = dayFrom, lunchDone = false, current: { label: string; endsIn: number } | null = null;
    // Week view buckets these into Mon–Fri columns (below). todayCol = live column.
    const todayW = (d0.getDay() + 6) % 7;                 // Mon=0 … Sun=6
    const todayCol = todayW <= 4 ? todayW : 0;            // weekend viewer → Mon
    const weekDays = Array.from({ length: 5 }, () => ({ committed: 0, tasks: [] as { label: string; dur: number; video: boolean }[] }));
    if (span === "today") {
      // Sequential layout from 9 AM. LUNCH IS THE OFFICE STANDARD 1–2 PM — pinned,
      // never floating to wherever the tasks happen to end (tasks split around it,
      // and an early finish gets a Free gap so lunch still sits at 1 PM).
      const LUNCH_END = LUNCH_AT + LUNCH_MIN;
      // Every block carries exact start/duration MINUTES — the track renders them
      // absolutely (left/width %), so Lunch sits pixel-perfect on the 1 PM tick
      // (flex layouts drift: long labels push blocks off the grid).
      const pushTask = (label: string, video: boolean, start: number, dur: number) => {
        const s = start + dur <= now ? "done" : start <= now && now < start + dur ? "now" : undefined;
        if (s === "now") current = { label, endsIn: start + dur - now };
        blocks.push({ k: video ? "reel" : "design", l: label, f: dur / 60, s, start, durMin: dur });
      };
      const pushLunch = () => { blocks.push({ k: "lunch", l: "Lunch", f: 1, start: LUNCH_AT, durMin: LUNCH_MIN }); cursor = LUNCH_END; lunchDone = true; };
      const pushFree = (start: number, dur: number) => blocks.push({ k: "free", l: "Free", f: dur / 60, start, durMin: dur });
      for (const t of mine) {
        let remaining = t.dur;
        if (!lunchDone && cursor >= LUNCH_AT && cursor < LUNCH_END) pushLunch();
        if (!lunchDone && cursor < LUNCH_AT) {
          const before = Math.min(remaining, LUNCH_AT - cursor);
          if (before > 0) { pushTask(t.label, t.video, cursor, before); cursor += before; remaining -= before; }
          if (remaining > 0) pushLunch();
        }
        if (remaining > 0) { pushTask(t.label, t.video, cursor, remaining); cursor += remaining; }
      }
      if (!lunchDone) {
        if (cursor < LUNCH_AT) { pushFree(cursor, LUNCH_AT - cursor); cursor = LUNCH_AT; }
        pushLunch();
      }
      if (cursor < DAY_MINS) pushFree(cursor, DAY_MINS - cursor);
    } else {
      // Week: bucket each approved task into a Mon–Fri column by its due-date weekday.
      // No-due / overdue / weekend-due fall into TODAY's column (it needs doing now).
      for (const t of mine) {
        let col = todayCol;
        if (t.due && t.due >= todayStr) { const w = (new Date(t.due).getDay() + 6) % 7; if (w <= 4) col = w; }
        weekDays[col].committed += t.dur;
        weekDays[col].tasks.push({ label: t.label, dur: t.dur, video: t.video });
      }
    }
    const badge: "free" | "some" | "full" = freeMin >= rowCap / 4 ? "free" : freeMin > 0 ? "some" : "full";
    // (cast: TS can't see the closure assignment inside pushTask)
    const cur = current as { label: string; endsIn: number } | null;
    const next = cur || (mine.length ? { label: mine[0].label, endsIn: 0 } : null);
    return { ...p, committed, freeMin, badge, blocks, current: cur, next, overflow: cursor > capacity, weekDays, todayCol };
  });
  return (
    <div className="tcp">
      <div className="tcp-head">
        <button className="tc-back" onClick={onBack} title="Back to My Day">‹</button>
        <div className="tcp-title">Team capacity <span>· {span === "today" ? "due today, vs an 8h day" : "approved backlog, vs a 35h week (Mon–Fri · 7h/day, lunch excluded)"} — from each person&apos;s real tasks</span></div>
        <div className="switch tcp-span" role="tablist">
          <button role="tab" aria-selected={span === "today"} className={span === "today" ? "on" : ""} onClick={() => setSpan("today")}>Today</button>
          <button role="tab" aria-selected={span === "week"} className={span === "week" ? "on" : ""} onClick={() => setSpan("week")}>Week</button>
        </div>
      </div>
      {rows.map((p) => (
        <div key={p.key} className="card pad tcp-card">
          <div className="tcp-top">
            <Avatar p={p} cls="av" />
            <div><div className="tcp-n">{p.name}</div><div className="tcp-r">{p.role}</div></div>
            <div className="tcp-status">
              <span className="st-badge working">{fmtMins(p.committed)} committed</span>
              <span className={`cap-badge ${p.badge}`}>{p.freeMin > 0 ? `${fmtMins(p.freeMin)} free` : p.overflow ? `Overbooked · ${fmtMins(-p.freeMin)} over` : "Full"}</span>
            </div>
          </div>
          {span === "today" ? (
            <>
              <div className="tl-ticks tcp-ticks">{HOUR_TICKS.map((t, i) => <span key={i}>{t}</span>)}</div>
              <div className="tcp-track">
                {p.blocks.map((b, i) => (
                  <div
                    key={i}
                    className={`tcp-blk ${b.k} ${b.s || ""}`}
                    style={b.start !== undefined
                      ? { position: "absolute", top: 0, bottom: 0, left: `${(b.start / DAY_MINS) * 100}%`, width: `${((b.durMin || 0) / DAY_MINS) * 100}%` }
                      : { flex: b.f, minWidth: 0 }}
                    title={b.l}
                  >
                    {b.l}{b.s === "done" && <div className="tcp-bm">done</div>}{b.s === "now" && <div className="tcp-bm">now</div>}
                  </div>
                ))}
                {nowMin !== null && nowMin >= 0 && nowMin <= DAY_MINS && <div className="tcp-now-line" style={{ left: `${(now / DAY_MINS) * 100}%` }}><span className="now-tag">● now</span></div>}
              </div>
            </>
          ) : (
            // WEEK: 5 Mon–Fri columns; today's column is flagged live so you see the
            // person's load right now vs across the rest of the week.
            <div className="tcp-week">
              {p.weekDays.map((day, di) => (
                <div key={di} className={`tcp-day ${di === p.todayCol ? "today" : ""} ${day.committed > WEEK_DAY_CAP ? "over" : ""}`}>
                  <div className="tcp-day-h">{WEEKDAYS[di]}{di === p.todayCol && <span className="tcp-day-now">● today</span>}</div>
                  <div className="tcp-day-bar" title={`${WEEKDAYS[di]} · ${day.committed ? fmtMins(day.committed) : "nothing"} of 7h`}>
                    {day.tasks.map((t, ti) => (
                      <div key={ti} className={`tcp-day-seg ${t.video ? "reel" : "design"}`} style={{ height: `${Math.min(100, (t.dur / WEEK_DAY_CAP) * 100)}%` }} title={`${t.label} · ${fmtMins(t.dur)}`} />
                    ))}
                  </div>
                  <div className="tcp-day-f">{day.committed ? fmtMins(day.committed) : "—"}</div>
                </div>
              ))}
            </div>
          )}
          <div className="tcp-now">
            <span className="dot" />
            {span === "week"
              ? (() => { const n = p.weekDays.reduce((s, d) => s + d.tasks.length, 0); return n ? <>This week&apos;s queue: <b>{n} approved task{n > 1 ? "s" : ""}</b> <span className="muted">· {fmtMins(p.committed)} of 35h (Mon–Fri)</span></> : <span className="muted">No approved work queued this week.</span>; })()
              : p.current
              ? <>Currently working on: <b>{p.current.label}</b> <span className="muted">· ~{fmtMins(p.current.endsIn)} left in this block</span></>
              : p.next
              ? <>Up next: <b>{p.next.label}</b></>
              : <span className="muted">Nothing due today — free to take work.</span>}
          </div>
        </div>
      ))}
      <div className="hint" style={{ padding: "0 .3rem" }}>Opened from the Team capacity button — a separate page, so it never gets mixed up with your own plan.</div>
    </div>
  );
}

// End-today wrap-up — confirm what's done; unchecked tasks roll to tomorrow.
type EodTask = { id: string; title: string; status: CCStatus; due: string; typeLine: string; publishes: string };

/**
 * Has THIS person finished with the task? Not "is the task finished" — the two are
 * different, and conflating them is what made the old wrap-up ask the writer to
 * account for work that left her desk hours ago.
 *   · the writer is done once the content is approved and off to a producer
 *   · a producer is done once the output is ready
 * Incorporating Feedback is the exception on both sides: it is back in someone's
 * court by definition, so it always counts as outstanding.
 */
// "Sep 25, 2026" told you the date but not what it meant. Near dates get named —
// Today / Tomorrow / Yesterday — and everything else is a short day-and-month, with
// the year only when it isn't this one.
function publishLabel(due: string, today: string): string {
  if (!due) return "No date";
  const d = Math.round((new Date(due + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86_400_000);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  const dt = new Date(due + "T00:00:00");
  const sameYear = dt.getFullYear() === new Date(today + "T00:00:00").getFullYear();
  const short = dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  return d < 0 ? `${short} · late` : short;
}

function finishedForRole(status: CCStatus, isWriter: boolean): boolean {
  if (status === "Incorporating Feedback") return false;
  return isWriter
    ? STATUS[status].stage >= 2
    : status === "Output - Ready" || status === "Ready to Publish" || status === "Published/Scheduled";
}

/**
 * Wrap up your day.
 *
 * It used to list EVERY open task — fifty-odd rows in one column — so the one question
 * it asks ("what did you finish today?") was buried. It now shows today's work only,
 * grouped by status so the list reads in blocks instead of a jumble, with the
 * publishing date on each line.
 */
function EndTodayModal({ tasks, isWriter, today, onEnd, onClose }: { tasks: EodTask[]; isWriter: boolean; today: string; onEnd: (done: number, roll: number, rolled: { id: string; title: string; reason: string }[]) => void; onClose: () => void }) {
  const [done, setDone] = useState<Set<string>>(new Set(tasks.filter((t) => finishedForRole(t.status, isWriter)).map((t) => t.id)));
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const toggle = (id: string) => setDone((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const doneN = done.size, rollN = tasks.length - doneN;
  // Spec §10: every task that rolls to tomorrow needs a reason before the day can end.
  const rolling = tasks.filter((t) => !done.has(t.id));
  const missing = rolling.some((t) => !(reasons[t.id] || "").trim());

  // Grouped by status, and the groups that still need something come first — the work
  // you have to act on shouldn't be scattered between the work you've already closed.
  const groups = useMemo(() => {
    const by = new Map<CCStatus, EodTask[]>();
    for (const t of tasks) by.set(t.status, [...(by.get(t.status) || []), t]);
    return [...by.entries()].sort(([a], [b]) => {
      const aDone = finishedForRole(a, isWriter) ? 1 : 0, bDone = finishedForRole(b, isWriter) ? 1 : 0;
      return aDone - bDone || STATUS[a].stage - STATUS[b].stage;
    });
  }, [tasks, isWriter]);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card eod-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} title="Close"><IconX size={14} stroke={2} /></button>
        <div className="aw-h">Wrap up your day</div>
        <p className="aw-p">Today&apos;s work only. {isWriter ? "Approved content is already off your desk" : "Anything you’ve made ready is counted"} — tick anything else you finished, and say why the rest is rolling.</p>
        {tasks.length === 0 && <div className="empty" style={{ padding: "1.4rem 0" }}>Nothing was due today ✓</div>}
        {tasks.length > 0 && (
          <div className="eod-list">
            <table className="eod-table">
              <thead>
                <tr><th className="c-cb" /><th className="c-task">Task</th><th className="c-pub">Publishing</th><th className="c-act">Finished?</th></tr>
              </thead>
              {groups.map(([status, rows]) => {
                const st = STATUS[status];
                return (
                  <tbody key={status}>
                    <tr className="eod-grouprow">
                      <td colSpan={4}>
                        <span className="pill xs" style={{ background: TONE[st.tone].bg, color: TONE[st.tone].fg }}>{st.label}</span>
                        <span className="eod-group-n">{rows.length}</span>
                      </td>
                    </tr>
                    {rows.map((t) => {
                      const isDone = done.has(t.id);
                      return (
                        <tr key={t.id} className={`eod-line ${isDone ? "done" : "roll"}`}>
                          <td className="c-cb">
                            <button type="button" className={`eod-cb ${isDone ? "on" : ""}`} onClick={() => toggle(t.id)}
                              aria-pressed={isDone} title={isDone ? "Mark as not finished" : "Mark as finished"}>{isDone ? "✓" : ""}</button>
                          </td>
                          <td className="c-task"><span className="eod-title" title={t.title}>{t.title}</span></td>
                          <td className={`c-pub${t.due && t.due <= today ? " near" : ""}`}>{publishLabel(t.due, today)}</td>
                          <td className="c-act">
                            {isDone
                              ? <span className="eod-tag done">Done</span>
                              : <input
                                  className="eod-reason"
                                  value={reasons[t.id] || ""}
                                  onChange={(e) => setReasons((r) => ({ ...r, [t.id]: e.target.value }))}
                                  placeholder="Why not? It moves to tomorrow"
                                />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
        <div className="eod-foot">
          <span className="m-note">{doneN} done · {rollN} roll to tomorrow · Your day report is shared with the team when you log out.</span>
          <div style={{ display: "flex", gap: ".5rem" }}>
            <button className="btn" onClick={onClose}>Back to My Day</button>
            <button className="btn rose" disabled={missing} title={missing ? "Add a reason for each rolled-over task" : undefined} onClick={() => onEnd(doneN, rollN, rolling.map((t) => ({ id: t.id, title: t.title, reason: (reasons[t.id] || "").trim() })))}>Log out</button>
          </div>
        </div>
      </div>
    </div>
  );
}

type CapEntry = { permissions: Permissions; isAdmin: boolean };

export function PreviewMyDay({ initialPerson, isAdmin: viewerIsAdmin = false, viewerId }: { initialPerson?: string; isAdmin?: boolean; viewerId?: string } = {}) {
  useAppSettings();   // task times and the reminder from the Rules page
  // Team-page newcomers: into PPL (chips, chat) and the person switcher.
  usePplTeam();
  const rosterTeam = useTeam();
  const [, bumpTeam] = useState(0);
  useEffect(() => {
    if (mergeTeam(TEAM, rosterTeam, (t) => t.key,
      (p) => ({ key: p.id, name: p.first, role: p.role, av: p.first.charAt(0).toUpperCase(), color: NEWCOMER_COLOR }), ["maheen"])) bumpTeam((n) => n + 1);
  }, [rosterTeam]);
  const sbus = useSbus();   // live brand list (sql/027)
  // Profile pictures (Account page) → PHOTOS, so every <Avatar> shows them.
  const [, setPhotosVer] = useState(0);
  useEffect(() => {
    fetch("/api/team-photos").then((r) => (r.ok ? r.json() : null)).then((d: { photos?: Record<string, string> } | null) => {
      if (!d?.photos) return;
      Object.assign(PHOTOS, d.photos);
      setPhotosVer((v) => v + 1);
    }).catch(() => {});
  }, []);
  // `person` = whose day is shown. Seeded from the logged-in user (server-passed);
  // producers are locked to themselves, only admins can switch via the header tabs.
  const [person, setPerson] = useState(initialPerson || "manya");
  // Team-permission capabilities, keyed by first name (lowercase). Drives which
  // action buttons show. Sourced from the roster (admins) so the person switcher
  // previews everyone; falls back to /api/me for the logged-in person.
  const [capByPerson, setCapByPerson] = useState<Record<string, CapEntry>>({});
  useEffect(() => {
    let cancel = false;
    (async () => {
      const map: Record<string, CapEntry> = {};
      try {
        const me = await (await fetch("/api/me", { cache: "no-store" })).json();
        if (me?.user?.first) map[String(me.user.first).toLowerCase()] = { permissions: me.user.permissions || {}, isAdmin: !!me.user.isAdmin };
      } catch { /* ignore */ }
      try {
        const r = await fetch("/api/admin/team", { cache: "no-store" });
        if (r.ok) { const j = await r.json(); for (const u of j.team || []) if (u.first) map[String(u.first).toLowerCase()] = { permissions: u.permissions || {}, isAdmin: !!u.isAdmin }; }
      } catch { /* non-admin: roster stays unfetched, /api/me fallback covers self */ }
      if (!cancel) setCapByPerson(map);
    })();
    return () => { cancel = true; };
  }, []);
  // Which row of the task list is open in the right-hand panel. null = nothing open,
  // which is now the resting state: the panel offers "New task" instead of
  // auto-opening whatever happened to sort first.
  const [sel, setSel] = useState<number | null>(null);
  const [claimPool, setClaimPool] = useState<Task[]>([]);             // videos up for grabs (live)
  const [showClaimPool, setShowClaimPool] = useState(false);          // editors' claim-pool modal (legacy)
  const [claimedTasks, setClaimedTasks] = useState<Task[]>([]);        // videos I claimed this session
  // Claims whose save hasn't answered yet. Only these may outlive a refetch that
  // shows someone else as owner — once saved, the server is the truth. Without this
  // a claim later undone elsewhere (e.g. an Airtable sync resetting the owner) stayed
  // on the board for the rest of the session, next to the server's own copy.
  const claimsInFlight = useRef<Set<string>>(new Set());
  const [claimConfirm, setClaimConfirm] = useState<string | null>(null); // inline "Claim? Y/N" — the pool-video id being confirmed
  // "This video also has a thumbnail — who makes it?", asked only when the writer
  // left that open ("let them decide"). docs/THUMBNAIL_FLOW_SPEC.md.
  const [thumbAsk, setThumbAsk] = useState<{ thumbId: string; videoId: string; videoTitle: string; type: string } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);                     // my tasks — live from mh_posts (status is mutable)
  const [createdFilter, setCreatedFilter] = useState<"open" | "published" | "all">("all");
  // "Tasks I created" loads separately from /api/my-day/created so the range picker
  // can reach past the main feed's fixed 60-day window without re-running that whole
  // composite query. Opens on the last 3 months.
  const [createdRows, setCreatedRows] = useState<Task[]>([]);
  const [createdRange, setCreatedRange] = useState<CreatedRange>("3m");
  const [createdBusy, setCreatedBusy] = useState(false);
  const [createdCapped, setCreatedCapped] = useState(false);
  // Custom window ("last N hours / days"). `createdAmtText` is what's in the box —
  // kept as text so the field can be empty mid-typing without snapping back to a
  // number; `createdAmt` is the debounced, validated value the query actually uses.
  const [createdAmtText, setCreatedAmtText] = useState("7");
  const [createdAmt, setCreatedAmt] = useState(7);
  const [createdUnit, setCreatedUnit] = useState<"hours" | "days">("days");
  // "Pick dates…" — a From–To range of days (IST), both included.
  const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const [createdFrom, setCreatedFrom] = useState(istToday);
  const [createdTo, setCreatedTo] = useState(istToday);
  // Type / SBU narrowing. Applied in the browser over the rows already fetched for the
  // window — instant, and the tab counts follow them.
  const [createdType, setCreatedType] = useState<string>("all");
  const [createdSbu, setCreatedSbu] = useState<string>("all");
  const [openCreatedId, setOpenCreatedId] = useState<string | null>(null); // click a "Tasks I created" row to see it
  const [samvaya, setSamvaya] = useState<Task[]>([]);                 // Nandu's Samvaya / other-platform tasks (spec §14, kept separate)
  const [loading, setLoading] = useState(true);                       // first live load in flight
  const [taskTab, setTaskTab] = useState("approved");                  // status tab (per-person)
  // Personal reminders — REAL per-person notes, persisted in localStorage (a
  // scratchpad, not shared team data — server table only if cross-device matters).
  const [reminders, setReminders] = useState<{ text: string; done: boolean }[]>([]);
  const [dismissedNudges, setDismissedNudges] = useState<string[]>([]); // reminder ids the person dismissed (per person, localStorage)
  const [newRem, setNewRem] = useState("");
  const [chatMsgs, setChatMsgs] = useState<ServerMsg[]>([]);   // live messages (team + my DMs)
  const [chatRead, setChatRead] = useState<Record<string, string>>({}); // convoId → last-read ISO (localStorage)
  const [activeChat, setActiveChat] = useState<string | null>(null); // open thread (null = list)
  const [msg, setMsg] = useState("");
  const [clock, setClock] = useState<{ time: string; date: string; greet: { word: string; emoji: string } } | null>(null);

  const [panel, setPanel] = useState<null | "notif" | "rem">(null); // top-bar popover
  const [planModalId, setPlanModalId] = useState<string | null>(null); // Today's-plan popup
  const [plan, setPlan] = useState<PlanItem[]>([]);   // reorderable plan — seeded from REAL tasks (effect below)
  const dragKey = useRef<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const grabDX = useRef(0);                          // px between the cursor and the block's LEFT edge at grab
  const [dropAt, setDropAt] = useState<number | null>(null); // live guide: where a dragged task would start
  const [nowMin, setNowMin] = useState<number | null>(null);          // minutes since 9 AM (real time)
  const [isWeekend, setIsWeekend] = useState(false);
  const [todayStr, setTodayStr] = useState("");                       // YYYY-MM-DD for due-date sorting
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPinned, setChatPinned] = useState(false);
  // The bell in this header is the one the team watches all day, so it rings and
  // swings when the unread count goes up — not on the first reading (arriving with
  // four unread is not news) and not when it falls (reading something is not an
  // event). Praveen asked for it here rather than only in the sidebar (28 Sep).
  const [bellRinging, setBellRinging] = useState(false);
  const [notifUnread, setNotifUnread] = useState(0);
  const lastUnreadSeen = useRef<number | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const n = (e as CustomEvent<{ unread: number }>).detail?.unread || 0;
      setNotifUnread(n);
      const was = lastUnreadSeen.current;
      lastUnreadSeen.current = n;
      if (was === null || n <= was) return;
      playChime();
      setBellRinging(true);
      setTimeout(() => setBellRinging(false), 900);
    };
    window.addEventListener(NOTIF_COUNT, on);
    return () => window.removeEventListener(NOTIF_COUNT, on);
  }, []);
  const openChatRef = useRef<(() => void) | null>(null);
  const openConvoRef = useRef<((id: string) => void) | null>(null);
  // Toasts render from the one dashboard-wide host (top centre) rather than a copy
  // pinned to the bottom-right of this tab, where it sat under the Comment button.
  // Kept as `setToast` so every call site reads the same as before.
  const setToast = useCallback((t: null | { who: string; color?: string; av?: React.ReactNode; body?: string; convo?: string }) => {
    if (!t) { showToast(null); return; }
    showToast({
      who: t.who,
      body: typeof t.body === "string" ? t.body : undefined,
      color: t.color,
      av: typeof t.av === "string" ? t.av : undefined,
      convo: t.convo,
      onOpen: t.convo ? () => { openChatRef.current?.(); openConvoRef.current?.(t.convo!); } : undefined,
    });
  }, []);
  // ── Undo / redo (My Day, session-scoped multi-step stack) ──────────────
  // Each entry stores the field-map to REVERSE the change (undo) and to RE-APPLY
  // it (redo). Everything goes back through the same update API. Cleared on reload.
  // `order` entries are a reorder of Today's plan rather than a field change on one
  // task, so ⌘Z takes back a drag the same way it takes back a status change.
  type HistEntry = { id: string; label: string; undo: Record<string, unknown>; redo: Record<string, unknown>; order?: { undo: string[]; redo: string[] } };
  const [undoStack, setUndoStack] = useState<HistEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistEntry[]>([]);
  const recordHistory = (e: HistEntry) => { setUndoStack((s) => [...s.slice(-49), e]); setRedoStack([]); };
  // Bare update used by undo/redo — no history push, just persist + resync.
  const rawUpdate = (id: string, fields: Record<string, unknown>) =>
    fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, actor: person, fields }) })
      .then(async (res) => { if (!res.ok) { const j = await res.json().catch(() => ({})); setToast({ who: "Undo failed", color: "#C03221", av: "!", body: j.error || `HTTP ${res.status}` }); } load(); })
      .catch((e) => { setToast({ who: "Undo failed", color: "#C03221", av: "!", body: String(e) }); load(); });
  // The create form now lives in the right-hand panel instead of a centred modal.
  // `composing` is what the panel shows; `composerDirty` is whether closing it would
  // throw away typing, which is the only time we interrupt with a confirm.
  const [composing, setComposing] = useState(false);
  const [composerDirty, setComposerDirty] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);   // chat-panel notification stack
  const [acceptTask, setAcceptTask] = useState<Task | null>(null); // Accept & Work modal
  const [askManya, setAskManya] = useState(false);     // Ask-Manya reschedule modal
  // Assign-side capacity warning: "X's day is already full" confirm before an
  // assignment lands on someone whose 8h is committed.
  const [assignWarn, setAssignWarn] = useState<null | { name: string; committed: number; add: number; cta?: string; proceed: () => void }>(null);
  // The urgent-task pipeline state, shared across the editor and Manya views:
  // offered → (editor asks) waiting → (Manya frees room) freed → (editor accepts) done.
  const [pipeline, setPipeline] = useState<"offered" | "waiting" | "freed" | "done">("offered");
  const [movedId, setMovedId] = useState<string | null>(null); // which task Manya slid to tomorrow
  const [screen, setScreen] = useState<"myday" | "team">("myday"); // My Day vs Team-capacity page
  // Workspace tabs — My Day (personal) + the member-scoped Marketing-Hub views.
  const [wsTab] = useState<"myday" | "team" | "master" | "pipeline" | "calendar">("myday"); // pinned — top tab bar removed; sidebar handles the other views
  const [, setDayStarted] = useState(false);  // login = day started (auto, no button)
  const [, setDayStartMin] = useState(0);    // day-start clock-in, minutes since 9AM (the plan now anchors to attendance)
  // Today's first login per person (mh_attendance) — plans start at max(shift, login).
  const [teamLogins, setTeamLogins] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/my-day/logins", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j?.logins) setTeamLogins(j.logins); }).catch(() => {});
    load();
    // Only while the tab is on screen — see the notification bell for the pattern.
    const t = setInterval(() => { if (shouldPoll()) load(); }, 5 * 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  const [loggedOut, setLoggedOut] = useState(false);    // End day → demo logout overlay (no real session end)
  const [profileOpen, setProfileOpen] = useState(false); // header profile chip dropdown
  const [showEod, setShowEod] = useState(false);        // End-today wrap-up modal
  // Overview's End day button lands here with ?endday=1 → open the same wrap-up.
  useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.get("endday") !== "1") return;
    setShowEod(true);
    u.searchParams.delete("endday");
    window.history.replaceState(null, "", u.toString());
  }, []);
  const closedManually = useRef(false);
  // The claim pool surfaces PROMINENTLY on the right first; if ignored for 15s it
  // demotes into the 🔔 bell (badge only shows once demoted).
  const [poolProminent, setPoolProminent] = useState(true);

  useEffect(() => {
    // Tick every minute so the greeting clock stays live (it was set once on mount and
    // froze — showed 1:28 while the wall clock read 1:30).
    const tick = () => {
      const d = new Date();
      setClock({
        time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }),
        date: d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }),
        greet: greetingFor(d.getHours()),
      });
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  // REAL chat: load + poll mh_messages for this person (team + DMs). Per-person
  // read state lives in localStorage (ponytail: per-device unread is enough here;
  // move to a server table if cross-device unread ever matters).
  const personRef = useRef(person); personRef.current = person;
  const loadChat = useCallback(async () => {
    const p = person;
    try {
      const r = await fetch(`/api/my-day/chat?person=${p}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok || personRef.current !== p) return; // stale response for a previous person — drop it
      const server = (d.messages as ServerMsg[]) || [];
      // Keep optimistic (tmp-) sends the server hasn't returned yet, so a racing
      // poll can't wipe a just-sent bubble.
      setChatMsgs((prev) => {
        const pending = prev.filter((m) => m.id.startsWith("tmp-") && !server.some((s) => s.sender === m.sender && s.convo === m.convo && s.body === m.body));
        return [...server, ...pending];
      });
    } catch { /* poll again next tick */ }
  }, [person]);
  useEffect(() => {
    loadChat();
    // Skip the poll while the tab is hidden — don't hammer the network in background
    // tabs; the next tick after refocus catches up (≤15s).
    const id = setInterval(() => { if (shouldPoll()) loadChat(); }, 15_000);
    return () => clearInterval(id);
  }, [loadChat]);
  useEffect(() => { // person switch: fresh chat buffer + their read-state, reminders and day-clock
    try { setChatRead(JSON.parse(localStorage.getItem(`hmd-chat-read-${person}`) || "{}")); } catch { setChatRead({}); }
    setActiveChat(null);
    setChatMsgs([]);            // never show the previous person's threads while the refetch is in flight
    lastMsgId.current = null;   // and never toast "new message" for their backlog
    setSel(null);               // task selection is per-person; the panel rests empty
    try { setReminders(JSON.parse(localStorage.getItem(`hmd-rem-${person}`) || "[]")); } catch { setReminders([]); }
    try { setDismissedNudges(JSON.parse(localStorage.getItem(`hmd-dismissed-${person}`) || "[]")); } catch { setDismissedNudges([]); }
    // The status tab or saved view they were on comes back after a reload (28 Oct).
    try { const t = localStorage.getItem(`hmd-tab-${person}`); if (t) setTaskTab(t); } catch { /* private mode */ }
    // Viewing a person = they're logged in → clear any logged-out overlay + close the menu.
    setLoggedOut(false); setProfileOpen(false);
    // LOGIN = DAY START (no manual button). Restore today's clock-in if one exists,
    // otherwise auto-start it now and anchor the plan to this minute. New format is
    // JSON {at, min}; tolerate the older plain string ("9:30 AM").
    // Clock-in is PER DAY. Only restore it if the stored record is from TODAY —
    // otherwise a previous day's clock-in (e.g. "12:55 PM") anchors this morning's
    // plan to the afternoon and leaves the morning wrongly empty. A stale / dateless
    // / plain-string record is ignored, and we auto-start fresh at the current minute
    // so overdue work front-loads into the morning instead of getting stuck late.
    const todayKey = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
    let restored = false;
    // Attendance is NOT written here any more. Signing in is the clock-in, and the
    // login route records it server-side — which is the only way an admin, or
    // someone who opens another tab first, is ever marked present (25 Sep: the
    // board read 0/5 all morning because this write skipped every admin).
    // What stays local is the plan anchor: which minute today's timeline starts at.
    try {
      const j = JSON.parse(localStorage.getItem(`hmd-day-${person}`) || "null");
      if (j && j.date === todayKey) { setDayStarted(true); setDayStartMin(Number(j.min) || 0); restored = true; }
    } catch { /* old/plain/corrupt record → treat as stale */ }
    if (!restored) {
      const d = new Date();
      const min = Math.max(0, Math.min(d.getHours() * 60 + d.getMinutes() - DAY_START_H * 60, DAY_MINS));
      const at = clockOf(min);
      setDayStarted(true); setDayStartMin(min);
      try { localStorage.setItem(`hmd-day-${person}`, JSON.stringify({ at, min, date: todayKey })); } catch { /* private mode */ }
    }
  }, [person]);
  // Persist reminders as they change (skip the initial empty render).
  const remLoaded = useRef(false);
  useEffect(() => {
    if (!remLoaded.current) { remLoaded.current = true; return; }
    try { localStorage.setItem(`hmd-rem-${person}`, JSON.stringify(reminders)); } catch { /* private mode */ }
  }, [reminders, person]);
  // Toast when a NEW incoming human message lands (not on first load, not my own).
  const lastMsgId = useRef<string | null>(null);
  useEffect(() => {
    const last = chatMsgs[chatMsgs.length - 1];
    if (!last) return;
    if (lastMsgId.current && last.id !== lastMsgId.current && last.sender !== person && last.kind === "chat") {
      const p = PPL[last.sender];
      const cid = last.convo === "team" ? "team" : last.convo.split("~").find((k) => k !== person) || "team";
      setToast({ who: `${p?.name || last.sender} · new message`, color: p?.color || "#3A57E8", av: p?.av || "?", body: last.body, convo: cid });
      if (!closedManually.current) setChatOpen(true);
    }
    lastMsgId.current = last.id;
  }, [chatMsgs, person]);

  // Ignored claim pool → demote to the bell after 15s.
  useEffect(() => {
    if (!poolProminent || claimPool.length === 0) return;
    const id = setTimeout(() => setPoolProminent(false), 15000);
    return () => clearTimeout(id);
  }, [poolProminent, claimPool.length]);

  // Live "now" position for the red line — real system clock, reruns each minute.
  useEffect(() => {
    const upd = () => { const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes() - DAY_START_H * 60); setIsWeekend(d.getDay() === 0 || d.getDay() === 6); setTodayStr(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`); };
    upd(); const id = setInterval(upd, 60_000); return () => clearInterval(id);
  }, []);

  // Name of the person being viewed, in a ref so load() (a stable useCallback) can
  // read the latest value without being recreated.
  const meNameRef = useRef("");

  // Pull live task + claim-pool data from mh_posts. Called on mount and after any
  // write (status change / claim) so the board always reflects server truth.
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/my-day", { cache: "no-store" });
      const d = await r.json();
      if (r.ok) {
        const fetched = (d.tasks as Task[]) || [];
        setTasks(fetched);
        setClaimPool((d.pool as Task[]) || []);
        setSamvaya((d.samvaya as Task[]) || []);
        // NOTE: d.created is no longer read here — "Tasks I created" has its own
        // range-aware endpoint (loadCreated below).
        // Reconcile the optimistic claim buffer against server truth: drop a claim once
        // the server confirms I own it (it now shows via `tasks`, so keeping it would
        // duplicate the row) or the row is gone — but KEEP a claim the server hasn't yet
        // reflected as mine, so a concurrent refetch can't wipe an in-flight claim.
        setClaimedTasks((prev) => prev.filter((c) => {
          // Search tasks AND the pool — a takeover the server hasn't committed yet
          // still lives in the pool; treating it as "gone" would wipe the in-flight
          // claim from both lists (audit finding).
          const server = fetched.find((t) => t.id === c.id) || ((d.pool as Task[]) || []).find((t) => t.id === c.id);
          return !!server && server.detail.owner !== meNameRef.current && claimsInFlight.current.has(c.id);
        }));
      }
    } catch { /* keep whatever we last had */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // "Tasks I created", loaded on its own so the range picker can reach back past the
  // main feed's 60-day window. Re-runs when the viewed person or the range changes.
  const loadCreated = useCallback(async () => {
    if (!person) return;
    setCreatedBusy(true);
    try {
      // mode=done: the person's own finished work, not what they created (22 Oct).
      const qs = new URLSearchParams({ person, range: createdRange, mode: "done" });
      if (createdRange === "custom") { qs.set("amount", String(createdAmt)); qs.set("unit", createdUnit); }
      if (createdRange === "dates") { qs.set("from", createdFrom); qs.set("to", createdTo || createdFrom); }
      const r = await fetch(`/api/my-day/created?${qs}`, { cache: "no-store" });
      if (!r.ok) return; // keep the last good list rather than blanking the card
      const d = await r.json();
      setCreatedRows((d.created as Task[]) || []);
      setCreatedCapped(d.capped === true);
    } catch { /* keep whatever we last had */ } finally { setCreatedBusy(false); }
  }, [person, createdRange, createdAmt, createdUnit, createdFrom, createdTo]);
  useEffect(() => { loadCreated(); }, [loadCreated]);
  // Typing "30" shouldn't fire a query for "3" on the way. Settle for a beat, then
  // commit the number (blank or junk falls back to 1, the smallest real window).
  useEffect(() => {
    if (createdRange !== "custom") return;
    const id = setTimeout(() => {
      const n = Math.floor(Number(createdAmtText));
      setCreatedAmt(Number.isFinite(n) && n >= 1 ? Math.min(n, CUSTOM_UNIT_MAX[createdUnit]) : 1);
    }, 400);
    return () => clearTimeout(id);
  }, [createdAmtText, createdUnit, createdRange]);

  // A newcomer not yet merged into TEAM gets a card from PPL, not Nandu's (was TEAM[3]).
  const me = useMemo(() => TEAM.find((t) => t.key === person)
    || { key: person, name: PPL[person]?.name || person, role: "", av: PPL[person]?.av || person.charAt(0).toUpperCase(), color: PPL[person]?.color || NEWCOMER_COLOR },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [person, TEAM.length]);
  meNameRef.current = me.name;
  const isEditor = isEditorKey(person); // editors claim videos (Team page role)
  const showPool = isEditor && claimPool.length > 0;
  // PIPELINE — tasks queued for THIS person, waiting for their accept. Data-derived
  // and persistent, so it doubles as the history the transient bell doesn't keep.
  //   Praveen: deferred design handoffs (approved, design-type, not his yet).
  //   Editors: videos queued for THEM ("Waiting in your pipeline" handoffs, sent
  //   when their day was full). NOT the claim pool — that's the Claim pool button;
  //   showing it here too made both buttons list the same tasks (Nandu, 21 Sep).
  const pipelineTasks = useMemo(() => {
    // Only while the writer still holds it (a deferred handoff). Approved design work the
    // Rules page gave to someone else — 12thPlus → Nandu — is theirs, not queued here.
    if (isDesigner(person)) return tasks.filter((t) => t.status === "Content - Approved" && !isVideoType(t.detail.typeLine) && t.detail.owner !== me.name
      && (!t.detail.ownerKey || isWriter(t.detail.ownerKey)));
    if (isEditor) {
      const queued = new Set(notifs.filter((n) => n.accept && n.postId).map((n) => n.postId!));
      const seen = new Set<string>();
      return [...tasks, ...claimPool].filter((t) => queued.has(t.id) && !seen.has(t.id) && !!seen.add(t.id));
    }
    return [];
  }, [tasks, claimPool, notifs, person, isEditor, me.name]);
  const [pipeOpen, setPipeOpen] = useState(false);

  // ── Publish-date approvals — Maheen's own portal ────────────────────────────
  // A non-admin's publish-date change is held for Maheen's sign-off. She reviews
  // them here, in her own place — a header "Approvals" button + a strip under the
  // greeting — never buried in one person's My Day. State lives here so the badge,
  // strip and modal all read the same list.
  type DateReq = { postId: string; title: string; type?: string; owner?: string; createdAt?: string; creator?: string; from: string | null; to: string | null; reason?: string; requestedBy: string };
  const [approvals, setApprovals] = useState<DateReq[]>([]);
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const loadApprovals = useCallback(() => {
    if (!viewerIsAdmin) return;
    fetch("/api/marketing-hub/date-change").then((r) => (r.ok ? r.json() : { requests: [] })).then((d) => setApprovals((d.requests || []) as DateReq[])).catch(() => { /* keep last */ });
  }, [viewerIsAdmin]);
  useEffect(() => { loadApprovals(); }, [loadApprovals]);
  const resolveApproval = async (postId: string, action: "approve" | "reject") => {
    setApprovalBusy(postId + action);
    try {
      await fetch("/api/marketing-hub/date-change", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId, action, actor: "maheen" }) });
      setApprovals((a) => a.filter((r) => r.postId !== postId));
      load(); // the approved date is now on the task — refresh My Day
    } finally { setApprovalBusy(null); }
  };

  // MY DAY = only the SELECTED person's own tasks. A task's Owner (whoever it's
  // assigned to / claimed it) must match the person being viewed — so e.g. a
  // Carousel owned by Praveen never shows up under an editor. Then keep only the
  // statuses that still need work (queued/terminal states drop out of the view).
  // ROLE RULE: producers (Praveen/Nikhil/Nandu) work only APPROVED content —
  // Content-Pending / In-Progress is the writer's phase and must never appear as
  // their work even if the owner field is pre-assigned.
  // Owner OR collaborator (MY_DAY_SPEC §5): after Manya approves + hands off, she
  // becomes the collaborator, so an approved task still shows on her board too.
  const isMine = (t: Task) => t.detail.owner === me.name || (t.detail.collaborators || []).some((c) => c.name === me.name);
  const workingTasks = useMemo(
    () => uniqById([...claimedTasks, ...tasks]).filter((t) =>
      isMine(t) && STATUS[t.status].inView &&
      (nameIsWriter(me.name) || (t.status !== "Content - Pending" && t.status !== "Content - In Progress"))),
    [claimedTasks, tasks, me.name],
  );
  const myTabs = useMemo(() => tabsForPerson(me.name), [me.name]);
  const tabCounts = useMemo(() => myTabs.map((tb) => ({ ...tb, n: workingTasks.filter((t) => matchesTab(t, tb)).length })), [workingTasks, myTabs]);
  // When the viewed person changes, their tab set changes — snap to the first valid tab.
  useEffect(() => { if (!taskTab.startsWith("view:") && !myTabs.some((tb) => tb.key === taskTab)) setTaskTab(myTabs[0].key); }, [myTabs, taskTab]);
  useEffect(() => { try { localStorage.setItem(`hmd-tab-${person}`, taskTab); } catch { /* private mode */ } }, [taskTab]); // eslint-disable-line react-hooks/exhaustive-deps
  // Header stat tiles — live, for the person being viewed.
  const stats = useMemo(() => {
    const mine = uniqById([...claimedTasks, ...tasks]).filter((t) => t.detail.owner === me.name);
    const n = (fn: (s: CCStatus) => boolean) => mine.filter((t) => fn(t.status)).length;
    return {
      // Content phase belongs to the writer (Manya). Producers don't work
      // Content-Pending and their task list hides it, so the stat must too — otherwise
      // it counts tasks they can't see (e.g. legacy thumbnails owned by a designer).
      pending: nameIsWriter(me.name) ? n((s) => s === "Content - Pending" || s === "Content - In Progress") : 0,
      waiting: n((s) => s === "Content - Approved" || s === "Incorporating Feedback"),
      output: n((s) => s === "Output - Ready"),
      toPublish: n((s) => s === "Ready to Publish"),
      done: n((s) => s === "Published/Scheduled"),
    };
  }, [tasks, claimedTasks, me.name]);
  const [myViews, setMyViews] = useState<MyView[]>([]);
  useEffect(() => { try { setMyViews(JSON.parse(localStorage.getItem(VIEWS_KEY(person)) || "[]")); } catch { setMyViews([]); } }, [person]);
  const saveMyViews = (v: MyView[]) => { setMyViews(v); try { localStorage.setItem(VIEWS_KEY(person), JSON.stringify(v)); } catch { /* private mode */ } };
  const customView = taskTab.startsWith("view:") ? myViews.find((v) => `view:${v.id}` === taskTab) || null : null;
  const curTab = customView ? { key: taskTab, label: customView.name, short: customView.name, statuses: [] as CCStatus[] } : (myTabs.find((t) => t.key === taskTab) || myTabs[0]);
  // My tasks sort (Nandu's "Sort" comment). Default = publishing date with Urgent/High
  // first — so "Due today" sits above "Due in 3 days". Applies to claimable videos too.
  const [sortBy, setSortBy] = useState<TaskSort>("date");
  useEffect(() => {
    try { const v = window.localStorage.getItem("myday.sort"); if (v && v in TASK_SORTS) setSortBy(v as TaskSort); } catch { /* ignore */ }
  }, []);
  const pickSort = (v: TaskSort) => { setSortBy(v); try { window.localStorage.setItem("myday.sort", v); } catch { /* ignore */ } };
  // The order this person last dragged today's plan into (spec §11). Without this a
  // drag lived in React state alone: reload and the day snapped back, which made
  // reordering pointless.
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);
  const appliedOrder = useRef("");
  useEffect(() => {
    setSavedOrder(null); appliedOrder.current = "";
    if (!person) return;
    fetch(`/api/my-day/plan-order?person=${encodeURIComponent(person)}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => setSavedOrder(Array.isArray(d.order) ? d.order : []))
      .catch(() => setSavedOrder([]));
  }, [person]);
  // Applied once the plan has been seeded from real tasks — and only once, or it
  // would fight every later drag.
  useEffect(() => {
    if (!savedOrder || !savedOrder.length || !plan.length) return;
    const sig = savedOrder.join(",");
    if (appliedOrder.current === sig) return;
    appliedOrder.current = sig;
    const rank = new Map(savedOrder.map((id, i) => [id, i]));
    // Work that arrived since the order was saved used to sink to the very end, even
    // overdue or urgent work. It now keeps the place the plan gave it when it is late
    // or high priority (ahead of the saved order), and follows it otherwise.
    const nowD = new Date();
    const todayKey = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, "0")}-${String(nowD.getDate()).padStart(2, "0")}`;
    const all = uniqById(me.name === "Nandu" ? [...claimedTasks, ...tasks, ...samvaya] : [...claimedTasks, ...tasks]);
    const urgent = (id: string) => { const t = all.find((x) => x.id === id); return !!t && ((!!t.due && t.due < todayKey) || isHot(t.detail.priority)); };
    const pos = (id: string) => rank.get(id) ?? (urgent(id) ? -1 : Infinity);
    setPlan((arr) => arr.map((p, i) => ({ p, i })).sort((a, b) => (pos(a.p.taskId) - pos(b.p.taskId)) || (a.i - b.i)).map(({ p }) => p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedOrder, plan.length]);
  /** Remember a reorder. Best-effort — a save that fails costs the order, not the day. */
  const saveOrder = (arr: PlanItem[]) => {
    appliedOrder.current = arr.map((p) => p.taskId).join(",");
    fetch("/api/my-day/plan-order", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ person, order: arr.map((p) => p.taskId) }),
    }).catch(() => {});
  };

  // Where each task sits on today's timeline, for the "Today's plan" sort.
  const planOrder = useMemo(() => new Map(plan.map((p, i) => [p.taskId, i])), [plan]);
  const cmpTasks = useMemo(() => taskComparator(sortBy, planOrder, todayStr), [sortBy, planOrder, todayStr]);
  const shownTasks = useMemo(() => {
    return workingTasks.filter((t) => customView ? inMyView(t, customView, todayStr) : matchesTab(t, curTab)).sort(cmpTasks);
  }, [workingTasks, taskTab, cmpTasks, customView, todayStr]); // eslint-disable-line react-hooks/exhaustive-deps
  // What "Wrap up your day" asks about: today's work only, taken from My tasks (so
  // Pending / Approved / Feedback / Claimed — never "Tasks I created", which is other
  // people's work to follow, not hers to finish).
  //   · due today, or overdue and still open — today's business either way
  //   · no publishing date at all — undated work is outstanding until someone says so
  //   · started today — if she worked on it, the day should account for it
  // Anything dated tomorrow onward is left out; it isn't today's to close.
  const eodTasks = useMemo(() => {
    if (!todayStr) return [];
    return workingTasks
      .filter((t) => {
        if (!t.due) return true;                                   // undated → still outstanding
        if (t.due <= todayStr) return true;                        // due today or overdue
        const s = t.detail.startAt ? String(t.detail.startAt).slice(0, 10) : "";
        return s === todayStr;                                     // worked on today
      })
      .sort(cmpTasks)
      .map((t) => ({ id: t.id, title: t.title, status: t.status, due: t.due, typeLine: t.detail.typeLine, publishes: t.detail.publishes || "No date" }));
  }, [workingTasks, todayStr, cmpTasks]);

  // No fallback to the first row: nothing is open until the person opens something.
  const task = sel === null ? null : shownTasks[sel] || null;
  // A claimable video opened for a look before claiming (Nandu: "I want to open and
  // see the task"). Shown in the detail panel, read-only, with a Claim button.
  const [peekId, setPeekId] = useState<string | null>(null);
  // Claimable videos show INLINE in each editor's Content-Approved tab (spec §8) —
  // both Nandu and Nikhil see the same pool; first to claim owns it.
  const claimableHere = useMemo(
    // Never a task already on their own list (e.g. one they're on camera for) — each
    // task shows once (22 Oct; the same id twice also left ghost rows behind).
    () => (isEditor && curTab.key === "approved") ? claimPool.filter((v) => !claimedTasks.some((c) => c.id === v.id) && !workingTasks.some((w) => w.id === v.id)).sort(cmpTasks) : [],
    [isEditor, curTab.key, claimPool, claimedTasks, workingTasks, cmpTasks],
  );
  // Who is holding the video work right now, for when there is none left to claim.
  //
  // On 8 Oct Nikhil claimed the last three videos at about 10:15; Nandu opened his
  // approved tab two hours later, found it blank, and read it as his own work having
  // gone missing — "After claiming, task should be visible here. not able see any
  // task who is doing what". Nothing had gone wrong: the pool was simply empty. An
  // empty tab that says only "Nothing here ✓" cannot tell those two cases apart,
  // and the second one looks like a bug.
  //
  // Counts video that is actually being worked — claimed but not yet delivered.
  // Anything Output-Ready or later is finished as far as the pool is concerned.
  const videoInHand = useMemo(() => {
    const by = new Map<string, number>();
    for (const t of tasks) {
      if (!isVideoType(t.detail.typeLine)) continue;
      if (t.status !== "Content - Approved" && t.status !== "Output - In Progress") continue;
      const o = t.detail.owner;
      if (!o || o === "Unclaimed" || o === me.name) continue;
      // Editors only. Some approved video still sits under the writer's name, and
      // saying "Manya is working on 5 videos" would be both wrong and confusing —
      // she writes them, she does not cut them.
      if (!EDITOR_NAMES.has(o)) continue;
      by.set(o, (by.get(o) || 0) + 1);
    }
    return [...by.entries()].sort((a, b) => b[1] - a[1]);
  }, [tasks, me.name]);
  const planModalTask = planModalId ? [...tasks, ...claimedTasks, ...samvaya].find((t) => t.id === planModalId) || null : null;
  // Change a task's status via the card's status dropdown. Two special cases:
  //  • CONTENT-FIRST HANDOFF: when the WRITER's task hits "Content - Approved", it
  //    auto-hands off to the producer by Type — design → Praveen (owner), video →
  //    the editors' claim pool — and Manya stays on as a collaborator.
  //  • Output-ready → Output tab; queued/terminal states leave the working view.
  const withManya = (cs: Person[]) => {
    const w = PPL[firstWithRole("writer") || "manya"];
    return !w || cs.some((c) => c.name === w.name) ? cs : [w, ...cs];
  };
  // Committed load (minutes) for ANY teammate — drives the assign-side "already
  // full" warning. Same filter as Today's plan: own, in-production, not output-ready.
  // Role rule applies here too: a producer's committed load counts ONLY approved
  // work (Content-Approved / Incorporating Feedback) — content-phase tasks are
  // Manya's, whoever the owner field names.
  const committedFor = useCallback((name: string) => uniqById([...claimedTasks, ...tasks])
    .filter((t) => (t.detail.owner === name && STATUS[t.status].inView && t.status !== "Output - Ready" &&
      (nameIsWriter(name)
        ? (t.status === "Content - Pending" || t.status === "Content - In Progress")
        : (t.status === "Content - Approved" || t.status === "Incorporating Feedback")))
      || presentsOn(t, keyOfName(name), name))
    .reduce((s, t) => s + planMins(t, keyOfName(name), name), 0), [claimedTasks, tasks]);
  // Lay out ANY teammate's day from their real working tasks (role rule applied):
  // sequential 9→6 around the pinned 1–2 PM lunch. Powers the approve popup's mini
  // timeline, the working-now inference and the not-started candidate list.
  const dayFor = useCallback((name: string) => {
    const mine = [...claimedTasks, ...tasks]
      .filter((t) => (t.detail.owner === name && STATUS[t.status].inView && t.status !== "Output - Ready" &&
        (nameIsWriter(name)
          ? (t.status === "Content - Pending" || t.status === "Content - In Progress")
          : (t.status === "Content - Approved" || t.status === "Incorporating Feedback" || t.status === "Output - In Progress")))
        || presentsOn(t, keyOfName(name), name))
      .map((t) => ({ id: t.id, label: presentsOn(t, keyOfName(name), name) ? `On camera · ${t.title}` : t.title, due: t.due, dur: planMins(t, keyOfName(name), name) }));
    const now = Math.max(0, Math.min(nowMin ?? 0, DAY_MINS));
    const shiftStart = shiftStartOf(name);
    const LUNCH_END = LUNCH_AT + LUNCH_MIN;
    // Anchor the plan to NOW, never the past — time already elapsed can't hold work,
    // so pending tasks lay out from here and the morning that's gone reads as "past",
    // not bookable "free" (which made an already-afternoon day look wide open).
    const anchor = Math.max(shiftStart, now);
    type Blk = { kind: "task" | "lunch" | "free" | "past"; id?: string; label: string; start: number; dur: number };
    const blocks: Blk[] = [];
    if (anchor > shiftStart) blocks.push({ kind: "past", label: "Earlier", start: shiftStart, dur: anchor - shiftStart });
    let cursor = anchor, lunchDone = anchor >= LUNCH_END;      // lunch already over? don't re-draw it
    const pushLunch = () => { blocks.push({ kind: "lunch", label: "Lunch", start: LUNCH_AT, dur: LUNCH_MIN }); cursor = LUNCH_END; lunchDone = true; };
    // Mid-lunch right now → show only the slice still ahead, then resume after 2 PM.
    if (!lunchDone && cursor >= LUNCH_AT && cursor < LUNCH_END) { blocks.push({ kind: "lunch", label: "Lunch", start: cursor, dur: LUNCH_END - cursor }); cursor = LUNCH_END; lunchDone = true; }
    for (const t of mine) {
      let remaining = t.dur;
      if (!lunchDone && cursor >= LUNCH_AT && cursor < LUNCH_END) pushLunch();
      if (!lunchDone && cursor < LUNCH_AT) {
        const before = Math.min(remaining, LUNCH_AT - cursor);
        if (before > 0) { blocks.push({ kind: "task", id: t.id, label: t.label, start: cursor, dur: before }); cursor += before; remaining -= before; }
        if (remaining > 0) pushLunch();
      }
      if (remaining > 0) { blocks.push({ kind: "task", id: t.id, label: t.label, start: cursor, dur: remaining }); cursor += remaining; }
    }
    if (!lunchDone) { if (cursor < LUNCH_AT) { blocks.push({ kind: "free", label: "Free", start: cursor, dur: LUNCH_AT - cursor }); cursor = LUNCH_AT; } pushLunch(); }
    if (cursor < DAY_MINS) blocks.push({ kind: "free", label: "Free", start: cursor, dur: DAY_MINS - cursor });
    const committed = mine.reduce((s, t) => s + t.dur, 0);
    // Free = the open time still AHEAD today (sum of remaining Free blocks), not a
    // whole-day figure — so "Nh free" reflects what's actually left this afternoon.
    const free = blocks.reduce((s, b) => s + (b.kind === "free" ? b.dur : 0), 0);
    const currentBlk = blocks.find((b) => b.kind === "task" && b.start <= now && now < b.start + b.dur) || null;
    const current = currentBlk ? { id: currentBlk.id!, label: currentBlk.label, endsIn: currentBlk.start + currentBlk.dur - now } : null;
    const candidates = mine.filter((t) => t.id !== current?.id);
    return { tasks: mine, blocks, committed, free, current, candidates, now };
  }, [claimedTasks, tasks, nowMin]);

  // APPROVE GATE: approving DESIGN work always shows the target's day first (mini
  // timeline + working-now) — free → approve; full → move a task or queue in
  // pipeline. The producer's day is never force-filled.
  const [approveGate, setApproveGate] = useState<null | { id: string; status: CCStatus; target: string; add: number }>(null);
  // Completeness-gate block (server 422): the move was refused because required fields
  // are missing. `gate` = which transition, `missing` = the human-readable list.
  const [gateBlock, setGateBlock] = useState<GateBlock | null>(null);
  const setTaskStatus = (id: string, status: CCStatus, quiet = false) => {
    const cur = [...tasks, ...claimedTasks].find((t) => t.id === id);
    if (cur && status === "Content - Approved" && nameIsWriter(cur.detail.owner)) {
      const handoff = autoAssign(cur.detail.typeLine);
      if (handoff && !handoff.toPool && !nameIsWriter(handoff.owner)) {
        setApproveGate({ id, status, target: handoff.owner, add: cur.detail.duration || estMins(cur.detail.typeLine) });
        return;
      }
    }
    doSetTaskStatus(id, status, false, quiet);
  };
  const doSetTaskStatus = (id: string, status: CCStatus, deferHandoff = false, quiet = false) => {
    // Capture the before-status so this move can be undone (session history).
    const prev = [...tasks, ...claimedTasks].find((t) => t.id === id);
    const prevStatus = prev?.status;
    // Persist to the real pipeline (this drives the same handoff logic the Master
    // sheet & Content Review use), then reconcile the board with server truth.
    fetch("/api/marketing-hub/update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, fields: { status }, actor: person, deferHandoff }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          // 422 = a completeness gate (approve / output-ready). Show the missing-fields
          // modal instead of a generic error toast, and revert the optimistic move.
          const block = gateFromResponse(res.status, j, prev?.title || "This task");
          if (block) {
            setGateBlock(block);
          } else {
            setToast({ who: "Save failed", color: "#C03221", av: "!", body: j.error || `HTTP ${res.status}` });
          }
          load(); // resync — the optimistic simulation below never persisted, so revert to server truth
          return;
        }
        if (prevStatus && prevStatus !== status) {
          recordHistory({ id, label: `${prev?.title || "Task"}: ${STATUS[prevStatus].label} → ${STATUS[status].label}`, undo: { status: prevStatus }, redo: { status } });
        }
        load();
      })
      .catch((e) => { setToast({ who: "Save failed", color: "#C03221", av: "!", body: String(e) }); load(); });

    const cur = [...tasks, ...claimedTasks].find((t) => t.id === id);
    if (!cur) return;
    // Content-first handoff fires only the first time the writer's own task is approved.
    // Deferred (pipeline-hold) approvals skip it — ownership moves on Accept instead.
    const handoff = status === "Content - Approved" && nameIsWriter(cur.detail.owner) && !deferHandoff ? autoAssign(cur.detail.typeLine) : null;
    if (deferHandoff) setToast({ who: "Queued in pipeline", color: "#D97706", av: <IconHourglass size={14} stroke={2} />, body: `“${cur.title}” is waiting — it joins their board only when they accept.` });

    if (handoff && handoff.toPool) {
      // Video → drop into the editors' claim pool (Nikhil / Nandu).
      const routed: Task = { ...cur, status, meta: `${cur.detail.typeLine} · unclaimed`, detail: { ...cur.detail, owner: "Unclaimed", collaborators: withManya(cur.detail.collaborators) } };
      setTasks((a) => a.filter((t) => t.id !== id));
      setClaimedTasks((a) => a.filter((t) => t.id !== id));
      setClaimPool((p) => [routed, ...p]);
      setToast({ who: "Approved → claim pool", color: "#3A57E8", av: me.av, body: `${cur.detail.typeLine} handed off to the editors' pool.` });
      return;
    }

    const next: Task = handoff && !nameIsWriter(handoff.owner)
      ? { ...cur, status, meta: `${cur.detail.typeLine} · owned by ${handoff.owner}`, detail: { ...cur.detail, owner: handoff.owner, collaborators: withManya(cur.detail.collaborators) } }
      : { ...cur, status };
    setTasks((a) => a.map((t) => (t.id === id ? next : t)));
    setClaimedTasks((a) => a.map((t) => (t.id === id ? next : t)));

    if (next.detail.owner !== cur.detail.owner) setToast({ who: `Approved → ${next.detail.owner}`, color: "#3A57E8", av: (next.detail.owner[0] || "?").toUpperCase(), body: `${cur.detail.typeLine} handed off to ${next.detail.owner} (design).` });
    else if (quiet) { /* the task list shows the move itself (moveTask below) */ }
    else if (status === "Output - Ready" || status === "Output - In Progress") setToast({ who: `${STATUS[status].label}`, color: "#3A57E8", av: me.av, body: "Moved to the Output tab." });
    else if (!STATUS[status].inView) setToast({ who: `${STATUS[status].label}`, color: "#3A57E8", av: me.av, body: "It's left your working view." });
  };

  // Seed/sync Today's plan from REAL tasks: the person's own in-production tasks
  // land on the timeline (duration = producer-set, else estimated by type); tasks
  // that finished or changed hands drop off automatically. Existing entries keep
  // their order, duration and pins. NEW arrivals auto-slot by priority: an urgent
  // (High) task jumps to the FRONT of the day on its own — no Auto-plan click — so
  // priority work surfaces the moment it's assigned; everything else appends.
  useEffect(() => {
    const PRANK: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
    // Same role rule as dayFor: Manya plans only her pre-approval writing; producers
    // plan only approved work. So an approved (even urgent) task leaves Manya's timeline.
    // Nandu's Samvaya / other-platform work also lands on HIS timeline (spec §14) — it's
    // real time on his day — while staying out of everyone else's board and out of the
    // GooCampus lists. The dedicated Samvaya section below still shows the detail.
    const base = uniqById(me.name === "Nandu" ? [...claimedTasks, ...tasks, ...samvaya] : [...claimedTasks, ...tasks]);
    const mine = base.filter((t) => (t.detail.owner === me.name && STATUS[t.status].inView && t.status !== "Output - Ready" &&
      onTimelineFor(me.name, t.status)) || presentsOn(t, person, me.name));
    setPlan((p) => {
      const keep = p.filter((x) => mine.some((t) => t.id === x.taskId));
      // Earliest publishing date first (the deadline), priority breaks ties.
      const missing = mine
        .filter((t) => !keep.some((x) => x.taskId === t.id))
        .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || (PRANK[a.detail.priority] - PRANK[b.detail.priority]));
      const entry = (t: Task) => ({ key: `pk${t.id}`, taskId: t.id, label: presentsOn(t, person, me.name) ? `On camera · ${t.title}` : t.title, dur: planMins(t, person, me.name) });
      // Overdue work leads the day, then urgent, then the rest by date. A High task
      // due TOMORROW used to open the day ahead of two tasks that were already a day
      // late (Praveen, 25 Sep) — being late is the more urgent thing.
      // The date is read here, not from `todayStr` state: that starts empty (it is
      // set in an effect to keep the server and client render identical), and the
      // seed runs first — so overdue work looked on-time and the order came out
      // wrong on every fresh load.
      const nowD = new Date();
      const todayKey = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, "0")}-${String(nowD.getDate()).padStart(2, "0")}`;
      const isLate = (t: Task) => !!t.due && t.due < todayKey;
      const high = missing.filter((t) => isLate(t) || isHot(t.detail.priority))
        .sort((a, b) => (Number(!isLate(a)) - Number(!isLate(b))) || (Number(!isHot(a.detail.priority)) - Number(!isHot(b.detail.priority))))
        .map(entry);
      const rest = missing.filter((t) => !isLate(t) && !isHot(t.detail.priority)).map(entry);
      // NEVER displace a task that's actively being worked (Output - In Progress) at the
      // front — the urgent arrival slots right AFTER it, so the current task finishes first.
      let at = 0;
      while (at < keep.length) {
        const t = mine.find((m) => m.id === keep[at].taskId);
        if (t && t.status === "Output - In Progress") at++; else break;
      }
      if (keep.length === p.length && missing.length === 0) return p;
      // Routine arrivals slot in by publishing date among what's already planned
      // (kept entries keep their order, so manual reordering survives).
      const dueOf = (id?: string) => mine.find((m) => m.id === id)?.due || "9999";
      const out = [...keep.slice(0, at), ...high, ...keep.slice(at)];
      for (const r of rest) {
        const d = dueOf(r.taskId);
        const i = out.findIndex((x, idx) => idx >= at + high.length && dueOf(x.taskId) > d);
        if (i === -1) out.push(r); else out.splice(i, 0, r);
      }
      return out;
    });
  }, [tasks, claimedTasks, samvaya, me.name, person]);

  // Lay the (reorderable) tasks across the day, dropping the protected 1-hour
  // lunch in around 1 PM and filling the tail with buffer.
  // Today's plan is PER-PERSON: only the current person's own, still-in-production
  // tasks land on their timeline (output-ready/published/other people's are excluded).
  const myPlan = useMemo(() => {
    const all = uniqById(me.name === "Nandu" ? [...claimedTasks, ...tasks, ...samvaya] : [...claimedTasks, ...tasks]);
    return plan.flatMap((p) => {
      const t = all.find((x) => x.id === p.taskId);
      if (!t) return [];
      const presenting = presentsOn(t, person, me.name);
      if (!presenting && (t.detail.owner !== me.name || !STATUS[t.status].inView || t.status === "Output - Ready")) return [];
      if (!presenting && !onTimelineFor(me.name, t.status)) return []; // approved work is off Manya's timeline
      return [{ ...p, high: isHot(t.detail.priority), samvaya: samvaya.some((s) => s.id === t.id) }];
    });
  }, [plan, tasks, claimedTasks, samvaya, me.name, person]);
  // Capacity cap (spec §9, fixes Bug 3): only what fits the 8h shift lands on the
  // timeline; the rest SPILLS OVER (shown separately) instead of cramming 28h into 8h.
  // The day starts at login, never before the shift: log in at 10:05 and the plan
  // starts at 10:05; log in at 8:45 and it starts at 9:00. Admins (whose own logins
  // aren't recorded) viewing a teammate use that teammate's recorded login; if it
  // isn't in yet, the plan starts at the shift.
  const shiftStart = shiftStartOf(me.name);
  // The recorded sign-in is the truth. If it hasn't arrived — a first visit, or the
  // attendance read failed — fall back to when THIS browser started the day, but
  // only for your own day: an admin previewing a teammate must not anchor that
  // teammate's plan to the admin's own morning.
  // Only the recorded sign-in (attendance) — the same source Workload uses, so the two
  // bars start at the same time. (A fallback to this browser's own start made them
  // differ by a few minutes.) No record yet → the shift start, on both.
  const loginMin = teamLogins[person];
  // The "Started …" badge has to read from the SAME value the plan is anchored to.
  // It used to show this browser's own hmd-day-<person> record, so an admin opening
  // a teammate's day saw "Started 12:05 PM" — the admin's clock — above a timeline
  // that began at the teammate's shift, two hours earlier (Praveen, 25 Sep). Two
  // clocks on one screen, and neither of them the teammate's.
  // The real sign-in time, before 9 AM too — 8:58 read as 9:00 (Praveen, 29 Oct). The
  // plan below still starts at the shift.
  const startedAt = loginMin == null ? null : clockOf(Math.min(loginMin, DAY_MINS));
  const planStart = Math.max(shiftStart, loginMin ?? shiftStart);
  // The plan is FIXED from login (Praveen, 23 Oct): the first task starts when they
  // logged in and every task keeps its slot — nothing slides along with the clock
  // (it used to re-lay everything from "now", so at 10 the whole day started at 10,
  // at 11 at 11). The timer isn't used; what moves the plan is finishing work: a
  // task marked Output Ready stays on the bar, greyed, but shrinks to the time it
  // actually took, so everything after it moves up and the freed time shows as free.
  const doneBlocks = useMemo(() => {
    const today = new Date().toDateString();
    const minOf = (iso: string) => { const d = new Date(iso); return !Number.isNaN(d.getTime()) && d.toDateString() === today ? d.getHours() * 60 + d.getMinutes() - DAY_START_H * 60 : null; };
    const finished = uniqById([...claimedTasks, ...tasks, ...samvaya])
      .filter((t) => t.detail.owner === me.name && ["Output - Ready", "Ready to Publish", "Published/Scheduled"].includes(t.status) && t.detail.endAt && minOf(t.detail.endAt) != null)
      .sort((a, b) => String(a.detail.endAt).localeCompare(String(b.detail.endAt)));
    const out: { id: string; title: string; start: number; dur: number; from: number | null; to: number }[] = [];
    let cur = planStart;
    for (const t of finished) {
      const to = minOf(t.detail.endAt || "")!;
      if (cur >= LUNCH_AT && cur < LUNCH_AT + LUNCH_MIN) cur = LUNCH_AT + LUNCH_MIN;
      const planned = t.detail.duration || estMins(t.detail.typeLine);
      // How long it really took, counted from where it sat in the plan — never more
      // than planned (a task finished late doesn't push the rest of the day back).
      const worked = to - cur - Math.max(0, Math.min(to, LUNCH_AT + LUNCH_MIN) - Math.max(cur, LUNCH_AT));   // lunch isn't work
      let dur = Math.min(planned, Math.max(10, worked));
      if (cur < LUNCH_AT && cur + dur > LUNCH_AT) {   // runs into lunch: split around it
        out.push({ id: t.id, title: t.title, start: cur, dur: LUNCH_AT - cur, from: cur, to });
        dur -= LUNCH_AT - cur; cur = LUNCH_AT + LUNCH_MIN;
      }
      out.push({ id: t.id, title: t.title, start: cur, dur, from: cur, to });
      cur += dur;
    }
    return out;
  }, [planStart, claimedTasks, tasks, samvaya, me.name]);
  // Where the rest of the plan starts: after the finished work.
  const openFrom = doneBlocks.reduce((m, b) => Math.max(m, b.start + b.dur), planStart);
  const availMin = workAvailFrom(openFrom, shiftStart);
  const { fitPlan, spillPlan } = useMemo(() => {
    const fit: typeof myPlan = [], spill: typeof myPlan = [];
    let used = 0;
    for (const p of myPlan) {
      const cap = p.high ? availMin : Math.max(0, availMin - BUFFER_MIN);
      if (fit.length === 0 || used + p.dur <= cap) { fit.push(p); used += p.dur; }
      else spill.push(p);
    }
    return { fitPlan: fit, spillPlan: spill };
  }, [myPlan, availMin]);
  // Smart reminders (spec §13, revised per Manya's comment 22 Sep).
  //
  // A reminder's job is to get a task FINISHED IN TIME. Producers used to be
  // nudged only once a task was already overdue — by then the publish date had
  // passed and nothing could be saved, so it wasn't a reminder, it was a pending
  // task, which the list already shows as overdue. Producers are now nudged a few
  // hours BEFORE the end of the day a task is due, while there's still time to act.
  const nudges = useMemo(() => {
    const DAY = 86_400_000;
    const today = new Date(todayStr + "T00:00:00").getTime();
    // Shift end in timeline minutes (the plan's own clock: 0 = 9 AM).
    const dayEnd = shiftStartOf(me.name) + WORK_MIN + LUNCH_MIN;
    const minsLeft = nowMin === null ? null : dayEnd - nowMin;
    const out: { id: string; title: string; text: string }[] = [];
    // Drive reminders off workingTasks — the SAME set the task list shows — so a
    // reminder is always a task the person can actually find and act on (a producer's
    // list hides the content phase, so its reminders must too; else you get phantom
    // "overdue" nudges for tasks that never appear in the list).
    // The same rule for everyone, writer included. Manya was still being told
    // "pending 3 days — why still open?", which is the complaint that prompted the
    // revision in the first place: that is a pending task, and the list already
    // shows it as one. A reminder is the nudge that arrives while the day can
    // still be saved (Manya, 25 Sep).
    for (const t of workingTasks) {
      if (!t.due || !STATUS[t.status].inView) continue;
      const dueIn = Math.floor((new Date(t.due + "T00:00:00").getTime() - today) / DAY);
      // Due today and the day is nearly out — the one moment a nudge still helps.
      if (dueIn === 0 && minsLeft !== null && minsLeft > 0 && minsLeft <= remindBeforeEndMin()) {
        const h = Math.floor(minsLeft / 60), m = minsLeft % 60;
        const left = h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
        out.push({ id: t.id, title: t.title, text: `due today — ${left} left in your day` });
      }
    }
    return out;
  }, [workingTasks, me.name, todayStr, nowMin]);
  const planBlocks = useMemo(() => {
    type Blk = { kind: "reel" | "lunch" | "buffer"; key?: string; taskId?: string; label: string; start: number; dur: number; high?: boolean; samvaya?: boolean };
    const out: Blk[] = [];
    const LUNCH_END = LUNCH_AT + LUNCH_MIN;
    // Anchor the plan to when the day actually started — max(shift start, today's
    // login) — the same rule the Workload timeline uses, so both read identically.
    const anchor = openFrom;   // after today's finished work (fixed plan — see doneBlocks)
    let cursor = anchor;
    let lunchDone = false;
    const pushLunch = () => { out.push({ kind: "lunch", label: "Lunch", start: LUNCH_AT, dur: LUNCH_MIN }); lunchDone = true; };
    for (const p of fitPlan) {
      let remaining = p.dur;
      // If we're sitting inside the lunch window, jump past the (fixed) 1 PM lunch.
      if (!lunchDone && cursor >= LUNCH_AT && cursor < LUNCH_END) { pushLunch(); cursor = LUNCH_END; }
      // Part that fits before lunch.
      if (!lunchDone && cursor < LUNCH_AT) {
        const before = Math.min(remaining, LUNCH_AT - cursor);
        if (before > 0) { out.push({ kind: "reel", key: p.key, taskId: p.taskId, label: p.label, start: cursor, dur: before, high: p.high, samvaya: p.samvaya }); cursor += before; remaining -= before; }
        // The task runs into lunch → drop the protected lunch and continue after it (SPLIT).
        if (remaining > 0) { pushLunch(); cursor = LUNCH_END; }
      }
      // Remainder after lunch (or the whole task if it's already past 2 PM).
      if (remaining > 0) { out.push({ kind: "reel", key: p.key, taskId: p.taskId, label: p.label, start: cursor, dur: remaining, high: p.high, samvaya: p.samvaya }); cursor += remaining; }
    }
    if (!lunchDone) pushLunch(); // no task reached lunch → still park it at 1 PM
    // The reserved emergency hour sits at the end of the shift, if work hasn't used it.
    const dayEnd = shiftStart + WORK_MIN + LUNCH_MIN; // the shift still ends on time
    const bufStart = Math.max(cursor, dayEnd - BUFFER_MIN);
    if (bufStart < dayEnd) out.push({ kind: "buffer", label: "Buffer", start: bufStart, dur: dayEnd - bufStart });
    return out;
  }, [fitPlan, openFrom, shiftStart]);
  const workMin = myPlan.reduce((s, p) => s + p.dur, 0);
  const plannedMin = fitPlan.reduce((s, p) => s + p.dur, 0);
  // Spilled work is only a problem if it publishes today or tomorrow; the rest is
  // simply next in line (it'll pull forward as room frees up).
  const dueOfTask = (id?: string) => [...claimedTasks, ...tasks, ...samvaya].find((t) => t.id === id)?.due || "";
  const tomorrowStr = todayStr ? (() => { const d = new Date(todayStr + "T00:00:00"); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })() : "";
  const atRisk = spillPlan.filter((p) => { const d = dueOfTask(p.taskId); return !!d && !!tomorrowStr && d <= tomorrowStr; });
  const nextDue = spillPlan.map((p) => dueOfTask(p.taskId)).filter(Boolean).sort()[0] || "";
  // Red now-line shows only inside the working span (9 AM–7 PM, covering both shifts:
  // 9–6 and 10–7). Before 9 or after 7 PM there's simply no line — real clock, no fake.
  const showNow = nowMin !== null && !isWeekend && nowMin >= 0 && nowMin <= DAY_MINS;
  // Live timer — starts ONLY when the producer moves a task to "In Progress"
  // (Output - In Progress), which stamps start_at on the server. Elapsed = real
  // wall-clock minutes since that stamp, with the 1–2 PM lunch subtracted. Shows
  // nothing until they hit In Progress, and stops once it's marked done.
  const taskTiming = (t: Task | null): { planned: number; elapsed: number } | undefined => {
    if (!t || nowMin == null) return undefined;
    if (t.status !== "Output - In Progress" || !t.detail.startAt) return undefined;
    const s = new Date(t.detail.startAt);
    if (Number.isNaN(s.getTime())) return undefined;
    const sStr = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}-${String(s.getDate()).padStart(2, "0")}`;
    if (sStr !== todayStr) return undefined; // only live-tick a task started today
    const startMin = s.getHours() * 60 + s.getMinutes() - DAY_START_H * 60;
    let elapsed = nowMin - startMin;
    const lo = Math.max(startMin, LUNCH_AT), hi = Math.min(nowMin, LUNCH_AT + LUNCH_MIN);
    if (hi > lo) elapsed -= hi - lo; // don't count lunch as work
    const planned = t.detail.duration || estMins(t.detail.typeLine);
    return { planned, elapsed: Math.max(0, elapsed) };
  };
  // ── The 15-minutes-left warning, wherever they are ─────────────────────────
  // The prompt used to live only inside the open task, so a producer working from
  // the plan or another tab never saw their time run out. Now every running task of
  // theirs is watched once a minute and raises a real notification — one at 15
  // minutes left, one when it goes over, and never the same one twice.
  const timeAlerted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (nowMin == null) return;
    for (const t of [...tasks, ...claimedTasks]) {
      if (t.detail.ownerKey !== person) continue;
      const tm = taskTiming(t);
      if (!tm) continue;                                   // not running
      const over = tm.elapsed >= tm.planned;
      const soon = tm.elapsed >= tm.planned - 15;
      if (!soon) continue;
      const key = `${t.id}:${over ? "over" : "soon"}`;
      if (timeAlerted.current.has(key)) continue;
      timeAlerted.current.add(key);
      addNotif({
        id: `time-${key}`,
        kind: over ? "urgent" : "message",
        emoji: over ? "⏰" : "⏳",
        title: over ? `Over time — ${t.title}` : `${fmtMins(tm.planned - tm.elapsed)} left — ${t.title}`,
        sub: over
          ? `${fmtMins(tm.planned)} planned, ${fmtMins(tm.elapsed)} on the clock. Is it done, or do you need longer?`
          : `${fmtMins(tm.planned)} planned. Is it done, or do you need longer?`,
        task: t,
        timeUp: { taskId: t.id },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowMin, tasks, claimedTasks, person]);

  const movePlan = (key: string, dir: number) => setPlan((arr) => { const i = arr.findIndex((p) => p.key === key); const j = i + dir; if (i < 0 || j < 0 || j >= arr.length) return arr; const c = [...arr]; [c[i], c[j]] = [c[j], c[i]]; saveOrder(c); return c; });
  // Where a dragged block's LEFT EDGE would land, given the cursor. We subtract the
  // grab offset (where inside the block you picked it up) so the block tracks the
  // cursor naturally instead of teleporting its edge under the pointer. Snapped to
  // 15 min for precise placement.
  const edgeMinFromCursor = (clientX: number): number | null => {
    const el = trackRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    const leftPx = clientX - grabDX.current;
    const mins = ((leftPx - r.left) / r.width) * DAY_MINS;
    return Math.max(0, Math.min(DAY_MINS, Math.round(mins / 15) * 15));
  };
  // Drag a task block onto the track to change WHERE IT COMES in the day's order.
  //
  // It used to pin a start time instead, which broke in three ways at once
  // (measured 25 Sep): a drop at or before "now" was thrown away, so the last task
  // could never be dragged to the front; the layout only ever pushed a pinned block
  // LATER, so it could not be moved earlier either; and a block pinned late shoved
  // everything after it past the end of the day — blocks rendered at 105% and two
  // disappeared off the track.
  //
  // Ordering has none of those problems. The same work is laid out in a different
  // sequence, so the day is exactly as long as it was, and "earlier" is just a
  // smaller index. Spec §11 asks for this, and the ◀▸ buttons already do it.
  /** Overdue, or Urgent/High — the work that shouldn't quietly slide down the day. */
  const isProtected = (taskId?: string) => {
    const t = [...tasks, ...claimedTasks, ...samvaya].find((x) => x.id === taskId);
    if (!t) return false;
    return (!!todayStr && !!t.due && t.due < todayStr) || isHot(t.detail.priority);
  };

  const dropPlanAt = async (mins: number | null) => {
    const key = dragKey.current; dragKey.current = null;
    setDropAt(null);
    if (!key || mins == null) return;

    const arr = plan;
    const from = arr.findIndex((p) => p.key === key);
    if (from < 0) return;
    // Where the drop lands, counted in tasks: every task whose middle sits before
    // the cursor stays ahead of it. Midpoints, not edges, so dropping onto the left
    // half of a block puts you before it and the right half after it.
    // The 1–2 PM lunch sits inside the timeline, so it is counted here too — without
    // it every drop after lunch landed one slot early and the list then showed the
    // wrong order (Nandu, 13 Oct). A block that runs into lunch is split around it.
    const rest = arr.filter((_, i) => i !== from);
    let cursor = planStart, to = rest.length, lunchDone = cursor >= LUNCH_AT + LUNCH_MIN;
    for (let i = 0; i < rest.length; i++) {
      if (!lunchDone && cursor >= LUNCH_AT) { cursor = Math.max(cursor, LUNCH_AT) + LUNCH_MIN; lunchDone = true; }
      let end = cursor + rest[i].dur;
      if (!lunchDone && end > LUNCH_AT) { end += LUNCH_MIN; lunchDone = true; }
      const mid = (cursor + end) / 2;
      if (mins < mid) { to = i; break; }
      cursor = end;
    }
    if (to === from) return;
    const next = [...rest];
    next.splice(to, 0, arr[from]);

    // Anything overdue or high-priority that ends up LATER than it was — whether it
    // was the block you dragged or one you jumped over — needs a reason. Late work
    // is not blocked from moving; it is just never moved silently.
    const wasAt = new Map(arr.map((p, i) => [p.key, i]));
    const pushedBack = next
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i > (wasAt.get(p.key) ?? i) && isProtected(p.taskId))
      .map(({ p }) => p);
    if (pushedBack.length) {
      const names = pushedBack.map((p) => `“${p.label}”`).join(", ");
      const reason = await promptDialog({
        title: pushedBack.length === 1 ? "This one is meant to go out first" : "These are meant to go out first",
        body: (
          <>
            {names} {pushedBack.length === 1 ? "is" : "are"} overdue or high priority, and this move pushes
            {pushedBack.length === 1 ? " it" : " them"} later in the day.
            <div className="mt-2">Say why, and it goes on the task&apos;s activity so nobody has to guess later.</div>
          </>
        ),
        placeholder: "e.g. waiting on the client's logo",
        action: "Move it anyway",
      });
      if (!reason || !reason.trim()) return;   // no reason → the day is left alone
      for (const p of pushedBack) {
        fetch("/api/my-day/plan-note", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
          body: JSON.stringify({ taskId: p.taskId, actor: person, reason: reason.trim(), from: wasAt.get(p.key), to: next.findIndex((x) => x.key === p.key) }),
        }).catch(() => {});
      }
      setToast({ who: "Moved, and noted", color: "#D97706", av: me.av, body: reason.trim() });
    }

    setPlan(next);
    saveOrder(next);
    recordHistory({
      id: "", label: `Moved “${arr[from].label}” to ${to === 0 ? "the start of the day" : `position ${to + 1}`}`,
      undo: {}, redo: {},
      order: { undo: arr.map((p) => p.taskId), redo: next.map((p) => p.taskId) },
    });
    // The list beside the timeline has to agree with what was just dragged, so a
    // drag switches it to plan order. Any other sort is a deliberate choice and is
    // only overridden here, by a deliberate drag.
    pickSort("plan");
  };

  /**
   * Put the day back in its natural order: overdue first, then Urgent/High, then by
   * publishing date. Clears the saved manual order — otherwise it would come back
   * on the next load and the button would look broken.
   */
  const rearrangePlan = async () => {
    const ok = await confirmDialog({
      title: "Rearrange today's plan?",
      body: <>It goes back to overdue first, then high priority, then by publishing date. Anything you dragged today is forgotten.</>,
      action: "Rearrange",
    });
    if (!ok) return;
    const meta = (id?: string) => [...tasks, ...claimedTasks, ...samvaya].find((t) => t.id === id);
    const rank = (p: PlanItem) => {
      const t = meta(p.taskId);
      const late = todayStr && t?.due && t.due < todayStr ? 0 : 1;
      const hot = t && isHot(t.detail.priority) ? 0 : 1;
      return [late, hot, t?.due || "9999"] as [number, number, string];
    };
    const before = plan;
    const next = [...plan].sort((a, b) => {
      const [la, ha, da] = rank(a), [lb, hb, db] = rank(b);
      return (la - lb) || (ha - hb) || da.localeCompare(db);
    });
    setPlan(next);
    saveOrder(next);
    recordHistory({
      id: "", label: "Rearranged today's plan",
      undo: {}, redo: {},
      order: { undo: before.map((p) => p.taskId), redo: next.map((p) => p.taskId) },
    });
    pickSort("plan");
    setToast({ who: "Rearranged", color: "#3A57E8", av: me.av, body: "Overdue first, then high priority, then by date." });
  };

  // The producer sets how long a task takes → store it AND add/update it on Today's plan.
  const setDuration = (id: string, mins: number, reason?: string, undoOf?: string) => {
    const prevT = [...tasks, ...claimedTasks].find((t) => t.id === id);
    const prevDur = prevT?.detail.duration ?? null;
    // An extension carries a reason (the timer strip requires one). Keep the whole
    // history on the task, not just the latest: three +15s with three different
    // excuses is a different story from one clean +45.
    if (reason && prevDur != null) {
      const entry = { at: new Date().toISOString(), by: person, fromMin: prevDur, toMin: mins, reason, ...(undoOf ? { undoOf } : {}) };
      const prevLog = Array.isArray(prevT?.detail.extensions) ? prevT!.detail.extensions : [];
      const nextLog = [...prevLog, entry];
      // Show the new row straight away. The write below is what makes it real, but
      // without this the panel keeps rendering the old log until the next poll — the
      // entry looked like it hadn't saved when it had.
      const withLog = (t: Task) => (t.id === id ? { ...t, detail: { ...t.detail, extensions: nextLog } } : t);
      setTasks((a) => a.map(withLog));
      setClaimedTasks((a) => a.map(withLog));
      fetch("/api/marketing-hub/update", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, actor: person, fields: { custom: { time_extensions: nextLog } } }),
      })
        .then(() => load())   // resync so the trail matches the server, not just the guess
        .catch(() => { /* the minutes still save below; the note is a courtesy trail */ });
    }
    setTasks((a) => a.map((t) => (t.id === id ? { ...t, detail: { ...t.detail, duration: mins } } : t)));
    setClaimedTasks((a) => a.map((t) => (t.id === id ? { ...t, detail: { ...t.detail, duration: mins } } : t)));
    setPlan((p) => {
      if (p.some((x) => x.taskId === id)) return p.map((x) => (x.taskId === id ? { ...x, dur: mins } : x));
      const t = [...claimedTasks, ...tasks].find((x) => x.id === id);
      return t ? [...p, { key: `pk${id}`, taskId: id, label: t.title, dur: mins }] : p;
    });
    setToast({ who: "Duration set", color: "#3A57E8", av: me.av, body: `${fmtDur(mins)} — slotted into Today's plan.` });
    // Persist so it survives reload (drives the timer's planned time + plan blocks).
    fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, actor: person, fields: { duration_min: mins } }) })
      .then(async (res) => {
        if (!res.ok) { const j = await res.json().catch(() => ({})); setToast({ who: "Duration save failed", color: "#C03221", av: "!", body: j.error || `HTTP ${res.status}` }); return; }
        if (prevDur !== mins) recordHistory({ id, label: `${prevT?.title || "Task"}: duration ${prevDur ? fmtDur(prevDur) : "unset"} → ${fmtDur(mins)}`, undo: { duration_min: prevDur }, redo: { duration_min: mins } });
      })
      .catch((e) => setToast({ who: "Duration save failed", color: "#C03221", av: "!", body: String(e) }));
  };
  // Current value of a supported field on a task — used by the undo conflict check.
  const fieldNow = (t: Task, field: string): unknown => {
    switch (field) {
      case "status": return t.status;
      case "duration_min": return t.detail.duration ?? null;
      case "priority": return t.detail.priority;
      case "due_date": case "publishing_date": return t.due || "";
      default: return undefined;
    }
  };
  // Apply one history entry, but only if the task hasn't been changed out from
  // under us since (tasks are shared — never clobber someone else's edit).
  const applyHistory = (e: HistEntry, dir: "undo" | "redo"): boolean => {
    if (e.order) {
      const ids = dir === "undo" ? e.order.undo : e.order.redo;
      const rank = new Map(ids.map((id, i) => [id, i]));
      setPlan((arr) => {
        const next = [...arr].sort((a, b) => (rank.get(a.taskId) ?? Infinity) - (rank.get(b.taskId) ?? Infinity));
        saveOrder(next);
        return next;
      });
      return true;
    }
    const cur = [...tasks, ...claimedTasks].find((t) => t.id === e.id);
    const expect = dir === "undo" ? e.redo : e.undo; // what we last set
    const fields = dir === "undo" ? e.undo : e.redo;
    if (cur && Object.entries(expect).some(([f, v]) => { const now = fieldNow(cur, f); return now !== undefined && now !== v; })) {
      setToast({ who: "Skipped", color: "#D97706", av: "!", body: `“${cur.title || "Task"}” changed since — can't ${dir}.` });
      return false;
    }
    rawUpdate(e.id, fields);
    return true;
  };
  const undo = () => {
    if (!undoStack.length) return;
    const e = undoStack[undoStack.length - 1];
    const ok = applyHistory(e, "undo");
    setUndoStack((s) => s.slice(0, -1));
    if (ok) { setRedoStack((r) => [...r, e]); setToast({ who: "Undone", color: "#3A57E8", av: me.av, body: e.label }); }
  };
  const redo = () => {
    if (!redoStack.length) return;
    const e = redoStack[redoStack.length - 1];
    const ok = applyHistory(e, "redo");
    setRedoStack((s) => s.slice(0, -1));
    if (ok) { setUndoStack((u) => [...u, e]); setToast({ who: "Redone", color: "#3A57E8", av: me.av, body: e.label }); }
  };
  // My Day had undo before the dashboard-wide one existed, and its stack knows
  // something the shared one does not: it REFUSES when the task has changed since,
  // rather than writing a stale value back over somebody else's edit. So it keeps
  // its own and silences the shared handler while this page is open — otherwise one
  // Ctrl+Z would be read by two stacks and the wrong thing would come back.
  useOwnUndo();
  // ⌘Z / ⌘⇧Z (and Ctrl on Windows). Let native undo win inside text fields.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.metaKey || ev.ctrlKey)) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const k = ev.key.toLowerCase();
      if (k === "z" && !ev.shiftKey) { ev.preventDefault(); undo(); }
      else if ((k === "z" && ev.shiftKey) || k === "y") { ev.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoStack, redoStack, tasks, claimedTasks]);
  // (Auto-plan removed — priority now auto-slots on arrival; see the plan-seed effect.)
  // Capability gates now come from Team permissions (per-person toggles), not
  // hardcoded names. Admins implicitly have every capability.
  const activeCaps = capByPerson[person];
  const can = (cap: Capability) => !!activeCaps && hasCapability(activeCaps as never, cap);
  const canCreate = can("create_tasks");      // + New task
  // Opening the form takes over the right-hand panel, so it also clears whatever was
  // open there — otherwise the list would still highlight a task you can no longer see.
  const openComposer = () => { setComposing(true); setComposerDirty(false); setSel(null); setPeekId(null); };
  const closeComposer = () => { setComposing(false); setComposerDirty(false); };
  // Leaving the form for something else: only ask when there is typing to lose.
  const leaveComposer = async () => {
    if (!composing) return true;
    if (composerDirty && !(await confirmDialog({ title: "Discard this new task?", body: "You've started filling the form. Leaving now throws away what you typed.", action: "Discard", danger: true }))) return false;
    closeComposer();
    return true;
  };
  const canSchedule = can("approve_content");  // Send to Scheduler (post)
  const canEditTasks = can("edit_tasks");      // edit priority / due date
  const canDeleteTasks = can("delete_tasks");  // remove a task
  const canAssignTasks = can("assign_tasks");  // hand to a teammate
  const isAdmin = canSchedule; // preserve existing prop name below

  // No auto-start. Opening a task used to start its clock (and move it to In
  // Progress) when it was waiting on you — so opening one just to look started
  // the timer: "I thought I just need to see how many contents are approved for
  // today… as soon as I clicked, it turned on the timer" (Praveen, 21 Oct). Now
  // you open it, pick the time (Set duration) and press Start.

  // Create a task → apply the Type→owner routing, drop it where it belongs (design
  // → the owner's My tasks; video → the editors' claim pool), and toast the result.
  // Capacity-gated: a new task starts on Manya (writer) — warn if her day is full.
  // The creator is whoever is signed in — PPL, not TEAM, because TEAM has no Maheen
  // and would fall back to the wrong person for an admin.
  const creatorName = PPL[person]?.name || me.name;
  // The shared form hands back plain answers (NewTaskDraft), not a My Day Task —
  // that is what lets the Content Calendar reuse the same form. My Day still wants
  // its own optimistic row on the board, so the mapping lives here, in the one place
  // that needs it.
  const createFromDraft = (d: NewTaskDraft) => {
    const publishes = d.publishDate ? new Date(d.publishDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "No date yet";
    const t: Task = {
      id: `t${Date.now()}`,
      title: d.title,
      meta: `${d.type} · content`,
      status: d.status,
      due: d.publishDate,
      detail: {
        typeLine: d.type, publishes, owner: creatorName, priority: d.priority, brand: d.sbu,
        content: d.content,
        creatives: [], collaborators: d.collaborators.map((k) => PPL[k]).filter(Boolean),
        activity: [{ who: creatorName, text: "created the task", time: "now" }],
      },
    };
    createTask(t, d.status, d.collaborators, d.assets,
      d.thumbnail ? { thumbnail: d.thumbnail, sbu: d.sbu, publishDate: d.publishDate, priority: d.priority } : undefined,
      // The routing card already worked out where this lands — use the same answer
      // rather than assuming it stays with whoever typed it.
      d.route.pool ? null : (d.route.ownerKey ? (PPL[d.route.ownerKey]?.name || creatorName) : null));
  };
  type ThumbSpec = Parameters<typeof attachThumbnailTask>[0];
  // `chargeTo` is the person whose day this task will actually land on — NOT whoever
  // is filling the form. Creating a task and doing it are different things: an
  // approved video goes to the editors' claim pool, and approved design work goes to
  // Praveen, so warning Manya that HER day is full would be about work she is not
  // going to do. null means nobody owns it yet (the claim pool), so there is no day
  // to check against.
  const createTask = (t: Task, status: CCStatus, collaborators: string[], assets?: NewTaskAssets, thumb?: ThumbSpec, chargeTo?: string | null) => {
    const who = chargeTo === undefined ? creatorName : chargeTo;
    const add = estMins(t.detail.typeLine);
    const committed = who ? committedFor(who) : 0;
    if (who && committed + add > WORK_MIN) {
      setAssignWarn({ name: who, committed, add, cta: "Create anyway", proceed: () => doCreateTask(t, status, collaborators, assets, thumb) });
      return;
    }
    doCreateTask(t, status, collaborators, assets, thumb);
  };
  const doCreateTask = (t: Task, status: CCStatus, collaborators: string[], assets?: NewTaskAssets, thumb?: ThumbSpec) => {
    closeComposer();
    // Persist to mh_posts. Content-first: the row is always CREATED on the writer at
    // "Content - Pending" (the create route files it that way), and if the form asked
    // for a later status we move it there straight after — through the same status
    // route the board uses, so the Content-Approved handoff fires exactly once and
    // exactly as the form's routing card promised.
    fetch("/api/marketing-hub/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: t.title,
        type: t.detail.typeLine,
        sbu: t.detail.brand,
        owner: person,
        publishingDate: t.due || undefined,
        dueDate: t.due || undefined,
        priority: t.detail.priority,
        content: t.detail.content,
      }),
    })
      .then(async (res) => {
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          // 422 = the create completeness gate — name the missing fields instead of
          // a one-line "create failed" toast.
          const block = gateFromResponse(res.status, j, t.title || "This task");
          if (block) setGateBlock(block);
          else setToast({ who: "Create failed", color: "#C03221", av: "!", body: j.error || `HTTP ${res.status}` });
          return;
        }
        // Now the row exists — persist any references / output the writer attached in the
        // form (they need the real post id). Links go on the row; images become attachments.
        const postId = j.id as string | undefined;
        if (postId && assets) {
          const fields: Record<string, unknown> = {};
          if (assets.refLinks.length) fields.reference_links = assets.refLinks;
          if (assets.outLink) fields.output_link = assets.outLink;
          if (Object.keys(fields).length) {
            await fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: postId, actor: person, fields }) }).catch(() => {});
          }
          const upload = async (file: File, kind: "reference" | "creative" | "attachment") => {
            const r = await uploadTaskFile(postId, file, kind, person);
            if (!r.ok) showToast({ who: `Couldn't add ${file.name}`, body: r.error, color: "#C03221", av: "!" });
          };
          for (const f of assets.refFiles) await upload(f, "reference");
          for (const f of assets.outFiles) await upload(f, "creative");
          for (const f of assets.attFiles || []) await upload(f, "attachment");
        }
        // Hand-picked collaborators go on BEFORE the status move, so a Content-Approved
        // handoff never lands on a half-built team.
        if (postId && collaborators.length) {
          await fetch("/api/marketing-hub/collaborators", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId, memberKeys: collaborators }) }).catch(() => {});
        }
        // The companion thumbnail, when the writer asked for one. Same helper the
        // Content Calendar's dialog uses, so the two rows are linked the same way and
        // the claim screen can find it later.
        if (postId && thumb) await attachThumbnailTask(thumb, postId, person).catch(() => null);
        // Filed at a later status → move it there now. This is the ordinary status
        // route, so the server does the assigning; the form only predicted it.
        let statusNote = `starts with ${creatorName} (Content - Pending)`;
        if (postId && status !== "Content - Pending") {
          const moved = await fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: postId, actor: person, fields: { status } }) }).catch(() => null);
          if (moved && moved.ok) {
            await releaseToPoolIfEditor(postId, person, t.detail.typeLine, status);
            const r = routeFor(t.detail.typeLine, status, person);
            statusNote = `${STATUS[status].label} — ${r.pool ? "in the editors' claim pool" : `with ${r.ownerLabel}`}`;
          } else {
            statusNote = `created, but it stayed at Content - Pending — move it to ${STATUS[status].label} from the task`;
          }
        }
        const extras = assets ? [assets.refFiles.length + assets.refLinks.length ? "references" : "", assets.outFiles.length + (assets.outLink ? 1 : 0) ? "output" : "", assets.attFiles?.length ? "attachments" : ""].filter(Boolean).join(" + ") : "";
        setToast({ who: "Created", color: "#3A57E8", av: PPL[person]?.av || me.av, body: `“${t.title}” added — ${statusNote}${extras ? ` · ${extras} attached` : ""}.` });
        load();
        loadCreated(); // the new row belongs in "Tasks I created" straight away
      })
      .catch((e) => setToast({ who: "Create failed", color: "#C03221", av: "!", body: String(e) }));
  };

  // ── Capacity pipeline (Accept & Work) ──
  // `workMin` (minutes booked on Today's plan) is the person's committed load.
  const addNotif = (n: Notif) => setNotifs((ns) => [n, ...ns.filter((x) => x.id !== n.id)]);
  const dismissNotif = (id: string) => setNotifs((ns) => ns.filter((n) => n.id !== id));
  // The two answers to "your time is nearly up", handled from the notification itself so
  // nobody has to go hunting for the task first.
  //   Task completed → move it on, which stops the clock.
  //   Extend         → ask how long and why, then add it. Same rule as "+ Extend": no
  //                    reason, no extra time.
  const onTimeUpChoice = async (n: Notif, choice: "done" | "extend") => {
    const id = n.timeUp?.taskId;
    const t = id ? [...tasks, ...claimedTasks].find((x) => x.id === id) : null;
    if (!t) { dismissNotif(n.id); return; }
    if (choice === "done") {
      dismissNotif(n.id);
      setTaskStatus(t.id, "Output - Ready");
      return;
    }
    const tm = taskTiming(t);
    const planned = tm?.planned ?? t.detail.duration ?? estMins(t.detail.typeLine);
    const mins = await promptDialog({ title: "How much longer?", body: "Minutes to add.", action: "Next", defaultValue: "15" });
    const add = Math.floor(Number(mins));
    if (!Number.isFinite(add) || add < 1) return;         // cancelled or nonsense
    const why = await promptDialog({
      title: `Why the extra ${fmtMins(add)}?`,
      body: "It stays on the task, so the overrun can be accounted for later.",
      action: "Add time", placeholder: "e.g. client sent new copy · 3 extra slides",
    });
    if (!why || !why.trim()) return;                      // no reason, no extra time
    dismissNotif(n.id);
    setDuration(t.id, planned + add, why.trim());
  };
  const onAcceptNotif = (n: Notif) => {
    if (n.task) { setAcceptTask(n.task); return; }
    // Pipelined handoff (server notification with postId): accepting IS the
    // ownership takeover — that's the only way a queued task joins your board.
    if (n.postId) {
      dismissNotif(n.id);
      fetch("/api/marketing-hub/takeover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId: n.postId, newOwnerKey: person }) })
        .then(async (res) => {
          if (!res.ok) { const j = await res.json().catch(() => ({})); setToast({ who: "Accept failed", color: "#C03221", av: "!", body: j.error || `HTTP ${res.status}` }); }
          else setToast({ who: "Accepted", color: "#3A57E8", av: me.av, body: "It's yours now — added to My tasks + Today's plan." });
          load();
        })
        .catch((e) => { setToast({ who: "Accept failed", color: "#C03221", av: "!", body: String(e) }); load(); });
    }
  };
  // Accepting a pipelined/offered task is the REAL ownership takeover — this is the
  // moment a queued handoff actually joins your board (never before).
  const acceptWork = () => {
    const t = acceptTask; if (!t) return;
    setAcceptTask(null);
    setPipeline("done");
    fetch("/api/marketing-hub/takeover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: t.id, newOwnerKey: person }),
    })
      .then(async (res) => {
        if (!res.ok) { const j = await res.json().catch(() => ({})); setToast({ who: "Accept failed", color: "#C03221", av: "!", body: j.error || `HTTP ${res.status}` }); }
        else setToast({ who: "Accepted", color: "#3A57E8", av: me.av, body: `“${t.title}” is yours now — added to your plan.` });
        load(); // server truth → it appears in My tasks + Today's plan via the sync
      })
      .catch((e) => { setToast({ who: "Accept failed", color: "#C03221", av: "!", body: String(e) }); load(); });
  };
  // "Swap" → the producer does NOT pick. Their whole NOT-STARTED list is sent to
  // Manya automatically ("swap any of these for the incoming task") — SHE picks
  // which one moves, from her Requests. The currently-running block is excluded.
  const askManyaToMove = () => {
    const t = acceptTask; setAcceptTask(null);
    if (!t) return;
    const nowBlk = planBlocks.find((b) => b.kind === "reel" && nowMin != null && b.start <= nowMin && nowMin < b.start + b.dur);
    const all = [...claimedTasks, ...tasks];
    const candidates = myPlan
      .filter((p) => p.taskId !== nowBlk?.taskId)
      .map((p) => ({ id: p.taskId, title: p.label, dur: p.dur, due: all.find((x) => x.id === p.taskId)?.due || "" }));
    if (!candidates.length) { setToast({ who: "Nothing to offer", color: "#D97706", av: "!", body: "Everything left today is already in progress — nothing can be swapped." }); return; }
    fetch("/api/my-day/swap-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pendingId: t.id, from: person, candidates }) })
      .then(async (res) => {
        if (!res.ok) { const j = await res.json().catch(() => ({})); setToast({ who: "Send failed", color: "#C03221", av: "!", body: j.error || `HTTP ${res.status}` }); }
        else setToast({ who: `Sent to ${nameOfRole("writer", "the writer")}`, color: "#3A57E8", av: me.av, body: `Your ${candidates.length} not-started task${candidates.length > 1 ? "s" : ""} were offered — she'll pick which one moves.` });
      })
      .catch((e) => setToast({ who: "Send failed", color: "#C03221", av: "!", body: String(e) }));
  };
  // Day clock — login = start (auto, above), End day = wrap-up then log out.
  // Team-capacity page is Manya-only — snap back to My Day if the view switches away.
  useEffect(() => { if (!isWriter(person)) setScreen("myday"); }, [person]);
  // "Log back in" from the logged-out overlay: re-anchors the plan to the new login
  // time (demo — no real session change). Mirrors the auto-start on first view.
  // Record this person's login / logout server-side so the admin Attendance board
  // can show them. Best-effort — never blocks the UI.
  const postAttendance = (action: "login" | "logout", min: number, at: string, rolled?: { title: string; reason: string }[]) => {
    // An admin PREVIEWING a teammate must not write that teammate's attendance.
    // An admin looking at their OWN day is just a person ending their day, and
    // used to be blocked here too — which is half of why the board read 0/5.
    if (viewerIsAdmin && person !== viewerId) return Promise.resolve();
    return fetch("/api/my-day/attendance", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ person, action, min, at, rolled }) }).then(() => {}, () => {});
  };
  const logBackIn = () => {
    const d = new Date();
    const min = Math.max(0, Math.min(d.getHours() * 60 + d.getMinutes() - DAY_START_H * 60, DAY_MINS));
    const at = clockOf(min);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setDayStarted(true); setDayStartMin(min); setLoggedOut(false);
    try { localStorage.setItem(`hmd-day-${person}`, JSON.stringify({ at, min, date })); } catch { /* private mode */ }
    postAttendance("login", min, at);
  };
  const endToday = (doneCount: number, rollCount: number, rolled: { id: string; title: string; reason: string }[] = []) => {
    // End day = wrap-up (already confirmed) → demo logout. Clear the clock so the next
    // login re-anchors; show the logged-out overlay instead of ending the real session.
    const d = new Date();
    const min = Math.max(0, Math.min(d.getHours() * 60 + d.getMinutes() - DAY_START_H * 60, DAY_MINS));
    // Persist each rolled task's "why it's not done" reason onto the task itself
    // (additional_info) so it shows as the delay note on the admin Attendance board —
    // typed once here, no separate entry. Best-effort; never blocks logout.
    for (const t of rolled) {
      if (!t.id || !t.reason) continue;
      fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, actor: person, fields: { additional_info: t.reason } }) }).catch(() => {});
    }
    const saved = postAttendance("logout", min, clockOf(min), rolled.map((t) => ({ title: t.title, reason: t.reason })));
    setDayStarted(false); setShowEod(false); setDayStartMin(0); setProfileOpen(false);
    try { localStorage.removeItem(`hmd-day-${person}`); } catch { /* private mode */ }
    setToast({ who: "Day wrapped", color: "#1AA053", av: me.av, body: `${doneCount} done · ${rollCount} rolled to tomorrow — logging out.` });
    // Really sign out once the logout time is saved. It used to show a "Day ended"
    // card whose only button was "Back to My Day" — which recorded a NEW login and
    // left you signed in (Praveen, 21 Oct). Whoever presses it is signed out, admin or
    // not; an admin on someone else's day records nothing for them (postAttendance).
    const out = () => {
      const f = document.createElement("form");
      f.method = "post"; f.action = "/api/logout";
      document.body.appendChild(f); f.submit();
    };
    Promise.race([saved, new Promise((r) => setTimeout(r, 2500))]).then(out);
  };
  // Editor sends the reschedule ask → the request goes to Manya (pipeline: waiting).
  const sendToManya = () => {
    setAskManya(false);
    setPipeline("waiting");
    setToast({ who: `Sent to ${nameOfRole("writer", "the writer")}`, color: "#3A57E8", av: me.av, body: "She'll free a slot — you'll get a heads-up." });
  };
  // Manya confirms the reschedule → slides the chosen task out, frees room, and the
  // editor's pipeline flips to "freed" (they'll see the follow-up notification).
  const manyaConfirmMove = () => {
    setPlan((p) => (p.length > 1 ? p.slice(0, -1) : p)); // free ~1h 30m on the editor's day
    setPipeline("freed");
    setToast({ who: "Room freed", color: "#1AA053", av: me.av, body: "Slid a low-priority reel to tomorrow — Nandu can take the urgent one now." });
  };
  // Real notifications, polled from the activity log — claims, handoffs, send-backs
  // and pushes-to-schedule relevant to the person being viewed. Refetched on person
  // switch and every 20s so a claim/hand-off shows up shortly after it happens.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch(`/api/my-day/notifications?person=${person}`, { cache: "no-store" });
        const d = await r.json();
        // Keep the clock alerts. They are raised in the browser from the running timer,
        // so the server knows nothing about them — replacing the list wholesale wiped
        // each "time is nearly up" the moment the next poll landed, seconds later.
        if (alive && r.ok) setNotifs((prev) => {
          const localAlerts = prev.filter((n) => n.timeUp);
          const fromServer = ((d.notifs as Notif[]) || []).filter((s) => !localAlerts.some((l) => l.id === s.id));
          return [...localAlerts, ...fromServer];
        });
      } catch { /* keep the last batch on a transient error */ }
    };
    pull();
    // Skip the data pull while the tab is hidden (background tabs shouldn't poll);
    // the next tick after refocus refreshes (≤20s).
    const id = setInterval(() => { if (shouldPoll()) pull(); }, 20_000);
    return () => { alive = false; clearInterval(id); };
  }, [person]);
  // My-tasks row → expands inline in the "Up next" panel (setSel).
  // Today's-plan block → opens the task in a popup (like the original dashboard).
  // Claim a video → you become the owner; it leaves the pool and lands in My tasks.
  // Claiming is self-assignment — same capacity gate: warn if MY 8h is already full.
  const claimVideo = (v: Task) => {
    const add = v.detail.duration || estMins(v.detail.typeLine);
    const committed = committedFor(me.name);
    if (committed + add > WORK_MIN) {
      setAssignWarn({ name: me.name, committed, add, cta: "Claim anyway", proceed: () => doClaimVideo(v) });
      return;
    }
    doClaimVideo(v);
  };
  const doClaimVideo = (v: Task) => {
    // Optimistic: it leaves the pool and lands in My tasks immediately. Claiming is
    // ownership only — the status STAYS "Content - Approved" (the editor may not start
    // cutting for a while), matching what the takeover write persists on the server.
    setClaimPool((p) => p.filter((x) => x.id !== v.id));
    const claimed: Task = { ...v, status: "Content - Approved", meta: `${v.detail.typeLine} · you claimed this`, detail: { ...v.detail, owner: me.name } };
    setClaimedTasks((c) => [claimed, ...c.filter((x) => x.id !== v.id)]);
    claimsInFlight.current.add(v.id);
    setSel(0); // open the freshly claimed task in "Up next"
    setToast({ who: "Claimed", color: me.color, av: me.av, body: `You claimed “${v.title}” — it's yours now, added to My tasks.` });
    // Persist the ownership takeover, then reconcile with server truth. On failure,
    // roll back the optimistic claim (restore it to the pool) and surface the error —
    // never leave the editor believing they own a video the server never took over.
    const rollback = (body: string) => {
      claimsInFlight.current.delete(v.id);
      setClaimedTasks((c) => c.filter((x) => x.id !== v.id));
      setClaimPool((p) => (p.some((x) => x.id === v.id) ? p : [v, ...p]));
      setToast({ who: "Claim failed", color: "#C03221", av: "!", body });
    };
    fetch("/api/marketing-hub/takeover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: v.id, newOwnerKey: person }),
    })
      .then(async (res) => {
        if (res.ok) {
          // The video is claimed. If it carries a thumbnail, this is the moment its
          // owner gets settled — either it follows the editor automatically, or they
          // are asked. A thumbnail already given to Praveen needs nothing.
          const th = v.detail.thumbnail;
          if (th?.taskId && th.decision === "editor") {
            const ok = await assignThumbnail(th.taskId, v.id, person, person);
            setToast(ok
              ? { who: "Thumbnail too", color: me.color, av: me.av, body: `The ${th.type || "thumbnail"} for “${v.title}” is yours as well — it's in My tasks.` }
              : { who: "Thumbnail not moved", color: "#C03221", av: "!", body: `You own “${v.title}”, but its thumbnail couldn't be assigned. Open it and take it by hand.` });
          } else if (th?.taskId && th.decision === "ask") {
            setThumbAsk({ thumbId: th.taskId, videoId: v.id, videoTitle: v.title, type: th.type || "Thumbnail" });
          }
          claimsInFlight.current.delete(v.id);
          load();
          return;
        }
        const j = await res.json().catch(() => ({}));
        rollback(j.error || `HTTP ${res.status}`);
      })
      .catch((e) => rollback(String(e)));
  };
  // Answer to "who makes the thumbnail?" — whoever is chosen gets it in their own list.
  const settleThumb = async (ownerKey: string) => {
    if (!thumbAsk) return;
    const { thumbId, videoId, videoTitle, type } = thumbAsk;
    setThumbAsk(null);
    const ok = await assignThumbnail(thumbId, videoId, ownerKey, person);
    setToast(ok
      ? {
          who: ownerKey === person ? "Thumbnail yours" : "Sent to Praveen",
          color: ownerKey === person ? me.color : (PPL.praveen?.color || "#C2410C"),
          av: ownerKey === person ? me.av : "P",
          body: ownerKey === person
            ? `The ${type} for “${videoTitle}” is in My tasks.`
            : `Praveen has the ${type} for “${videoTitle}” — it's in his list now.`,
        }
      : { who: "Couldn't assign it", color: "#C03221", av: "!", body: `The ${type} for “${videoTitle}” stayed where it was. Try from the task itself.` });
    load();
  };
  // Inline claim confirm (spec §8), with the owner/collaborator rule agreed 22 Sep.
  //
  // The OWNER is whoever edits. So "Present on camera" is NOT a claim: it records
  // that this person will shoot it and leaves the task in the pool for an editor,
  // who then owns it with the presenter as a collaborator. "Edit video" and "Both"
  // do claim it. Both editors get the choice — Nandu takes "Both" on a text reel
  // that needs no presenter, exactly as Nikhil does.
  // The video pair (Nikhil's request, 5 Oct — "Nikhil and Nandu pair only"): Nikhil
  // presenting hands the edit to Nandu straight away; Nandu editing puts Nikhil on
  // camera. The pair is each person's "Edit partner" on Team & access (27 Oct); the
  // server checks it, so this can't be used to assign anyone else.
  const confirmClaim = (v: Task, role?: "present" | "edit" | "both") => {
    setClaimConfirm(null);
    const partner = role === "present" ? editPartnerOf(person) : undefined;
    if (partner) {
      const name = PPL[partner]?.name || partner;
      setClaimPool((p) => p.filter((x) => x.id !== v.id));
      setToast({ who: "You're presenting", color: me.color, av: me.av, body: `You're on camera for “${v.title}” — editing went to ${name}.` });
      (async () => {
        const hdr = { "Content-Type": "application/json" };
        const r1 = await fetch("/api/marketing-hub/update", { method: "PATCH", headers: hdr,
          body: JSON.stringify({ id: v.id, actor: person, fields: { custom: { presenter_key: person, claim_role: "present" } } }) });
        const r2 = r1.ok ? await fetch("/api/marketing-hub/takeover", { method: "POST", headers: hdr,
          body: JSON.stringify({ postId: v.id, newOwnerKey: partner, role: "present" }) }) : r1;
        if (!r2.ok) {
          const j = await r2.json().catch(() => ({}));
          setToast({ who: "Couldn't hand it over", color: "#C03221", av: "!", body: j.error || `HTTP ${r2.status}` });
        }
        load();
      })().catch(() => load());
      return;
    }
    if (role === "present") {
      // Register as presenter; ownership stays open.
      setToast({ who: "You're presenting", color: me.color, av: me.av, body: `Noted — you're on camera for “${v.title}”. It stays open for an editor to claim.` });
      fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: v.id, actor: person, fields: { custom: { presenter_key: person, claim_role: "present" } } }) })
        .then(() => load())
        .catch(() => {});
      return;
    }
    if (role) {
      // Nandu editing puts Nikhil on camera — unless someone already said they'd present.
      const presenter = role === "edit" && !v.detail.presenter ? presenterFor(person) : undefined;
      const saved = fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: v.id, actor: person, fields: { custom: { claim_role: role, ...(presenter ? { presenter_key: presenter } : {}) } } }) })
        .catch(() => {});
      // The claim reads the presenter to attach them, so it must wait for that write.
      if (presenter) { saved.finally(() => claimVideo(v)); return; }
    }
    claimVideo(v);
  };
  const remOpen = reminders.filter((r) => !r.done).length;
  const remDone = reminders.length - remOpen;

  // Conversations derived from the live messages, relative to the viewed person.
  const convos = useMemo<Record<string, Convo>>(() => {
    const fmt = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    // online is intentionally NOT set — we have no real presence source, and faking
    // "● online" misleads (frontend-audit finding).
    const out: Record<string, Convo> = {
      team: { id: "team", name: "Team chat", group: true, unread: 0, msgs: [] },
    };
    // Everyone in PPL — today's team plus Team-page newcomers (usePplTeam).
    for (const k of Object.keys(PPL)) {
      if (k === person) continue;
      out[k] = { id: k, name: PPL[k].name, av: PPL[k].av, color: PPL[k].color, unread: 0, msgs: [] };
    }
    for (const m of chatMsgs) {
      const cid = m.convo === "team" ? "team" : m.convo.split("~").find((k) => k !== person);
      if (!cid || !out[cid]) continue;
      const p = PPL[m.sender];
      const mine = m.sender === person;
      out[cid].msgs.push({ who: mine ? "You" : (p?.name || m.sender), av: p?.av || "?", color: p?.color || "#8A92A6", tm: fmt(m.at), body: m.body, me: mine, sys: m.kind === "system" });
      if (!mine && m.at > (chatRead[cid] || "")) out[cid].unread++;
    }
    if (activeChat && out[activeChat]) out[activeChat].unread = 0; // open thread = read
    return out;
  }, [chatMsgs, person, chatRead, activeChat]);

  const totalUnread = Object.values(convos).reduce((s, c) => s + c.unread, 0);
  const openChat = () => { setChatOpen(true); closedManually.current = false; };
  openChatRef.current = openChat;
  const closeChat = () => { if (chatPinned) return; setChatOpen(false); closedManually.current = true; };
  const markRead = (cid: string) => setChatRead((r) => {
    const nr = { ...r, [cid]: new Date().toISOString() };
    try { localStorage.setItem(`hmd-chat-read-${person}`, JSON.stringify(nr)); } catch { /* private mode */ }
    return nr;
  });
  const openConvo = (id: string) => { setActiveChat(id); markRead(id); };
  openConvoRef.current = openConvo;
  const addReminder = () => { const t = newRem.trim(); if (!t) return; setReminders((r) => [{ text: t, done: false }, ...r]); setNewRem(""); };
  // Dismiss from the Reminders strip: hide it here and file it in Notifications
  // (the bell's Reminders tab), so dismissing never loses it (Praveen, 28 Sep). It
  // used to go to the 📋 popover, which lived only in this browser.
  const hideReminder = (id: string) =>
    setDismissedNudges((d) => { const nx = d.includes(id) ? d : [...d, id]; try { localStorage.setItem(`hmd-dismissed-${person}`, JSON.stringify(nx)); } catch { /* private mode */ } return nx; });
  const fileReminder = (body: { sourceId: string; title: string; sub?: string; postId?: string; href?: string }) =>
    fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) })
      .then((r) => { if (r.ok) window.dispatchEvent(new Event(NOTIF_REFRESH)); else setToast({ who: "Not saved", color: "#C03221", av: "!", body: "Hidden here, but it couldn't be copied to Notifications." }); })
      .catch(() => setToast({ who: "Not saved", color: "#C03221", av: "!", body: "Hidden here, but it couldn't be copied to Notifications." }));
  const dismissNudge = (n: { id: string; title: string; text: string }) => {
    hideReminder(n.id);
    fileReminder({ sourceId: `${n.id}:${todayStr}`, title: n.title, sub: n.text, postId: n.id });
  };
  const visibleNudges = nudges.filter((n) => !dismissedNudges.includes(n.id));
  // Yesterday's Radar misses — the second kind of row in the same strip.
  const radarMissed = useRadarMissed();
  const [radarOpen, setRadarOpen] = useState(false);
  const radarId = radarMissed ? `radar:${radarMissed.day}` : "";
  const radarRow = radarMissed && !dismissedNudges.includes(radarId) ? radarMissed : null;
  const radarLine = radarRow ? `${radarRow.missed.length} time-sensitive Radar item${radarRow.missed.length > 1 ? "s" : ""} went past ${dayLabel(radarRow.day)} with no action` : "";
  const dismissRadar = () => {
    if (!radarRow) return;
    hideReminder(radarId);
    fileReminder({ sourceId: radarId, title: radarLine, sub: radarRow.missed.slice(0, 3).map((m) => (m.title.length > 80 ? `${m.title.slice(0, 79)}…` : m.title)).join(" · "), href: "/dashboard/preview/radar/report" });
  };
  const reminderCount = visibleNudges.length + (radarRow ? 1 : 0);
  // The reminder group starts collapsed — the count is the headline, the list is
  // one click away.
  const [remOpenGroup, setRemOpenGroup] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  useEffect(() => { try { setPlanOpen(localStorage.getItem("gc-plan-open") === "1"); } catch { /* */ } }, []);
  const togglePlan = (v: boolean) => { setPlanOpen(v); try { localStorage.setItem("gc-plan-open", v ? "1" : "0"); } catch { /* */ } };
  // Back to the task you had open (22 Oct): remembered per person in this browser,
  // reopened once when My Day loads.
  const OPEN_KEY = `gc-myday-open:${person}`;
  const reopened = useRef(false);
  useEffect(() => {
    if (reopened.current || sel !== null || !shownTasks.length) return;
    reopened.current = true;
    try { const id = localStorage.getItem(OPEN_KEY); const i = id ? shownTasks.findIndex((t) => t.id === id) : -1; if (i >= 0) setSel(i); } catch { /* */ }
  }, [shownTasks]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!task) return; try { localStorage.setItem(OPEN_KEY, task.id); } catch { /* */ } }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start and Output ready MOVE a task to another view. It used to vanish from the
  // list mid-click and the next task silently took its place in the panel (Praveen,
  // 27 Oct). Now the move is shown: the card lifts and says where it's going, then
  //  · Start → the list switches to In progress and the card lands there, with a
  //    note on the task;
  //  · Output ready → the card folds away leaving a receipt (Undo / View), and the
  //    next task opens marked "Up next".
  // The save waits for the animation (~1s) so the card is still there to animate.
  type MoveFx = { id: string; kind: "start" | "output"; phase: "lift" | "fold" | "landed" };
  const [moveFx, setMoveFx] = useState<MoveFx | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);          // open this task once the list has it
  const [startNote, setStartNote] = useState<string | null>(null);    // task id: "Timer started…" on the task
  const [switchedTo, setSwitchedTo] = useState<{ from: string; label: string } | null>(null);
  const [receipt, setReceipt] = useState<{ id: string; title: string; prev: CCStatus } | null>(null);
  const [upNext, setUpNext] = useState<{ id: string; fromTitle: string } | null>(null);
  const fxTimers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => { fxTimers.current.push(window.setTimeout(fn, ms)); };
  useEffect(() => () => { fxTimers.current.forEach(clearTimeout); }, []);
  useEffect(() => {
    if (!openId) return;
    const i = shownTasks.findIndex((t) => t.id === openId);
    if (i >= 0) { setSel(i); setOpenId(null); }
  }, [openId, shownTasks]);
  const moveTask = (t: Task, status: CCStatus) => {
    const starting = status === "Output - In Progress" && t.status === "Content - Approved";
    const finishing = status === "Output - Ready" && t.status === "Output - In Progress";
    if (moveFx || (!starting && !finishing)) { setTaskStatus(t.id, status); return; }
    if (starting) {
      setMoveFx({ id: t.id, kind: "start", phase: "lift" });
      later(() => {
        setTaskStatus(t.id, status, true);
        const ip = myTabs.find((tb) => tb.statuses.includes("Output - In Progress"));
        if (ip && taskTab !== ip.key) { setSwitchedTo({ from: taskTab, label: ip.label }); setTaskTab(ip.key); later(() => setSwitchedTo(null), 8000); }
        setOpenId(t.id);
        setMoveFx({ id: t.id, kind: "start", phase: "landed" });
        setStartNote(t.id);
        later(() => setMoveFx((m) => (m?.id === t.id ? null : m)), 6000);
        later(() => setStartNote((n) => (n === t.id ? null : n)), 7000);
      }, 900);
      return;
    }
    // Output ready: the next task is whichever slides into this one's place.
    const i = shownTasks.findIndex((x) => x.id === t.id);
    const next = shownTasks[i + 1] || shownTasks[i - 1] || null;
    setMoveFx({ id: t.id, kind: "output", phase: "lift" });
    later(() => setMoveFx({ id: t.id, kind: "output", phase: "fold" }), 750);
    later(() => {
      setTaskStatus(t.id, status, true);
      setMoveFx(null);
      setReceipt({ id: t.id, title: t.title, prev: t.status });
      later(() => setReceipt((r) => (r?.id === t.id ? null : r)), 6000);
      if (next) {
        setOpenId(next.id);
        setUpNext({ id: next.id, fromTitle: t.title });
        later(() => setUpNext((u) => (u?.id === next.id ? null : u)), 8000);
      } else setSel(null);
    }, 1150);
  };
  const dueTodayN = workingTasks.filter((t) => t.due === todayStr).length;
  // Today / Tomorrow / Later group headings in the list (prototype D) — only when the
  // list is in date order, where the groups follow each other.
  const tomorrowKey = (() => { if (!todayStr) return ""; const d = new Date(todayStr + "T00:00:00"); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const groupOf = (t: Task) => { if (!t.due) return "later"; const di = dueInfo(t.due, todayStr); return di.overdue ? "overdue" : di.today ? "today" : t.due === tomorrowKey ? "tomorrow" : "later"; };
  const GROUP_LABEL: Record<string, string> = { overdue: "Overdue", today: "Today", tomorrow: "Tomorrow", later: "Later" };
  const groupHead = (t: Task, prev: Task | null) => {
    if (sortBy !== "date") return [];
    const g = groupOf(t);
    return prev && groupOf(prev) === g ? [] : [<div key={`grp-${g}`} className="tgrp">{GROUP_LABEL[g]}</div>];
  };
  const send = () => {
    const t = msg.trim(); if (!t || !activeChat) return;
    const convo = activeChat === "team" ? "team" : dmConvo(person, activeChat);
    // Optimistic append; the follow-up loadChat() swaps in server truth.
    setChatMsgs((ms) => [...ms, { id: `tmp-${Date.now()}`, convo, sender: person, body: t, kind: "chat", at: new Date().toISOString() }]);
    setMsg("");
    fetch("/api/my-day/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ convo, sender: person, body: t }) })
      .then(async (res) => {
        if (!res.ok) { const j = await res.json().catch(() => ({})); setToast({ who: "Message failed", color: "#C03221", av: "!", body: j.error || `HTTP ${res.status}` }); }
      })
      .catch((e) => setToast({ who: "Message failed", color: "#C03221", av: "!", body: String(e) }))
      .finally(() => loadChat());
  };

  return (
    <div className="hmd preview-scope">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {reportOpen && <ReportPanel person={person} name={me.name} onClose={() => setReportOpen(false)} />}

      {/* click-away layer for the top popovers */}
      {panel && <div className="backdrop" onClick={() => setPanel(null)} />}

      {/* Logged-out screen (demo): End day / Log out lands here. "Log back in"
          re-anchors the plan to the new login time. No real session change. */}
      {loggedOut && (
        <div className="logout-screen" onClick={logBackIn}>
          <div className="logout-card" style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={logBackIn} title="Close" style={{ position: "absolute", top: ".8rem", right: ".9rem" }}>✕</button>
            <span className="logout-badge">{me.av}</span>
            <div className="logout-h">Day ended</div>
            <div className="logout-p">Your day is wrapped up. See you tomorrow.</div>
            <button className="btn primary" onClick={logBackIn}>Back to My Day</button>
          </div>
        </div>
      )}

      {/* (Videos-up-for-grabs now surfaces through the chat-panel notification stack.) */}

      {/* The shell and sidebar are in the route layout; this keeps its own main,
          which carries the chat-pane padding. */}
      <div className={`main ${chatOpen ? "chatpad" : ""}`}>

        {/* The redundant top workspace-tab bar was removed — the sidebar's My Workspace
            group already navigates to Workload / Master sheet / Pipeline / Content calendar.
            This page is now just the personal My Day view (wsTab is pinned to "myday"). */}
        {wsTab === "myday" ? (<>

        {/* TOP BAR — icon triggers (page title lives in the greeting below) */}
        <div className="topbar">
          <div className="dayctl topctl">
              {/* Approvals — admin/Maheen only. Always here (not tied to the person
                  being viewed) so publish-date sign-offs have one steady home. */}
              {viewerIsAdmin && (
                // Opens the Approvals tab (22 Oct) — one place for sign-offs, not a copy here.
                <a className="teamcapbtn" href="/dashboard/preview/approvals" title="Publish-date changes waiting for your approval" style={{ textDecoration: "none" }}>
                  <IconCalendarEvent size={15} stroke={1.8} /> Approvals{approvals.length > 0 && <span className="teamcap-n">{approvals.length}</span>}
                </a>
              )}
              {/* Role button lives here now (the day control moved up to the top bar):
                  Manya → Team capacity; editors → Claim pool. */}
              {isWriter(person) && (
                <button className="teamcapbtn" onClick={() => setScreen("team")}>
                  <IconUsers size={15} stroke={1.8} /> Team capacity
                </button>
              )}
              {isEditor && (
                <button className={`teamcapbtn ${showClaimPool ? "on" : ""}`} onClick={() => setShowClaimPool(true)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="2.5" y="6" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M16.5 10l5-2.5v9L16.5 14" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
                  Claim pool{claimPool.length > 0 && <span className="teamcap-n">{claimPool.length}</span>}
                </button>
              )}
              {isWriter(person) ? (
                /* Manya CREATES the work — no pipeline for her. She gets REQUESTS:
                   any change a producer makes (dates moved, etc.) pops up here. */
                <button className={`teamcapbtn ${pipeOpen ? "on" : ""}`} onClick={() => setPipeOpen(true)} title="Changes the team asked for — date moves, task changes">
                  {BELL} Requests{notifs.length > 0 && <span className="teamcap-n">{notifs.length}</span>}
                </button>
              ) : (
                <button className={`teamcapbtn ${pipeOpen ? "on" : ""}`} onClick={() => setPipeOpen(true)} title="Tasks queued for you — accept when you have room">
                  {IHOURGLASS} Pipeline{pipelineTasks.length > 0 && <span className="teamcap-n">{pipelineTasks.length}</span>}
                </button>
              )}
            </div>
          <div className="icons">
            {/* Undo / redo are keyboard-only now (Ctrl+Z / Ctrl+Shift+Z, ⌘Z / ⌘⇧Z) —
                the arrow buttons were removed per user request; the shortcuts still work. */}
            {/* Day control — then a divider, so End day sits apart from the
                notification icons + profile and isn't clicked by accident. End day only
                OPENS the wrap-up (a confirm step) — it never logs out on a single tap. */}
            <span className="daybar">
              <span className="daychip" title={startedAt ? "When this person signed in today" : "No sign-in recorded today — the plan starts at their shift"}>
                <span className="pulse" />{startedAt ? `Started ${startedAt}` : "Not signed in yet"}
              </span>
              <button className="btn sm endbtn" onClick={() => setShowEod(true)}>{IPOWER} End day</button>
            </span>
            <span className="topdivider" aria-hidden="true" />
            <button className="iconbtn" title={notifUnread ? `${notifUnread} unread notification${notifUnread === 1 ? "" : "s"}` : "Notifications"}
              onClick={() => { window.location.href = NOTIF_CENTER; }}>
              <span className={bellRinging ? "gc-bell-ring" : undefined} style={{ display: "inline-flex" }}>{BELL}</span>
              {notifUnread > 0 && <span className={`badge rose ${bellRinging ? "gc-badge-pop" : ""}`}>{notifUnread}</span>}
            </button>
            <button className={`iconbtn ${chatOpen ? "on" : ""}`} title="Team chat" onClick={() => (chatOpen ? closeChat() : openChat())}>
              {CHATIC}{!chatOpen && totalUnread > 0 && <span className="badge rose">{totalUnread}</span>}
            </button>
            <button className={`iconbtn ${panel === "rem" ? "on" : ""}`} title="Reminders" onClick={() => setPanel(panel === "rem" ? null : "rem")}>
              {CLIP}{remOpen > 0 && <span className="badge">{remOpen}</span>}
            </button>

            {/* Profile chip + Log out — the always-visible way to sign out (My Day has
                its own header, so it lacks the shared shell's profile menu). Log out
                runs the same End-day wrap-up → logout flow. */}
            <div className="profwrap">
              <button className={`profchip ${profileOpen ? "on" : ""}`} onClick={() => setProfileOpen((v) => !v)} title="Account">
                <Avatar p={me} cls="av av-xs" />
                <span className="profname">{me.name}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              {profileOpen && (
                <>
                  <div className="backdrop" onClick={() => setProfileOpen(false)} />
                  <div className="profmenu">
                    <div className="profhead"><Avatar p={me} cls="av av-sm" /><div><div className="profhead-n">{me.name}</div><div className="profhead-r">{me.role}</div></div></div>
                    <button className="profitem" onClick={() => { setProfileOpen(false); setShowEod(true); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      Log out
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* VIDEOS UP FOR GRABS popover — claim to become the owner */}
            {panel === "notif" && (
              <div className="popover pop-wide">
                <div className="pop-head"><span className="lbl">Videos up for grabs</span>{isEditor && <span className="muted" style={{ fontSize: ".7rem" }}>{claimPool.length} unclaimed</span>}</div>
                {!isEditor ? (
                  <div className="empty">Your work is auto-assigned — nothing to claim.</div>
                ) : claimPool.length ? (
                  claimPool.map((v) => (
                    <div key={v.id} className="claim-row">
                      <div style={{ minWidth: 0 }}>
                        <div className="claim-title">{v.title}</div>
                        <div className="claim-meta">{v.detail.typeLine} · {v.detail.brand}</div>
                      </div>
                      <button className="btn primary sm" onClick={() => claimVideo(v)}>Claim</button>
                    </div>
                  ))
                ) : <div className="empty">All claimed — nothing up for grabs ✓</div>}
              </div>
            )}

            {/* REMINDERS popover */}
            {panel === "rem" && (
              <div className="popover">
                <div className="pop-head"><span className="lbl">Reminders</span><span className="muted" style={{ fontSize: ".7rem" }}>{remOpen} open · {remDone} done</span></div>
                {reminders.map((r, i) => (
                  <div key={i} className={`note ${r.done ? "done" : ""}`} onClick={() => setReminders((arr) => arr.map((x, j) => j === i ? { ...x, done: !x.done } : x))}>
                    <span className="cb" /><span>{r.text}</span>
                  </div>
                ))}
                <div className="compose">
                  <input placeholder="Add a reminder…" value={newRem} onChange={(e) => setNewRem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addReminder()} />
                  <button className="btn primary sm" onClick={addReminder}>Add</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {screen === "team" ? (
          <TeamCapacityPage onBack={() => setScreen("myday")} tasks={tasks} nowMin={nowMin} logins={teamLogins} />
        ) : (
        <>
        {/* 1 · HEADER BAND — prototype D (22 Oct): a big greeting with one quiet line
            under it, three numbers and My report. The role buttons (Approvals, Team
            capacity, Claim pool, Pipeline / Requests) moved up into the top bar. */}
        <div className="card pad headband hb-d">
          <div className="who">
            <div className="hi">{clock ? `${clock.greet.word}, ${me.name}` : `Hello, ${me.name}`}</div>
            <div className="sub">{clock ? `${clock.date} · ${clock.time} IST` : "—"}</div>
          </div>
          <div className="hb-nums">
            {/* Due today and reminders sit with the other numbers (Praveen, 22 Oct). */}
            <div className="stat"><div className={`n ${dueTodayN ? "w" : ""}`}>{dueTodayN}</div><div className="k">Due today</div></div>
            <button type="button" className={`stat stat-btn ${remOpenGroup ? "on" : ""}`} onClick={() => setRemOpenGroup((v) => !v)} disabled={!reminderCount} title={reminderCount ? "Show the reminders" : "No reminders"}>
              <div className="n">{reminderCount}</div><div className="k">Reminder{reminderCount === 1 ? "" : "s"}</div>
            </button>
            {isWriter(person)
              ? <div className="stat"><div className="n w">{stats.pending}</div><div className="k">Pending</div></div>
              : <div className="stat"><div className="n">{stats.waiting}</div><div className="k">Waiting on me</div></div>}
            <div className="stat"><div className="n b">{stats.output}</div><div className="k">Output ready</div></div>
            <div className="stat"><div className="n g">{stats.done}</div><div className="k">Done · 7 days</div></div>
            <button type="button" className="btn hb-report" onClick={() => setReportOpen(true)}><IconReport size={16} stroke={1.8} />My report</button>
          </div>
        </div>

        {/* APPROVALS STRIP — admin only, appears under the welcome only when a
            publish-date change is waiting. One line; opens Maheen's Approvals portal. */}
        {viewerIsAdmin && approvals.length > 0 && (
          <a className="apprstrip" href="/dashboard/preview/approvals" style={{ textDecoration: "none" }}>
            <span className="apprstrip-l">
              <IconCalendarEvent size={16} stroke={1.8} />
              <span><b>{approvals.length} publish-date change{approvals.length > 1 ? "s" : ""}</b> waiting for your approval</span>
            </span>
            <span className="apprstrip-cta">Review <IconArrowsExchange size={14} stroke={1.8} /></span>
          </a>
        )}

        {/* MANYA — reschedule request when an editor is packed (team capacity moved to its own page) */}
        {isWriter(person) && pipeline === "waiting" && (
          <ManyaReschedule task={URGENT_TASK} editorName="Nandu" movedId={movedId} onMove={setMovedId} onConfirm={manyaConfirmMove} />
        )}

        {/* Smart reminders (spec §13) — stale-content / overdue nudges for this person.
            Grouped behind one collapsed row: on a busy day this was a wall of red
            above the plan. The summary line carries the count and the first task's
            name, so a collapsed group still says what's waiting.
            Yesterday's Radar misses are a row here too (they used to be a strip of their
            own right above this one). Dismissing a row files it in Notifications. */}
        {reminderCount > 0 && remOpenGroup && (
          <div className="card rem-group" style={{ marginTop: "1rem" }}>
            <button type="button" className="rem-head" aria-expanded={remOpenGroup} onClick={() => setRemOpenGroup((v) => !v)}>
              <span className={`rem-caret ${remOpenGroup ? "on" : ""}`} aria-hidden="true">›</span>
              <span className="rem-head-lbl">{BELL} {reminderCount} reminder{reminderCount > 1 ? "s" : ""}</span>
              {!remOpenGroup && (
                <span className="rem-head-peek">
                  {visibleNudges[0]?.title || radarLine}{reminderCount > 1 ? ` + ${reminderCount - 1} more` : ""}
                </span>
              )}
              <span className="rem-head-act">{remOpenGroup ? "Hide" : "Show"}</span>
            </button>
            {remOpenGroup && (
              <div className="rem-body">
                {visibleNudges.map((n) => (
                  <div key={n.id} className="rem-row">
                    <div className="rem-txt"><b>{n.title}</b> — <span className="rem-why">{n.text}</span></div>
                    <button className="btn sm" style={{ flexShrink: 0 }} onClick={() => dismissNudge(n)}>Dismiss</button>
                  </div>
                ))}
                {radarRow && (
                  <>
                    <div className="rem-row">
                      <div className="rem-txt"><span className="rcrumb-dot" style={{ display: "inline-block", marginRight: ".45rem", verticalAlign: "middle" }} /><b>{radarRow.missed.length} time-sensitive</b> Radar item{radarRow.missed.length > 1 ? "s" : ""} went past {dayLabel(radarRow.day)} with no action</div>
                      <div style={{ display: "flex", gap: ".4rem", flexShrink: 0 }}>
                        <button className="btn sm" onClick={() => setRadarOpen((v) => !v)}>{radarOpen ? "Hide" : "View"}</button>
                        <button className="btn sm" onClick={dismissRadar}>Dismiss</button>
                      </div>
                    </div>
                    {radarOpen && <RadarMissedList data={radarRow} />}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* 2 · HERO — today's plan. Folded to a progress bar by default to save space;
            click it to open the full timeline (Praveen, 22 Oct). Remembered. */}
        {!planOpen ? (() => {
          const nowBlk = nowMin == null ? null : planBlocks.find((b) => b.kind === "reel" && b.start <= nowMin && nowMin < b.start + b.dur);
          const nextBlk = planBlocks.find((b) => b.kind === "reel" && (nowMin == null || b.start > nowMin) && b.taskId !== nowBlk?.taskId);
          return (
            <button type="button" className="card pad hero plan-mini" onClick={() => togglePlan(true)} title="Open the full timeline">
              <div className="plan-mini-h">
                <span className="plan-mini-car" aria-hidden="true">›</span>
                <b>Today’s plan</b>
                <span className="prog">
                  {nowBlk ? <>Now: <b style={{ color: "#232D42" }}>{nowBlk.label}</b></> : "Nothing running"}
                  {nextBlk && <> · next: {nextBlk.label} at {clockOf(nextBlk.start)}</>}
                  {" · "}{fmtDur(plannedMin)} planned · {fmtDur(Math.max(0, availMin - BUFFER_MIN - plannedMin))} free
                  {atRisk.length > 0 && <span style={{ marginLeft: 6, color: "#C0201F", fontWeight: 500 }}>· {atRisk.length} due by tomorrow won&apos;t fit</span>}
                </span>
                <span className="plan-mini-open">Open plan</span>
              </div>
              <div className="plan-bar">
                {doneBlocks.map((b) => <i key={`d${b.id}${b.start}`} className="pb-done" style={{ left: `${(b.start / DAY_MINS) * 100}%`, width: `${(b.dur / DAY_MINS) * 100}%` }} />)}
                {planBlocks.map((b, i) => <i key={i} className={`pb-${b.kind}${b.high ? " high" : ""}`} style={{ left: `${(b.start / DAY_MINS) * 100}%`, width: `${(b.dur / DAY_MINS) * 100}%` }} />)}
                {showNow && <i className="pb-now" style={{ left: `${(nowMin! / DAY_MINS) * 100}%` }} />}
              </div>
              <div className="plan-mini-ticks"><span>9 AM</span><span>1 PM</span><span>6 PM</span></div>
            </button>
          );
        })() : (
        <div className="card pad hero">
          <div className="hero-head">
            <div style={{ display: "flex", alignItems: "baseline", gap: ".7rem", flexWrap: "wrap" }}>
              <button type="button" className="plan-fold" onClick={() => togglePlan(false)} title="Fold back to the progress bar"><span className="plan-mini-car open" aria-hidden="true">›</span><h2>Today’s plan</h2></button>
              <span className="prog">{planStart > shiftStart && <>Started {clockOf(planStart)} · </>}<b style={{ color: "#232D42" }}>{fmtDur(plannedMin)}</b> planned · 1h lunch · 1h buffer for urgent work · {fmtDur(Math.max(0, availMin - BUFFER_MIN - plannedMin))} free
                {atRisk.length > 0
                  ? <span style={{ marginLeft: 8, color: "#C0201F", fontWeight: 500, whiteSpace: "nowrap" }}>· {IWARN} {atRisk.length} due by tomorrow won&apos;t fit</span>
                  : spillPlan.length > 0 && <span style={{ marginLeft: 8, whiteSpace: "nowrap" }}>· {spillPlan.length} more planned{nextDue ? ` · next due ${new Date(nextDue + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}` : ""}</span>}
              </span>
              <span className="qmark" title="8-hour workday (9 AM–6 PM) with a protected 1-hour lunch. Tasks are ordered by publishing date, earliest first; work due later is pulled forward whenever there's room. The last hour is kept free for urgent work — Urgent/High tasks jump to the front and may use it. Drag a task along the timeline to move it earlier or later in the order; use ‹ › to nudge it one place. Anything overdue or high priority asks for a reason before it slips later.">?</span>
            </div>
            <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
              {/* Back to the order the day would have had on its own — the way out of
                  a rearrangement someone no longer wants. */}
              {myPlan.length > 1 && (
                <button type="button" onClick={rearrangePlan} title="Overdue first, then high priority, then by publishing date"
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white text-[11.5px] font-medium text-[#4A5468] px-2.5 py-1 hover:border-brand hover:text-brand">
                  <IconArrowsSort size={13} /> Rearrange
                </button>
              )}
              <div className="legend"><span><i className="dot" style={{ background: "#3A57E8" }} />Task</span><span><i className="dot" style={{ background: "#E11D48" }} />High priority</span><span><i className="dot" style={{ background: "#D9DEEA" }} />Break</span></div>
            </div>
          </div>
          <div className="tl-wrap">
            <div className="tl-ticks">{HOUR_TICKS.map((t, i) => <span key={i}>{t}</span>)}</div>
            <div
              className="tl-track"
              ref={trackRef}
              onDragOver={(e) => { e.preventDefault(); if (dragKey.current) setDropAt(edgeMinFromCursor(e.clientX)); }}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setDropAt(null); }}
              onDrop={(e) => { e.preventDefault(); dropPlanAt(edgeMinFromCursor(e.clientX)); }}
            >
              {/* Live drop guide — where the block's start edge will land while dragging. */}
              {dropAt !== null && (
                <div className="tl-guide" style={{ left: `${(dropAt / DAY_MINS) * 100}%` }}>
                  <span className="tl-guide-tag">{clockOf(dropAt)}</span>
                </div>
              )}
              {planBlocks.map((b) => {
                // The block kind is "reel" for every task; show the task's real type.
                const blkTask = [...tasks, ...claimedTasks].find((t) => t.id === b.taskId);
                const typeName = blkTask?.detail.typeLine || "Task";
                // Time added after the task was first planned, badged on the block — so a
                // day that grew says so, instead of just silently taking up more room.
                const log = blkTask?.detail.extensions || [];
                const addedMin = log.length ? Math.max(0, (blkTask!.detail.duration ?? 0) - log[0].fromMin) : 0;
                return (
                <div
                  key={`${b.kind}-${b.key || b.taskId || ""}-${b.start}`}
                  className={`tl-blk ${b.kind} ${b.high ? "high" : ""} ${b.samvaya ? "samvaya" : ""} ${b.kind === "reel" ? "clickable" : ""} ${addedMin > 0 ? "has-ext" : ""}`}
                  draggable={b.kind === "reel"}
                  onDragStart={b.kind === "reel" ? (e) => { dragKey.current = b.key!; grabDX.current = e.clientX - e.currentTarget.getBoundingClientRect().left; } : undefined}
                  onDragEnd={b.kind === "reel" ? () => { dragKey.current = null; setDropAt(null); } : undefined}
                  onClick={() => b.taskId && setPlanModalId(b.taskId)}
                  style={{ left: `${(b.start / DAY_MINS) * 100}%`, width: `${(b.dur / DAY_MINS) * 100}%` }}
                  title={b.kind === "reel" ? "Drag along the timeline to start it later · click to open" : b.kind === "lunch" ? "Protected lunch" : "Emergency buffer — only Urgent/High tasks are planned into this hour"}
                >
                  {b.kind === "reel" && addedMin > 0 && (
                    // A small badge on the right edge, not a band across the block: the
                    // band covered the task name, which is the one thing the block is
                    // there to tell you.
                    <span className="tl-ext" title={`${fmtMins(addedMin)} added after this was planned`}>
                      +{fmtMins(addedMin)}
                    </span>
                  )}
                  {b.kind === "reel" && (
                    <>
                      <button className="tl-nudge l" title="Move earlier" onClick={(e) => { e.stopPropagation(); movePlan(b.key!, -1); }}>‹</button>
                      <button className="tl-nudge r" title="Move later" onClick={(e) => { e.stopPropagation(); movePlan(b.key!, 1); }}>›</button>
                    </>
                  )}
                  <div className="tl-t">{b.samvaya && <span className="tl-tag">Samvaya</span>}{b.label}</div>
                  <div className="tl-m">{b.kind === "reel" ? `${b.samvaya ? "Samvaya · " : b.high ? "High priority · " : ""}${b.samvaya ? "" : `${typeName} · `}${fmtDur(b.dur)}` : b.kind === "lunch" ? "1h · protected" : `Kept free for urgent work`}</div>
                </div>
                );
              })}
              {doneBlocks.map((b) => (
                <div key={`done-${b.id}-${b.start}`} className="tl-blk done" onClick={() => setPlanModalId(b.id)}
                  style={{ left: `${(b.start / DAY_MINS) * 100}%`, width: `${(b.dur / DAY_MINS) * 100}%` }}
                  title={`Done · ${b.title} · ${b.from != null ? `${clockOf(b.from)} – ` : "finished "}${clockOf(b.to)} · click to open`}>
                  <div className="tl-t">{b.title}</div>
                  <div className="tl-m">Done</div>
                </div>
              ))}
              {showNow && <div className="now-line" style={{ left: `${(nowMin! / DAY_MINS) * 100}%` }}><span className="now-dot" /><span className="now-tag">● now</span></div>}
            </div>
          </div>
        </div>
        )}

        {/* 3 · WORK ROW — My tasks | Up next detail (wider now) */}
        <div className="work">
          <div className="card pad">
            <div className="colhead"><h3>My tasks</h3>{canCreate ? <button className={`btn sm ${composing ? "" : "primary"}`} onClick={openComposer} disabled={composing} title={composing ? "The form is already open on the right" : "Create a content task"}>+ New task</button> : null}</div>
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem", margin: "-.2rem 0 .6rem" }}>
              <span className="lbl" style={{ whiteSpace: "nowrap" }}>Sort by</span>
              <PreviewSelect className="flex-1" value={sortBy} onChange={(v) => { pickSort(v as TaskSort); setSel(null); }}
                options={(Object.keys(TASK_SORTS) as TaskSort[]).map((k) => ({ value: k, label: TASK_SORTS[k] }))} />
            </div>
            {/* One tidy View picker instead of a row of pills (Praveen, 22 Oct): the
                status views, your own saved views, and "+ New view…". */}
            <ViewPicker
              current={taskTab}
              statusViews={tabCounts.map((tb) => ({ key: tb.key, label: tb.label, n: tb.n }))}
              myViews={myViews.map((v) => ({ key: `view:${v.id}`, label: v.name, n: workingTasks.filter((t) => inMyView(t, v, todayStr)).length, id: v.id }))}
              typeOptions={Array.from(new Set(workingTasks.map((t) => t.detail.typeLine).filter(Boolean))).sort()}
              statusOptions={Array.from(new Set(tabCounts.flatMap((tb) => tb.statuses)))}
              onPick={(k) => { setTaskTab(k); setSel(null); setPeekId(null); }}
              onSave={(v) => { const id = String(Date.now()); saveMyViews([...myViews, { ...v, id }]); setTaskTab(`view:${id}`); }}
              onDelete={(id) => { saveMyViews(myViews.filter((v) => v.id !== id)); if (taskTab === `view:${id}`) setTaskTab(myTabs[0].key); }}
            />
            {switchedTo && (
              <div className="fx-switched">
                Switched to <b>{switchedTo.label}</b> — your started task is here.{" "}
                <button type="button" onClick={() => { setTaskTab(switchedTo.from); setSel(null); setSwitchedTo(null); }}>Back to {myTabs.find((tb) => tb.key === switchedTo.from)?.label || "the last view"}</button>
              </div>
            )}
            <div className="tasklist fx-pane" key={`list-${taskTab}`}>
              {receipt && (
                <div className="fx-receipt">
                  <IconCircleCheck size={16} stroke={1.8} />
                  <span><b>{receipt.title}</b> sent to Output ready</span>
                  <span className="fx-receipt-acts">
                    <button type="button" onClick={() => { const r = receipt; setReceipt(null); setUpNext(null); setTaskStatus(r.id, r.prev, true); setOpenId(r.id); }}>Undo</button>
                    <button type="button" onClick={() => { const r = receipt; setReceipt(null); setUpNext(null); const out = myTabs.find((tb) => tb.statuses.includes("Output - Ready")); if (out) setTaskTab(out.key); setOpenId(r.id); }}>View</button>
                  </span>
                </div>
              )}
              {shownTasks.length === 0 && claimableHere.length === 0 && (
                <div className="empty" style={{ padding: "1.6rem 0" }}>
                  {isEditor && curTab.key === "approved" && videoInHand.length > 0
                    ? <>Nothing up for grabs — {videoInHand.map(([who, n]) => `${who} is working on ${n === 1 ? "1 video" : `${n} videos`}`).join(", ")}.</>
                    : <>Nothing in “{curTab.label}” right now ✓</>}
                </div>
              )}
              {/* One list, one order: my tasks and claimable videos sorted together. */}
              {[...shownTasks.map((t) => ({ t, claim: false })), ...claimableHere.map((t) => ({ t, claim: true }))]
                .sort((x, y) => cmpTasks(x.t, y.t))
                .flatMap((x, idx, arr) => [...groupHead(x.t, idx ? arr[idx - 1].t : null), (({ t: rowTask, claim }: { t: Task; claim: boolean }) => !claim ? ((t: Task, i: number) => {
                const claimed = claimedTasks.some((c) => c.id === t.id);
                const st = STATUS[t.status];
                const di = dueInfo(t.due, todayStr);
                return (
                  <div key={t.id} className={`task ${task && t.id === task.id ? "sel" : ""} ${moveFx?.id === t.id ? `fx-${moveFx.kind} fx-${moveFx.phase}` : ""} ${upNext?.id === t.id ? "fx-now" : ""} ${claimed ? "just-claimed" : ""} ${di.overdue ? "overdue" : di.today ? "duetoday" : di.tomorrow ? "duetomorrow" : ""} ${isHot(t.detail.priority) ? "high" : ""}`} onClick={async () => { if (!(await leaveComposer())) return; setSel(i); setPeekId(null); }}>
                    {/* Two columns: the task on the left, its dates and state stacked on
                        the right. The status pill used to sit after the meta text, so it
                        landed at a different spot on every row — now due and status line
                        up in one straight right-hand column down the whole list. */}
                    {moveFx?.id === t.id && moveFx.phase !== "landed" && (
                      <span className="fx-badge">{moveFx.kind === "start" ? "Moving to In progress" : "Moving to Output ready"}</span>
                    )}
                    <div className="task-row">
                      <div className="task-main">
                        <div className="tt">{t.title}</div>
                      </div>
                      <div className="task-side">
                        <DueChip due={t.due} today={todayStr} />
                        {/* The View picker already says the status; only "In progress" earns a pill. */}
                        {upNext?.id === t.id && <span className="pill xs fx-now-tag">Now open</span>}
                        {moveFx?.id === t.id && moveFx.kind === "start" && moveFx.phase === "lift"
                          ? <span className="pill xs fx-pop" style={{ background: TONE.info.bg, color: TONE.info.fg }}>In Progress</span>
                          : moveFx?.id === t.id && moveFx.kind === "output"
                            ? <span className="pill xs fx-pop" style={{ background: "var(--good-soft)", color: "var(--good)" }}>Output ready</span>
                            : t.status === "Output - In Progress" && <span className="pill xs" style={{ background: TONE[st.tone].bg, color: TONE[st.tone].fg }}>{st.label}</span>}
                        {isHot(t.detail.priority) && <span className="pill xs" style={{ background: PRIO[t.detail.priority].bg, color: PRIO[t.detail.priority].fg, display: "inline-flex", alignItems: "center", gap: 3 }}><IconBolt size={11} stroke={1.9} /> {t.detail.priority}</span>}
                        {claimed && <span className="pill xs" style={{ background: "#E9ECFB", color: "#2138B0" }}>Claimed by you</span>}
                      </div>
                    </div>
                    {/* Type and brand chips run the full card width, under the date too,
                        so the brand isn't squeezed into the title column (Praveen, 23 Oct). */}
                    <div className="mm">{t.detail.typeLine ? <span className="type-chip">{t.detail.typeLine}</span> : t.meta}{t.detail.brand && <span className="sbu-chip">{t.detail.brand}</span>}</div>
                    {moveFx?.id === t.id && moveFx.kind === "start" && moveFx.phase === "landed" && (
                      <div className="fx-moved"><IconArrowRight size={13} stroke={2} /> Moved to In progress · timer running</div>
                    )}
                  </div>
                );
              })(rowTask, shownTasks.indexOf(rowTask)) : ((v: Task) => {
                // Claimable videos (spec §8) — inline in BOTH editors' Content-Approved
                // tab; first to claim owns it. Nikhil also picks how he'll work it.
                const confirming = claimConfirm === v.id;
                return (
                  <div key={`pool-${v.id}`} className={`task ${peekId === v.id ? "sel" : ""}`} onClick={async () => { if (!(await leaveComposer())) return; setPeekId(v.id); }} title="Open to see the task"
                    style={{ borderStyle: "dashed", borderColor: peekId === v.id ? undefined : "#B9C0D0", display: "flex", justifyContent: "space-between", gap: ".8rem", cursor: "pointer" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="tt">{v.title}</div>
                      <div className="mm">
                        {v.detail.typeLine} · {v.detail.presenter && PPL[v.detail.presenter]
                          ? <><b>{PPL[v.detail.presenter].name} is presenting</b> — needs an editor</>
                          : `up for grabs — ${keysWithRole("editor").map((k) => PPL[k]?.name || k).join(" or ")}`}
                      </div>
                      {!confirming ? (
                        <span className="pill" style={{ background: "#E3F5EA", color: "#157F3C", display: "inline-block", marginTop: ".45rem" }}>Claimable</span>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: ".4rem", marginTop: ".45rem" }} onClick={(e) => e.stopPropagation()}>
                          <span className="lbl">How will you work it?</span>
                          <div style={{ display: "flex", gap: ".35rem", flexWrap: "wrap" }}>
                            {/* Present ≠ claim: the editor owns it, the presenter collaborates. */}
                            <button className="btn sm" onClick={() => confirmClaim(v, "present")} title="You'll shoot it — an editor still claims it">Present on camera</button>
                            <button className="btn primary sm" onClick={() => confirmClaim(v, "edit")} title="You'll cut it — you become the owner">Edit video</button>
                            <button className="btn primary sm" onClick={() => confirmClaim(v, "both")} title="You'll shoot and cut it — you become the owner">Both</button>
                            <button className="btn sm" onClick={() => setClaimConfirm(null)}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Due + Claim stacked on the RIGHT so the action is clear (user request). */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: ".55rem", flexShrink: 0 }}>
                      <DueChip due={v.due} today={todayStr} />
                      {!confirming && <button className="btn primary sm" onClick={(e) => { e.stopPropagation(); setClaimConfirm(v.id); }}>Claim</button>}
                    </div>
                  </div>
                );
              })(rowTask))(x)])}
            </div>
          </div>

          {/* The right-hand panel has three states, in priority order: the create form
              (opened from either "New task" button), a task you opened, or — at rest —
              an empty panel offering a new task. It is no longer a centred modal. */}
          <div className="card pad detail">
            {composing ? (
              <NewTaskForm writer={person} onClose={() => { void leaveComposer(); }} onCreate={createFromDraft} onDirty={setComposerDirty} />
            ) : (() => { const peek = peekId ? claimableHere.find((v) => v.id === peekId) : null; return peek ? (
              <>
                <div className="nt-assign" style={{ marginBottom: ".8rem", justifyContent: "space-between" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: ".5rem" }}><span className="status-dot" style={{ background: "#1AA053" }} />Up for grabs — not yours yet. Claim it to start working on it.</span>
                  {claimConfirm !== peek.id && <button className="btn primary sm" onClick={() => setClaimConfirm(peek.id)}>Claim</button>}
                </div>
                <TaskBody key={`peek-${peek.id}`} task={peek} label="Up for grabs · preview" uploadedBy={person} onSaved={load} />
              </>
            ) : null; })() || (task ? (
              <>
              {startNote === task.id && (
                <div className="fx-note">
                  <IconCircleCheck size={17} stroke={1.8} />
                  <span><b>Timer started.</b> Content - Approved <IconArrowRight size={13} stroke={2} style={{ display: "inline", verticalAlign: "-2px" }} /> <b>In progress</b> · showing your In progress list.</span>
                  <button type="button" className="fx-x" title="Close" onClick={() => setStartNote(null)}><IconX size={14} stroke={2} /></button>
                </div>
              )}
              {upNext?.id === task.id && (
                <div className="fx-note">
                  <IconArrowRight size={17} stroke={1.8} />
                  <span><b>Up next</b> · “{upNext.fromTitle}” went to Output ready. This is your next task.</span>
                  <button type="button" className="fx-x" title="Close" onClick={() => setUpNext(null)}><IconX size={14} stroke={2} /></button>
                </div>
              )}
              <div className={upNext?.id === task.id ? "fx-pane" : undefined} key={`body-${task.id}`}>
              <TaskBody key={`task-${task.id}`} task={task} label="Task · opened" onStatusChange={(s) => moveTask(task, s)} onSetDuration={(m, why, undoOf) => setDuration(task.id, m, why, undoOf)} canSchedule={isAdmin} uploadedBy={person} onSaved={load} timing={taskTiming(task)} canEdit={canEditTasks} canDelete={canDeleteTasks} canAssign={canAssignTasks} onDeleted={() => { setSel(null); load(); }} />
              </div>
              </>
            ) : (
              // One entry point only: "+ New task" sits in the My tasks header, so the
              // resting panel stays empty rather than repeating the same button.
              <div className="panel-rest">
                <div className="panel-rest-title">Nothing open</div>
                <div className="panel-rest-sub">Pick a task on the left to open it here{canCreate ? ", or start a new one with + New task." : "."}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Completed by me (22 Oct) — replaced "Tasks I created". Only this person's own
            finished work (owner, collaborator or on camera), so Praveen sees his designs and Nandu his
            videos — never each other's. Open one to see it read-only. */}
        {(() => {
          // `createdRows` comes from /api/my-day/created, which is already scoped to this
          // person and the chosen window — no client-side date maths, so the counts can
          // never disagree with the range label above them.
          // Type / SBU narrow the window's rows BEFORE the tab counts are taken, so the
          // counts always describe what the list is actually showing.
          const mineCreated = createdRows.filter((t) =>
            (createdType === "all" || t.detail.typeLine === createdType) &&
            (createdSbu === "all" || t.detail.brand === createdSbu));
          const narrowed = createdType !== "all" || createdSbu !== "all";
          const isPub = (t: Task) => t.status === "Published/Scheduled";
          const list = mineCreated.filter((t) => createdFilter === "all" || (createdFilter === "published" ? isPub(t) : !isPub(t)));
          const finishedOn = (t: Task) => (t.detail.endAt ? new Date(t.detail.endAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) : t.detail.publishes);
          const counts = { open: mineCreated.filter((t) => !isPub(t)).length, published: mineCreated.filter(isPub).length, all: mineCreated.length };
          return (
            <div className="card pad" style={{ marginTop: "1rem" }}>
              <div className="colhead created-head">
                <h3>Completed by me</h3>
                <div className="task-tabs" style={{ marginBottom: 0 }}>
                  {(["open", "published", "all"] as const).map((f) => (
                    <button key={f} className={`task-tab ${createdFilter === f ? "on" : ""}`} onClick={() => setCreatedFilter(f)}>
                      {f === "open" ? "Ready" : f === "published" ? "Published" : "All"}<span className="task-tab-n">{counts[f]}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Filters on their own line — three dropdowns and the tabs crammed into
                  the heading row left nothing room to breathe. */}
              <div className="created-filters">
                {/* The window the counts are measured over. It used to be a fixed,
                    invisible 60 days, so "All 76" read like a lifetime total. */}
                <label className="created-f">
                  <span className="created-f-lbl">When</span>
                  <PreviewSelect className="created-range" value={createdRange} onChange={(v) => setCreatedRange(v as CreatedRange)}
                    options={CREATED_RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
                </label>
                {createdRange === "custom" && (
                  <label className="created-f created-custom">
                    <span className="created-f-lbl">Last</span>
                    <input className="nt-input created-amt" type="number" min={1} max={CUSTOM_UNIT_MAX[createdUnit]}
                      value={createdAmtText} onChange={(e) => setCreatedAmtText(e.target.value)}
                      aria-label={`How many ${createdUnit}`} />
                    <PreviewSelect className="created-unit" value={createdUnit} onChange={(v) => setCreatedUnit(v as "hours" | "days")}
                      options={[{ value: "hours", label: "hours" }, { value: "days", label: "days" }]} />
                  </label>
                )}
                {createdRange === "dates" && (<>
                  <label className="created-f">
                    <span className="created-f-lbl">From</span>
                    <PreviewDatePicker value={createdFrom} max={createdTo || undefined} allowClear={false}
                      onChange={(v) => { setCreatedFrom(v); if (createdTo && v > createdTo) setCreatedTo(v); }} />
                  </label>
                  <label className="created-f">
                    <span className="created-f-lbl">To</span>
                    <PreviewDatePicker value={createdTo} min={createdFrom || undefined} allowClear={false} onChange={setCreatedTo} />
                  </label>
                </>)}
                <label className="created-f">
                  <span className="created-f-lbl">Type</span>
                  <PreviewSelect className="created-type" value={createdType} onChange={setCreatedType}
                    options={[{ value: "all", label: "All types" }, ...CC_TYPES.map((t) => ({ value: t, label: t }))]} />
                </label>
                <label className="created-f">
                  <span className="created-f-lbl">SBU</span>
                  <PreviewSelect className="created-sbu" value={createdSbu} onChange={setCreatedSbu}
                    options={[{ value: "all", label: "All SBUs" }, ...sbus.map((s) => ({ value: s, label: s }))]} />
                </label>
                {narrowed && (
                  <button type="button" className="btn sm created-clear" onClick={() => { setCreatedType("all"); setCreatedSbu("all"); }}>Clear filters</button>
                )}
              </div>
              {createdCapped && (
                <div className="created-cap">Showing the 500 most recent — narrow the range to see the rest.</div>
              )}
              {createdBusy && list.length === 0 ? <div className="empty">Loading…</div>
                : list.length === 0 ? <div className="empty">{narrowed
                    ? "Nothing matches these filters — try widening the type, SBU or range."
                    : <>Nothing finished {CREATED_RANGE_OPTIONS.find((o) => o.value === createdRange)?.empty || "in this period"}.</>}</div> : (
                // A table (Praveen, 22 Oct): one column each, so status and the post link
                // line up instead of trailing the title. Click a row to open it below.
                <div className="done-tbl">
                  <div className="done-tr done-th">
                    <span>Task</span><span>Type</span><span>SBU</span><span>Status</span><span>Finished</span><span>Post</span>
                  </div>
                  {list.map((t) => {
                    const role = t.detail.ownerKey && t.detail.ownerKey !== person ? `${t.detail.presenter === person ? "On camera" : "Collaborator"} · owner ${t.detail.owner}` : "";
                    return (
                      <div key={t.id} className={`done-row${openCreatedId === t.id ? " on" : ""}`}>
                        <div className="done-tr" onClick={() => setOpenCreatedId(openCreatedId === t.id ? null : t.id)}>
                          <span className="done-title"><b>{t.title}</b>{role && <i>{role}</i>}</span>
                          <span>{t.detail.typeLine}</span>
                          <span>{t.detail.brand}</span>
                          <span><em className={`done-st ${isPub(t) ? "pub" : "ready"}`}>{isPub(t) ? "Published" : "Ready"}</em></span>
                          <span className="done-date">{finishedOn(t)}</span>
                          <span>{t.detail.liveUrl ? <a href={t.detail.liveUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>View post ↗</a> : <span className="done-none">—</span>}</span>
                        </div>
                        {openCreatedId === t.id && (
                          <div className="done-open" onClick={(e) => e.stopPropagation()}>
                            <TaskBody key={`trk-${t.id}`} task={t} label="Completed · read-only" uploadedBy={person} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* Nandu's Samvaya / other-platform tasks (spec §14) — a separate, clearly
            labelled section, only on Nandu's board, never mixed with GooCampus. */}
        {person === "nandu" && samvaya.length > 0 && (
          <div className="card pad" style={{ marginTop: "1rem" }}>
            <div className="colhead"><h3>Samvaya · other platforms</h3><span className="lbl">separate from GooCampus — only you see this</span></div>
            <div className="tasklist">
              {samvaya.map((t) => {
                const st = STATUS[t.status];
                return (
                  <div key={t.id} className="task">
                    <div className="task-top"><div className="tt">{t.title}</div><DueChip due={t.due} today={todayStr} /></div>
                    <div className="mm">{t.meta}</div>
                    <span className="pill" style={{ background: TONE[st.tone].bg, color: TONE[st.tone].fg }}>{st.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </>
        )}
        </>) : (
          <MemberHub person={person} tab={wsTab} />
        )}
      </div>

      {/* The chat column is for chats only (Praveen, 26–27 Oct). Notifications live
          under the bell / Notifications page. The one thing kept on screen is the task
          timer's "time is up — completed or extend?", which needs an answer while
          you work, so it floats in the corner instead. */}
      {notifs.some((n) => n.timeUp) && (
        <div style={{ position: "fixed", right: 24, bottom: 88, width: 340, zIndex: 70 }}>
          <NotificationStack notifs={notifs.filter((n) => n.timeUp)} onAccept={onAcceptNotif} onDismiss={dismissNotif}
            onClearAll={() => setNotifs((ns) => ns.filter((n) => !n.timeUp))} onTimeUp={onTimeUpChoice} />
        </div>
      )}

      {/* TEAM CHAT — collapsible slide-in panel */}
      <aside className={`chatpanel ${chatOpen ? "open" : ""}`}>
        {(() => {
          const active = activeChat ? convos[activeChat] : null;
          return (
            <>
              <div className="chat-head">
                {active ? (
                  <h3>
                    <button className="chat-back" onClick={() => { if (activeChat) markRead(activeChat); setActiveChat(null); }} title="All chats">‹</button>
                    <span className="av av-sm" style={{ background: active.group ? "var(--brand)" : active.color }}>{active.group ? IUSERS : active.av}</span>
                    {active.name}
                    {active.online && <span className="online">● online</span>}
                  </h3>
                ) : (
                  <h3>Chats</h3> /* no fake "N online" — no real presence source */
                )}
                <div className="chat-head-acts">
                  <button className={`pinbtn ${chatPinned ? "on" : ""}`} onClick={() => setChatPinned((p) => !p)} title={chatPinned ? "Unpin" : "Pin open"}>{chatPinned ? <><IconPin size={13} stroke={1.8} /> Pinned</> : "Pin"}</button>
                  <button className="closebtn" onClick={() => { setChatPinned(false); setChatOpen(false); closedManually.current = true; }} title="Close"><IconX size={14} stroke={2} /></button>
                </div>
              </div>

              {!active ? (
                /* CONVERSATION LIST */
                <div className="chat-list">
                  {Object.values(convos).map((c) => {
                    const last = c.msgs[c.msgs.length - 1];
                    return (
                      <button key={c.id} className="chat-list-row" onClick={() => openConvo(c.id)}>
                        {c.group ? <span className="av" style={{ background: "var(--brand)" }}>{IUSERS}</span> : <Avatar p={{ name: c.name, av: c.av || c.name.slice(0, 1), color: c.color || "#8A92A6" }} cls="av" />}
                        <div className="cl-mid">
                          <div className="cl-name">{c.name}{c.online && <span className="cl-dot" />}</div>
                          <div className="cl-last">{last ? (last.me ? "You: " : "") + last.body : "No messages yet"}</div>
                        </div>
                        <div className="cl-right">
                          <div className="cl-time">{last?.tm}</div>
                          {c.unread > 0 && <span className="cl-unread">{c.unread}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                /* THREAD */
                <>
                  <div className="chat-scroll thread">
                    <div className="chat-day">Today</div>
                    {active.msgs.length === 0 && <div className="empty">No messages yet — say hi</div>}
                    {active.msgs.map((m, i) => m.sys ? (
                      /* A pipeline event (handoff / claim / extension). It reads as a
                         message in a chat, so it looks like one: a left-side bubble,
                         tinted to mark it as the system talking rather than a person.
                         It used to be a centred grey pill, which nobody read as chat. */
                      <div key={i} className="bubble-row sys">
                        <div className="bubble sys">
                          <span className="bubble-body">{highlightMins(m.body)}</span>
                          <span className="bubble-tm">{m.tm}</span>
                        </div>
                      </div>
                    ) : (
                      <div key={i} className={`bubble-row ${m.me ? "me" : ""}`}>
                        {!m.me && active.group && <span className="av bubble-av" style={{ background: m.color }}>{m.av}</span>}
                        <div className="bubble">
                          {!m.me && active.group && <div className="bubble-who" style={{ color: m.color }}>{m.who}</div>}
                          <span className="bubble-body">{m.body}</span>
                          <span className="bubble-tm">{m.tm}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="chat-foot">
                    <div className="compose">
                      <input placeholder={`Message ${active.group ? "the team" : active.name}…`} value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
                      <button className="btn primary sm" onClick={send}>Send</button>
                    </div>
                  </div>
                </>
              )}
            </>
          );
        })()}
      </aside>

      {/* TODAY'S-PLAN POPUP — clicking a time-blocked plan item opens the full task */}
      {planModalTask && (
        <div className="modal" onClick={() => setPlanModalId(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setPlanModalId(null)} title="Close"><IconX size={14} stroke={2} /></button>
            <TaskBody key={`plan-${planModalTask.id}`} task={planModalTask} label="Today's plan · task" onStatusChange={(s) => setTaskStatus(planModalTask.id, s)} onSetDuration={(m, why, undoOf) => setDuration(planModalTask.id, m, why, undoOf)} canSchedule={isAdmin} uploadedBy={person} onSaved={load} timing={taskTiming(planModalTask)} canEdit={canEditTasks} canDelete={canDeleteTasks} canAssign={canAssignTasks} onDeleted={() => { setPlanModalId(null); load(); }} />
            <div className="modal-foot">
              <span className="modal-foot-note">Didn’t finish? Roll it to next week. Done? Mark it complete.</span>
              <div className="modal-foot-acts">
                <button
                  className="btn"
                  onClick={() => {
                    // Roll to next week: push the due date +7d (persists) — the task
                    // drops off today's plan when it leaves the working window.
                    const cur = planModalTask;
                    setPlanModalId(null);
                    if (!cur) return;
                    const base = cur.due ? new Date(cur.due) : new Date();
                    base.setDate(base.getDate() + 7);
                    const next = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
                    setPlan((p) => p.filter((x) => x.taskId !== cur.id)); // off today's timeline immediately
                    fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: cur.id, actor: person, fields: { due_date: next } }) })
                      .then(async (res) => {
                        if (!res.ok) { const j = await res.json().catch(() => ({})); setToast({ who: "Move failed", color: "#C03221", av: "!", body: j.error || `HTTP ${res.status}` }); }
                        else setToast({ who: "Moved", color: "#3A57E8", av: me.av, body: `“${cur.title}” rolled a week — now due ${next}.` });
                        load();
                      })
                      .catch((e) => { setToast({ who: "Move failed", color: "#C03221", av: "!", body: String(e) }); load(); });
                  }}
                >
                  Move to next week
                </button>
                <button
                  className="btn primary"
                  onClick={() => {
                    // Complete = the producer's output is done → Output - Ready
                    // (real status write; the task leaves the plan automatically).
                    const cur = planModalTask;
                    setPlanModalId(null);
                    if (cur) setTaskStatus(cur.id, "Output - Ready");
                  }}
                >
                  Mark complete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CREATE-TASK MODAL — writer only; runs the Type→owner routing on submit */}

      {/* CLAIM POOL modal — editors pick up video work; claiming moves it to My tasks */}
      {showClaimPool && (
        <div className="modal" onClick={() => setShowClaimPool(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowClaimPool(false)} title="Close"><IconX size={14} stroke={2} /></button>
            <div className="lbl" style={{ marginBottom: ".4rem" }}>Claim pool · video work up for grabs</div>
            <div className="d-title" style={{ marginBottom: "1rem" }}>Pick up a video</div>
            {claimPool.length ? (
              <div className="claim-list">
                {claimPool.map((v) => (
                  <div key={v.id} className="claim-card">
                    <div style={{ minWidth: 0 }}>
                      <div className="claim-title">{v.title}</div>
                      <div className="claim-meta">{v.detail.typeLine} · {v.detail.brand} · {STATUS[v.status].label}</div>
                    </div>
                    <button className="btn primary sm" onClick={() => { claimVideo(v); if (claimPool.length <= 1) setShowClaimPool(false); }}>Claim</button>
                  </div>
                ))}
              </div>
            ) : <div className="empty" style={{ padding: "2.4rem 0" }}>Nothing to claim right now ✓</div>}
            <div className="nt-assign" style={{ marginTop: "1rem" }}><span className="status-dot" style={{ background: "#8A92A6" }} /><span>Claim a video and it lands in your <b>My tasks</b> as <b>In progress</b> — you become the owner.</span></div>
          </div>
        </div>
      )}

      {/* MANYA'S REQUESTS — changes the producers asked for (date moves etc.) */}
      {pipeOpen && isWriter(person) && (
        <div className="modal" onClick={() => setPipeOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setPipeOpen(false)} title="Close"><IconX size={14} stroke={2} /></button>
            <div className="lbl" style={{ marginBottom: ".4rem" }}>Requests · from the team</div>
            <div className="d-title" style={{ marginBottom: "1rem" }}>Changes asked of you</div>
            {notifs.length ? (
              <div className="claim-list">
                {notifs.map((n) => (
                  <div key={n.id} className="claim-card" style={n.swap ? { flexDirection: "column", alignItems: "stretch" } : undefined}>
                    <div style={{ minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".6rem" }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="claim-title" style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                          {(() => { const I = notifIconFor(n.emoji); return <I size={14} stroke={1.9} className="text-brand flex-shrink-0" />; })()}{n.title}
                        </div>
                        <div className="claim-meta">{n.sub}</div>
                      </div>
                      <button className="btn sm" onClick={() => dismissNotif(n.id)}>Dismiss</button>
                    </div>
                    {/* SWAP REQUEST: the producer's not-started list — MANYA picks the one
                        to move; picking rolls it a day AND hands the pending task over. */}
                    {n.swap && n.postId && (
                      <div style={{ marginTop: ".6rem", display: "flex", flexDirection: "column", gap: ".4rem" }}>
                        {n.swap.candidates.map((c) => {
                          // Default = day after its due date, but NEVER in the past — overdue
                          // tasks (due < today) default to tomorrow. Manya can pick any date.
                          const tmr = new Date(); tmr.setHours(0, 0, 0, 0); tmr.setDate(tmr.getDate() + 1);
                          let roll = tmr;
                          if (c.due) { const r = new Date(c.due + "T00:00:00"); r.setDate(r.getDate() + 1); if (r > tmr) roll = r; }
                          const nextDefault = `${roll.getFullYear()}-${String(roll.getMonth() + 1).padStart(2, "0")}-${String(roll.getDate()).padStart(2, "0")}`;
                          return (
                            <SwapCandidateRow key={c.id} c={c} defaultDate={nextDefault} onMove={(date) => {
                              const label = (() => { try { return new Date(date + "T00:00:00").toLocaleDateString("en-US", { day: "numeric", month: "short" }); } catch { return date; } })();
                              dismissNotif(n.id);
                              fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, actor: person, fields: { due_date: date } }) })
                                .then(() => fetch("/api/marketing-hub/takeover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId: n.postId, newOwnerKey: n.swap!.from }) }))
                                .then(async (res) => {
                                  if (!res.ok) { const j = await res.json().catch(() => ({})); setToast({ who: "Swap failed", color: "#C03221", av: "!", body: j.error || `HTTP ${res.status}` }); }
                                  else setToast({ who: "Swapped", color: "#1AA053", av: me.av, body: `“${c.title}” moved to ${label} — the queued task is now on ${PPL[n.swap!.from]?.name || n.swap!.from}'s plan.` });
                                  load();
                                })
                                .catch((e) => { setToast({ who: "Swap failed", color: "#C03221", av: "!", body: String(e) }); load(); });
                            }} />
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : <div className="empty" style={{ padding: "2.4rem 0" }}>No requests right now ✓</div>}
            <div className="nt-assign" style={{ marginTop: "1rem" }}><span className="status-dot" style={{ background: "#3A57E8" }} /><span>When a producer moves a date or changes a task (e.g. to make room for a queued handoff), it lands here so you always know what shifted.</span></div>
          </div>
        </div>
      )}

      {/* APPROVALS — publish-date changes waiting for Maheen (her own portal) */}
      {approvalsOpen && viewerIsAdmin && (
        <div className="modal" onClick={() => setApprovalsOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setApprovalsOpen(false)} title="Close"><IconX size={14} stroke={2} /></button>
            <div className="lbl" style={{ marginBottom: ".4rem" }}>Approvals · publish-date changes</div>
            <div className="d-title" style={{ marginBottom: "1rem" }}>Waiting for your approval</div>
            {approvals.length ? (
              <div className="claim-list">
                {approvals.map((r) => (
                  <div key={r.postId} className="appr-card">
                    <div className="appr-head">
                      <a className="appr-title" href={`/dashboard/preview/marketing-hub?tab=master&open=${r.postId}`} title="Open this task">{r.title}</a>
                      {r.type && <span className="appr-type">{r.type}</span>}
                    </div>
                    <div className="appr-move"><IconCalendarEvent size={14} stroke={1.8} /> <b>{apprDate(r.from)}</b> <span className="arw">→</span> <b className="to">{apprDate(r.to)}</b></div>
                    <div className="appr-meta">
                      Assigned to <b>{nameCap(r.owner)}</b> · Requested by <b>{nameCap(r.requestedBy)}</b><br />
                      Created {apprDateTime(r.createdAt)}{r.creator ? <> by <b>{nameCap(r.creator)}</b></> : null}
                    </div>
                    <div className="appr-reason"><b>Reason:</b> {r.reason?.trim() ? r.reason : <span className="muted">not given</span>}</div>
                    <div className="appr-actions">
                      <button className="btn sm" disabled={!!approvalBusy} onClick={() => resolveApproval(r.postId, "reject")}>Reject</button>
                      <button className="btn primary sm" disabled={!!approvalBusy} onClick={() => resolveApproval(r.postId, "approve")}>Approve</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="empty" style={{ padding: "2.4rem 0" }}>Nothing to approve right now ✓</div>}
            <div className="nt-assign" style={{ marginTop: "1rem" }}><span className="status-dot" style={{ background: "#3A57E8" }} /><span>Only you can approve a publish-date change. Approve and the new date goes live on the task; reject and it stays put — either way the team is told.</span></div>
          </div>
        </div>
      )}

      {/* PIPELINE — tasks queued for me, waiting for MY accept (persistent history) */}
      {pipeOpen && !isWriter(person) && (
        <div className="modal" onClick={() => setPipeOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setPipeOpen(false)} title="Close"><IconX size={14} stroke={2} /></button>
            <div className="lbl" style={{ marginBottom: ".4rem" }}>Pipeline · queued for you</div>
            <div className="d-title" style={{ marginBottom: "1rem" }}>Waiting for your accept</div>
            {pipelineTasks.length ? (
              <div className="claim-list">
                {pipelineTasks.map((v) => (
                  <div key={v.id} className="claim-card">
                    <div style={{ minWidth: 0 }}>
                      <div className="claim-title">{v.title}</div>
                      <div className="claim-meta">{v.detail.typeLine} · {v.detail.brand} · ~{fmtMins(v.detail.duration || estMins(v.detail.typeLine))}{v.due ? ` · due ${v.due}` : ""}</div>
                    </div>
                    <button className="btn primary sm" onClick={() => { setPipeOpen(false); setAcceptTask(v); }}>Open</button>
                  </div>
                ))}
              </div>
            ) : <div className="empty" style={{ padding: "2.4rem 0" }}>Nothing queued for you ✓</div>}
            <div className="nt-assign" style={{ marginTop: "1rem" }}><span className="status-dot" style={{ background: "#D97706" }} /><span>Tasks land here when your 8h day is already full. They join your board <b>only when you accept</b> — fits your day → Accept &amp; work; packed → move a not-started task first.</span></div>
          </div>
        </div>
      )}

      {/* APPROVE GATE — the target's day, live, BEFORE Manya approves design work */}
      {approveGate && (() => {
        const g = approveGate;
        const tName = PPL[g.target]?.name || g.target;
        const day = dayFor(tName);
        const fits = g.add <= day.free;   // does it fit in the time still left today?
        const pending = [...tasks, ...claimedTasks].find((t) => t.id === g.id);
        const moveCand = (cid: string, due: string | undefined, next: string) => {
          fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: cid, actor: person, fields: { due_date: next } }) })
            .then(async (res) => {
              if (!res.ok) { const j = await res.json().catch(() => ({})); setToast({ who: "Move failed", color: "#C03221", av: "!", body: j.error || `HTTP ${res.status}` }); }
              else setToast({ who: "Moved", color: "#1AA053", av: me.av, body: `Rescheduled to ${next} — ${tName}'s day just freed up.` });
              load(); // popup stays open; the timeline + numbers refresh from server truth
            })
            .catch((e) => { setToast({ who: "Move failed", color: "#C03221", av: "!", body: String(e) }); load(); });
        };
        const plus1 = (due?: string) => {
          const base = due ? new Date(due) : new Date();
          base.setDate(base.getDate() + 1);
          return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
        };
        return (
          <div className="modal" onClick={() => setApproveGate(null)}>
            <div className="modal-card" style={{ maxWidth: 900, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setApproveGate(null)} title="Close"><IconX size={14} stroke={2} /></button>
              <div className="lbl" style={{ marginBottom: ".4rem" }}>Approve &amp; hand over</div>
              <div className="d-title" style={{ marginBottom: ".8rem" }}>“{pending?.title || "Task"}” → {tName}</div>

              {/* THE DAY, VISUALLY: his real timeline with the live now-line */}
              <div className="lbl" style={{ marginBottom: ".3rem" }}>{tName}&rsquo;s day right now{clock ? ` (${clock.time})` : ""}</div>
              <div className="tl-ticks" style={{ marginBottom: ".2rem" }}>{HOUR_TICKS.map((t, i) => <span key={i}>{t}</span>)}</div>
              <div className="ag-track">
                {day.blocks.map((b, i) => (
                  <div key={i} className={`tcp-blk ${b.kind === "task" ? (b.id === day.current?.id ? "reel now" : "design") : b.kind}`}
                    style={{ position: "absolute", top: 0, bottom: 0, left: `${(b.start / DAY_MINS) * 100}%`, width: `${(b.dur / DAY_MINS) * 100}%` }} title={b.label}>
                    {b.label}{b.id === day.current?.id && <div className="tcp-bm">now</div>}
                  </div>
                ))}
                {nowMin !== null && nowMin >= 0 && nowMin <= DAY_MINS && <div className="tcp-now-line" style={{ left: `${(day.now / DAY_MINS) * 100}%` }}><span className="now-tag">● now</span></div>}
              </div>
              <div className="nt-assign" style={{ margin: ".6rem 0 1rem" }}>
                <span className="status-dot" style={{ background: fits ? "#1AA053" : "#D97706" }} />
                <span>
                  <b>{fmtMins(day.committed)}</b> committed · <b>{fmtMins(Math.max(0, day.free))}</b> free
                  {day.current ? <> · now: <b>{day.current.label}</b> (~{fmtMins(day.current.endsIn)} left)</> : <> · not on a task right now</>}
                  {" — "}this adds <b>{fmtMins(g.add)}</b>{fits ? ". It fits." : <b style={{ color: "#C03221" }}>. He&rsquo;s not free for a while.</b>}
                </span>
              </div>

              {!fits && (
                <>
                  <div className="lbl" style={{ marginBottom: ".3rem" }}>Move one of his NOT-started tasks (the one he&rsquo;s on is locked)</div>
                  <div className="claim-list" style={{ marginBottom: "1rem" }}>
                    {day.candidates.length ? day.candidates.map((c) => (
                      <div key={c.id} className="claim-card move-row">
                        <div className="move-main">
                          <div className="claim-title">{c.label}</div>
                          <div className="claim-meta">{fmtMins(c.dur)}{c.due ? ` · due ${c.due}` : ""}</div>
                        </div>
                        <div className="move-act">
                          <button className="btn primary sm" onClick={() => moveCand(c.id, c.due, plus1(c.due))}>Move → next day</button>
                          <input type="date" className="nt-input" onChange={(e) => { if (e.target.value) moveCand(c.id, c.due, e.target.value); }} title="Pick a date" />
                        </div>
                      </div>
                    )) : <div className="empty" style={{ padding: "1rem 0" }}>Everything he has left is in progress — nothing can move.</div>}
                  </div>
                </>
              )}

              <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button className="btn" onClick={() => setApproveGate(null)}>Cancel</button>
                {fits ? (
                  <button className="btn primary" onClick={() => { setApproveGate(null); doSetTaskStatus(g.id, g.status); }}>Approve &amp; hand over</button>
                ) : (
                  <button className="btn primary" style={{ background: "#D97706", borderColor: "#D97706" }} onClick={() => { setApproveGate(null); doSetTaskStatus(g.id, g.status, true); }}>Send anyway → his pipeline</button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* COMPLETENESS GATE — required fields missing (approve / output-ready / publish).
          Shared with the Master sheet, Content Review, Content Studio and the Scheduler. */}
      {gateBlock && <MissingFieldsModal {...gateBlock} onClose={() => setGateBlock(null)} />}

      {/* ASSIGN-SIDE CAPACITY WARNING — "X's day is already full" confirm */}
      {/* Asked right after a claim, when the writer left the thumbnail owner open.
          Two answers only, as agreed: the editor who just claimed the video, or
          Praveen. No "give it to the other editor". */}
      {thumbAsk && (
        <div className="modal">
          <div className="modal-card" style={{ maxWidth: 470 }} onClick={(e) => e.stopPropagation()}>
            <div className="lbl" style={{ marginBottom: ".4rem" }}>Also on this task</div>
            <div className="d-title" style={{ marginBottom: ".7rem" }}>This video has a {thumbAsk.type.toLowerCase()} too</div>
            <div className="nt-thumb-note" style={{ marginBottom: "1.1rem" }}>
              “{thumbAsk.videoTitle}” is yours now. Manya left it open who makes the {thumbAsk.type.toLowerCase()} — it goes into whoever&rsquo;s list you pick.
            </div>
            <div className="nt-thumb-who" style={{ marginBottom: "1.1rem" }}>
              <button type="button" className="nt-thumb-opt" onClick={() => void settleThumb(person)}>
                <span className="nt-thumb-opt-lbl">I&rsquo;ll make it</span>
                <span className="nt-thumb-opt-sub">It joins My tasks alongside the video.</span>
              </button>
              <button type="button" className="nt-thumb-opt" onClick={() => void settleThumb(firstWithRole("designer") || "praveen")}>
                <span className="nt-thumb-opt-lbl">{nameOfRole("designer", "The designer")} makes it</span>
                <span className="nt-thumb-opt-sub">It shows up in their task list straight away.</span>
              </button>
            </div>
            {/* No dismiss: the question has to be answered, otherwise the thumbnail is
                left owned by nobody and quietly never gets made. */}
          </div>
        </div>
      )}

      {assignWarn && (
        <div className="modal" onClick={() => setAssignWarn(null)}>
          <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setAssignWarn(null)} title="Close"><IconX size={14} stroke={2} /></button>
            <div className="lbl" style={{ marginBottom: ".4rem" }}>Capacity check</div>
            <div className="d-title" style={{ marginBottom: ".7rem" }}>{assignWarn.name}&rsquo;s day is already full</div>
            <div className="nt-assign" style={{ marginBottom: "1.1rem" }}>
              <span className="status-dot" style={{ background: "#D97706" }} />
              <span><b>{fmtDur(assignWarn.committed)}</b> of {assignWarn.name}&rsquo;s 8h is already committed. This task adds <b>{fmtDur(assignWarn.add)}</b> — it will likely slip past 6 PM or roll to tomorrow.</span>
            </div>
            <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setAssignWarn(null)}>Cancel</button>
              <button className="btn primary" onClick={() => { const go = assignWarn.proceed; setAssignWarn(null); go(); }}>{assignWarn.cta || "Assign anyway"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ACCEPT & WORK — capacity-aware accept dialog */}
      {acceptTask && <AcceptWorkModal task={acceptTask} committed={workMin} onAcceptWork={acceptWork} onAskManya={askManyaToMove} onClose={() => setAcceptTask(null)} />}
      {askManya && <AskManyaModal onSend={sendToManya} onClose={() => setAskManya(false)} />}

      {/* END TODAY — wrap-up checklist */}
      {showEod && <EndTodayModal tasks={eodTasks} today={todayStr} isWriter={(me.role || "").toLowerCase().includes("writer")} onEnd={endToday} onClose={() => setShowEod(false)} />}


    </div>
  );
}

// Copy a link to the task (Praveen, 26 Oct): paste it to a teammate — "the attachment
// is missing here" — instead of sending a screenshot. Same link as the task window's
// Copy link: it opens the task in the Master sheet.
function CopyTaskLink({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    const href = `${window.location.origin}/dashboard/preview/marketing-hub?tab=master&open=${id}`;
    try { await navigator.clipboard.writeText(href); } catch {
      const t = document.createElement("textarea"); t.value = href; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch { /* copied by hand */ } document.body.removeChild(t);
    }
    setDone(true); setTimeout(() => setDone(false), 2000);
  };
  return (
    <button type="button" className={`btn sm hist-btn ${done ? "on" : ""}`} onClick={copy} title="Copy a link to this task — paste it in WhatsApp or Slack">
      {done ? <IconCheck size={14} stroke={2} /> : <IconLink size={14} stroke={1.8} />} {done ? "Copied" : "Copy task link"}
    </button>
  );
}
