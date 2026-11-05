"use client";
import { IconCarouselHorizontal, IconMovie, IconPhoto, IconPlayerPlay } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { fmtDateTime } from "@/lib/date";
import { SoundVideo } from "@/components/SoundVideo";

// Shared post-detail modal. Lifted out of the Posts tab so the Overview's
// "Top performing posts" and "Latest posts" grids open the same thing rather
// than growing a second, slightly-different copy.
export type ModalPost = {
  id: string;
  caption: string;
  mediaUrl: string;
  mediaUrls?: string[];   // carousel slides, in order (when it's a carousel)
  videoUrl?: string;      // a reel/video's playable file
  slideVideos?: string[]; // per slide: the video file, or "" for a picture
  permalink: string;
  type: string;
  timestamp: string;
  likes: number;
  comments: number;
  reach: number;
  shares?: number;
  saves?: number;
  totalInteractions?: number;
  views?: number;
};

export const POST_TYPE_LABEL: Record<string, string> = {
  IMAGE: "Image",
  VIDEO: "Video",
  CAROUSEL_ALBUM: "Carousel",
  REEL: "Reel",
};

// Line icons, as everywhere else in the dashboard.
export const POST_TYPE_ICON: Record<string, React.ReactNode> = {
  IMAGE: <IconPhoto size={14} stroke={1.8} />,
  VIDEO: <IconPlayerPlay size={14} stroke={1.8} />,
  CAROUSEL_ALBUM: <IconCarouselHorizontal size={14} stroke={1.8} />,
  REEL: <IconMovie size={14} stroke={1.8} />,
};

// Big thumbnail on the left, full caption + every metric on the right, plus a
// "View on Instagram" link so comments and actions stay one click away.
//
// `insightsLoaded` tells the modal whether the reach/shares/saves numbers have
// actually arrived. When they haven't, those rows show a dash rather than a 0 —
// a zero would read as "this post got nothing".
export function PostDetailModal({ post, insightsLoaded = true, metrics, typeLabel, linkLabel = "Open on Instagram", onClose }: {
  post: ModalPost;
  insightsLoaded?: boolean;
  // Surfaces whose numbers aren't the post set (Stories, Facebook) pass their own
  // rows instead, so they share this shell rather than growing another modal.
  metrics?: { label: string; value: React.ReactNode }[];
  typeLabel?: string;
  linkLabel?: string;
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
  const num = (n: number | undefined) => (n ?? 0).toLocaleString("en-IN");
  // Carousels carry all slides in mediaUrls; everything else is a single "slide".
  const [idx, setIdx] = useState(0);
  const slides = post.mediaUrls?.length ? post.mediaUrls : (post.mediaUrl ? [post.mediaUrl] : []);
  const playing = (post.mediaUrls?.length ? post.slideVideos?.[idx] : post.videoUrl) || "";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full md:w-auto max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col md:flex-row" onClick={(e) => e.stopPropagation()}>
        {/* LEFT — media (carousel gets a slider) */}
        <div className="relative shrink-0 flex items-center justify-center bg-gray-50">
          {/* The image sizes itself and the pane wraps it. Instagram allows 1:1,
              4:5 and 9:16; each now fills its frame exactly, where the old fixed
              half-width pane letterboxed everything that was not square. */}
          {/* Reels and video slides play here, with sound (28 Oct); if the browser
              refuses, the player's "Tap for sound" button is there. */}
          {playing ? (
            <SoundVideo
              src={playing}
              poster={slides[Math.min(idx, slides.length - 1)]}
              open
              loop={false}
              className="block w-full md:w-auto h-auto max-h-[45vh] md:max-h-[85vh] md:max-w-[min(58vw,620px)] bg-black"
            />
          ) : slides.length ? (
            <img
              src={slides[Math.min(idx, slides.length - 1)]}
              alt=""
              className="block w-full md:w-auto h-auto max-h-[45vh] md:max-h-[85vh] md:max-w-[min(58vw,620px)] object-contain" loading="lazy" decoding="async" />
          ) : (
            <div className="text-white text-6xl px-16 py-24">{POST_TYPE_ICON[post.type] ?? "?"}</div>
          )}
          {slides.length > 1 && (
            <>
              <span className="absolute top-3 left-3 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/90 text-gray-700">{idx + 1}/{slides.length}</span>
              <button type="button" onClick={() => setIdx((i) => (i - 1 + slides.length) % slides.length)} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/85 hover:bg-white text-gray-700 flex items-center justify-center text-xl leading-none" aria-label="Previous slide">‹</button>
              <button type="button" onClick={() => setIdx((i) => (i + 1) % slides.length)} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/85 hover:bg-white text-gray-700 flex items-center justify-center text-xl leading-none" aria-label="Next slide">›</button>
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {slides.map((_, i) => <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === idx ? "bg-white" : "bg-white/50"}`} />)}
              </div>
            </>
          )}
        </div>

        {/* RIGHT — details */}
        <div className="md:w-[380px] md:shrink-0 flex flex-col overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 sticky top-0 bg-white">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">{typeLabel ?? POST_TYPE_LABEL[post.type] ?? post.type}</span>
              <span className="text-xs text-gray-500">{fmtDateTime(post.timestamp)}</span>
            </div>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Close">×</button>
          </div>

          <div className="px-5 py-4 space-y-4">
            {/* Full caption */}
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Caption</div>
              <div className="text-sm text-gray-900 whitespace-pre-wrap break-words leading-relaxed">
                {post.caption?.trim() || <span className="italic text-gray-400">(no caption)</span>}
              </div>
            </div>

            {/* Metrics grid */}
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Performance</div>
              <div className="grid grid-cols-2 gap-3">
                {metrics
                  ? metrics.map((m) => <MetricRow key={m.label} label={m.label} value={m.value} />)
                  : (
                    <>
                      <MetricRow label="Reach" value={insightsLoaded ? num(post.reach) : dash} />
                      <MetricRow label="Engagement" value={insightsLoaded ? num(engagement) : dash} />
                      <MetricRow label="Likes" value={num(post.likes)} />
                      <MetricRow label="Comments" value={num(post.comments)} />
                      <MetricRow label="Shares" value={insightsLoaded ? num(post.shares) : dash} />
                      <MetricRow label="Saves" value={insightsLoaded ? num(post.saves) : dash} />
                      {post.views !== undefined && <MetricRow label="Views" value={insightsLoaded ? num(post.views) : dash} />}
                      <MetricRow label="Engagement rate" value={insightsLoaded ? `${engRate}%` : dash} />
                    </>
                  )}
              </div>
            </div>

            {/* Open on Instagram */}
            {post.permalink && (
              <a href={post.permalink} target="_blank" rel="noopener noreferrer"
                className="block w-full text-center px-4 py-2.5 bg-brand text-white rounded-lg hover:bg-brand-dark text-sm font-medium transition">
                {linkLabel} ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-base font-semibold text-gray-900 tabular-nums leading-tight mt-0.5">{value}</div>
    </div>
  );
}
