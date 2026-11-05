"use client";
import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { LiveIndicator } from "@/components/LiveIndicator";
import { useApi } from "@/lib/use-api";

type CompetitorMedia = {
  id: string;
  caption?: string;
  media_type: string;
  thumbnail_url?: string;
  media_url?: string;
  permalink?: string;
  timestamp: string;
  like_count: number;
  comments_count: number;
};
type Competitor = {
  username: string;
  name?: string;
  biography?: string;
  profile_picture_url?: string;
  followers_count: number;
  follows_count?: number;
  media_count: number;
  recent: CompetitorMedia[];
  avgLikesRecent: number;
  avgCommentsRecent: number;
  engagementRatePct: number;
  postsLast30d: number;
};
type ErrorRow = { error: string; username: string };
type BenchmarkData = {
  niche: string;
  niches: string[];
  queriedAt: string;
  latencyMs: number;
  sourceAccount: { id: string; handle: string };
  competitors: (Competitor | ErrorRow)[];
};

function isError(c: Competitor | ErrorRow): c is ErrorRow {
  return (c as ErrorRow).error !== undefined;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default function BenchmarkPage() {
  return (
    <DashboardShell title="Benchmark" subtitle="Track competitor IG accounts: followers, posting cadence, engagement.">
      {({ accountId, range }) => <BenchmarkInner accountId={accountId} range={range} />}
    </DashboardShell>
  );
}

function BenchmarkInner({ accountId }: { accountId: string; range: { from: string; to: string } }) {
  const [niche, setNiche] = useState<string>("");
  const [customHandles, setCustomHandles] = useState("");
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  // Cache key includes niche and handles so switching niches picks up the right cached
  // response instead of showing stale data or refetching.
  const qs = new URLSearchParams({ accountId });
  if (niche) qs.set("niche", niche);
  if (customHandles.trim()) qs.set("handles", customHandles);
  const { data, error, isLoading, refresh, mutate } = useApi<BenchmarkData>(`/api/benchmark?${qs.toString()}`);
  const loading = isLoading;

  // Manual refetch trigger that also sets the niche/handles (used by the buttons).
  function load(opts?: { niche?: string; handles?: string }) {
    if (opts?.niche !== undefined) setNiche(opts.niche);
    if (opts?.handles !== undefined) setCustomHandles(opts.handles);
    if (!opts) refresh();
  }

  useEffect(() => { if (data?.niche && !niche) setNiche(data.niche); }, [data, niche]);
  useEffect(() => { if (data) setFetchedAt(Date.now()); }, [data]);
  void mutate;

  const sorted = data
    ? [...data.competitors].sort((a, b) => {
        if (isError(a) && isError(b)) return 0;
        if (isError(a)) return 1;
        if (isError(b)) return -1;
        return b.followers_count - a.followers_count;
      })
    : [];

  const valid = sorted.filter((c): c is Competitor => !isError(c));
  const erValues = valid.map((c) => c.engagementRatePct).filter((v) => v > 0);
  const medianER = erValues.length
    ? [...erValues].sort((a, b) => a - b)[Math.floor(erValues.length / 2)]
    : 0;

  return (
    <>
      <div className="flex items-end justify-between mb-5">
        <div>
          <h2 className="text-xl font-semibold">Competitor Benchmark <span className="text-gray-400 text-base font-normal">· {data?.niche || "—"}</span></h2>
          <p className="text-sm text-gray-500 mt-0.5">Public Instagram accounts tracked via Meta&apos;s public data — followers, posting cadence, engagement rate.</p>
        </div>
        <LiveIndicator fetchedAt={fetchedAt} latencyMs={data?.latencyMs ?? null} onRefresh={() => load({ niche })} loading={loading} />
      </div>

      {/* Filter row */}
      <div className="bg-white rounded-xl p-3 mb-5 border border-gray-100 shadow-sm flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500 uppercase tracking-wide pl-1">Niche:</span>
        {(data?.niches || []).map((n) => (
          <button
            key={n}
            onClick={() => { setCustomHandles(""); load({ niche: n }); }}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${
              n === niche
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-white text-gray-700 border-gray-200 hover:border-violet-300"
            }`}
          >
            {n}
          </button>
        ))}
        <span className="text-gray-300 mx-1">|</span>
        <input
          value={customHandles}
          onChange={(e) => setCustomHandles(e.target.value)}
          placeholder="custom: @handle1, @handle2"
          className="text-xs px-3 py-1.5 rounded-full border border-gray-200 focus:outline-none focus:border-violet-400 min-w-[260px]"
          onKeyDown={(e) => { if (e.key === "Enter" && customHandles.trim()) load({ handles: customHandles }); }}
        />
        {customHandles.trim() && (
          <button onClick={() => load({ handles: customHandles })} className="text-xs px-3 py-1.5 rounded-full bg-violet-600 text-white">
            Track
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-5 text-sm">
          {error.message}
        </div>
      )}

      {loading && !data && (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-400 border border-gray-100">Querying Meta…</div>
      )}

      {/* Summary strip */}
      {valid.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
          <SummaryCard label="Competitors tracked" value={valid.length.toString()} />
          <SummaryCard label="Avg followers" value={fmt(Math.round(valid.reduce((s, c) => s + c.followers_count, 0) / valid.length))} />
          <SummaryCard label="Median engagement rate" value={`${medianER.toFixed(2)}%`} />
          <SummaryCard label="Avg posts / 30d" value={(valid.reduce((s, c) => s + c.postsLast30d, 0) / valid.length).toFixed(1)} />
        </div>
      )}

      {/* Competitor grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sorted.map((c) => isError(c) ? (
          <div key={c.username} className="bg-white rounded-2xl p-5 border border-amber-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="font-mono text-sm">@{c.username}</div>
              <span className="text-[10px] uppercase tracking-wide bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
                error
              </span>
            </div>
            <p className="text-xs text-gray-500">Couldn&apos;t pull this account — it may be private, renamed, or a personal profile.</p>
            <p className="text-[11px] text-gray-400 mt-2">Only public Instagram Business or Creator accounts can be tracked.</p>
          </div>
        ) : (
          <CompetitorCard key={c.username} c={c} medianER={medianER} />
        ))}
      </div>
    </>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
    </div>
  );
}

function CompetitorCard({ c, medianER }: { c: Competitor; medianER: number }) {
  const erDelta = c.engagementRatePct - medianER;
  const erBadge = c.engagementRatePct >= medianER
    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">+{erDelta.toFixed(2)}pp</span>
    : <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700">{erDelta.toFixed(2)}pp</span>;
  const top3 = [...c.recent].sort((a, b) => (b.like_count + b.comments_count) - (a.like_count + a.comments_count)).slice(0, 3);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition">
      <div className="p-5">
        <div className="flex items-start gap-3">
          {c.profile_picture_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.profile_picture_url} alt={c.username} className="w-12 h-12 rounded-full object-cover border border-gray-100" loading="lazy" decoding="async" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gray-100" />
          )}
          <div className="min-w-0 flex-1">
            <a href={`https://instagram.com/${c.username}`} target="_blank" rel="noopener noreferrer" className="font-mono text-sm hover:underline">
              @{c.username}
            </a>
            {c.name && <div className="text-xs text-gray-500 truncate">{c.name}</div>}
          </div>
        </div>
        {c.biography && <p className="text-[11px] text-gray-500 mt-2 line-clamp-2">{c.biography}</p>}

        <div className="grid grid-cols-3 gap-2 mt-4">
          <Stat label="Followers" value={fmt(c.followers_count)} />
          <Stat label="Posts" value={fmt(c.media_count)} />
          <Stat label="Posts/30d" value={c.postsLast30d.toString()} />
        </div>

        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400">Engagement rate</div>
            <div className="text-lg font-semibold tabular-nums">{c.engagementRatePct.toFixed(2)}%</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-gray-400">vs niche median</div>
            <div className="mt-1">{erBadge}</div>
          </div>
        </div>

        <div className="mt-3 text-[11px] text-gray-500 flex justify-between">
          <span>Avg likes/post <b className="text-gray-700 tabular-nums">{fmt(c.avgLikesRecent)}</b></span>
          <span>Avg comments <b className="text-gray-700 tabular-nums">{fmt(c.avgCommentsRecent)}</b></span>
        </div>
      </div>

      {top3.length > 0 && (
        <div className="border-t border-gray-100 px-5 py-3 bg-gray-50/50">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Top recent posts</div>
          <div className="grid grid-cols-3 gap-2">
            {top3.map((m) => (
              <a key={m.id} href={m.permalink} target="_blank" rel="noopener noreferrer" className="relative block aspect-square rounded-lg overflow-hidden bg-gray-100 group">
                {m.thumbnail_url || m.media_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.thumbnail_url || m.media_url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                ) : null}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent text-white text-[10px] px-1.5 py-1 flex justify-between">
                  <span>♥ {fmt(m.like_count)}</span>
                  <span>💬 {fmt(m.comments_count)}</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
