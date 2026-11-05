"use client";
import { LocationCard } from "@/app/(dashboard)/dashboard/preview/LocationCard";
import { LoadingBlock } from "@/components/LoadingBlock";
import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { PreviewDashboardShell } from "../PreviewDashboardShell";
import { LiveIndicator } from "@/components/LiveIndicator";
import { useApi } from "@/lib/use-api";
import { IconThumbUp, IconMessageCircle, IconShare3 } from "@tabler/icons-react";

// Facebook Page analytics — LIVE via the stored per-brand page tokens.
//
// Honest about what those tokens allow (probed 2026-07-11, Graph v25.0):
//   Followers / page likes  → real numbers, all pages
//   Reach / Engagement      → "—" (tokens lack read_insights; call is still
//                             attempted so a re-scoped token goes live automatically)
//   Recent posts            → real (image, text, date, link) for 3 of 4 pages;
//                             per-post likes/comments are "—" (needs pages_read_engagement)

const FB = "#3A57E8"; // brand accent (dashboard uses the brand blue, not Facebook blue)

type Resp = {
  account: { id: string; label: string; handle: string; pageId: string };
  source: "live";
  range: { from: string; to: string };
  page: { name: string; followers: number | null; fanCount: number | null; link: string | null; picture: string | null };
  insights: { available: boolean; reason?: string; reach: number | null; engagement: number | null; pageViews: number | null; follows: number | null };
  audience: { available: boolean; reason?: string; countries: { code: string; count: number; pct: number }[]; cities?: { label: string; count: number }[]; total?: number };
  posts: { available: boolean; reason?: string; items: Post[] };
  latencyMs: number;
  error?: string;
};

type Post = {
  id: string;
  message: string;
  createdTime: string;
  fullPicture: string | null;
  permalink: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-IN");
}

export default function FacebookPage() {
  return (
    <PreviewDashboardShell active="facebook" title="Facebook" subtitle="Page analytics — followers, reach, engagement per brand.">
      {({ accountId, range }) => <Inner accountId={accountId} range={range} />}
    </PreviewDashboardShell>
  );
}

