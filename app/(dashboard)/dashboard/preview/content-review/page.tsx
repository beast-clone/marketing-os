"use client";
import { LoadingBlock } from "@/components/LoadingBlock";
import { MultiPick, isPickNone } from "@/components/MultiPick";
import { useSbus } from "@/lib/use-sbus";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useListCursor } from "@/app/(dashboard)/dashboard/preview/Shortcuts";
import { Markdown, plainText } from "@/components/Markdown";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { CreativeThumb } from "@/components/CreativeThumb";
import { PdfThumb, isPdf, pdfPageCount } from "@/components/PdfThumb";
import { fmtDate } from "@/lib/date";
import { SoundVideo } from "@/components/SoundVideo";
import MissingFieldsModal, { gateFromResponse, type GateBlock } from "../MissingFieldsModal";
import { CopyLink, taskLinkPath } from "../CopyLink";
import {
  IconChecklist, IconRefresh, IconCalendarPlus, IconArrowBackUp,
  IconClipboardCheck, IconLayoutGrid, IconTable, IconX, IconChevronLeft, IconChevronRight, IconCalendarEvent, IconPlayerPlayFilled,
} from "@tabler/icons-react";

// When it is meant to go out — a chip on the image's top-right, opposite the type
// chip: "Today", "Tomorrow", "Fri 23 Oct", or "Overdue · Mon 19 Oct" (Praveen, 21 Oct).
function PubDate({ date }: { date: string | null }) {
  if (!date) return null;
  const d = new Date(date.slice(0, 10) + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const nice = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const [label, cls] = days < 0 ? [`Overdue · ${nice}`, "text-[#C0201F] bg-[#FDECEC]"]
    : days === 0 ? ["Today", "text-amber-700 bg-amber-50"]
    : days === 1 ? ["Tomorrow", "text-[#2138B0] bg-brand-light"]
    : [nice, "text-[#4A5468] bg-white"];
  return (
    <span className={`absolute top-2 right-2 z-10 inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-2 py-0.5 whitespace-nowrap ${cls}`}>
      <IconCalendarEvent size={12} stroke={1.9} />{label}
    </span>
  );
}

// A media URL is a video if its extension says so (fall back to the post type when
// the URL carries no extension, e.g. a signed storage link for a reel).
// A creative handed in as a Google Drive link (the speaking reels) has no file here
// to show. Drive serves a thumbnail and an embeddable player for a shared file, so
// the card and the preview use those instead of a blank tile (Praveen, 21 Oct).
function driveFileId(link: string | null | undefined): string | null {
  const m = (link || "").match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/);
  return m ? m[1] : null;
}
const cardThumb = (p: { thumbnailUrl: string | null; assetLink: string | null }) => {
  const id = driveFileId(p.assetLink);
  return p.thumbnailUrl || (id ? `/api/content-review/drive-thumb?id=${id}` : null);
};

function isVideoUrl(u: string | undefined, type: string | null): boolean {
  if (u && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u)) return true;
  if (u) return false;
  return /reel|video/i.test(type || "");
}

// "Content Review" — the human gate between production and scheduling. A post lands
// here the moment it's marked "Output - Ready". The social-media reviewer approves it
// (Push to Schedule -> "Ready to Publish", which is what the Scheduler picks up) or
// bounces it (Send back -> "Incorporating Feedback"). Nothing reaches the Scheduler
// until it's pushed from here, so a not-final output never has to be pulled back out.

type ReviewPost = {
  id: string; title: string; status: string; sbu: string | null; type: string | null;
  owner: string | null; caption: string | null; content: string | null;
  mediaUrls: string[]; assetLink: string | null; thumbnailUrl: string | null;
  hasCreative: boolean; publishingDate: string | null; updatedAt: string | null;
  changedAfterApproval?: string | null;
};

// Back in review because the creative changed after it had been approved.
function ChangedChip({ p }: { p: ReviewPost }) {
  if (!p.changedAfterApproval) return null;
  return <span title="Its creative was added, removed or replaced after it was approved — check the new version" className="inline-flex items-center text-[11px] font-medium rounded-full px-2 py-0.5 bg-amber-50 text-amber-700 whitespace-nowrap flex-shrink-0">Changed after approval</span>;
}


