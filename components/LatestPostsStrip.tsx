"use client";
import { LoadingBlock } from "@/components/LoadingBlock";
import { IconHeart, IconPencil } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useV2Href } from "@/lib/previewHref";

type Post = {
  id: string;
  caption: string;
  mediaUrl: string;
  permalink: string;
  type: string;
  timestamp: string;
  likes: number;
  comments: number;
  reach: number;
  shares?: number;
  saves?: number;
  totalInteractions?: number;
};

const TYPE_META: Record<string, { label: string }> = {
  REEL:           { label: "Reel"     },
  CAROUSEL_ALBUM: { label: "Carousel" },
  IMAGE:          { label: "Post"     },
  VIDEO:          { label: "Video"    },
};

function fmtNum(n: number): string {
  if (n >= 100_000) return (n / 1000).toFixed(0) + "k";
  if (n >= 1_000) return (n / 1000).toFixed(1) + "k";
  return n.toLocaleString("en-IN");
}

function relative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const h = Math.round(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function LatestPostsStrip({ accountId, range }: { accountId: string; range: { from: string; to: string } }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [openPost, setOpenPost] = useState<Post | null>(null);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ accountId, from: range.from, to: range.to, limit: "8", insights: "true" }).toString();
    fetch(`/api/posts?${qs}`)
      .then((r) => r.ok ? r.json() : { posts: [] })
      .then((d) => {
        const list = (d.posts || []) as Post[];
        list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setPosts(list.slice(0, 5));
      })
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, [accountId, range.from, range.to]);

  return (
    <section className="mb-6 bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">Latest posts</h2>
          <div className="text-[12px] text-gray-500 mt-0.5">Click any post to open it here in the dashboard.</div>
        </div>
      </div>

      {loading && (
        <div className="h-[300px] flex items-center justify-center"><LoadingBlock label="Loading latest posts…" /></div>
      )}

      {!loading && posts && posts.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {posts.map((p) => {
            const meta = TYPE_META[p.type] || TYPE_META.IMAGE;
            return (
              <button
                key={p.id}
                onClick={() => setOpenPost(p)}
                className="text-left bg-white border border-gray-100 rounded-xl overflow-hidden hover:border-brand hover:shadow-md transition"
              >
                <div className="aspect-[4/5] bg-gray-50 relative">
                  {p.mediaUrl ? (
                    <img src={p.mediaUrl} alt="" className="w-full h-full object-contain" loading="lazy" decoding="async" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl text-gray-300">▢</div>
                  )}
                  <span className="absolute top-2 left-2 text-[12px] uppercase tracking-wide font-semibold bg-white/95 border border-gray-200 text-gray-800 rounded px-1.5 py-0.5">
                    {meta.label}
                  </span>
                </div>
                <div className="p-2.5">
                  <div className="text-[10.5px] text-gray-500 mb-1">{relative(p.timestamp)}</div>
                  <div className="flex items-center gap-3 text-[11.5px] text-gray-700 tabular-nums">
                    <span>{fmtNum(p.reach || 0)} reach</span>
                    <span>{fmtNum(p.likes || 0)} <IconHeart size={12} stroke={1.8} className="inline -mt-0.5" /></span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!loading && posts && posts.length === 0 && (
        <div className="text-sm text-gray-500 italic">No posts in this range.</div>
      )}

      {openPost && <PostModal post={openPost} onClose={() => setOpenPost(null)} />}
    </section>
  );
}

function PostModal({ post, onClose }: { post: Post; onClose: () => void }) {
  const v2 = useV2Href();
  const meta = TYPE_META[post.type] || TYPE_META.IMAGE;
  const engRate = post.reach > 0 && post.totalInteractions
    ? ((post.totalInteractions / post.reach) * 100).toFixed(1) + "%"
    : "—";
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-gray-900 leading-snug">
              {post.caption ? post.caption.split("\n")[0].slice(0, 120) : "(no caption)"}
            </div>
            <div className="text-[11.5px] text-gray-500 mt-1">
              {meta.label} · @goocampus · {relative(post.timestamp)}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 text-2xl leading-none">×</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-5 p-5 overflow-y-auto">
          <div className="aspect-[4/5] rounded-lg bg-gray-100 overflow-hidden">
            {post.mediaUrl ? (
              <img src={post.mediaUrl} alt="" className="w-full h-full object-contain" loading="lazy" decoding="async" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-4xl text-gray-300">▢</div>
            )}
          </div>
          <div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <Stat label="Reach"          value={fmtNum(post.reach || 0)} />
              <Stat label="Likes"          value={fmtNum(post.likes || 0)} />
              <Stat label="Comments"       value={fmtNum(post.comments || 0)} />
              <Stat label="Engagement rate" value={engRate} />
            </div>
            {post.caption && (
              <div className="text-[12.5px] text-gray-700 leading-relaxed whitespace-pre-wrap line-clamp-[12]">
                {post.caption}
              </div>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 flex items-center gap-3">
          <a
            href={v2(`/dashboard/scheduler?draft=${encodeURIComponent(new URLSearchParams({
              title: post.caption.split("\n")[0].slice(0, 80),
              brief: `Turn this top performer into a similar post.\nOriginal caption:\n${post.caption.slice(0, 400)}`,
            }).toString())}`)}
            className="text-xs font-medium bg-brand text-white px-3 py-2 rounded-md hover:bg-brand-dark"
          >
            <IconPencil size={13} stroke={1.8} className="inline -mt-0.5 mr-1" />Turn into a similar post
          </a>
          <a href={post.permalink} target="_blank" rel="noreferrer" className="text-xs text-gray-500 hover:text-brand">
            Open on Instagram ↗
          </a>
          <button onClick={onClose} className="ml-auto text-xs text-gray-500 hover:text-gray-900">Close</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-md px-3 py-2">
      <div className="text-[16px] font-semibold tabular-nums leading-tight">{value}</div>
      <div className="text-[12px] uppercase tracking-wider text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}
