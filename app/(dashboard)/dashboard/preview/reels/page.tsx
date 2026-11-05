"use client";
import { LoadingBlock } from "@/components/LoadingBlock";
import { IconClock, IconEye, IconHeart, IconMovie, IconSparkles, IconTrophy } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/use-api";
import { fmtDateShort, fmtDateTime } from "@/lib/date";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { LiveIndicator } from "@/components/LiveIndicator";
import { SoundVideo } from "@/components/SoundVideo";

type ApiPost = {
  id: string;
  caption: string;
  mediaUrl: string;
  videoUrl?: string;
  permalink: string;
  type: "IMAGE" | "VIDEO" | "REEL" | "CAROUSEL_ALBUM";
  timestamp: string;
  likes: number;
  comments: number;
  reach: number;
  shares: number;
  saves: number;
  totalInteractions: number;
  views?: number;
  avgWatchMs?: number;
};

export default function ReelsPage() {
  return (
    <PreviewDashboardShell active="instagram" title="Reels" subtitle="Every reel in range — views, watch time and engagement, with your top performers.">
      {({ accountId, range }) => <ReelsView accountId={accountId} range={range} />}
    </PreviewDashboardShell>
  );
}

function ReelsView({ accountId, range }: { accountId: string; range: { from: string; to: string } }) {
  const [insightsLoaded, setInsightsLoaded] = useState<Set<string>>(new Set());
  const [insightsProgress, setInsightsProgress] = useState<{ done: number; total: number } | null>(null);
  const [sort, setSort] = useState<"views" | "reach" | "engagement" | "date">("views");
  const [selectedReel, setSelectedReel] = useState<ApiPost | null>(null);

  // Phase 1: cached list fetch via SWR (instant on repeat visits)
  const qs = new URLSearchParams({ accountId, from: range.from, to: range.to, insights: "false" }).toString();
  const { data: apiData, error, isLoading, refresh } = useApi<{ posts?: ApiPost[] }>(`/api/posts?${qs}`);
  const loading = isLoading;
  const fetchData = () => refresh();

  const [posts, setPosts] = useState<ApiPost[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const fetchStartRef = useRef<number>(0);
  useEffect(() => { if (isLoading) fetchStartRef.current = Date.now(); }, [isLoading]);
  useEffect(() => {
    if (!apiData) return;
    const list: ApiPost[] = apiData.posts ?? [];
    setPosts(list);
    setInsightsLoaded(new Set());
    setInsightsProgress(null);
    setFetchedAt(Date.now());
    setLatencyMs(Date.now() - fetchStartRef.current);
    const reelsOnly = list.filter((p) => p.type === "REEL");
    if (reelsOnly.length > 0) loadInsightsProgressively(reelsOnly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiData]);

  async function loadInsightsProgressively(list: ApiPost[]) {
    const BATCH = 10;
    const ordered = [...list].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setInsightsProgress({ done: 0, total: ordered.length });
    for (let off = 0; off < ordered.length; off += BATCH) {
      const slice = ordered.slice(off, off + BATCH);
      const items = slice.map((p) => ({ id: p.id, mediaType: "VIDEO", mediaProductType: "REELS" }));
      try {
        const r = await fetch("/api/posts/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, items }),
        });
        if (!r.ok) continue;
        const d = await r.json();
        const map = new Map<string, { reach: number; shares: number; saves: number; totalInteractions: number; views?: number; avgWatchMs?: number }>();
        for (const ins of (d.insights ?? [])) map.set(ins.id, ins);
        setPosts((prev) => prev ? prev.map((p) => {
          const fresh = map.get(p.id);
          return fresh ? { ...p, reach: fresh.reach, shares: fresh.shares, saves: fresh.saves, totalInteractions: fresh.totalInteractions, views: fresh.views, avgWatchMs: fresh.avgWatchMs } : p;
        }) : prev);
        setInsightsLoaded((prev) => {
          const next = new Set(prev);
          for (const id of map.keys()) next.add(id);
          return next;
        });
        setInsightsProgress({ done: Math.min(off + BATCH, ordered.length), total: ordered.length });
      } catch { /* skip this batch, keep going */ }
    }
    setInsightsProgress(null);
  }

  const live = <LiveIndicator fetchedAt={fetchedAt} latencyMs={latencyMs} loading={loading} onRefresh={fetchData} error={error ? error.message : null} />;

  if (error) return <>{live}<div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">Couldn&apos;t load reels: {error.message}</div></>;
  if (!posts) return <>{live}<LoadingBlock label="Loading reels…" /></>;

  const reels = posts.filter((p) => p.type === "REEL");
  if (reels.length === 0) return <>{live}<div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm">No reels found in the recent posts for this account in this range.</div></>;

  // Headline aggregates
  const totalReels = reels.length;
  const avgViews = totalReels ? Math.round(reels.reduce((s, r) => s + (r.views ?? 0), 0) / totalReels) : 0;
  const avgWatchSec = totalReels ? Math.round(reels.reduce((s, r) => s + (r.avgWatchMs ?? 0), 0) / totalReels / 1000) : 0;
  const avgReach = totalReels ? Math.round(reels.reduce((s, r) => s + r.reach, 0) / totalReels) : 0;

  // Weighted rates from reels that already have insights (avoids fake zeros during load)
  const withInsights = reels.filter((r) => insightsLoaded.has(r.id) && r.reach > 0);
  const insightsCount = withInsights.length;
  const sumReach = withInsights.reduce((s, r) => s + r.reach, 0);
  const sumEng = withInsights.reduce((s, r) => s + r.totalInteractions, 0);
  const sumSaves = withInsights.reduce((s, r) => s + r.saves, 0);
  const sumShares = withInsights.reduce((s, r) => s + r.shares, 0);
  const engagementRate = sumReach > 0 ? (sumEng / sumReach) * 100 : 0;
  const saveRate = sumReach > 0 ? (sumSaves / sumReach) * 100 : 0;
  const shareRate = sumReach > 0 ? (sumShares / sumReach) * 100 : 0;

  // Top by views for the overall trophy badge
  const top = reels.reduce((best, r) => ((r.views ?? 0) > (best?.views ?? 0) ? r : best), reels[0]);

  // Top performers by rolling window (ranked by views — the primary reel metric)
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  function pickTop(withinDays: number): ApiPost | null {
    const cutoff = now - withinDays * DAY;
    const eligible = reels.filter((r) => new Date(r.timestamp).getTime() >= cutoff && insightsLoaded.has(r.id) && (r.views ?? 0) > 0);
    if (eligible.length === 0) return null;
    return eligible.reduce((b, r) => ((r.views ?? 0) > (b.views ?? 0) ? r : b), eligible[0]);
  }
  const topToday = pickTop(1);
  const topWeek = pickTop(7);
  const topMonth = pickTop(30);

  // Sort for the grid
  const sorted = [...reels].sort((a, b) => {
    if (sort === "reach") return b.reach - a.reach;
    if (sort === "engagement") return b.totalInteractions - a.totalInteractions;
    if (sort === "date") return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    return (b.views ?? 0) - (a.views ?? 0);
  });

  return (
    <>
      {live}

      {/* Single row of 7 compact stats — matches Posts tab layout */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        <MiniStat label="Reels" value={totalReels.toLocaleString("en-IN")} />
        <MiniStat label="Avg Views" value={avgViews.toLocaleString("en-IN")} />
        <MiniStat label="Avg Watch" value={`${avgWatchSec}s`} />
        <MiniStat label="Avg Reach" value={avgReach.toLocaleString("en-IN")} />
        <MiniStat label="Engagement Rate" value={insightsCount > 0 ? `${engagementRate.toFixed(2)}%` : "…"} />
        <MiniStat label="Save Rate" value={insightsCount > 0 ? `${saveRate.toFixed(2)}%` : "…"} />
        <MiniStat label="Share Rate" value={insightsCount > 0 ? `${shareRate.toFixed(2)}%` : "…"} />
      </div>

      {/* Top performers — reels ranked by VIEWS. Only windows that actually have data are
          rendered. Skips "Today" when no reel was posted in the last 24h so the section
          doesn't feel broken. */}
      {(topToday || topWeek || topMonth) && (() => {
        const winners: Array<{ label: string; reel: ApiPost }> = [];
        // Rolling windows ending now, named for what they measure — "Today" put
        // yesterday afternoon's reel under today. Same fix as the Posts tab.
        if (topToday) winners.push({ label: "Last 24 hours", reel: topToday });
        if (topWeek && topWeek.id !== topToday?.id) winners.push({ label: "Last 7 days", reel: topWeek });
        if (topMonth && topMonth.id !== topToday?.id && topMonth.id !== topWeek?.id) winners.push({ label: "Last 30 days", reel: topMonth });
        if (winners.length === 0) return null;
        const cols = winners.length === 1 ? "md:grid-cols-1" : winners.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3";
        return (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-6">
            <div className="px-5 py-3 border-b border-gray-100 text-sm font-medium flex items-center justify-between">
              <div className="flex items-center gap-1.5"><IconTrophy size={16} stroke={1.8} className="text-amber-500" />Top performers <span className="text-gray-400 font-normal">by views</span></div>
              {insightsProgress && (
                <span className="text-xs text-brand">loading {insightsProgress.done}/{insightsProgress.total}</span>
              )}
            </div>
            <div className={`grid grid-cols-1 ${cols} divide-y md:divide-y-0 md:divide-x divide-gray-100`}>
              {winners.map((w) => <TopReelCard key={w.label} label={w.label} reel={w.reel} />)}
            </div>
          </div>
        );
      })()}

      {/* Card grid + sort control */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="text-sm font-medium">
            All reels <span className="text-gray-400 font-normal">({totalReels})</span>
          </div>
          <PreviewSelect value={sort} onChange={(v) => setSort(v as typeof sort)} options={[
            { value: "views", label: "Sort: Views" }, { value: "reach", label: "Reach" }, { value: "engagement", label: "Engagement" }, { value: "date", label: "Date" },
          ]} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-5">
          {sorted.map((r) => (
            <ReelCard
              key={r.id}
              reel={r}
              isTop={r.id === top?.id}
              insightsLoaded={insightsLoaded.has(r.id)}
              onClick={() => setSelectedReel(r)}
            />
          ))}
        </div>
      </div>

      {selectedReel && <ReelDetailModal reel={selectedReel} insightsLoaded={insightsLoaded.has(selectedReel.id)} onClose={() => setSelectedReel(null)} />}
    </>
  );
}

// --- helpers ---

function shortNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-IN");
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2.5">
      <div className="text-[12px] uppercase tracking-wide text-gray-500 font-semibold truncate" title={label}>{label}</div>
      <div className="text-lg font-bold text-gray-900 tabular-nums leading-tight mt-0.5 truncate">{value}</div>
    </div>
  );
}

// Instagram-style vertical reel card (9:16 aspect matches actual reel thumbnails).
function ReelCard({ reel, isTop, insightsLoaded, onClick }: {
  reel: ApiPost;
  isTop: boolean;
  insightsLoaded: boolean;
  onClick: () => void;
}) {
  const engagement = reel.totalInteractions || (reel.likes + reel.comments);
  const dash = <span className="text-gray-300">···</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-brand hover:shadow-md transition group"
    >
      {/* Vertical thumbnail — 9:16 aspect (reel format) */}
      <div className="relative bg-black aspect-[9/16] overflow-hidden">
        {reel.mediaUrl ? (
          <img src={reel.mediaUrl} alt="" className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200" loading="lazy" decoding="async" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400"><IconMovie size={36} stroke={1.5} /></div>
        )}
        {/* Play badge (top-left) */}
        <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm text-white text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
          <IconMovie size={12} stroke={2} /> Reel
        </div>
        {isTop && (
          <div className="absolute top-2 right-2 bg-amber-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
            <IconTrophy size={12} stroke={2} className="inline -mt-px" /> Top
          </div>
        )}
        {/* Views overlay — bottom-left, IG-style */}
        {insightsLoaded && reel.views !== undefined && (
          <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-sm text-white text-[11px] font-semibold px-2 py-0.5 rounded-full">
            ▶ {shortNum(reel.views)}
          </div>
        )}
      </div>

      {/* Meta strip */}
      <div className="p-3 space-y-2">
        <div className="text-[10px] text-gray-500 uppercase tracking-wide">
          {fmtDateShort(reel.timestamp)}
        </div>
        <div className="text-xs text-gray-800 leading-snug line-clamp-2 min-h-[2lh]">
          {reel.caption?.trim() || <span className="italic text-gray-400">(no caption)</span>}
        </div>
        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-1 pt-2 border-t border-gray-100 text-center">
          <MiniQuickStat icon={<IconClock size={14} stroke={1.8} />} label="Watch" value={insightsLoaded ? (reel.avgWatchMs ? `${Math.round(reel.avgWatchMs / 1000)}s` : "—") : dash} />
          <MiniQuickStat icon={<IconEye size={14} stroke={1.8} />} label="Reach" value={insightsLoaded ? shortNum(reel.reach) : dash} />
          <MiniQuickStat icon={<IconHeart size={14} stroke={1.8} />} label="Likes" value={shortNum(reel.likes)} />
          <MiniQuickStat icon={<IconSparkles size={14} stroke={1.8} />} label="Eng" value={insightsLoaded ? shortNum(engagement) : dash} />
        </div>
      </div>
    </button>
  );
}

function MiniQuickStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-gray-500 h-4 flex items-center" title={label}>{icon}</div>
      <div className="text-[11px] font-semibold text-gray-900 tabular-nums leading-tight">{value}</div>
    </div>
  );
}

// One card per rolling window in the Top Performers section (Today / Week / Month)
function TopReelCard({ label, reel }: { label: string; reel: ApiPost | null }) {
  if (!reel) {
    return (
      <div className="p-4">
        <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">{label}</div>
        <div className="text-xs text-gray-400 italic py-6 text-center">Waiting for insights…</div>
      </div>
    );
  }
  return (
    <a href={reel.permalink} target="_blank" rel="noopener noreferrer" className="block p-4 hover:bg-gray-50 transition group">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</div>
        <div className="text-[12px] uppercase tracking-wide bg-amber-50 text-amber-700 rounded-full px-2 py-0.5 font-semibold">
          Top by views
        </div>
      </div>
      <div className="flex gap-3">
        {reel.mediaUrl ? (
          <img src={reel.mediaUrl} alt="" className="w-14 h-20 object-cover rounded-lg shrink-0" loading="lazy" decoding="async" />
        ) : (
          <div className="w-14 h-20 rounded-lg bg-gray-100 shrink-0 flex items-center justify-center text-gray-400"><IconMovie size={22} stroke={1.5} /></div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-500">Reel · {fmtDateShort(reel.timestamp)}</div>
          <div className="text-xs text-gray-900 leading-snug mt-0.5 line-clamp-3 group-hover:text-brand">
            {reel.caption?.trim() || <span className="italic text-gray-400">(no caption)</span>}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-gray-100 text-center">
        <div>
          <div className="text-[12px] uppercase tracking-wide text-gray-500">Views</div>
          <div className="text-sm font-bold text-gray-900 tabular-nums">{(reel.views ?? 0).toLocaleString("en-IN")}</div>
        </div>
        <div>
          <div className="text-[12px] uppercase tracking-wide text-gray-500">Watch</div>
          <div className="text-sm font-bold text-gray-900 tabular-nums">{reel.avgWatchMs ? `${Math.round(reel.avgWatchMs / 1000)}s` : "—"}</div>
        </div>
        <div>
          <div className="text-[12px] uppercase tracking-wide text-gray-500">Reach</div>
          <div className="text-sm font-bold text-gray-900 tabular-nums">{reel.reach.toLocaleString("en-IN")}</div>
        </div>
      </div>
    </a>
  );
}

// Click a card → full details modal. Big vertical thumbnail on the left, all metrics on the right.
function ReelDetailModal({ reel, insightsLoaded, onClose }: {
  reel: ApiPost;
  insightsLoaded: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const engagement = reel.totalInteractions || (reel.likes + reel.comments);
  const engRate = reel.reach > 0 ? ((engagement / reel.reach) * 100).toFixed(2) : "0.00";
  const dash = <span className="text-gray-300">—</span>;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full md:w-auto max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col md:flex-row" onClick={(e) => e.stopPropagation()}>
        {/* LEFT — the reel itself, playing with sound (28 Oct); the cover if Meta
            didn't send the video file. */}
        <div className="relative shrink-0 bg-black flex items-center justify-center">
          {reel.videoUrl ? (
            <SoundVideo src={reel.videoUrl} poster={reel.mediaUrl || undefined} open loop={false} className="block w-full md:w-auto max-h-[45vh] md:max-h-[85vh] md:max-w-[min(58vw,620px)]" />
          ) : reel.mediaUrl ? (
            <img src={reel.mediaUrl} alt="" className="block w-full md:w-auto max-h-[45vh] md:max-h-[85vh] md:max-w-[min(58vw,620px)]" loading="lazy" decoding="async" />
          ) : (
            <div className="text-white/70 px-16 py-24"><IconMovie size={56} stroke={1.2} /></div>
          )}
        </div>

        {/* RIGHT — details */}
        <div className="md:w-[380px] flex flex-col overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 sticky top-0 bg-white">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">Reel</span>
              <span className="text-xs text-gray-500">{fmtDateTime(reel.timestamp)}</span>
            </div>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Close">×</button>
          </div>

          <div className="px-5 py-4 space-y-4">
            {/* Full caption */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Caption</div>
              <div className="text-sm text-gray-900 whitespace-pre-wrap break-words leading-relaxed">
                {reel.caption?.trim() || <span className="italic text-gray-400">(no caption)</span>}
              </div>
            </div>

            {/* Metrics — reel-specific set */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Performance</div>
              <div className="grid grid-cols-2 gap-3">
                <MetricRow label="Views" value={insightsLoaded ? (reel.views ?? 0).toLocaleString("en-IN") : dash} />
                <MetricRow label="Avg watch time" value={insightsLoaded ? (reel.avgWatchMs ? `${Math.round(reel.avgWatchMs / 1000)}s` : "—") : dash} />
                <MetricRow label="Reach" value={insightsLoaded ? reel.reach.toLocaleString("en-IN") : dash} />
                <MetricRow label="Engagement" value={insightsLoaded ? engagement.toLocaleString("en-IN") : dash} />
                <MetricRow label="Likes" value={reel.likes.toLocaleString("en-IN")} />
                <MetricRow label="Comments" value={reel.comments.toLocaleString("en-IN")} />
                <MetricRow label="Shares" value={insightsLoaded ? reel.shares.toLocaleString("en-IN") : dash} />
                <MetricRow label="Saves" value={insightsLoaded ? reel.saves.toLocaleString("en-IN") : dash} />
                <MetricRow label="Engagement rate" value={insightsLoaded ? `${engRate}%` : dash} />
              </div>
            </div>

            <a href={reel.permalink} target="_blank" rel="noopener noreferrer"
              className="block w-full text-center px-4 py-2.5 bg-brand text-white rounded-lg hover:bg-brand-dark text-sm font-medium transition">
              Open on Instagram ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-base font-bold text-gray-900 tabular-nums leading-tight mt-0.5">{value}</div>
    </div>
  );
}
