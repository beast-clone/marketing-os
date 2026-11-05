"use client";
import { pageInfo } from "@/lib/publish-pages";
import { usePublishPages } from "@/lib/use-publish-pages";
import { LoadingBlock } from "@/components/LoadingBlock";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { fmtDateShort, fmtDateTime } from "@/lib/date";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { LiveIndicator } from "@/components/LiveIndicator";
import { CreativeThumb } from "@/components/CreativeThumb";
import { AutoTextarea } from "@/components/AutoTextarea";
import { IconChevronRight, IconChevronLeft, IconChevronDown, IconCheck, IconCalendarEvent, IconClock, IconPlus, IconBrandMeta, IconBrandLinkedin, IconFileTypePdf, IconPhoto, IconHeart, IconMessageCircle, IconSend, IconBookmark, IconThumbUp, IconShare3, IconRepeat, IconWorld, IconAlertTriangle, IconDeviceMobile, IconDeviceTablet, IconPaperclip, IconMovie, IconFileText, IconSparkles, IconLock, IconPencil, IconTarget, IconBolt, IconWand, IconTrendingUp, IconChartBar, IconBulb, IconCircleCheck, IconArrowBackUp, IconBrandFacebook, IconTrash, IconSearch, IconLayoutSidebarRight, IconLink, IconX } from "@tabler/icons-react";
import { showToast } from "../Toast";
import { LinkedInQueue } from "./LinkedInScheduler";
import { PdfThumb, pdfPageCount } from "@/components/PdfThumb";
import { ReelThumbnail } from "./ReelThumbnail";
import { CollaboratorPicker } from "./CollaboratorPicker";
import { CopyrightCheck } from "./CopyrightCheck";
import { useSbus } from "@/lib/use-sbus";
import type { FacebookBaseline } from "@/lib/scheduler-helpers";
import { Overlay } from "@/app/(dashboard)/dashboard/preview/Overlay";
import { DICTATE_HOTKEY, MicButton, useVoiceInput } from "@/components/VoiceInput";
import { PreviewDatePicker, ymdStr } from "../PreviewDatePicker";
import MissingFieldsModal, { gateFromResponse, type GateBlock } from "../MissingFieldsModal";
import { alertDialog, confirmDialog, promptDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";
import { compressImage } from "@/lib/compress-image";
import { SoundVideo } from "@/components/SoundVideo";
import { pastedName } from "@/components/FilesCard";
import { uploadSchedulerMedia } from "@/lib/upload-task-file";
import { nextPublisherCheck, clockText, durationText, SEND_AHEAD_MIN } from "@/lib/publisher-clock";
import { SETTINGS } from "@/lib/app-settings";
import { useAppSettings } from "@/lib/use-app-settings";

type PublishTo = "Facebook" | "Instagram" | "Instagram/Facebook";
// A page value from lib/publish-pages.ts — the three GooCampus pages or a linked brand.
type PublishToPage = string;

type ScheduledPost = {
  id: string;
  particulars: string;
  publishToPage: string;
  primaryInterest: string;
  platform: string;
  type: string;
  caption: string;
  fullCaption: string;
  igCaption: string;
  fbCaption: string;
  thumbnailUrl: string | null;
  mediaUrls: string[];
  scheduleTime: string | null;
  status: string;
  effectiveStatus: "scheduled" | "publishing" | "published" | "failed" | "draft" | "unknown";
  failureReason: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  publishedAt: string | null;
  updatedAt?: string | null;
  processingTry?: number | null;
  prepState?: "sending" | "ready" | "error" | null;
  prepError?: string | null;
  format?: string | null;    // "post" | "reel" | "story"
  storyOf?: string | null;   // a post's "also as a Story" points at the post
  coverUrl?: string | null;
  pages?: string[];
  channels?: string[];
  mediaFb?: string[];        // Facebook's own set (pictures beside an Instagram video carousel)
  collaborators?: string[];
  captionFbOverride?: string | null;
};

type TimeSuggestion = {
  weekday: number; hour: number; weekdayLabel: string; hourLabel: string;
  followersOnline: number; nextOccurrenceISO: string;
};

type Prediction = {
  basis: "topic-keyword" | "hashtag-overlap" | "recent-avg" | "no-data";
  matchedPosts: number;
  avgReach: number;
  avgEngagement: number;
  avgLikes: number;
  sampleSize: number;
  hashtagsMatched: string[];
  keywordsMatched: string[];
  note: string;
  hashtagLift: {
    withAvgReach: number;
    withoutAvgReach: number;
    liftPct: number;
    sampleWith: number;
    sampleWithout: number;
  } | null;
  suggestedHashtags: string[];
  captionHasHashtags: boolean;
};

type TopPerformer = {
  id: string; permalink: string; thumbnail: string | null; mediaType: string;
  caption: string; reach: number; likes: number; comments: number; timestamp: string;
  publishToPage?: string; // which account it belongs to (set when merging across accounts)
};

// A .pdf in the media list means a LinkedIn document carousel, not an image.
// Kept as a URL test because that is all the composer holds after upload.
const isPdfUrl = (u: string) => /\.pdf(\?|#|$)/i.test(u);
const isVideoUrl = (u: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u || "");
// Filename off the storage URL, minus the upload timestamp prefix we add.
const pdfName = (u: string) => decodeURIComponent((u.split("?")[0].split("/").pop() || "document.pdf"))
  .replace(/^\d{10,}-([a-z0-9]{4,8}-)?/i, "");   // some uploads carry only the timestamp

// Brand page -> its LinkedIn page key. GooCampus India has no LinkedIn page, so
// the LinkedIn option is unavailable (not merely unticked) whenever that is the
// only brand selected. Mirrors the mapping used when publishing.
// Only the GooCampus pages have LinkedIn pages; anything else (12thPlus, a linked
// brand like Samvaya) has none — it must never fall through to GooCampus's.
function linkedInKeyFor(page: string): string | null {
  return pageInfo(page).linkedIn;
}

// The pages are GooCampus's three plus every brand linked on the Brands page
// (lib/publish-pages.ts); components that list them call usePublishPages() so a
// linked brand appears once the list has loaded.
// What people see for a stored page value — "GooCampus Main" is just "GooCampus".
const pageLabel = (v: string) => pageInfo(v).label || v;

// Our own handles, offered before anyone types — collaborating with a sister
// account is the common case and should not need a lookup.
const OWN_IG_ACCOUNTS = [
  { username: "goocampus", label: "GooCampus" },
  { username: "goocampusworld", label: "GooCampus World" },
  { username: "12thplusdotcom", label: "12thPlus.com" },
];

// Soft daily post limits per account — warn (don't hard-block) before a day exceeds the
// account's max, so we don't over-post. Scheduling the (max+1)th post triggers the popup.
// min is the team's daily target (informational); max is what the guard enforces.
// The numbers are set on the Rules page (Scheduler → Posting limits, lib/app-settings.ts).
// How far apart two posts on the same account should sit. Two posts minutes apart
// split one audience: the second competes with the first for the same early
// engagement, and buries it in the feed. A warning, never a block — a launch or a
// live event is a real reason to double-post.
function minGapMinutes(page: string): number {
  return SETTINGS.posting[page]?.gap ?? 60;
}

function maxPostsPerDay(page: string): number {
  return SETTINGS.posting[page]?.max ?? 4;
}

const PUBLISH_TO_OPTIONS: { value: PublishTo; label: string; icon: string }[] = [
  { value: "Instagram/Facebook", label: "Instagram + Facebook", icon: "📱" },
  { value: "Instagram",          label: "Instagram only",       icon: "📸" },
  { value: "Facebook",           label: "Facebook only",        icon: "👍" },
];

export default function SchedulerPage() {
  useAppSettings();   // posting limits from the Rules page
  return (
    <PreviewDashboardShell active="scheduler" title="Scheduler" subtitle="Publish or schedule to Instagram, Facebook & LinkedIn — all from here." hideAccountPicker hideRange>
      {() => <SchedulerTabs />}
    </PreviewDashboardShell>
  );
}

// Two engines under one tab: the Meta (Instagram/Facebook) composer, and the
// self-contained LinkedIn scheduler (its own queue + cron worker). WhatsApp has
// its own tab — Community Broadcast — because it is not a social post at all.
function SchedulerTabs() {
  // One tab for every network. LinkedIn had its own tab, which the team never found;
  // it is now a tick next to Instagram and Facebook (Praveen, 21 Oct).
  return <Scheduler />;
}

function Scheduler() {
  const sbus = useSbus();   // live brand list (sql/027)
  const pageOptions = usePublishPages();
  // Form state
  const [particulars, setParticulars] = useState("");
  const [publishToPage, setPublishToPage] = useState<PublishToPage>("GooCampus Main");
  // Cross-post: which brand pages this post goes to. The first entry is the "primary"
  // that drives the preview / best-time / daily-limit checks; the rest fan it out.
  // Nothing ticked until the social media person picks — a pre-ticked page sent a
  // 10K Mentorship post to World instead of Main (Praveen, 26 Oct).
  const [composePages, setComposePages] = useState<string[]>([]);
  // Collaborator(s) to auto-invite on Instagram (comma-separated usernames / Page URLs, max 3).
  const [collab, setCollab] = useState("");
  const [publishTo, setPublishTo] = useState<PublishTo>("Instagram/Facebook");
  const [caption, setCaption] = useState("");
  // Suggestion state — 3 variants from Perplexity, only fetched on button click.
  type SuggestVariant = { kind: "tone" | "seo" | "punchy"; caption: string; hashtags: string[]; prediction: Prediction | null };
  const [suggestions, setSuggestions] = useState<SuggestVariant[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<string[]>([""]);
  // What the publisher should build: a reel (one video), a story (one image or video,
  // IG + FB only), or a post.
  const [format, setFormat] = useState<"post" | "reel" | "story">("post");
  // "Also share as a Story" beside a single-photo post or a reel (27 Oct).
  const [alsoStory, setAlsoStory] = useState(false);
  const [coverUrl, setCoverUrl] = useState("");
  // Which of Meta's two channels this goes to. A brand implies an Instagram account
  // AND one or more Facebook pages; until now both always fired. Meta lets you tick
  // them separately, and people do — a reel to Instagram only is a normal thing to want.
  const [igPref, setToInstagram] = useState(true);
  const [fbPref, setToFacebook] = useState(true);
  // Facebook takes pictures, a picture carousel or one video — not a carousel with
  // video slides (motion graphics with audio). Instagram posted one fine for 12thPlus;
  // Facebook turned it into a still image (Praveen, 28 Oct). So a carousel with any
  // video goes to Instagram only; swap the videos for pictures and Facebook comes back.
  // (Videos AND pictures together are two versions — videos to Instagram, pictures to
  // Facebook — so Facebook stays on for those.)
  const videoCarousel = useMemo(() => {
    const meta = mediaUrls.map((u) => u.trim()).filter((u) => u && !isPdfUrl(u));
    return meta.length > 1 && meta.some(isVideoUrl) && meta.every(isVideoUrl);
  }, [mediaUrls]);
  // A brand connected with "Connect Instagram only" has no Facebook page (5 Nov).
  const igOnlyPage = composePages.map((v) => pageInfo(v)).find((p) => p.instagramOnly) || null;
  const toFacebook = fbPref && !videoCarousel && !igOnlyPage;
  // A second caption for Facebook. Off by default: one caption is the common case,
  // and two boxes to fill is a tax on every post that doesn't need it.
  // The brand/business unit this post is for. Required on every Marketing Hub row,
  // and the calendar has been showing a blank Interest for every post made here
  // because the composer never asked.
  const [sbu, setSbu] = useState("");
  const [splitCaption, setSplitCaption] = useState(false);
  const [captionFb, setCaptionFb] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  // Cross-post to LinkedIn too. Maps each selected brand page to its LinkedIn org
  // page (Main → GooCampus, World → GooCampus World; India has no LinkedIn page).
  const [alsoLinkedIn, setAlsoLinkedIn] = useState(true);
  // LinkedIn pages reachable from the brands currently ticked. Empty for India.
  // Remembered per browser — Meta offers the same, and re-ticking two boxes every
  // time is the kind of small friction that makes people avoid a tool.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("gc.scheduler.channels");
      if (saved) { const v = JSON.parse(saved); setToInstagram(v.ig !== false); setToFacebook(v.fb !== false); }
    } catch { /* no preference stored */ }
  }, []);
  // Opening a draft sets the ticks to that post's networks; that isn't the person's
  // default for the next post, so it isn't saved as one.
  const draftTicks = useRef(false);
  useEffect(() => {
    if (draftTicks.current) { draftTicks.current = false; return; }
    try { localStorage.setItem("gc.scheduler.channels", JSON.stringify({ ig: igPref, fb: fbPref })); } catch { /* private mode */ }
  }, [igPref, fbPref]);

  const linkedInPages = useMemo(
    () => Array.from(new Set(composePages.map(linkedInKeyFor).filter((k): k is string => !!k))),
    [composePages],
  );
  const linkedInAvailable = linkedInPages.length > 0;
  // The ticked pages that have no LinkedIn page, by name, for the notes below.
  const noLinkedInName = composePages.filter((p) => !linkedInKeyFor(p)).map(pageLabel).join(" and ") || "This page";
  // Keep the primary page (drives preview / limits / suggest-time) in sync with the
  // first checked cross-post page.
  useEffect(() => {
    const primary = composePages[0];
    if (primary && primary !== publishToPage) setPublishToPage(primary as PublishToPage);
  }, [composePages]); // eslint-disable-line react-hooks/exhaustive-deps
  // Ticking a brand that HAS a LinkedIn page turns cross-posting on by itself —
  // posting to both is the normal case, so it shouldn't need a second click. Still
  // un-tickable. Forced back off when the selection has no LinkedIn page at all.
  useEffect(() => {
    setAlsoLinkedIn(linkedInAvailable);
  }, [linkedInAvailable]);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  // Missing-fields popup — client guards and any server 422 both land here.
  const [gate, setGate] = useState<GateBlock | null>(null);
  // recordId is optional: a LinkedIn-only (PDF) post never touches the Meta queue,
  // so there is no mh_posts row to point at.
  const [result, setResult] = useState<{ ok: true; recordId?: string; draft?: boolean; whenLabel?: string; story?: boolean } | { ok: false; error: string } | null>(null);

  // Smart features state
  const [timeSuggestions, setTimeSuggestions] = useState<TimeSuggestion[]>([]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [fbBaseline, setFbBaseline] = useState<FacebookBaseline | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [topPerformers, setTopPerformers] = useState<TopPerformer[]>([]);
  const [topLoading, setTopLoading] = useState(false);

  // Queue + queue-view state
  const [queue, setQueue] = useState<ScheduledPost[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueFetchedAt, setQueueFetchedAt] = useState<number | null>(null);
  const [queueLatency, setQueueLatency] = useState<number | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Show the create-post form as a modal overlay so it doesn't dominate the tab.
  // The queue-management view is the primary content now.
  const [showCreateForm, setShowCreateForm] = useState(false);
  // ── "To schedule" tab: Output-Ready content pulled straight from Supabase (mh_posts).
  //    Overview-style toggle: "To schedule" (produced content awaiting a publish
  //    action) vs "Publish & queue" (the manual composer + live queue). ──
  type ToScheduleItem = {
    id: string; title: string; status: string; sbu: string | null; type: string | null;
    caption: string | null; content: string | null; mediaUrls: string[]; assetLink: string | null;
    coverUrl?: string | null;   // the reel's Thumbnail box, or its thumbnail task's image (to-schedule)
    channel: string | null; defaultPage: string; publishingDate: string | null;
    airtableRecordId?: string | null;
  };
  // ?tab=calendar and ?tab=top; no tab is the queue you land on.
  const tabParam = useSearchParams().get("tab");
  const schedTab: "to_schedule" | "publish" | "top" =
    tabParam === "calendar" ? "publish" : tabParam === "top" ? "top" : "to_schedule";
  // Which status the counter strip is filtering the list to. "ready" = produced content
  // awaiting scheduling (the default To-schedule master list); the rest slice the queue.
  const [listFilter, setListFilter] = useState<"ready" | "scheduled" | "published" | "failed" | "drafts" | "linkedin">("ready");
  const [topAccount, setTopAccount] = useState<string>("all");
  const [toSchedule, setToSchedule] = useState<ToScheduleItem[]>([]);
  const [toScheduleLoading, setToScheduleLoading] = useState(true);
  // Brand pages this person may schedule to (Team & access → Scheduler); null = all.
  // Posts for other pages are left out of every list here, and the page picker only
  // offers these — the server refuses the rest anyway (22 Oct).
  const [allowedPages, setAllowedPages] = useState<string[] | null>(null);
  const mePages = useRef<Promise<string[] | null> | null>(null);
  const loadMePages = () => (mePages.current ||= fetch("/api/me", { cache: "no-store" }).then((r) => r.json())
    .then((d) => { const v = d?.user?.permissions?.scheduler_pages; const pages = Array.isArray(v) ? (v as string[]) : null; setAllowedPages(pages); return pages; })
    .catch(() => null));
  const loadToSchedule = () => {
    setToScheduleLoading(true);
    Promise.all([fetch("/api/scheduler/to-schedule", { cache: "no-store" }).then((r) => r.json()), loadMePages()])
      .then(([d, pages]: [{ posts?: ToScheduleItem[] }, string[] | null]) =>
        setToSchedule((d.posts || []).filter((t) => !pages || !t.defaultPage || pages.includes(t.defaultPage))))
      .catch(() => {})
      .finally(() => setToScheduleLoading(false));
  };
  useEffect(() => {
    if (allowedPages && composePages.some((p) => !allowedPages.includes(p))) setComposePages(allowedPages.slice(0, 1));
  }, [allowedPages]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadToSchedule(); }, []);
  // Delete a post that isn't wanted at all (Praveen, 22 Oct) — it goes to the recycle
  // bin with its creatives and history, and can be restored from there.
  const deleteToSchedule = async (t: ToScheduleItem) => {
    const ok = await confirmDialog({
      title: "Delete this post?",
      body: <>“{t.title}” goes to the recycle bin, with its creatives and history. You can restore it from there.</>,
      action: "Delete", danger: true,
    });
    if (!ok) return;
    const res = await fetch("/api/marketing-hub/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alertDialog("Couldn't delete it", (d as { error?: string }).error || `HTTP ${res.status}`); return; }
    if (selectedTaskId === t.id) { setSelectedTaskId(null); openTaskRef.current = null; }
    loadToSchedule();
  };
  // Take a post out of the Scheduler without deleting it: back to "Output - Ready",
  // which is where Content Review picks it up again (for fixes, not removal).
  const sendBackToReview = async (t: ToScheduleItem) => {
    const ok = await confirmDialog({
      title: "Send back to Content Review?",
      body: <>“{t.title}” leaves the Scheduler and goes back to Content Review, where it can be fixed and pushed to schedule again. Nothing is deleted.</>,
      action: "Send back",
    });
    if (!ok) return;
    const res = await fetch("/api/marketing-hub/update", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id, fields: {
        status: "Output - Ready",
        // Save the caption on the way out. It lives only in React state while the
        // composer is open — mh_posts does not mirror it and /api/scheduler/caption
        // is read-only, pulling from Airtable — so sending the status by itself
        // discarded whatever had been typed, and the next read fetched the empty
        // Airtable value back over it. "captions are disappearing, it is not
        // staying in the task when I am updating" (Manya, 6 Oct). Only when the
        // composer is actually showing this task, so sending back a different row
        // can't stamp one task's caption onto another.
        ...(selectedTaskId === t.id && caption.trim() ? { caption: caption.trim() } : {}),
      } }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alertDialog("Couldn't send it back", (d as { error?: string }).error || `HTTP ${res.status}`); return; }
    if (selectedTaskId === t.id) { setSelectedTaskId(null); openTaskRef.current = null; }
    loadToSchedule();
  };
  // Hand-off from the Overview "Old winners worth refreshing" cards: ?draft=title=…&brief=…
  // opens the composer prefilled with the old post's copy as an EDITABLE starting point
  // (GooCampus reworks + redesigns old content — never a locked raw repost).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const draft = new URLSearchParams(window.location.search).get("draft");
    if (!draft) return;
    const d = new URLSearchParams(draft);
    const title = d.get("title") || "";
    const brief = d.get("brief") || "";
    const media = d.getAll("media").filter(Boolean);
    if (title) setParticulars(title);
    if (brief) setCaption(brief);
    if (media.length) setMediaUrls(media);   // carry the original creative — no re-upload
    if (title || brief || media.length) setShowCreateForm(true);
  }, []);
  // When the composer is scheduling an EXISTING Output-Ready task, we carry its id
  // so publishing UPDATES that mh_posts row (and it leaves "To schedule"). null =
  // a brand-new manual post (INSERT).
  const [schedulingTaskId, setSchedulingTaskId] = useState<string | null>(null);
  // "To schedule" tab view: the new inline master-detail (list + live preview, no
  // popup) vs the classic card grid. selectedTaskId = which row's editor is open.
  const [toScheduleView, setToScheduleView] = useState<"list" | "cards">("list");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const openTaskRef = useRef<string | null>(null); // guards the async caption fetch against fast task switches
  // Which network the live preview mocks. IG/FB share the handle; LinkedIn uses the page name.
  const [previewPlatform, setPreviewPlatform] = useState<PreviewPlatform>("instagram");
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("mobile");
  // A scheduled/published post opened in the big full-screen view popup.
  const [calItem, setCalItem] = useState<CalendarItem | null>(null);
  // A Reel task usually carries the video AND its thumbnail picture as creatives, which
  // read as a two-file carousel, so Reel and the thumbnail picker never showed (Praveen,
  // 4 Nov 2026). A Reel task with one video opens as that reel, its picture as the cover.
  function taskMedia(t: ToScheduleItem): { media: string[]; cover: string; reel: boolean } {
    const all = (t.mediaUrls || []).filter(Boolean);
    const vids = all.filter(isVideoUrl), pics = all.filter((u) => !isVideoUrl(u) && !isPdfUrl(u));
    // Cover: the task's Thumbnail box (or its thumbnail task), else the first picture (4 Nov).
    if (/reel/i.test(t.type || "") && vids.length === 1) return { media: vids, cover: t.coverUrl || pics[0] || "", reel: true };
    return { media: all, cover: "", reel: false };
  }
  // Open the manual composer pre-filled from an Output-Ready task.
  function scheduleFromTask(t: ToScheduleItem) {
    setSchedulingTaskId(t.id);
    setParticulars(t.title);
    setComposePages([]);   // the social media person picks the page — never pre-ticked
    setAlsoLinkedIn(false);
    setCaption(t.caption || "");
    const tm = taskMedia(t);
    setMediaUrls(tm.media.length ? tm.media : [""]);
    setCoverUrl(tm.cover);
    // A Story task opens as a Story — with several files it would otherwise start as
    // a carousel post (3 Nov 2026).
    draftFormat.current = /story/i.test(t.type || "") ? "story" : tm.reel ? "reel" : null;
    setShowCreateForm(true);
  }
  // Inline (no-modal) counterpart of scheduleFromTask: prefill the SAME composer
  // state the modal uses, but open the editor in place inside the list row. Clicking
  // an already-open row collapses it.
  function selectTask(t: ToScheduleItem) {
    if (selectedTaskId === t.id) { setSelectedTaskId(null); openTaskRef.current = null; return; }
    setSchedulingTaskId(t.id);
    setParticulars(t.title);
    setComposePages([]);   // the social media person picks the page — never pre-ticked
    setAlsoLinkedIn(false);
    setCaption(t.caption || "");
    const tm = taskMedia(t);
    setMediaUrls(tm.media.length ? tm.media : [""]);
    setCoverUrl(tm.cover);
    draftFormat.current = /story/i.test(t.type || "") ? "story" : tm.reel ? "reel" : null;   // see scheduleFromTask
    setScheduleEnabled(false);
    // Ticked again if this task already has a Story waiting, so re-scheduling it
    // doesn't drop that Story unasked.
    setAlsoStory(queue.some((p) => p.storyOf === t.id && p.effectiveStatus !== "published"));
    setResult(null);
    setSelectedTaskId(t.id);
    openTaskRef.current = t.id;
    // Auto-fill the caption from the Marketing Hub content (Airtable "Caption:" section).
    // mh_posts doesn't mirror the caption, so fetch it live when there isn't one already.
    if (!(t.caption && t.caption.trim()) && t.airtableRecordId) {
      fetch(`/api/scheduler/caption?recordId=${encodeURIComponent(t.airtableRecordId)}`)
        .then((r) => r.json())
        .then((d: { caption?: string }) => {
          // apply only if this task is still open and the user hasn't typed a caption
          if (d.caption && openTaskRef.current === t.id) {
            setCaption((cur) => (cur && cur.trim() ? cur : d.caption!));
          }
        })
        .catch(() => {});
    }
  }
  // When rescheduling a top performer, the creatives are locked (view-only) — you're
  // reposting the SAME media, only the caption changes.
  const [mediaLocked, setMediaLocked] = useState(false);
  // A draft left open and closed must not seed the next new post (it would publish a copy).
  const editingDraft = useRef(false);
  const openManualComposer = () => {
    if (editingDraft.current) { resetComposer(); editingDraft.current = false; }
    setSchedulingTaskId(null); setMediaLocked(false); setShowCreateForm(true);
  };
  // Reopen a draft in Create post with everything it was saved with. The draft's own
  // id rides along, so Publish / Schedule / Save as draft update it instead of adding
  // a copy (27 Oct).
  function openDraft(p: ScheduledPost) {
    resetComposer();
    editingDraft.current = true;
    setSchedulingTaskId(p.id);
    setMediaLocked(false);
    setParticulars(p.particulars || "");
    setCaption(p.fullCaption || "");
    // A split post keeps Facebook's pictures apart (custom.media_fb); bring them back so
    // the composer shows both sets, as they were uploaded.
    const igSet = p.mediaUrls && p.mediaUrls.length ? p.mediaUrls : [];
    const media = [...igSet, ...(p.mediaFb || []).filter((u) => !igSet.includes(u))];
    setMediaUrls(media.length ? media : [""]);
    setComposePages(p.pages && p.pages.length ? p.pages : [p.publishToPage].filter(Boolean));
    const ch = p.channels && p.channels.length ? p.channels : ["instagram", "facebook"];
    // A video carousel was saved Instagram-only by the Facebook rule, not by choice;
    // leave the Facebook preference alone so the next post isn't left unticked.
    const meta = media.filter((u) => !isPdfUrl(u));
    const nextFb = meta.length > 1 && meta.some(isVideoUrl) ? fbPref : ch.includes("facebook");
    if (ch.includes("instagram") !== igPref || nextFb !== fbPref) draftTicks.current = true;
    setToInstagram(ch.includes("instagram"));
    setToFacebook(nextFb);
    setCollab((p.collaborators || []).join(", "));
    setSbu(p.primaryInterest || "");
    setCaptionFb(p.captionFbOverride || "");
    setSplitCaption(!!p.captionFbOverride);
    setCoverUrl(p.coverUrl || "");
    const fmt = p.format === "reel" || p.format === "story" ? p.format : "post";
    if (media.filter((u) => !isPdfUrl(u)).length === 1) draftFormat.current = fmt;
    setAlsoStory(draftHasStory(p.id));
    setResult(null);
    setShowCreateForm(true);
  }
  async function discardDraft(p: ScheduledPost) {
    const ok = await confirmDialog({
      title: "Delete this draft?",
      body: <span>“{p.particulars || "Untitled"}”{draftHasStory(p.id) ? " and its Story" : ""} will go to the recycle bin — you can restore it from there.</span>,
      action: "Delete draft",
      cancel: "Keep it",
    });
    if (!ok) return;
    const r = await fetch("/api/scheduler/discard-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordId: p.id }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); await alertDialog(`Couldn't delete the draft — ${(j as { error?: string }).error || "try again in a moment."}`); return; }
    loadQueue();
  }
  // Filters for the queue
  const [filterPage, setFilterPage] = useState<string>("all");
  const [filterInterest, setFilterInterest] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  // Per-row inline editing state
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
  const [editingCaptionText, setEditingCaptionText] = useState<string>("");
  const [captionSaving, setCaptionSaving] = useState(false);
  const [rowActionId, setRowActionId] = useState<string | null>(null); // shows spinner on the row being acted on
  // Schedule-now modal — set to a post when the user clicks the button on a queue card.
  const [scheduleModalPost, setScheduleModalPost] = useState<ScheduledPost | null>(null);
  // Post pending a delete/reschedule choice (the confirm popup from a Delete click).
  const [deletePost, setDeletePost] = useState<ScheduledPost | null>(null);
  // Over-posting guard: when a target day already hit the account's daily max, hold the
  // pending schedule here and show the warning popup instead of committing straight away.
  const [gapWarn, setGapWarn] = useState<{
    page: string; gap: number; minutes: number; other: ScheduledPost;
    whenLabel: string; suggestedISO: string; suggestedLabel: string;
    onProceed: () => void; onMove: () => void;
  } | null>(null);
  const [capWarn, setCapWarn] = useState<{
    dateLabel: string; page: string; limit: number; existing: ScheduledPost[];
    onProceed: () => void | Promise<void>; onPickAnother: () => void;
  } | null>(null);

  // Real published IG posts across ALL 3 GooCampus accounts — shown alongside the
  // scheduled posts in the Content Calendar. Each post is tagged with its account
  // (publishToPage) so tiles/filters can tell them apart.
  const [publishedIG, setPublishedIG] = useState([] as PublishedIG[]);
  useEffect(() => {
    const accounts: { id: string; page: string }[] = pageOptions.map((o) => ({ id: o.accountId, page: o.value }));
    Promise.all(accounts.map((a) =>
      fetch(`/api/posts?accountId=${a.id}&limit=20&insights=true`)
        .then((r) => r.ok ? r.json() : { posts: [] })
        .then((d) => ((d.posts || []) as PublishedIG[]).map((p) => ({ ...p, publishToPage: a.page })))
        .catch(() => [] as PublishedIG[])
    )).then((results) => {
      const merged = results.flat().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setPublishedIG(merged);
    });
  }, [pageOptions]);

  const loadQueue = (quiet = false) => {
    if (!quiet) setQueueLoading(true);
    setQueueError(null);
    const t0 = Date.now();
    fetch("/api/scheduler/queue", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.text();
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
        try { return JSON.parse(body); } catch { throw new Error(`Non-JSON: ${body.slice(0, 200)}`); }
      })
      .then((d: { posts?: ScheduledPost[]; error?: string }) => {
        if (d.error) { setQueueError(d.error); setQueue([]); }
        else { setQueue(d.posts || []); }
        setQueueFetchedAt(Date.now());
        setQueueLatency(Date.now() - t0);
      })
      .catch((e) => { setQueueError((e as Error).message); })
      .finally(() => setQueueLoading(false));
  };

  useEffect(() => { loadQueue(); }, []);
  // While anything is due within 10 minutes or is being published, re-read the queue
  // every 30 s, so a post the publisher has picked up shows "Publishing…" and then
  // moves to Published by itself — instead of sitting at "Scheduled" on a page that
  // was loaded before it went out (NEET PG - MCC NRI rules, 21 Oct).
  useEffect(() => {
    const soon = queue.some((p) => p.effectiveStatus === "publishing"
      || (p.effectiveStatus === "scheduled" && p.scheduleTime && new Date(p.scheduleTime).getTime() - Date.now() < 10 * 60_000));
    if (!soon) return;
    const t = setInterval(() => loadQueue(true), 30_000);
    return () => clearInterval(t);
  }, [queue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Smart time suggestions — refetch when brand changes
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/scheduler/suggest-time?publishToPage=${encodeURIComponent(publishToPage)}`, { signal: ctrl.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { suggestions?: TimeSuggestion[] } | null) => { if (d?.suggestions) setTimeSuggestions(d.suggestions); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [publishToPage]);

  // Facebook's side of the same question. It depends only on the page, not on what
  // is typed, because there is nothing to compare a caption against — see
  // facebookBaseline() for why Facebook gets measurements instead of a forecast.
  useEffect(() => {
    setFbBaseline(null);
    if (!publishToPage || !toFacebook) return;
    const ctrl = new AbortController();
    fetch("/api/scheduler/fb-baseline", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publishToPage }), signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { baseline?: FacebookBaseline } | null) => { if (d?.baseline) setFbBaseline(d.baseline); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [publishToPage, toFacebook]);

  // Prediction — refetch when brand or caption changes (debounced).
  // CRITICAL: clear old prediction state IMMEDIATELY on every change so stale data
  // never lingers between captions; loading state takes over until new fetch completes.
  useEffect(() => {
    // Always wipe stale prediction first — applies to both "empty caption" and "new caption" cases
    setPrediction(null);

    const trimmed = caption.trim();
    if (!trimmed) {
      // No caption → no prediction, no loading either
      setPredictionLoading(false);
      return;
    }

    // Show loading immediately so user sees feedback while we wait for the debounce
    setPredictionLoading(true);

    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch("/api/scheduler/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishToPage, caption: trimmed }),
        signal: ctrl.signal,
      })
        .then((r) => r.ok ? r.json() : null)
        .then((d: { prediction?: Prediction } | null) => { if (d?.prediction) setPrediction(d.prediction); })
        .catch(() => {})  // abort errors are expected when the next keystroke supersedes
        .finally(() => setPredictionLoading(false));
    }, 800);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [publishToPage, caption]);

  function applyTimeSuggestion(s: TimeSuggestion) {
    const d = new Date(s.nextOccurrenceISO);
    const ymd = d.toLocaleDateString("en-CA"); // YYYY-MM-DD in local tz
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    setScheduleEnabled(true);
    setScheduleDate(ymd);
    setScheduleTime(hm);
  }

  // Top performers now live in their own tab. Fetch across the selected account(s),
  // merge, and sort by reach.
  const loadTopPerformers = async () => {
    setTopLoading(true);
    try {
      const pages = topAccount === "all" ? pageOptions.map((o) => o.value) : [topAccount];
      const results = await Promise.all(pages.map((pg) =>
        fetch(`/api/scheduler/top-performers?publishToPage=${encodeURIComponent(pg)}`)
          .then((r) => r.ok ? r.json() : { top: [] })
          .then((d) => ((d.top || []) as TopPerformer[]).map((t) => ({ ...t, publishToPage: pg })))
          .catch(() => [] as TopPerformer[])
      ));
      setTopPerformers(results.flat().sort((a, b) => b.reach - a.reach));
    } finally { setTopLoading(false); }
  };
  useEffect(() => { if (schedTab === "top") loadTopPerformers(); }, [schedTab, topAccount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Click a winner → open the manual composer pre-filled to reschedule/repost it.
  // For a carousel we pull EVERY slide so all images come across, not just the cover.
  async function rescheduleTopPerformer(p: TopPerformer) {
    setSchedulingTaskId(null);
    setMediaLocked(true);
    if (p.publishToPage) setComposePages([p.publishToPage]);
    setParticulars(`Repost: ${(p.caption || "").slice(0, 60)}`);
    setCaption(p.caption || "");
    setMediaUrls(p.thumbnail ? [p.thumbnail] : [""]);
    setShowCreateForm(true);
    if (p.mediaType === "CAROUSEL_ALBUM") {
      const accId = pageInfo(p.publishToPage).accountId || "goocampus";
      try {
        const r = await fetch(`/api/scheduler/media-children?mediaId=${encodeURIComponent(p.id)}&accountId=${accId}`);
        const d = await r.json();
        if (Array.isArray(d.urls) && d.urls.length) setMediaUrls(d.urls);
      } catch { /* keep the thumbnail fallback */ }
    }
  }

  const cleanMediaUrls = useMemo(() => mediaUrls.map((u) => u.trim()).filter(Boolean), [mediaUrls]);
  const mediaSizes = useMediaSizes(cleanMediaUrls);
  // Instagram publishes videos up to 300 MB from outside its app (Meta's API limit);
  // Facebook takes up to 1 GB. A bigger video goes to Facebook only — no compressing
  // (Praveen, 28 Oct). The enqueue route makes the same call from the file sizes.
  const tooBigForIg = cleanMediaUrls.filter((u) => (mediaSizes[u] || 0) > IG_MAX_BYTES).map((u) => ({ name: decodeURIComponent(u.split("/").pop() || "video").replace(/^\d{10,}-/, ""), size: mediaSizes[u] }));
  const toInstagram = igPref && tooBigForIg.length === 0;
  // A PDF is a LinkedIn document carousel (a deck posted as separate images gets
  // reordered by LinkedIn; as one PDF the slides keep their order). Meta has no
  // equivalent and rejects PDFs, so they are split out and never sent there.
  const pdfUrls = useMemo(() => cleanMediaUrls.filter(isPdfUrl), [cleanMediaUrls]);
  const metaMediaUrls = useMemo(() => cleanMediaUrls.filter((u) => !isPdfUrl(u)), [cleanMediaUrls]);
  // Video slides and pictures together: the videos are the Instagram carousel, the
  // pictures what Facebook posts (the enqueue route makes the same split).
  const mixedMedia = metaMediaUrls.some(isVideoUrl) && metaMediaUrls.some((u) => !isVideoUrl(u));
  const igMedia = mixedMedia ? metaMediaUrls.filter(isVideoUrl) : metaMediaUrls;
  const fbMedia = mixedMedia ? metaMediaUrls.filter((u) => !isVideoUrl(u)) : metaMediaUrls;
  // Prefer the PDF for LinkedIn when there is one, else the first image.
  const linkedInMediaUrl = pdfUrls[0] || metaMediaUrls[0];
  // PDF and nothing else → there is nothing for Instagram/Facebook to post, so
  // this becomes a LinkedIn-only post and the Meta queue is skipped entirely.
  // Same when Instagram and Facebook are both unticked — LinkedIn is all that's left.
  const linkedInOnly = (pdfUrls.length > 0 && metaMediaUrls.length === 0) || (!toInstagram && !toFacebook);
  // Exactly one video and nothing else — the only shape a reel can be.
  const singleVideoUrl = useMemo(
    () => (metaMediaUrls.length === 1 && /\.(mp4|mov|m4v)($|\?)/i.test(metaMediaUrls[0]) ? metaMediaUrls[0] : ""),   // .mov too (iPhone video), 4 Nov 2026
    [metaMediaUrls],
  );
  // A story is one image or one video, so the format question is no longer
  // video-only. Several files can be a carousel post or a story of several frames —
  // each file then goes out as its own story, in order (Meta has no carousel story;
  // lib/scheduler-enqueue syncFrames, 3 Nov 2026). Never a reel.
  const singleMediaUrl = metaMediaUrls.length === 1 ? metaMediaUrls[0] : "";
  const formatChoices = useMemo<("post" | "reel" | "story")[]>(
    () => (metaMediaUrls.length > 1 ? (metaMediaUrls.length <= 10 ? ["post", "story"] : ["post"])
      : !singleMediaUrl ? [] : singleVideoUrl ? ["post", "reel", "story"] : ["post", "story"]),
    [metaMediaUrls.length, singleMediaUrl, singleVideoUrl],
  );
  // The file decides, because the file mostly already knows: Instagram publishes a
  // single video as a reel whatever we choose to call it, and a jpg can only be a
  // feed post. So an mp4 arrives as Reel and an image as Post, and nobody has to
  // answer a question the upload already answered.
  //
  // It cannot decide everything. A story is an image *or* a video, so no file type
  // points at it — that is the one the toggle is still for. Picking by hand wins
  // until the creative changes, at which point the file gets the say again.
  const formatTouched = useRef(false);
  // A reopened draft brings its own format; applied once, after its media lands.
  const draftFormat = useRef<"post" | "reel" | "story" | null>(null);
  useEffect(() => { formatTouched.current = false; }, [singleMediaUrl, metaMediaUrls.length]);
  useEffect(() => {
    if (draftFormat.current) { setFormat(draftFormat.current); formatTouched.current = true; draftFormat.current = null; return; }
    if (formatTouched.current) return;
    setFormat(!singleMediaUrl ? "post" : singleVideoUrl ? "reel" : "post");
  }, [singleMediaUrl, singleVideoUrl, metaMediaUrls.length, schedulingTaskId]);
  const chooseFormat = (f: "post" | "reel" | "story") => { formatTouched.current = true; setFormat(f); };
  // "Also share as a Story" — only for one photo (post) or one reel going to Instagram
  // and/or Facebook. It queues a Story beside the post at the same time (now or the
  // scheduled time); the publisher sends both. LinkedIn has no Stories.
  const storyOffer = !!singleMediaUrl && (format === "post" || format === "reel") && (toInstagram || toFacebook);
  const storyTick = storyOffer ? (
    <label className="flex items-start gap-2 mt-3 cursor-pointer">
      <input type="checkbox" checked={alsoStory} onChange={(e) => setAlsoStory(e.target.checked)} className="w-4 h-4 mt-0.5 accent-[#3A57E8]" />
      <span>
        <span className="text-sm text-[#232D42]">{format === "reel" ? "Use this reel as a Story too" : "Also share as a Story"}</span>
        <span className="block text-xs text-[#8A92A6]">
          {[toInstagram && "Instagram", toFacebook && "Facebook"].filter(Boolean).join(" + ")} Story, at the same time as the post. LinkedIn has no Stories.
        </span>
      </span>
    </label>
  ) : null;
  // Everything the queue needs, listed in one place. The Schedule/Publish button stays
  // clickable when something's short so the popup can name it — a greyed-out button
  // with no reason was the single most common "why won't it do anything?" complaint.
  const missingToPublish = useMemo(() => [
    composePages.length === 0 && "A page to publish to — tick where it should go",
    format !== "story" && !caption.trim() && "A caption",
    cleanMediaUrls.length === 0 && "At least one image or video",
    // LinkedIn is ticked automatically, so this only fires if it was turned off
    // on a post whose only file is a PDF — nothing left to publish anywhere.
    linkedInOnly && !(alsoLinkedIn && linkedInAvailable) && (toInstagram || toFacebook
      ? (linkedInAvailable ? "Somewhere to post the PDF — turn LinkedIn back on, or add an image"
        : `Somewhere to post the PDF — ${noLinkedInName} has no LinkedIn page, so pick GooCampus or GooCampus World, or add images`)
      : "Somewhere to post — tick Instagram, Facebook or LinkedIn"),
    scheduleEnabled && !(scheduleDate && scheduleTime) && "A date and time to publish",
  ].filter((x): x is string => !!x), [composePages, format, caption, cleanMediaUrls, linkedInOnly, alsoLinkedIn, linkedInAvailable, scheduleEnabled, scheduleDate, scheduleTime, toInstagram, toFacebook]);
  const canSubmit = missingToPublish.length === 0 && !submitting;

  // Posts already committed to the same local day for a given account (scheduled,
  // publishing, or already published). Used by the over-posting guard.
  function postsOnDay(iso: string, page: string, excludeId?: string): ScheduledPost[] {
    const day = new Date(iso).toLocaleDateString("en-CA"); // local YYYY-MM-DD
    return queue.filter((p) => {
      if (excludeId && p.id === excludeId) return false;
      if (page && p.publishToPage !== page) return false;
      // A Story doesn't land in the feed, so it doesn't use up the day or the gap —
      // otherwise a post's own "also as a Story" would block the next slot (27 Oct).
      if (p.format === "story") return false;
      if (!["scheduled", "publishing", "published"].includes(p.effectiveStatus)) return false;
      const t = p.scheduleTime || p.publishedAt;
      return !!t && new Date(t).toLocaleDateString("en-CA") === day;
    });
  }
  /** The post on this page nearest to `iso`, if it falls inside the gap. */
  function tooCloseTo(iso: string, page: string, excludeId?: string): { post: ScheduledPost; minutes: number } | null {
    const target = new Date(iso).getTime();
    const gapMs = minGapMinutes(page) * 60_000;
    let nearest: { post: ScheduledPost; minutes: number } | null = null;
    for (const p of postsOnDay(iso, page, excludeId)) {
      const t = p.scheduleTime || p.publishedAt;
      if (!t) continue;
      const diff = Math.abs(new Date(t).getTime() - target);
      if (diff >= gapMs) continue;
      const minutes = Math.round(diff / 60_000);
      if (!nearest || minutes < nearest.minutes) nearest = { post: p, minutes };
    }
    return nearest;
  }

  /** The first slot at or after `iso` that clears every post on that page. */
  function nextClearSlot(iso: string, page: string, excludeId?: string): string {
    const gapMs = minGapMinutes(page) * 60_000;
    let t = new Date(iso).getTime();
    // Walk forward past each conflict rather than adding one gap blindly — three
    // posts an hour apart would otherwise land you on top of the next one.
    for (let i = 0; i < 24; i++) {
      const clash = tooCloseTo(new Date(t).toISOString(), page, excludeId);
      if (!clash) break;
      const other = new Date(clash.post.scheduleTime || clash.post.publishedAt || t).getTime();
      t = other + gapMs;
    }
    return new Date(t).toISOString();
  }

  const hhmm = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });

  function dayLabel(iso: string): string {
    const d = new Date(iso);
    const full = d.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOf(d) - startOf(new Date())) / 86400000);
    // Read naturally for the day actually picked: today / tomorrow / the exact date.
    if (diffDays === 0) return `today (${full})`;
    if (diffDays === 1) return `tomorrow (${full})`;
    return full;
  }

  async function submit() {
    if (missingToPublish.length) { setGate({ gate: "schedule", missing: missingToPublish, title: particulars.trim() || "This post" }); return; }
    let scheduleTimeISO: string | undefined;
    if (scheduleEnabled && scheduleDate && scheduleTime) {
      const local = new Date(`${scheduleDate}T${scheduleTime}:00`);
      if (!Number.isNaN(local.getTime())) scheduleTimeISO = local.toISOString();
    }
    // Review before anything goes out: exactly which page(s), networks and when.
    {
      const nets = [toInstagram && "Instagram", toFacebook && "Facebook", alsoLinkedIn && linkedInAvailable && "LinkedIn"].filter(Boolean).join(" · ");
      const when = scheduleTimeISO ? `${dayLabel(scheduleTimeISO)} at ${hhmm(scheduleTimeISO)}` : "Right away";
      const thumb = cleanMediaUrls[0];
      const ok = await confirmDialog({
        title: "Check before it goes",
        body: (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {thumb && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(thumb)
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={thumb} alt="" className="w-12 h-12 rounded-lg object-cover border border-gray-100 flex-shrink-0" />
                : null}
              <div className="min-w-0 text-[#232D42] font-medium truncate">{particulars.trim() || "This post"}</div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-brand-light px-3 py-2.5">
              <div className="text-[11px] uppercase tracking-wide text-[#8A92A6]">Posting to</div>
              {composePages.map((p) => (
                <div key={p} className="text-[15px] font-medium text-[#232D42]">{p} <span className="text-[#8A92A6] font-normal">{pageHandle(p)}</span></div>
              ))}
              <div className="text-[13px] text-[#4A5468] mt-1">{nets || "No network ticked"}</div>
            </div>
            {storyOffer && alsoStory && (
              <div className="text-[13px] text-[#4A5468]"><span className="text-[#8A92A6]">Also:</span> as a {[toInstagram && "Instagram", toFacebook && "Facebook"].filter(Boolean).join(" + ")} Story, at the same time</div>
            )}
            <div className="text-[13px] text-[#4A5468]"><span className="text-[#8A92A6]">When:</span> {when}</div>
          </div>
        ),
        action: scheduleTimeISO ? "Yes, schedule" : "Yes, post now",
        cancel: "Go back",
      });
      if (!ok) return;
    }
    // Over-posting guard — if that day+account is already full, warn before committing.
    if (scheduleTimeISO) {
      const existing = postsOnDay(scheduleTimeISO, publishToPage, schedulingTaskId || undefined);
      const limit = maxPostsPerDay(publishToPage);
      if (existing.length >= limit) {
        const iso = scheduleTimeISO;
        setCapWarn({
          dateLabel: dayLabel(iso), page: publishToPage, limit, existing,
          onProceed: () => { setCapWarn(null); doEnqueue(iso); },
          onPickAnother: () => setCapWarn(null),
        });
        return;
      }
      // Spacing guard. Runs after the day cap so the more serious warning wins.
      const clash = tooCloseTo(scheduleTimeISO, publishToPage, schedulingTaskId || undefined);
      if (clash) {
        const iso = scheduleTimeISO;
        const moveTo = nextClearSlot(iso, publishToPage, schedulingTaskId || undefined);
        setGapWarn({
          page: publishToPage,
          gap: minGapMinutes(publishToPage),
          minutes: clash.minutes,
          other: clash.post,
          whenLabel: hhmm(clash.post.scheduleTime || clash.post.publishedAt || iso),
          suggestedISO: moveTo,
          suggestedLabel: hhmm(moveTo),
          onProceed: () => { setGapWarn(null); doEnqueue(iso); },
          onMove: () => {
            const d = new Date(moveTo);
            setScheduleDate(d.toLocaleDateString("en-CA"));
            setScheduleTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
            setGapWarn(null);
            doEnqueue(moveTo);
          },
        });
        return;
      }
    }
    doEnqueue(scheduleTimeISO);
  }

  function resetComposer() {
    setParticulars(""); setCaption(""); setMediaUrls([""]); setCollab(""); setScheduleEnabled(false);
    setScheduleDate(""); setScheduleTime(""); setSchedulingTaskId(null); setSelectedTaskId(null); setAlsoLinkedIn(false);
    setFormat("post"); setAlsoStory(false); setCoverUrl(""); setSplitCaption(false); setCaptionFb(""); setSbu("");
    setComposePages([]);   // the next post starts with no page ticked too
  }

  // Instagram, Facebook and LinkedIn in one row — in Create post AND in the panel a
  // ready task opens in. LinkedIn used to sit on its own tab and the task panel had
  // no network ticks at all, so nobody could find it (Praveen, 21 Oct).
  const channelTicks = (
    <div>
      <div className="flex items-center gap-4 flex-wrap">
        {([["Instagram", toInstagram, setToInstagram, tooBigForIg.length > 0], ["Facebook", toFacebook, setToFacebook, videoCarousel || !!igOnlyPage]] as const).map(([label, on, set, off]) => (
          <label key={label} className={`flex items-center gap-2 ${off ? "cursor-not-allowed" : "cursor-pointer"}`}>
            <input type="checkbox" checked={on} disabled={off} onChange={(e) => set(e.target.checked)} className="w-4 h-4 accent-[#3A57E8] disabled:opacity-40" />
            <span className={`text-sm ${off ? "text-gray-400" : "text-gray-800"}`}>{label}</span>
          </label>
        ))}
        <label className={`flex items-center gap-2 ${linkedInAvailable ? "cursor-pointer" : "cursor-not-allowed"}`}>
          <input type="checkbox" checked={alsoLinkedIn && linkedInAvailable} disabled={!linkedInAvailable}
            onChange={(e) => setAlsoLinkedIn(e.target.checked)} className="w-4 h-4 accent-[#3A57E8] disabled:opacity-40" />
          <span className={`text-sm ${linkedInAvailable ? "text-gray-800" : "text-gray-400"}`}>LinkedIn</span>
        </label>
        <span className="text-xs text-gray-500 ml-auto">
          {!linkedInAvailable ? `${noLinkedInName} has no LinkedIn page`
            : alsoLinkedIn ? `LinkedIn page: ${linkedInPages.map((k) => (k === "world" ? "GooCampus World" : "GooCampus")).join(" · ")}` : ""}
        </span>
      </div>
      {videoCarousel && (
        <div className="text-xs text-[#F16A1B] mt-1">Facebook doesn&apos;t take carousels with video slides, so this goes to Instagram only.</div>
      )}
      {igOnlyPage && (
        <div className="text-xs text-[#8A92A6] mt-1">{igOnlyPage.label} is connected with Instagram only — it has no Facebook page, so this goes to Instagram only.</div>
      )}
      {tooBigForIg.length > 0 && (
        <div className="text-xs text-[#F16A1B] mt-1">Over 300 MB ({tooBigForIg.map((t) => fmtSize(t.size)).join(", ")}) — Instagram doesn&apos;t take videos that big from outside its app, so this goes to Facebook only.</div>
      )}
      {!toInstagram && !toFacebook && !(alsoLinkedIn && linkedInAvailable) && (
        <div className="text-xs text-[#C0392B] mt-1">Tick at least one, or this goes nowhere.</div>
      )}
      {cleanMediaUrls.length > 0 && (
        <div className="mt-2 text-xs space-y-1">
          {mixedMedia ? (<>
          <div className="flex gap-2">
            <span className="text-gray-500 w-[150px] shrink-0">Instagram</span>
            <span className={toInstagram ? "text-[#232D42]" : "text-gray-400"}>{toInstagram ? `${igMedia.length} video slide${igMedia.length === 1 ? "" : "s"}` : "not posting"}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-500 w-[150px] shrink-0">Facebook</span>
            <span className={toFacebook ? "text-[#232D42]" : "text-gray-400"}>{toFacebook ? `${fbMedia.length} picture${fbMedia.length === 1 ? "" : "s"} — Facebook can't take the video slides` : "not posting"}</span>
          </div>
          </>) : (
          <div className="flex gap-2">
            <span className="text-gray-500 w-[150px] shrink-0">{videoCarousel ? "Instagram only" : tooBigForIg.length ? "Facebook only" : "Instagram + Facebook"}</span>
            <span className={metaMediaUrls.length && (toInstagram || toFacebook) ? "text-[#232D42]" : "text-gray-400"}>
              {!toInstagram && !toFacebook ? "not posting"
                : videoCarousel ? `${metaMediaUrls.length} slides with video`
                : metaMediaUrls.length ? (singleVideoUrl ? "1 video" : `${metaMediaUrls.length} image${metaMediaUrls.length === 1 ? "" : "s"}`) : "nothing to post"}
            </span>
          </div>
          )}
          <div className="flex gap-2">
            <span className="text-gray-500 w-[150px] shrink-0">LinkedIn</span>
            {pdfUrls.length === 0 ? (
              <span className="text-gray-400">{alsoLinkedIn && metaMediaUrls.length ? "first image" : "nothing to post"}</span>
            ) : alsoLinkedIn ? (
              <span className="text-[#232D42]">{pdfName(pdfUrls[0])}</span>
            ) : (
              <span className="text-[#C0392B]">{pdfName(pdfUrls[0])} — not being posted. {linkedInAvailable
                    ? "LinkedIn is off."
                    : `${noLinkedInName} has no LinkedIn page: pick GooCampus or GooCampus World to post it there, or add images for Instagram/Facebook.`}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // Scheduled → the LinkedIn queue + cron; publish-now → the immediate route.
  // Sends the PDF when there is one, so the post lands as a document carousel.
  async function crossPostLinkedIn(scheduleTimeISO?: string): Promise<boolean> {
    // LinkedIn has no Stories — a Story with LinkedIn ticked used to go out there as
    // an ordinary feed post (27 Oct).
    if (!alsoLinkedIn || format === "story") return true;
    const liPages = linkedInPages;
    if (!liPages.length) return true;
    try {
      if (scheduleTimeISO) {
        const r = await fetch("/api/scheduler/linkedin", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
          body: JSON.stringify({ pages: liPages, text: caption, imageUrl: linkedInMediaUrl, scheduleTimeISO }),
        });
        return r.ok;
      }
      const rs = await Promise.all(liPages.map((page) => fetch("/api/scheduler/publish-linkedin", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ page, text: caption, imageUrl: linkedInMediaUrl }),
      })));
      return rs.every((r) => r.ok);
    } catch {
      return false;   // caller decides how loudly to fail
    }
  }

  async function doEnqueue(scheduleTimeISO?: string, asDraft?: boolean) {
    setSubmitting(true);
    setResult(null);
    try {
      // PDF-only → nothing for Meta to post. Skip the Meta queue and make
      // LinkedIn the whole post, so a failure there is reported, not swallowed
      // the way a best-effort cross-post is.
      if (linkedInOnly) {
        const ok = await crossPostLinkedIn(scheduleTimeISO);
        if (!ok) { setResult({ ok: false, error: "LinkedIn publish failed — the PDF was not posted." }); return; }
        setResult({ ok: true });
        resetComposer();
        loadToSchedule();
        setTimeout(loadQueue, 800);
        return;
      }
      // Supabase-native: write the post into the mh_posts publish queue. Updates the
      // Output-Ready task in place when scheduling one (schedulingTaskId), else inserts.
      const res = await fetch("/api/scheduler/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: schedulingTaskId || undefined,
          particulars: particulars.trim() || caption.trim().replace(/\s+/g, " ").slice(0, 60),
          publishTo,
          publishToPage,
          pages: composePages,
          collaborators: format === "story" ? [] : collab.split(",").map((s) => s.trim()).filter(Boolean),
          caption,
          mediaUrls: metaMediaUrls,
          format,
          sbu,
          coverUrl: format === "reel" ? coverUrl : "",
          channels: [toInstagram ? "instagram" : "", toFacebook ? "facebook" : ""].filter(Boolean),
          captionFb: splitCaption && toInstagram && toFacebook ? captionFb : "",
          draft: Boolean(asDraft),
          scheduleTimeISO,
          alsoStory: storyOffer && alsoStory,
        }),
      });
      const d = await res.json();
      if (!res.ok || d.error) {
        const block = gateFromResponse(res.status, d, particulars.trim() || "This post");
        if (block) setGate(block);
        else setResult({ ok: false, error: d.error || `HTTP ${res.status}` });
      } else {
        setResult({
          ok: true,
          recordId: d.id,
          draft: Boolean(asDraft),
          story: Boolean(d.story),
          whenLabel: !asDraft && scheduleTimeISO
            ? new Date(scheduleTimeISO).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
            : undefined,
        });
        if (!asDraft) await crossPostLinkedIn(scheduleTimeISO);
        resetComposer();
        loadToSchedule();               // the scheduled task leaves "To schedule"
        setTimeout(loadQueue, 800);
      }
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  // AI caption suggester — 3 variants from the topic + brand voice (Perplexity).
  async function fetchCaptionSuggestions() {
    setSuggestError(null);
    setSuggestLoading(true);
    try {
      const res = await fetch("/api/scheduler/suggest-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishToPage: composePages[0] || publishToPage, contentBrief: particulars, currentCaption: caption }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
      setSuggestions((d.variants || []) as SuggestVariant[]);
    } catch (e) {
      setSuggestError((e as Error).message);
    } finally {
      setSuggestLoading(false);
    }
  }

  const previewImage = cleanMediaUrls[0] || null;
  const previewHandle = pageInfo(publishToPage).handle.replace(/^@/, "") || "goocampus";
  const pageHandle = (p: string) => pageInfo(p).handle;
  const previewName = publishToPage === "12Plus / GC India" ? "12th Plus · GC India" : pageInfo(publishToPage).label;

  // Filter derived data for the queue view — computed here so we can also use it for
  // the status-counter strip.
  const queueFiltered = queue.filter((p) => {
    if (allowedPages && p.publishToPage && !allowedPages.includes(p.publishToPage)) return false;
    // The account dropdown lives on the Published tab and filters only its calendar
    // (publishedFiltered); it used to also thin these "To schedule" lists with no
    // filter showing there (28 Oct).
    if (filterInterest !== "all" && p.primaryInterest !== filterInterest) return false;
    if (filterStatus !== "all" && p.effectiveStatus !== filterStatus) return false;
    return true;
  });
  // True count of produced content still awaiting a schedule action (the API now
  // returns the full set, so this decrements by one each time a post is scheduled).
  const toScheduleTotal = toSchedule.length;
  // Publishing stays in this list (marked) until it lands under Published.
  const readyToSchedule = queueFiltered.filter((p) => p.effectiveStatus === "scheduled" || p.effectiveStatus === "publishing");
  const failed = queueFiltered.filter((p) => p.effectiveStatus === "failed");
  // Saved from Create post, not sent. A draft's own Story rides with it ("+ Story"),
  // so it isn't listed a second time.
  const drafts = queueFiltered
    .filter((p) => p.effectiveStatus === "draft" && !p.storyOf)
    .sort((a, b) => new Date(b.updatedAt || b.scheduleTime || 0).getTime() - new Date(a.updatedAt || a.scheduleTime || 0).getTime());
  const draftHasStory = (id: string) => queue.some((q) => q.storyOf === id && q.effectiveStatus === "draft");
  const publishedRecent = queueFiltered
    .filter((p) => p.effectiveStatus === "published")
    .sort((a, b) => new Date(b.publishedAt || b.scheduleTime || 0).getTime() - new Date(a.publishedAt || a.scheduleTime || 0).getTime())
    .slice(0, 20);
  // Populate filter dropdown options from the actual data so we don't hardcode.
  const availablePages = pageOptions.map((o) => o.value); // every page we post to, linked brands included
  const publishedFiltered = filterPage === "all" ? publishedIG : publishedIG.filter((p) => p.publishToPage === filterPage);
  const availableInterests = Array.from(new Set(queue.map((p) => p.primaryInterest).filter(Boolean))).sort();

  async function handleReschedule(recordId: string, iso: string) {
    setRowActionId(recordId);
    try {
      const r = await fetch("/api/scheduler/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId, scheduleTime: iso }),
      });
      const d = await r.json();
      if (!r.ok || d.error) alertDialog(`Reschedule failed: ${d.error || "HTTP " + r.status}`);
      else loadQueue();
    } finally { setRowActionId(null); }
  }
  // Asked in our own dialog — window.confirm draws Chrome's grey OS box, which
  // belongs to the browser, not to this dashboard.
  const [publishNowPost, setPublishNowPost] = useState<ScheduledPost | null>(null);
  async function handlePublishNow(recordId: string) {
    setPublishNowPost(null);
    setRowActionId(recordId);
    try {
      const r = await fetch("/api/scheduler/publish-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId }),
      });
      const d = await r.json();
      if (!r.ok || d.error) alertDialog(`Publish failed: ${d.error || "HTTP " + r.status}`);
      else loadQueue();
    } finally { setRowActionId(null); }
  }
  async function handleCancel(recordId: string) {
    setRowActionId(recordId);
    try {
      const r = await fetch("/api/scheduler/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId }),
      });
      const d = await r.json();
      if (!r.ok || d.error) alertDialog(`Delete failed: ${d.error || "HTTP " + r.status}`);
      else { loadQueue(); loadToSchedule(); }   // it drops back into the backlog
    } finally { setRowActionId(null); }
  }
  async function handleSaveCaption() {
    if (!editingCaptionId) return;
    setCaptionSaving(true);
    try {
      const r = await fetch("/api/scheduler/edit-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: editingCaptionId, caption: editingCaptionText }),
      });
      const d = await r.json();
      if (!r.ok || d.error) alertDialog(`Caption update failed: ${d.error || "HTTP " + r.status}`);
      else { setEditingCaptionId(null); setEditingCaptionText(""); loadQueue(); }
    } finally { setCaptionSaving(false); }
  }

  // ── Layout B (Praveen, 27 Oct): statuses | the posts in that status | the opened post ──
  const [paneSearch, setPaneSearch] = useState("");
  const [paneSel, setPaneSel] = useState<string | null>(null);   // the open queue post
  const paneMatches = (t: string) => !paneSearch.trim() || t.toLowerCase().includes(paneSearch.trim().toLowerCase());
  // A post's own "also as a Story" rides with it ("+ Story"), not as a second row.
  const hideCompanions = (l: ScheduledPost[]) => { const ids = new Set(l.map((p) => p.id)); return l.filter((p) => !(p.storyOf && ids.has(p.storyOf))); };
  const hasStory = (id: string) => queue.some((q) => q.storyOf === id);
  // A story of several files is queued as one row per frame — the first, then the
  // rest pointing back at it, a few seconds apart (lib/scheduler-enqueue syncFrames).
  // Put back together in that order so the preview plays every frame.
  const storyFramesOf = (p: ScheduledPost) => [
    ...(p.mediaUrls || []),
    ...queue.filter((q) => q.storyOf === p.id && q.format === "story")
      .sort((a, b) => dateMs(a.scheduleTime) - dateMs(b.scheduleTime))
      .flatMap((q) => q.mediaUrls || []),
  ];
  const rowIso = (p: ScheduledPost) => (p.effectiveStatus === "published" ? p.publishedAt : p.effectiveStatus === "draft" ? p.updatedAt : p.scheduleTime) || p.scheduleTime || p.publishedAt || null;
  const kindOf = (p: ScheduledPost) => (p.format === "reel" ? "Reel" : p.format === "story" ? "Story" : (p.mediaUrls?.length || 0) > 1 ? "Carousel" : (p.type || "Post"));
  const dateMs = (d: string | null) => (d ? new Date(d).getTime() : Number.POSITIVE_INFINITY);
  const readyList = [...toSchedule].filter((t) => paneMatches(t.title)).sort((a, b) => dateMs(a.publishingDate) - dateMs(b.publishingDate));
  const queueList: ScheduledPost[] =
    listFilter === "scheduled" ? hideCompanions(readyToSchedule).sort((a, b) => dateMs(a.scheduleTime) - dateMs(b.scheduleTime))
    : listFilter === "published" ? hideCompanions(publishedRecent)
    : listFilter === "failed" ? [...failed].sort((a, b) => dateMs(b.scheduleTime) - dateMs(a.scheduleTime))
    : listFilter === "drafts" ? drafts
    : [];
  const queueShown = queueList.filter((p) => paneMatches(p.particulars || ""));
  const openPost = queueShown.find((p) => p.id === paneSel) || null;
  const openTaskObj = toSchedule.find((t) => t.id === selectedTaskId) || null;
  const paneMeta = PANE_STATUSES.find((s) => s.key === listFilter) || PANE_STATUSES[0];
  const paneCount: Record<string, number | null> = {
    ready: toScheduleTotal, scheduled: hideCompanions(readyToSchedule).length, published: hideCompanions(publishedRecent).length,
    failed: failed.length, drafts: drafts.length, linkedin: null,
  };
  const paneShownCount = listFilter === "ready" ? readyList.length : queueShown.length;
  const paneSubtitle = `${paneShownCount} post${paneShownCount === 1 ? "" : "s"}${listFilter === "ready" || listFilter === "scheduled" ? " · soonest first" : listFilter === "published" ? " · latest first" : ""}`;
  // Open a ready task in the right pane (selectTask toggles, so never re-click the open one).
  const openTask = (t: ToScheduleItem) => { if (selectedTaskId !== t.id) selectTask(t); };
  const choosePane = (k: (typeof PANE_STATUSES)[number]["key"]) => { setListFilter(k); setPaneSearch(""); setPaneSel(null); };
  // Queue statuses open their first post; a ready task is only opened by a click (opening
  // one fills the composer, which would overwrite an unsent Create post).
  const queueKey = queueShown.map((p) => p.id).join(",");
  useEffect(() => {
    if (listFilter === "ready" || listFilter === "linkedin") return;
    if (!queueShown.length) { if (paneSel) setPaneSel(null); return; }
    if (!queueShown.some((p) => p.id === paneSel)) setPaneSel(queueShown[0].id);
  }, [listFilter, queueKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Copy link: /dashboard/preview/scheduler?post=<id> opens the Scheduler on that post,
  // in whichever list it's in now, so a teammate can be sent straight to it.
  const wantedPost = useRef<string | null>(typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("post"));
  useEffect(() => {
    const id = wantedPost.current;
    if (!id) return;
    const ready = toSchedule.find((t) => t.id === id);
    if (ready) { wantedPost.current = null; setListFilter("ready"); openTask(ready); return; }
    const k = readyToSchedule.some((p) => p.id === id) ? "scheduled" : publishedRecent.some((p) => p.id === id) ? "published"
      : failed.some((p) => p.id === id) ? "failed" : drafts.some((p) => p.id === id) ? "drafts" : null;
    if (k) { wantedPost.current = null; setListFilter(k); setPaneSearch(""); setPaneSel(id); }
  }, [toSchedule, queue]); // eslint-disable-line react-hooks/exhaustive-deps
  const copyPostLink = async (id: string) => {
    const url = `${window.location.origin}/dashboard/preview/scheduler?post=${encodeURIComponent(id)}`;
    try { await navigator.clipboard.writeText(url); showToast({ who: "Link copied", body: "Anyone on the team can open this post with it.", av: "✓" }); }
    catch { window.prompt("Copy this link:", url); }
  };
  const copyLinkBtn = (id: string) => (
    <button onClick={() => void copyPostLink(id)} title="Copy a link that opens this post"
      className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 text-[#232D42] hover:border-brand hover:text-brand inline-flex items-center gap-1"><IconLink size={14} stroke={1.8} />Copy link</button>
  );
  const stepPane = (d: number) => {
    if (listFilter === "ready") {
      const i = readyList.findIndex((t) => t.id === selectedTaskId);
      const n = readyList[i < 0 ? 0 : i + d]; if (n) openTask(n); return;
    }
    const i = queueShown.findIndex((p) => p.id === paneSel);
    const n = queueShown[i + d]; if (n) setPaneSel(n.id);
  };
  // ↑ / ↓ step through the list — not while typing, and not with a popup open.
  useEffect(() => {
    if (schedTab !== "to_schedule") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest && el.closest("input, textarea, select, [contenteditable='true']")) return;
      if (showCreateForm || calItem || publishNowPost || scheduleModalPost || deletePost) return;
      if (e.key === "ArrowDown") { e.preventDefault(); stepPane(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); stepPane(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => { document.querySelector(".sched-row.on")?.scrollIntoView({ block: "nearest" }); }, [paneSel, selectedTaskId]);
  const panePager = (i: number, n: number) => (n > 1 && i >= 0 ? (
    <div className="sched-pager" title="Previous / next — or press ↑ ↓">
      <button disabled={i <= 0} onClick={() => stepPane(-1)} aria-label="Previous">‹</button>
      <span>{i + 1} of {n}</span>
      <button disabled={i >= n - 1} onClick={() => stepPane(1)} aria-label="Next">›</button>
    </div>
  ) : null);
  // Take a failed post out of the queue and open its task to change the creative.
  async function fixCreative(p: ScheduledPost) {
    const r = await fetch("/api/scheduler/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordId: p.id, reason: "Fix creative — taken out to change the creative" }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); await alertDialog(`Couldn't take it out of the queue — ${(j as { error?: string }).error || "try again in a moment."}`); return; }
    window.location.href = `/dashboard/preview/marketing-hub?tab=master&open=${p.id}`;
  }

  return (
    <div>
      {schedTab === "to_schedule" && (
        <div className="sched-wrap">
          <style>{SPLIT_CSS}</style>
          <div className="flex items-center justify-end gap-2 mb-3">
            <button onClick={() => { loadToSchedule(); loadQueue(); }} className="text-xs font-medium bg-white text-gray-700 border border-gray-200 px-3 py-2 rounded-lg hover:border-gray-300">↻ Refresh</button>
            <button onClick={openManualComposer} className="text-xs font-medium bg-brand text-white px-4 py-2 rounded-lg hover:bg-brand-dark">+ Create post</button>
          </div>

          {/* Layout B (Praveen, 27 Oct): statuses | the posts in that status | the opened
              post — like My Day. Each pane scrolls on its own; widths follow the screen. */}
          <div className="sched-split">
            {/* 1 — statuses */}
            <aside className="sched-pane">
              <div className="sched-head sched-railhead"><div className="text-base font-medium text-[#232D42]">Status</div></div>
              <div className="sched-scroll sched-rail">
                {PANE_STATUSES.map((st) => {
                  const n = paneCount[st.key];
                  return (
                    <button key={st.key} onClick={() => choosePane(st.key)} title={`${st.name} — ${st.hint}`}
                      className={`sched-status${listFilter === st.key ? " on" : ""}`}
                      style={{ ["--tone" as string]: st.tone, ["--tint" as string]: st.tint } as CSSProperties}>
                      <span className="ic" style={{ background: st.tint, color: st.tone }}><st.Icon size={16} stroke={1.8} /></span>
                      <span className="nm">
                        <span className="n-full">{st.name}</span><span className="n-mid">{st.mid}</span><span className="n-short">{st.short}</span>
                        <span className="hint">{st.hint}</span>
                      </span>
                      {n !== null && <span className="ct">{n}</span>}
                    </button>
                  );
                })}
              </div>
            </aside>

            {listFilter === "linkedin" ? (
              <section className="sched-pane sched-wide"><div className="sched-scroll p-4"><LinkedInQueue /></div></section>
            ) : (<>
              {/* 2 — the posts in that status */}
              <section className="sched-pane">
                <div className="sched-head">
                  <div className="text-base font-medium text-[#232D42]">{paneMeta.name}</div>
                  <div className="text-xs text-[#8A92A6]">{paneSubtitle}</div>
                </div>
                <div className="sched-search">
                  <IconSearch size={15} stroke={1.8} className="text-[#8A92A6] flex-shrink-0" />
                  <input value={paneSearch} onChange={(e) => setPaneSearch(e.target.value)} placeholder="Search posts…" />
                </div>
                <div className="sched-scroll sched-list">
                  {listFilter === "ready" ? (
                    toScheduleLoading ? <LoadingBlock label="Loading produced content…" />
                    : readyList.length === 0 ? <div className="sched-empty">{paneSearch ? "Nothing matches that search." : "Nothing waiting — everything produced has been scheduled."}</div>
                    : (<>
                      {!paneSearch && (
                        <button className="sched-upnext" onClick={() => openTask(readyList[0])}>
                          <div className="lbl">Schedule next</div>
                          <div className="ttl">{readyList[0].title}</div>
                          <div className="cd">{dueText(readyList[0].publishingDate)}<small>{readyList[0].publishingDate ? ` · ${dayLabel2(readyList[0].publishingDate)}` : ""}</small></div>
                          {readyList[1] && <div className="then">Then: {readyList[1].title} — {readyList[1].publishingDate ? dayLabel2(readyList[1].publishingDate) : "no date"}</div>}
                        </button>
                      )}
                      {readyList.map((t, i) => {
                        const head = t.publishingDate ? dayLabel2(t.publishingDate) : "No publishing date";
                        const prev = i > 0 ? (readyList[i - 1].publishingDate ? dayLabel2(readyList[i - 1].publishingDate as string) : "No publishing date") : null;
                        return (
                          <div key={t.id}>
                            {head !== prev && <div className="sched-day">{head}</div>}
                            <button onClick={() => openTask(t)} className={`sched-row${selectedTaskId === t.id ? " on" : ""}`}>
                              <PaneThumb url={t.mediaUrls[0]} />
                              <span className="flex-1 min-w-0">
                                <span className="t">{i === 0 && !paneSearch && <span className="sched-badge">Do next</span>}{t.title}</span>
                                <span className="m">{pageHandle(t.defaultPage)}{t.type ? ` · ${t.type}` : ""}</span>
                              </span>
                              <span className="w"><span className="rel">{dueText(t.publishingDate)}</span></span>
                            </button>
                          </div>
                        );
                      })}
                    </>)
                  ) : (
                    queueLoading && !queueShown.length ? <LoadingBlock label="Loading the queue…" />
                    : queueShown.length === 0 ? <div className="sched-empty">{paneSearch ? "Nothing matches that search." : PANE_EMPTY[listFilter]}</div>
                    : (<>
                      {listFilter === "scheduled" && !paneSearch && (
                        <button className="sched-upnext" onClick={() => setPaneSel(queueShown[0].id)}>
                          <div className="lbl">Up next</div>
                          <div className="ttl">{queueShown[0].particulars || "Untitled"}</div>
                          <div className="cd"><RelTime iso={queueShown[0].scheduleTime} /><small> · {whenText(queueShown[0].scheduleTime)} · {pageHandle(queueShown[0].publishToPage)}</small></div>
                          {queueShown[1] && <div className="then">Then: {queueShown[1].particulars || "Untitled"} — {whenText(queueShown[1].scheduleTime)}</div>}
                        </button>
                      )}
                      {queueShown.map((p, i) => {
                        const iso = rowIso(p);
                        const head = iso ? dayLabel2(iso) : "";
                        const prevIso = i > 0 ? rowIso(queueShown[i - 1]) : null;
                        const prev = i > 0 ? (prevIso ? dayLabel2(prevIso) : "") : null;
                        const why = listFilter === "failed" ? explainFailure(p.failureReason) : null;
                        return (
                          <div key={p.id}>
                            {head !== prev && head && <div className="sched-day">{head}</div>}
                            <button onClick={() => setPaneSel(p.id)} className={`sched-row${p.id === paneSel ? " on" : ""}`}>
                              <PaneThumb url={p.thumbnailUrl} />
                              <span className="flex-1 min-w-0">
                                <span className="t">{i === 0 && listFilter === "scheduled" && !paneSearch && <span className="sched-badge">Next up</span>}{p.particulars || "Untitled"}</span>
                                <span className="m">{pageHandle(p.publishToPage)} · {kindOf(p)}{hasStory(p.id) && <span className="sched-mini">+ Story</span>}</span>
                                {why && <span className="why">Why: {why.why}</span>}
                              </span>
                              <span className="w">
                                {p.effectiveStatus === "publishing" ? <span className="text-blue-700">Publishing…</span>
                                  : listFilter === "failed" ? <><span className="text-rose-600">Failed</span><br />{whenText(iso)}</>
                                  : listFilter === "drafts" ? <>saved<br />{whenText(iso)}</>
                                  : whenText(iso)}
                                {listFilter === "scheduled" && p.effectiveStatus !== "publishing" && <RelTime iso={p.scheduleTime} className="rel" />}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </>)
                  )}
                </div>
              </section>

              {/* 3 — the opened post */}
              <section className="sched-pane sched-detail">
                {listFilter === "ready" ? (
                  openTaskObj ? (<>
                    <div className="sched-dhead">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="sched-chip" style={{ background: PANE_STATUSES[0].tint, color: PANE_STATUSES[0].tone }}><IconClock size={13} stroke={1.8} />Ready to schedule</span>
                          {openTaskObj.type && <span className="sched-chip brand">{openTaskObj.type}</span>}
                          <span className="sched-chip">{openTaskObj.publishingDate ? `Publishing date · ${dayLabel2(openTaskObj.publishingDate)}` : "No publishing date"}</span>
                        </div>
                        <div className="sched-dtitle">{openTaskObj.title}</div>
                      </div>
                      <div className="sched-acts">
                        {panePager(readyList.findIndex((x) => x.id === openTaskObj.id), readyList.length)}
                        {copyLinkBtn(openTaskObj.id)}
                        <button onClick={() => sendBackToReview(openTaskObj)} title="Take it out of the Scheduler and send it back to Content Review"
                          className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-brand/40 text-brand hover:bg-brand-light/40 inline-flex items-center gap-1"><IconArrowBackUp size={14} stroke={1.8} />Send back</button>
                        <button onClick={() => deleteToSchedule(openTaskObj)} title="Delete it — it goes to the recycle bin"
                          className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 inline-flex items-center gap-1"><IconTrash size={14} stroke={1.8} />Delete</button>
                      </div>
                    </div>
                    <div className="sched-scroll" key={openTaskObj.id}>
                      <div className="sched-ready">
                        <div className="space-y-3 min-w-0">
                          <div>
                            <label className="text-xs uppercase tracking-wide text-gray-500 font-medium">Post name</label>
                            <input value={particulars} onChange={(e) => setParticulars(e.target.value)} className="w-full mt-1 text-sm text-gray-900 rounded-lg border border-gray-200 px-3 py-2" />
                          </div>
                          <div>
                            <label className="text-xs uppercase tracking-wide text-gray-500 font-medium">Post to</label>
                            <div className="mt-1"><PageCheckboxes value={composePages} onChange={setComposePages} allowed={allowedPages} /></div>
                            <div className="mt-2">{channelTicks}</div>
                          </div>
                          <div>
                            <label className="text-xs uppercase tracking-wide text-gray-500 font-medium">Collaborator</label>
                            <div className="mt-1"><CollaboratorField value={collab} onChange={setCollab} /></div>
                          </div>
                          <div>
                            <label className="text-xs uppercase tracking-wide text-gray-500 font-medium">Creatives</label>
                            <div className="mt-1"><MediaUploader mediaUrls={mediaUrls} setMediaUrls={setMediaUrls} taskId={schedulingTaskId} /></div>
                          </div>
                          {/* Same Format choice as the modal. This row is how produced work
                              actually gets scheduled, so leaving it out here meant a story
                              could only be scheduled by starting again from Create post. */}
                          <div>
                            <label className="text-xs uppercase tracking-wide text-gray-500 font-medium">Format</label>
                            <div className="mt-1 inline-flex rounded-lg border border-gray-200 overflow-hidden">
                              {ALL_FORMATS.map((f, fi) => {
                                const ok = formatChoices.includes(f);
                                return (
                                  <button key={f} type="button" disabled={!ok} onClick={() => chooseFormat(f)}
                                    title={ok ? undefined : FORMAT_WHY_NOT[f]}
                                    className={`px-3 py-1.5 text-[12px] ${fi > 0 ? "border-l border-gray-200" : ""} ${
                                      !ok ? "text-[#C2C6D0] bg-[#FAFBFC] cursor-not-allowed"
                                        : format === f ? "bg-brand text-white" : "text-[#4A5468] hover:bg-[#F6F7FB]"}`}>
                                    {f === "post" ? "Post" : f === "reel" ? "Reel" : "Story"}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="text-xs text-gray-400 mt-1">{formatChoices.length ? FORMAT_NOTE[format] : FORMAT_BLOCKED}</div>
                            {storyTick}
                            {/* The reel's cover, here too — it was only in the modal, so a reel
                                scheduled from this list never asked for one (Praveen, 4 Nov 2026). */}
                            {format === "reel" && singleVideoUrl && (
                              <div className="mt-3">
                                <label className="text-xs uppercase tracking-wide text-gray-500 font-medium">Thumbnail</label>
                                <div className="mt-1"><ReelThumbnail videoUrl={singleVideoUrl} coverUrl={coverUrl} onCover={setCoverUrl} /></div>
                              </div>
                            )}
                          </div>
                          <div>
                            <label className="text-xs uppercase tracking-wide text-gray-500 font-medium">Caption</label>
                            <CaptionField value={caption} onChange={setCaption} placeholder="Write your caption…" className="w-full mt-1 text-sm text-gray-900 rounded-lg border border-gray-200 px-3 py-2 font-sans" />
                            <div className="text-right text-xs text-gray-400 mt-0.5">{caption.length} / 2200</div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-700">{scheduleEnabled ? "Publish at the time below" : "Publish now"}</span>
                            <button onClick={() => setScheduleEnabled(!scheduleEnabled)} className={`relative inline-flex items-center h-5 rounded-full w-9 transition ${scheduleEnabled ? "bg-brand" : "bg-gray-200"}`} aria-label="Toggle schedule">
                              <span className={`inline-block w-4 h-4 transform bg-white rounded-full shadow transition ${scheduleEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
                            </button>
                          </div>
                          {scheduleEnabled && (
                            <div className="space-y-2">
                              <div className="flex gap-2">
                                <PreviewDatePicker value={scheduleDate} onChange={setScheduleDate} />
                                <TimePicker value={scheduleTime} onChange={setScheduleTime} />
                              </div>
                              {/* Friendly, unambiguous confirmation of the exact date it'll go out */}
                              {(() => {
                                if (!scheduleDate || !scheduleTime) return null;
                                const dt = new Date(`${scheduleDate}T${scheduleTime}`);
                                if (Number.isNaN(dt.getTime())) return null;
                                const label = fmtDateTime(dt.toISOString());
                                return <div className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5"><IconCalendarEvent size={14} stroke={1.8} className="inline -mt-0.5 mr-1" />Goes out <span className="font-medium">{label}</span></div>;
                              })()}
                              {timeSuggestions.length > 0 && (
                                <div>
                                  <div className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-1.5"><IconSparkles size={13} stroke={1.8} className="inline -mt-0.5 mr-1" />Best time to post — when your audience is most online</div>
                                  <div className="flex flex-wrap gap-2">
                                    {timeSuggestions.map((s, i) => {
                                      const d = new Date(s.nextOccurrenceISO);
                                      const dateLbl = Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
                                      return (
                                        <button key={i} type="button" onClick={() => applyTimeSuggestion(s)}
                                          className="text-xs bg-brand-light hover:bg-brand-light border border-brand/30 text-brand rounded-lg px-2.5 py-1.5 transition"
                                          title={`Scheduled for ${s.weekdayLabel} ${dateLbl} at ${s.hourLabel} — ${s.followersOnline.toLocaleString("en-IN")} followers typically online`}>
                                          <span className="font-semibold">{s.weekdayLabel} {dateLbl} · {s.hourLabel}</span>
                                          <span className="text-brand ml-1">· {s.followersOnline.toLocaleString("en-IN")} online</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          {tooBigForIg.length > 0 && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 leading-relaxed">
                              <b className="font-medium">Facebook only:</b> {tooBigForIg.map((t) => `${t.name} is ${fmtSize(t.size)}`).join(", ")}. Instagram takes videos up to 300 MB from outside its app, so this goes to Facebook.
                            </div>
                          )}
                          <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                            <span className="text-xs">
                              {result?.ok === true ? <span className="text-green-700">✓ Scheduled — moved to the queue.</span>
                                : result?.ok === false ? <span className="text-red-700">✗ {result.error}</span>
                                : <span className="text-gray-500">to <b className="text-gray-700">{pageHandle(publishToPage)}</b></span>}
                            </span>
                            <button onClick={submit} disabled={submitting} className="text-xs font-medium bg-brand text-white px-4 py-2 rounded-lg hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed">
                              {submitting ? "Sending…" : scheduleEnabled ? "Schedule →" : "Publish →"}
                            </button>
                          </div>
                        </div>
                        <div className="min-w-0">
                          <PreviewHeader platform={previewPlatform} onPlatform={setPreviewPlatform} device={previewDevice} onDevice={setPreviewDevice} />
                          <SocialPreview platform={previewPlatform} handle={previewHandle} name={previewName} images={previewPlatform === "linkedin" ? (pdfUrls.length ? pdfUrls : metaMediaUrls) : format === "story" ? metaMediaUrls : previewPlatform === "facebook" ? fbMedia : igMedia} caption={caption} device={previewDevice} story={format === "story"} />
                        </div>
                      </div>
                    </div>
                  </>) : (
                    <PanePlaceholder text={readyList.length ? "Pick a post — or start with the one under “Schedule next”." : "Nothing to schedule right now."} />
                  )
                ) : openPost ? (<>
                  <div className="sched-dhead">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="sched-chip" style={{ background: paneMeta.tint, color: paneMeta.tone }}><paneMeta.Icon size={13} stroke={1.8} />{openPost.effectiveStatus === "publishing" ? "Publishing…" : paneMeta.name}</span>
                        <span className="sched-chip brand">{kindOf(openPost)}</span>
                        {hasStory(openPost.id) && <span className="sched-chip brand">+ Story</span>}
                        <span className="sched-chip">{pageHandle(openPost.publishToPage)}</span>
                      </div>
                      <div className="sched-dtitle">{openPost.particulars || "Untitled"}</div>
                    </div>
                    <div className="sched-acts">
                      {panePager(queueShown.findIndex((x) => x.id === openPost.id), queueShown.length)}
                      {copyLinkBtn(openPost.id)}
                      {openPost.effectiveStatus === "publishing" ? <span className="text-xs text-gray-500">Can&apos;t be changed now</span>
                      : listFilter === "drafts" ? (<>
                        <button onClick={() => openDraft(openPost)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-dark">Open in Create post</button>
                        <button onClick={() => void discardDraft(openPost)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50">Delete</button>
                      </>) : listFilter === "published" ? null : (<>
                        {listFilter === "failed" && (
                          <button onClick={() => void fixCreative(openPost)} title="Take it out of the queue and open the task to change the creative"
                            className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-dark">Fix creative →</button>
                        )}
                        <button onClick={() => setPublishNowPost(openPost)}
                          className={`text-xs font-medium px-2.5 py-1.5 rounded-lg ${listFilter === "failed" ? "border border-brand/40 text-brand hover:bg-brand-light/40" : "bg-brand text-white hover:bg-brand-dark"}`}>{listFilter === "failed" ? "Try again" : "Publish now"}</button>
                        <button onClick={() => setScheduleModalPost(openPost)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-brand/40 text-brand hover:bg-brand-light/40">Reschedule</button>
                        <button onClick={() => setDeletePost(openPost)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50">Delete</button>
                      </>)}
                    </div>
                  </div>
                  <div className="sched-scroll" key={openPost.id}>
                    <PostPreviewContent key={openPost.id} item={{ kind: "scheduled", whenMs: new Date(rowIso(openPost) || 0).getTime(), post: openPost }}
                      story={openPost.format === "story" ? { frames: storyFramesOf(openPost), handle: pageHandle(openPost.publishToPage) } : undefined} />
                    {(() => {
                      const i = queueShown.findIndex((x) => x.id === openPost.id);
                      const nx = listFilter === "scheduled" ? queueShown[i + 1] : undefined;
                      if (!nx) return null;
                      return (
                        <div className="px-5 pb-5">
                          <button onClick={() => setPaneSel(nx.id)} className="sched-after">
                            <PaneThumb url={nx.thumbnailUrl} />
                            <span className="flex-1 min-w-0 text-left"><span className="text-xs text-[#8A92A6]">After this</span><br /><span className="text-sm font-medium text-[#232D42]">{nx.particulars || "Untitled"}</span></span>
                            <span className="text-xs text-[#4A5468] text-right whitespace-nowrap">{whenText(nx.scheduleTime)}<br /><RelTime iso={nx.scheduleTime} className="text-brand" /></span>
                            <IconChevronRight size={16} stroke={2} className="text-[#C2C6D0]" />
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                </>) : (
                  <PanePlaceholder text="Pick a post — its preview, caption, time and actions open here." />
                )}
              </section>
            </>)}
          </div>
        </div>
      )}

      {schedTab === "publish" && (<>
      {/* Header — queue actions strip */}
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <div className="text-base font-medium text-[#232D42]">Published</div>
          <div className="text-[12px] text-gray-500">
            Everything that&apos;s gone live — click a post to open it. Scheduled posts live on the “To schedule” tab.
            {queueError && <span className="ml-2 text-rose-600">· Couldn&apos;t load the queue: {queueError}</span>}
          </div>
        </div>
        <LiveIndicator fetchedAt={queueFetchedAt} latencyMs={queueLatency} loading={queueLoading} onRefresh={() => loadQueue()} error={queueError} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        <span className="text-gray-500 uppercase tracking-wide font-medium mr-1">Filter:</span>
        <PreviewSelect value={filterPage} onChange={setFilterPage}
          options={[{ value: "all", label: "All accounts" }, ...availablePages.map((p) => ({ value: p, label: p }))]} />
        {filterPage !== "all" && (
          <button onClick={() => setFilterPage("all")}
            className="text-gray-500 hover:text-gray-800 underline">clear</button>
        )}
      </div>

      {/* Published-only calendar — the archive of what actually went live. Scheduled /
          publishing / failed posts live on the "To schedule" tab's status filters, so
          they're intentionally NOT shown here (no repetition). */}
      <MiniPlanner posts={[]} publishedIG={publishedFiltered} wide onSelect={setCalItem} />

      </>)}

      {schedTab === "top" && (
        <div>
          <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
            <div>
              <div className="text-base font-medium text-[#232D42]">Top performers</div>
              <div className="text-[12px] text-gray-500">Your best posts by reach (last 90 days) — click one to reschedule it.</div>
            </div>
            <PreviewSelect value={topAccount} onChange={setTopAccount}
              options={[{ value: "all", label: "All accounts" }, ...pageOptions.map((o) => ({ value: o.value, label: o.label }))]} />
          </div>

          {topLoading && <div className="bg-white rounded-lg border border-gray-100"><LoadingBlock label="Loading top performers…" /></div>}
          {!topLoading && topPerformers.length === 0 && (
            <div className="bg-white rounded-lg border border-gray-100 px-5 py-12 text-center text-sm text-gray-500">No posts found for this account in the last 90 days.</div>
          )}
          {!topLoading && topPerformers.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {topPerformers.map((p, i) => {
                const handle = pageInfo(p.publishToPage).handle || "@goocampus";
                const fmt = (n: number) => n >= 100000 ? `${(n / 100000).toFixed(1)}L` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
                return (
                  <button key={`${p.publishToPage}-${p.id}`} type="button" onClick={() => rescheduleTopPerformer(p)}
                    title={p.caption || "(no caption)"}
                    className="group text-left bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-brand hover:shadow-md transition">
                    <div className="relative aspect-[4/5] bg-gray-100">
                      <CreativeThumb thumbnailUrl={p.thumbnail} type={p.mediaType} title={p.caption} seed={p.id} fit="contain" />
                      <div className="absolute top-1.5 left-1.5 text-xs font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded-full">#{i + 1}</div>
                      {p.mediaType === "CAROUSEL_ALBUM" && <div className="absolute top-1.5 right-1.5 text-white/90">▦</div>}
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 flex items-center gap-2 text-xs text-white">
                        <span>{fmt(p.reach)} reach</span><span>{fmt(p.likes)} ♥</span>
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/20 transition">
                        <span className="text-xs font-medium bg-white text-brand px-2.5 py-1 rounded-lg shadow">Reschedule →</span>
                      </div>
                    </div>
                    <div className="px-2 py-1.5 flex items-center justify-between text-xs text-gray-500">
                      <span className="truncate">{handle}</span>
                      <span className="flex-shrink-0 ml-1">{fmtDateShort(p.timestamp)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Schedule-now modal */}
      {scheduleModalPost && (
        <ScheduleNowModal
          post={scheduleModalPost}
          onClose={() => setScheduleModalPost(null)}
          onConfirm={async (iso, pages) => {
            const post = scheduleModalPost;
            const commit = async () => {
              // Single page → update the row in place. Multiple pages → cross-post
              // (updates original + duplicates once per additional page).
              if (pages.length <= 1) {
                await handleReschedule(post.id, iso);
              } else {
                setRowActionId(post.id);
                try {
                  const r = await fetch("/api/scheduler/schedule-multi", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ recordId: post.id, scheduleTime: iso, pages }),
                  });
                  const d = await r.json();
                  if (!r.ok || d.error) alertDialog(`Cross-post failed: ${d.error || "HTTP " + r.status}`);
                  else loadQueue();
                } finally { setRowActionId(null); }
              }
              setScheduleModalPost(null);
            };
            // Over-posting guard — check the primary account for that day (exclude self).
            const primary = pages[0] || post.publishToPage;
            const existing = postsOnDay(iso, primary, post.id);
            const limit = maxPostsPerDay(primary);
            if (existing.length >= limit) {
              setCapWarn({
                dateLabel: dayLabel(iso), page: primary, limit, existing,
                onProceed: async () => { setCapWarn(null); await commit(); },
                onPickAnother: () => setCapWarn(null), // leaves the picker open to choose again
              });
              return;
            }
            await commit();
          }}
        />
      )}

      {/* Completeness gate — what's still missing before this can go into the queue */}
      {gate && <MissingFieldsModal {...gate} onClose={() => setGate(null)} />}

      {/* Over-posting warning — a day already hit the account's daily max */}
      {gapWarn && (
        <Overlay onClose={() => setGapWarn(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ boxShadow: "0 24px 60px rgba(35,45,66,.24)" }}
            className="mt-[14vh] w-full max-w-[520px] bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 text-center">
              <h3 className="text-[15px] font-medium text-[#232D42]">
                {gapWarn.minutes === 0 ? "Another post is already at that time" : `Only ${gapWarn.minutes} minutes apart`}
              </h3>
              <p className="mt-2 text-[12.5px] leading-relaxed text-[#4A5468]">
                <b className="font-medium">{pageLabel(gapWarn.page)}</b> already has
                {" "}<b className="font-medium">&ldquo;{gapWarn.other.particulars || "a post"}&rdquo;</b> at {gapWarn.whenLabel}.
              </p>
              <p className="mt-2.5 text-[11.5px] leading-relaxed text-[#8A92A6]">
                Two posts close together split the same audience — the second competes with the first
                for its opening hour and pushes it down the feed. {gapWarn.gap} minutes apart is the
                spacing set for this account.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 px-5 py-4 flex-wrap">
              <button onClick={gapWarn.onMove}
                className="text-[13px] font-medium bg-brand text-white rounded-lg px-4 py-2 hover:bg-brand-dark">
                Move to {gapWarn.suggestedLabel}
              </button>
              <button onClick={gapWarn.onProceed}
                className="text-[13px] font-medium text-[#4A5468] border border-gray-200 rounded-lg px-4 py-2 hover:border-brand hover:text-brand">
                Schedule anyway
              </button>
              {/* A third option is a third button. As grey text on its own line it
                  read as a footnote, and half the choice was invisible. */}
              <button onClick={() => setGapWarn(null)}
                className="text-[13px] font-medium text-[#4A5468] border border-gray-200 rounded-lg px-4 py-2 hover:border-brand hover:text-brand">
                Pick another time
              </button>
            </div>
          </div>
        </Overlay>
      )}

      {capWarn && (
        <DayCapWarningModal
          dateLabel={capWarn.dateLabel}
          page={capWarn.page}
          limit={capWarn.limit}
          existing={capWarn.existing}
          pageHandle={pageHandle}
          onProceed={capWarn.onProceed}
          onPickAnother={capWarn.onPickAnother}
        />
      )}

      {/* Delete / reschedule confirm popup */}
      {deletePost && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDeletePost(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-medium text-[#232D42]">Remove this post from the schedule?</div>
            <div className="text-[13px] text-gray-500 mt-1">
              <span className="font-medium text-gray-700">{deletePost.particulars || "Untitled"}</span> — {pageHandle(deletePost.publishToPage)}.
              Deleting takes it off the schedule and returns it to “Ready to schedule” (nothing is permanently lost). Or reschedule it to a new time.
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setDeletePost(null)}
                className="text-xs font-medium px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => { const p = deletePost; setDeletePost(null); setScheduleModalPost(p); }}
                className="text-xs font-medium px-3 py-2 rounded-lg border border-brand/40 text-brand hover:bg-brand-light/40">Reschedule</button>
              <button onClick={() => { const id = deletePost.id; setDeletePost(null); handleCancel(id); }}
                className="text-xs font-semibold px-3 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Big full-screen view of a scheduled / published post */}
      {calItem && <SchedulePreviewModal item={calItem} onClose={() => setCalItem(null)} />}

      {publishNowPost && (
        <Overlay onClose={() => setPublishNowPost(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ boxShadow: "0 24px 60px rgba(35,45,66,.24)" }}
            className="mt-[16vh] w-full max-w-[440px] bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 text-center">
              <h3 className="text-[15px] font-medium text-[#232D42]">Publish this now?</h3>
              <p className="mt-2 text-[12.5px] leading-relaxed text-[#4A5468]">
                <b className="font-medium">{publishNowPost.particulars || "This post"}</b> goes out at the publisher&apos;s
                next check — within a minute — instead of at the time it was scheduled for.
              </p>
              <p className="mt-2.5 text-[11.5px] leading-relaxed text-[#8A92A6]">
                Once it is live it can only be removed from Instagram or Facebook themselves.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 px-5 py-4">
              <button onClick={() => handlePublishNow(publishNowPost.id)}
                className="text-[13px] font-medium bg-brand text-white rounded-lg px-4 py-2 hover:bg-brand-dark">
                Publish it now
              </button>
              <button onClick={() => setPublishNowPost(null)}
                className="text-[13px] text-[#8A92A6] hover:text-[#232D42] px-2">Cancel</button>
            </div>
          </div>
        </Overlay>
      )}


      {/* Caption-edit modal */}
      {editingCaptionId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setEditingCaptionId(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold">Edit caption</div>
              <button onClick={() => setEditingCaptionId(null)} className="text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>
            </div>
            <textarea
              value={editingCaptionText}
              onChange={(e) => setEditingCaptionText(e.target.value)}
              rows={12}
              className="w-full text-sm text-gray-900 rounded-lg border border-gray-200 px-3 py-2 font-sans"
            />
            <div className="flex items-center justify-between mt-3">
              <div className="text-xs text-gray-500">{editingCaptionText.length} / 2200 characters</div>
              <div className="flex gap-2">
                <button onClick={() => setEditingCaptionId(null)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200">
                  Cancel
                </button>
                <button onClick={handleSaveCaption} disabled={captionSaving}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium ${captionSaving ? "bg-gray-200 text-gray-500" : "bg-brand text-white hover:bg-brand-dark"}`}>
                  {captionSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CREATE-POST FORM MODAL ─────────────────────────────────────────
          The whole existing create-post form (media uploader / AI suggester /
          reach prediction / smart time / brand picker / etc.) lives in here
          — nothing was dropped, just moved out of the primary view. */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/60 z-40 overflow-y-auto"
          onClick={() => setShowCreateForm(false)}>
          <div className="min-h-screen py-6 px-4" onClick={(e) => e.stopPropagation()}>
            <div className="max-w-6xl mx-auto bg-white rounded shadow-xl p-4 flex flex-col max-h-[calc(100vh-48px)]">
              <div className="flex items-center justify-between mb-4">
                <div className="sched-heading text-[20px] leading-6 text-[#232D42]">Create post</div>
                <button onClick={() => setShowCreateForm(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
              </div>

      {/* TWO-COLUMN LAYOUT: form left, preview right.
          The form scrolls on its own so the action bar below can stay put, which is
          how Meta's composer behaves — Publish is never below the fold. */}
      <div className="flex gap-6 min-h-0 flex-1 overflow-y-auto pr-1">
        {/* LEFT — form, 600px to Meta's 600 */}
        <div className="w-[600px] shrink-0 space-y-4 pb-1">
          <Card title="Post to" subtitle="Tick one or more brand pages to publish to.">
            <PageCheckboxes value={composePages} onChange={setComposePages} allowed={allowedPages} />
            <div className="mt-2.5 pt-2.5 border-t border-gray-100">{channelTicks}</div>
          </Card>

          {format !== "story" && (
            <Card title="Collaborator" subtitle="Add a collaborator to your post and they will automatically be invited.">
              <CollaboratorField value={collab} onChange={setCollab} />
            </Card>
          )}

          <Card title="Media" subtitle={mediaLocked ? "Reposting the original creatives — locked. Only the caption is editable." : "Drop your files here. Images go to Instagram & Facebook, a PDF goes to LinkedIn as a carousel."}>
            <MediaUploader mediaUrls={mediaUrls} setMediaUrls={setMediaUrls} locked={mediaLocked} taskId={schedulingTaskId} />
          </Card>

          {/* Always on screen, with whatever this creative cannot be greyed out and a
              line saying why. It used to appear only once exactly one file was
              attached, so anyone who opened Create post to schedule a story saw no
              Format control at all and concluded stories were not supported
              ("schedule story as well" — Maheen, 22 Sep). Offering "Reel" beside four
              files is still a choice that cannot be honoured — hence disabled, not hidden. */}
          <Card title="Format" subtitle={formatChoices.length ? FORMAT_NOTE[format] : FORMAT_BLOCKED}>
            <div className="space-y-3">
              <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                {ALL_FORMATS.map((f, i) => {
                  const ok = formatChoices.includes(f);
                  return (
                    <button key={f} type="button" disabled={!ok} onClick={() => chooseFormat(f)}
                      title={ok ? undefined : FORMAT_WHY_NOT[f]}
                      className={`px-3.5 py-1.5 text-[12.5px] ${i > 0 ? "border-l border-gray-200" : ""} ${
                        !ok ? "text-[#C2C6D0] bg-[#FAFBFC] cursor-not-allowed"
                          : format === f ? "bg-brand text-white" : "text-[#4A5468] hover:bg-[#F6F7FB]"}`}>
                      {f === "post" ? "Post" : f === "reel" ? "Reel" : "Story"}
                    </button>
                  );
                })}
              </div>
              {storyTick}
              {format === "reel" && singleVideoUrl && (
                <div className="pt-1 border-t border-gray-100">
                  <div className="text-xs uppercase tracking-wide text-gray-500 font-medium mt-3 mb-2">Thumbnail</div>
                  <ReelThumbnail videoUrl={singleVideoUrl} coverUrl={coverUrl} onCover={setCoverUrl} />
                </div>
              )}
              {format === "story" && (
                <div className="pt-3 border-t border-gray-100 text-[12px] leading-snug text-[#8A92A6]">
                  Stories go out through the API, which posts the creative and nothing
                  else — no stickers, no link, no poll, no music, and no collaborator.
                  Anything you want on the story has to be burned into the file.
                  It disappears after 24 hours.
                </div>
              )}
            </div>
          </Card>

          <Card title="Caption">
            <div className="space-y-3">
              <div>
                <label className="text-xs uppercase tracking-wide text-gray-500 font-medium">What&apos;s this post about?</label>
                <input
                  value={particulars}
                  onChange={(e) => setParticulars(e.target.value)}
                  placeholder="e.g. NEET PG 2026 cutoff trends — key dates & what changed"
                  className="w-full mt-1 mb-2 text-sm text-gray-900 rounded-lg border border-gray-200 px-3 py-2"
                />
                <div className="mb-2">
                  <label className="text-xs uppercase tracking-wide text-gray-500 font-medium">Primary Interest / SBU</label>
                  <div className="mt-1">
                    <PreviewSelect className="w-full justify-between" value={sbu} onChange={setSbu}
                      placeholder="Which Primary Interest is this for?"
                      options={sbus.map((o) => ({ value: o, label: o }))} />
                  </div>
                </div>
                <CaptionField value={caption} onChange={setCaption} placeholder="Write your caption…" className="w-full text-sm text-gray-900 rounded-lg border border-gray-200 px-3 py-2 font-sans" />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>We&apos;ll split this into Instagram / Facebook versions and strip markdown automatically.</span>
                  <span>{caption.length} / 2200</span>
                </div>

                {/* Meta's "Customize post for Facebook and Instagram", same idea:
                    one caption until you say otherwise. */}
                {toInstagram && toFacebook && (
                  <label className="flex items-center gap-2 cursor-pointer mt-2">
                    <input type="checkbox" checked={splitCaption}
                      onChange={(e) => { setSplitCaption(e.target.checked); if (e.target.checked && !captionFb) setCaptionFb(caption); }}
                      className="w-4 h-4 accent-[#3A57E8]" />
                    <span className="text-xs text-gray-700">Write a different caption for Facebook</span>
                  </label>
                )}
                {splitCaption && toInstagram && toFacebook && (
                  <div className="mt-2">
                    <label className="text-xs uppercase tracking-wide text-gray-500 font-medium">Facebook caption</label>
                    <CaptionField value={captionFb} onChange={setCaptionFb} placeholder="Facebook version…"
                      className="w-full mt-1 text-sm text-gray-900 rounded-lg border border-gray-200 px-3 py-2 font-sans" />
                    <div className="text-xs text-gray-400 mt-1">The box above is the Instagram one.</div>
                  </div>
                )}

                {/* AI caption suggester — 3 variants from the topic above */}
                <AISuggestBar
                  brand={composePages[0] || publishToPage}
                  contentBrief={particulars}
                  caption={caption}
                  suggestions={suggestions}
                  loading={suggestLoading}
                  error={suggestError}
                  onFetch={fetchCaptionSuggestions}
                  onUse={(v) => {
                    const tags = v.hashtags && v.hashtags.length ? "\n\n" + v.hashtags.map((h) => (h.startsWith("#") ? h : "#" + h)).join(" ") : "";
                    setCaption(v.caption + tags);
                    setSuggestions(null);
                  }}
                  onDismiss={() => setSuggestions(null)}
                />

                {/* Facebook's own numbers, whenever Facebook is one of the targets. */}
                {toFacebook && fbBaseline && <FacebookBaselinePanel b={fbBaseline} />}

                {/* Existing reach-prediction overlay (as-you-type) */}
                {caption.trim().length > 0 && (
                  <PredictionPanel
                    loading={predictionLoading}
                    prediction={prediction}
                    onAddHashtag={(tag) => setCaption((c) => c.trimEnd() + " #" + tag)}
                  />
                )}
              </div>
            </div>
          </Card>

          <Card title="Schedule">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-700">
                {scheduleEnabled ? "Publish at the time below" : "Publish now"}
              </span>
              <button
                onClick={() => setScheduleEnabled(!scheduleEnabled)}
                className={`relative inline-flex items-center h-5 rounded-full w-9 transition ${scheduleEnabled ? "bg-brand" : "bg-gray-200"}`}
                aria-label="Toggle schedule"
              >
                <span className={`inline-block w-4 h-4 transform bg-white rounded-full shadow transition ${scheduleEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>
            {scheduleEnabled && (
              <>
                <div className="flex gap-2">
                  <PreviewDatePicker value={scheduleDate} onChange={setScheduleDate} />
                  <TimePicker value={scheduleTime} onChange={setScheduleTime} />
                </div>

                {/* Smart time suggestions */}
                {timeSuggestions.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-1.5"><IconSparkles size={13} stroke={1.8} className="inline -mt-0.5 mr-1" />Smart suggestions — when your audience is most online</div>
                    <div className="flex flex-wrap gap-2">
                      {/* The same "best time" is best for every post that day, so the
                          suggester was funnelling posts into one slot. A taken slot
                          still shows — greyed, and saying why — rather than vanishing
                          and leaving someone wondering where their best hour went. */}
                      {timeSuggestions.map((s, i) => {
                        const taken = tooCloseTo(s.nextOccurrenceISO, publishToPage, schedulingTaskId || undefined);
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => applyTimeSuggestion(s)}
                            className={`text-xs rounded-lg px-3 py-1.5 border transition ${taken
                              ? "bg-[#F6F7FB] border-gray-200 text-[#A6ACBE]"
                              : "bg-brand-light hover:bg-brand-light border-brand/30 text-brand"}`}
                            title={taken
                              ? `${s.weekdayLabel} ${s.hourLabel} is ${taken.minutes} min from "${taken.post.particulars || "another post"}" on this account`
                              : `Next ${s.weekdayLabel} at ${s.hourLabel} — ${s.followersOnline.toLocaleString("en-IN")} followers typically online`}
                          >
                            <span className="font-semibold">{s.weekdayLabel} {s.hourLabel}</span>
                            {taken
                              ? <span className="ml-1">· already booked</span>
                              : <span className="text-brand ml-1">· {s.followersOnline.toLocaleString("en-IN")} online</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        {/* RIGHT — live preview with an Instagram / Facebook / LinkedIn switcher */}
        <div className="flex-1 min-w-0">
          <div className="sticky top-0">
            <PreviewHeader platform={previewPlatform} onPlatform={setPreviewPlatform}
              device={previewDevice} onDevice={setPreviewDevice} />
            <SocialPreview platform={previewPlatform} handle={previewHandle} name={previewName} images={previewPlatform === "linkedin" ? (pdfUrls.length ? pdfUrls : metaMediaUrls) : format === "story" ? metaMediaUrls : previewPlatform === "facebook" ? fbMedia : igMedia} caption={caption} device={previewDevice} story={format === "story"} />
            {/* Meta runs this while a reel processes in their own composer, under the
                preview. Same place here — it is what you are looking at anyway, and
                the column had dead space below the phone. */}
            {singleVideoUrl && (
              <div className={`mt-3 mx-auto ${previewDevice === "tablet" ? "max-w-[480px]" : "max-w-sm"}`}>
                <CopyrightCheck videoUrl={singleVideoUrl} page={publishToPage}
                  collapseWhenClear={caption.trim().length > 0} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ACTION BAR — outside the scroller, pinned under it. */}
      <div className="bg-white rounded border-t border-gray-100 px-4 py-2.5 flex items-center justify-between shrink-0 mt-3">
        <div className="text-xs text-gray-500">
          {/* A row id told nobody anything. What people need to know is whether it
              has gone, or when it will. */}
          {result?.ok === true && (result.draft
            ? <span className="text-green-700">✓ Saved as a draft. Nothing is posted until you send it.</span>
            : result.whenLabel
            ? <span className="text-green-700">✓ {result.story ? "Post and Story scheduled" : "Scheduled"} for {result.whenLabel}. It goes out on its own — you don&apos;t need to be here.</span>
            : <span className="text-green-700">✓ {result.story ? "Post and Story queued" : "Queued"} to go out now — live within a minute (a video can take a few more while Instagram processes it).</span>)}
          {result?.ok === false && <span className="text-red-700">✗ {result.error}</span>}
          {!result && <span>{scheduleEnabled ? sendAheadHint(scheduleDate, scheduleTime) : "Goes straight into your publishing queue."}</span>}
        </div>
        <div className="flex items-center gap-2">
          {/* A draft is OURS, not Meta's. Instagram has no draft API at all, so this
              parks the post in the queue with publish_status='draft' — the worker only
              picks up 'scheduled', so it sits still until someone sends it. */}
          <button
            onClick={() => doEnqueue(undefined, true)}
            disabled={submitting}
            className="text-sm font-medium text-[#4A5468] border border-gray-200 px-4 py-2 rounded-lg hover:border-brand hover:text-brand disabled:opacity-50"
          >
            Save as draft
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="text-sm font-medium bg-brand text-white px-4 py-2 rounded-lg hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Sending…" : scheduleEnabled ? "Schedule" : "Publish"}
          </button>
        </div>
      </div>


            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Big status-count tile shown in the strip at the top of the queue view.
// The "To schedule" tab — produced (Output-Ready) content pulled from Supabase,
// each card ready to hand to the composer with account + caption + reach prediction.
type ToScheduleCard = {
  id: string; title: string; status: string; sbu: string | null; type: string | null;
  caption: string | null; content: string | null; mediaUrls: string[]; assetLink: string | null;
  channel: string | null; defaultPage: string; publishingDate: string | null;
};
function ToScheduleList({ items, loading, onRefresh, onSchedule, onAddManual, hideHeader }: {
  items: ToScheduleCard[]; loading: boolean; onRefresh: () => void;
  onSchedule: (t: ToScheduleCard) => void; onAddManual: () => void; hideHeader?: boolean;
}) {
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  // Direct upload for a task: file → Supabase Storage (post-media) → save on the
  // mh_posts row → refresh so the card shows the real thumbnail. No Slack.
  async function uploadForTask(postId: string, files: FileList) {
    setUploadingId(postId);
    try {
      const urls: string[] = [];
      for (const raw of Array.from(files)) {
        // Shrink before it leaves the browser — Meta re-encodes anyway, so the
        // extra megabytes only ever cost us storage.
        const f = await compressImage(raw);
        const up = await uploadSchedulerMedia(f);
        if (up.ok) urls.push(up.url);
        else alertDialog(`Upload failed: ${up.error}`);
      }
      if (urls.length) {
        await fetch("/api/scheduler/set-media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId, mediaUrls: urls, append: true }) });
        onRefresh();
      }
    } finally { setUploadingId(null); }
  }
  const statusChip = (s: string) => s === "Ready to Publish"
    ? { bg: "#E3F5EA", text: "#157F3C" }
    : { bg: "#FEF3E2", text: "#B45309" };
  return (
    <div>
      {!hideHeader && (
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <div className="text-base font-medium text-[#232D42]">Ready to schedule</div>
          <div className="text-[12px] text-gray-500">Produced content awaiting a publish action — straight from the Content Calendar. Click Schedule to add the caption &amp; go out.</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} className="text-xs font-medium bg-white text-gray-700 border border-gray-200 px-3 py-2 rounded-lg hover:border-gray-300">↻ Refresh</button>
          <button onClick={onAddManual} className="text-xs font-medium bg-brand text-white px-4 py-2 rounded-lg hover:bg-brand-dark">+ Create post</button>
        </div>
      </div>
      )}

      {loading && <div className="bg-white rounded-lg border border-gray-100"><LoadingBlock label="Loading produced content…" /></div>}
      {!loading && items.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-100 px-5 py-12 text-center text-sm text-gray-500">
          Nothing waiting — everything produced has been scheduled.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {items.map((t) => {
          const sc = statusChip(t.status);
          return (
            <div key={t.id} className="bg-white rounded-lg border border-gray-100 p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold text-gray-900 leading-snug">{t.title}</div>
                <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: sc.bg, color: sc.text }}>{t.status.replace("Output - ", "").replace(" to Publish", "")}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {t.sbu && <span className="text-xs px-2 py-0.5 rounded-full bg-brand-light text-brand">{t.sbu}</span>}
                {t.type && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{t.type}</span>}
              </div>
              {t.mediaUrls.length > 0 ? (
                <div className="relative">
                  {/\.(mp4|mov|webm)(\?|$)/i.test(t.mediaUrls[0])
                    ? <video src={t.mediaUrls[0]} className="w-full h-28 object-cover rounded border border-gray-100" muted />
                    : <img src={t.mediaUrls[0]} alt="" className="w-full h-28 object-cover rounded border border-gray-100" />}
                  {t.mediaUrls.length > 1 && <span className="absolute top-1 right-1 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded-full">+{t.mediaUrls.length - 1}</span>}
                  <label className="absolute bottom-1 right-1 text-xs bg-white/90 text-gray-700 border border-gray-200 px-1.5 py-0.5 rounded cursor-pointer hover:bg-white">
                    replace
                    <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { if (e.target.files?.length) uploadForTask(t.id, e.target.files); e.currentTarget.value = ""; }} />
                  </label>
                </div>
              ) : t.assetLink ? (
                /* Delivered as a LINK, not a file. Showing the bare "Upload media"
                   dropzone here made the work look lost between Output-Ready and the
                   Scheduler — "when it is in output ready I can see the video, when I
                   do content review and push to schedule, video is disappearing"
                   (Manya, 6 Oct, on a Reel whose cut sat in Drive). The only trace
                   was a grey line that said Slack whatever the link really was.

                   Publishing still needs the actual file — Meta cannot fetch a Drive
                   link — so the upload stays. It just no longer pretends nothing was
                   handed over. */
                <div className="h-28 rounded border border-gray-200 bg-gray-50 p-2 flex flex-col justify-between">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-700">Delivered as a link</div>
                    <a href={t.assetLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                      className="text-xs text-brand hover:underline truncate block">Open in {linkHost(t.assetLink)} ↗</a>
                  </div>
                  <label className={`text-xs border border-dashed rounded px-2 py-1 text-center cursor-pointer transition ${uploadingId === t.id ? "border-brand text-brand bg-brand-light/40" : "border-gray-300 text-gray-600 hover:border-brand"}`}>
                    <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { if (e.target.files?.length) uploadForTask(t.id, e.target.files); e.currentTarget.value = ""; }} />
                    {uploadingId === t.id ? "Uploading…" : "Add the file to publish"}
                  </label>
                </div>
              ) : (
                <label className={`flex flex-col items-center justify-center gap-1 h-28 rounded border border-dashed cursor-pointer transition ${uploadingId === t.id ? "border-brand bg-brand-light/40" : "border-gray-300 hover:border-brand"}`}>
                  <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { if (e.target.files?.length) uploadForTask(t.id, e.target.files); e.currentTarget.value = ""; }} />
                  {uploadingId === t.id ? (
                    <span className="text-xs text-brand font-medium">Uploading…</span>
                  ) : (
                    <>
                      <span className="text-lg">↑</span>
                      <span className="text-xs text-gray-600 font-medium">Upload media</span>
                    </>
                  )}
                </label>
              )}
              <div className="flex items-center justify-between mt-auto pt-1 border-t border-gray-50">
                <span className="text-xs text-gray-500">You pick the page</span>
                <button onClick={() => onSchedule(t)} className="text-xs font-medium bg-brand text-white px-3 py-1.5 rounded-lg hover:bg-brand-dark">Schedule →</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Why a post failed, in plain words, with what to do (22 Oct). The publisher stores
// Meta's raw message; most of them come down to the file or its shape.
function explainFailure(reason: string | null | undefined): { why: string; fix?: string } | null {
  if (!reason) return null;
  const r = reason.toLowerCase();
  if (/rejected the (story )?video while processing|media.*(too large|size)|file size/.test(r))
    return { why: "Instagram couldn't process the video.", fix: "Usually the file is over 300 MB, 4K, landscape or longer than 15 min. Export it at 1080 × 1920 (vertical), H.264, about 10–15 Mbps, under 300 MB, and try again." };
  if (/still processing at meta/.test(r)) return { why: "Meta took more than 20 minutes to process the video.", fix: "Try again; if it repeats, export a smaller file (under 300 MB)." };
  if (/no media/.test(r)) return { why: "There was no creative on the post.", fix: "Add the image or video, then publish again." };
  if (/token|oauth|permission|session/.test(r)) return { why: "The connection to Instagram / Facebook has expired.", fix: "Reconnect the page in Integrations, then try again." };
  return { why: reason };
}

// Sizes of media files, read with a HEAD request (our uploads are public URLs), so the
// composer can warn before Instagram rejects a file that's too big.
const IG_MAX_BYTES = 300 * 1024 * 1024;
function useMediaSizes(urls: string[]): Record<string, number> {
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const key = urls.join("\n");
  useEffect(() => {
    let alive = true;
    urls.filter((u) => /^https?:\/\//.test(u) && !(u in sizes)).forEach((u) => {
      fetch(u, { method: "HEAD" }).then((r) => {
        const n = Number(r.headers.get("content-length") || 0);
        if (alive && n) setSizes((m) => ({ ...m, [u]: n }));
      }).catch(() => {});
    });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return sizes;
}
const fmtSize = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${Math.round(n / 1024 ** 2)} MB`);

// "File goes to Instagram at 5:00 · live at 5:30" — what scheduling a post means now
// that the publisher sends the file ahead (22 Oct).
function sendAheadHint(date: string, time: string): string {
  const at = date && time ? new Date(`${date}T${time}:00`) : null;
  if (!at || Number.isNaN(at.getTime())) return "Goes into your publishing queue for the time you set.";
  const f = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  return `The file goes to Instagram, Facebook and LinkedIn from ${f(new Date(at.getTime() - SEND_AHEAD_MIN * 60_000))} · live at ${f(at)}.`;
}

// Ticks once a second while mounted — drives the countdowns below.
function useNow(on = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

// What is happening to a post right now, live (Praveen, 22 Oct: "Publish now just
// shows nothing"). The publisher only looks every 5 minutes, so a due post says when
// the next look is; a reel Instagram is still processing says which try it is on.
function liveStatusText(p: ScheduledPost, now: number): { text: string; tone: "wait" | "busy" | "done" | "bad" } | null {
  const due = p.scheduleTime ? new Date(p.scheduleTime).getTime() : null;
  // Before its time: the file goes to Instagram up to SEND_AHEAD_MIN early, so at the
  // time only "post" is left to press.
  if (p.effectiveStatus === "scheduled" && due && due > now) {
    const at = new Date(due).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
    const left = `goes live at ${at} (in ${clockText(due - now)})`;
    if (p.prepState === "error") return { text: `The upload failed — ${p.prepError || "check it"}. Fix it before ${at}.`, tone: "bad" };
    if (p.prepState === "ready") return { text: `File uploaded, ready · ${left}`, tone: "done" };
    if (p.prepState === "sending") return { text: `Uploading the file… · ${left}`, tone: "busy" };
    if (due - now <= SEND_AHEAD_MIN * 60_000) return { text: `Uploading the file shortly · ${left}`, tone: "wait" };
    return null;
  }
  if (p.effectiveStatus === "publishing") {
    const since = p.updatedAt ? new Date(p.updatedAt).getTime() : due;
    return { text: `Publishing… ${since ? clockText(now - since) : ""}`.trim(), tone: "busy" };
  }
  if (p.effectiveStatus === "scheduled" && due && due <= now) {
    const next = nextPublisherCheck(now);
    if (p.processingTry) return { text: `Instagram is processing the video · try ${p.processingTry} of 20 · next check in ${clockText(next - now)}`, tone: "busy" };
    return { text: `Waiting for the publisher · next check in ${clockText(next - now)}`, tone: "wait" };
  }
  if (p.effectiveStatus === "published" && due && p.publishedAt) {
    const took = new Date(p.publishedAt).getTime() - due;
    if (took >= 0) return { text: `Went out ${durationText(took)} after its time`, tone: "done" };
  }
  return null;
}
function LiveStatus({ post, className = "" }: { post: ScheduledPost; className?: string }) {
  const active = post.effectiveStatus === "publishing" || post.effectiveStatus === "scheduled";
  const now = useNow(active);
  const s = liveStatusText(post, now);
  if (!s) return null;
  const tone = s.tone === "busy" ? "text-blue-700" : s.tone === "done" ? "text-emerald-700" : s.tone === "bad" ? "text-rose-700" : "text-[#4A5468]";
  return (
    <div className={`flex items-center gap-1.5 text-xs tabular-nums ${tone} ${className}`}>
      {s.tone === "bad" ? <IconAlertTriangle size={13} stroke={1.8} /> : s.tone === "done" ? <IconCircleCheck size={13} stroke={1.8} /> : <IconClock size={13} stroke={1.8} className={s.tone === "busy" ? "animate-pulse" : ""} />}
      <span className="truncate">{s.text}</span>
    </div>
  );
}

// The post's publishing history — who scheduled it, Publish now, each publisher step,
// failures, Fix creative, sent back to review — read from the task's activity log.
const HISTORY_ACTIONS: Record<string, string> = {
  publish_scheduled: "Scheduled for", publish_now: "Publish now pressed", publish_draft_saved: "Saved as a draft",
  publish_rescheduled: "Publish time changed", removed_from_queue: "Taken out of the queue",
  sent_back_for_review: "Sent back to Content Review", status_changed: "Status changed",
  publish_started: "Publisher picked it up", publish_processing: "Instagram processing the video · try",
  published: "Published", publish_failed: "Failed",
};
type HistoryRow = { id: string; action: string; actorName: string; actor_key: string | null; from_value: string | null; to_value: string | null; detail: unknown; created_at: string };
function PublishHistory({ postId }: { postId: string }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/marketing-hub/task-detail?id=${encodeURIComponent(postId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { activity?: HistoryRow[] } | null) => { if (alive) setRows(d?.activity || []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [postId]);
  if (rows === null) return <div className="text-xs text-gray-400">Loading history…</div>;
  // Oldest first; a run of "processing" checks collapses into its latest try.
  const list = rows.filter((r) => r.action in HISTORY_ACTIONS && (r.action !== "status_changed" || r.to_value === "Ready to Publish" || r.to_value === "Output - Ready"))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .filter((r, i, arr) => !(r.action === "publish_processing" && arr[i + 1]?.action === "publish_processing"));
  if (!list.length) return <div className="text-xs text-gray-400">No publishing history yet.</div>;
  const at = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", second: "2-digit" });
  return (
    <ol className="space-y-2.5">
      {list.map((r) => {
        const who = r.actor_key ? r.actorName : (["publish_started", "publish_processing", "published", "publish_failed"].includes(r.action) ? "Publisher" : "System");
        const note = typeof r.detail === "string" ? r.detail : null;
        const bad = r.action === "publish_failed" || r.action === "sent_back_for_review";
        const good = r.action === "published";
        return (
          <li key={r.id} className="flex gap-2.5 text-[13px]">
            <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${bad ? "bg-rose-500" : good ? "bg-emerald-500" : "bg-brand"}`} />
            <div className="min-w-0">
              <div className="text-[#232D42]">
                {HISTORY_ACTIONS[r.action]}
                {r.action === "status_changed" ? <> → {r.to_value}</> : r.action === "published" && r.to_value
                  ? <> · <a href={r.to_value} target="_blank" rel="noreferrer" className="text-brand hover:underline">view post ↗</a></>
                  : r.to_value && r.action !== "publish_started" && r.action !== "publish_failed" ? <> {r.from_value ? <span className="text-gray-400 line-through">{r.from_value}</span> : null}{r.from_value ? " → " : ""}{r.to_value}</> : null}
              </div>
              <div className="text-xs text-[#8A92A6]">{who} · {at(r.created_at)}</div>
              {note && <div className={`text-xs mt-0.5 ${bad ? "text-rose-700" : "text-[#4A5468]"}`}>{note}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// Compact list shown when a status counter (Scheduled / Publishing / Published / Failed)
// is the active filter. Click a row to open the big preview/analytics modal.
// Over-posting guard popup. Lists the posts already committed to that day (name + time),
// A deliverable arrives either as an uploaded file or as a LINK (Drive, Canva,
// Slack). Name the link by where it actually points — this used to say "Slack" for
// every link, including the Google Drive ones it usually is.
function linkHost(u: string): string {
  try {
    const h = new URL(u).hostname.replace(/^www./, "");
    if (h.includes("drive.google") || h.includes("docs.google")) return "Google Drive";
    if (h.includes("slack")) return "Slack";
    if (h.includes("canva")) return "Canva";
    if (h.includes("dropbox")) return "Dropbox";
    if (h.includes("youtube") || h.includes("youtu.be")) return "YouTube";
    if (h.includes("vimeo")) return "Vimeo";
    return h;
  } catch { return "the link"; }
}

// each expandable inline to show its creative + caption, with "Schedule anyway" / "Pick
// another date" at the bottom.
function DayCapWarningModal({ dateLabel, page, limit, existing, pageHandle, onProceed, onPickAnother }: {
  dateLabel: string;
  page: string;
  limit: number;
  existing: ScheduledPost[];
  pageHandle: (page: string) => string;
  onProceed: () => void | Promise<void>;
  onPickAnother: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const fmtTime = (iso: string | null) => iso
    ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    : "—";
  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onPickAnother}>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header bar */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-amber-100 bg-amber-50">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-7 h-7 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="w-4 h-4">
                <circle cx="12" cy="12" r="9" />
                <line x1="12" y1="7.5" x2="12" y2="13" />
                <line x1="12" y1="16.5" x2="12" y2="16.5" />
              </svg>
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-amber-600 leading-tight">Daily limit reached</div>
              <div className="text-[12px] text-gray-500 mt-0.5">{pageHandle(page)} · limit {limit}/day</div>
            </div>
          </div>
          <button onClick={onPickAnother} className="text-gray-400 hover:text-gray-700 text-xl leading-none flex-shrink-0">×</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto">
          <div className="text-[13px] text-gray-600">
            {pageHandle(page)} already has <span className="font-semibold text-gray-900">{existing.length}</span> post{existing.length === 1 ? "" : "s"} scheduled for <span className="font-medium text-gray-800">{dateLabel}</span>, which is its daily limit of {limit}. Scheduling this one makes it <span className="font-semibold text-gray-900">{existing.length + 1}</span>.
          </div>
          <div className="text-xs uppercase tracking-wide font-medium text-gray-400 mt-4 mb-2">Already planned that day</div>
          <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
            {existing.map((p) => (
              <div key={p.id}>
                <button onClick={() => setOpenId(openId === p.id ? null : p.id)}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-gray-50">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate">{p.particulars || "Untitled"}</div>
                    <div className="text-xs text-gray-500">{p.type || "Post"}</div>
                  </div>
                  <div className="text-xs text-gray-500 tabular-nums flex-shrink-0">{fmtTime(p.scheduleTime || p.publishedAt)}</div>
                  <span className="text-gray-300 text-xs flex-shrink-0">{openId === p.id ? "▲" : "▼"}</span>
                </button>
                {openId === p.id && (
                  <div className="px-3.5 pb-3 flex gap-3 bg-gray-50/60">
                    <div className="w-16 h-16 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0 mt-2">
                      {/* A reel with no cover has only an mp4 to show — a still frame from
                  the video beats the broken-image icon that an <img> gives. */}
              {p.thumbnailUrl && (isVideoUrl(p.thumbnailUrl)
                ? <video src={p.thumbnailUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                : /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.thumbnailUrl} alt="" className="w-full h-full object-cover" />)}
                    </div>
                    <div className="text-[12px] text-gray-600 whitespace-pre-wrap flex-1 max-h-32 overflow-y-auto pt-2">{p.fullCaption || p.caption || "No caption"}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-100 bg-gray-50/50">
          <button onClick={onPickAnother}
            className="text-xs font-medium px-3.5 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">Pick another date</button>
          <button onClick={onProceed}
            className="text-xs font-semibold px-3.5 py-2 rounded-lg bg-brand text-white hover:bg-brand-dark">Schedule anyway</button>
        </div>
      </div>
    </div>
  );
}

// One collapsible section of the queue (Failed / Publishing / Ready / Recently published).
// Renders rich cards with inline datetime picker + Publish now + Edit caption actions.
function QueueSection({
  title, subtitle, posts, onReschedule, onPublishNow, onEdit, onScheduleNow, rowActionId, accent, emptyOK, readonly, expanded,
}: {
  title: string;
  subtitle: string;
  posts: ScheduledPost[];
  onReschedule: (recordId: string, iso: string) => void;
  onPublishNow: (recordId: string) => void;
  onEdit: (post: ScheduledPost) => void;
  onScheduleNow?: (post: ScheduledPost) => void;
  rowActionId: string | null;
  accent: "amber" | "blue" | "green" | "rose";
  emptyOK?: boolean;
  readonly?: boolean;
  expanded?: boolean;   // richer per-row layout — bigger thumbnail, full caption, tag chips
}) {
  const bandColors: Record<string, string> = {
    amber: "bg-amber-500",
    blue: "bg-blue-500",
    green: "bg-emerald-500",
    rose: "bg-rose-500",
  };
  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-4 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100">
        <div className={`w-1 h-8 rounded-full ${bandColors[accent]}`} />
        <div className="flex-1">
          <div className="text-base font-medium text-[#232D42]">{title}</div>
          <div className="text-xs text-gray-500">{subtitle}</div>
        </div>
      </div>
      {posts.length === 0 && emptyOK && (
        <div className="px-5 py-12 text-center text-sm text-gray-400">
          Nothing here right now.
        </div>
      )}
      {posts.length > 0 && (
        <div className="divide-y divide-gray-100">
          {posts.map((p) => (
            <QueueRow
              key={p.id}
              post={p}
              onReschedule={onReschedule}
              onPublishNow={onPublishNow}
              onEdit={onEdit}
              onScheduleNow={onScheduleNow}
              busy={rowActionId === p.id}
              readonly={readonly}
              expanded={expanded}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function QueueRow({ post, onReschedule, onPublishNow, onEdit, onScheduleNow, busy, readonly }: {
  post: ScheduledPost;
  onReschedule?: (recordId: string, iso: string) => void;
  onPublishNow?: (recordId: string) => void;
  onEdit?: (post: ScheduledPost) => void;
  onScheduleNow?: (post: ScheduledPost) => void;
  busy?: boolean;
  readonly?: boolean;
  expanded?: boolean;
}) {
  const statusColor =
    post.effectiveStatus === "published" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    post.effectiveStatus === "publishing" ? "bg-blue-50 text-blue-700 border-blue-200" :
    post.effectiveStatus === "scheduled" ? "bg-amber-50 text-amber-800 border-amber-200" :
    post.effectiveStatus === "failed" ? "bg-rose-50 text-rose-700 border-rose-200" :
    "bg-gray-50 text-gray-600 border-gray-200";
  const statusLabel = post.effectiveStatus === "scheduled" ? "Ready to schedule" :
    post.effectiveStatus.charAt(0).toUpperCase() + post.effectiveStatus.slice(1);

  const when = post.publishedAt || post.scheduleTime;
  const whenLabel = when ? fmtDateTime(when) : "—";

  const typeIcon = post.type?.toLowerCase().includes("reel") ? <IconMovie size={16} stroke={1.6} /> :
    post.type?.toLowerCase().includes("carousel") ? <IconPhoto size={16} stroke={1.6} /> : <IconFileText size={16} stroke={1.6} />;

  return (
    <div className="px-4 py-3 flex items-start gap-3">
      {/* Column 1 — post name + interest chip + type chip (stacked one below the other) */}
      <div className="w-44 shrink-0">
        <div className="text-sm font-semibold text-gray-900 leading-snug mb-1.5 line-clamp-2">
          {post.particulars || "(no title)"}
        </div>
        {post.primaryInterest && (
          <div className="inline-block text-xs bg-brand-light text-brand rounded-full px-2 py-0.5 mb-1 mr-1">
            {post.primaryInterest}
          </div>
        )}
        {post.type && (
          <div className="inline-block text-xs bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">
            {post.type}
          </div>
        )}
        {post.publishToPage && (
          <div className="text-xs text-gray-500 mt-1">{post.publishToPage}</div>
        )}
      </div>

      {/* Column 2 — carousel first slide / thumbnail */}
      <div className="w-28 h-28 shrink-0">
        {post.thumbnailUrl ? (
          <img src={post.thumbnailUrl} alt="" className="w-full h-full object-cover rounded-lg border border-gray-100" />
        ) : (
          <div className="w-full h-full rounded-lg bg-gray-100 flex items-center justify-center text-4xl text-gray-400">
            {typeIcon}
          </div>
        )}
      </div>

      {/* Column 3 — caption */}
      <div className="flex-1 min-w-0">
        {post.caption ? (
          <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap break-words line-clamp-6">
            {post.caption}
          </div>
        ) : (
          <div className="text-xs text-gray-400 italic">{post.format === "story" ? "Story — no caption needed." : "No caption yet."}</div>
        )}
        {post.failureReason && (
          <div className="text-xs text-rose-700 mt-2 bg-rose-50 border border-rose-100 rounded px-2 py-1">
            <IconAlertTriangle size={14} stroke={1.8} className="inline -mt-0.5 mr-1" />{post.failureReason}
          </div>
        )}
      </div>

      {/* Column 4 — status + Schedule now button */}
      <div className="w-36 shrink-0 flex flex-col items-end gap-2">
        <span className={`text-xs font-medium uppercase tracking-wide rounded-full border px-2 py-0.5 ${statusColor}`}>
          {statusLabel}
        </span>
        {!readonly && (
          <button
            type="button"
            onClick={() => onScheduleNow?.(post)}
            disabled={busy}
            className="text-xs font-medium bg-brand hover:bg-brand-dark text-white px-3 py-1.5 rounded disabled:opacity-50 whitespace-nowrap"
          >
            <IconCalendarEvent size={14} stroke={1.8} className="inline -mt-0.5 mr-1" />Schedule now
          </button>
        )}
        {!readonly && post.scheduleTime && (
          <div className="text-xs text-gray-500 text-right leading-tight">
            Current time slot:<br />
            <span className="text-gray-800 font-medium">{whenLabel}</span>
          </div>
        )}
        {readonly && (
          <>
            <div className="text-xs text-gray-500 text-right">Published {whenLabel}</div>
            {post.instagramUrl && <a href={post.instagramUrl} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">View on Instagram ↗</a>}
          </>
        )}
      </div>
    </div>
  );
}

// Schedule-now modal — picked-time chooser. Fetches best-time suggestions on open
// (scoped to the post's Publish To Page brand). User picks a slot, hits Confirm →
// PATCHes Schedule Time in Airtable and the row moves in the queue.
function ScheduleNowModal({ post, onClose, onConfirm }: {
  post: ScheduledPost;
  onClose: () => void;
  onConfirm: (iso: string, pages: string[]) => void | Promise<void>;
}) {
  const [suggestions, setSuggestions] = useState<TimeSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [customLocal, setCustomLocal] = useState<string>(
    post.scheduleTime
      ? new Date(new Date(post.scheduleTime).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : ""
  );
  const [saving, setSaving] = useState(false);
  // Cross-post: pre-select whichever page the row was tagged with; user can tick more
  // to fan-out. On confirm, one Airtable row is updated in place + one duplicate is
  // created for each additional page (same media/caption/interest, different Publish
  // To Page), so n8n's Native Scheduler fires one post per selected page.
  const ALL_PAGES = usePublishPages().map((o) => o.value);
  const [selectedPages, setSelectedPages] = useState<string[]>(
    post.publishToPage ? [post.publishToPage] : ["GooCampus Main"]
  );
  function togglePage(page: string) {
    setSelectedPages((prev) => prev.includes(page) ? prev.filter((p) => p !== page) : [...prev, page]);
  }

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/scheduler/suggest-time?publishToPage=${encodeURIComponent(post.publishToPage || "GooCampus Main")}`, { signal: ctrl.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setSuggestions((d?.suggestions || []) as TimeSuggestion[]))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [post.publishToPage]);

  async function pickAndConfirm(iso: string) {
    if (selectedPages.length === 0) { alertDialog("Pick at least one page to publish to."); return; }
    setSaving(true);
    try { await onConfirm(iso, selectedPages); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-semibold"><IconCalendarEvent size={16} stroke={1.8} className="inline -mt-0.5 mr-1" />Schedule this post</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>
        </div>
        <div className="text-xs text-gray-500 mb-4 line-clamp-1">{post.particulars || "(no title)"}</div>

        {/* Pages — tick one or more to cross-post */}
        <div className="mb-4">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
            Publish to {selectedPages.length > 1 && <span className="ml-1 text-brand normal-case font-normal">· cross-posting to {selectedPages.length} pages</span>}
          </div>
          <div className="space-y-1.5">
            {ALL_PAGES.map((page) => {
              const checked = selectedPages.includes(page);
              const handle = pageInfo(page).handle;
              return (
                <label
                  key={page}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition ${
                    checked ? "border-brand/50 bg-brand-light" : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePage(page)}
                    className="w-4 h-4 accent-[#3A57E8]"
                  />
                  <div className="flex-1">
                    <div className="text-xs font-medium text-gray-900">{pageLabel(page)}</div>
                    <div className="text-xs text-gray-500">{handle}</div>
                  </div>
                  {page === post.publishToPage && (
                    <span className="text-xs font-medium text-brand uppercase tracking-wide">Original</span>
                  )}
                </label>
              );
            })}
          </div>
          {post.platform && (
            <div className="text-xs text-gray-500 mt-1.5">
              Platform: <span className="text-gray-700 font-medium">{post.platform}</span>
            </div>
          )}
        </div>

        {/* Best-time suggestions */}
        <div className="mb-4">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
            Good times to schedule
            <span className="text-gray-400 normal-case font-normal ml-1">— based on when your audience is most active</span>
          </div>
          {loading && <LoadingBlock size={18} className="!py-2 !flex-row !justify-start !gap-2" label="Loading suggestions…" />}
          {!loading && suggestions.length === 0 && (
            <div className="text-xs text-gray-400 py-2">No suggestions available right now — pick a custom time below.</div>
          )}
          {!loading && suggestions.length > 0 && (
            <div className="space-y-1.5">
              {suggestions.slice(0, 5).map((s, i) => {
                const dt = new Date(s.nextOccurrenceISO);
                const label = dt.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
                return (
                  <button
                    key={i}
                    onClick={() => pickAndConfirm(s.nextOccurrenceISO)}
                    disabled={saving}
                    className="w-full flex items-center justify-between text-left bg-white border border-gray-200 hover:border-brand/50 hover:bg-brand-light/40 rounded-lg px-3 py-2 disabled:opacity-50 transition"
                  >
                    <div>
                      <div className="text-sm font-medium text-gray-900">{label}</div>
                      <div className="text-xs text-gray-500">{s.followersOnline.toLocaleString()} followers online at {s.hourLabel}</div>
                    </div>
                    <div className="text-xs text-brand font-medium">Schedule →</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Custom time */}
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Or pick a custom time</div>
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={customLocal}
              onChange={(e) => setCustomLocal(e.target.value)}
              className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5"
            />
            <button
              onClick={() => customLocal && pickAndConfirm(new Date(customLocal).toISOString())}
              disabled={!customLocal || saving}
              className="text-xs font-medium bg-brand text-white px-3 py-1.5 rounded disabled:opacity-50"
            >
              {saving ? "Saving…" : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// (retained for API-compat with any callers below — the current queue view uses the
// new signature above, but a plain version of the row is kept in the legacy tree.)
// Content Calendar — right-rail sidebar. Shows two things grouped by day (newest first):
// (1) real published Instagram posts fetched from /api/posts (with the actual full image,
// not cropped), and (2) upcoming scheduled posts from Airtable. Post cards show the full
// image at proper aspect ratio, like Meta Ads Library.
type PublishedIG = {
  id: string; caption: string; mediaUrl: string; permalink: string; type: string;
  timestamp: string; likes: number; comments: number; reach: number;
  publishToPage: string; // which account it was published from (a page value, lib/publish-pages.ts)
};

type CalendarItem =
  | { kind: "scheduled"; whenMs: number; post: ScheduledPost }
  | { kind: "published"; whenMs: number; post: PublishedIG };

type CalFilter = "all" | "today" | "yesterday" | "week" | "upcoming";

// Big full-screen view of a scheduled or published post — opened from the calendar.
// View-only: media, caption, status, account, and permalinks. Handles both kinds.
// ── Layout B (27 Oct): the Scheduler's status column, its little helpers and its CSS ──
const PANE_STATUSES = [
  { key: "ready", name: "Ready to schedule", mid: "To schedule", short: "Ready", hint: "Waiting for a time slot", tone: "#D9861B", tint: "rgba(226,154,46,0.12)", Icon: IconClock },
  { key: "scheduled", name: "Scheduled", mid: "Scheduled", short: "Scheduled", hint: "Queued to publish", tone: "#3A57E8", tint: "rgba(58,87,232,0.12)", Icon: IconCalendarEvent },
  { key: "published", name: "Published", mid: "Published", short: "Published", hint: "Live in the last 7 days", tone: "#1AA053", tint: "rgba(26,160,83,0.12)", Icon: IconSend },
  { key: "failed", name: "Failed", mid: "Failed", short: "Failed", hint: "Need a retry", tone: "#E5484D", tint: "rgba(229,72,77,0.12)", Icon: IconAlertTriangle },
  { key: "drafts", name: "Drafts", mid: "Drafts", short: "Drafts", hint: "Saved, not sent", tone: "#4A5468", tint: "rgba(74,84,104,0.10)", Icon: IconPencil },
  { key: "linkedin", name: "LinkedIn", mid: "LinkedIn", short: "LinkedIn", hint: "Scheduled & posted", tone: "#0A66C2", tint: "rgba(10,102,194,0.10)", Icon: IconBrandLinkedin },
] as const;
const PANE_EMPTY: Record<string, string> = {
  scheduled: "No scheduled posts yet — schedule one from Ready to schedule.",
  published: "No published posts in this window.",
  failed: "No failed posts — all clear.",
  drafts: "No drafts. Use “Save as draft” in Create post to park a post here and finish it later.",
};
// "Today" / "Tomorrow" / "Yesterday" / "Thu, 30 Oct" — the list's day headings.
function dayLabel2(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date())) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
// The time on a row: just the time today, else day + time.
function whenText(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const t = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  return dayLabel2(iso) === "Today" ? t : `${dayLabel2(iso)}, ${t}`;
}
// A ready task's publishing date as "due today" / "due in 3 days" / "overdue · 2 days".
function dueText(date: string | null): string {
  if (!date) return "no date";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "no date";
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date())) / 86400000);
  if (diff === 0) return "due today";
  if (diff === 1) return "due tomorrow";
  if (diff > 1) return `due in ${diff} days`;
  return `overdue · ${-diff} day${diff === -1 ? "" : "s"}`;
}
// "in 2 h 10 m" — its own little ticking component, so the page doesn't re-render every second.
function RelTime({ iso, className = "" }: { iso: string | null | undefined; className?: string }) {
  const now = useNow(!!iso);
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return null;
  let text: string;
  if (ms <= 0) text = "due now";
  else {
    const m = Math.round(ms / 60000), h = Math.floor(m / 60), dd = Math.floor(h / 24);
    text = dd >= 2 ? `in ${dd} days` : h >= 1 ? `in ${h} h${m % 60 ? ` ${m % 60} m` : ""}` : `in ${Math.max(1, m)} m`;
  }
  return <span className={`block ${className}`}>{text}</span>;
}
function PaneThumb({ url }: { url?: string | null }) {
  return (
    <span className="sched-thumb">
      {url ? (isVideoUrl(url)
        ? <video src={url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
        : /* eslint-disable-next-line @next/next/no-img-element */ <img src={url} alt="" className="w-full h-full object-cover" />)
        : <IconPhoto size={16} stroke={1.6} className="text-[#C2C6D0]" />}
    </span>
  );
}
function PanePlaceholder({ text }: { text: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-8 py-16 text-sm text-[#8A92A6]">
      <IconLayoutSidebarRight size={34} stroke={1.4} className="text-[#C2C6D0]" />
      {text}
    </div>
  );
}
// Widths follow the screen through container queries on the Scheduler's own width
// (the sidebar is outside it): 24"+ full names with hints, 15" laptop names only,
// 14" laptop an icon rail with counts, very narrow everything stacked.
const SPLIT_CSS = `
.sched-wrap{container:sched / inline-size}
.sched-split{display:grid;gap:12px;align-items:start;grid-template-columns:232px minmax(300px,380px) minmax(0,1fr)}
.sched-pane{position:sticky;top:12px;max-height:calc(100vh - 24px);min-height:420px;display:flex;flex-direction:column;background:#fff;border:1px solid #EEF0F4;border-radius:14px;min-width:0}
.sched-wide{grid-column:span 2}
.sched-scroll{overflow:auto;min-height:0;flex:1}
.sched-head{padding:12px 14px 10px;border-bottom:1px solid #EEF0F4;flex-shrink:0}
.sched-rail{padding:6px}
.sched-status{position:relative;display:flex;align-items:center;gap:10px;width:100%;border:0;background:transparent;padding:9px 10px;border-radius:10px;text-align:left;color:#232D42}
.sched-status:hover{background:#F8F9FC}
.sched-status.on{background:var(--tint)}
.sched-status .ic{width:30px;height:30px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.sched-status .nm{flex:1;min-width:0;font-size:13.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sched-status .n-mid,.sched-status .n-short{display:none}
.sched-status .hint{display:block;font-size:11.5px;font-weight:400;color:#8A92A6;overflow:hidden;text-overflow:ellipsis}
.sched-status .ct{font-size:12.5px;font-weight:500;color:#4A5468;background:#F1F3F7;border-radius:999px;padding:1px 8px;min-width:26px;text-align:center;flex-shrink:0}
.sched-status.on .ct{background:#fff;color:var(--tone)}
.sched-search{margin:10px 10px 4px;display:flex;align-items:center;gap:8px;border:1px solid #EEF0F4;border-radius:10px;padding:7px 10px;flex-shrink:0}
.sched-search input{border:0;outline:0;flex:1;min-width:0;font-size:13px;color:#232D42;background:transparent}
.sched-list{padding:4px 8px 10px}
.sched-day{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8A92A6;padding:10px 8px 4px}
.sched-row{display:flex;align-items:flex-start;gap:10px;width:100%;border:1px solid transparent;background:transparent;border-radius:10px;padding:8px;text-align:left}
.sched-row:hover{background:#F8F9FC}
.sched-row.on{background:#E9ECFB;border-color:rgba(58,87,232,.25)}
.sched-row .t{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13.5px;font-weight:500;color:#232D42;line-height:1.35}
.sched-row .m{display:block;font-size:12px;color:#8A92A6;margin-top:2px;line-height:1.4}
.sched-row .why{display:block;font-size:12px;color:#BE123C;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sched-row .w{flex-shrink:0;font-size:12px;color:#4A5468;text-align:right;white-space:nowrap;padding-left:4px;line-height:1.45}
.sched-row .rel,.sched-row .w .rel{font-size:11.5px;color:#3A57E8;font-weight:500}
.sched-thumb{width:40px;height:40px;border-radius:8px;flex-shrink:0;background:#EEF0F4;overflow:hidden;display:flex;align-items:center;justify-content:center}
.sched-badge{font-size:10px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;border-radius:6px;padding:2px 5px;background:#3A57E8;color:#fff;margin-right:6px;vertical-align:1px}
.sched-mini{display:inline-block;white-space:nowrap;font-size:11px;font-weight:500;border-radius:999px;padding:0 7px;margin-left:5px;background:#E9ECFB;color:#3A57E8}
.sched-upnext{display:block;width:calc(100% - 4px);margin:8px 2px 4px;text-align:left;border:1px solid #D5DBF8;background:linear-gradient(180deg,#F3F5FE,#fff);border-radius:12px;padding:11px 13px}
.sched-upnext:hover{border-color:#3A57E8}
.sched-upnext .lbl{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#3A57E8;font-weight:600}
.sched-upnext .ttl{font-size:14px;font-weight:500;color:#232D42;margin-top:3px;line-height:1.35}
.sched-upnext .cd{font-size:19px;font-weight:600;color:#232D42;margin-top:1px;display:flex;align-items:baseline;gap:4px;flex-wrap:wrap}
.sched-upnext .cd small{font-size:12px;font-weight:400;color:#8A92A6}
.sched-upnext .then{font-size:12px;color:#8A92A6;margin-top:6px;border-top:1px dashed #D5DBF8;padding-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sched-empty{padding:28px 14px;text-align:center;font-size:13px;color:#8A92A6}
.sched-detail{container:detail / inline-size}
.sched-dhead{padding:14px 18px;border-bottom:1px solid #EEF0F4;display:flex;flex-wrap:wrap;gap:10px 14px;align-items:flex-start;justify-content:space-between;flex-shrink:0}
.sched-dtitle{font-size:20px;font-weight:500;color:#232D42;margin-top:6px;line-height:1.3}
.sched-acts{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sched-chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:500;border-radius:999px;padding:2px 9px;background:#F1F3F7;color:#4A5468;white-space:nowrap}
.sched-chip.brand{background:#E9ECFB;color:#3A57E8}
.sched-pager{display:inline-flex;align-items:center;gap:2px;border:1px solid #EEF0F4;border-radius:10px;padding:2px}
.sched-pager button{border:0;background:transparent;width:28px;height:28px;border-radius:8px;font-size:17px;line-height:1;color:#4A5468}
.sched-pager button:hover:not(:disabled){background:#F1F3F7;color:#232D42}
.sched-pager button:disabled{color:#C2C6D0;cursor:default}
.sched-pager span{font-size:12.5px;color:#4A5468;padding:0 4px;white-space:nowrap}
.sched-after{display:flex;align-items:center;gap:10px;width:100%;border:1px solid #EEF0F4;border-radius:12px;padding:10px 12px;background:#fff}
.sched-after:hover{border-color:#3A57E8}
.sched-ready{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,340px);gap:18px;padding:16px 18px;align-items:start}
@container detail (max-width: 720px){ .sched-ready{grid-template-columns:minmax(0,1fr)} }
@container sched (min-width: 1900px){ .sched-split{grid-template-columns:260px minmax(380px,460px) minmax(0,1fr)} }
@container sched (max-width: 1323px){
  .sched-split{grid-template-columns:196px minmax(280px,330px) minmax(0,1fr)}
  .sched-status .hint{display:none}
  .sched-status .n-full{display:none}.sched-status .n-mid{display:inline}
}
@container sched (max-width: 1123px){
  .sched-split{grid-template-columns:64px minmax(270px,310px) minmax(0,1fr)}
  .sched-railhead{display:none}
  .sched-rail{padding:4px}
  .sched-status{flex-direction:column;gap:3px;padding:8px 2px}
  .sched-status .nm{flex:none;width:100%;text-align:center;font-size:10.5px;color:#4A5468}
  .sched-status.on .nm{color:var(--tone)}
  .sched-status .n-mid{display:none}.sched-status .n-short{display:inline}
  .sched-status .ct{position:absolute;top:2px;right:2px;font-size:10.5px;padding:0 5px;min-width:18px}
}
@container sched (max-width: 760px){
  .sched-split{grid-template-columns:minmax(0,1fr)}
  .sched-wide{grid-column:auto}
  .sched-pane{position:static;max-height:none;min-height:0}
  .sched-pane .sched-scroll{max-height:70vh}
  .sched-rail{display:flex;gap:6px;overflow-x:auto}
  .sched-status{flex-direction:row;width:auto;flex-shrink:0;padding:6px 10px}
  .sched-status .nm{width:auto;font-size:12.5px}
  .sched-status .ct{position:static}
}
`;

// The post itself — creative (slides / video), status, results, why it failed, caption,
// links and publishing history. Used by the planner popup and the Scheduler's right
// pane (layout B, 27 Oct), so the two never drift apart.
function PostPreviewContent({ item, story }: { item: CalendarItem; story?: { frames: string[]; handle: string } }) {
  const isPub = item.kind === "published";
  const p = item.post as ScheduledPost & PublishedIG;
  const asStory = !isPub && p.format === "story";
  // All slides for this post: carousels navigate slide-by-slide; videos play inline.
  const slides: string[] = isPub
    ? (p.mediaUrl ? [p.mediaUrl] : [])
    : (p.mediaUrls && p.mediaUrls.length ? p.mediaUrls : (p.thumbnailUrl ? [p.thumbnailUrl] : []));
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(idx, Math.max(0, slides.length - 1));
  const cur = slides[safeIdx] || null;
  const isVideo = (u: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u);
  // The creative's own shape, read off the file once it loads. Guessing 9:16 from
  // the word "reel" in a type field was wrong for every carousel and square that
  // ever went out, and the panel kept the reel's height either way — which is
  // where the black band under the image came from.
  const [ratio, setRatio] = useState<string | null>(null);
  useEffect(() => { setRatio(null); }, [safeIdx, slides.length]);
  const portrait = /reel|story/i.test(p.type || "");
  // Until it has loaded, the old guess is still the best one available.
  const boxRatio = ratio || (portrait ? "9 / 16" : "4 / 5");
  const caption: string = isPub ? (p.caption || "") : (p.fullCaption || p.caption || "");
  const status: string = isPub ? "published" : (p.effectiveStatus || "scheduled");
  const igUrl: string | null = isPub ? (p.permalink || null) : (p.instagramUrl || null);
  const fbUrl: string | null = isPub ? null : (p.facebookUrl || null);
  const account: string = (p.publishToPage === "GooCampus World") ? "@goocampusworld"
    : (p.publishToPage === "12Plus / GC India") ? "@12thplusdotcom"
    : isPub ? "@goocampus" : (p.publishToPage || "");
  const statusColor: Record<string, string> = {
    published: "bg-emerald-50 text-emerald-700", publishing: "bg-blue-50 text-blue-700",
    failed: "bg-rose-50 text-rose-700", scheduled: "bg-amber-50 text-amber-700",
  };
  // items-start, so the media column stops at the creative instead of being
  // stretched to whatever the caption beside it needs.
  return (
    <div className="grid md:grid-cols-2 min-h-0 overflow-auto items-start">
      {asStory ? (
        <div className="p-4 bg-[#F6F7FB]">
          <StoryPreview frames={story?.frames.length ? story.frames : slides} handle={(story?.handle || account).replace(/^@/, "") || "goocampus"} platform={(p.channels || []).length === 1 && p.channels![0] === "facebook" ? "facebook" : "instagram"} />
        </div>
      ) : (
      <div className="bg-gray-900 relative">
        {cur
          ? (
            <div className="w-full relative" style={{ aspectRatio: boxRatio }}>
              {isVideo(cur)
                ? <SoundVideo src={cur} open className="w-full h-full object-cover"
                    onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth) setRatio(`${v.videoWidth} / ${v.videoHeight}`); }} />
                : /* eslint-disable-next-line @next/next/no-img-element */ <img src={cur} alt="" className="w-full h-full object-cover"
                    onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth) setRatio(`${i.naturalWidth} / ${i.naturalHeight}`); }} />}
            </div>
          )
          : <div className="min-h-[320px] w-full flex items-center justify-center text-gray-400"><IconPhoto size={56} stroke={1.2} /></div>}
        {slides.length > 1 && (
          <>
            <button onClick={() => setIdx((i) => (Math.min(i, slides.length - 1) - 1 + slides.length) % slides.length)}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white text-xl flex items-center justify-center transition" aria-label="Previous">‹</button>
            <button onClick={() => setIdx((i) => (Math.min(i, slides.length - 1) + 1) % slides.length)}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white text-xl flex items-center justify-center transition" aria-label="Next">›</button>
            <div className="absolute top-3 right-3 text-xs font-medium text-white bg-black/50 rounded-full px-2 py-0.5 tabular-nums">{safeIdx + 1}/{slides.length}</div>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
              {slides.map((_, i) => (
                <button key={i} onClick={() => setIdx(i)} className={`w-2 h-2 rounded-full transition ${i === safeIdx ? "bg-white" : "bg-white/40 hover:bg-white/70"}`} aria-label={`Slide ${i + 1}`} />
              ))}
            </div>
          </>
        )}
      </div>
      )}
      <div className="p-5 space-y-4 overflow-auto">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${statusColor[status] || "bg-gray-100 text-gray-700"}`}>{status}</span>
          {account && <span className="text-xs text-gray-500">{account}</span>}
        </div>
        {isPub && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Likes", value: p.likes ?? 0 },
              { label: "Comments", value: p.comments ?? 0 },
              { label: "Reach", value: p.reach ?? 0 },
            ].map((m) => (
              <div key={m.label} className="bg-gray-50 rounded-lg px-3 py-2 text-center">
                <div className="text-lg font-semibold text-gray-900 tabular-nums leading-none">{(m.value || 0).toLocaleString("en-IN")}</div>
                <div className="text-xs uppercase tracking-wide text-gray-400 font-medium mt-1">{m.label}</div>
              </div>
            ))}
          </div>
        )}
        {!isPub && <LiveStatus post={p} />}
        {!isPub && status === "failed" && explainFailure(p.failureReason) && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm">
            <div className="font-medium text-rose-700">Why it failed: {explainFailure(p.failureReason)!.why}</div>
            {explainFailure(p.failureReason)!.fix && <div className="text-rose-700/90 mt-1 text-[13px] leading-relaxed">{explainFailure(p.failureReason)!.fix}</div>}
            <div className="text-xs text-rose-600/80 mt-1.5">Instagram said: &ldquo;{p.failureReason}&rdquo;</div>
          </div>
        )}
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400 font-medium mb-1">Caption</div>
          <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{caption || <span className="text-gray-400 italic">No caption</span>}</div>
        </div>
        {(igUrl || fbUrl) && (
          <div className="flex gap-2 pt-1">
            {igUrl && <a href={igUrl} target="_blank" rel="noreferrer" className="text-xs font-medium bg-brand text-white px-3 py-2 rounded-lg hover:bg-brand-dark">View on Instagram ↗</a>}
            {fbUrl && <a href={fbUrl} target="_blank" rel="noreferrer" className="text-xs font-medium bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg hover:border-gray-300">View on Facebook ↗</a>}
          </div>
        )}
        {!isPub && p.id && (
          <div className="pt-1">
            <div className="text-xs uppercase tracking-wide text-gray-400 font-medium mb-2">Publishing history</div>
            <PublishHistory postId={p.id} />
          </div>
        )}
      </div>
    </div>
  );
}

function SchedulePreviewModal({ item, onClose }: { item: CalendarItem; onClose: () => void }) {
  const isPub = item.kind === "published";
  const p = item.post as ScheduledPost & PublishedIG;
  const when = fmtDateTime(new Date(item.whenMs).toISOString());
  const title: string = isPub ? "Published post" : (p.particulars || "Scheduled post");
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-base font-medium text-[#232D42]">{title}</div>
            <div className="text-xs text-gray-500">{when}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>
        <PostPreviewContent item={item} />
      </div>
    </div>
  );
}

function MiniPlanner({ posts, publishedIG, wide, onSelect }: { posts: ScheduledPost[]; publishedIG: PublishedIG[]; wide?: boolean; onSelect?: (item: CalendarItem) => void }) {
  const [filter, setFilter] = useState<CalFilter>("all");

  const rawItems: CalendarItem[] = [
    ...posts.filter((p) => p.scheduleTime).map((p) => ({
      kind: "scheduled" as const, whenMs: new Date(p.scheduleTime as string).getTime(), post: p,
    })),
    ...publishedIG.map((p) => ({
      kind: "published" as const, whenMs: new Date(p.timestamp).getTime(), post: p,
    })),
  ];

  // Apply filter
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400 * 1000;
  const tomorrowStart = todayStart + 86400 * 1000;
  const weekAgo = todayStart - 7 * 86400 * 1000;

  const items = rawItems.filter((it) => {
    if (filter === "all") return true;
    if (filter === "today") return it.whenMs >= todayStart && it.whenMs < tomorrowStart;
    if (filter === "yesterday") return it.whenMs >= yesterdayStart && it.whenMs < todayStart;
    if (filter === "week") return it.whenMs >= weekAgo && it.whenMs < tomorrowStart;
    if (filter === "upcoming") return it.whenMs >= todayStart;
    return true;
  });

  // Group by yyyy-mm-dd
  const byDay = new Map<string, CalendarItem[]>();
  for (const it of items) {
    const d = new Date(it.whenMs);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const arr = byDay.get(key);
    if (arr) arr.push(it);
    else byDay.set(key, [it]);
  }

  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const dayKeys = Array.from(byDay.keys()).sort((a, b) => {
    const aFuture = a >= todayKey, bFuture = b >= todayKey;
    if (aFuture && !bFuture) return -1;
    if (!aFuture && bFuture) return 1;
    if (aFuture) return a.localeCompare(b);
    return b.localeCompare(a);
  });

  // Flat, dense ordering: upcoming soonest-first, then most-recent past — rendered
  // in ONE grid so every row fills the full width (no big empty gaps per day).
  const flatItems = [...items].sort((a, b) => {
    const aF = a.whenMs >= todayStart, bF = b.whenMs >= todayStart;
    if (aF !== bF) return aF ? -1 : 1;
    return aF ? a.whenMs - b.whenMs : b.whenMs - a.whenMs;
  });

  const filterChips: Array<{ key: CalFilter; label: string; count: number }> = [
    { key: "all", label: "All", count: rawItems.length },
    { key: "today", label: "Today", count: rawItems.filter((i) => i.whenMs >= todayStart && i.whenMs < tomorrowStart).length },
    { key: "yesterday", label: "Yesterday", count: rawItems.filter((i) => i.whenMs >= yesterdayStart && i.whenMs < todayStart).length },
    { key: "week", label: "This week", count: rawItems.filter((i) => i.whenMs >= weekAgo && i.whenMs < tomorrowStart).length },
    { key: "upcoming", label: "Upcoming", count: rawItems.filter((i) => i.whenMs >= todayStart).length },
  ];

  function statusChip(kind: "scheduled" | "published", eff?: string): { dot: string; label: string } {
    if (kind === "published") return { dot: "bg-emerald-500", label: "Published" };
    if (eff === "publishing") return { dot: "bg-blue-500", label: "Publishing" };
    if (eff === "failed") return { dot: "bg-rose-500", label: "Failed" };
    return { dot: "bg-amber-400", label: "Scheduled" };
  }

  function fmtDay(key: string): { weekday: string; date: string; sub: string } {
    const d = new Date(key + "T00:00:00");
    const now = new Date();
    const diffDays = Math.round((d.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / (86400 * 1000));
    let sub = "";
    if (diffDays === 0) sub = "Today";
    else if (diffDays === 1) sub = "Tomorrow";
    else if (diffDays === -1) sub = "Yesterday";
    else if (diffDays > 1 && diffDays < 8) sub = `in ${diffDays} days`;
    else if (diffDays < 0) sub = `${Math.abs(diffDays)} days ago`;
    return {
      weekday: d.toLocaleDateString("en-IN", { weekday: "short" }),
      date: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      sub,
    };
  }

  function truncate(s: string, n: number): string {
    if (!s) return "";
    return s.length > n ? s.slice(0, n).trim() + "…" : s;
  }

  return (
    <div className={`bg-white rounded-lg border border-gray-100 overflow-hidden ${wide ? "w-full" : "lg:sticky lg:top-4"}`}>
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="text-base font-medium text-[#232D42]">Published posts</div>
        <div className="flex flex-wrap gap-1">
          {filterChips.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition ${
                filter === c.key
                  ? "bg-brand text-white border-brand"
                  : "bg-white text-gray-600 border-gray-200 hover:border-brand"
              }`}
            >
              {c.label} <span className={filter === c.key ? "text-white/70" : "text-gray-400"}>{c.count}</span>
            </button>
          ))}
        </div>
      </div>

      {flatItems.length === 0 && (
        <div className="p-4 text-center text-xs text-gray-400">Nothing matches this filter.</div>
      )}

      <div className="max-h-[calc(100vh-220px)] min-h-[500px] overflow-y-auto p-2">
        {/* ONE dense grid over all posts so every row fills the width — no empty gaps.
            Each tile carries its own date + time. */}
        <div className="grid gap-2" style={{ gridTemplateColumns: wide ? "repeat(auto-fill, minmax(112px, 1fr))" : "repeat(auto-fill, minmax(84px, 1fr))" }}>
          {flatItems.map((it) => {
                  const dt = new Date(it.whenMs);
                  const t = `${dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · ${dt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;
                  // Map "Publish To Page" → short handle chip shown under each tile.
                  const handleFor = (page: string): { short: string; color: string } => {
                    if (page === "GooCampus Main") return { short: "@goocampus", color: "bg-brand-light text-brand border-brand/30" };
                    if (page === "GooCampus World") return { short: "@goocampusworld", color: "bg-sky-50 text-sky-700 border-sky-200" };
                    if (page === "12Plus / GC India") return { short: "@12thplusdotcom", color: "bg-rose-50 text-rose-700 border-rose-200" };
                    return { short: page || "—", color: "bg-gray-50 text-gray-600 border-gray-200" };
                  };
                  if (it.kind === "published") {
                    const p = it.post;
                    const isReel = p.type === "REEL";
                    const handle = handleFor(p.publishToPage);
                    return (
                      <button
                        key={`pub-${p.id}`}
                        type="button"
                        onClick={() => onSelect?.(it)}
                        title={p.caption ? truncate(p.caption, 140) : "View post"}
                        className="group block w-full text-left rounded overflow-hidden border border-gray-200 hover:border-brand/50 hover:shadow-md transition"
                      >
                        <div className="relative">
                          {p.mediaUrl ? (
                            <img src={p.mediaUrl} alt="" className="w-full aspect-[3/4] object-cover" />
                          ) : (
                            <div className="w-full aspect-[3/4] bg-gray-100 flex items-center justify-center text-lg text-gray-400">
                              {isReel ? <IconMovie size={20} stroke={1.5} /> : p.type === "CAROUSEL_ALBUM" ? <IconPhoto size={20} stroke={1.5} /> : <IconFileText size={20} stroke={1.5} />}
                            </div>
                          )}
                          <div className="absolute top-1 left-1 w-1.5 h-1.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-1 py-1 text-xs text-white tabular-nums text-right">
                            {t}
                          </div>
                        </div>
                        <div className={`text-[8px] px-1 py-0.5 border-t truncate text-center ${handle.color}`}>
                          {handle.short}
                        </div>
                      </button>
                    );
                  }
                  const p = it.post;
                  const dot = p.effectiveStatus === "publishing"
                    ? "bg-blue-500" : p.effectiveStatus === "failed" ? "bg-rose-500" : "bg-amber-400";
                  const handle = handleFor(p.publishToPage);
                  return (
                    <button
                      key={`sch-${p.id}`}
                      type="button"
                      onClick={() => onSelect?.(it)}
                      title={p.particulars || "(untitled)"}
                      className="block w-full text-left rounded overflow-hidden border border-amber-200 bg-amber-50 hover:border-amber-400 hover:shadow-md transition"
                    >
                      <div className="relative">
                        {p.thumbnailUrl ? (
                          <img src={p.thumbnailUrl} alt="" className="w-full aspect-[3/4] object-cover" />
                        ) : (
                          <div className="w-full aspect-[3/4] bg-amber-100 flex items-center justify-center text-lg text-amber-500">
                            {p.type?.toLowerCase().includes("reel") ? <IconMovie size={20} stroke={1.5} /> :
                              p.type?.toLowerCase().includes("carousel") ? <IconPhoto size={20} stroke={1.5} /> : <IconFileText size={20} stroke={1.5} />}
                          </div>
                        )}
                        <div className={`absolute top-1 left-1 w-1.5 h-1.5 rounded-full ring-2 ring-white ${dot}`} />
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-1 py-1 text-xs text-white tabular-nums text-right">
                          {t}
                        </div>
                      </div>
                      <div className={`text-[8px] px-1 py-0.5 border-t truncate text-center ${handle.color}`}>
                        {handle.short}
                      </div>
                    </button>
                  );
          })}
        </div>
      </div>
    </div>
  );
}

function LegacyQueueRow({ post }: { post: ScheduledPost }) {
  const statusColor =
    post.status === "Published" ? "bg-green-50 text-green-700 border-green-200" :
    post.status === "Publishing" ? "bg-amber-50 text-amber-800 border-amber-200" :
    post.status === "To Be Scheduled" ? "bg-brand-light text-brand border-brand/30" :
    "bg-gray-50 text-gray-600 border-gray-200";

  const when = post.publishedAt || post.scheduleTime;
  const whenLabel = when ? fmtDateTime(when) : "—";

  return (
    <div className="px-5 py-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900 truncate">{post.particulars || "(no title)"}</span>
          <span className={`text-xs font-medium uppercase tracking-wide rounded-full border px-2 py-0.5 ${statusColor}`}>{post.status}</span>
          <span className="text-xs text-gray-400">{post.publishToPage}</span>
        </div>
        {post.caption && <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{post.caption}</div>}
      </div>
      <div className="text-xs text-gray-500 whitespace-nowrap">{whenLabel}</div>
      <div className="flex gap-2 text-xs">
        {post.instagramUrl && <a href={post.instagramUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">IG ↗</a>}
        {post.facebookUrl && <a href={post.facebookUrl.split("\n")[0]} target="_blank" rel="noreferrer" className="text-brand hover:underline">FB ↗</a>}
      </div>
    </div>
  );
}

// Instagram's in-app carousel allows 20 slides, but the Graph API this scheduler
// publishes through still caps carousels at 10 items — so 10 is the hard max here.
// (When Meta raises the API limit, bump this one constant.)
const MAX_MEDIA = 10;
// Ctrl/Cmd+V pastes copied files into Create post's media, like My Day's file boxes
// (Praveen, 28 Oct). Not while typing in a field — that paste is the field's. Only the
// newest uploader on screen takes it.
let pasteOwner = 0;
function MediaUploader({ mediaUrls, setMediaUrls, locked, taskId }: { mediaUrls: string[]; setMediaUrls: (urls: string[]) => void; locked?: boolean; taskId?: string | null }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const dragIdxRef = useRef<number | null>(null); // read in onDrop (state closure would be stale)
  const uploadRef = useRef<(f: File[]) => void>(() => {});
  useEffect(() => {
    if (locked) return;
    const me = ++pasteOwner;
    const onPaste = (e: ClipboardEvent) => {
      if (pasteOwner !== me) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      const files = Array.from(e.clipboardData?.files || []);
      if (!files.length) return;   // ordinary text paste — leave it alone
      e.preventDefault();
      uploadRef.current(pastedName(files));
    };
    document.addEventListener("paste", onPaste);
    return () => { document.removeEventListener("paste", onPaste); if (pasteOwner === me) pasteOwner = 0; };
  }, [locked]);
  // The real media = non-empty urls. We render these as small thumbnails (not URL rows).
  const media = mediaUrls.map((u) => u.trim()).filter(Boolean);
  const isVideo = (u: string) => /\.(mp4|mov|webm)(\?|$)/i.test(u);
  const removeAt = (i: number) => { const nc = media.filter((_, j) => j !== i); setMediaUrls(nc.length ? nc : [""]); };
  // ✕ used to drop a file at once, with no record — a carousel's LinkedIn PDF, shown as
  // "slide 11", went that way (Praveen, 27 Oct). Now it asks first, wants a reason, and
  // the reason goes in the task's history. The file itself stays on the task.
  const fileName = (u: string) => (isPdfUrl(u) ? pdfName(u) : decodeURIComponent(u.split("?")[0].split("/").pop() || "file"));
  const askRemove = async (i: number) => {
    const u = media[i], pdf = isPdfUrl(u);
    const slides = media.filter((x) => !isPdfUrl(x));
    const why = await promptDialog({
      title: `Remove "${fileName(u)}" from this post?`,
      body: pdf ? "This is the LinkedIn PDF — the whole carousel as one document, not an extra slide. Without it LinkedIn gets no carousel. The file stays on the task."
        : `This is slide ${slides.indexOf(u) + 1} of ${slides.length}. The slides after it move up. The file stays on the task.`,
      action: "Remove", danger: true, required: true, label: "Why are you removing it?", placeholder: "e.g. Wrong version — uploading the corrected slide",
    });
    if (!why || !why.trim()) return;
    removeAt(i);
    if (taskId) fetch("/api/marketing-hub/media-removed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId: taskId, file: fileName(u), reason: why.trim() }) }).catch(() => {});
  };
  // Only Meta media counts toward the carousel cap — the PDF goes to LinkedIn.
  const metaCount = media.filter((u) => !isPdfUrl(u)).length;
  // Video slides and pictures are separate sets (Instagram / Facebook), 10 each.
  const vidCount = media.filter((u) => !isPdfUrl(u) && isVideoUrl(u)).length;
  const picCount = metaCount - vidCount;
  const roomLeft = vidCount < MAX_MEDIA || picCount < MAX_MEDIA;
  // Drag-to-reorder the carousel: move the dragged thumbnail into the drop slot.
  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...media];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setMediaUrls(next.length ? next : [""]);
  };

  uploadRef.current = (f) => { void uploadFiles(f); };
  async function uploadFiles(files: FileList | File[]) {
    setUploadError(null);
    setUploading(true);
    try {
      // First, drop the trailing empty URL slot if it exists, so uploads append cleanly
      const base = mediaUrls.filter((u, i) => u.trim() || i === 0 && mediaUrls.length === 1 && !u);
      const filtered = base.length === 1 && !base[0].trim() ? [] : base.filter((u) => u.trim());
      const next = [...filtered];
      for (const file of Array.from(files)) {
        // The cap is Meta's carousel limit; a LinkedIn PDF doesn't use a slot.
        // Videos and pictures are two sets (Instagram / Facebook), 10 each.
        const vid = isVideoUrl(file.name);
        if (!isPdfUrl(file.name) && next.filter((u) => !isPdfUrl(u) && isVideoUrl(u) === vid).length >= MAX_MEDIA) { setUploadError(`Max ${MAX_MEDIA} ${vid ? "video slides" : "pictures"} per post`); break; }
        const up = await uploadSchedulerMedia(await compressImage(file));
        if (!up.ok) { setUploadError(up.error); break; }
        next.push(up.url);
      }
      setMediaUrls(next.length > 0 ? next : [""]);
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const tile = (url: string, i: number, no: number | null) => (
              <div key={url + i}
                draggable={!locked}
                onDragStart={locked ? undefined : () => { dragIdxRef.current = i; setDragIdx(i); }}
                onDragEnter={locked ? undefined : () => setOverIdx(i)}
                onDragOver={locked ? undefined : (e) => e.preventDefault()}
                onDrop={locked ? undefined : () => { const from = dragIdxRef.current; if (from !== null) reorder(from, i); dragIdxRef.current = null; setDragIdx(null); setOverIdx(null); }}
                onDragEnd={locked ? undefined : () => { dragIdxRef.current = null; setDragIdx(null); setOverIdx(null); }}
                title={locked ? undefined : "Drag to reorder"}
                className={`relative group w-16 h-16 flex-shrink-0 rounded overflow-hidden border transition ${locked ? "cursor-default border-gray-200" : "cursor-grab active:cursor-grabbing"} ${!locked && overIdx === i && dragIdx !== i ? "border-brand ring-2 ring-brand" : "border-gray-200"} ${!locked && dragIdx === i ? "opacity-40" : ""}`}>
                {/* A PDF has nothing an <img> can render — it used to fade to a
                    blank tile. Draw it as a labelled document instead. */}
                {isPdfUrl(url)
                  ? <div className="w-full h-full pointer-events-none">
                      <PdfThumb url={url} width={64} fallback={
                        <div className="w-full h-full bg-[#FDECEA] text-[#C0392B] flex flex-col items-center justify-center gap-0.5">
                          <IconFileTypePdf size={22} stroke={1.6} />
                          <span className="text-[9px] font-semibold tracking-wide">PDF</span>
                        </div>} />
                    </div>
                  : isVideo(url)
                  ? <video src={url} className="w-full h-full object-cover pointer-events-none" muted />
                  : <img src={url} alt="" className="w-full h-full object-cover pointer-events-none" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.15"; }} />}
                {no !== null && <span className="absolute bottom-0 left-0 text-xs font-medium bg-black/55 text-white px-1 rounded-tr leading-tight">{no}</span>}
                {!locked && (
                  <button type="button" onClick={() => void askRemove(i)} title="Remove"
                    className="absolute top-0 right-0 w-4 h-4 rounded-bl bg-black/55 text-white text-xs leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-red-600">×</button>
                )}
              </div>
  );
  return (
    <div className="space-y-3">
      {/* Big upload zone — shown only before any media is added (and never when locked) */}
      {!locked && media.length === 0 && (
      <label
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
        }}
        className={`flex items-center justify-center gap-3 border border-dashed rounded px-4 py-3.5 cursor-pointer transition ${
          dragOver ? "border-brand bg-brand-light" : "border-gray-200 bg-[#FCFCFE] hover:border-brand hover:bg-brand-light/40"
        } ${uploading ? "opacity-60 pointer-events-none" : ""}`}
      >
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,video/mp4,application/pdf"
          className="hidden"
          onChange={(e) => { if (e.target.files && e.target.files.length > 0) uploadFiles(e.target.files); e.target.value = ""; }}
        />
        <div className="text-center">
          {uploading ? (
            <div className="text-sm text-brand flex items-center gap-2">
              <span className="inline-block w-3 h-3 border-2 border-brand border-t-transparent rounded-full animate-spin" />
              Uploading…
            </div>
          ) : (
            <>
              <div className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#232D42]">
                <IconPaperclip size={15} stroke={1.9} className="text-brand" />
                Drag, paste or click to upload a file
              </div>
              <div className="text-[11px] text-[#8A92A6] mt-0.5">jpg · png · gif · mp4 · pdf (LinkedIn carousels) · up to 1 GB (videos over 300 MB go to Facebook only)</div>
            </>
          )}
        </div>
      </label>
      )}

      {uploadError && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><IconAlertTriangle size={14} stroke={1.8} className="inline -mt-0.5 mr-1" />{uploadError}</div>
      )}

      {/* Thumbnails fill the full box width; drag to reorder; + tile adds more. */}
      {media.length > 0 && (
        <div>
          {/* Slides and the LinkedIn PDF in separate rows (27 Oct): the PDF is the whole
              carousel as one document, not "slide 11". */}
          {media.some(isPdfUrl) && (
            <div className="flex items-center gap-1.5 text-[12px] mb-1.5"><span className="font-medium text-[#232D42]">Carousel slides</span><span className="text-[#8A92A6]">· {metaCount}</span>
              <span className="text-[10.5px] font-medium rounded-full px-2 py-px bg-brand-light text-[#2138B0]">For Instagram · Facebook</span></div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {media.map((u, i) => ({ u, i })).filter((x) => !isPdfUrl(x.u)).map((x, k) => tile(x.u, x.i, k + 1))}
            {!locked && roomLeft && (
              <label
                onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files); }}
                title="Add media"
                className={`w-16 h-16 flex-shrink-0 rounded border border-dashed flex items-center justify-center cursor-pointer transition ${dragOver ? "border-brand bg-brand-light/40 text-brand" : "border-gray-300 text-gray-400 hover:border-brand hover:text-brand"} ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
                <input type="file" multiple accept="image/jpeg,image/png,image/gif,video/mp4,application/pdf" className="hidden" onChange={(e) => { if (e.target.files && e.target.files.length > 0) uploadFiles(e.target.files); e.target.value = ""; }} />
                {uploading ? <span className="inline-block w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" /> : <IconPlus size={20} stroke={2} />}
              </label>
            )}
          </div>
          {media.some(isPdfUrl) && (
            <div className="mt-3 pt-2.5 border-t border-gray-100">
              <div className="flex items-center gap-1.5 text-[12px] mb-1.5"><span className="font-medium text-[#232D42]">LinkedIn PDF</span>
                <span className="text-[10.5px] font-medium rounded-full px-2 py-px bg-[#E8F1FB] text-[#0A66C2]">For LinkedIn</span></div>
              <div className="flex flex-wrap gap-1.5">{media.map((u, i) => ({ u, i })).filter((x) => isPdfUrl(x.u)).map((x) => tile(x.u, x.i, null))}</div>
            </div>
          )}
          <div className="text-xs text-gray-400 mt-0.5">{locked ? <><IconLock size={12} stroke={1.8} className="inline -mt-0.5 mr-1" />{`${media.length} original creative${media.length === 1 ? "" : "s"} — locked for repost`}</> : `${vidCount && picCount ? `${vidCount}/${MAX_MEDIA} video slides (Instagram) · ${picCount}/${MAX_MEDIA} pictures (Facebook)` : `${metaCount}/${MAX_MEDIA} ${vidCount ? "video slides" : "images"}`} · drag to reorder${roomLeft ? " · tap + to add more" : ""}`}</div>
        </div>
      )}
    </div>
  );
}

// AI caption suggester UI — button first, 3 variant cards when suggestions arrive.
// No auto-trigger; the user is always in control. Cards support "Use this" which
// replaces the caption + appends any missing hashtags, or "Dismiss" to hide the row.
function AISuggestBar({
  brand, contentBrief, caption, suggestions, loading, error, onFetch, onUse, onDismiss,
}: {
  brand: string;
  contentBrief: string;
  caption: string;
  suggestions: Array<{ kind: "tone" | "seo" | "punchy"; caption: string; hashtags: string[]; prediction: Prediction | null }> | null;
  loading: boolean;
  error: string | null;
  onFetch: () => void;
  onUse: (v: { kind: "tone" | "seo" | "punchy"; caption: string; hashtags: string[]; prediction: Prediction | null }) => void;
  onDismiss: () => void;
}) {
  const canFetch = contentBrief.trim().length >= 10 && !loading;
  const kindMeta: Record<string, { emoji: React.ReactNode; label: string; sub: string }> = {
    tone: { emoji: <IconPencil size={16} stroke={1.8} />, label: "Tone-matched", sub: "matches your usual voice" },
    seo: { emoji: <IconTarget size={16} stroke={1.8} />, label: "SEO-optimized", sub: "search-friendly wording" },
    punchy: { emoji: <IconBolt size={16} stroke={1.8} />, label: "Punchier", sub: "shorter, hook-forward" },
  };
  void caption; // reserved for future "compare vs your draft" chip

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onFetch}
          disabled={!canFetch}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${
            canFetch
              ? "bg-gradient-to-r from-brand to-brand-dark text-white hover:opacity-90"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
          title={contentBrief.trim().length < 10 ? "Fill in the 'What's this post about?' field first" : "Generate 3 caption variants"}
        >
          <IconSparkles size={14} stroke={1.8} className="inline -mt-0.5 mr-1" />{loading ? "Thinking…" : "Get 3 AI caption variants"}
        </button>
        {!canFetch && contentBrief.trim().length < 10 && (
          <span className="text-xs text-gray-500">Add a topic in &ldquo;What&apos;s this post about?&rdquo; to enable</span>
        )}
        {suggestions && suggestions.length > 0 && (
          <button type="button" onClick={onDismiss} className="text-xs text-gray-500 hover:text-gray-800 underline">
            Dismiss suggestions
          </button>
        )}
      </div>

      {error && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          Suggestion failed: {error}
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {suggestions.map((v, i) => {
            const meta = kindMeta[v.kind] || { emoji: <IconWand size={16} stroke={1.8} />, label: v.kind, sub: "" };
            return (
              <div key={i} className="bg-white border border-brand/30 rounded-xl p-3 flex flex-col shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-brand flex">{meta.emoji}</span>
                  <div>
                    <div className="text-xs font-semibold text-gray-900">{meta.label}</div>
                    <div className="text-xs text-gray-500">{meta.sub}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-800 whitespace-pre-wrap break-words leading-snug flex-1 mb-2 max-h-56 overflow-y-auto">
                  {v.caption}
                </div>
                {v.hashtags.length > 0 && (
                  <div className="text-xs text-brand mb-2 leading-snug">
                    {v.hashtags.slice(0, 8).map((h) => "#" + h).join(" ")}
                  </div>
                )}
                {v.prediction && v.prediction.basis !== "no-data" && (
                  <div className="bg-brand-light rounded-lg px-2.5 py-1.5 mb-2 text-xs text-brand">
                    <IconTrendingUp size={14} stroke={1.8} className="inline -mt-0.5 mr-1" /><b>Expected reach ~{v.prediction.avgReach.toLocaleString("en-IN")}</b>
                    <div className="text-xs text-brand/80 leading-snug">
                      {v.prediction.basis === "hashtag-overlap" && "strong hashtag match with past posts"}
                      {v.prediction.basis === "topic-keyword" && `topic match on ${v.prediction.matchedPosts} past post${v.prediction.matchedPosts === 1 ? "" : "s"}`}
                      {v.prediction.basis === "recent-avg" && "baseline: last 10 posts on this account"}
                    </div>
                  </div>
                )}
                {v.prediction?.basis === "no-data" && (
                  <div className="text-xs text-gray-500 mb-2">No past-post data yet to score this variant.</div>
                )}
                <button
                  type="button"
                  onClick={() => onUse(v)}
                  className="w-full text-xs px-3 py-2 rounded-lg bg-brand text-white font-medium hover:bg-brand-dark transition"
                >
                  Use this caption
                </button>
              </div>
            );
          })}
        </div>
      )}

      {loading && !suggestions && (
        <div className="text-xs text-brand bg-brand-light border border-brand/30 rounded-lg px-3 py-2">
          Reading your recent captions + generating 3 variants…
        </div>
      )}
    </div>
  );
  void brand; // brand is used indirectly by parent's onFetch; keep for future signature changes
}



// Facebook's counterpart to the reach prediction.

//

// It states what the last posts got rather than forecasting, because Meta serves no

// reach or impressions for Page posts on any current API version — there is nothing

// to forecast from. When the totals are zero it says exactly that: a made-up

// "expected ~0" on every caption would look broken and tell Nandu nothing.

function FacebookBaselinePanel({ b }: { b: FacebookBaseline }) {

  if (!b.available) {

    return (

      <div className="mt-3 rounded-xl border border-gray-200 bg-[#FAFBFC] p-3 text-xs text-gray-500">

        <IconBrandFacebook size={13} stroke={1.8} className="inline -mt-0.5 mr-1" />

        {b.reason || "No Facebook data for this brand."}

      </div>

    );

  }

  const total = b.likes + b.comments + b.shares;

  return (

    <div className="mt-3 rounded-xl border border-brand/30 bg-brand-light/50 p-3 space-y-2">

      <div className="flex items-baseline gap-2 flex-wrap">

        <span className="text-xs uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-white text-brand border border-brand/30">Facebook</span>

        <span className="text-xs uppercase tracking-wide text-brand font-semibold">Last {b.posts} posts</span>

        <span className="text-lg font-semibold tabular-nums text-brand">{total.toLocaleString("en-IN")}</span>

        <span className="text-xs text-brand">engagements · {b.likes} likes · {b.comments} comments · {b.shares} shares</span>

      </div>

      {total > 0 ? (

        <div className="text-xs text-brand/90">

          That is {b.avgEngagement} per post on average.

          {b.best && <> Best recent post got {b.best.engagement} — &ldquo;{b.best.message}&rdquo;</>}

        </div>

      ) : (

        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 leading-relaxed">

          Nothing at all on the last {b.posts} posts — no likes, comments or shares. So there is no

          Facebook history to predict from yet, and no number here would mean anything.

          Meta also serves no reach or impressions for Page posts, so that can&rsquo;t fill the gap.

        </div>

      )}

    </div>

  );

}

function PredictionPanel({ loading, prediction, onAddHashtag }: {
  loading: boolean;
  prediction: Prediction | null;
  onAddHashtag: (tag: string) => void;
}) {
  if (loading && !prediction) {
    return (
      <div className="mt-3 rounded-xl border border-brand/30 bg-brand-light/50 p-3">
        <div className="text-xs text-brand"><IconChartBar size={13} stroke={1.8} className="inline -mt-0.5 mr-1" />Analyzing similar past posts…</div>
      </div>
    );
  }
  if (!prediction) return null;
  if (prediction.basis === "no-data") {
    return (
      <div className="mt-3 rounded-xl border border-brand/30 bg-brand-light/50 p-3">
        <div className="text-xs text-brand"><IconChartBar size={13} stroke={1.8} className="inline -mt-0.5 mr-1" />No past posts yet on this account to predict from.</div>
      </div>
    );
  }

  // Color-code the basis
  const basisChip = prediction.basis === "hashtag-overlap"
    ? { bg: "bg-emerald-100", text: "text-emerald-800", label: "STRONG MATCH" }
    : prediction.basis === "topic-keyword"
      ? { bg: "bg-brand-light", text: "text-brand", label: "TOPIC MATCH" }
      : { bg: "bg-amber-100", text: "text-amber-800", label: "BASELINE" };

  // Coaching messages — different per state
  const lift = prediction.hashtagLift;
  const liftHelps = lift && lift.liftPct > 10;            // hashtags help on this account
  const liftHurts = lift && lift.liftPct < -10;           // hashtags hurt on this account
  const liftNeutral = lift && !liftHelps && !liftHurts;

  let coachingLine: React.ReactNode = null;
  if (!prediction.captionHasHashtags && liftHelps) {
    coachingLine = (
      <><IconBulb size={13} stroke={1.8} className="inline -mt-0.5 mr-1" />Posts with hashtags average <b>{lift!.withAvgReach.toLocaleString("en-IN")}</b> reach vs <b>{lift!.withoutAvgReach.toLocaleString("en-IN")}</b> without — that&apos;s a <b>+{lift!.liftPct}%</b> lift on this account. Try adding 2-3 hashtags.</>
    );
  } else if (!prediction.captionHasHashtags && liftHurts) {
    coachingLine = (
      <><IconBulb size={13} stroke={1.8} className="inline -mt-0.5 mr-1" />On this account, posts <b>without</b> hashtags average <b>{lift!.withoutAvgReach.toLocaleString("en-IN")}</b> reach vs <b>{lift!.withAvgReach.toLocaleString("en-IN")}</b> with — hashtags hurt by <b>{Math.abs(lift!.liftPct)}%</b>. Long-form caption (no hashtags) is the winning style here.</>
    );
  } else if (!prediction.captionHasHashtags && liftNeutral) {
    coachingLine = <><IconBulb size={13} stroke={1.8} className="inline -mt-0.5 mr-1" />Hashtags don&apos;t meaningfully change reach on this account ({lift!.liftPct >= 0 ? "+" : ""}{lift!.liftPct}%). Your call.</>;
  } else if (prediction.captionHasHashtags && prediction.basis === "hashtag-overlap") {
    coachingLine = <><IconCircleCheck size={13} stroke={1.8} className="inline -mt-0.5 mr-1" />You&apos;re using hashtags this account has hit before — strong signal for the prediction.</>;
  } else if (prediction.captionHasHashtags && prediction.basis !== "hashtag-overlap") {
    coachingLine = <><IconAlertTriangle size={13} stroke={1.8} className="inline -mt-0.5 mr-1" />These hashtags are new for this account — no past performance data on them. Prediction falls back to topic/baseline match.</>;
  }

  return (
    <div className="mt-3 rounded-xl border border-brand/30 bg-brand-light/50 p-3 space-y-2">
      {/* Headline numbers */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className={`text-xs uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${basisChip.bg} ${basisChip.text}`}>{basisChip.label}</span>
        <span className="text-xs uppercase tracking-wide text-brand font-semibold">Expected reach</span>
        <span className="text-lg font-semibold tabular-nums text-brand">~{prediction.avgReach.toLocaleString("en-IN")}</span>
        <span className="text-xs text-brand">· {prediction.avgEngagement.toLocaleString("en-IN")} engagements · {prediction.avgLikes.toLocaleString("en-IN")} likes</span>
      </div>

      {/* Match basis explanation */}
      <div className="text-xs text-brand/90">
        {prediction.note}
        {prediction.hashtagsMatched.length > 0 && <> · matched: {prediction.hashtagsMatched.map((t) => `#${t}`).join(" ")}</>}
        {prediction.keywordsMatched.length > 0 && <> · keywords: {prediction.keywordsMatched.join(", ")}</>}
      </div>

      {/* Coaching line */}
      {coachingLine && (
        <div className="text-xs text-brand leading-relaxed pt-1 border-t border-brand/30">{coachingLine}</div>
      )}

      {/* Hashtag suggestions — only when caption has none AND hashtags help */}
      {!prediction.captionHasHashtags && liftHelps && prediction.suggestedHashtags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          <span className="text-xs uppercase tracking-wide text-brand font-medium mr-1">Tap to add:</span>
          {prediction.suggestedHashtags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onAddHashtag(tag)}
              className="text-xs bg-white hover:bg-brand-light border border-brand/40 text-brand rounded-full px-2 py-0.5"
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// AutoTextarea moved to components/AutoTextarea.tsx — the new-task form needs it too.

// Caption box with dictation — captions are the longest thing anyone types here,
// so it is the field where talking actually beats typing. Same behaviour as the
// search palette: speech appends to what is already written.
function CaptionField(props: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string; minHeight?: number;
}) {
  // The shortcut belongs to whichever field you are actually in, so it binds on
  // focus — otherwise both caption boxes and the palette would fight over ⌘D.
  const [focused, setFocused] = useState(false);
  const voice = useVoiceInput({
    onFinalText: (text) => props.onChange(props.value ? `${props.value.trimEnd()} ${text}` : text),
    hotkey: focused,
  });
  return (
    <div className="relative" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
      <AutoTextarea {...props} placeholder={voice.listening ? `Listening — just speak…` : props.placeholder} />
      {voice.supported && (
        <div className="absolute top-1.5 right-1.5">
          <MicButton listening={voice.listening} onClick={voice.toggle} size={16} title={`Dictate (${DICTATE_HOTKEY})`} />
        </div>
      )}
      {voice.interim && <div className="px-3 pb-1 text-xs text-[#B4BAC6]">{voice.interim}…</div>}
      {voice.error && <div className="px-3 pb-1 text-xs text-[#C0392B]">{voice.error}</div>}
    </div>
  );
}

// Themed account picker — a custom popover (dot + label + subtitle, check on
// the selected row) instead of a native <select>, matching My Day's StatusDropdown.
// Account dot colors — matches PreviewCalendar's ACCOUNT_STYLE so an account reads
// the same colour in the Scheduler and the Calendar. Main = brand (was purple).
const PAGE_DOT = (v: string) => pageInfo(v).color;

// Multi-select brand pages — tick one or more to cross-post the same content to
// several GooCampus accounts at once. The first ticked page is the "primary".
function PageCheckboxes({ value, onChange, allowed }: { value: string[]; onChange: (v: string[]) => void; allowed?: string[] | null }) {
  const all = usePublishPages();
  const OPTIONS = allowed ? all.filter((o) => allowed.includes(o.value)) : all;
  // A dropdown, the way Meta's composer does it, rather than three rows sitting
  // open forever. Three pages take 174px of a 600px column to answer a question
  // that is settled once and rarely changed; the trigger says who is selected and
  // the list is one click away when it is not.
  //
  // Measured from their composer: 36px trigger, 4px corners, a bold header over
  // the list, 36px rows, checked rows tinted.
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  function toggle(page: string) {
    // Never let the last one go: a post with no page cannot be published, and an
    // empty trigger reads as broken rather than as a choice.
    if (value.includes(page) && value.length === 1) return;
    onChange(value.includes(page) ? value.filter((p) => p !== page) : [...value, page]);
  }

  const chosen = OPTIONS.filter((o) => value.includes(o.value));
  const summary = chosen.length === 0 ? "Pick a page"
    : chosen.length === 1 ? chosen[0].label
    : chosen.length === OPTIONS.length ? "All three pages"
    : chosen.map((o) => o.label).join(" and ");

  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox"
        className="flex items-center gap-2 w-full h-9 rounded border border-gray-200 bg-white px-3 text-left hover:border-gray-300 focus:border-brand focus:outline-none">
        <span className="flex items-center gap-1 shrink-0">
          {chosen.map((o) => (
            <span key={o.value} className="w-2.5 h-2.5 rounded-full" style={{ background: PAGE_DOT(o.value) }} />
          ))}
        </span>
        <span className="flex-1 min-w-0 truncate text-[14px] text-[#232D42]">{summary}</span>
        <IconChevronDown size={15} stroke={2} className={`shrink-0 text-[#8A92A6] transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div role="listbox" style={{ boxShadow: "0 12px 32px rgba(35,45,66,.16)" }}
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 bg-white border border-gray-200 rounded overflow-hidden">
          <div className="px-3 pt-2.5 pb-1.5 text-[13px] font-semibold text-[#232D42]">Brand pages</div>
          {OPTIONS.map((o) => {
            const checked = value.includes(o.value);
            const isPrimary = value[0] === o.value;
            return (
              <label key={o.value} role="option" aria-selected={checked}
                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer ${checked ? "bg-brand-light" : "hover:bg-[#F6F7FB]"}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(o.value)} className="w-4 h-4 accent-[#3A57E8]" />
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PAGE_DOT(o.value) }} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] leading-4 truncate text-gray-900">{o.label}</span>
                  <span className="block text-[11px] leading-4 text-gray-500 truncate">{o.subtitle}</span>
                </span>
                {checked && value.length > 1 && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-brand shrink-0">{isPrimary ? "Primary" : "Cross-post"}</span>
                )}
              </label>
            );
          })}
        </div>
      )}

      {value.length > 1 && (
        <div className="mt-1.5 text-[11px] text-brand">Cross-posting to {value.length} pages — one post is created per page.</div>
      )}
    </div>
  );
}

// Instagram collaborator input — auto-invites the tagged account(s) when the post
// publishes (up to 3, comma-separated usernames or Instagram profile URLs).
function CollaboratorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // The composer still holds a comma-separated string; the picker works in objects.
  // Converting here keeps the change to this one component instead of threading a
  // new shape through the whole page.
  const chips = value.split(",").map((s) => s.trim().replace(/^@+/, "")).filter(Boolean)
    .map((u) => ({ username: u, name: null, profilePictureUrl: null }));
  return (
    <div>
      <CollaboratorPicker
        value={chips}
        onChange={(next) => onChange(next.map((c) => c.username).join(", "))}
        ownAccounts={OWN_IG_ACCOUNTS}
      />
      <div className="text-xs text-gray-400 mt-1.5">
        Instagram only. Each one is checked against Instagram before it can be added, then invited
        when the post goes live — the credit appears once they accept.
      </div>
    </div>
  );
}

// Themed time picker — 15-min slots in a themed popover (12-hour labels). value is
// the native "HH:MM" 24h string so submit()'s date math is unchanged.
function to12h(hhmm: string) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}
function TimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const slots: string[] = [];
  for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  useEffect(() => {
    if (open && listRef.current) {
      const el = listRef.current.querySelector('[data-sel="1"]') as HTMLElement | null;
      if (el) el.scrollIntoView({ block: "center" });
    }
  }, [open]);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 text-sm rounded-lg border border-gray-200 bg-white px-3 py-2 hover:border-gray-300 ${value ? "text-gray-900" : "text-gray-400"}`}>
        <IconClock size={16} stroke={1.8} className="text-gray-400" />
        <span className="whitespace-nowrap">{value ? to12h(value) : "Time"}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div ref={listRef} className="absolute left-0 bottom-[calc(100%+6px)] z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-1 w-32 max-h-56 overflow-auto">
            {slots.map((s) => (
              <button key={s} type="button" data-sel={s === value ? "1" : undefined} onClick={() => { onChange(s); setOpen(false); }}
                className={`w-full text-left text-xs rounded-lg px-3 py-1.5 ${s === value ? "bg-brand-light/50 text-gray-900 font-medium" : "text-gray-700 hover:bg-gray-50"}`}>
                {to12h(s)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Themed dropdown for simple {value,label} options (e.g. the account filter) —
// a themed popover instead of a native OS <select>.
function PreviewSelect({ value, onChange, options, className, placeholder }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
  className?: string; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value);
  // With a placeholder and nothing chosen, say so in grey instead of silently
  // showing the first option as though it had been picked.
  const current = chosen || (placeholder ? null : options[0]);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 text-xs rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:border-gray-300 text-gray-800 ${className || ""}`}>
        <span className={`truncate ${current ? "" : "text-gray-400"}`}>{current?.label ?? placeholder}</span>
        <IconChevronDown size={14} stroke={2} className={`text-gray-400 transition-transform flex-shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-[calc(100%+6px)] z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-1 min-w-[190px] max-h-72 overflow-auto">
            {options.map((o) => (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full flex items-center gap-2 text-left rounded-lg px-3 py-1.5 text-xs ${o.value === value ? "bg-brand-light/50 font-medium text-gray-900" : "text-gray-700 hover:bg-gray-50"}`}>
                <span className="flex-1">{o.label}</span>
                {o.value === value && <IconCheck size={14} stroke={2.5} className="text-brand flex-shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Official platform brand marks (the real trademark logos, not illustrated icons).
// Inline SVG so they render under the app's strict CSP with no external requests.
function InstagramLogo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Instagram">
      <defs>
        <radialGradient id="igGrad" cx="0.3" cy="1" r="1.25">
          <stop offset="0" stopColor="#FED576" />
          <stop offset="0.26" stopColor="#F47133" />
          <stop offset="0.61" stopColor="#BC3081" />
          <stop offset="1" stopColor="#4C63D2" />
        </radialGradient>
      </defs>
      <path fill="url(#igGrad)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  );
}
function FacebookLogo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Facebook">
      <path fill="#1877F2" d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />
    </svg>
  );
}
function LinkedInLogo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="LinkedIn">
      <path fill="#0A66C2" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
    </svg>
  );
}

// Live post preview, mocked per network. IG = square + handle; FB = text-above-media
// feed post; LinkedIn = professional post with a reaction bar. Caption binds live.
type PreviewPlatform = "instagram" | "facebook" | "linkedin";
type PreviewDevice = "mobile" | "tablet";

const ALL_FORMATS: ("post" | "reel" | "story")[] = ["post", "reel", "story"];
// Shown under the heading when no format can be picked yet, and on hover over one
// that this creative rules out — "why is it greyed out" should never need asking.
const FORMAT_BLOCKED = "Attach one image or video to choose a format.";
const FORMAT_WHY_NOT: Record<"post" | "reel" | "story", string> = {
  post: "Attach a creative first.",
  reel: "A reel is one video — attach a single video file.",
  story: "A story takes up to 10 files — remove some.",
};
const FORMAT_NOTE: Record<"post" | "reel" | "story", string> = {
  post: "Set from your file. A feed post — it stays on the profile.",
  reel: "Set from your file. Instagram publishes a single video as a reel either way; Facebook posts it to the Page as one.",
  story: "Full screen, gone in 24 hours. With several files, each goes out as its own story — all at the same time, in order.",
};
const PREVIEW_SURFACES: { value: PreviewPlatform; label: string }[] = [
  { value: "instagram", label: "Instagram feed" },
  { value: "facebook", label: "Facebook feed" },
  { value: "linkedin", label: "LinkedIn feed" },
];
// Meta names the surface it is showing you — "Facebook Feed preview" — in a
// dropdown, with the device it is drawn at beside it. Three capitalised brand names
// in a segmented control said neither.
function PreviewHeader({ platform, onPlatform, device, onDevice }: {
  platform: PreviewPlatform; onPlatform: (p: PreviewPlatform) => void;
  device: PreviewDevice; onDevice: (d: PreviewDevice) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const current = PREVIEW_SURFACES.find((s) => s.value === platform) || PREVIEW_SURFACES[0];
  return (
    <div className="flex items-center justify-between mb-3">
      <div ref={wrap} className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="inline-flex items-center gap-2 h-9 rounded border border-gray-200 bg-white px-3 text-[14px] text-[#232D42] hover:border-gray-300">
          {current.label} preview
          <IconChevronDown size={15} stroke={2} className={`text-[#8A92A6] transition ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div style={{ boxShadow: "0 12px 32px rgba(35,45,66,.16)" }}
            className="absolute left-0 top-[calc(100%+4px)] z-30 min-w-[180px] bg-white border border-gray-200 rounded overflow-hidden">
            {PREVIEW_SURFACES.map((s) => (
              <button key={s.value} type="button" onClick={() => { onPlatform(s.value); setOpen(false); }}
                className={`block w-full text-left px-3 py-2 text-[13px] ${platform === s.value ? "bg-brand-light text-brand font-medium" : "text-[#232D42] hover:bg-[#F6F7FB]"}`}>
                {s.label} preview
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="inline-flex bg-white border border-gray-200 rounded p-0.5">
        {([["mobile", IconDeviceMobile], ["tablet", IconDeviceTablet]] as const).map(([d, Icon]) => (
          <button key={d} type="button" onClick={() => onDevice(d)} title={`${d[0].toUpperCase()}${d.slice(1)} view`}
            aria-label={`${d} view`} aria-pressed={device === d}
            className={`px-2.5 py-1.5 rounded transition ${device === d ? "bg-brand text-white" : "text-gray-600 hover:text-gray-900"}`}>
            <Icon size={16} stroke={1.8} />
          </button>
        ))}
      </div>
    </div>
  );
}

// A PDF as LinkedIn shows a document post: the real pages, one at a time, with the
// title and page count on top and a progress bar under it. It used to be a pink
// "PDF" card, which showed nothing of what would actually go out (Praveen, 21 Oct).
function PdfDocPreview({ url }: { url: string }) {
  const [pages, setPages] = useState(0);
  const [pg, setPg] = useState(1);
  useEffect(() => {
    let live = true;
    setPg(1); setPages(0);
    pdfPageCount(url).then((n) => { if (live) setPages(n); });
    return () => { live = false; };
  }, [url]);
  const btn = "absolute top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center z-10 disabled:opacity-0";
  return (
    <div className="w-full bg-[#F3F2EF]">
      <div className="px-3 py-1.5 bg-[#1D2226] text-white text-[12px] truncate">
        {pdfName(url).replace(/\.pdf$/i, "").replace(/_/g, " ")}{pages ? ` · ${pages} pages` : ""}
      </div>
      <div className="relative w-full aspect-[4/5]">
        <PdfThumb url={url} page={pg} width={480} fit="contain" badge={false} fallback={
          <div className="w-full h-full bg-[#FDECEA] text-[#C0392B] flex flex-col items-center justify-center gap-2">
            <IconFileTypePdf size={44} stroke={1.4} />
            <div className="text-[12.5px] font-medium px-4 text-center break-all">{pdfName(url)}</div>
          </div>} />
        {pages > 1 && (
          <>
            <button type="button" aria-label="Previous page" disabled={pg <= 1} onClick={() => setPg((p) => p - 1)} className={`${btn} left-2`}><IconChevronLeft size={18} stroke={2.4} /></button>
            <button type="button" aria-label="Next page" disabled={pg >= pages} onClick={() => setPg((p) => p + 1)} className={`${btn} right-2`}><IconChevronRight size={18} stroke={2.4} /></button>
          </>
        )}
      </div>
      {pages > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5">
          <div className="flex-1 h-1 rounded-full bg-gray-300 overflow-hidden"><div className="h-full bg-[#0A66C2]" style={{ width: `${(pg / pages) * 100}%` }} /></div>
          <span className="text-[11px] text-[#5E6670] tabular-nums">{pg} / {pages}</span>
        </div>
      )}
    </div>
  );
}

// A story as Instagram plays it: full-screen 9:16, one bar per frame across the
// top, tap the left side to go back and the right to go on, each picture held five
// seconds and each video for its length. A story of several files used to preview
// as its first file only (Praveen, 4 Nov 2026).
const STORY_IMAGE_MS = 5000;
// Each brand's real profile picture, as Instagram shows it on a story — the same
// day-cached data URIs the brand picker uses (/api/account-avatars, keyed by account
// id, which is the handle). Fetched once per page; no picture → the platform logo.
let storyAvatars: Promise<Record<string, string>> | null = null;
function useStoryAvatar(handle: string): string | null {
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    storyAvatars ??= fetch("/api/account-avatars").then((r) => (r.ok ? r.json() : null)).then((j) => (j?.avatars as Record<string, string>) || {}).catch(() => ({}));
    let live = true;
    storyAvatars.then((m) => { if (live) setMap(m); });
    return () => { live = false; };
  }, []);
  return map[handle.replace(/^@/, "")] || null;
}
function StoryPreview({ frames, handle, platform }: { frames: string[]; handle: string; platform: "instagram" | "facebook" }) {
  const avatar = useStoryAvatar(handle);
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);   // 0–1 through the current frame
  const [paused, setPaused] = useState(false);
  useEffect(() => { setIdx(0); setProgress(0); }, [frames.join("|")]);
  const safeIdx = frames.length ? Math.min(idx, frames.length - 1) : 0;
  const cur = frames[safeIdx] || null;
  const video = !!cur && isVideoUrl(cur);
  const go = (delta: number) => { setProgress(0); setIdx((i) => (i + delta + frames.length) % frames.length); };
  // Pictures run on a clock; videos report their own progress below.
  useEffect(() => {
    if (!cur || video || paused) return;
    const step = 50;
    const t = setInterval(() => setProgress((p) => {
      const n = p + step / STORY_IMAGE_MS;
      if (n >= 1) { setIdx((i) => (i + 1) % frames.length); return 0; }
      return n;
    }), step);
    return () => clearInterval(t);
  }, [cur, video, paused, frames.length]);

  return (
    <div className="relative w-full max-w-[300px] mx-auto aspect-[9/16] bg-black rounded-2xl overflow-hidden select-none"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {cur ? (
        <>
          {/* What isn't 9:16 sits on a blurred copy of itself, the way Instagram fills the screen. */}
          {!video && /* eslint-disable-next-line @next/next/no-img-element */ <img src={cur} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-60" />}
          {video
            ? <video key={cur} src={cur} muted autoPlay playsInline className="absolute inset-0 w-full h-full object-contain"
                onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration) setProgress(v.currentTime / v.duration); }}
                onEnded={() => go(1)} />
            : /* eslint-disable-next-line @next/next/no-img-element */ <img key={cur} src={cur} alt="" className="absolute inset-0 w-full h-full object-contain" />}
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white/60">
          <IconPhoto size={28} stroke={1.6} /><div className="text-[12.5px] font-medium mt-2">Add media to preview</div>
        </div>
      )}

      {/* Top shade, so the bars and the name read on a white picture. */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />
      <div className="absolute top-2 inset-x-2 flex gap-1 z-10">
        {(frames.length ? frames : [""]).map((_, i) => (
          <div key={i} className="flex-1 h-[2px] rounded-full bg-white/35 overflow-hidden">
            <div className="h-full bg-white" style={{ width: `${i < safeIdx ? 100 : i === safeIdx ? progress * 100 : 0}%` }} />
          </div>
        ))}
      </div>
      <div className="absolute top-5 inset-x-3 flex items-center gap-2 z-10 text-white">
        {avatar
          ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={avatar} alt="" className="w-8 h-8 rounded-full object-cover flex-none" />
          : <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center flex-none">{platform === "facebook" ? <FacebookLogo size={32} /> : <InstagramLogo size={20} />}</span>}
        <span className="text-[13px] font-medium truncate">{handle}</span>
        <span className="text-[12px] text-white/70 shrink-0">now</span>
        <span className="ml-auto text-white/90">⋯</span>
        <IconX size={18} stroke={2} className="text-white/90" />
      </div>

      {/* Tap zones: a third on the left goes back, the rest goes on. */}
      {frames.length > 1 && (
        <>
          <button type="button" aria-label="Previous story" onClick={() => go(-1)} className="absolute left-0 top-14 bottom-16 w-1/3 z-[5]" />
          <button type="button" aria-label="Next story" onClick={() => go(1)} className="absolute right-0 top-14 bottom-16 w-2/3 z-[5]" />
        </>
      )}

      <div className="absolute bottom-3 inset-x-3 flex items-center gap-3 z-10 text-white">
        <div className="flex-1 h-10 rounded-full border border-white/60 px-4 flex items-center text-[13px] text-white/85">Send message</div>
        <IconHeart size={24} stroke={1.8} />
        <IconSend size={24} stroke={1.8} />
      </div>
    </div>
  );
}

function SocialPreview({ platform, handle, name, images, caption, device = "mobile", story = false }: {
  platform: PreviewPlatform; handle: string; name: string; images: string[]; caption: string;
  /** Feed width to render at — the same two Meta offers beside their preview. */
  device?: PreviewDevice;
  /** Drawn as a story (every file a frame) instead of a feed post. LinkedIn has no stories. */
  story?: boolean;
}) {
  // A phone feed and a tablet feed wrap a caption differently and crop nothing
  // the same way, which is the only reason to offer the choice at all.
  const shell = `bg-white rounded-2xl border border-gray-100 overflow-hidden mx-auto ${device === "tablet" ? "max-w-[480px]" : "max-w-sm"}`;
  const capNode = caption
    ? <span className="whitespace-pre-wrap">{caption.length > 220 ? caption.slice(0, 220) + "… more" : caption}</span>
    : <span className="text-gray-400 italic">Your caption will appear here</span>;
  // Carousel: swipe through every creative with the arrows. Reset to slide 1 when
  // the media list changes (e.g. switching tasks).
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [images.join("|")]);
  const safeIdx = images.length ? Math.min(idx, images.length - 1) : 0;
  const image = images[safeIdx] || null;
  const go = (delta: number) => setIdx((i) => (i + delta + images.length) % images.length);
  const arrowBtn = "absolute top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center z-10";
  // Show the WHOLE creative — natural aspect, never cropped — with carousel controls.
  // The creative's real shape, read off the file. Everything below used a fixed
  // max-height with object-contain, so a 9:16 reel in a 4:5 slot was letterboxed —
  // the black columns either side of the video. Nothing was wrong with the file.
  const [natural, setNatural] = useState<string | null>(null);
  useEffect(() => { setNatural(null); }, [image]);
  const media = (placeholderRatio: string) => (
    <div className={`relative overflow-hidden flex items-center justify-center ${image ? "bg-gray-50" : `${placeholderRatio} bg-gray-100 flex-col text-gray-300`}`}>
      {image && isPdfUrl(image)
        ? <PdfDocPreview url={image} />
        : image && isVideoUrl(image)
        // A video in an <img> renders nothing at all, which is why the preview went
        // blank the moment a reel was the creative. Muted + playsInline so it can
        // autoplay at all; looped because that is how a reel is watched.
        // autoPlay alone is unreliable here: the element mounts before the source is
        // ready, and Chrome silently declines the attempt. Asking again once there
        // are frames to show is what actually starts it.
        ? <SoundVideo src={image} controls={false}
            style={natural ? { aspectRatio: natural } : undefined}
            onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth) setNatural(`${v.videoWidth} / ${v.videoHeight}`); }}
            className={`w-full block bg-black ${natural ? "h-full object-cover" : "h-auto max-h-[520px] object-contain"}`} />
        : image
        ? <img src={image} alt="" style={natural ? { aspectRatio: natural } : undefined}
            className={`w-full block ${natural ? "h-full object-cover" : "h-auto max-h-[520px] object-contain"}`}
            onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth) setNatural(`${i.naturalWidth} / ${i.naturalHeight}`); }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        : <><div className="w-14 h-14 rounded-full bg-brand-light flex items-center justify-center mb-2.5"><IconPhoto size={24} stroke={1.6} className="text-brand" /></div><div className="text-[12.5px] font-medium text-[#8A92A6]">Add media to preview</div></>}
      {images.length > 1 && (
        <>
          <button type="button" aria-label="Previous" onClick={() => go(-1)} className={`${arrowBtn} left-2`}><IconChevronLeft size={16} stroke={2.5} /></button>
          <button type="button" aria-label="Next" onClick={() => go(1)} className={`${arrowBtn} right-2`}><IconChevronRight size={16} stroke={2.5} /></button>
          <div className="absolute top-2 right-2 bg-black/55 text-white text-xs font-medium px-1.5 py-0.5 rounded-full z-10">{safeIdx + 1}/{images.length}</div>
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1 z-10">
            {images.map((_, i) => <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === safeIdx ? "bg-white" : "bg-white/50"}`} />)}
          </div>
        </>
      )}
    </div>
  );

  if (story && platform !== "linkedin") return <StoryPreview frames={images} handle={handle} platform={platform} />;
  if (platform === "facebook") {
    return (
      <div className={shell}>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <FacebookLogo size={34} />
          <div className="leading-tight"><div className="text-sm font-semibold text-[#232D42]">{name}</div><div className="text-xs text-[#8A92A6] inline-flex items-center gap-1">Just now · <IconWorld size={11} /></div></div>
          <div className="ml-auto text-gray-400">⋯</div>
        </div>
        <div className="px-3 pb-2 text-xs text-[#232D42]">{capNode}</div>
        {media("aspect-[4/5]")}
        <div className="flex items-center justify-around px-3 py-2 text-xs font-medium text-[#8A92A6] border-t border-gray-100">
          <span className="inline-flex items-center gap-1.5"><IconThumbUp size={16} stroke={1.8} /> Like</span><span className="inline-flex items-center gap-1.5"><IconMessageCircle size={16} stroke={1.8} /> Comment</span><span className="inline-flex items-center gap-1.5"><IconShare3 size={16} stroke={1.8} /> Share</span>
        </div>
      </div>
    );
  }
  if (platform === "linkedin") {
    return (
      <div className={shell}>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <LinkedInLogo size={34} />
          <div className="leading-tight"><div className="text-sm font-semibold text-[#232D42]">{name}</div><div className="text-xs text-[#8A92A6] inline-flex items-center gap-1">Promoted · <IconWorld size={11} /></div></div>
          <div className="ml-auto text-gray-400">⋯</div>
        </div>
        <div className="px-3 pb-2 text-xs text-[#232D42]">{capNode}</div>
        {media("aspect-[1.91/1]")}
        <div className="flex items-center justify-around px-3 py-2 text-xs font-medium text-[#8A92A6] border-t border-gray-100">
          <span className="inline-flex items-center gap-1.5"><IconThumbUp size={16} stroke={1.8} /> Like</span><span className="inline-flex items-center gap-1.5"><IconMessageCircle size={16} stroke={1.8} /> Comment</span><span className="inline-flex items-center gap-1.5"><IconRepeat size={16} stroke={1.8} /> Repost</span><span className="inline-flex items-center gap-1.5"><IconSend size={16} stroke={1.8} /> Send</span>
        </div>
      </div>
    );
  }
  // instagram
  return (
    <div className={shell}>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
        <InstagramLogo size={28} />
        <div className="text-sm font-semibold text-[#232D42]">{handle}</div>
        <div className="ml-auto text-gray-400">⋯</div>
      </div>
      {media("aspect-[4/5]")}
      <div className="flex items-center gap-4 px-3 py-2.5 text-[#232D42]"><IconHeart size={22} stroke={1.8} /><IconMessageCircle size={22} stroke={1.8} /><IconSend size={22} stroke={1.8} /><IconBookmark size={22} stroke={1.8} className="ml-auto" /></div>
      <div className="px-3 pb-3 text-xs"><span className="font-semibold mr-1.5 text-[#232D42]">{handle}</span><span className="text-[#232D42]">{capNode}</span></div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded border border-gray-100 p-4">
      <div className="sched-heading text-base leading-5 text-[#232D42]">{title}</div>
      {subtitle && <div className="text-xs text-gray-500 mt-1 mb-2.5">{subtitle}</div>}
      {!subtitle && <div className="mt-2.5" />}
      {children}
    </div>
  );
}
