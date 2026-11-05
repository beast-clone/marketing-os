"use client";
import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { LiveIndicator } from "@/components/LiveIndicator";
import { alertDialog, confirmDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";

type PublishTo = "Facebook" | "Instagram" | "Instagram/Facebook";
type PublishToPage = "GooCampus Main" | "GooCampus World" | "12Plus / GC India";

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
  scheduleTime: string | null;
  status: string;
  effectiveStatus: "scheduled" | "publishing" | "published" | "failed" | "draft" | "unknown";
  failureReason: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  publishedAt: string | null;
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
};

const PAGE_OPTIONS: { value: PublishToPage; label: string; subtitle: string }[] = [
  { value: "GooCampus Main",     label: "GooCampus Main",       subtitle: "@goocampus + 2 FB pages" },
  { value: "GooCampus World",    label: "GooCampus World",      subtitle: "@goocampusworld + GooCampus World page" },
  { value: "12Plus / GC India",  label: "GooCampus India",      subtitle: "@12thplusdotcom + GC India page" },
];

const PUBLISH_TO_OPTIONS: { value: PublishTo; label: string; icon: string }[] = [
  { value: "Instagram/Facebook", label: "Instagram + Facebook", icon: "📱" },
  { value: "Instagram",          label: "Instagram only",       icon: "📸" },
  { value: "Facebook",           label: "Facebook only",        icon: "👍" },
];

export default function SchedulerPage() {
  return (
    <DashboardShell title="Scheduler" subtitle="Create a post → it drops into your calendar and publishes within about a minute." hideAccountPicker>
      {() => <Scheduler />}
    </DashboardShell>
  );
}

