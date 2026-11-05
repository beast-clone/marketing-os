"use client";
import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { LiveIndicator } from "@/components/LiveIndicator";
import { MetricCard } from "@/components/MetricCard";
import { useApi } from "@/lib/use-api";

type Story = { id: string; caption: string; mediaUrl: string; permalink: string; timestamp: string };
type StoryWithStats = Story & {
  views: number; reach: number; replies: number;
  // Modern v25 metrics — Meta removed taps_forward/taps_back/exits/completion
  follows?: number; profileVisits?: number; navigation?: number;
  // Kept only so old demo entries still compile — no longer used in UI
  tapsForward: number; tapsBack: number; exits: number;
};

// Realistic demo stories so the manager can see what the tab WILL look like once
// n8n's story_insights webhook is wired up. Stats are typical of GooCampus's audience.
const DEMO_STORIES: StoryWithStats[] = [
  { id: "demo-1", caption: "AMC Part 1 prep tip 🇦🇺", mediaUrl: "", permalink: "#", timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    views: 4287, reach: 4012, replies: 23, tapsForward: 1841, tapsBack: 142, exits: 287 },
  { id: "demo-2", caption: "Behind the scenes — Bangalore ALS workshop", mediaUrl: "", permalink: "#", timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    views: 3956, reach: 3742, replies: 41, tapsForward: 1623, tapsBack: 89, exits: 198 },
  { id: "demo-3", caption: "Poll: Which pathway are you on?", mediaUrl: "", permalink: "#", timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    views: 4521, reach: 4287, replies: 312, tapsForward: 1102, tapsBack: 67, exits: 145 },
  { id: "demo-4", caption: "NZ Healthcare Handbook is OUT 📘", mediaUrl: "", permalink: "#", timestamp: new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString(),
    views: 5104, reach: 4823, replies: 89, tapsForward: 2014, tapsBack: 156, exits: 234 },
  { id: "demo-5", caption: "Q&A: WBA vs AMC Clinical", mediaUrl: "", permalink: "#", timestamp: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString(),
    views: 3812, reach: 3567, replies: 67, tapsForward: 1456, tapsBack: 98, exits: 213 },
  { id: "demo-6", caption: "Student success: Dr. Aisha → AHPRA", mediaUrl: "", permalink: "#", timestamp: new Date(Date.now() - 17 * 60 * 60 * 1000).toISOString(),
    views: 4673, reach: 4398, replies: 56, tapsForward: 1789, tapsBack: 112, exits: 245 },
  { id: "demo-7", caption: "Quick fact: IMG job demand 2026", mediaUrl: "", permalink: "#", timestamp: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
    views: 3247, reach: 3089, replies: 19, tapsForward: 1234, tapsBack: 78, exits: 167 },
  { id: "demo-8", caption: "Reminder — webinar tomorrow 7 PM IST", mediaUrl: "", permalink: "#", timestamp: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
    views: 4156, reach: 3934, replies: 124, tapsForward: 1567, tapsBack: 103, exits: 198 },
];

// Soft gradient backgrounds (no external images needed) so the demo grid looks polished.
const DEMO_GRADIENTS = [
  "from-violet-400 to-fuchsia-500",
  "from-blue-400 to-cyan-500",
  "from-emerald-400 to-teal-500",
  "from-amber-400 to-orange-500",
  "from-rose-400 to-pink-500",
  "from-indigo-400 to-purple-500",
  "from-sky-400 to-blue-500",
  "from-green-400 to-emerald-500",
];

