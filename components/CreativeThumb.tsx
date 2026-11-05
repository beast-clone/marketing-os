"use client";
import { useState } from "react";
import { IconVideo, IconExternalLink, IconSchool, IconPlayerPlayFilled } from "@tabler/icons-react";

// A creative preview tile that never renders a broken image. Shows the real
// uploaded image when there is one (falling back if it fails to load); otherwise
// a clean, on-brand generated tile (gradient + GooCampus cap + the post title) so
// posts whose creative lives as a private Slack link — or nothing yet — still look
// intentional. Shared by Content Review, Scheduler, My Day and Marketing Hub.

const GRADS: [string, string][] = [
  ["#3A57E8", "#1E2F7A"], // brand blue
  ["#0F9D8C", "#0A5F55"], // teal
  ["#E8622A", "#B23F12"], // orange
  ["#6E48F8", "#3B248C"], // violet
];
function pickGrad(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADS[h % GRADS.length];
}

export function CreativeThumb({
  thumbnailUrl,
  assetLink,
  type,
  title,
  seed,
  rounded,
  fit = "cover",
}: {
  thumbnailUrl?: string | null;
  assetLink?: string | null;
  type?: string | null;
  title?: string | null;
  seed?: string | null;
  rounded?: boolean;
  /** "contain" shows the whole image (letterboxed) instead of filling the tile. */
  fit?: "cover" | "contain";
}) {
  const [broken, setBroken] = useState(false);
  const isVideo = /reel|video/i.test(type || "") || /\.(mp4|mov|webm)(\?|$)/i.test(assetLink || "");
  const radius = rounded ? "rounded-lg" : "";

  // A video creative (a reel's mp4) can't go in an <img loading="lazy" decoding="async"> — that is what showed the
  // coloured fallback tile instead of the reel in Content Review (22 Oct). Show a
  // frame from the video itself, with a play mark so it reads as a video.
  if (thumbnailUrl && !broken && /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(thumbnailUrl)) {
    return (
      <div className={`w-full h-full relative bg-[#0b1020] ${radius}`}>
        <video src={`${thumbnailUrl.split("#")[0]}#t=0.5`} muted playsInline preload="metadata"
          className={`w-full h-full ${fit === "contain" ? "object-contain" : "object-cover"} ${radius}`}
          onError={() => setBroken(true)} />
        <span className="absolute inset-0 grid place-items-center pointer-events-none">
          <span className="w-9 h-9 rounded-full bg-black/55 grid place-items-center text-white"><IconPlayerPlayFilled size={16} /></span>
        </span>
      </div>
    );
  }
  if (thumbnailUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumbnailUrl}
        alt={title || "creative"}
        className={`w-full h-full ${fit === "contain" ? "object-contain" : "object-cover"} ${radius}`}
        onError={() => setBroken(true)} loading="lazy" decoding="async" />
    );
  }

  const [a, b] = pickGrad(seed || title || "goocampus");
  return (
    <div
      className={`w-full h-full relative grid place-items-center text-white overflow-hidden ${radius}`}
      style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
    >
      <IconSchool className="absolute -right-4 -bottom-4 opacity-15" size={96} stroke={1.1} />
      <div className="flex flex-col items-center gap-1.5 px-3 text-center max-w-full">
        {isVideo ? <IconVideo size={22} stroke={1.7} className="opacity-90" /> : <IconSchool size={22} stroke={1.7} className="opacity-90" />}
        <span className="text-[12px] font-semibold leading-tight line-clamp-3">{title || "GooCampus creative"}</span>
      </div>
      {assetLink && (
        <a
          href={assetLink}
          target="_blank"
          rel="noreferrer"
          title="Open the creative in Slack"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 grid place-items-center w-6 h-6 rounded-md bg-white/15 hover:bg-white/30 transition"
        >
          <IconExternalLink size={13} stroke={1.9} />
        </a>
      )}
    </div>
  );
}
