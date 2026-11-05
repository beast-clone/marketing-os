"use client";
import { LoadingBlock } from "@/components/LoadingBlock";
import { IconArrowsLeftRight, IconUser, IconBooks } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { LiveIndicator } from "@/components/LiveIndicator";
import { MetricCard } from "@/components/MetricCard";
import { useApi } from "@/lib/use-api";
import { PostDetailModal } from "@/components/PostDetailModal";

type Story = { id: string; caption: string; mediaUrl: string; permalink: string; timestamp: string; videoUrl?: string };
type StoryWithStats = Story & {
  views: number; reach: number; replies: number;
  // Modern v25 metrics — Meta removed taps_forward/taps_back/exits/completion
  follows?: number; profileVisits?: number; navigation?: number;
  // Kept only so old demo entries still compile — no longer used in UI
  tapsForward: number; tapsBack: number; exits: number;
};

// Soft gradient backgrounds for story tiles that have no thumbnail.
const DEMO_GRADIENTS = [
  "from-brand to-brand-dark",
  "from-blue-400 to-cyan-500",
  // Brand family (blue → indigo → violet) so placeholder story tiles stay
  // on-theme instead of a rainbow. Only shown when a story has no thumbnail.
  "from-indigo-400 to-blue-500",
  "from-blue-400 to-indigo-500",
  "from-violet-400 to-indigo-500",
  "from-sky-400 to-blue-500",
  "from-indigo-500 to-violet-500",
  "from-blue-500 to-indigo-600",
];

export default function StoriesPage() {
  return (
    <PreviewDashboardShell active="instagram" title="Stories" subtitle="Live and past stories — views, reach, replies and taps, saved as daily history.">
      {({ accountId }) => <StoriesView accountId={accountId} />}
    </PreviewDashboardShell>
  );
}

function StoriesView({ accountId }: { accountId: string }) {
  // Two independent cached fetches — SWR handles the parallel calls + deduping.
  const liveApi = useApi<{ stories?: Story[]; error?: string }>(`/api/stories?accountId=${accountId}`);
  const histApi = useApi<{ stories?: StoryWithStats[]; note?: string }>(`/api/stories/historical?accountId=${accountId}&limit=30`);

  const stories = liveApi.data?.stories ?? null;
  const historical = histApi.data?.stories ?? null;
  const historicalNote = histApi.data?.note ?? null;
  const error = liveApi.error;
  const loading = liveApi.isLoading || histApi.isLoading;
  const fetchData = () => { liveApi.refresh(); histApi.refresh(); };

  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  useEffect(() => { if (stories || historical) { setFetchedAt(Date.now()); setLatencyMs(null); } }, [stories, historical]);

  // Live stories (currently active in the 24h window) on top, saved history below.
  // Real stories now carry their real reach/replies/taps/exits from Meta's insights endpoint.
  const realStories: StoryWithStats[] = (stories ?? []).map((s) => {
    const raw = s as unknown as Partial<StoryWithStats>;
    return {
      ...s,
      views: raw.views ?? 0,
      reach: raw.reach ?? 0,
      replies: raw.replies ?? 0,
      follows: raw.follows ?? 0,
      profileVisits: raw.profileVisits ?? 0,
      navigation: raw.navigation ?? 0,
      tapsForward: 0, tapsBack: 0, exits: 0,
    };
  });
  const hasReal = realStories.length > 0;
  const realHaveStats = realStories.some((s) => s.reach > 0);

  // KPI tiles count real stories only (live + historical). With none, they read 0 /
  // "—" and an empty state explains why — no sample stories.
  const statSet = [...realStories, ...(historical ?? [])];
  const noneYet = !loading && statSet.length === 0;
  const totalDisplayed = statSet.length;
  const totalViews = statSet.reduce((s, x) => s + (x.views || 0), 0);
  const totalReplies = statSet.reduce((s, x) => s + (x.replies || 0), 0);
  // Completion needs exit data. Live (v25) stories don't carry taps/exits, so only
  // average over stories that actually have it — else show "—" instead of NaN%.
  const completable = statSet.filter((x) => (x.views || 0) > 0 && (x.exits || 0) > 0);
  const avgCompletion = completable.length
    ? Math.round(completable.reduce((s, x) => s + ((x.views - x.exits) / x.views) * 100, 0) / completable.length)
    : null;

  return (
    <>
      <LiveIndicator fetchedAt={fetchedAt} latencyMs={latencyMs} loading={loading} onRefresh={fetchData} error={liveApi.error ? liveApi.error.message : null} />

      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">Couldn&apos;t load: {error.message}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Stories shown" value={totalDisplayed.toString()} />
        <MetricCard label="Total views" value={totalViews.toLocaleString("en-IN")} />
        <MetricCard label="Total replies" value={totalReplies.toLocaleString("en-IN")} />
        <MetricCard label="Avg completion" value={avgCompletion === null ? "—" : `${avgCompletion}%`} />
      </div>

      {/* LIVE section — only renders when Meta returns active stories (last 24h on the account). */}
      {hasReal && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="text-base font-medium text-[#232D42] flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Live stories <span className="text-gray-400 font-normal">({realStories.length} currently active)</span>
            </div>
            <div className="text-xs text-gray-400">Tap to open</div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-5">
            {realStories.map((s, i) => (
              <StoryCard key={s.id} s={s} gradientIdx={i} isLive />
            ))}
          </div>
        </div>
      )}

      {/* HISTORICAL section — snapshots captured by the hourly cron from Supabase. */}
      {historical && historical.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="text-base font-medium text-[#232D42]"><IconBooks size={16} stroke={1.8} className="inline -mt-0.5 mr-1 text-gray-500" />Historical stories <span className="text-gray-400 font-normal">(from Supabase — persists forever)</span></div>
            <div className="text-xs text-gray-400">{historical.length} snapshotted</div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-5">
            {historical.map((s, i) => (
              <StoryCard key={s.id} s={s} gradientIdx={i} isLive={false} />
            ))}
          </div>
        </div>
      )}

      {noneYet && (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <div className="text-base font-medium text-[#232D42] mb-1">No stories yet</div>
          <p className="text-sm text-gray-500">{historicalNote || "Nothing live in the last 24 hours and no saved stories for this account yet. New stories show up here automatically."}</p>
        </div>
      )}
      {loading && statSet.length === 0 && <LoadingBlock label="Loading stories…" />}
    </>
  );
}

