"use client";
import { useEffect, useMemo, useState } from "react";
import { useProfile } from "@/lib/profile";
import { LI_PAGE } from "@/lib/brand-platforms";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { DashboardShell } from "@/components/DashboardShell";
import { LiveIndicator } from "@/components/LiveIndicator";
import { useApi } from "@/lib/use-api";

const LI = "#0A66C2"; // LinkedIn blue
// Blue shade ramp for donuts / ranked bars (dark → light).
const SHADES = ["#0A66C2", "#2D7FD6", "#5AA0E8", "#86BCF3", "#B2D5F9", "#D6E8FC", "#EAF3FD"];

type Post = {
  id: string; date: string; text: string; type: string;
  impressions: number; uniqueImpressions: number; clicks: number; reactions: number; comments: number; shares: number;
  engagementRate: number; ctr: number; thumbnailUrl?: string | null; docUrl?: string | null; mediaTitle?: string | null; permalink?: string | null;
};
type DemoRow = { label: string; pct: number; count: number };
type Resp = {
  page: { id: string; name: string; handle: string; vanityName: string };
  source: "demo" | "live";
  partial?: boolean;
  liveError?: string;
  range: { from: string; to: string };
  latencyMs: number;
  summary: {
    followers: number; followerGain: number; organicGain?: number; paidGain?: number;
    impressions: number; uniqueImpressions?: number; engagementRate: number; ctr?: number;
    pageViews: number; uniqueVisitors: number; posts: number;
  };
  followersOverTime: { date: string; followers: number; newFollowers: number }[];
  posts: Post[];
  visitors: { totalPageViews: number; uniqueVisitors: number; byPage: { page: string; views: number }[]; overTime: { date: string; views: number; unique: number }[] };
  demographics: { jobFunction: DemoRow[]; seniority: DemoRow[]; industry: DemoRow[]; location: DemoRow[]; companySize: DemoRow[] };
  error?: string;
};

const PAGES = [
  { key: "goocampus", label: "GooCampus" },
  { key: "gcworld", label: "GooCampus World" },
];

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-IN");
}