function typeChip(t: string | null) {
  const s = (t || "").toLowerCase();
  if (s.includes("reel")) return { bg: "#FBEAF0", fg: "#993556" };
  if (s.includes("carousel")) return { bg: "#E9ECFB", fg: "#3A57E8" };
  if (s.includes("youtube")) return { bg: "#FDE8E8", fg: "#B01919" };
  if (s.includes("story")) return { bg: "#E4F4FD", fg: "#0B6EA8" };
  return { bg: "#E6F1FF", fg: "#2B6AB0" };
}

export default function ContentReviewPage() {
  return (
    <PreviewDashboardShell
      active="content-review"
      title="Content Review"
      subtitle="Produced content awaiting a final check before it can be scheduled."
      hideAccountPicker
      hideRange
    >
      {() => <Review />}
    </PreviewDashboardShell>
  );
}

function Review() {
  const [posts, setPosts] = useState<ReviewPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // Completeness gate (422) — the itemized popup, shared with My Day / the hub.
  const [gate, setGate] = useState<GateBlock | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null); // post id being sent back with notes
  const [feedbackText, setFeedbackText] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [openPost, setOpenPost] = useState<ReviewPost | null>(null); // preview modal
  // The preview frame takes the creative's own shape (read off the first slide), so a
  // square post isn't left between dark bands in a tall frame (28 Oct). Instagram
  // shows every carousel slide at the first one's shape, so that one decides.
  const [mediaRatio, setMediaRatio] = useState<string | null>(null);
  useEffect(() => { setMediaRatio(null); }, [openPost?.id]);
  const takeRatio = (w: number, h: number) => { if (w && h) setMediaRatio(`${w} / ${h}`); };
  const [slide, setSlide] = useState(0); // carousel page index in the preview

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/content-review", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setPosts((d.posts as ReviewPost[]) || []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSlide(0); trackRef.current?.scrollTo({ left: 0 }); }, [openPost]); // reset carousel page each time a post opens
  // The preview is a swipeable strip: trackpad/touch swipe, mouse drag, arrows or
  // dots all move it. A PDF counts one slide per page (Praveen, 21 Oct).
  const trackRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [pdfPages, setPdfPages] = useState<Record<string, number>>({});
  useEffect(() => {
    for (const u of openPost?.mediaUrls || []) {
      if (!isPdf(u) || pdfPages[u]) continue;
      pdfPageCount(u).then((n) => setPdfPages((m) => ({ ...m, [u]: Math.max(1, n) })));
    }
  }, [openPost, pdfPages]);
  const goSlide = (i: number) => {
    const t = trackRef.current;
    if (t) t.scrollTo({ left: i * t.clientWidth, behavior: "smooth" });
  };
  // Esc closes the preview modal.
  useEffect(() => {
    if (!openPost) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenPost(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPost]);

  // Move a post to a new status via the whitelisted update API, then drop it from the
  // queue. Surfaces the server error instead of failing silently (an approval that
  // didn't actually persist must never look like it succeeded).
  async function move(id: string, status: string, label: string, feedback?: string, title?: string) {
    setBusyId(id);
    setErr(null);
    try {
      const fields: Record<string, unknown> = { status };
      // Send-back carries Manya's notes into custom.incorporating_feedback (spec §7)
      // so the producer sees them highlighted on their My Day task.
      if (feedback && feedback.trim()) fields.custom = { incorporating_feedback: feedback.trim() };
      const res = await fetch("/api/marketing-hub/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, fields }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 422 = a completeness gate. The server already listed exactly what's
        // missing; show that list instead of collapsing it to one line of banner.
        const block = gateFromResponse(res.status, d, title || "This post");
        if (block) { setGate(block); return; }
        throw new Error((d as { error?: string }).error || `HTTP ${res.status}`);
      }
      setPosts((p) => p.filter((x) => x.id !== id));
      setFeedbackFor(null);
      setFeedbackText("");
      setOpenPost(null); // the post left the queue — close its preview if open
    } catch (e) {
      setErr(`${label} failed: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  // Samvaya / other-platform work is a SEPARATE business — it must never sit mixed
  // into the GooCampus review queue (same rule as the My Day timeline). Split it out
  // by interest (SBU) and give it its own clearly-labelled section below.
  // Samvaya Matrimony posts to its own linked page now (3 Nov), so it is reviewed in
  // the same queue as every other Primary Interest instead of a block of its own.
  const allMain = posts;

  // SBU filter — "even here create filters by SBU" (Manya, 5 Oct), then "like you
  // have added in content calendar" (10 Oct): the earlier chips hid themselves when
  // only one brand was waiting, so she never saw them. Now it's the calendar's own
  // dropdown, always there, listing every brand (with 0 where nothing is waiting).
  //
  // Deliberately NOT remembered between visits, unlike the calendar's filters.
  // This is a queue of work waiting on her: a filter that quietly persisted could
  // hide a post that arrived while she was away.
  const allSbus = useSbus();
  const [sbuSel, setSbuSel] = useState<string[]>([]);
  const sbuOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of allSbus) m.set(k, 0);
    for (const p of allMain) { const k = (p.sbu || "").trim(); if (k) m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }));
  }, [allMain, allSbus]);
  const mainPosts = sbuSel.length ? allMain.filter((p) => sbuSel.includes((p.sbu || "").trim())) : allMain;

  // Arrows or J/K walk the queue, Enter opens what you are on. The queue is the
  // one screen here that is worked straight through, one item after another, so
  // reaching for the mouse between each is most of the effort.
  const { cursor, setCursor } = useListCursor(mainPosts.length, (i) => setOpenPost(mainPosts[i]));

  const renderRow = (p: ReviewPost, index: number) => {
    const tc = typeChip(p.type);
    const busy = busyId === p.id;
    return (
      <Fragment key={p.id}>
        <tr data-cursor={index} onClick={() => { setCursor(index); setOpenPost(p); }}
          className={`border-b border-gray-50 cursor-pointer ${index === cursor ? "bg-brand-light/60" : "hover:bg-gray-50/60"}`}>
          <td className="px-4 py-2.5">
            <span className="inline-flex text-[11px] font-semibold rounded-md px-2 py-0.5" style={{ background: tc.bg, color: tc.fg }}>{p.type || "Post"}</span>
          </td>
          <td className="px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-md bg-[#F6F7FB] overflow-hidden flex-shrink-0 relative">
                {p.thumbnailUrl && isPdf(p.thumbnailUrl)
                  ? <PdfThumb url={p.thumbnailUrl} fallback={<CreativeThumb assetLink={p.assetLink} type={p.type} title={p.title} seed={p.id} />} />
                  : <CreativeThumb thumbnailUrl={cardThumb(p)} assetLink={p.assetLink} type={p.type} title={p.title} seed={p.id} />}
              </span>
              <span className="text-[#232D42] font-medium max-w-[380px] truncate">{p.title || "Untitled"}</span>
              <ChangedChip p={p} />
            </div>
          </td>
          <td className="px-4 py-2.5">
            {p.sbu ? <span className="inline-flex text-[11px] font-semibold rounded-full px-2.5 py-1 bg-brand-light text-[#2138B0]">{p.sbu}</span> : <span className="text-gray-300">—</span>}
          </td>
          <td className="px-4 py-2.5">
            {p.hasCreative ? <span className="text-emerald-700 text-xs font-medium">✓ Attached</span> : <span className="text-amber-700 text-xs bg-amber-50 rounded-md px-2 py-0.5">No creative</span>}
          </td>
          <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 justify-end">
              <button disabled={busy} onClick={() => move(p.id, "Ready to Publish", "Push to Schedule", undefined, p.title)} title="Approve and send to the Scheduler" className="flex items-center gap-1.5 text-xs font-medium text-white bg-brand rounded-lg px-3 py-1.5 hover:bg-[#2138B0] disabled:opacity-40 disabled:cursor-not-allowed">
                <IconCalendarPlus size={14} stroke={1.9} /> Push to Schedule
              </button>
              <button disabled={busy} onClick={() => { setFeedbackFor(feedbackFor === p.id ? null : p.id); setFeedbackText(""); }} className="flex items-center gap-1.5 text-xs font-medium text-[#4A5468] border border-gray-200 rounded-lg px-3 py-1.5 hover:border-brand hover:text-brand disabled:opacity-40">
                <IconArrowBackUp size={14} stroke={1.9} /> Send back
              </button>
              <CopyLink path={taskLinkPath(p.id)} iconOnly className="!w-7 !h-7" />
            </div>
          </td>
        </tr>
        {feedbackFor === p.id && (
          <tr className="bg-rose-50/40 border-b border-gray-50">
            <td colSpan={5} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <input autoFocus value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} placeholder="What needs changing? (the producer sees this on their task)" className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                <button disabled={busy || !feedbackText.trim()} onClick={() => move(p.id, "Incorporating Feedback", "Send back", feedbackText, p.title)} className="flex items-center gap-1.5 text-sm font-medium text-white bg-[#C0201F] rounded-lg px-3 py-2 hover:bg-[#9E1A19] disabled:opacity-40 whitespace-nowrap">
                  <IconArrowBackUp size={15} stroke={1.9} /> Send back with feedback
                </button>
                <button onClick={() => { setFeedbackFor(null); setFeedbackText(""); }} className="text-sm font-medium text-[#4A5468] border border-gray-200 rounded-lg px-3 py-2 hover:border-brand hover:text-brand">Cancel</button>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const renderCard = (p: ReviewPost, index: number) => {
    const tc = typeChip(p.type);
    const busy = busyId === p.id;
    const on = index === cursor;
    return (
      <div
        key={p.id}
        data-cursor={index}
        onClick={() => { setCursor(index); setOpenPost(p); }}
        className={`rounded-xl border bg-white overflow-hidden flex flex-col cursor-pointer ${on ? "border-brand ring-1 ring-brand/30" : "border-gray-100"}`}
      >
        {/* Media preview */}
        {/* The whole creative, letterboxed — same card size, nothing cut off (Praveen, 21 Oct). */}
        <div className="aspect-[4/3] bg-[#F6F7FB] relative overflow-hidden">
          {p.thumbnailUrl && isPdf(p.thumbnailUrl)
                  ? <PdfThumb url={p.thumbnailUrl} fit="contain" fallback={<CreativeThumb assetLink={p.assetLink} type={p.type} title={p.title} seed={p.id} />} />
                  : <CreativeThumb thumbnailUrl={cardThumb(p)} fit="contain" assetLink={p.assetLink} type={p.type} title={p.title} seed={p.id} />}
          <span
            className="absolute top-2 left-2 text-[11px] font-semibold rounded-md px-2 py-0.5"
            style={{ background: tc.bg, color: tc.fg }}
          >
            {p.type || "Post"}
          </span>
          <PubDate date={p.publishingDate} />
        </div>

        {/* Body */}
        <div className="p-3.5 flex flex-col gap-2 flex-1">
          <div className="text-sm font-medium text-[#232D42] leading-snug line-clamp-2">
            {p.title || "Untitled"}
          </div>
          {p.changedAfterApproval && <div><ChangedChip p={p} /></div>}
          {p.sbu && (
            <div>
              <span className="inline-flex items-center text-[11px] font-semibold rounded-full px-2.5 py-1 bg-brand-light text-[#2138B0]">
                {p.sbu}
              </span>
            </div>
          )}
          {p.caption
            ? <p className="text-xs text-[#8A92A6] line-clamp-2">{plainText(p.caption)}</p>
            : /story/i.test(p.type || "") ? <p className="text-xs text-[#8A92A6]">Story — no caption needed</p>
            : <p className="text-xs text-amber-700">No caption yet</p>}
          {!p.hasCreative && (
            <div className="text-xs text-amber-700 bg-amber-50 rounded-md px-2 py-1">
              No creative attached — add media before scheduling.
            </div>
          )}

          {/* Actions */}
          {feedbackFor === p.id ? (
            /* Send-back needs feedback notes (spec §7) — they land highlighted
               on the producer's My Day task. */
            <div className="mt-auto pt-1 flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
              <textarea
                autoFocus
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="What needs changing? (the producer sees this on their task)"
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
              />
              <div className="flex items-center gap-2">
                <button
                  disabled={busy || !feedbackText.trim()}
                  onClick={() => move(p.id, "Incorporating Feedback", "Send back", feedbackText, p.title)}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium text-white bg-[#C0201F] rounded-lg px-3 py-2 hover:bg-[#9E1A19] disabled:opacity-40"
                >
                  <IconArrowBackUp size={15} stroke={1.9} /> Send back with feedback
                </button>
                <button onClick={() => { setFeedbackFor(null); setFeedbackText(""); }} className="text-sm font-medium text-[#4A5468] border border-gray-200 rounded-lg px-3 py-2 hover:border-brand hover:text-brand">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-1" onClick={(e) => e.stopPropagation()}>
              <button
                disabled={busy}
                onClick={() => move(p.id, "Ready to Publish", "Push to Schedule", undefined, p.title)}
                title="Approve and send to the Scheduler"
                className="flex-auto whitespace-nowrap flex items-center justify-center gap-1.5 text-sm font-medium text-white bg-brand rounded-lg px-2 py-2 hover:bg-[#2138B0] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <IconCalendarPlus size={15} stroke={1.9} className="flex-shrink-0" /> Push to Schedule
              </button>
              <button
                disabled={busy}
                onClick={() => { setFeedbackFor(p.id); setFeedbackText(""); }}
                title="Send back to the producer with feedback"
                className="flex-auto whitespace-nowrap flex items-center justify-center gap-1.5 text-sm font-medium text-[#4A5468] border border-gray-200 rounded-lg px-2 py-2 hover:border-brand hover:text-brand disabled:opacity-40"
              >
                <IconArrowBackUp size={15} stroke={1.9} /> Send back
              </button>
              <CopyLink path={taskLinkPath(p.id)} iconOnly className="!h-[38px] !w-[38px]" />
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderTable = (list: ReviewPost[]) => (
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead className="bg-gray-50 border-b border-gray-100 text-[#8A92A6] text-left">
          <tr>
            <th className="px-4 py-2.5 font-medium">Type</th>
            <th className="px-4 py-2.5 font-medium">Post</th>
            <th className="px-4 py-2.5 font-medium">Interest</th>
            <th className="px-4 py-2.5 font-medium">Creative</th>
            <th className="px-4 py-2.5 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>{list.map((p, i) => renderRow(p, i))}</tbody>
      </table>
    </div>
  );

  // Grid scales up on big monitors: 5 cols on ~24in (1536px+), 6 on ~27-32in (2100px+).
  const renderGrid = (list: ReviewPost[]) => (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[2100px]:grid-cols-6">
      {list.map((p, i) => renderCard(p, i))}
    </div>
  );

  return (
    <div>
      {/* Header strip */}
      <div className="flex items-center justify-between gap-3 mb-5 rounded-xl bg-brand-light px-4 py-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-brand text-white">
            <IconChecklist size={18} stroke={1.8} />
          </span>
          <div>
            <div className="text-[#232D42] font-semibold text-sm">Ready for review</div>
            <div className="text-xs text-[#8A92A6]">
              Approve to send to the Scheduler, or send back for changes
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Cards / Table view toggle */}
          <div className="inline-flex bg-white border border-gray-200 rounded-lg p-0.5">
            <button
              onClick={() => setView("cards")}
              className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-md transition ${view === "cards" ? "bg-brand text-white" : "text-[#4A5468] hover:text-brand"}`}
            >
              <IconLayoutGrid size={15} stroke={1.8} /> Cards
            </button>
            <button
              onClick={() => setView("table")}
              className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-md transition ${view === "table" ? "bg-brand text-white" : "text-[#4A5468] hover:text-brand"}`}
            >
              <IconTable size={15} stroke={1.8} /> Table
            </button>
          </div>
          <span className="text-sm font-medium text-brand bg-white rounded-full px-3 py-1">
            {sbuSel.length ? `${mainPosts.length} of ${allMain.length} in queue` : `${allMain.length} in queue`}
          </span>
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-sm font-medium text-[#4A5468] hover:text-brand border border-gray-200 bg-white rounded-lg px-3 py-1.5"
          >
            <IconRefresh size={15} stroke={1.8} /> Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm px-4 py-2.5">
          {err}
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[#8A92A6]">Interest</span>
        <div className="w-[260px]">
          <MultiPick label="Primary Interests" options={sbuOptions} selected={sbuSel} onChange={setSbuSel} total={allMain.length} />
        </div>
      </div>

      {loading ? (
        <LoadingBlock label="Loading review queue…" />
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-16 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-brand-light grid place-items-center mb-3">
            <IconClipboardCheck size={22} className="text-brand" stroke={1.8} />
          </div>
          <div className="text-[#232D42] font-medium">Nothing to review</div>
          <div className="text-sm text-[#8A92A6] mt-1">
            Posts appear here the moment they&apos;re marked <b>Output&nbsp;-&nbsp;Ready</b>.
          </div>
        </div>
      ) : (
        <>
          {/* GooCampus review queue */}
          {mainPosts.length > 0 ? (
            view === "table" ? renderTable(mainPosts) : renderGrid(mainPosts)
          ) : sbuSel.length ? (
            <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm text-[#8A92A6]">
              {isPickNone(sbuSel) ? "No SBUs ticked." : `Nothing awaiting review for ${sbuSel.join(", ")}.`}{" "}
              <button onClick={() => setSbuSel([])} className="text-brand font-semibold hover:underline">Show all {allMain.length}</button>
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm text-[#8A92A6]">
              No GooCampus posts awaiting review.
            </div>
          )}

        </>
      )}

      {/* Preview popup — click any post (card or table row) to open it. */}
      {openPost && (() => {
        const p = openPost;
        const tc = typeChip(p.type);
        const busy = busyId === p.id;
        // Standard IG dimensions: reel/story = 9:16 (1080×1920), else 4:5 (1080×1350).
        // Creative on the left at that real shape, details on the right — like the task
        // window. Stacked it got squashed to half height (Praveen, 21 Oct).
        const portrait = /reel|story/i.test(p.type || "");
        const slides = (p.mediaUrls || []).flatMap((url) =>
          isPdf(url) ? Array.from({ length: pdfPages[url] || 1 }, (_, i) => ({ url, page: i + 1 })) : [{ url, page: 0 }]);
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpenPost(null)}>
            <div className="bg-white rounded-2xl w-full max-h-[92vh] flex flex-col overflow-hidden" style={{ maxWidth: portrait ? 820 : 940 }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-[11px] font-semibold rounded-md px-2 py-0.5" style={{ background: tc.bg, color: tc.fg }}>{p.type || "Post"}</span>
                    {p.sbu && <span className="text-[11px] font-semibold rounded-full px-2.5 py-0.5 bg-brand-light text-[#2138B0]">{p.sbu}</span>}
                    <ChangedChip p={p} />
                  </div>
                  <h2 className="text-lg font-semibold text-[#232D42] leading-snug">{p.title || "Untitled"}</h2>
                </div>
                <button onClick={() => setOpenPost(null)} className="text-gray-400 hover:text-gray-700 flex-shrink-0"><IconX size={20} /></button>
              </div>
              <div className="flex-1 min-h-0 p-5 flex flex-col md:flex-row gap-5 overflow-y-auto md:overflow-hidden">
                <div className="w-full md:w-auto md:h-[min(70vh,660px)] flex-shrink-0 relative rounded-xl overflow-hidden bg-[#0b1020]" style={{ aspectRatio: mediaRatio || (portrait ? "9 / 16" : "4 / 5") }}>
                  {slides.length > 0 ? (
                    <div
                      ref={trackRef}
                      className="w-full h-full flex overflow-x-auto snap-x snap-mandatory select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                      style={{ cursor: slides.length > 1 ? "grab" : undefined }}
                      onScroll={(e) => { const t = e.currentTarget; setSlide(Math.round(t.scrollLeft / Math.max(1, t.clientWidth))); }}
                      onPointerDown={(e) => {
                        if (e.pointerType !== "mouse" || slides.length < 2 || (e.target as HTMLElement).tagName === "VIDEO") return;
                        drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
                        e.currentTarget.setPointerCapture(e.pointerId);
                        e.currentTarget.style.scrollSnapType = "none";
                        e.currentTarget.style.cursor = "grabbing";
                      }}
                      onPointerMove={(e) => {
                        const d = drag.current; if (!d) return;
                        if (Math.abs(e.clientX - d.x) > 3) d.moved = true;
                        e.currentTarget.scrollLeft = d.left - (e.clientX - d.x);
                      }}
                      onPointerUp={(e) => {
                        const d = drag.current; if (!d) return;
                        drag.current = null;
                        const t = e.currentTarget, w = t.clientWidth, dx = e.clientX - d.x;
                        const from = Math.round(d.left / w);
                        const to = Math.abs(dx) > w * 0.15 ? from + (dx < 0 ? 1 : -1) : from;
                        t.style.cursor = "grab";
                        t.scrollTo({ left: Math.min(Math.max(0, to), slides.length - 1) * w, behavior: "smooth" });
                        setTimeout(() => { t.style.scrollSnapType = ""; }, 400);
                      }}
                    >
                      {slides.map((sl, i) => (
                        <div key={`${sl.url}-${sl.page}-${i}`} className="relative w-full h-full flex-shrink-0 snap-center grid place-items-center">
                          {sl.page > 0 ? (
                            <PdfThumb url={sl.url} page={sl.page} width={460} fit="contain" badge={false}
                              fallback={<a href={sl.url} target="_blank" rel="noreferrer" className="text-sm text-white underline">Open PDF</a>} />
                          ) : isVideoUrl(sl.url, p.type) ? (
                            Math.abs(i - slide) <= 1
                              ? <SoundVideo src={sl.url} autoPlay={i === slide} open className="w-full h-full object-contain"
                                  onLoadedMetadata={i === 0 ? (e) => takeRatio(e.currentTarget.videoWidth, e.currentTarget.videoHeight) : undefined} />
                              : null
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={sl.url} alt={p.title || "creative"} draggable={false} loading={i <= 1 ? "eager" : "lazy"} className="w-full h-full object-contain"
                              onLoad={i === 0 ? (e) => takeRatio(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight) : undefined} />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : driveFileId(p.assetLink) ? (
                    // Drive won't play inside the dashboard (its player refuses to embed
                    // here), so show the reel's frame and open it on Drive to watch.
                    <a href={p.assetLink!} target="_blank" rel="noreferrer" className="group block w-full h-full relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={cardThumb(p)!} alt={p.title || "creative"} className="w-full h-full object-contain" loading="lazy" decoding="async" />
                      <span className="absolute inset-0 grid place-items-center">
                        <span className="w-14 h-14 rounded-full bg-black/55 group-hover:bg-black/75 grid place-items-center text-white transition"><IconPlayerPlayFilled size={26} /></span>
                      </span>
                      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] font-medium text-white bg-black/55 rounded-full px-2.5 py-0.5 whitespace-nowrap">Plays on Google Drive</span>
                    </a>
                  ) : (
                    <CreativeThumb thumbnailUrl={p.thumbnailUrl} fit="contain" assetLink={p.assetLink} type={p.type} title={p.title} seed={p.id} />
                  )}
                  {slides.length > 1 && (
                    <>
                      <button aria-label="Previous" disabled={slide === 0} onClick={(e) => { e.stopPropagation(); goSlide(slide - 1); }} className="absolute left-2 top-1/2 -translate-y-1/2 grid place-items-center w-9 h-9 rounded-full bg-black/45 hover:bg-black/65 text-white transition disabled:opacity-0"><IconChevronLeft size={20} stroke={2} /></button>
                      <button aria-label="Next" disabled={slide >= slides.length - 1} onClick={(e) => { e.stopPropagation(); goSlide(slide + 1); }} className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-9 h-9 rounded-full bg-black/45 hover:bg-black/65 text-white transition disabled:opacity-0"><IconChevronRight size={20} stroke={2} /></button>
                      <div className="absolute top-2 right-2 text-[11px] font-medium text-white bg-black/45 rounded-full px-2 py-0.5">{Math.min(slide + 1, slides.length)}/{slides.length}</div>
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
                        {slides.map((_, i) => <button key={i} aria-label={`Slide ${i + 1}`} onClick={() => goSlide(i)} style={{ width: 6, height: 6, minWidth: 6, minHeight: 6 }} className={`block p-0 rounded-full transition ${i === slide ? "bg-white" : "bg-white/40"}`} />)}
                      </div>
                    </>
                  )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-4 md:overflow-y-auto">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div><div className="text-[11px] font-semibold uppercase tracking-wide text-[#8A92A6] mb-0.5">Interest</div><div className="text-sm text-[#232D42]">{p.sbu || "—"}</div></div>
                  <div><div className="text-[11px] font-semibold uppercase tracking-wide text-[#8A92A6] mb-0.5">Owner</div><div className="text-sm text-[#232D42] capitalize">{p.owner || "—"}</div></div>
                  <div><div className="text-[11px] font-semibold uppercase tracking-wide text-[#8A92A6] mb-0.5">Publishing</div><div className="text-sm text-[#232D42]">{p.publishingDate ? fmtDate(p.publishingDate) : "—"}</div></div>
                  <div><div className="text-[11px] font-semibold uppercase tracking-wide text-[#8A92A6] mb-0.5">Creative</div><div className="text-sm text-[#232D42]">{p.hasCreative ? "Attached" : "None yet"}</div></div>
                </div>
                {/* Only the real caption is shown as the caption — the brief used to stand
                    in for it here, so a post with no caption looked ready (27 Oct). */}
                {p.caption ? (
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8A92A6] mb-1">Caption</div>
                    <div className="text-sm text-[#232D42]"><Markdown value={p.caption} /></div>
                  </div>
                ) : /story/i.test(p.type || "") ? null
                : <div className="text-xs text-amber-700 bg-amber-50 rounded-md px-3 py-2">No caption yet — add the text that goes out with the post before Push to Schedule. The brief isn&apos;t posted.</div>}
                {!p.hasCreative && <div className="text-xs text-amber-700 bg-amber-50 rounded-md px-3 py-2">No creative attached — add media before it can go to the Scheduler.</div>}
                </div>
              </div>
              <div className="px-5 py-4 border-t border-gray-100">
                {feedbackFor === p.id ? (
                  <div className="flex flex-col gap-2">
                    <textarea autoFocus value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} placeholder="What needs changing? (the producer sees this on their task)" rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" />
                    <div className="flex items-center gap-2">
                      <button disabled={busy || !feedbackText.trim()} onClick={() => move(p.id, "Incorporating Feedback", "Send back", feedbackText, p.title)} className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium text-white bg-[#C0201F] rounded-lg px-3 py-2 hover:bg-[#9E1A19] disabled:opacity-40"><IconArrowBackUp size={15} stroke={1.9} /> Send back with feedback</button>
                      <button onClick={() => { setFeedbackFor(null); setFeedbackText(""); }} className="text-sm font-medium text-[#4A5468] border border-gray-200 rounded-lg px-3 py-2 hover:border-brand hover:text-brand">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button disabled={busy} onClick={() => move(p.id, "Ready to Publish", "Push to Schedule", undefined, p.title)} title="Approve and send to the Scheduler" className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium text-white bg-brand rounded-lg px-3 py-2.5 hover:bg-[#2138B0] disabled:opacity-40 disabled:cursor-not-allowed"><IconCalendarPlus size={15} stroke={1.9} /> Push to Schedule</button>
                    <button disabled={busy} onClick={() => { setFeedbackFor(p.id); setFeedbackText(""); }} className="flex items-center justify-center gap-1.5 text-sm font-medium text-[#4A5468] border border-gray-200 rounded-lg px-4 py-2.5 hover:border-brand hover:text-brand disabled:opacity-40"><IconArrowBackUp size={15} stroke={1.9} /> Send back</button>
                    <CopyLink path={taskLinkPath(p.id)} className="!py-2.5" />
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {gate && <MissingFieldsModal {...gate} onClose={() => setGate(null)} />}
    </div>
  );
}
