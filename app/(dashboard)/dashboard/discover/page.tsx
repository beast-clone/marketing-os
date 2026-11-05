"use client";
import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { LiveIndicator } from "@/components/LiveIndicator";

type Media = {
  id: string; caption?: string; media_type: string;
  media_url?: string; thumbnail_url?: string; permalink: string;
  timestamp: string; like_count?: number; comments_count?: number;
  username?: string;
};
type AccountFeed = { account: string; handle: string; items: Media[] };
type NicheBucket = { label: string; tag: string; items: Media[]; cached: boolean; ageMs: number | null; provider?: "apify" | "hikerapi"; error?: string };
type ProviderHealth = {
  status: "healthy" | "degraded" | "failed" | "recovering";
  last_success: string | null;
  last_failure: string | null;
  failure_reason: string | null;
  monthly_cost_estimate: number;
} | null;
type DiscoverData = {
  latencyMs: number;
  type: string;
  mentions?: AccountFeed[];
  tagged?: AccountFeed[];
  niche?: { audience: string; buckets: NicheBucket[]; health?: { apify: ProviderHealth; hikerapi: ProviderHealth } | null };
  search?: { tag: string; items: Media[]; cached: boolean; ageMs: number | null; provider?: "apify" | "hikerapi"; error?: string };
  error?: string;
};

const PLACEHOLDER_EXAMPLES = [
  "Try: neetpg2026",
  "Try: medstudentlife",
  "Try: doctorabroad",
  "Try: mbbsindia",
  "Try: usmlestep2",
  "Try: foreignmedicalgraduate",
];