// LinkedIn's post API returns text with markup — turn it into what a reader sees.
function cleanText(t: string): string {
  if (!t) return "";
  return t
    .replace(/@\[([^\]]+)\]\([^)]*\)/g, "$1")          // @[Name](urn:li:person:…) → Name
    .replace(/\{hashtag\|\\?#\|([^}]+)\}/g, "#$1")      // {hashtag|\#|Radiology} → #Radiology
    .replace(/\\([\\#()[\]_*~`>+\-.!])/g, "$1")         // unescape \# \( \) \[ \] \_ etc.
    .trim();
}

export default function LinkedInPage() {
  return (
    <DashboardShell title="LinkedIn" subtitle="Company page analytics — followers, posts, visitors, audience.">
      {({ range }) => <Inner range={range} />}
    </DashboardShell>
  );
}

function Inner({ range }: { range: { from: string; to: string } }) {
  // Profile mode locks this tab to the brand's own LinkedIn page (only World
  // has one connected); no switcher, no other brand's data reachable.
  const profile = useProfile();
  const profilePage = profile ? LI_PAGE[profile] ?? null : undefined;
  const [picked, setPage] = useState("goocampus");
  const page = profile ? (profilePage ?? "") : picked;
  const qs = new URLSearchParams({ page, from: range.from, to: range.to }).toString();
  const { data, error, isLoading, refresh } = useApi<Resp>(page ? `/api/linkedin?${qs}` : null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [openPost, setOpenPost] = useState<Post | null>(null);
  useEffect(() => { if (data) setFetchedAt(Date.now()); }, [data]);

  if (profile && !profilePage) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-14 text-center">
        <div className="text-base font-medium text-gray-700 mb-1">No LinkedIn page</div>
        <p className="text-sm text-gray-400">This brand doesn&apos;t have a LinkedIn page connected to the dashboard.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Page switcher + status */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {profile ? (
          <div className="text-sm font-semibold text-gray-800">{PAGES.find((p) => p.key === page)?.label ?? page}</div>
        ) : (
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          {PAGES.map((p) => (
            <button
              key={p.key}
              onClick={() => setPage(p.key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${page === p.key ? "text-white" : "text-gray-600 hover:text-gray-900"}`}
              style={page === p.key ? { background: LI } : {}}
            >
              {p.label}
            </button>
          ))}
        </div>
        )}
        <div className="flex items-center gap-3">
          {data?.source === "live" ? (
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200" title={data.partial ? "Live LinkedIn data. Per-post stats are still sample — coming in a follow-up." : "Live LinkedIn data."}>
              ● Live{data.partial ? " · post stats sample" : ""}
            </span>
          ) : data?.liveError ? (
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-rose-50 text-rose-800 border border-rose-200" title={data.liveError}>
              ⚠ Live call failed · showing demo
            </span>
          ) : (
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200" title="LinkedIn API not yet connected for this page — showing representative sample data.">
              ⚠ Demo data
            </span>
          )}
          <LiveIndicator loading={isLoading} onRefresh={refresh} />
        </div>
      </div>

      {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-3">{error.message}</div>}
      {!data && isLoading && <div className="text-sm text-gray-400 py-16 text-center">Loading LinkedIn analytics…</div>}

      {data && (
        <>
          {/* Summary stat row */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
            <Stat label="Followers" value={fmt(data.summary.followers)} sub={`+${fmt(data.summary.followerGain)} in range`} accent />
            <Stat label="Impressions" value={fmt(data.summary.impressions)} sub="in range" />
            <Stat label="Unique impr." value={data.summary.uniqueImpressions != null ? fmt(data.summary.uniqueImpressions) : "—"} sub="reach" />
            <Stat label="Engagement" value={`${data.summary.engagementRate}%`} sub="avg / post" />
            <Stat label="CTR" value={data.summary.ctr != null ? `${data.summary.ctr}%` : "—"} sub="clicks / impr." />
            <Stat label="Posts" value={String(data.summary.posts)} sub="published" />
            <Stat label="Page views" value={fmt(data.summary.pageViews)} sub="in range" />
            <Stat label="Unique visitors" value={fmt(data.summary.uniqueVisitors)} sub="in range" />
          </div>

          {/* Followers growth */}
          <Section title="Followers growth">
            <FollowersChart
              data={data.followersOverTime}
              totalGain={data.summary.followerGain}
              organic={data.summary.organicGain}
              paid={data.summary.paidGain}
            />
          </Section>

          {/* Post performance */}
          <Section title="Post performance">
            <PostPerformance posts={data.posts} onOpen={setOpenPost} />
          </Section>

          {/* Page visitors */}
          <Section title="Page visitors">
            <Visitors visitors={data.visitors} />
          </Section>

          {/* Follower demographics */}
          <Section title="Follower demographics">
            <Demographics d={data.demographics} totalFollowers={data.summary.followers} />
          </Section>
        </>
      )}

      {openPost && <PostModal post={openPost} pageName={data?.page.name || "GooCampus"} onClose={() => setOpenPost(null)} />}
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-white border border-gray-100 rounded-lg p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums" style={accent ? { color: LI } : {}}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-800 mb-2">{title}</div>
      {children}
    </div>
  );
}

function FollowersChart({ data, totalGain, organic, paid }: { data: { date: string; followers: number; newFollowers: number }[]; totalGain: number; organic?: number; paid?: number }) {
  const validDays = data.filter((d) => d.newFollowers !== 0);
  const peak = validDays.length ? validDays.reduce((m, d) => (d.newFollowers > m.newFollowers ? d : m)) : null;
  const avg = validDays.length ? totalGain / data.length : 0;
  const hasSplit = organic != null && paid != null && (organic + paid) > 0;
  const organicPct = hasSplit ? Math.round((organic! / (organic! + paid!)) * 100) : 100;
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400 mb-1">Followers over time</div>
          <div className="text-2xl font-semibold text-gray-900">+{totalGain.toLocaleString("en-IN")}<span className="text-xs font-normal text-gray-500 ml-2">in range</span></div>
        </div>
        <div className="text-right text-xs text-gray-500 space-y-0.5">
          <div>avg <span className="font-medium text-gray-700">+{avg.toFixed(0)}/day</span></div>
          {peak && <div>best day <span className="font-medium text-emerald-600">+{peak.newFollowers} on {peak.date}</span></div>}
        </div>
      </div>

      {/* Organic vs paid split */}
      {hasSplit && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="font-medium text-gray-600">Organic <span className="tabular-nums text-gray-500">+{fmt(organic!)}</span></span>
            <span className="font-medium text-gray-600">Paid <span className="tabular-nums text-gray-500">+{fmt(paid!)}</span></span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden flex">
            <div className="h-full" style={{ width: `${organicPct}%`, background: LI }} />
            <div className="h-full" style={{ width: `${100 - organicPct}%`, background: "#86BCF3" }} />
          </div>
          <div className="text-[10px] text-gray-400 mt-1">{organicPct}% organic · {100 - organicPct}% paid</div>
        </div>
      )}

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="liFollowerArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={LI} stopOpacity={0.18} />
                <stop offset="100%" stopColor={LI} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickMargin={8} interval="preserveStartEnd" minTickGap={40} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))} domain={["dataMin - 50", "dataMax + 50"]} width={42} />
            <Tooltip
              cursor={{ stroke: "#cbd5e1", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as { date: string; followers: number; newFollowers: number };
                return (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs min-w-[140px]">
                    <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">{p.date}</div>
                    <div className="text-base font-semibold text-gray-900">{p.followers.toLocaleString("en-IN")}</div>
                    <div className="text-xs font-medium text-emerald-600">+{p.newFollowers} that day</div>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="followers" stroke={LI} strokeWidth={2.5} fill="url(#liFollowerArea)" dot={false} activeDot={{ r: 5, fill: LI, stroke: "#fff", strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const TYPE_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  ARTICLE: { bg: "#E6F1FB", text: "#0A66C2", label: "Article" },
  IMAGE: { bg: "#EAF3DE", text: "#27500A", label: "Image" },
  VIDEO: { bg: "#FAEEDA", text: "#633806", label: "Video" },
  DOCUMENT: { bg: "#EDE9FB", text: "#4324A6", label: "Carousel" },
  TEXT: { bg: "#EEF0F2", text: "#3F4550", label: "Text" },
};

// Small inline glyph for the post-media placeholder.
function TypeGlyph({ type }: { type: string }) {
  const common = "w-9 h-9";
  if (type === "VIDEO") return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 9l5-3v12l-5-3" /></svg>);
  if (type === "ARTICLE") return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></svg>);
  if (type === "DOCUMENT") return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="6" y="3" width="13" height="16" rx="1.5" /><path d="M3 6v13a2 2 0 0 0 2 2h11" /></svg>);
  if (type === "TEXT") return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 7h16M4 12h16M4 17h10" /></svg>);
  return (<svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5-5L5 20" /></svg>);
}

function PostMedia({ post, tall, interactive }: { post: Post; tall?: boolean; interactive?: boolean }) {
  const [imgOk, setImgOk] = useState(true);
  const style = TYPE_STYLE[post.type] || TYPE_STYLE.IMAGE;
  // Instagram-portrait 4:5 frame (≈1080×1350). Grid cards fill their column at
  // 4:5; the modal shows a centered portrait box sized by height so a whole slide
  // fits (no cut-off) and you scroll inside to flip to the next slide.
  const frameCls = tall
    ? "relative w-full bg-gray-900 overflow-hidden"
    : "relative w-full aspect-[4/5] bg-gray-100 overflow-hidden";
  const frameStyle = tall ? { height: "min(78vh, 720px)" } : undefined;

  // Carousel/document → embedded PDF: shows the real first slide, and (in the
  // modal) you scroll inside it to flip through the slides one by one.
  if (post.type === "DOCUMENT" && post.docUrl) {
    return (
      <div className={frameCls} style={frameStyle}>
        <iframe
          src={`${post.docUrl}#toolbar=0&navpanes=0&${interactive ? "view=Fit" : "view=FitH&page=1"}`}
          title={post.mediaTitle || "Carousel"}
          className={`absolute inset-0 w-full h-full border-0 ${interactive ? "" : "pointer-events-none"}`}
        />
        <span className="absolute bottom-1.5 right-1.5 text-[9px] font-medium px-1.5 py-0.5 rounded bg-black/55 text-white">Carousel{interactive ? " · scroll to flip" : ""}</span>
      </div>
    );
  }

  if (post.thumbnailUrl && imgOk) {
    return (
      <div className={frameCls} style={frameStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={post.thumbnailUrl} alt="" onError={() => setImgOk(false)} className={`absolute inset-0 w-full h-full ${tall ? "object-contain" : "object-cover"}`} loading="lazy" decoding="async" />
        {post.type === "VIDEO" && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-12 h-12 rounded-full bg-black/55 flex items-center justify-center">
              <svg className="w-6 h-6 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`${frameCls} flex flex-col items-center justify-center gap-2 px-3 text-center`} style={{ background: `linear-gradient(135deg, ${style.bg}, #ffffff)`, ...(frameStyle || {}) }}>
      <span style={{ color: style.text }}><TypeGlyph type={post.type} /></span>
      {post.mediaTitle
        ? <span className="text-sm font-semibold line-clamp-3" style={{ color: style.text }}>{post.mediaTitle}</span>
        : <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: style.text }}>{style.label}</span>}
      {post.mediaTitle && <span className="text-[10px] uppercase tracking-wide opacity-70" style={{ color: style.text }}>{style.label}</span>}
    </div>
  );
}

function PostPerformance({ posts, onOpen }: { posts: Post[]; onOpen: (p: Post) => void }) {
  const [view, setView] = useState<"grid" | "table">("grid");
  if (!posts.length) return <div className="text-sm text-gray-400 bg-white border border-gray-100 rounded-xl p-6 text-center">No posts in this range.</div>;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">{posts.length} posts · click a card for full detail</div>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs">
          {(["grid", "table"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1 rounded-md font-medium capitalize transition ${view === v ? "text-white" : "text-gray-600 hover:text-gray-900"}`}
              style={view === v ? { background: LI } : {}}>{v}</button>
          ))}
        </div>
      </div>

      {view === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {posts.map((p, i) => {
            const style = TYPE_STYLE[p.type] || TYPE_STYLE.IMAGE;
            return (
              <div key={p.id} role="button" tabIndex={0} onClick={() => onOpen(p)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(p); } }}
                className="cursor-pointer text-left bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition group focus:outline-none focus:ring-2 focus:ring-[#0A66C2]/40">
                <div className="relative">
                  <PostMedia post={p} />
                  <span className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: style.bg, color: style.text }}>{style.label}</span>
                  {i === 0 && <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white" style={{ background: LI }}>Top post</span>}
                </div>
                <div className="p-3">
                  <div className="text-sm text-gray-800 line-clamp-2 min-h-[2lh]">{p.text ? cleanText(p.text) : <span className="text-gray-400 italic">No caption</span>}</div>
                  <div className="text-[11px] text-gray-400 mt-1">{p.date}</div>
                  <div className="mt-3 grid grid-cols-3 gap-1 text-center">
                    <MiniMetric label="Impr." value={fmt(p.impressions)} />
                    <MiniMetric label="Eng." value={`${p.engagementRate}%`} accent />
                    <MiniMetric label="React." value={fmt(p.reactions)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <PostsTable posts={posts} onOpen={onOpen} />
      )}
    </div>
  );
}

function MiniMetric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-sm font-semibold tabular-nums" style={accent ? { color: LI } : {}}>{value}</div>
      <div className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</div>
    </div>
  );
}

function PostsTable({ posts, onOpen }: { posts: Post[]; onOpen: (p: Post) => void }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
              <th className="px-4 py-2.5 font-medium">Post</th>
              <th className="px-3 py-2.5 font-medium text-right">Impr.</th>
              <th className="px-3 py-2.5 font-medium text-right">Unique</th>
              <th className="px-3 py-2.5 font-medium text-right">Clicks</th>
              <th className="px-3 py-2.5 font-medium text-right">CTR</th>
              <th className="px-3 py-2.5 font-medium text-right">React.</th>
              <th className="px-3 py-2.5 font-medium text-right">Comments</th>
              <th className="px-3 py-2.5 font-medium text-right">Shares</th>
              <th className="px-3 py-2.5 font-medium text-right">Eng. rate</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((p, i) => (
              <tr key={p.id} onClick={() => onOpen(p)} className={`border-b border-gray-50 cursor-pointer hover:bg-blue-50/40 ${i === 0 ? "bg-blue-50/40" : ""}`}>
                <td className="px-4 py-3 max-w-md">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: (TYPE_STYLE[p.type] || TYPE_STYLE.IMAGE).bg, color: (TYPE_STYLE[p.type] || TYPE_STYLE.IMAGE).text }}>{(TYPE_STYLE[p.type] || TYPE_STYLE.IMAGE).label}</span>
                    <span className="truncate text-gray-800">{cleanText(p.text) || "—"}</span>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{p.date}{i === 0 && <span className="ml-2 text-blue-600 font-medium">· Top post</span>}</div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums font-medium">{fmt(p.impressions)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{fmt(p.uniqueImpressions)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{fmt(p.clicks)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{p.ctr}%</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{fmt(p.reactions)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{fmt(p.comments)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{fmt(p.shares)}</td>
                <td className="px-3 py-3 text-right tabular-nums font-medium" style={{ color: LI }}>{p.engagementRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// LinkedIn-style post detail modal — post preview on the left, metrics on the right.
function PostModal({ post, pageName, onClose }: { post: Post; pageName: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const comp = [
    { label: "Reactions", value: post.reactions, color: SHADES[0] },
    { label: "Comments", value: post.comments, color: SHADES[2] },
    { label: "Shares", value: post.shares, color: SHADES[3] },
    { label: "Clicks", value: post.clicks, color: SHADES[4] },
  ].filter((c) => c.value > 0);
  const totalEng = comp.reduce((s, c) => s + c.value, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="text-sm font-semibold text-gray-800">Post detail</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-0">
          {/* Left — the post, rendered like LinkedIn */}
          <div className="p-5 border-b lg:border-b-0 lg:border-r border-gray-100">
            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
              <div className="flex items-center gap-3 p-3">
                <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold" style={{ background: LI }}>in</div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">{pageName}</div>
                  <div className="text-[11px] text-gray-500">{post.date} · Company page</div>
                </div>
              </div>
              {post.text && <div className="px-3 pb-3 text-sm text-gray-800 whitespace-pre-wrap">{cleanText(post.text)}</div>}
              <PostMedia post={post} tall interactive />
              <div className="flex items-center justify-between px-3 py-2 text-[11px] text-gray-500 border-t border-gray-100">
                <span>👍💬 {fmt(post.reactions + post.comments)}</span>
                <span>{fmt(post.comments)} comments · {fmt(post.shares)} shares</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {post.permalink && (
                <a href={post.permalink} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50" style={{ color: LI }}>
                  View on LinkedIn ↗
                </a>
              )}
              {post.docUrl && (
                <a href={post.docUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">
                  {post.type === "VIDEO" ? "Open video ↗" : "Open document ↗"}
                </a>
              )}
            </div>
          </div>

          {/* Right — metrics + engagement composition donut */}
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <BigMetric label="Impressions" value={fmt(post.impressions)} />
              <BigMetric label="Unique reach" value={fmt(post.uniqueImpressions)} />
              <BigMetric label="Engagement" value={`${post.engagementRate}%`} accent />
              <BigMetric label="Clicks" value={fmt(post.clicks)} />
              <BigMetric label="CTR" value={`${post.ctr}%`} />
              <BigMetric label="Reactions" value={fmt(post.reactions)} />
            </div>

            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">Engagement breakdown</div>
              {totalEng > 0 ? (
                <div className="flex items-center gap-4">
                  <div className="relative w-32 h-32 flex-shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={comp} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={2} stroke="none">
                          {comp.map((c) => <Cell key={c.label} fill={c.color} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <div className="text-lg font-semibold text-gray-900 tabular-nums">{fmt(totalEng)}</div>
                      <div className="text-[10px] text-gray-400">total</div>
                    </div>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {comp.map((c) => (
                      <div key={c.label} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2 text-gray-700">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />{c.label}
                        </span>
                        <span className="tabular-nums text-gray-500">{fmt(c.value)} · {Math.round((c.value / totalEng) * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <div className="text-sm text-gray-400">No engagement recorded.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BigMetric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white border border-gray-100 rounded-lg p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-0.5" style={accent ? { color: LI } : {}}>{value}</div>
    </div>
  );
}

function Visitors({ visitors }: { visitors: Resp["visitors"] }) {
  const maxViews = Math.max(...visitors.byPage.map((b) => b.views), 1);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <div className="text-xs uppercase tracking-wide text-gray-400 mb-1">Page views over time</div>
        <div className="text-2xl font-semibold text-gray-900 mb-3">{visitors.totalPageViews.toLocaleString("en-IN")}<span className="text-xs font-normal text-gray-500 ml-2">{visitors.uniqueVisitors.toLocaleString("en-IN")} unique</span></div>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={visitors.overTime} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="liVisitorArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={LI} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={LI} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickMargin={6} interval="preserveStartEnd" minTickGap={40} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={32} />
              <Tooltip cursor={{ stroke: "#cbd5e1" }} />
              <Area type="monotone" dataKey="views" stroke={LI} strokeWidth={2} fill="url(#liVisitorArea)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <div className="text-xs uppercase tracking-wide text-gray-400 mb-3">Views by page section</div>
        <div className="space-y-2.5">
          {visitors.byPage.map((b) => (
            <div key={b.page}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-700">{b.page}</span>
                <span className="tabular-nums text-gray-500">{b.views.toLocaleString("en-IN")}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(b.views / maxViews) * 100}%`, background: LI }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Redesigned follower demographics ────────────────────────────────────────
function Demographics({ d, totalFollowers }: { d: Resp["demographics"]; totalFollowers: number }) {
  const topFn = d.jobFunction[0]?.label;
  const topSen = d.seniority[0]?.label;
  const topLoc = d.location[0]?.label;
  const persona = useMemo(() => {
    const bits: string[] = [];
    if (topSen) bits.push(`${topSen}-level`);
    if (topFn) bits.push(`in ${topFn}`);
    if (topLoc) bits.push(`based in ${topLoc}`);
    return bits.length ? bits.join(" ") : null;
  }, [topFn, topSen, topLoc]);

  return (
    <div className="space-y-4">
      {persona && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white flex-shrink-0" style={{ background: LI }}>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></svg>
          </div>
          <div className="text-sm text-gray-700">Your typical follower is <span className="font-semibold text-gray-900">{persona}</span>.</div>
        </div>
      )}

      {/* Donuts for the two enum-clean categories */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DonutCard title="Seniority" rows={d.seniority} />
        <DonutCard title="Company size" rows={d.companySize} />
      </div>

      {/* Ranked medal bars for the richer categories */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <RankCard title="Job function" rows={d.jobFunction} />
        <RankCard title="Industry" rows={d.industry} />
        <RankCard title="Location" rows={d.location} />
      </div>
    </div>
  );
}

function DonutCard({ title, rows }: { title: string; rows: DemoRow[] }) {
  if (!rows || !rows.length) return null;
  const top = rows.slice(0, 6);
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="text-xs uppercase tracking-wide text-gray-400 mb-3">{title}</div>
      <div className="flex items-center gap-4">
        <div className="relative w-36 h-36 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={top} dataKey="pct" nameKey="label" cx="50%" cy="50%" innerRadius={44} outerRadius={66} paddingAngle={2} stroke="none">
                {top.map((r, i) => <Cell key={r.label} fill={SHADES[i % SHADES.length]} />)}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as DemoRow;
                  return <div className="bg-white border border-gray-200 rounded-lg shadow-md px-2.5 py-1.5 text-xs"><span className="font-medium text-gray-800">{p.label}</span> · {p.pct}% · {fmt(p.count)}</div>;
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-lg font-semibold text-gray-900">{top[0]?.pct}%</div>
            <div className="text-[10px] text-gray-400 max-w-[70px] text-center leading-tight truncate">{top[0]?.label}</div>
          </div>
        </div>
        <div className="flex-1 space-y-1.5 min-w-0">
          {top.map((r, i) => (
            <div key={r.label} className="flex items-center justify-between text-xs gap-2">
              <span className="flex items-center gap-2 text-gray-700 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: SHADES[i % SHADES.length] }} />
                <span className="truncate">{r.label}</span>
              </span>
              <span className="tabular-nums text-gray-500 flex-shrink-0">{r.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RankCard({ title, rows }: { title: string; rows: DemoRow[] }) {
  if (!rows || !rows.length) return null;
  const top = rows.slice(0, 6);
  const max = Math.max(...top.map((r) => r.pct), 1);
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="text-xs uppercase tracking-wide text-gray-400 mb-3">{title}</div>
      <div className="space-y-3">
        {top.map((r, i) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${i === 0 ? "text-white" : "text-gray-500 bg-gray-100"}`} style={i === 0 ? { background: LI } : {}}>{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-700 truncate">{r.label}</span>
                <span className="tabular-nums text-gray-500 flex-shrink-0 ml-2">{r.pct}% · {fmt(r.count)}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(r.pct / max) * 100}%`, background: SHADES[Math.min(i, SHADES.length - 1)] }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
