export type Post = {
  id: string;
  caption: string;
  mediaUrl?: string;
  permalink: string;
  type: "IMAGE" | "VIDEO" | "REEL" | "CAROUSEL_ALBUM" | "STORY";
  timestamp: string;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  reach: number;
  views?: number;
};

export function LatestPost({ post }: { post: Post | null }) {
  if (!post) return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 text-sm text-gray-500">
      No posts yet — connect an account to see the latest.
    </div>
  );
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">Latest post</div>
        <a href={post.permalink} target="_blank" className="text-xs text-brand">Open in Instagram ↗</a>
      </div>
      <div className="flex gap-4">
        {post.mediaUrl && (
          <img src={post.mediaUrl} alt="" className="w-32 h-32 object-cover rounded-xl" loading="lazy" decoding="async" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm line-clamp-3 text-gray-700">{post.caption || "—"}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <Stat label="Reach" v={post.reach} />
            <Stat label="Likes" v={post.likes} />
            <Stat label="Comments" v={post.comments} />
            <Stat label="Shares" v={post.shares} />
            <Stat label="Saves" v={post.saves} />
            {post.views !== undefined && <Stat label="Views" v={post.views} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded-lg bg-gray-50 px-2 py-1.5">
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className="text-sm font-semibold">{v.toLocaleString()}</div>
    </div>
  );
}
