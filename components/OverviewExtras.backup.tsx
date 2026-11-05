"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Post = {
  id: string;
  caption: string;
  permalink: string;
  mediaUrl: string;
  type: string;
  timestamp: string;
  reach: number;
  likes: number;
  comments: number;
  shares?: number;
  saves?: number;
  totalInteractions?: number;
};

const TYPE_META: Record<string, { label: string; color: string; icon: string }> = {
  REEL:           { label: "Reels",     color: "#EC4899", icon: "🎬" },
  CAROUSEL_ALBUM: { label: "Carousels", color: "#0EA5E9", icon: "🖼️" },
  IMAGE:          { label: "Static",    color: "#6D5AE6", icon: "📄" },
  VIDEO:          { label: "Videos",    color: "#6366F1", icon: "🎥" },
};

function fmtNum(n: number): string {
  if (n >= 100_000) return (n / 1000).toFixed(0) + "k";
  if (n >= 1_000) return (n / 1000).toFixed(1) + "k";
  return n.toLocaleString("en-IN");
}

function extractHashtags(text: string | undefined): string[] {
  if (!text) return [];
  const matches = text.match(/#[\p{L}\p{N}_]+/gu) || [];
  return Array.from(new Set(matches.map((t) => t.toLowerCase())));
}

// One fetch → four derived views. Post mix, engagement rate, top hashtags,
// and format-performance comparison. Plus a "repost old winners" section that
// pulls high performers from earlier ranges.
export function OverviewExtras({ accountId, range }: { accountId: string; range: { from: string; to: string } }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [oldWinners, setOldWinners] = useState<Post[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Range posts for mix / ER / hashtags / format comparison.
    const qs = new URLSearchParams({ accountId, from: range.from, to: range.to, limit: "200", insights: "true" }).toString();
    fetch(`/api/posts?${qs}`)
      .then((r) => r.ok ? r.json() : { posts: [] })
      .then((d) => setPosts(d.posts || []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));

    // Wider window (older than the current range) for repost opportunities —
    // pull the 90 days before the current from-date so we can surface old
    // winners the user might want to re-run.
    const fromDate = new Date(range.from);
    const oldTo = new Date(fromDate.getTime() - 1 * 86_400_000);
    const oldFrom = new Date(fromDate.getTime() - 91 * 86_400_000);
    const oldQs = new URLSearchParams({ accountId, from: oldFrom.toISOString().slice(0, 10), to: oldTo.toISOString().slice(0, 10), limit: "200", insights: "true" }).toString();
    fetch(`/api/posts?${oldQs}`)
      .then((r) => r.ok ? r.json() : { posts: [] })
      .then((d) => setOldWinners((d.posts || []) as Post[]))
      .catch(() => setOldWinners([]));
  }, [accountId, range.from, range.to]);

  // ---- derived views ----

  const mix = useMemo(() => {
    if (!posts || posts.length === 0) return { total: 0, entries: [] as { type: string; count: number; pct: number }[] };
    const counts: Record<string, number> = {};
    for (const p of posts) counts[p.type] = (counts[p.type] || 0) + 1;
    const total = posts.length;
    return {
      total,
      entries: Object.entries(counts)
        .map(([type, count]) => ({ type, count, pct: (count / total) * 100 }))
        .sort((a, b) => b.count - a.count),
    };
  }, [posts]);

  const topHashtags = useMemo(() => {
    if (!posts) return [];
    const bag: Record<string, { posts: number; reach: number }> = {};
    for (const p of posts) {
      for (const t of extractHashtags(p.caption)) {
        bag[t] ??= { posts: 0, reach: 0 };
        bag[t].posts += 1;
        bag[t].reach += p.reach || 0;
      }
    }
    return Object.entries(bag)
      .map(([tag, v]) => ({ tag, ...v }))
      .sort((a, b) => b.reach - a.reach)
      .slice(0, 5);
  }, [posts]);

  // Repost opportunities — old winners with high reach that haven't been re-run
  const reposts = useMemo(() => {
    if (!oldWinners) return [];
    // Dedupe repeated media (same caption first line = same content run more than once)
    const seen = new Set<string>();
    const uniq = [] as Post[];
    for (const p of [...oldWinners].sort((a, b) => (b.reach || 0) - (a.reach || 0))) {
      const key = (p.caption || "").split("\n")[0].slice(0, 60).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(p);
    }
    return uniq.slice(0, 4);
  }, [oldWinners]);

  return (
    <>
      {/* Row 1: 2 small cards — engagement rate moved to top KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <PostMixCard loading={loading} mix={mix} />
        <TopHashtagsCard loading={loading} entries={topHashtags} />
      </div>

      {/* Row 2: Format comparison — full-width, has its own range picker */}
      <FormatComparisonCard accountId={accountId} defaultRange={range} />

      {/* Row 3: Repost opportunities — grid of old winners */}
      <RepostOpportunitiesCard loading={oldWinners === null} posts={reposts} />
    </>
  );
}