function StoryCard({ s, gradientIdx, isLive }: { s: StoryWithStats; gradientIdx: number; isLive: boolean }) {
  // Stories used to open Instagram in a new tab, but a story permalink dies after
  // 24 hours — for anything historical that link went nowhere. The stored image
  // lives in Supabase, so show it here instead.
  const [open, setOpen] = useState(false);
  const denom = s.views || s.reach || 0;
  const replyRate = denom ? ((s.replies / denom) * 100).toFixed(1) : "0.0";
  const hasStats = s.reach > 0 || s.views > 0;   // real live stories carry insights from Meta now
  const dash = <span className="text-gray-300">—</span>;
  // Real (v25) stories have the modern metric bundle; demo entries still use the legacy taps/exits set.
  const useModernMetrics = isLive || typeof s.follows === "number";
  return (
    <div role="button" tabIndex={0} onClick={() => setOpen(true)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
      className="group block cursor-pointer">
      <div className={`aspect-[9/16] rounded-xl overflow-hidden ${s.mediaUrl ? "bg-gray-100" : `bg-gradient-to-br ${DEMO_GRADIENTS[gradientIdx % DEMO_GRADIENTS.length]}`} relative ring-1 ring-gray-200 group-hover:ring-2 group-hover:ring-brand transition`}>
        {s.mediaUrl ? (
          <img src={s.mediaUrl} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <div className="absolute inset-0 flex items-end p-3 text-white">
            <div className="text-xs font-medium leading-snug drop-shadow">{s.caption}</div>
          </div>
        )}
        <div className="absolute top-2 right-2 bg-black/40 backdrop-blur-sm text-white text-xs px-2 py-0.5 rounded-full">
          {timeAgo(s.timestamp)}
        </div>
        {isLive && (
          <div className="absolute top-2 left-2 bg-green-500 text-white text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            LIVE
          </div>
        )}
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <Stat label="Views" value={hasStats ? s.views.toLocaleString("en-IN") : dash} />
          <Stat label="Reach" value={hasStats ? s.reach.toLocaleString("en-IN") : dash} />
          <Stat label="Replies" value={hasStats ? `${s.replies} (${replyRate}%)` : dash} />
          <Stat label={useModernMetrics ? "Follows" : "Complete"} value={
            hasStats
              ? (useModernMetrics
                  ? (s.follows ?? 0).toLocaleString("en-IN")
                  : `${denom ? Math.round(((denom - s.exits) / denom) * 100) : 0}%`)
              : dash
          } />
        </div>
        {hasStats && useModernMetrics && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span title="Profile visits from this story" className="inline-flex items-center gap-1"><IconUser size={13} stroke={1.8} />{(s.profileVisits ?? 0).toLocaleString("en-IN")}</span>
            <span title="Navigation events (taps / swipes / exits)" className="inline-flex items-center gap-1"><IconArrowsLeftRight size={13} stroke={1.8} />{(s.navigation ?? 0).toLocaleString("en-IN")}</span>
          </div>
        )}
        {hasStats && !useModernMetrics && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>→ {s.tapsForward.toLocaleString("en-IN")}</span>
            <span>← {s.tapsBack.toLocaleString("en-IN")}</span>
            <span>× {s.exits.toLocaleString("en-IN")}</span>
          </div>
        )}
        {isLive && !hasStats && (
          <LoadingBlock size={18} className="!py-2 !flex-row !justify-start !gap-2" label="Fetching insights…" />
        )}
      </div>
      {open && (
        <PostDetailModal
          post={{
            id: s.id, caption: s.caption, mediaUrl: s.mediaUrl, videoUrl: s.videoUrl || undefined, permalink: s.permalink,
            type: "STORY", timestamp: s.timestamp, likes: 0, comments: 0, reach: s.reach,
          }}
          typeLabel="Story"
          metrics={hasStats ? [
            { label: "Views", value: s.views.toLocaleString("en-IN") },
            { label: "Reach", value: s.reach.toLocaleString("en-IN") },
            { label: "Replies", value: `${s.replies} (${replyRate}%)` },
            ...(useModernMetrics
              ? [
                  { label: "Follows", value: (s.follows ?? 0).toLocaleString("en-IN") },
                  { label: "Profile visits", value: (s.profileVisits ?? 0).toLocaleString("en-IN") },
                  { label: "Navigation", value: (s.navigation ?? 0).toLocaleString("en-IN") },
                ]
              : [
                  { label: "Taps forward", value: s.tapsForward.toLocaleString("en-IN") },
                  { label: "Taps back", value: s.tapsBack.toLocaleString("en-IN") },
                  { label: "Exits", value: s.exits.toLocaleString("en-IN") },
                ]),
          ] : [{ label: "Insights", value: <span className="text-gray-300">not available</span> }]}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-md px-2 py-1">
      <div className="text-xs uppercase tracking-wide text-gray-500 font-medium">{label}</div>
      <div className="font-semibold text-gray-900 truncate">{value}</div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
