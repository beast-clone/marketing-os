"use client";
import { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { DashboardShell } from "@/components/DashboardShell";
import { LiveIndicator } from "@/components/LiveIndicator";
import { MetricCard } from "@/components/MetricCard";
import { useApi } from "@/lib/use-api";

type ApiPost = {
  id: string;
  caption: string;
  mediaUrl: string;
  permalink: string;
  type: "IMAGE" | "VIDEO" | "REEL" | "CAROUSEL_ALBUM" | "STORY";
  timestamp: string;
  likes: number;
  comments: number;
  reach: number;
  shares: number;
  saves: number;
  totalInteractions: number;
  views?: number;
};

const TYPE_LABEL: Record<string, string> = {
  IMAGE: "Image",
  VIDEO: "Video",
  CAROUSEL_ALBUM: "Carousel",
  REEL: "Reel",
};

const TYPE_ICON: Record<string, string> = {
  IMAGE: "◻",
  VIDEO: "▶",
  CAROUSEL_ALBUM: "◫",
  REEL: "🎬",
};

export default function PostsPage() {
  return (
    <DashboardShell title="Posts">
      {({ accountId, range }) => <PostsView accountId={accountId} range={range} />}
    </DashboardShell>
  );
}

function PostsView({ accountId, range }: { accountId: string; range: { from: string; to: string } }) {
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [sort, setSort] = useState<"reach" | "engagement" | "date">("date");
  // Progressive insights loading: track which post IDs have had their reach/eng fetched yet
  const [insightsLoaded, setInsightsLoaded] = useState<Set<string>>(new Set());
  const [insightsProgress, setInsightsProgress] = useState<{ done: number; total: number } | null>(null);
  const [selectedPost, setSelectedPost] = useState<ApiPost | null>(null);

  // Phase 1: cached list fetch via SWR (instant on repeat visits)
  const qs = new URLSearchParams({ accountId, from: range.from, to: range.to, insights: "false" }).toString();
  const { data: apiData, error, isLoading, refresh } = useApi<{ posts?: ApiPost[] }>(`/api/posts?${qs}`);
  const loading = isLoading;
  const fetchData = () => refresh();

  // Local mirror of the list so phase-2 progressive updates can mutate individual posts
  // without invalidating SWR's cache.
  const [posts, setPosts] = useState<ApiPost[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const fetchStartRef = useRef<number>(0);
  useEffect(() => { if (isLoading) fetchStartRef.current = Date.now(); }, [isLoading]);
  // When a new list arrives, reset progressive state and kick off phase 2
  useEffect(() => {
    if (!apiData) return;
    const list: ApiPost[] = apiData.posts ?? [];
    setPosts(list);
    setInsightsLoaded(new Set());
    setInsightsProgress(null);
    setFetchedAt(Date.now());
    setLatencyMs(Date.now() - fetchStartRef.current);
    if (list.length > 0) loadInsightsProgressively(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiData]);

  async function loadInsightsProgressively(list: ApiPost[]) {
    const BATCH = 10;
    const ordered = [...list].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setInsightsProgress({ done: 0, total: ordered.length });
    for (let off = 0; off < ordered.length; off += BATCH) {
      const slice = ordered.slice(off, off + BATCH);
      const items = slice.map((p) => ({
        id: p.id,
        mediaType: p.type === "REEL" ? "VIDEO" : p.type,
        mediaProductType: p.type === "REEL" ? "REELS" : undefined,
      }));
      try {
        const r = await fetch("/api/posts/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, items }),
        });
        if (!r.ok) continue;
        const d = await r.json();
        const map = new Map<string, { reach: number; shares: number; saves: number; totalInteractions: number; views?: number }>();
        for (const ins of (d.insights ?? [])) map.set(ins.id, ins);
        // Merge into existing posts state without re-fetching anything
        setPosts((prev) => prev ? prev.map((p) => {
          const fresh = map.get(p.id);
          return fresh ? { ...p, reach: fresh.reach, shares: fresh.shares, saves: fresh.saves, totalInteractions: fresh.totalInteractions, views: fresh.views } : p;
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

  if (error) return (
    <>
      <LiveIndicator fetchedAt={fetchedAt} latencyMs={latencyMs} loading={loading} onRefresh={fetchData} />
      <ErrorBox msg={error.message} />
    </>
  );
  if (!posts) return (
    <>
      <LiveIndicator fetchedAt={fetchedAt} latencyMs={latencyMs} loading={loading} onRefresh={fetchData} />
      <div className="text-sm text-gray-500">Loading posts from Instagram…</div>
    </>
  );

  const filtered = typeFilter === "ALL" ? posts : posts.filter((p) => p.type === typeFilter);
  const sorted = [...filtered].sort((a, b) => {
    if (sort === "reach") return b.reach - a.reach;
    if (sort === "engagement") return b.totalInteractions - a.totalInteractions;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  const totalPosts = posts.length;
  const avgReach = totalPosts ? Math.round(posts.reduce((s, p) => s + p.reach, 0) / totalPosts) : 0;
  const avgEng = totalPosts ? Math.round(posts.reduce((s, p) => s + p.totalInteractions, 0) / totalPosts) : 0;
  const top = posts.reduce((best, p) => (p.reach > (best?.reach ?? 0) ? p : best), posts[0]);

  // Rate metrics — computed only from posts whose insights have already loaded so a
  // half-fetched batch doesn't drag the averages toward zero. Weighted (sum/sum) rather
  // than mean-of-per-post ratios, which is the standard way Instagram / Later / Metricool
  // compute these — protects the number from being skewed by one tiny-reach post.
  const withInsights = posts.filter((p) => insightsLoaded.has(p.id) && p.reach > 0);
  const insightsCount = withInsights.length;
  const sumReach = withInsights.reduce((s, p) => s + p.reach, 0);
  const sumEng = withInsights.reduce((s, p) => s + p.totalInteractions, 0);
  const sumSaves = withInsights.reduce((s, p) => s + p.saves, 0);
  const sumShares = withInsights.reduce((s, p) => s + p.shares, 0);
  const engagementRate = sumReach > 0 ? (sumEng / sumReach) * 100 : 0;
  const saveRate = sumReach > 0 ? (sumSaves / sumReach) * 100 : 0;
  const shareRate = sumReach > 0 ? (sumShares / sumReach) * 100 : 0;
  const avgCommentsPerPost = totalPosts ? Math.round(posts.reduce((s, p) => s + p.comments, 0) / totalPosts) : 0;

  // Compute a single top post for each rolling time window ending today. Uses REACH as the
  // "top" metric — matches how the existing 🏆 trophy in the table picks the winner. Falls
  // back to null when no post from that window has landed insights yet.
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  function pickTop(withinDays: number): ApiPost | null {
    const cutoff = now - withinDays * DAY;
    const eligible = (posts ?? []).filter((p) => new Date(p.timestamp).getTime() >= cutoff && insightsLoaded.has(p.id) && p.reach > 0);
    if (eligible.length === 0) return null;
    return eligible.reduce((b, p) => (p.reach > b.reach ? p : b), eligible[0]);
  }
  const topToday = pickTop(1);
  const topWeek = pickTop(7);
  const topMonth = pickTop(30);

  return (
    <>
      <LiveIndicator fetchedAt={fetchedAt} latencyMs={latencyMs} loading={loading} onRefresh={fetchData} />
      {/* Compact single row — 7 metric tiles side-by-side on desktop, wraps on smaller
          screens. Uses the local MiniStat component (below) so the type stays tight
          and doesn't inherit the large font/padding of the standard MetricCard. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        <MiniStat label="Posts" value={totalPosts.toLocaleString("en-IN")} />
        <MiniStat label="Avg Reach" value={avgReach.toLocaleString("en-IN")} />
        <MiniStat label="Avg Engagement" value={avgEng.toLocaleString("en-IN")} />
        <MiniStat label="Engagement Rate" value={insightsCount > 0 ? `${engagementRate.toFixed(2)}%` : "…"} />
        <MiniStat label="Avg Comments" value={avgCommentsPerPost.toLocaleString("en-IN")} />
        <MiniStat label="Save Rate" value={insightsCount > 0 ? `${saveRate.toFixed(2)}%` : "…"} />
        <MiniStat label="Share Rate" value={insightsCount > 0 ? `${shareRate.toFixed(2)}%` : "…"} />
      </div>

      {/* Top performers by rolling window. Only windows that actually have a post are
          rendered — no more empty "Today" card when nothing was posted in the last 24h.
          Also skips repeat entries (if today's top is also the week's top). */}
      {(topToday || topWeek || topMonth) && (() => {
        const winners: Array<{ label: string; post: ApiPost }> = [];
        if (topToday) winners.push({ label: "Today", post: topToday });
        if (topWeek && topWeek.id !== topToday?.id) winners.push({ label: "This week", post: topWeek });
        if (topMonth && topMonth.id !== topToday?.id && topMonth.id !== topWeek?.id) winners.push({ label: "This month", post: topMonth });
        if (winners.length === 0) return null;
        const cols = winners.length === 1 ? "md:grid-cols-1" : winners.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3";
        return (
          <div className="bg-amber-50/50 rounded-2xl border border-amber-200 overflow-hidden mb-6">
            <div className="px-5 py-3.5 border-b border-amber-100 flex items-center justify-between">
              <div className="text-base font-semibold text-gray-900">🏆 Top performers <span className="text-gray-500 font-normal text-sm">· by reach</span></div>
              {insightsProgress && (
                <span className="text-xs text-brand">loading engagement {insightsProgress.done}/{insightsProgress.total}</span>
              )}
            </div>
            <div className={`grid grid-cols-1 ${cols} divide-y md:divide-y-0 md:divide-x divide-amber-100`}>
              {winners.map((w) => <TopPerformerCard key={w.label} label={w.label} post={w.post} />)}
            </div>
          </div>
        );
      })()}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="text-sm font-medium">
            All posts <span className="text-gray-400 font-normal">({range.from} → {range.to}, {totalPosts} loaded</span>
            {insightsProgress && (
              <span className="ml-2 text-xs text-brand">· loading engagement {insightsProgress.done}/{insightsProgress.total}</span>
            )}
            <span className="text-gray-400 font-normal">)</span>
          </div>
          <div className="flex gap-2">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="text-xs border border-gray-200 rounded-md px-2 py-1">
              <option value="ALL">All types</option>
              <option value="REEL">Reels</option>
              <option value="CAROUSEL_ALBUM">Carousels</option>
              <option value="VIDEO">Videos</option>
              <option value="IMAGE">Images</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as "reach" | "engagement" | "date")} className="text-xs border border-gray-200 rounded-md px-2 py-1">
              <option value="date">Sort: Date</option>
              <option value="reach">Reach</option>
              <option value="engagement">Engagement</option>
            </select>
          </div>
        </div>
        {/* Instagram-style card grid — 4 cols on desktop, 3 on medium, 2 on small, 1 on mobile. */}
        {sorted.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">No posts match this filter.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-5">
            {sorted.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                isTop={p.id === top?.id}
                insightsLoaded={insightsLoaded.has(p.id)}
                onClick={() => setSelectedPost(p)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedPost && <PostDetailModal post={selectedPost} insightsLoaded={insightsLoaded.has(selectedPost.id)} onClose={() => setSelectedPost(null)} />}
    </>
  );
}

// Compact metric tile used in the single-row headline strip. Kept intentionally smaller
// than the shared MetricCard so all 7 fit horizontally on desktop without wrapping.
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3.5">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold truncate" title={label}>{label}</div>
      <div className="text-2xl font-bold text-gray-900 tabular-nums leading-tight mt-1 truncate">{value}</div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">
      Couldn’t load posts: {msg}
    </div>
  );
}

// Instagram-style card. Square thumbnail with an aspect-ratio wrapper so no cropping
// surprises. Type badge in the top-left, trophy in the top-right for the overall winner.
// Bottom strip shows caption preview + the four core numbers.
function PostCard({ post, isTop, insightsLoaded, onClick }: {
  post: ApiPost;
  isTop: boolean;
  insightsLoaded: boolean;
  onClick: () => void;
}) {
  const engagement = post.totalInteractions || (post.likes + post.comments);
  const dash = <span className="text-gray-300">···</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-brand hover:shadow-md transition group"
    >
      {/* Thumbnail — 1:1 square */}
      <div className="relative bg-gray-100 aspect-square overflow-hidden">
        {post.mediaUrl ? (
          <img src={post.mediaUrl} alt="" className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200" loading="lazy" decoding="async" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-3xl">
            {TYPE_ICON[post.type] ?? "?"}
          </div>
        )}
        {/* Type badge (top-left) */}
        <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm text-white text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
          <span>{TYPE_ICON[post.type] ?? ""}</span>
          <span>{TYPE_LABEL[post.type] ?? post.type}</span>
        </div>
        {isTop && (
          <div className="absolute top-2 right-2 bg-amber-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
            🏆 Top
          </div>
        )}
      </div>

      {/* Meta strip */}
      <div className="p-3 space-y-2">
        <div className="text-[10px] text-gray-500 uppercase tracking-wide">
          {format(parseISO(post.timestamp), "d MMM yyyy")}
        </div>
        <div className="text-xs text-gray-800 leading-snug line-clamp-2 min-h-[2lh]">
          {post.caption?.trim() || <span className="italic text-gray-400">(no caption)</span>}
        </div>
        {/* Quick stats — 4 columns */}
        <div className="grid grid-cols-4 gap-1 pt-2 border-t border-gray-100 text-center">
          <Stat icon="👁" label="Reach" value={insightsLoaded ? shortNum(post.reach) : dash} />
          <Stat icon="❤" label="Likes" value={shortNum(post.likes)} />
          <Stat icon="💬" label="Comm" value={shortNum(post.comments)} />
          <Stat icon="✨" label="Eng" value={insightsLoaded ? shortNum(engagement) : dash} />
        </div>
      </div>
    </button>
  );
}

function Stat({ icon, label, value }: { icon: string; label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500" title={label}>{icon}</div>
      <div className="text-[11px] font-semibold text-gray-900 tabular-nums leading-tight">{value}</div>
    </div>
  );
}

function shortNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-IN");
}

// Full-detail modal shown when a card is clicked. Big thumbnail on the left, full
// caption + every metric on the right. Also has a "View on Instagram" link that opens
// the actual post so the user can see comments / do actions there.
function PostDetailModal({ post, insightsLoaded, onClose }: {
  post: ApiPost;
  insightsLoaded: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const engagement = post.totalInteractions || (post.likes + post.comments);
  const engRate = post.reach > 0 ? ((engagement / post.reach) * 100).toFixed(2) : "0.00";
  const dash = <span className="text-gray-300">—</span>;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row" onClick={(e) => e.stopPropagation()}>
        {/* LEFT — thumbnail */}
        <div className="md:w-1/2 bg-black flex items-center justify-center min-h-[300px]">
          {post.mediaUrl ? (
            <img src={post.mediaUrl} alt="" className="max-w-full max-h-[80vh] object-contain" loading="lazy" decoding="async" />
          ) : (
            <div className="text-white text-6xl">{TYPE_ICON[post.type] ?? "?"}</div>
          )}
        </div>

        {/* RIGHT — details */}
        <div className="md:w-1/2 flex flex-col overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 sticky top-0 bg-white">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">{TYPE_LABEL[post.type] ?? post.type}</span>
              <span className="text-xs text-gray-500">{format(parseISO(post.timestamp), "d MMM yyyy · h:mm a")}</span>
            </div>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Close">×</button>
          </div>

          <div className="px-5 py-4 space-y-4">
            {/* Full caption */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Caption</div>
              <div className="text-sm text-gray-900 whitespace-pre-wrap break-words leading-relaxed">
                {post.caption?.trim() || <span className="italic text-gray-400">(no caption)</span>}
              </div>
            </div>

            {/* Metrics grid */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Performance</div>
              <div className="grid grid-cols-2 gap-3">
                <MetricRow label="Reach" value={insightsLoaded ? post.reach.toLocaleString("en-IN") : dash} />
                <MetricRow label="Engagement" value={insightsLoaded ? engagement.toLocaleString("en-IN") : dash} />
                <MetricRow label="Likes" value={post.likes.toLocaleString("en-IN")} />
                <MetricRow label="Comments" value={post.comments.toLocaleString("en-IN")} />
                <MetricRow label="Shares" value={insightsLoaded ? post.shares.toLocaleString("en-IN") : dash} />
                <MetricRow label="Saves" value={insightsLoaded ? post.saves.toLocaleString("en-IN") : dash} />
                {post.views !== undefined && <MetricRow label="Views" value={insightsLoaded ? post.views.toLocaleString("en-IN") : dash} />}
                <MetricRow label="Engagement rate" value={insightsLoaded ? `${engRate}%` : dash} />
              </div>
            </div>

            {/* Open on Instagram */}
            <a href={post.permalink} target="_blank" rel="noopener noreferrer"
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

// One card = the top post for a rolling window (Today / This week / This month).
// Renders a compact preview so three fit side-by-side without scrolling on desktop.
function TopPerformerCard({ label, post }: { label: string; post: ApiPost | null }) {
  if (!post) {
    return (
      <div className="p-4">
        <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">{label}</div>
        <div className="text-xs text-gray-400 italic py-6 text-center">
          Waiting for insights…
        </div>
      </div>
    );
  }
  const engagement = post.totalInteractions || (post.likes + post.comments);
  return (
    <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="block p-5 hover:bg-amber-50/60 transition group">
      <div className="text-xs uppercase tracking-wide text-amber-700 font-semibold mb-3">{label}</div>
      <div className="flex gap-4">
        {post.mediaUrl ? (
          <img src={post.mediaUrl} alt="" className="w-36 h-36 object-cover rounded-xl shrink-0" loading="lazy" decoding="async" />
        ) : (
          <div className="w-36 h-36 rounded-xl bg-gray-100 shrink-0 flex items-center justify-center text-2xl text-gray-300">{TYPE_LABEL[post.type]?.[0] ?? "?"}</div>
        )}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="text-[11px] text-gray-500">{TYPE_LABEL[post.type] ?? post.type} · {format(parseISO(post.timestamp), "d MMM")}</div>
          <div className="text-sm text-gray-900 leading-snug mt-1 line-clamp-3 group-hover:text-brand">
            {post.caption?.trim() || <span className="italic text-gray-400">(no caption)</span>}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-auto pt-3 text-center">
            <div>
              <div className="text-[12px] uppercase tracking-wide text-gray-500">Reach</div>
              <div className="text-xl font-bold text-gray-900 tabular-nums">{post.reach.toLocaleString("en-IN")}</div>
            </div>
            <div>
              <div className="text-[12px] uppercase tracking-wide text-gray-500">Likes</div>
              <div className="text-xl font-bold text-gray-900 tabular-nums">{post.likes.toLocaleString("en-IN")}</div>
            </div>
            <div>
              <div className="text-[12px] uppercase tracking-wide text-gray-500">Engage</div>
              <div className="text-xl font-bold text-gray-900 tabular-nums">{engagement.toLocaleString("en-IN")}</div>
            </div>
          </div>
        </div>
      </div>
    </a>
  );
}
