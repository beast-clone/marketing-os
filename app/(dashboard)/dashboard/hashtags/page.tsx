"use client";
import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { LiveIndicator } from "@/components/LiveIndicator";
import { useApi } from "@/lib/use-api";

type HashtagPostRef = {
  id: string; permalink: string; thumbnail: string; timestamp: string;
  reach: number; likes: number; comments: number; shares: number; saves: number;
};
type HashtagStat = {
  tag: string;
  posts: number;
  totalReach: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;
  avgReach: number;
  avgEngagement: number;
  engagementRatePct: number;
  topPosts: HashtagPostRef[];
};
type Resp = {
  latencyMs: number;
  range: { from?: string; to?: string };
  postsAnalyzed: number;
  uniqueHashtags: number;
  qualifyingHashtags: number;
  hashtags: HashtagStat[];
  error?: string;
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default function HashtagsPage() {
  return (
    <DashboardShell title="Hashtags" subtitle="Which of your hashtags actually drive reach + engagement.">
      {({ accountId, range }) => <Inner accountId={accountId} range={range} />}
    </DashboardShell>
  );
}

function Inner({ accountId, range }: { accountId: string; range: { from: string; to: string } }) {
  const [sortBy, setSortBy] = useState<"er" | "reach" | "posts" | "engagement">("er");
  const [minPosts, setMinPosts] = useState(2);
  const qs = new URLSearchParams({ accountId, from: range.from, to: range.to, minPosts: String(minPosts) }).toString();
  const { data, error, isLoading, refresh } = useApi<Resp>(`/api/hashtags?${qs}`);
  const loading = isLoading;
  const load = () => refresh();
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  useEffect(() => { if (data) setFetchedAt(Date.now()); }, [data]);

  const sorted = useMemo(() => {
    if (!data) return [];
    const arr = [...data.hashtags];
    arr.sort((a, b) => {
      if (sortBy === "er") return b.engagementRatePct - a.engagementRatePct;
      if (sortBy === "reach") return b.avgReach - a.avgReach;
      if (sortBy === "posts") return b.posts - a.posts;
      return b.avgEngagement - a.avgEngagement;
    });
    return arr;
  }, [data, sortBy]);

  const top = sorted[0];

  return (
    <>
      <div className="flex items-end justify-between mb-5">
        <div>
          <div className="text-xs text-gray-500">
            {data ? <>Analyzed <b>{data.postsAnalyzed}</b> posts · found <b>{data.uniqueHashtags}</b> unique tags · <b>{data.qualifyingHashtags}</b> used ≥ {minPosts} times</> : "Loading…"}
          </div>
        </div>
        <LiveIndicator fetchedAt={fetchedAt} latencyMs={data?.latencyMs ?? null} onRefresh={load} loading={loading} />
      </div>

      {/* Sort + filter */}
      <div className="bg-white rounded-xl p-3 mb-5 border border-gray-100 shadow-sm flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500 uppercase tracking-wide pl-1">Sort:</span>
        {([
          { k: "er", l: "Engagement rate" },
          { k: "reach", l: "Avg reach" },
          { k: "engagement", l: "Avg engagement" },
          { k: "posts", l: "Post count" },
        ] as const).map(({ k, l }) => (
          <button key={k} onClick={() => setSortBy(k)} className={`text-xs px-3 py-1.5 rounded-full border transition ${
            sortBy === k ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-700 border-gray-200 hover:border-violet-300"
          }`}>{l}</button>
        ))}
        <span className="text-gray-300 mx-2">|</span>
        <span className="text-xs text-gray-500">Min posts:</span>
        {[1, 2, 3, 5].map((n) => (
          <button key={n} onClick={() => setMinPosts(n)} className={`text-xs w-7 h-7 rounded-full border transition ${
            minPosts === n ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-700 border-gray-200"
          }`}>{n}</button>
        ))}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-5 text-sm">{error.message}</div>}

      {loading && !data && <div className="bg-white rounded-2xl p-10 text-center text-gray-400 border border-gray-100">Analyzing posts and hashtags…</div>}

      {/* Hero: top hashtag */}
      {top && (
        <div className="bg-gradient-to-r from-violet-600 to-fuchsia-600 rounded-2xl p-6 mb-5 text-white shadow-lg">
          <div className="text-xs uppercase tracking-wider text-violet-100">🏆 Top performer</div>
          <div className="flex items-end justify-between mt-2 flex-wrap gap-4">
            <div>
              <div className="text-3xl font-mono font-bold">{top.tag}</div>
              <div className="text-sm text-violet-100 mt-1">
                used in <b>{top.posts}</b> posts · drove <b>{fmt(top.totalReach)}</b> reach · {fmt(top.totalLikes + top.totalComments + top.totalShares + top.totalSaves)} engagements
              </div>
            </div>
            <div className="flex gap-6">
              <div>
                <div className="text-[10px] uppercase text-violet-200">Avg reach</div>
                <div className="text-2xl font-semibold tabular-nums">{fmt(top.avgReach)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-violet-200">Engagement rate</div>
                <div className="text-2xl font-semibold tabular-nums">{top.engagementRatePct.toFixed(2)}%</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {sorted.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Hashtag</th>
                <th className="text-right px-3 py-3 font-medium">Posts</th>
                <th className="text-right px-3 py-3 font-medium">Total reach</th>
                <th className="text-right px-3 py-3 font-medium">Avg reach</th>
                <th className="text-right px-3 py-3 font-medium">Avg engagement</th>
                <th className="text-right px-3 py-3 font-medium">ER %</th>
                <th className="text-left px-4 py-3 font-medium">Recent posts</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.tag} className="border-t border-gray-100 hover:bg-violet-50/30 transition">
                  <td className="px-4 py-3">
                    <div className="font-mono text-sm font-medium text-violet-700">{s.tag}</div>
                  </td>
                  <td className="text-right px-3 py-3 tabular-nums">{s.posts}</td>
                  <td className="text-right px-3 py-3 tabular-nums text-gray-600">{fmt(s.totalReach)}</td>
                  <td className="text-right px-3 py-3 tabular-nums font-medium">{fmt(s.avgReach)}</td>
                  <td className="text-right px-3 py-3 tabular-nums">{fmt(s.avgEngagement)}</td>
                  <td className="text-right px-3 py-3 tabular-nums">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      s.engagementRatePct >= 5 ? "bg-emerald-50 text-emerald-700"
                      : s.engagementRatePct >= 2 ? "bg-amber-50 text-amber-700"
                      : "bg-gray-100 text-gray-600"
                    }`}>{s.engagementRatePct.toFixed(2)}%</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {s.topPosts.map((p) => (
                        <a key={p.id} href={p.permalink} target="_blank" rel="noopener noreferrer" className="block w-10 h-10 rounded overflow-hidden bg-gray-100 border border-gray-200 hover:ring-2 hover:ring-violet-400 transition">
                          {p.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                          ) : null}
                        </a>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && sorted.length === 0 && data && (
        <div className="bg-white rounded-2xl p-10 text-center border border-gray-100 text-gray-500 text-sm">
          No hashtags found in the selected range that were used ≥ {minPosts} times.
          {data.uniqueHashtags > 0 && <> Try lowering the &ldquo;Min posts&rdquo; filter — there are {data.uniqueHashtags} unique tags in this range.</>}
        </div>
      )}
    </>
  );
}