function Scheduler() {
  // Form state
  const [particulars, setParticulars] = useState("");
  const [publishToPage, setPublishToPage] = useState<PublishToPage>("GooCampus Main");
  const [publishTo, setPublishTo] = useState<PublishTo>("Instagram/Facebook");
  const [caption, setCaption] = useState("");
  // Content brief — the topic the post is about. Feeds the AI caption suggester
  // so the model can write ON topic instead of averaging tone from mixed past posts.
  const [contentBrief, setContentBrief] = useState("");
  // Suggestion state — 3 variants from Perplexity, only fetched on button click.
  type SuggestVariant = { kind: "tone" | "seo" | "punchy"; caption: string; hashtags: string[]; prediction: Prediction | null };
  const [suggestions, setSuggestions] = useState<SuggestVariant[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<string[]>([""]);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: true; recordId: string } | { ok: false; error: string } | null>(null);

  // Smart features state
  const [timeSuggestions, setTimeSuggestions] = useState<TimeSuggestion[]>([]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [topPerformers, setTopPerformers] = useState<TopPerformer[]>([]);
  const [topModalOpen, setTopModalOpen] = useState(false);
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

  // Real published IG posts (last 20) — shown alongside scheduled posts in the Content Calendar
  const [publishedIG, setPublishedIG] = useState([] as PublishedIG[]);
  useEffect(() => {
    fetch("/api/posts?accountId=goocampus&limit=20&insights=false")
      .then((r) => r.ok ? r.json() : { posts: [] })
      .then((d) => setPublishedIG(d.posts || []))
      .catch(() => {});
  }, []);

  const loadQueue = () => {
    setQueueLoading(true);
    setQueueError(null);
    const t0 = Date.now();
    fetch("/api/scheduler/queue")
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

  // Smart time suggestions — refetch when brand changes
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/scheduler/suggest-time?publishToPage=${encodeURIComponent(publishToPage)}`, { signal: ctrl.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { suggestions?: TimeSuggestion[] } | null) => { if (d?.suggestions) setTimeSuggestions(d.suggestions); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [publishToPage]);

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

  async function openTopPerformers() {
    setTopModalOpen(true);
    if (topPerformers.length > 0) return;
    setTopLoading(true);
    try {
      const r = await fetch(`/api/scheduler/top-performers?publishToPage=${encodeURIComponent(publishToPage)}`);
      const d = await r.json();
      if (d.top) setTopPerformers(d.top);
    } finally { setTopLoading(false); }
  }

  // Named applyTopPerformer, not useTopPerformer: a plain handler whose name starts
  // with "use" trips the rules-of-hooks lint, which reads it as a misplaced hook.
  function applyTopPerformer(p: TopPerformer) {
    setParticulars(`Repost: ${(p.caption || "").slice(0, 60)}`);
    setCaption(p.caption || "");
    if (p.thumbnail) setMediaUrls([p.thumbnail]);
    setTopModalOpen(false);
  }

  const cleanMediaUrls = useMemo(() => mediaUrls.map((u) => u.trim()).filter(Boolean), [mediaUrls]);
  const canSubmit = particulars.trim().length > 0 && caption.trim().length > 0 && cleanMediaUrls.length > 0 && !submitting;

  async function submit() {
    setSubmitting(true);
    setResult(null);
    try {
      let scheduleTimeISO: string | undefined;
      if (scheduleEnabled && scheduleDate && scheduleTime) {
        const local = new Date(`${scheduleDate}T${scheduleTime}:00`);
        if (!Number.isNaN(local.getTime())) scheduleTimeISO = local.toISOString();
      }
      const res = await fetch("/api/scheduler/create-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          particulars: particulars.trim(),
          publishTo,
          publishToPage,
          caption,
          mediaUrls: cleanMediaUrls,
          scheduleTimeISO,
        }),
      });
      const d = await res.json();
      if (!res.ok || d.error) {
        setResult({ ok: false, error: d.error || `HTTP ${res.status}` });
      } else {
        setResult({ ok: true, recordId: d.recordId });
        // Reset minimal fields, keep brand picked
        setParticulars(""); setCaption(""); setMediaUrls([""]); setScheduleEnabled(false); setScheduleDate(""); setScheduleTime("");
        // refresh queue to surface the new row (will appear once n8n syncs)
        setTimeout(loadQueue, 1500);
      }
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  const previewImage = cleanMediaUrls[0] || null;
  const previewHandle = publishToPage === "GooCampus Main" ? "goocampus" :
                        publishToPage === "GooCampus World" ? "goocampusworld" : "12thplusdotcom";

  // Filter derived data for the queue view — computed here so we can also use it for
  // the status-counter strip.
  const queueFiltered = queue.filter((p) => {
    if (filterPage !== "all" && p.publishToPage !== filterPage) return false;
    if (filterInterest !== "all" && p.primaryInterest !== filterInterest) return false;
    if (filterStatus !== "all" && p.effectiveStatus !== filterStatus) return false;
    return true;
  });
  const readyToSchedule = queueFiltered.filter((p) => p.effectiveStatus === "scheduled");
  const publishing = queueFiltered.filter((p) => p.effectiveStatus === "publishing");
  const failed = queueFiltered.filter((p) => p.effectiveStatus === "failed");
  const publishedRecent = queueFiltered
    .filter((p) => p.effectiveStatus === "published")
    .sort((a, b) => new Date(b.publishedAt || b.scheduleTime || 0).getTime() - new Date(a.publishedAt || a.scheduleTime || 0).getTime())
    .slice(0, 20);
  // Populate filter dropdown options from the actual data so we don't hardcode.
  const availablePages = Array.from(new Set(queue.map((p) => p.publishToPage).filter(Boolean))).sort();
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
  async function handlePublishNow(recordId: string) {
    if (!await confirmDialog({ title: "Publish this post now?", body: "It goes out within about a minute.", action: "Publish now" })) return;
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

  return (
    <>
      {/* Header — queue actions strip */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">Post queue</div>
            <div className="text-[11px] text-gray-500">
              Live from your Post Scheduler Airtable table. Fetched <span className="font-medium text-gray-700">{queue.length}</span> row{queue.length === 1 ? "" : "s"} — statuses:{" "}
              {queue.length === 0 ? "—" : Object.entries(queue.reduce((acc: Record<string, number>, p) => { const k = `${p.status || "?"} → ${p.effectiveStatus}`; acc[k] = (acc[k] || 0) + 1; return acc; }, {})).map(([k, v]) => `${k} ×${v}`).join(", ")}
              {queueError && <span className="ml-2 text-rose-600">· FETCH ERROR: {queueError}</span>}
            </div>
          </div>
          <LiveIndicator fetchedAt={queueFetchedAt} latencyMs={queueLatency} loading={queueLoading} onRefresh={loadQueue} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openTopPerformers}
            className="text-xs font-medium bg-white text-violet-700 border border-violet-200 px-3 py-1.5 rounded-lg hover:bg-violet-50"
          >
            ↻ Pick top performer
          </button>
          <button
            onClick={() => setShowCreateForm(true)}
            className="text-xs font-medium bg-brand text-white px-3 py-1.5 rounded-lg hover:bg-brand-dark"
          >
            + Add post
          </button>
        </div>
      </div>

      {/* Status counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatusCounter label="Ready to schedule" count={readyToSchedule.length} color="amber" />
        <StatusCounter label="Publishing" count={publishing.length} color="blue" />
        <StatusCounter label="Published (recent)" count={publishedRecent.length} color="green" />
        <StatusCounter label="Failed" count={failed.length} color="rose" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        <span className="text-gray-500 uppercase tracking-wide font-medium mr-1">Filter:</span>
        <select value={filterPage} onChange={(e) => setFilterPage(e.target.value)}
          className="border border-gray-200 rounded-md px-2 py-1 bg-white">
          <option value="all">All accounts</option>
          {availablePages.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filterInterest} onChange={(e) => setFilterInterest(e.target.value)}
          className="border border-gray-200 rounded-md px-2 py-1 bg-white">
          <option value="all">All primary interests</option>
          {availableInterests.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-gray-200 rounded-md px-2 py-1 bg-white">
          <option value="all">All statuses</option>
          <option value="scheduled">Ready to schedule</option>
          <option value="publishing">Publishing</option>
          <option value="published">Published</option>
          <option value="failed">Failed</option>
        </select>
        {(filterPage !== "all" || filterInterest !== "all" || filterStatus !== "all") && (
          <button onClick={() => { setFilterPage("all"); setFilterInterest("all"); setFilterStatus("all"); }}
            className="text-gray-500 hover:text-gray-800 underline">clear</button>
        )}
      </div>

      {/* MAIN 2-COLUMN — left: queue (2/3); right: content scheduled (1/3, same width as before) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2 space-y-4">
          {failed.length > 0 && (
            <QueueSection
              title="⚠️ Failed — needs attention"
              subtitle={`${failed.length} post${failed.length === 1 ? "" : "s"} that didn't publish`}
              posts={failed}
              onReschedule={handleReschedule}
              onPublishNow={handlePublishNow}
              onEdit={(p) => { setEditingCaptionId(p.id); setEditingCaptionText(p.fullCaption || p.caption || ""); }}
              onScheduleNow={(p) => setScheduleModalPost(p)}
              rowActionId={rowActionId}
              accent="rose"
              expanded
            />
          )}
          {publishing.length > 0 && (
            <QueueSection
              title="🔵 Publishing right now"
              subtitle="Publishing to Meta now"
              posts={publishing}
              onReschedule={handleReschedule}
              onPublishNow={handlePublishNow}
              onEdit={(p) => { setEditingCaptionId(p.id); setEditingCaptionText(p.fullCaption || p.caption || ""); }}
              onScheduleNow={(p) => setScheduleModalPost(p)}
              rowActionId={rowActionId}
              accent="blue"
              expanded
            />
          )}
          <QueueSection
            title="🟡 Ready to schedule"
            subtitle={readyToSchedule.length > 0
              ? `${readyToSchedule.length} post${readyToSchedule.length === 1 ? "" : "s"} waiting — full caption + media below each row`
              : "No posts waiting to schedule. Add one with the button above."}
            posts={readyToSchedule}
            onReschedule={handleReschedule}
            onPublishNow={handlePublishNow}
            onEdit={(p) => { setEditingCaptionId(p.id); setEditingCaptionText(p.fullCaption || p.caption || ""); }}
            onScheduleNow={(p) => setScheduleModalPost(p)}
            rowActionId={rowActionId}
            accent="amber"
            emptyOK
            expanded
          />
        </div>

        {/* RIGHT — content scheduled (same narrow width, tiny 4-per-row tiles) */}
        <div className="lg:col-span-1">
          <MiniPlanner posts={queueFiltered} publishedIG={publishedIG} />
        </div>
      </div>

      {/* Schedule-now modal */}
      {scheduleModalPost && (
        <ScheduleNowModal
          post={scheduleModalPost}
          onClose={() => setScheduleModalPost(null)}
          onConfirm={async (iso, pages) => {
            // Single page → update the row in place. Multiple pages → cross-post
            // (updates original + duplicates once per additional page).
            if (pages.length <= 1) {
              await handleReschedule(scheduleModalPost.id, iso);
            } else {
              setRowActionId(scheduleModalPost.id);
              try {
                const r = await fetch("/api/scheduler/schedule-multi", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ recordId: scheduleModalPost.id, scheduleTime: iso, pages }),
                });
                const d = await r.json();
                if (!r.ok || d.error) alertDialog(`Cross-post failed: ${d.error || "HTTP " + r.status}`);
                else loadQueue();
              } finally { setRowActionId(null); }
            }
            setScheduleModalPost(null);
          }}
        />
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
              className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 font-sans"
            />
            <div className="flex items-center justify-between mt-3">
              <div className="text-[11px] text-gray-500">{editingCaptionText.length} / 2200 characters</div>
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
          <div className="min-h-screen py-8 px-4" onClick={(e) => e.stopPropagation()}>
            <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="text-lg font-semibold">Add a new post</div>
                <button onClick={() => setShowCreateForm(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
              </div>
              {/* Repost-top-performer call-to-action */}
              <div className="mb-4 flex items-center justify-between bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-200 rounded-2xl px-4 py-2.5">
                <div className="text-xs text-violet-900">
                  <span className="font-medium">💡 Want to start from a winner?</span>{" "}
                  <span className="text-violet-700">Pull a top-performing post from the last 90 days and tweak.</span>
                </div>
                <button
                  onClick={openTopPerformers}
                  className="text-xs font-medium bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700"
                >
                  ↻ Pick top performer
                </button>
              </div>

      {/* TWO-COLUMN LAYOUT: form left, preview right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        {/* LEFT — form */}
        <div className="lg:col-span-7 space-y-4">
          <Card title="Post to">
            <div className="space-y-2">
              {PAGE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition ${
                    publishToPage === opt.value ? "border-brand bg-brand-light/40" : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="page"
                    checked={publishToPage === opt.value}
                    onChange={() => setPublishToPage(opt.value)}
                    className="accent-brand"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">{opt.label}</div>
                    <div className="text-xs text-gray-500">{opt.subtitle}</div>
                  </div>
                </label>
              ))}
            </div>
          </Card>

          <Card title="Media" subtitle="Drop a file to upload, or paste a URL (Slack / Drive / direct image / video). For carousels add multiple (max 10).">
            <MediaUploader mediaUrls={mediaUrls} setMediaUrls={setMediaUrls} />
          </Card>

          <Card title="Post details">
            <div className="space-y-3">
              <div>
                <label className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">Internal title (Particulars)</label>
                <input
                  value={particulars}
                  onChange={(e) => setParticulars(e.target.value)}
                  placeholder="e.g. AMC August intake — reel #3"
                  className="w-full mt-1 text-sm rounded-lg border border-gray-200 px-3 py-2"
                />
                <div className="text-[10px] text-gray-400 mt-1">For your team — not shown on Instagram.</div>
              </div>
              {/* Content brief — topic anchor for the AI caption suggester */}
              <div>
                <label className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">📝 What&apos;s this post about? <span className="normal-case text-gray-400 font-normal">(optional — helps AI write better captions)</span></label>
                <textarea
                  value={contentBrief}
                  onChange={(e) => setContentBrief(e.target.value)}
                  placeholder="e.g. New AMC Part 1 syllabus changes for 2026 IMG candidates, focus on OSCE additions and 3-month study plan"
                  rows={2}
                  className="w-full mt-1 text-sm rounded-lg border border-gray-200 px-3 py-2 font-sans"
                />
                <div className="text-[10px] text-gray-400 mt-1">Never sent to Instagram — this is just for you and the AI suggester.</div>
              </div>

              <div>
                <label className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">Caption</label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Write your caption…"
                  rows={6}
                  className="w-full mt-1 text-sm rounded-lg border border-gray-200 px-3 py-2 font-sans"
                />
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>We&apos;ll split this into Instagram / Facebook versions and strip markdown automatically.</span>
                  <span>{caption.length} / 2200</span>
                </div>

                {/* AI suggest button + variants panel */}
                <AISuggestBar
                  brand={publishToPage}
                  contentBrief={contentBrief}
                  caption={caption}
                  suggestions={suggestions}
                  loading={suggestLoading}
                  error={suggestError}
                  onFetch={async () => {
                    setSuggestError(null);
                    setSuggestLoading(true);
                    try {
                      const r = await fetch("/api/scheduler/suggest-caption", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ publishToPage, contentBrief, currentCaption: caption }),
                      });
                      const d = await r.json();
                      if (!r.ok) { setSuggestError(d.error || `HTTP ${r.status}`); setSuggestions(null); }
                      else { setSuggestions((d.variants as SuggestVariant[]) || []); }
                    } catch (e) { setSuggestError((e as Error).message); }
                    finally { setSuggestLoading(false); }
                  }}
                  onUse={(v) => {
                    // Merge caption + hashtags (only append hashtags not already inline)
                    const captionText = v.caption;
                    const inlineTags = new Set((captionText.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.toLowerCase()));
                    const extras = v.hashtags.filter((h) => !inlineTags.has("#" + h.toLowerCase()));
                    setCaption(extras.length > 0 ? `${captionText}\n\n${extras.map((h) => "#" + h).join(" ")}` : captionText);
                    setSuggestions(null);
                  }}
                  onDismiss={() => setSuggestions(null)}
                />

                {/* Existing reach-prediction overlay (as-you-type) */}
                {caption.trim().length > 0 && (
                  <PredictionPanel
                    loading={predictionLoading}
                    prediction={prediction}
                    onAddHashtag={(tag) => setCaption((c) => c.trimEnd() + " #" + tag)}
                  />
                )}
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">Publish to</label>
                <div className="flex gap-2 mt-1">
                  {PUBLISH_TO_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPublishTo(opt.value)}
                      className={`text-xs px-3 py-2 rounded-lg border ${
                        publishTo === opt.value ? "border-brand bg-brand text-white" : "border-gray-200 text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span className="mr-1">{opt.icon}</span>{opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card title="Schedule">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">
                {scheduleEnabled ? "Publish at the exact time below" : "Defaults to ~2 hours from now"}
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
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="text-sm rounded-lg border border-gray-200 px-3 py-2"
                  />
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="text-sm rounded-lg border border-gray-200 px-3 py-2"
                  />
                </div>

                {/* Smart time suggestions */}
                {timeSuggestions.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium mb-1.5">✨ Smart suggestions — when your audience is most online</div>
                    <div className="flex flex-wrap gap-2">
                      {timeSuggestions.map((s, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => applyTimeSuggestion(s)}
                          className="text-xs bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-800 rounded-lg px-3 py-1.5 transition"
                          title={`Next ${s.weekdayLabel} at ${s.hourLabel} — ${s.followersOnline.toLocaleString("en-IN")} followers typically online`}
                        >
                          <span className="font-semibold">{s.weekdayLabel} {s.hourLabel}</span>
                          <span className="text-violet-600 ml-1">· {s.followersOnline.toLocaleString("en-IN")} online</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        {/* RIGHT — Instagram preview */}
        <div className="lg:col-span-5">
          <div className="sticky top-6">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-3">Instagram Feed preview</div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden max-w-sm mx-auto">
              {/* Header */}
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-xs font-medium">
                  {previewHandle.slice(0, 1).toUpperCase()}
                </div>
                <div className="text-sm font-semibold text-gray-900">{previewHandle}</div>
                <div className="ml-auto text-gray-400">⋯</div>
              </div>
              {/* Media */}
              <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                {previewImage ? (
                  <img
                    src={previewImage}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} loading="lazy" decoding="async" />
                ) : (
                  <div className="text-center text-gray-300 p-8">
                    <div className="text-5xl mb-2">🖼️</div>
                    <div className="text-xs">Paste a media URL above to preview</div>
                  </div>
                )}
              </div>
              {/* Action bar */}
              <div className="flex items-center gap-4 px-3 py-2 text-xl">
                <span>♡</span>
                <span>💬</span>
                <span>↗</span>
                <span className="ml-auto">🔖</span>
              </div>
              {/* Caption */}
              <div className="px-3 pb-3 text-xs">
                <span className="font-semibold mr-1.5">{previewHandle}</span>
                <span className="text-gray-800 whitespace-pre-wrap">
                  {caption ? (caption.length > 220 ? caption.slice(0, 220) + "… more" : caption) : <span className="text-gray-400 italic">Your caption will appear here</span>}
                </span>
              </div>
            </div>

            <div className="mt-3 text-[10px] text-gray-400 text-center">
              Carousel slides + reel videos render as the first frame here. The actual post on IG matches your media list.
            </div>
          </div>
        </div>
      </div>

      {/* ACTION BAR */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-5 py-3 flex items-center justify-between mb-8 sticky bottom-2">
        <div className="text-xs text-gray-500">
          {result?.ok === true && <span className="text-green-700">✓ Scheduled. Row <code className="bg-green-50 px-1 rounded">{result.recordId}</code> dropped into Content Calendar.</span>}
          {result?.ok === false && <span className="text-red-700">✗ {result.error}</span>}
          {!result && <span>Goes straight into your publishing queue and publishes within about 2 minutes.</span>}
        </div>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="text-sm font-medium bg-brand text-white px-5 py-2 rounded-lg hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Sending…" : scheduleEnabled ? "Schedule" : "Publish"}
        </button>
      </div>

      {/* Top performer modal */}
      {topModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setTopModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <div className="text-base font-semibold text-gray-900">Top performers</div>
                <div className="text-[11px] text-gray-500">Best posts on {publishToPage} in the last 90 days, by reach. Click one to pre-fill the form.</div>
              </div>
              <button onClick={() => setTopModalOpen(false)} className="text-gray-400 hover:text-gray-900 text-xl">×</button>
            </div>
            <div className="p-5">
              {topLoading && <div className="text-center text-sm text-gray-500 py-8">Loading top performers…</div>}
              {!topLoading && topPerformers.length === 0 && <div className="text-center text-sm text-gray-500 py-8">No posts found in the last 90 days.</div>}
              {!topLoading && topPerformers.length > 0 && (
                <div className="space-y-2">
                  {topPerformers.map((p, i) => (
                    <button
                      key={p.id}
                      onClick={() => applyTopPerformer(p)}
                      className="w-full text-left flex gap-4 p-3 border border-gray-100 rounded-xl hover:border-violet-300 hover:bg-violet-50/30 transition"
                    >
                      <div className="flex-shrink-0">
                        {p.thumbnail ? (
                          <img src={p.thumbnail} alt="" className="w-16 h-16 rounded-lg object-cover" loading="lazy" decoding="async" />
                        ) : (
                          <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400">📷</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-mono font-semibold text-violet-700">#{i + 1}</span>
                          <span className="text-[10px] uppercase tracking-wide text-gray-400">{p.mediaType}</span>
                          <span className="text-[10px] text-gray-400">· {new Date(p.timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                        </div>
                        <div className="text-xs text-gray-700 line-clamp-2">{p.caption || "(no caption)"}</div>
                        <div className="flex items-center gap-4 mt-1.5 text-[11px] text-gray-500">
                          <span><span className="font-semibold text-gray-800">{p.reach.toLocaleString("en-IN")}</span> reach</span>
                          <span>{p.likes.toLocaleString("en-IN")} likes</span>
                          <span>{p.comments.toLocaleString("en-IN")} comments</span>
                          <a href={p.permalink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ml-auto text-violet-600 hover:underline">View ↗</a>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Big status-count tile shown in the strip at the top of the queue view.
function StatusCounter({ label, count, color }: { label: string; count: number; color: "amber" | "blue" | "green" | "rose" }) {
  const tints: Record<string, { bg: string; text: string; ring: string }> = {
    amber: { bg: "bg-amber-50", text: "text-amber-800", ring: "ring-amber-200" },
    blue: { bg: "bg-blue-50", text: "text-blue-800", ring: "ring-blue-200" },
    green: { bg: "bg-emerald-50", text: "text-emerald-800", ring: "ring-emerald-200" },
    rose: { bg: "bg-rose-50", text: "text-rose-800", ring: "ring-rose-200" },
  };
  const t = tints[color];
  return (
    <div className={`rounded-xl px-4 py-3 border border-gray-100 shadow-sm ring-1 ${t.ring} ${t.bg}`}>
      <div className={`text-[10px] uppercase tracking-widest font-semibold ${t.text}`}>{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{count}</div>
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
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <div className="text-[11px] text-gray-500">{subtitle}</div>
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
  const whenLabel = when ? new Date(when).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

  const typeIcon = post.type?.toLowerCase().includes("reel") ? "🎬" :
    post.type?.toLowerCase().includes("carousel") ? "🖼️" : "📄";

  return (
    <div className="px-4 py-3 flex items-start gap-3">
      {/* Column 1 — post name + interest chip + type chip (stacked one below the other) */}
      <div className="w-44 shrink-0">
        <div className="text-sm font-semibold text-gray-900 leading-snug mb-1.5 line-clamp-2">
          {post.particulars || "(no title)"}
        </div>
        {post.primaryInterest && (
          <div className="inline-block text-[10px] bg-violet-50 text-violet-700 rounded-full px-2 py-0.5 mb-1 mr-1">
            {post.primaryInterest}
          </div>
        )}
        {post.type && (
          <div className="inline-block text-[10px] bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">
            {post.type}
          </div>
        )}
        {post.publishToPage && (
          <div className="text-[10px] text-gray-500 mt-1">{post.publishToPage}</div>
        )}
      </div>

      {/* Column 2 — carousel first slide / thumbnail */}
      <div className="w-28 h-28 shrink-0">
        {post.thumbnailUrl ? (
          <img src={post.thumbnailUrl} alt="" className="w-full h-full object-cover rounded-lg border border-gray-100" loading="lazy" decoding="async" />
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
          <div className="text-xs text-gray-400 italic">No caption yet.</div>
        )}
        {post.failureReason && (
          <div className="text-[11px] text-rose-700 mt-2 bg-rose-50 border border-rose-100 rounded px-2 py-1">
            ⚠ {post.failureReason}
          </div>
        )}
      </div>

      {/* Column 4 — status + Schedule now button */}
      <div className="w-36 shrink-0 flex flex-col items-end gap-2">
        <span className={`text-[10px] font-medium uppercase tracking-wide rounded-full border px-2 py-0.5 ${statusColor}`}>
          {statusLabel}
        </span>
        {!readonly && (
          <button
            type="button"
            onClick={() => onScheduleNow?.(post)}
            disabled={busy}
            className="text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-md disabled:opacity-50 whitespace-nowrap"
          >
            📅 Schedule now
          </button>
        )}
        {!readonly && post.scheduleTime && (
          <div className="text-[10px] text-gray-500 text-right leading-tight">
            Current time slot:<br />
            <span className="text-gray-800 font-medium">{whenLabel}</span>
          </div>
        )}
        {readonly && (
          <>
            <div className="text-[10px] text-gray-500 text-right">Published {whenLabel}</div>
            {post.instagramUrl && <a href={post.instagramUrl} target="_blank" rel="noreferrer" className="text-[11px] text-violet-700 hover:underline">View on Instagram ↗</a>}
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
  const ALL_PAGES = ["GooCampus Main", "GooCampus World", "12Plus / GC India"] as const;
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
          <div className="text-sm font-semibold">📅 Schedule this post</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>
        </div>
        <div className="text-[11px] text-gray-500 mb-4 line-clamp-1">{post.particulars || "(no title)"}</div>

        {/* Pages — tick one or more to cross-post */}
        <div className="mb-4">
          <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">
            Publish to {selectedPages.length > 1 && <span className="ml-1 text-violet-700 normal-case font-normal">· cross-posting to {selectedPages.length} pages</span>}
          </div>
          <div className="space-y-1.5">
            {ALL_PAGES.map((page) => {
              const checked = selectedPages.includes(page);
              const handle = page === "GooCampus Main" ? "@goocampus" :
                page === "GooCampus World" ? "@goocampusworld" : "@12thplusdotcom";
              return (
                <label
                  key={page}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition ${
                    checked ? "border-violet-400 bg-violet-50" : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePage(page)}
                    className="w-4 h-4 accent-violet-600"
                  />
                  <div className="flex-1">
                    <div className="text-xs font-medium text-gray-900">{page}</div>
                    <div className="text-[10px] text-gray-500">{handle}</div>
                  </div>
                  {page === post.publishToPage && (
                    <span className="text-[12px] font-medium text-violet-700 uppercase tracking-wide">Original</span>
                  )}
                </label>
              );
            })}
          </div>
          {post.platform && (
            <div className="text-[10px] text-gray-500 mt-1.5">
              Platform: <span className="text-gray-700 font-medium">{post.platform}</span>
            </div>
          )}
        </div>

        {/* Best-time suggestions */}
        <div className="mb-4">
          <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">
            Good times to schedule
            <span className="text-gray-400 normal-case font-normal ml-1">— based on when your audience is most active</span>
          </div>
          {loading && <div className="text-xs text-gray-400 py-2">Loading suggestions…</div>}
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
                    className="w-full flex items-center justify-between text-left bg-white border border-gray-200 hover:border-violet-400 hover:bg-violet-50/40 rounded-lg px-3 py-2 disabled:opacity-50 transition"
                  >
                    <div>
                      <div className="text-sm font-medium text-gray-900">{label}</div>
                      <div className="text-[10px] text-gray-500">{s.followersOnline.toLocaleString()} followers online at {s.hourLabel}</div>
                    </div>
                    <div className="text-xs text-violet-700 font-medium">Schedule →</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Custom time */}
        <div>
          <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">Or pick a custom time</div>
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={customLocal}
              onChange={(e) => setCustomLocal(e.target.value)}
              className="flex-1 text-xs border border-gray-200 rounded-md px-2 py-1.5"
            />
            <button
              onClick={() => customLocal && pickAndConfirm(new Date(customLocal).toISOString())}
              disabled={!customLocal || saving}
              className="text-xs font-medium bg-violet-600 text-white px-3 py-1.5 rounded-md disabled:opacity-50"
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
};

type CalendarItem =
  | { kind: "scheduled"; whenMs: number; post: ScheduledPost }
  | { kind: "published"; whenMs: number; post: PublishedIG };

type CalFilter = "all" | "today" | "yesterday" | "week" | "upcoming";

function MiniPlanner({ posts, publishedIG }: { posts: ScheduledPost[]; publishedIG: PublishedIG[] }) {
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm lg:sticky lg:top-4 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-gray-100 bg-gradient-to-r from-violet-50 to-fuchsia-50">
        <div className="text-[11px] font-semibold text-gray-900 mb-1.5">📅 Content Scheduled</div>
        <div className="flex flex-wrap gap-1">
          {filterChips.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition ${
                filter === c.key
                  ? "bg-violet-600 text-white border-violet-600"
                  : "bg-white text-gray-700 border-gray-200 hover:border-violet-300"
              }`}
            >
              {c.label} <span className={filter === c.key ? "text-violet-100" : "text-gray-400"}>{c.count}</span>
            </button>
          ))}
        </div>
      </div>

      {dayKeys.length === 0 && (
        <div className="p-4 text-center text-[11px] text-gray-400">Nothing matches this filter.</div>
      )}

      <div className="max-h-[calc(100vh-260px)] min-h-[500px] overflow-y-auto p-2 space-y-3">
        {dayKeys.map((key) => {
          const { weekday, date, sub } = fmtDay(key);
          const dayItems = byDay.get(key) || [];
          dayItems.sort((a, b) => b.whenMs - a.whenMs);
          return (
            <div key={key}>
              <div className="flex items-baseline gap-1 mb-1 px-1">
                <div className="text-[10px] font-semibold text-gray-900">{weekday}</div>
                <div className="text-[9px] text-gray-500">{date}</div>
                {sub && <div className="text-[8px] text-violet-700 ml-auto">{sub}</div>}
              </div>
              {/* Super-compact 5-per-row tiles */}
              <div className="grid grid-cols-5 gap-1">
                {dayItems.map((it) => {
                  const t = new Date(it.whenMs).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
                  // Map "Publish To Page" → short handle chip shown under each tile.
                  const handleFor = (page: string): { short: string; color: string } => {
                    if (page === "GooCampus Main") return { short: "@goocampus", color: "bg-violet-50 text-violet-700 border-violet-200" };
                    if (page === "GooCampus World") return { short: "@goocampusworld", color: "bg-sky-50 text-sky-700 border-sky-200" };
                    if (page === "12Plus / GC India") return { short: "@12thplusdotcom", color: "bg-rose-50 text-rose-700 border-rose-200" };
                    return { short: page || "—", color: "bg-gray-50 text-gray-600 border-gray-200" };
                  };
                  if (it.kind === "published") {
                    const p = it.post;
                    const isReel = p.type === "REEL";
                    // Published posts today only come from the goocampus fetch (see loadQueue).
                    const handle = handleFor("GooCampus Main");
                    return (
                      <a
                        key={`pub-${p.id}`}
                        href={p.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={p.caption ? truncate(p.caption, 140) : "View on Instagram"}
                        className="group block rounded-md overflow-hidden border border-gray-200 hover:border-violet-400 hover:shadow-md transition"
                      >
                        <div className="relative">
                          {p.mediaUrl ? (
                            <img src={p.mediaUrl} alt="" className="w-full aspect-[3/4] object-cover" loading="lazy" decoding="async" />
                          ) : (
                            <div className="w-full aspect-[3/4] bg-gray-100 flex items-center justify-center text-lg text-gray-400">
                              {isReel ? "🎬" : p.type === "CAROUSEL_ALBUM" ? "🖼️" : "📄"}
                            </div>
                          )}
                          <div className="absolute top-1 left-1 w-1.5 h-1.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-1 py-1 text-[9px] text-white tabular-nums text-right">
                            {t}
                          </div>
                        </div>
                        <div className={`text-[8px] px-1 py-0.5 border-t truncate text-center ${handle.color}`}>
                          {handle.short}
                        </div>
                      </a>
                    );
                  }
                  const p = it.post;
                  const dot = p.effectiveStatus === "publishing"
                    ? "bg-blue-500" : p.effectiveStatus === "failed" ? "bg-rose-500" : "bg-amber-400";
                  const handle = handleFor(p.publishToPage);
                  return (
                    <div
                      key={`sch-${p.id}`}
                      title={p.particulars || "(untitled)"}
                      className="rounded-md overflow-hidden border border-amber-200 bg-amber-50"
                    >
                      <div className="relative">
                        {p.thumbnailUrl ? (
                          <img src={p.thumbnailUrl} alt="" className="w-full aspect-[3/4] object-cover" loading="lazy" decoding="async" />
                        ) : (
                          <div className="w-full aspect-[3/4] bg-amber-100 flex items-center justify-center text-lg text-amber-500">
                            {p.type?.toLowerCase().includes("reel") ? "🎬" :
                              p.type?.toLowerCase().includes("carousel") ? "🖼️" : "📄"}
                          </div>
                        )}
                        <div className={`absolute top-1 left-1 w-1.5 h-1.5 rounded-full ring-2 ring-white ${dot}`} />
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-1 py-1 text-[9px] text-white tabular-nums text-right">
                          {t}
                        </div>
                      </div>
                      <div className={`text-[8px] px-1 py-0.5 border-t truncate text-center ${handle.color}`}>
                        {handle.short}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LegacyQueueRow({ post }: { post: ScheduledPost }) {
  const statusColor =
    post.status === "Published" ? "bg-green-50 text-green-700 border-green-200" :
    post.status === "Publishing" ? "bg-amber-50 text-amber-800 border-amber-200" :
    post.status === "To Be Scheduled" ? "bg-violet-50 text-violet-700 border-violet-200" :
    "bg-gray-50 text-gray-600 border-gray-200";

  const when = post.publishedAt || post.scheduleTime;
  const whenLabel = when ? new Date(when).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

  return (
    <div className="px-5 py-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900 truncate">{post.particulars || "(no title)"}</span>
          <span className={`text-[10px] font-medium uppercase tracking-wide rounded-full border px-2 py-0.5 ${statusColor}`}>{post.status}</span>
          <span className="text-[10px] text-gray-400">{post.publishToPage}</span>
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

function MediaUploader({ mediaUrls, setMediaUrls }: { mediaUrls: string[]; setMediaUrls: (urls: string[]) => void }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function uploadFiles(files: FileList | File[]) {
    setUploadError(null);
    setUploading(true);
    try {
      // First, drop the trailing empty URL slot if it exists, so uploads append cleanly
      const base = mediaUrls.filter((u, i) => u.trim() || i === 0 && mediaUrls.length === 1 && !u);
      const filtered = base.length === 1 && !base[0].trim() ? [] : base.filter((u) => u.trim());
      const next = [...filtered];
      for (const file of Array.from(files)) {
        if (next.length >= 10) { setUploadError("Max 10 media items per post"); break; }
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch("/api/scheduler/upload-media", { method: "POST", body: fd });
        const d = await r.json();
        if (!r.ok || d.error) { setUploadError(d.error || `HTTP ${r.status}`); break; }
        next.push(d.url);
      }
      setMediaUrls(next.length > 0 ? next : [""]);
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Upload zone */}
      <label
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
        }}
        className={`flex items-center justify-center gap-3 border-2 border-dashed rounded-xl px-4 py-5 cursor-pointer transition ${
          dragOver ? "border-brand bg-brand-light/40" : "border-gray-300 hover:border-brand hover:bg-gray-50"
        } ${uploading ? "opacity-60 pointer-events-none" : ""}`}
      >
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
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
              <div className="text-2xl mb-1">📎</div>
              <div className="text-sm font-medium text-gray-700">Drag a file here or click to upload</div>
              <div className="text-[11px] text-gray-500 mt-0.5">jpg · png · webp · gif · mp4 · mov · webm · up to 50 MB</div>
            </>
          )}
        </div>
      </label>

      {uploadError && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">⚠ {uploadError}</div>
      )}

      {/* OR paste URL */}
      <div className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">— or paste URL —</div>
      <div className="space-y-2">
        {mediaUrls.map((url, i) => (
          <div key={i} className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => { const n = [...mediaUrls]; n[i] = e.target.value; setMediaUrls(n); }}
              placeholder="https://… (image, video, reel, or Slack/Drive link)"
              className="flex-1 text-sm rounded-lg border border-gray-200 px-3 py-2"
            />
            {url.trim() && (
              <span className="text-xs text-green-600 self-center" title="Ready to use">✓</span>
            )}
            {mediaUrls.length > 1 && (
              <button
                type="button"
                onClick={() => setMediaUrls(mediaUrls.filter((_, j) => j !== i))}
                className="text-gray-400 hover:text-red-600 px-2"
                title="Remove"
              >×</button>
            )}
          </div>
        ))}
        {mediaUrls.length < 10 && (
          <button
            type="button"
            onClick={() => setMediaUrls([...mediaUrls, ""])}
            className="text-xs text-brand hover:underline"
          >+ Add another URL (for carousel)</button>
        )}
      </div>
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
  const kindMeta: Record<string, { emoji: string; label: string; sub: string }> = {
    tone: { emoji: "✏️", label: "Tone-matched", sub: "matches your usual voice" },
    seo: { emoji: "🎯", label: "SEO-optimized", sub: "search-friendly wording" },
    punchy: { emoji: "⚡", label: "Punchier", sub: "shorter, hook-forward" },
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
              ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:opacity-90"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
          title={contentBrief.trim().length < 10 ? "Fill in the 'What's this post about?' field first" : "Generate 3 caption variants"}
        >
          {loading ? "✨ Thinking…" : "✨ Get 3 AI caption variants"}
        </button>
        {!canFetch && contentBrief.trim().length < 10 && (
          <span className="text-[10px] text-gray-500">Add a topic in &ldquo;What&apos;s this post about?&rdquo; to enable</span>
        )}
        {suggestions && suggestions.length > 0 && (
          <button type="button" onClick={onDismiss} className="text-[11px] text-gray-500 hover:text-gray-800 underline">
            Dismiss suggestions
          </button>
        )}
      </div>

      {error && (
        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          Suggestion failed: {error}
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {suggestions.map((v, i) => {
            const meta = kindMeta[v.kind] || { emoji: "🪄", label: v.kind, sub: "" };
            return (
              <div key={i} className="bg-white border border-violet-200 rounded-xl p-3 flex flex-col shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">{meta.emoji}</span>
                  <div>
                    <div className="text-xs font-semibold text-gray-900">{meta.label}</div>
                    <div className="text-[10px] text-gray-500">{meta.sub}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-800 whitespace-pre-wrap break-words leading-snug flex-1 mb-2 max-h-56 overflow-y-auto">
                  {v.caption}
                </div>
                {v.hashtags.length > 0 && (
                  <div className="text-[11px] text-violet-700 mb-2 leading-snug">
                    {v.hashtags.slice(0, 8).map((h) => "#" + h).join(" ")}
                  </div>
                )}
                {v.prediction && v.prediction.basis !== "no-data" && (
                  <div className="bg-violet-50 rounded-lg px-2.5 py-1.5 mb-2 text-[11px] text-violet-900">
                    📈 <b>Expected reach ~{v.prediction.avgReach.toLocaleString("en-IN")}</b>
                    <div className="text-[10px] text-violet-700/80 leading-snug">
                      {v.prediction.basis === "hashtag-overlap" && "strong hashtag match with past posts"}
                      {v.prediction.basis === "topic-keyword" && `topic match on ${v.prediction.matchedPosts} past post${v.prediction.matchedPosts === 1 ? "" : "s"}`}
                      {v.prediction.basis === "recent-avg" && "baseline: last 10 posts on this account"}
                    </div>
                  </div>
                )}
                {v.prediction?.basis === "no-data" && (
                  <div className="text-[11px] text-gray-500 mb-2">No past-post data yet to score this variant.</div>
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
        <div className="text-[11px] text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
          Reading your recent captions + generating 3 variants…
        </div>
      )}
    </div>
  );
  void brand; // brand is used indirectly by parent's onFetch; keep for future signature changes
}

function PredictionPanel({ loading, prediction, onAddHashtag }: {
  loading: boolean;
  prediction: Prediction | null;
  onAddHashtag: (tag: string) => void;
}) {
  if (loading && !prediction) {
    return (
      <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
        <div className="text-xs text-violet-700">📊 Analyzing similar past posts…</div>
      </div>
    );
  }
  if (!prediction) return null;
  if (prediction.basis === "no-data") {
    return (
      <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
        <div className="text-xs text-violet-700">📊 No past posts yet on this account to predict from.</div>
      </div>
    );
  }

  // Color-code the basis
  const basisChip = prediction.basis === "hashtag-overlap"
    ? { bg: "bg-emerald-100", text: "text-emerald-800", label: "STRONG MATCH" }
    : prediction.basis === "topic-keyword"
      ? { bg: "bg-violet-100", text: "text-violet-800", label: "TOPIC MATCH" }
      : { bg: "bg-amber-100", text: "text-amber-800", label: "BASELINE" };

  // Coaching messages — different per state
  const lift = prediction.hashtagLift;
  const liftHelps = lift && lift.liftPct > 10;            // hashtags help on this account
  const liftHurts = lift && lift.liftPct < -10;           // hashtags hurt on this account
  const liftNeutral = lift && !liftHelps && !liftHurts;

  let coachingLine: React.ReactNode = null;
  if (!prediction.captionHasHashtags && liftHelps) {
    coachingLine = (
      <>💡 Posts with hashtags average <b>{lift!.withAvgReach.toLocaleString("en-IN")}</b> reach vs <b>{lift!.withoutAvgReach.toLocaleString("en-IN")}</b> without — that&apos;s a <b>+{lift!.liftPct}%</b> lift on this account. Try adding 2-3 hashtags.</>
    );
  } else if (!prediction.captionHasHashtags && liftHurts) {
    coachingLine = (
      <>💡 On this account, posts <b>without</b> hashtags average <b>{lift!.withoutAvgReach.toLocaleString("en-IN")}</b> reach vs <b>{lift!.withAvgReach.toLocaleString("en-IN")}</b> with — hashtags hurt by <b>{Math.abs(lift!.liftPct)}%</b>. Long-form caption (no hashtags) is the winning style here.</>
    );
  } else if (!prediction.captionHasHashtags && liftNeutral) {
    coachingLine = <>💡 Hashtags don&apos;t meaningfully change reach on this account ({lift!.liftPct >= 0 ? "+" : ""}{lift!.liftPct}%). Your call.</>;
  } else if (prediction.captionHasHashtags && prediction.basis === "hashtag-overlap") {
    coachingLine = <>✅ You&apos;re using hashtags this account has hit before — strong signal for the prediction.</>;
  } else if (prediction.captionHasHashtags && prediction.basis !== "hashtag-overlap") {
    coachingLine = <>⚠️ These hashtags are new for this account — no past performance data on them. Prediction falls back to topic/baseline match.</>;
  }

  return (
    <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-2">
      {/* Headline numbers */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className={`text-[12px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${basisChip.bg} ${basisChip.text}`}>{basisChip.label}</span>
        <span className="text-[10px] uppercase tracking-wide text-violet-600 font-semibold">Expected reach</span>
        <span className="text-lg font-bold tabular-nums text-violet-900">~{prediction.avgReach.toLocaleString("en-IN")}</span>
        <span className="text-xs text-violet-700">· {prediction.avgEngagement.toLocaleString("en-IN")} engagements · {prediction.avgLikes.toLocaleString("en-IN")} likes</span>
      </div>

      {/* Match basis explanation */}
      <div className="text-[11px] text-violet-700/90">
        {prediction.note}
        {prediction.hashtagsMatched.length > 0 && <> · matched: {prediction.hashtagsMatched.map((t) => `#${t}`).join(" ")}</>}
        {prediction.keywordsMatched.length > 0 && <> · keywords: {prediction.keywordsMatched.join(", ")}</>}
      </div>

      {/* Coaching line */}
      {coachingLine && (
        <div className="text-[11px] text-violet-800 leading-relaxed pt-1 border-t border-violet-200">{coachingLine}</div>
      )}

      {/* Hashtag suggestions — only when caption has none AND hashtags help */}
      {!prediction.captionHasHashtags && liftHelps && prediction.suggestedHashtags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          <span className="text-[10px] uppercase tracking-wide text-violet-600 font-medium mr-1">Tap to add:</span>
          {prediction.suggestedHashtags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onAddHashtag(tag)}
              className="text-[11px] bg-white hover:bg-violet-100 border border-violet-300 text-violet-700 rounded-full px-2 py-0.5"
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="text-sm font-semibold text-gray-900">{title}</div>
      {subtitle && <div className="text-[11px] text-gray-500 mt-0.5 mb-3">{subtitle}</div>}
      {!subtitle && <div className="mt-3" />}
      {children}
    </div>
  );
}
