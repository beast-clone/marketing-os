"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconPhoto, IconUpload, IconCheck, IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

// The reel cover, the way Meta's own composer offers it: suggested frames, pick a
// frame, or upload your own.
//
// All three modes end as an UPLOADED IMAGE, deliberately. Instagram would take a
// `thumb_offset` timestamp instead, but Facebook will not — its reels want an image
// file posted to /{video_id}/thumbnails after the video exists. Resolving everything
// to one image here means one asset serves both platforms, and the cover the person
// picked is byte-for-byte what publishes rather than a frame Meta re-extracts.
//
// Frames are grabbed in the browser: <video> → <canvas> → blob → the normal media
// upload. That needs the video to be CORS-readable; Supabase public URLs are, but a
// tainted canvas throws, so both frame modes fall back to "Upload image" with a
// reason rather than failing silently.

type Mode = "suggested" | "frame" | "upload";

const FRAME_COUNT = 6;
const MAX_W = 1080;

export function ReelThumbnail({ videoUrl, coverUrl, onCover }: {
  videoUrl: string;
  coverUrl: string;
  onCover: (url: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("suggested");
  const [duration, setDuration] = useState(0);
  const [suggested, setSuggested] = useState<string[]>([]);   // object URLs, preview only
  const [frames, setFrames] = useState<Blob[]>([]);
  const [at, setAt] = useState(0);
  const [preview, setPreview] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // One hidden <video> does all the grabbing. Kept in a ref rather than the tree so
  // seeking never re-renders anything.
  const getVideo = useCallback(async (): Promise<HTMLVideoElement> => {
    if (videoRef.current) return videoRef.current;
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "auto";
    v.src = videoUrl;
    await new Promise<void>((resolve, reject) => {
      v.onloadedmetadata = () => resolve();
      v.onerror = () => reject(new Error("Couldn't load the video"));
    });
    videoRef.current = v;
    return v;
  }, [videoUrl]);

  const grab = useCallback(async (seconds: number): Promise<Blob> => {
    const v = await getVideo();
    await new Promise<void>((resolve, reject) => {
      const done = () => { v.removeEventListener("seeked", done); resolve(); };
      v.addEventListener("seeked", done);
      v.onerror = () => reject(new Error("Couldn't read that frame"));
      v.currentTime = Math.min(Math.max(seconds, 0), Math.max((v.duration || 1) - 0.05, 0));
    });
    const scale = Math.min(1, MAX_W / (v.videoWidth || MAX_W));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((v.videoWidth || MAX_W) * scale);
    canvas.height = Math.round((v.videoHeight || MAX_W) * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      // Throws a SecurityError if the video was served without CORS — the canvas is
      // then tainted and cannot be read.
      try {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make an image from that frame"))), "image/jpeg", 0.9);
      } catch {
        reject(new Error("This video can't be read frame-by-frame in the browser. Upload a cover image instead."));
      }
    });
  }, [getVideo]);

  // Suggested frames, evenly spaced, skipping the very first moment — an opening
  // black frame is the one cover nobody wants.
  const loadSuggested = useCallback(async () => {
    setError(null); setBusy("Reading the video…");
    try {
      const v = await getVideo();
      const dur = v.duration || 0;
      setDuration(dur);
      const blobs: Blob[] = [];
      for (let i = 0; i < FRAME_COUNT; i++) {
        blobs.push(await grab(dur * ((i + 0.5) / FRAME_COUNT)));
      }
      setFrames(blobs);
      setSuggested(blobs.map((b) => URL.createObjectURL(b)));
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  }, [getVideo, grab]);

  useEffect(() => {
    setSuggested([]); setFrames([]); setPreview(""); setError(null);
    videoRef.current = null;
    if (videoUrl) loadSuggested();
    // object URLs are released when the component unmounts or the video changes
    return () => { suggested.forEach(URL.revokeObjectURL); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  const upload = async (blob: Blob, name: string) => {
    setBusy("Saving the cover…"); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", new File([blob], name, { type: blob.type || "image/jpeg" }));
      const r = await fetch("/api/scheduler/upload-media", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok || d.error) { setError(d.error || `Upload failed (${r.status})`); return; }
      onCover(d.url);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  };

  const setFrameAsCover = async (seconds: number) => {
    setBusy("Grabbing that frame…"); setError(null);
    try {
      const blob = await grab(seconds);
      await upload(blob, `cover-${Math.round(seconds * 1000)}ms.jpg`);
    } catch (e) {
      setError((e as Error).message); setBusy(null);
    }
  };

  const showFrame = async (seconds: number) => {
    try {
      const blob = await grab(seconds);
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
    } catch { /* the error surfaces when they try to use it */ }
  };

  const TabButton = ({ id, label }: { id: Mode; label: string }) => (
    <button type="button" onClick={() => { setMode(id); if (id === "frame" && !preview) showFrame(at); }}
      className={`px-3 py-1.5 text-[12.5px] rounded-lg ${mode === id ? "bg-brand text-white" : "text-[#4A5468] hover:bg-[#F6F7FB]"}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 flex-wrap">
        <TabButton id="suggested" label="Choose suggested" />
        <TabButton id="frame" label="Choose frame" />
        <TabButton id="upload" label="Upload image" />
        {busy && <span className="ml-2 text-[11.5px] text-[#8A92A6]">{busy}</span>}
      </div>

      {coverUrl && (
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 p-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverUrl} alt="Chosen cover" className="w-[54px] h-[96px] object-cover rounded-md bg-[#F6F7FB]" loading="lazy" decoding="async" />
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#2F9E6F]">
              <IconCheck size={14} stroke={2.2} /> Cover set
            </span>
            <span className="block text-[11px] text-[#A6ACBE] mt-0.5">
              Meta crops a cover that isn&apos;t 9:16 to the middle of the image.
            </span>
          </span>
          <button type="button" onClick={() => onCover("")}
            className="text-[12px] text-[#8A92A6] hover:text-[#C0392B] px-2 py-1">Remove</button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-[#FDECEA] border border-[#F5C6C0] px-3 py-2.5">
          <IconAlertTriangle size={15} stroke={1.9} className="text-[#C0392B] shrink-0 mt-[1px]" />
          <span className="text-[12px] leading-snug text-[#C0392B]">{error}</span>
        </div>
      )}

      {mode === "suggested" && (
        suggested.length ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {suggested.map((src, i) => (
              <button key={src} type="button" onClick={() => upload(frames[i], `cover-suggested-${i + 1}.jpg`)}
                className="shrink-0 rounded-lg overflow-hidden border-2 border-transparent hover:border-brand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Frame ${i + 1}`} className="w-[68px] h-[121px] object-cover bg-[#F6F7FB]" loading="lazy" decoding="async" />
              </button>
            ))}
            <button type="button" onClick={loadSuggested} title="Read the frames again"
              className="shrink-0 w-[68px] h-[121px] rounded-lg border border-dashed border-gray-200 grid place-items-center text-[#A6ACBE] hover:border-brand hover:text-brand">
              <IconRefresh size={16} stroke={1.8} />
            </button>
          </div>
        ) : !busy && !error ? (
          <p className="text-[12px] text-[#A6ACBE]">No frames yet — add a video above.</p>
        ) : null
      )}

      {mode === "frame" && (
        <div className="flex items-start gap-3">
          <div className="w-[68px] h-[121px] rounded-lg overflow-hidden bg-[#F6F7FB] shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview ? <img src={preview} alt="Frame preview" className="w-full h-full object-cover" loading="lazy" decoding="async" />
              : <span className="w-full h-full grid place-items-center text-[#C9CDD8]"><IconPhoto size={18} stroke={1.6} /></span>}
          </div>
          <div className="flex-1 min-w-0">
            <input type="range" min={0} max={Math.max(duration, 0.1)} step={0.1} value={at}
              onChange={(e) => { const t = Number(e.target.value); setAt(t); showFrame(t); }}
              className="w-full accent-[#3A57E8]" />
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[11.5px] text-[#8A92A6] tabular-nums">
                {at.toFixed(1)}s of {duration ? duration.toFixed(1) : "—"}s
              </span>
              <button type="button" onClick={() => setFrameAsCover(at)} disabled={!duration || Boolean(busy)}
                className="text-[12.5px] font-medium bg-brand text-white rounded-lg px-3 py-1.5 hover:bg-brand-dark disabled:opacity-40">
                Use this frame
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === "upload" && (
        <label className="flex items-center gap-2 text-[12.5px] text-brand cursor-pointer rounded-lg border border-dashed border-gray-200 px-3 py-3 hover:border-brand">
          <IconUpload size={15} stroke={1.9} />
          Choose an image for the cover
          <input type="file" accept="image/jpeg,image/png" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, f.name); e.currentTarget.value = ""; }} />
        </label>
      )}
    </div>
  );
}
