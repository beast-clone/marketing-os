// YouTube Shorts uploads from the Scheduler (Praveen, 6 Nov 2026 — docs/YOUTUBE_SHORTS_SPEC.md).
//
// Google's resumable upload: one call opens an upload session, then the file goes
// up in pieces. Each piece is a few MB, so no single request runs long — a dashboard
// function stops after ~10 s, and a Short can be 50+ MB. The session lives for a
// week; every run first asks YouTube how much it already has, so a run that died
// mid-piece costs nothing but a retry of that piece.
//
// Uses only a channel's own dashboard-connected grant (channelAccessToken), never an
// env fallback that might belong to another channel's account.
import { channelAccessToken, forgetYouTubeToken } from "@/lib/youtube";
import { YT_MANAGE_SCOPE } from "@/lib/youtube-connect";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
/** Must be a multiple of 256 KB (Google's rule for every piece but the last). */
export const PIECE = 4 * 1024 * 1024;

export type ShortMeta = { title: string; description: string; publishAt: string | null };

/** YouTube refuses titles over 100 characters and any "<" or ">". */
export function cleanTitle(t: string): string {
  return t.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
}

async function token(channel: string): Promise<string> {
  const t = await channelAccessToken(channel);
  if (!t) throw new Error("This YouTube channel isn't connected for uploading yet — an admin presses Reconnect on its YouTube card on the Brands page.");
  return t;
}

/** Turn a Google error answer into a sentence for the post's status line. */
async function why(r: Response): Promise<string> {
  const j = await r.json().catch(() => ({}));
  const e = j?.error || {};
  const reason = e.errors?.[0]?.reason || e.status || "";
  if (r.status === 403 && /insufficient|SCOPE/i.test(`${reason} ${e.message || ""}`)) return "This channel was connected for reading only — an admin presses Reconnect on its YouTube card on the Brands page to allow uploads.";
  if (/quota/i.test(reason)) return "YouTube's daily upload limit for the dashboard is used up — it tries again tomorrow.";
  if (/uploadLimitExceeded/i.test(reason)) return "This channel has hit YouTube's own daily upload limit.";
  return `YouTube said: ${e.message || `error ${r.status}`}`;
}

function status(meta: ShortMeta) {
  // A time in the future: uploaded private, YouTube makes it public itself then.
  return meta.publishAt
    ? { privacyStatus: "private", publishAt: meta.publishAt, selfDeclaredMadeForKids: false }
    : { privacyStatus: "public", selfDeclaredMadeForKids: false };
}

/** Open an upload session; returns its URL (the session's address for every piece). */
export async function startUpload(channel: string, meta: ShortMeta, size: number, type: string): Promise<string> {
  const r = await fetchWithTimeout(UPLOAD, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token(channel)}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(size),
      "X-Upload-Content-Type": type,
    },
    body: JSON.stringify({
      snippet: { title: cleanTitle(meta.title), description: meta.description.slice(0, 5000), categoryId: "27" },   // 27 = Education
      status: status(meta),
    }),
  });
  if (r.status === 401) forgetYouTubeToken(channel);
  const at = r.headers.get("location");
  if (!r.ok || !at) throw new Error(await why(r));
  return at;
}

/** How many bytes YouTube already holds, or the video id if it has the whole file. */
async function received(channel: string, session: string, size: number): Promise<{ next: number } | { videoId: string }> {
  const r = await fetchWithTimeout(session, { method: "PUT", headers: { Authorization: `Bearer ${await token(channel)}`, "Content-Range": `bytes */${size}`, "Content-Length": "0" } });
  if (r.status === 200 || r.status === 201) return { videoId: (await r.json()).id };
  if (r.status === 308) { const m = /bytes=0-(\d+)/.exec(r.headers.get("range") || ""); return { next: m ? Number(m[1]) + 1 : 0 }; }
  if (r.status === 404 || r.status === 410) throw new Error("expired");   // session gone: the caller starts over
  throw new Error(await why(r));
}

/** Send pieces until done or `until` (ms epoch). Returns progress or the finished video id. */
export async function sendPieces(channel: string, session: string, fileUrl: string, size: number, until: number): Promise<{ next: number } | { videoId: string }> {
  let at = await received(channel, session, size);
  while ("next" in at && Date.now() < until) {
    const end = Math.min(at.next + PIECE, size) - 1;
    const f = await fetchWithTimeout(fileUrl, { headers: { Range: `bytes=${at.next}-${end}` }, cache: "no-store", timeoutMs: 20_000 });
    if (f.status !== 206 && !(f.status === 200 && at.next === 0 && end === size - 1)) throw new Error(`Couldn't read the video file (${f.status}).`);
    const piece = await f.arrayBuffer();
    const r = await fetchWithTimeout(session, {
      method: "PUT",
      headers: { Authorization: `Bearer ${await token(channel)}`, "Content-Range": `bytes ${at.next}-${end}/${size}`, "Content-Length": String(piece.byteLength) },
      body: piece,
      timeoutMs: 20_000,
    });
    if (r.status === 200 || r.status === 201) return { videoId: (await r.json()).id };
    if (r.status !== 308) throw new Error(await why(r));
    const m = /bytes=0-(\d+)/.exec(r.headers.get("range") || "");
    at = { next: m ? Number(m[1]) + 1 : at.next };
  }
  return at;
}

async function call(channel: string, method: string, path: string, body?: unknown): Promise<Response> {
  return fetchWithTimeout(`${API}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token(channel)}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
}

/** Change when (or whether) it goes public. publishAt null = public now. */
export async function setTiming(channel: string, videoId: string, publishAt: string | null): Promise<void> {
  const r = await call(channel, "PUT", "videos?part=status", { id: videoId, status: status({ title: "", description: "", publishAt }) });
  if (!r.ok) throw new Error(await why(r));
}

export async function deleteVideo(channel: string, videoId: string): Promise<void> {
  const r = await call(channel, "DELETE", `videos?id=${encodeURIComponent(videoId)}`);
  if (!r.ok && r.status !== 404) throw new Error(await why(r));
}

/** YouTube's view of the video: privacy, and whether processing failed or was rejected. */
export async function videoState(channel: string, videoId: string): Promise<{ found: boolean; privacy: string; problem: string | null }> {
  const r = await call(channel, "GET", `videos?part=status&id=${encodeURIComponent(videoId)}`);
  if (!r.ok) throw new Error(await why(r));
  const s = (await r.json()).items?.[0]?.status;
  if (!s) return { found: false, privacy: "", problem: "The video is no longer on YouTube." };
  const problem = s.uploadStatus === "failed" ? `YouTube couldn't process it (${s.failureReason})`
    : s.uploadStatus === "rejected" ? `YouTube rejected it (${s.rejectionReason})` : null;
  return { found: true, privacy: s.privacyStatus, problem };
}

/** Can this channel take uploads? Which channel the grant really is, for the composer. */
export async function uploadReady(channel: string): Promise<{ ready: boolean; title?: string; reason?: string }> {
  const t = await channelAccessToken(channel).catch(() => null);
  if (!t) return { ready: false, reason: "not connected from the dashboard" };
  const info = await fetchWithTimeout(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(t)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
  if (!String(info.scope || "").split(" ").includes(YT_MANAGE_SCOPE)) return { ready: false, reason: "connected for reading only" };
  const me = await call(channel, "GET", "channels?part=snippet&mine=true").then((r) => r.json()).catch(() => ({}));
  return { ready: true, title: me.items?.[0]?.snippet?.title };
}