export default function StoriesPage() {
  return (
    <DashboardShell title="Stories">
      {({ accountId }) => <StoriesView accountId={accountId} />}
    </DashboardShell>
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

  // Always have BOTH: any real stories Meta returned (live, currently active in the 24h
  // window) on top, AND the demo grid below so the tab is never empty and the manager can
  // see what historical analytics will look like once the n8n story_insights webhook lands.
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

  // Aggregate metrics for the cards at the top — count real ones for the live numbers,
  // demo for everything else so the dashboard still shows realistic totals.
  const totalDisplayed = realStories.length + DEMO_STORIES.length;
  const demoViews = DEMO_STORIES.reduce((s, x) => s + x.views, 0);
  const demoReplies = DEMO_STORIES.reduce((s, x) => s + x.replies, 0);
  const demoAvgCompletion = Math.round(DEMO_STORIES.reduce((s, x) => s + (x.views ? ((x.views - x.exits) / x.views) * 100 : 0), 0) / DEMO_STORIES.length);

  return (
    <>
      <LiveIndicator fetchedAt={fetchedAt} latencyMs={latencyMs} loading={loading} onRefresh={fetchData} />

      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">Couldn&apos;t load: {error.message}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Stories shown" value={totalDisplayed.toString()} />
        <MetricCard label="Total views" value={demoViews.toLocaleString("en-IN")} />
        <MetricCard label="Total replies" value={demoReplies.toLocaleString("en-IN")} />
        <MetricCard label="Avg completion" value={`${demoAvgCompletion}%`} />
      </div>

      {/* LIVE section — only renders when Meta returns active stories (last 24h on the account). */}
      {hasReal && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="text-sm font-medium flex items-center gap-2">
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
            <div className="text-sm font-medium">📚 Historical stories <span className="text-gray-400 font-normal">(from Supabase — persists forever)</span></div>
            <div className="text-xs text-gray-400">{historical.length} snapshotted</div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-5">
            {historical.map((s, i) => (
              <StoryCard key={s.id} s={s} gradientIdx={i} isLive={false} />
            ))}
          </div>
        </div>
      )}

      {/* PREVIEW / DEMO section — always renders. Banner explains what the demo grid is. */}
      <div className="bg-violet-50 border border-violet-200 text-violet-900 rounded-lg px-4 py-3 mb-3 text-sm">
        📸 <strong>Preview</strong> — {historicalNote
          ? `${historicalNote}. Meanwhile these demo cards show what the tab looks like.`
          : (historical && historical.length > 0
              ? "The historical section above holds every story we've snapshotted so far (hourly cron pulls the image + analytics from Meta before it expires). The demo below is just for reference until the archive fills out."
              : "Once the hourly cron runs, real historical stories will appear above this section instead of these demos.")}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="text-sm font-medium">Demo — how the tab looks</div>
          <div className="text-xs text-gray-400">dummy data</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-5">
          {DEMO_STORIES.map((s, i) => (
            <StoryCard key={s.id} s={s} gradientIdx={i} isLive={false} />
          ))}
        </div>
      </div>
    </>
  );
}

function StoryCard({ s, gradientIdx, isLive }: { s: StoryWithStats; gradientIdx: number; isLive: boolean }) {
  const denom = s.views || s.reach || 0;
  const replyRate = denom ? ((s.replies / denom) * 100).toFixed(1) : "0.0";
  const hasStats = s.reach > 0 || s.views > 0;   // real live stories carry insights from Meta now
  const dash = <span className="text-gray-300">—</span>;
  // Real (v25) stories have the modern metric bundle; demo entries still use the legacy taps/exits set.
  const useModernMetrics = isLive || typeof s.follows === "number";
  return (
    <a href={s.permalink} target="_blank" rel="noopener noreferrer" className="group block">
      <div className={`aspect-[9/16] rounded-xl overflow-hidden ${s.mediaUrl ? "bg-gray-100" : `bg-gradient-to-br ${DEMO_GRADIENTS[gradientIdx % DEMO_GRADIENTS.length]}`} relative ring-1 ring-gray-200 group-hover:ring-2 group-hover:ring-brand transition`}>
        {s.mediaUrl ? (
          <img src={s.mediaUrl} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <div className="absolute inset-0 flex items-end p-3 text-white">
            <div className="text-xs font-medium leading-snug drop-shadow">{s.caption}</div>
          </div>
        )}
        <div className="absolute top-2 right-2 bg-black/40 backdrop-blur-sm text-white text-[10px] px-2 py-0.5 rounded-full">
          {timeAgo(s.timestamp)}
        </div>
        {isLive && (
          <div className="absolute top-2 left-2 bg-green-500 text-white text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            LIVE
          </div>
        )}
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
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
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <span title="Profile visits from this story">👤 {(s.profileVisits ?? 0).toLocaleString("en-IN")}</span>
            <span title="Navigation events (taps / swipes / exits)">⇄ {(s.navigation ?? 0).toLocaleString("en-IN")}</span>
          </div>
        )}
        {hasStats && !useModernMetrics && (
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <span>→ {s.tapsForward.toLocaleString("en-IN")}</span>
            <span>← {s.tapsBack.toLocaleString("en-IN")}</span>
            <span>× {s.exits.toLocaleString("en-IN")}</span>
          </div>
        )}
        {isLive && !hasStats && (
          <div className="text-[10px] text-gray-400 italic">Fetching insights…</div>
        )}
      </div>
    </a>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-md px-2 py-1">
      <div className="text-[12px] uppercase tracking-wide text-gray-500 font-medium">{label}</div>
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