function Inner({ accountId, range }: { accountId: string; range: { from: string; to: string } }) {
  const qs = new URLSearchParams({ account: accountId, from: range.from, to: range.to }).toString();
  const { data, error, isLoading, refresh } = useApi<Resp>(`/api/facebook?${qs}`);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  useEffect(() => { if (data) setFetchedAt(Date.now()); }, [data]);

  const insightsNote = "page token lacks insights permission";

  return (
    <div className="space-y-5">
      {/* Page identity + live status */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {data?.page.picture
            ? <img src={data.page.picture} alt="" className="w-9 h-9 rounded-full border border-gray-200 bg-gray-100" loading="lazy" decoding="async" />
            : <div className="w-9 h-9 rounded-full bg-gray-100 border border-gray-200" />}
          <div>
            <div className="text-sm font-semibold text-[#232D42]">{data?.page.name ?? "Facebook Page"}</div>
            {data?.page.link ? (
              <a href={data.page.link} target="_blank" rel="noreferrer" className="text-xs hover:underline" style={{ color: FB }}>
                View page on Facebook ↗
              </a>
            ) : (
              <div className="text-xs text-gray-400">Page ID {data?.account.pageId ?? "…"}</div>
            )}
          </div>
        </div>
        {/* LiveIndicator IS the honest green "Live" badge — real Graph API data only. */}
        <LiveIndicator fetchedAt={fetchedAt} latencyMs={data?.latencyMs ?? null} loading={isLoading} onRefresh={refresh} error={error ? error.message : null} />
      </div>

      {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-3">{error.message}</div>}
      {!data && isLoading && <LoadingBlock label="Loading Facebook page analytics…" />}

      {data && (
        <>
          {/* Summary stat row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Followers" value={data.page.followers !== null ? fmt(data.page.followers) : "—"} sub="live from Meta" accent />
            <Stat label="Page likes" value={data.page.fanCount !== null ? fmt(data.page.fanCount) : "—"} sub="live from Meta" />
            <Stat
              label="Engagement"
              value={data.insights.engagement !== null ? fmt(data.insights.engagement) : "—"}
              sub={data.insights.engagement !== null ? "post engagements in range" : insightsNote}
              subMuted={data.insights.engagement === null}
            />
            <Stat
              label="Page views"
              value={data.insights.pageViews !== null ? fmt(data.insights.pageViews) : "—"}
              sub={data.insights.pageViews !== null ? "in range" : insightsNote}
              subMuted={data.insights.pageViews === null}
            />
          </div>

          {/* Audience geography — the one demographic Meta still exposes for pages */}
          {data.audience?.available && data.audience.countries.length > 0 && (
            <LocationCard platform="Facebook"
              cities={(data.audience.cities || []).map((c) => ({ label: c.label, value: c.count }))}
              countries={data.audience.countries.map((c) => ({ label: c.code, value: c.count }))}
              totalFollowers={data.audience.total || data.audience.countries.reduce((s, c) => s + c.count, 0)} />
          )}

          {/* Recent posts */}
          <Section title="Recent posts">
            {data.posts.available ? (
              data.posts.items.length ? (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                  {data.posts.items.map((p) => <PostCard key={p.id} post={p} />)}
                </div>
              ) : (
                <div className="bg-white border border-gray-100 rounded-xl p-8 text-center text-sm text-gray-400">No published posts on this page yet.</div>
              )
            ) : (
              <div className="bg-white border border-gray-100 rounded-xl p-6 text-sm text-gray-500">
                <div className="font-medium text-gray-700 mb-1">Posts can’t be read for this page</div>
                <p className="text-[13px] text-gray-500">{data.posts.reason}</p>
              </div>
            )}
            {data.posts.available && data.posts.items.length > 0 && data.posts.items.every((p) => p.likes === null) && (
              <p className="text-xs text-gray-400 mt-2">
                Per-post likes and comments show “—” — the page token lacks the <span className="font-mono">pages_read_engagement</span> permission.
              </p>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, accent, subMuted }: { label: string; value: string; sub?: string; accent?: boolean; subMuted?: boolean }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3">
      <div className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums" style={accent ? { color: FB } : {}}>{value}</div>
      {sub && <div className={`text-xs mt-0.5 ${subMuted ? "text-gray-400 italic" : "text-gray-500"}`}>{sub}</div>}
    </div>
  );
}

// Country name from ISO code, with a safe fallback to the code itself.
const REGION_NAMES = typeof Intl !== "undefined" && "DisplayNames" in Intl
  ? new Intl.DisplayNames(["en"], { type: "region" })
  : null;
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-base font-medium text-[#232D42] mb-2">{title}</div>
      {children}
    </div>
  );
}

function PostCard({ post }: { post: Post }) {
  const date = (() => {
    try { return format(parseISO(post.createdTime), "d MMM yyyy"); } catch { return post.createdTime; }
  })();
  const metric = (v: number | null) => (v !== null ? fmt(v) : "—");
  const body = (
    <>
      {post.fullPicture
        ? <img src={post.fullPicture} alt="" className="w-full aspect-[4/5] object-contain bg-gray-100" loading="lazy" />
        : (
          <div className="w-full aspect-[4/5] bg-gray-50 flex items-center justify-center">
            <span className="text-[11px] text-gray-300">No image</span>
          </div>
        )}
      <div className="p-3">
        <div className="text-xs text-gray-400 mb-1">{date}</div>
        <p className="text-xs text-gray-700 line-clamp-3 min-h-[3lh]">{post.message || <span className="text-gray-400 italic">No caption</span>}</p>
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-50 text-xs text-gray-500 tabular-nums">
          <span title="Likes — not readable with the current page token"><IconThumbUp size={12} stroke={1.8} className="inline -mt-0.5 mr-0.5 text-gray-400" />{metric(post.likes)}</span>
          <span title="Comments — not readable with the current page token"><IconMessageCircle size={12} stroke={1.8} className="inline -mt-0.5 mr-0.5 text-gray-400" />{metric(post.comments)}</span>
          <span title="Shares"><IconShare3 size={12} stroke={1.8} className="inline -mt-0.5 mr-0.5 text-gray-400" />{metric(post.shares)}</span>
        </div>
      </div>
    </>
  );
  return post.permalink ? (
    <a href={post.permalink} target="_blank" rel="noreferrer" className="block bg-white border border-gray-100 rounded-xl overflow-hidden hover:shadow-md hover:border-gray-200 transition">
      {body}
    </a>
  ) : (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">{body}</div>
  );
}