function fmt(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function ageLabel(ageMs: number | null | undefined): string {
  if (ageMs == null) return "just now";
  const s = Math.floor(ageMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function DiscoverPage() {
  return (
    <DashboardShell title="Discover" subtitle="What the medical-ed crowd is posting right now — niche hashtag feed, mentions of you, UGC where you're tagged.">
      {({ accountId }) => <Inner accountId={accountId} />}
    </DashboardShell>
  );
}

function Inner({ accountId }: { accountId: string }) {
  const [tab, setTab] = useState<"niche" | "mentions" | "tagged">("niche");
  const [data, setData] = useState<DiscoverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [preview, setPreview] = useState<Media | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<DiscoverData["search"] | null>(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  useEffect(() => {
    if (!preview) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setPreview(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [preview]);
  useEffect(() => {
    const t = setInterval(() => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length), 3000);
    return () => clearInterval(t);
  }, []);

  async function runSearch(raw: string) {
    const clean = raw.replace(/^#/, "").trim().toLowerCase();
    if (!clean) return;
    setSearching(true);
    setSearchResult(null);
    try {
      const qs = new URLSearchParams({ accountId, search: clean });
      const r = await fetch(`/api/discover?${qs}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setSearchResult(j.search || null);
    } catch (e) {
      setSearchResult({ tag: `#${clean}`, items: [], cached: false, ageMs: null, error: (e as Error).message });
    } finally {
      setSearching(false);
    }
  }

  function load(force = false, signal?: AbortSignal) {
    setLoading(true);
    const qs = new URLSearchParams({ accountId, type: "all" });
    if (force) qs.set("force", "1");
    fetch(`/api/discover?${qs}`, { signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: DiscoverData) => {
        setData(d);
        setFetchedAt(Date.now());
        setLoading(false);
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        setLoading(false);
      });
  }
  useEffect(() => {
    const ctrl = new AbortController();
    load(false, ctrl.signal);
    return () => ctrl.abort();
    /* eslint-disable-next-line */
  }, [accountId]);

  return (
    <>
      <div className="flex items-end justify-between mb-5">
        <div className="text-xs text-gray-500">
          Scoped to <b>{data?.niche?.audience ? "medical-ed audience" : "—"}</b> — cached 30 days for hashtag feed, 30 min for mentions/tagged.
        </div>
        <LiveIndicator fetchedAt={fetchedAt} latencyMs={data?.latencyMs ?? null} onRefresh={() => load(true)} loading={loading} />
      </div>

      {data?.niche?.health && <BudgetMeter health={data.niche.health} />}

      {/* Search bar */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 mb-5">
        <form
          onSubmit={(e) => { e.preventDefault(); runSearch(searchInput); }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">#</span>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={PLACEHOLDER_EXAMPLES[placeholderIdx]}
              className="w-full pl-7 pr-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>
          <button
            type="submit"
            disabled={searching || !searchInput.trim()}
            className="bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg px-5 py-2.5 transition flex items-center gap-1.5"
          >
            {searching ? (
              <>
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Searching…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                Search
              </>
            )}
          </button>
          {searchResult && (
            <button
              type="button"
              onClick={() => { setSearchResult(null); setSearchInput(""); }}
              className="text-xs text-gray-500 hover:text-gray-800 px-2 py-2"
            >
              Clear
            </button>
          )}
        </form>
        <div className="text-[11px] text-gray-400 mt-1.5 pl-1">
          New hashtag → costs ~$0.023 (9 posts). Already in your default 24 → free from cache.
        </div>
      </div>

      {/* Search result section */}
      {searchResult && tab === "niche" && (
        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5 mb-5">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-violet-600 font-semibold">🔍 You searched</div>
              <div className="text-lg font-mono font-semibold text-violet-700 mt-0.5">{searchResult.tag}</div>
            </div>
            <div className="text-[11px] text-gray-500 text-right">
              {searchResult.items.length} posts
              {searchResult.provider && <> · via {searchResult.provider}</>}
              {searchResult.cached && <> · cached</>}
            </div>
          </div>
          {searchResult.error ? (
            <div className="text-sm text-rose-600 bg-white rounded-lg p-3">{searchResult.error}</div>
          ) : searchResult.items.length === 0 ? (
            <div className="text-sm text-gray-500 bg-white rounded-lg p-3">No posts returned for this hashtag.</div>
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-9 gap-2">
              {searchResult.items.map((m) => <MediaTile key={m.id} m={m} onSelect={setPreview} />)}
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl p-2 mb-5 border border-gray-100 shadow-sm inline-flex gap-1">
        {([
          { k: "niche", l: "Niche hashtag feed", c: data?.niche?.buckets.reduce((s, b) => s + b.items.length, 0) ?? 0 },
          { k: "mentions", l: "Mentions of you", c: data?.mentions?.reduce((s, a) => s + a.items.length, 0) ?? 0 },
          { k: "tagged", l: "UGC (tagged)", c: data?.tagged?.reduce((s, a) => s + a.items.length, 0) ?? 0 },
        ] as const).map(({ k, l, c }) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`text-xs px-4 py-2 rounded-lg transition flex items-center gap-2 ${
              tab === k ? "bg-violet-600 text-white" : "text-gray-700 hover:bg-gray-50"
            }`}
          >
            {l}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium tabular-nums ${
              tab === k ? "bg-white/20" : "bg-gray-100 text-gray-500"
            }`}>{c}</span>
          </button>
        ))}
      </div>

      {loading && !data && <div className="bg-white rounded-2xl p-10 text-center text-gray-400 border border-gray-100">Loading…</div>}

      {tab === "niche" && data?.niche && (
        <>
          <TopHashtagsLeaderboard buckets={data.niche.buckets} />
          <NicheFeed niche={data.niche} onSelect={setPreview} />
        </>
      )}
      {tab === "mentions" && data?.mentions && <FeedByAccount feeds={data.mentions} kind="mentions" onSelect={setPreview} />}
      {tab === "tagged" && data?.tagged && <FeedByAccount feeds={data.tagged} kind="tagged" onSelect={setPreview} />}

      {preview && <PreviewModal m={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

function TopHashtagsLeaderboard({ buckets }: { buckets: NicheBucket[] }) {
  const ranked = buckets
    .filter((b) => b.items.length > 0)
    .map((b) => {
      const totalEng = b.items.reduce((s, m) => s + (m.like_count || 0) + (m.comments_count || 0), 0);
      const avgEng = b.items.length > 0 ? Math.round(totalEng / b.items.length) : 0;
      const topThumb = b.items
        .slice()
        .sort((a, b) => (b.like_count || 0) + (b.comments_count || 0) - ((a.like_count || 0) + (a.comments_count || 0)))[0];
      return { tag: b.tag, label: b.label, avgEng, count: b.items.length, totalEng, topThumb };
    })
    .sort((a, b) => b.avgEng - a.avgEng);

  const top10 = ranked.slice(0, 10);
  if (top10.length === 0) return null;
  const maxEng = top10[0].avgEng;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <span className="text-violet-600">📊</span> Top hashtags in your niche
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5">Ranked by average engagement (likes + comments) across top posts. Click to jump to that bucket.</p>
        </div>
        <div className="text-[11px] text-gray-400">From {ranked.length} active hashtags</div>
      </div>
      <div className="space-y-1.5">
        {top10.map((r, i) => {
          const pct = maxEng > 0 ? (r.avgEng / maxEng) * 100 : 0;
          const rankEmoji = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
          return (
            <button
              key={r.tag}
              onClick={() => {
                const id = `bucket-${r.tag.replace(/^#/, "")}`;
                document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-violet-50 transition group text-left"
            >
              <div className="w-6 text-center text-sm font-bold text-gray-400 group-hover:text-violet-600 tabular-nums">
                {rankEmoji || `${i + 1}.`}
              </div>
              {r.topThumb && (
                <div className="w-9 h-9 rounded-md overflow-hidden bg-gray-100 flex-shrink-0">
                  {(r.topThumb.thumbnail_url || r.topThumb.media_url) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.topThumb.thumbnail_url || r.topThumb.media_url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  )}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono font-medium text-violet-700 truncate">{r.tag}</div>
                <div className="text-[10px] text-gray-500">{r.label} · {r.count} posts</div>
              </div>
              <div className="flex-1 max-w-[200px]">
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all" style={{ width: `${Math.max(pct, 4)}%` }} />
                </div>
              </div>
              <div className="text-right min-w-[90px]">
                <div className="text-sm font-semibold tabular-nums text-gray-800">{r.avgEng.toLocaleString()}</div>
                <div className="text-[12px] uppercase tracking-wide text-gray-400">avg engagement</div>
              </div>
              <svg className="text-gray-300 group-hover:text-violet-500 transition" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NicheFeed({ niche, onSelect }: { niche: { audience: string; buckets: NicheBucket[] }; onSelect: (m: Media) => void }) {
  // Group buckets by label (since each bucket = one tag, we want to group by label)
  const grouped = new Map<string, NicheBucket[]>();
  for (const b of niche.buckets) {
    const arr = grouped.get(b.label) || [];
    arr.push(b);
    grouped.set(b.label, arr);
  }
  const allEmpty = niche.buckets.every((b) => b.items.length === 0);
  if (allEmpty) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-amber-900 text-sm">
        <div className="font-medium mb-1">No niche posts returned.</div>
        <div className="text-xs">
          This usually means either: (1) the token is missing the <code className="bg-amber-100 px-1 rounded">instagram_basic</code> hashtag-search permission, or (2) Meta&apos;s 30-tag-per-7-days search quota was exhausted in another tool.
          Edit <code className="bg-amber-100 px-1 rounded">niche.json</code> in the repo root to change which hashtags we track.
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {Array.from(grouped.entries()).map(([label, buckets]) => (
        <div key={label}>
          <div className="flex items-baseline gap-2 mb-3">
            <h3 className="text-base font-semibold">{label}</h3>
            <span className="text-xs text-gray-400">{buckets.length} tag{buckets.length > 1 ? "s" : ""}</span>
          </div>
          {buckets.map((b) => (
            <div key={b.tag} id={`bucket-${b.tag.replace(/^#/, "")}`} className="mb-5 scroll-mt-6">
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-sm font-mono text-violet-700 flex items-center gap-2">
                  {b.tag}
                  {b.provider && (
                    <span className={`text-[12px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                      b.provider === "apify" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"
                    }`}>via {b.provider}</span>
                  )}
                </div>
                <div className="text-[10px] text-gray-400">
                  {b.items.length} top posts · {b.cached ? `cached ${ageLabel(b.ageMs)}` : "live"}
                  {b.error && <span className="ml-2 text-rose-600">· {b.error.slice(0, 60)}</span>}
                </div>
              </div>
              {b.items.length === 0 ? (
                <div className="text-xs text-gray-400 italic pl-2">No top posts returned by Meta for this tag.</div>
              ) : (
                <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-9 gap-2">
                  {b.items.map((m) => <MediaTile key={m.id} m={m} onSelect={onSelect} />)}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function FeedByAccount({ feeds, kind, onSelect }: { feeds: AccountFeed[]; kind: "mentions" | "tagged"; onSelect: (m: Media) => void }) {
  const allEmpty = feeds.every((f) => f.items.length === 0);
  if (allEmpty) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 text-center text-gray-500 text-sm">
        <div className="font-medium mb-1">Nothing here yet.</div>
        <div className="text-xs">
          {kind === "mentions"
            ? "No-one has @-mentioned any of your 5 accounts in their captions recently."
            : "No-one has tagged any of your 5 accounts in their photos recently."}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {feeds.map((f) => (
        <div key={f.account}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-semibold">{f.handle}</h3>
            <div className="text-xs text-gray-400">{f.items.length} {kind}</div>
          </div>
          {f.items.length === 0 ? (
            <div className="text-xs text-gray-400 italic pl-2 mb-2">No recent {kind} for this account.</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {f.items.map((m) => <MediaCard key={m.id} m={m} onSelect={onSelect} />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function BudgetMeter({ health }: { health: { apify: ProviderHealth; hikerapi: ProviderHealth } }) {
  const rows: { label: string; provider: "apify" | "hikerapi"; budget: number; h: ProviderHealth }[] = [
    { label: "Apify (primary)", provider: "apify", budget: 5, h: health.apify },
    { label: "HikerAPI (fallback)", provider: "hikerapi", budget: 5, h: health.hikerapi },
  ];
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 mb-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map(({ label, provider, budget, h }) => {
          const spent = h?.monthly_cost_estimate ?? 0;
          const pct = Math.min(100, (spent / budget) * 100);
          const status = h?.status ?? "unknown";
          const statusColor = status === "healthy" ? "bg-emerald-500"
            : status === "degraded" ? "bg-amber-500"
            : status === "failed" ? "bg-rose-500"
            : status === "recovering" ? "bg-sky-500"
            : "bg-gray-300";
          return (
            <div key={provider}>
              <div className="flex items-baseline justify-between text-xs mb-1">
                <span className="font-medium text-gray-700 flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
                  {label}
                  <span className="text-[10px] text-gray-400 uppercase">{status}</span>
                </span>
                <span className="tabular-nums text-gray-600">
                  ${spent.toFixed(3)} <span className="text-gray-400">/ ${budget.toFixed(2)}</span>
                </span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${
                  pct < 70 ? "bg-emerald-500" : pct < 90 ? "bg-amber-500" : "bg-rose-500"
                }`} style={{ width: `${Math.max(pct, 2)}%` }} />
              </div>
              {h?.failure_reason && (
                <div className="text-[10px] text-rose-600 mt-1 truncate">last error: {h.failure_reason.slice(0, 80)}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MediaTile({ m, onSelect }: { m: Media; onSelect: (m: Media) => void }) {
  const img = m.thumbnail_url || m.media_url;
  return (
    <button onClick={() => onSelect(m)} className="block aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200 hover:ring-2 hover:ring-violet-400 transition group relative cursor-pointer text-left">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <div className="w-full h-full bg-gray-100" />
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent text-white text-[10px] px-1.5 py-1 opacity-0 group-hover:opacity-100 transition flex justify-between">
        <span>♥ {fmt(m.like_count)}</span>
        <span>💬 {fmt(m.comments_count)}</span>
      </div>
    </button>
  );
}

function MediaCard({ m, onSelect }: { m: Media; onSelect: (m: Media) => void }) {
  const img = m.thumbnail_url || m.media_url;
  return (
    <button onClick={() => onSelect(m)} className="block bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-md transition group text-left w-full cursor-pointer">
      <div className="aspect-square bg-gray-100 relative">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
        ) : null}
        {m.username && (
          <div className="absolute top-2 left-2 bg-black/60 backdrop-blur text-white text-[10px] px-2 py-0.5 rounded-full font-mono">
            @{m.username}
          </div>
        )}
      </div>
      <div className="p-2.5">
        {m.caption && <p className="text-[11px] text-gray-700 line-clamp-2 leading-snug">{m.caption}</p>}
        <div className="flex justify-between text-[10px] text-gray-500 mt-2 tabular-nums">
          <span>♥ {fmt(m.like_count)} · 💬 {fmt(m.comments_count)}</span>
          <span>{new Date(m.timestamp).toLocaleDateString()}</span>
        </div>
      </div>
    </button>
  );
}

function PreviewModal({ m, onClose }: { m: Media; onClose: () => void }) {
  const img = m.thumbnail_url || m.media_url;
  const isVideo = m.media_type === "VIDEO";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col md:flex-row overflow-hidden shadow-2xl">
        {/* Left: image / video */}
        <div className="md:w-3/5 bg-black flex items-center justify-center relative">
          {isVideo && m.media_url ? (
            <video src={m.media_url} poster={img} controls autoPlay className="w-full max-h-[60vh] md:max-h-[90vh] object-contain" />
          ) : img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt="" className="w-full max-h-[60vh] md:max-h-[90vh] object-contain" loading="lazy" decoding="async" />
          ) : (
            <div className="w-full h-64 bg-gray-100" />
          )}
          <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 bg-black/60 hover:bg-black/80 text-white rounded-full w-9 h-9 flex items-center justify-center transition">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Right: meta */}
        <div className="md:w-2/5 flex flex-col p-5 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            {m.username ? (
              <a href={`https://instagram.com/${m.username}`} target="_blank" rel="noopener noreferrer" className="font-mono text-sm font-medium text-violet-700 hover:underline">@{m.username}</a>
            ) : <span className="text-sm text-gray-400">unknown account</span>}
            <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {m.media_type === "VIDEO" ? "Reel/Video" : m.media_type === "CAROUSEL_ALBUM" ? "Carousel" : "Image"}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4 text-center">
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-[10px] uppercase text-gray-400">Likes</div>
              <div className="text-base font-semibold tabular-nums">{fmt(m.like_count)}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-[10px] uppercase text-gray-400">Comments</div>
              <div className="text-base font-semibold tabular-nums">{fmt(m.comments_count)}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-[10px] uppercase text-gray-400">Posted</div>
              <div className="text-base font-semibold tabular-nums">{new Date(m.timestamp).toLocaleDateString()}</div>
            </div>
          </div>

          {m.caption && (
            <div className="flex-1 overflow-y-auto mb-3">
              <div className="text-[10px] uppercase text-gray-400 mb-1">Caption</div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{m.caption}</p>
            </div>
          )}

          <a href={m.permalink} target="_blank" rel="noopener noreferrer" className="mt-auto bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:scale-[1.02] text-white text-sm font-medium rounded-xl py-2.5 text-center transition flex items-center justify-center gap-2">
            Open on Instagram
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M7 17l10-10M7 7h10v10" /></svg>
          </a>
        </div>
      </div>
    </div>
  );
}