// Plain-English guide to each format — shown in the Post Mix card so a newcomer
// (marketing team member who isn't deep in IG mechanics) can read the chart.
const FORMAT_GUIDE: Record<string, { short: string; long: string }> = {
  REEL:           { short: "Short videos, algorithm favourite.",  long: "Best for reaching NEW people (non-followers). IG boosts Reels harder than any other format right now." },
  CAROUSEL_ALBUM: { short: "Swipeable multi-image posts.",         long: "Best for teaching — people swipe through, spending time on each slide, which signals quality to the algorithm." },
  IMAGE:          { short: "Single photo posts.",                  long: "Quick hits — announcements, testimonials, promo cards. Lower reach than Reels/Carousels but faster to make." },
  VIDEO:          { short: "Long-form feed videos.",               long: "Rarely favoured over Reels these days. Only use if the video is over 90 seconds and matters." },
};

function PostMixCard({ loading, mix }: { loading: boolean; mix: { total: number; entries: { type: string; count: number; pct: number }[] } }) {
  let angleFrom = 0;
  const stops: string[] = [];
  for (const e of mix.entries) {
    const meta = TYPE_META[e.type] || { color: "#9CA3AF" };
    const to = angleFrom + (e.pct / 100) * 360;
    stops.push(`${meta.color} ${angleFrom.toFixed(1)}deg ${to.toFixed(1)}deg`);
    angleFrom = to;
  }
  const gradient = stops.length > 0 ? `conic-gradient(${stops.join(", ")})` : "conic-gradient(#E5E7EB 0deg 360deg)";

  // Compute a plain-English interpretation of THIS user's mix.
  const reelPct = mix.entries.find((e) => e.type === "REEL")?.pct || 0;
  const carouselPct = mix.entries.find((e) => e.type === "CAROUSEL_ALBUM")?.pct || 0;
  const dominant = mix.entries[0];
  const dominantMeta = dominant ? (TYPE_META[dominant.type] || { label: dominant.type }) : null;

  // "Recommended" mix for a medical-education Instagram (opinionated but grounded).
  const RECOMMENDED = { reels: 40, carousels: 40, static: 20 };

  let readOut: React.ReactNode = null;
  if (dominant && dominantMeta) {
    if (dominant.type === "CAROUSEL_ALBUM" && reelPct < 30) {
      readOut = (
        <>
          You&rsquo;re <b>Carousel-heavy</b> — great for the followers you already have, but Reels are the format IG shows to <b>new</b> people. Bumping Reels from {Math.round(reelPct)}% toward <b>~40%</b> could grow your audience faster.
        </>
      );
    } else if (dominant.type === "REEL" && carouselPct < 25) {
      readOut = (
        <>
          You&rsquo;re <b>Reel-heavy</b> — good for reach, but a strong Carousel every 2–3 posts helps you teach and get saves (which the algorithm loves). Try lifting Carousels to <b>~30%</b>.
        </>
      );
    } else if (reelPct >= 30 && carouselPct >= 30) {
      readOut = (
        <>
          Your mix is well-balanced. <b>Reels ({Math.round(reelPct)}%) + Carousels ({Math.round(carouselPct)}%)</b> is close to the ideal for growth-plus-teaching content.
        </>
      );
    } else {
      readOut = (
        <>
          Your mix is dominated by <b>{dominantMeta.label}</b>. Target roughly <b>40% Reels + 40% Carousels + 20% Static</b> for a balanced growth-and-teach rhythm.
        </>
      );
    }
  }

  return (
    <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 flex flex-col h-full">
      <div className="mb-4">
        <h3 className="text-[15px] font-semibold text-gray-900">Post mix</h3>
        <div className="text-[12px] text-gray-500 mt-0.5">What formats you posted, and what the split means.</div>
      </div>

      {loading || mix.total === 0 ? (
        <div className="h-[240px] bg-gray-50 rounded animate-pulse" />
      ) : (
        <>
          {/* Donut + counts */}
          <div className="flex items-center gap-5 mb-5">
            <div className="relative shrink-0" style={{ width: 120, height: 120 }}>
              <div className="w-full h-full rounded-full" style={{ background: gradient }} />
              <div className="absolute inset-[22px] bg-white rounded-full flex items-center justify-center flex-col leading-none">
                <div className="text-[20px] font-semibold tabular-nums">{mix.total}</div>
                <div className="text-[10px] uppercase text-gray-500 tracking-wide mt-1">posts</div>
              </div>
            </div>
            <div className="flex-1 flex flex-col gap-2">
              {mix.entries.map((e) => {
                const meta = TYPE_META[e.type] || { label: e.type, color: "#9CA3AF" };
                return (
                  <div key={e.type} className="flex items-baseline gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: meta.color }} />
                    <span className="text-[13px] font-medium text-gray-900">{meta.label}</span>
                    <span className="text-[11.5px] text-gray-500 tabular-nums">{e.count} post{e.count === 1 ? "" : "s"}</span>
                    <span className="ml-auto text-[13px] tabular-nums font-semibold text-gray-800">{Math.round(e.pct)}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* What each format is — for someone who doesn't know */}
          <div className="mb-4">
            <div className="text-[10.5px] uppercase tracking-widest text-gray-500 font-semibold mb-2">
              What each format is for
            </div>
            <div className="space-y-2">
              {mix.entries.map((e) => {
                const meta = TYPE_META[e.type] || { label: e.type, color: "#9CA3AF" };
                const guide = FORMAT_GUIDE[e.type];
                if (!guide) return null;
                return (
                  <div key={e.type} className="grid grid-cols-[100px_1fr] gap-2 items-start text-[12.5px]">
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: meta.color }} />
                      <span className="font-medium text-gray-900">{meta.label}</span>
                    </div>
                    <div className="text-gray-600 leading-snug">
                      {guide.long}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Your read — plain-English interpretation of THIS mix */}
          {readOut && (
            <div className="mt-auto rounded-xl bg-brand/5 border border-brand/20 p-3">
              <div className="text-[10.5px] uppercase tracking-widest text-brand font-semibold mb-1.5">Your read</div>
              <div className="text-[13px] text-gray-800 leading-relaxed">{readOut}</div>
              <div className="text-[11px] text-gray-500 mt-2 italic">
                Rule of thumb for medical education: aim for ~{RECOMMENDED.reels}% Reels · ~{RECOMMENDED.carousels}% Carousels · ~{RECOMMENDED.static}% Static.
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// EngagementRateCard removed — engagement rate moved up to the top KPI tile row.
// Old component code kept commented in git history if we ever want it back inline.
function _UnusedEngagementRateCard({ loading, avgPct, deltaPts, series }: { loading: boolean; avgPct: number; deltaPts: number; series: number[] }) {
  const points = useMemo(() => {
    if (series.length === 0) return "";
    const max = Math.max(...series, 0.01);
    const w = 200; const h = 60;
    return series.map((v, i) => {
      const x = (i / (series.length - 1 || 1)) * w;
      const y = h - (v / max) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }, [series]);
  const areaPath = useMemo(() => {
    if (series.length === 0) return "";
    const max = Math.max(...series, 0.01);
    const w = 200; const h = 60;
    const parts = series.map((v, i) => {
      const x = (i / (series.length - 1 || 1)) * w;
      const y = h - (v / max) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return parts.join(" ") + ` L200,60 L0,60 Z`;
  }, [series]);
  return (
    <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
      <div className="mb-3">
        <h3 className="text-[14px] font-semibold text-gray-900">Engagement rate</h3>
        <div className="text-[11.5px] text-gray-500">Of every 100 people who saw your posts, this many reacted.</div>
      </div>
      {loading ? (
        <div className="h-[100px] bg-gray-50 rounded animate-pulse" />
      ) : (
        <div>
          <div className="text-[26px] font-medium tabular-nums leading-none tracking-tight text-gray-900">
            {avgPct.toFixed(1)}%
          </div>
          <div className={`text-[11.5px] mt-1 font-semibold ${deltaPts >= 0.05 ? "text-emerald-700" : deltaPts <= -0.05 ? "text-rose-700" : "text-gray-500"}`}>
            {deltaPts >= 0 ? "▲" : "▼"} {Math.abs(deltaPts).toFixed(1)} pts across the range
          </div>
          <div className="mt-3">
            <svg viewBox="0 0 200 60" preserveAspectRatio="none" style={{ width: "100%", height: 60 }}>
              <defs>
                <linearGradient id="er-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6D5AE6" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#6D5AE6" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={areaPath} fill="url(#er-grad)" />
              <polyline points={points} fill="none" stroke="#6D5AE6" strokeWidth="1.5" />
              {series.length > 0 && (() => {
                const max = Math.max(...series, 0.01);
                const lastX = 200;
                const lastY = 60 - (series[series.length - 1] / max) * 60;
                return <circle cx={lastX} cy={lastY} r="3" fill="#6D5AE6" />;
              })()}
            </svg>
          </div>
        </div>
      )}
    </section>
  );
}

// Suggested hashtags for GooCampus's IMG-doctor audience — surfaced when the
// range has no hashtag usage so the card doesn't sit empty. Grouped by the
// primary-interest categories that match the Scheduler/Content Radar.
const SUGGESTED_HASHTAGS: { group: string; tags: string[] }[] = [
  { group: "Broad",           tags: ["#IMGdoctors", "#IMGjourney", "#medicaleducation", "#doctorsofinstagram"] },
  { group: "Australia / AMC", tags: ["#AMCPart1", "#AMCPart2", "#AHPRA", "#AustraliaMedicine"] },
  { group: "UAE / Gulf",      tags: ["#DHAlicensing", "#MOHUAE", "#DubaiDoctor", "#GulfMedicalCareer"] },
  { group: "NEET PG / India", tags: ["#NEETPG2026", "#NEETPGcounselling", "#IndianDoctor", "#MedicalPG"] },
];

function TopHashtagsCard({ loading, entries }: { loading: boolean; entries: { tag: string; posts: number; reach: number }[] }) {
  return (
    <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
      <div className="mb-3">
        <h3 className="text-[14px] font-semibold text-gray-900">Hashtags that carried you</h3>
        <div className="text-[11.5px] text-gray-500">
          {entries.length > 0 ? "Top 5 by total people reached." : "None used yet — try these to start showing up in search."}
        </div>
      </div>

      {loading ? (
        <div className="h-[160px] bg-gray-50 rounded animate-pulse" />
      ) : entries.length > 0 ? (
        <div className="flex flex-col">
          {entries.map((e, i) => (
            <div key={e.tag} className={`grid grid-cols-[22px_1fr_auto] items-center gap-2 py-2 text-[12.5px] ${i < entries.length - 1 ? "border-b border-gray-100" : ""}`}>
              <span className="font-mono text-[10.5px] text-gray-400 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-gray-900 truncate">{e.tag}</span>
              <span className="text-gray-500 tabular-nums text-[11.5px]">{fmtNum(e.reach)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {SUGGESTED_HASHTAGS.map((g) => (
            <div key={g.group}>
              <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-1.5">{g.group}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(tag)}
                    title="Click to copy"
                    className="text-[11.5px] bg-brand-light/40 hover:bg-brand-light text-brand border border-brand/30 rounded-full px-2.5 py-1 transition"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="text-[10.5px] text-gray-400 italic pt-1">
            Click any tag to copy. Paste into your next post&rsquo;s caption.
          </div>
        </div>
      )}
    </section>
  );
}

// Self-fetching card so it can carry its own time-range picker independent of
// the global one at the top of the dashboard. Handy for asking "is Carousels
// still the winner if I zoom out to 90 days?" without shifting every other tab.
function FormatComparisonCard({ accountId, defaultRange }: { accountId: string; defaultRange: { from: string; to: string } }) {
  type RangeKey = "7d" | "30d" | "90d" | "1y";
  const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
  const [rows, setRows] = useState<{ type: string; count: number; avgReach: number; avgEng: number; erPct: number }[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Convert a preset key to a from/to pair anchored on the parent's `to` date so
  // "as of today" stays consistent even if the global picker moved forward.
  const range = useMemo(() => {
    const to = new Date(defaultRange.to);
    const map: Record<RangeKey, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
    const from = new Date(to.getTime() - map[rangeKey] * 86_400_000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }, [rangeKey, defaultRange.to]);

  // Ignore stale responses — otherwise a slow 30d fetch that started before the
  // user clicked 7d can arrive after the 7d fetch and overwrite the correct
  // result, making the winner "flip back" moments after selection.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ accountId, from: range.from, to: range.to, limit: "500", insights: "true" }).toString();
    fetch(`/api/posts?${qs}`)
      .then((r) => r.ok ? r.json() : { posts: [] })
      .then((d: { posts: Post[] }) => {
        if (cancelled) return;
        const bag: Record<string, { count: number; reachSum: number; engSum: number }> = {};
        for (const p of d.posts || []) {
          bag[p.type] ??= { count: 0, reachSum: 0, engSum: 0 };
          bag[p.type].count += 1;
          bag[p.type].reachSum += p.reach || 0;
          bag[p.type].engSum += p.totalInteractions ?? ((p.likes || 0) + (p.comments || 0) + (p.shares || 0) + (p.saves || 0));
        }
        setRows(
          Object.entries(bag)
            .filter(([, v]) => v.count > 0)
            .map(([type, v]) => ({
              type,
              count: v.count,
              avgReach: Math.round(v.reachSum / v.count),
              avgEng: Math.round(v.engSum / v.count),
              erPct: v.reachSum > 0 ? (v.engSum / v.reachSum) * 100 : 0,
            }))
            .sort((a, b) => b.avgReach - a.avgReach),
        );
      })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId, range.from, range.to]);

  const winner = rows?.[0];
  const runnerUp = rows?.[1];
  const reachMultiple = winner && runnerUp && runnerUp.avgReach > 0 ? (winner.avgReach / runnerUp.avgReach) : 0;
  const winnerMeta = winner ? (TYPE_META[winner.type] || { label: winner.type, color: "#9CA3AF" }) : null;

  const rangeChips: { key: RangeKey; label: string }[] = [
    { key: "7d",  label: "7 days"  },
    { key: "30d", label: "30 days" },
    { key: "90d", label: "90 days" },
    { key: "1y",  label: "1 year"  },
  ];

  return (
    <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 mb-6">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-gray-900">Which format wins</h3>
          <div className="text-[12px] text-gray-500 mt-0.5">
            Reels, Carousels or Static — which reaches the most people per post.
          </div>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {rangeChips.map((c) => (
            <button
              key={c.key}
              onClick={() => setRangeKey(c.key)}
              className={`text-[11.5px] font-medium px-2.5 py-1 rounded-md transition ${
                rangeKey === c.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* What does the selected range actually mean? Plain-English label so a new
          reader isn't guessing whether they're looking at a snapshot or a baseline. */}
      <div className="mb-4 text-[11.5px] text-gray-500 leading-snug">
        {rangeKey === "7d"  && <>You&rsquo;re viewing the <b className="text-gray-800">last 7 days</b> — this tells you what&rsquo;s working <b>right now</b>. Great for tuning next week&rsquo;s plan.</>}
        {rangeKey === "30d" && <>You&rsquo;re viewing the <b className="text-gray-800">last 30 days</b> — this is your <b>monthly trend</b>. Use this to shape next month&rsquo;s content mix.</>}
        {rangeKey === "90d" && <>You&rsquo;re viewing the <b className="text-gray-800">last 90 days</b> — this is your <b>base strategy</b>. What&rsquo;s worked long enough to bet on.</>}
        {rangeKey === "1y"  && <>You&rsquo;re viewing the <b className="text-gray-800">last year</b> — your <b>historical baseline</b>. Good for spotting seasonal patterns.</>}
      </div>

      {loading ? (
        <div className="h-[220px] bg-gray-50 rounded animate-pulse" />
      ) : !rows || rows.length === 0 ? (
        <div className="text-[13px] text-gray-500 italic">No posts to compare in this range.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          {/* Winner — big narrative card. Equal-width AND equal-height with the runner-up list. */}
          {winner && winnerMeta && (
            <div
              className="rounded-2xl p-5 flex flex-col h-full"
              style={{ background: `linear-gradient(135deg, ${winnerMeta.color}18, white)`, border: `1px solid ${winnerMeta.color}66` }}
            >
              <div className="text-[10.5px] uppercase tracking-widest font-semibold mb-2" style={{ color: winnerMeta.color }}>
                Best-performing format
              </div>
              <div className="text-[30px] font-semibold text-gray-900 leading-tight tracking-tight">
                {winnerMeta.label}
              </div>
              <div className="text-[13px] text-gray-700 mt-3 leading-snug">
                {reachMultiple > 1.15 && runnerUp
                  ? <>Reach <b className="font-semibold tabular-nums">{reachMultiple.toFixed(1)}×</b> higher than {(TYPE_META[runnerUp.type] || { label: runnerUp.type }).label}. Post more of these.</>
                  : <>Slightly ahead of the pack. Keep testing the mix.</>
                }
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4">
                <MiniStat n={fmtNum(winner.avgReach)} l="Avg reach" />
                <MiniStat n={fmtNum(winner.avgEng)} l="Avg reactions" />
                <MiniStat n={`${winner.erPct.toFixed(1)}%`} l="Engagement" />
              </div>

              {/* Bottom-half detail: gives the winner card enough content to match the runner-ups list height */}
              <div className="mt-auto pt-4">
                <div
                  className="rounded-xl p-4"
                  style={{ background: "rgba(255,255,255,0.6)", border: `1px solid ${winnerMeta.color}33` }}
                >
                  <div className="text-[10.5px] uppercase tracking-widest font-semibold mb-2" style={{ color: winnerMeta.color }}>
                    What to do
                  </div>
                  <div className="text-[13px] text-gray-800 leading-snug">
                    {reachMultiple > 1.5
                      ? <>Every extra <b>{winnerMeta.label}</b> post is worth roughly <b className="tabular-nums">{reachMultiple.toFixed(1)}×</b> more reach than the same effort spent on {runnerUp ? (TYPE_META[runnerUp.type] || { label: runnerUp.type }).label : "the rest"}. Shift your content mix — target <b>{Math.round(100 * (winner.count / (winner.count + (runnerUp?.count || 0))))}%</b> {winnerMeta.label} next week.</>
                      : reachMultiple > 1.15
                        ? <>{winnerMeta.label} are leading, but not by much. Keep <b>~50%</b> of next week&rsquo;s posts as {winnerMeta.label} and test the rest.</>
                        : <>Formats are performing similarly. Focus on <b>hook and topic</b>, not format — the audience isn&rsquo;t picking a lane yet.</>
                    }
                  </div>
                  {rows.length >= 3 && (
                    <div className="text-[11.5px] text-gray-500 mt-2">
                      Weakest format this range: <b className="text-gray-700">{(TYPE_META[rows[rows.length - 1].type] || { label: rows[rows.length - 1].type }).label}</b> at {fmtNum(rows[rows.length - 1].avgReach)} avg reach — worth trimming unless it&rsquo;s serving a different goal.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Runner-ups — same visual weight as the winner card so nothing gets neglected. */}
          <div className="rounded-2xl border border-gray-200 p-5 bg-white h-full flex flex-col" data-runner-up>
            <div className="text-[10.5px] uppercase tracking-widest text-gray-500 font-semibold mb-3">
              How every format did
            </div>
            <div className="space-y-4">
              {rows.map((r, i) => {
                const meta = TYPE_META[r.type] || { label: r.type, color: "#9CA3AF" };
                return (
                  <div key={r.type} className={`${i < rows.length - 1 ? "pb-4 border-b border-gray-100" : ""}`}>
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: meta.color }} />
                      <span className="text-[14px] font-semibold text-gray-900">{meta.label}</span>
                      <span className="text-[11px] text-gray-500 tabular-nums">·  {r.count} post{r.count === 1 ? "" : "s"}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <MiniStat n={fmtNum(r.avgReach)} l="Avg reach" />
                      <MiniStat n={fmtNum(r.avgEng)}   l="Avg reactions" />
                      <MiniStat n={`${r.erPct.toFixed(1)}%`} l="Engagement" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Strategy explainer — always shown, answers "how do I use different ranges to plan?" */}
      {rows && rows.length > 0 && (
        <div className="mt-5 rounded-xl bg-gray-50 border border-gray-200 p-4">
          <div className="text-[10.5px] uppercase tracking-widest text-gray-500 font-semibold mb-3">
            How to use this — planning your week vs your month
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <PlanStep n="1" title="Set the base (90 days or 1 year)">
              Look at what won <b>most consistently</b>. Make that <b>~50–60% of every month&rsquo;s plan</b>. It&rsquo;s your reliable format.
            </PlanStep>
            <PlanStep n="2" title="Check the momentum (30 days)">
              Is a different format winning this month? Bump its share up by <b>10–15%</b> — the trend is telling you something is shifting.
            </PlanStep>
            <PlanStep n="3" title="Tune for this week (7 days)">
              If a format spiked in the last 7 days, add <b>one or two extras</b> next week to test — <i>don&rsquo;t</i> flip your whole strategy on a 7-day signal.
            </PlanStep>
          </div>
          <div className="text-[12px] text-gray-700 mt-3 leading-relaxed">
            <b>The rule of thumb:</b> the longer the range, the more <i>trustworthy</i> the signal. A 7-day Reels spike is worth <b>a test</b> — a 90-day Reels lead is worth <b>a strategy</b>.
          </div>
        </div>
      )}
    </section>
  );
}

function PlanStep({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="flex items-start gap-2 mb-1.5">
        <span className="w-5 h-5 rounded-full bg-brand text-white text-[10.5px] font-semibold flex items-center justify-center shrink-0 tabular-nums">{n}</span>
        <span className="text-[13px] font-semibold text-gray-900 leading-tight">{title}</span>
      </div>
      <div className="text-[12px] text-gray-600 leading-snug">{children}</div>
    </div>
  );
}

function MiniStat({ n, l }: { n: string; l: string }) {
  return (
    <div className="bg-white/70 rounded-lg px-3 py-2 border border-white">
      <div className="text-[17px] font-semibold tabular-nums leading-none text-gray-900">{n}</div>
      <div className="text-[9.5px] uppercase tracking-wide text-gray-500 mt-1 leading-tight whitespace-nowrap">{l}</div>
    </div>
  );
}

function RepostOpportunitiesCard({ loading, posts }: { loading: boolean; posts: Post[] }) {
  return (
    <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 mb-6">
      <div className="mb-4">
        <h3 className="text-[15px] font-semibold text-gray-900">Old winners worth reposting</h3>
        <div className="text-[12px] text-gray-500 mt-0.5">
          Top-reaching posts from the last 90 days that could hit again with fresh eyes. Send to Scheduler in one click.
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[220px] bg-gray-50 rounded-xl animate-pulse" />)}
        </div>
      ) : posts.length === 0 ? (
        <div className="text-[13px] text-gray-500 italic">No older posts to draw from yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {posts.map((p) => {
            const meta = TYPE_META[p.type] || TYPE_META.IMAGE;
            const title = p.caption ? p.caption.split("\n")[0].slice(0, 80) : "(no caption)";
            const draft = new URLSearchParams({
              title,
              brief: `Repost of a previous top performer.\nOriginal caption:\n${(p.caption || "").slice(0, 400)}`,
            }).toString();
            return (
              <div key={p.id} className="border border-gray-100 rounded-xl overflow-hidden bg-white flex flex-col">
                <div className="aspect-[4/5] bg-gray-100 relative">
                  {p.mediaUrl ? (
                    <img src={p.mediaUrl} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl text-gray-300">▢</div>
                  )}
                  <span className="absolute top-2 left-2 text-[9px] uppercase tracking-wide font-semibold bg-white/95 border border-gray-200 text-gray-800 rounded px-1.5 py-0.5">
                    {meta.label}
                  </span>
                </div>
                <div className="p-3 flex-1 flex flex-col">
                  <div className="text-[11.5px] text-gray-500 mb-1">
                    {new Date(p.timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                  <div className="text-[12.5px] text-gray-900 leading-snug line-clamp-3 mb-2">{title}</div>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500 tabular-nums mb-3">
                    <span>{fmtNum(p.reach || 0)} reach</span>
                    <span>·</span>
                    <span>{fmtNum(p.likes || 0)} ❤</span>
                  </div>
                  <Link
                    href={`/dashboard/scheduler?draft=${encodeURIComponent(draft)}`}
                    className="mt-auto text-[11.5px] font-medium bg-brand text-white text-center px-3 py-2 rounded-md hover:bg-brand-dark"
                  >
                    ↻ Send to Scheduler
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
