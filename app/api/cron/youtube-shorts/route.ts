import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";
import { postSlack, hasSlack } from "@/lib/slack";
import { loadPublishPages } from "@/lib/publish-pages-server";
import { pageInfo } from "@/lib/publish-pages";
import { YT_CHANNEL } from "@/lib/brand-platforms";
import { CHANNELS } from "@/lib/youtube-channels";
import { writeBackLink } from "@/lib/mh-linkback";
import { startUpload, sendPieces, setTiming, deleteVideo, videoState, cleanTitle } from "@/lib/youtube-upload";

// YouTube Shorts worker (Praveen, 6 Nov 2026 — docs/YOUTUBE_SHORTS_SPEC.md).
// Point n8n at this every minute, like the LinkedIn worker:
//   GET /api/cron/youtube-shorts   (header: x-cron-secret: <CRON_SECRET>)
//
// For each Reel with YouTube ticked (mh_posts.custom.youtube), from 90 minutes
// before its time: upload the video private with the post time as YouTube's own
// publish time, a few MB per run (lib/youtube-upload.ts). YouTube then makes it
// public on time by itself. After the time: check it really went public, put the
// link on the task, tell the team. Progress lives in yt_uploads (sql/052).
//
// Changes after the upload: a new time moves YouTube's publish time; a new video,
// title or description takes the uploaded one down and starts again; a post taken
// off the schedule or deleted takes the uploaded video down.
export const dynamic = "force-dynamic";

const START_BEFORE_MS = 90 * 60_000;      // begin uploading this long before the post time
const PIECES_FOR_MS = 6_000;               // stop starting new pieces after this — functions stop at ~10 s
const PRIVATE_GRACE_MS = 10 * 60_000;      // still private this long after its time = something is wrong
const LIVE_STATUSES = ["scheduled", "publishing", "published", "failed"];
const APP_URL = process.env.APP_URL || "https://goocampus-ig-dashboard.netlify.app";
const BASE_PATH = process.env.BASE_PATH ?? "/gc-dashboard";

type Post = {
  id: string; particulars: string | null; caption: string | null; media_urls: string[] | null;
  schedule_time: string | null; publish_status: string | null; publish_to_pages: string[] | null;
  owner_key: string | null; created_by: string | null;
  custom: { youtube?: { title?: string; description?: string } | null } | null;
};
type Up = {
  post_id: string; channel: string; fp: string; status: string; session_url: string | null;
  size: number | null; sent: number; video_id: string | null; publish_at: string | null; error: string | null;
};
type Db = NonNullable<ReturnType<typeof getSupabase>>;

const isVideo = (u: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u);
const shortUrl = (id: string) => `https://youtube.com/shorts/${id}`;

/** What this post wants on YouTube, or null when it no longer wants anything. */
function wish(p: Post | undefined) {
  if (!p || !p.custom?.youtube || !p.schedule_time || !LIVE_STATUSES.includes(p.publish_status || "")) return null;
  const channel = YT_CHANNEL[pageInfo((p.publish_to_pages || [])[0]).accountId] || null;
  const media = (p.media_urls || []).filter(Boolean);
  const video = media.length === 1 && isVideo(media[0]) ? media[0] : null;
  const title = cleanTitle(p.custom.youtube.title || (p.caption || "").split("\n")[0] || p.particulars || "");
  const description = p.custom.youtube.description ?? p.caption ?? "";
  return { channel, video, title, description, at: p.schedule_time, fp: JSON.stringify([video, title, description, channel]) };
}

async function tell(db: Db, p: Post, ok: boolean, text: string, link?: string) {
  const people = [...new Set([p.created_by, p.owner_key].filter(Boolean).map((k) => String(k).toLowerCase()))];
  const name = p.particulars || "A post";
  if (people.length) {
    await db.from("mh_notifications").upsert(people.map((person) => ({
      recipient_key: person,
      source_id: `yt-short:${p.id}:${ok ? "live" : "failed"}:${p.schedule_time}`,
      kind: "youtube", category: ok ? "progress" : "action", action_needed: !ok,
      emoji: ok ? "▶️" : "⚠️",
      title: ok ? "Posted to YouTube Shorts" : "YouTube Shorts didn't post",
      sub: `${name} — ${text}`,
      post_id: p.id,
      payload: { href: link || "/dashboard/preview/scheduler" },
      created_at: new Date().toISOString(),
    })), { onConflict: "recipient_key,source_id", ignoreDuplicates: true });
  }
  if (hasSlack()) await postSlack(`${ok ? "▶️" : "⚠️"} *${name}* ${ok ? "is live on YouTube Shorts" : "didn't post to YouTube Shorts"} — ${text}\n${link || `${APP_URL}${BASE_PATH}/dashboard/preview/scheduler`}`).catch(() => {});
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const started = Date.now();
  const log: string[] = [];
  try {
    await loadPublishPages();   // linked brands (Samvaya) into pageInfo
    const now = Date.now();
    const { data: due } = await db.from("mh_posts")
      .select("id, particulars, caption, media_urls, schedule_time, publish_status, publish_to_pages, owner_key, created_by, custom")
      .not("custom->youtube", "is", null).in("publish_status", LIVE_STATUSES)
      .lte("schedule_time", new Date(now + START_BEFORE_MS).toISOString())
      .gte("schedule_time", new Date(now - 2 * 86_400_000).toISOString()).limit(50);
    const { data: open } = await db.from("yt_uploads").select("*").in("status", ["uploading", "scheduled"]);
    const ups = new Map<string, Up>((open || []).map((u) => [u.post_id, u as Up]));
    // Posts behind an open upload, wherever their time is now — a post moved later
    // still owns its uploaded video.
    const posts = new Map<string, Post>(((due || []) as Post[]).map((p) => [p.id, p]));
    const missing = [...ups.keys()].filter((id) => !posts.has(id));
    if (missing.length) {
      const { data } = await db.from("mh_posts").select("id, particulars, caption, media_urls, schedule_time, publish_status, publish_to_pages, owner_key, created_by, custom").in("id", missing);
      for (const p of (data || []) as Post[]) posts.set(p.id, p);
    }
    const dueIds = new Set(((due || []) as Post[]).map((p) => p.id));
    const { data: done } = dueIds.size ? await db.from("yt_uploads").select("*").in("post_id", [...dueIds]).not("status", "in", "(uploading,scheduled)") : { data: [] };
    for (const u of (done || []) as Up[]) ups.set(u.post_id, u);

    const save = (id: string, patch: Partial<Up>) => db.from("yt_uploads").update({ ...patch, updated_at: new Date().toISOString() }).eq("post_id", id);
    const fail = async (p: Post, channel: string, e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from("yt_uploads").upsert({ post_id: p.id, channel, fp: wish(p)?.fp || "", status: "failed", error: msg, publish_at: p.schedule_time, updated_at: new Date().toISOString() }, { onConflict: "post_id" });
      await tell(db, p, false, msg);
      log.push(`${p.id}: failed — ${msg}`);
    };

    // 1. Uploads whose post no longer wants them: take the video down.
    for (const u of ups.values()) {
      if (u.status !== "uploading" && u.status !== "scheduled") continue;
      const w = wish(posts.get(u.post_id));
      if (w && w.fp === u.fp) continue;
      if (u.video_id) await deleteVideo(u.channel, u.video_id).catch((e) => log.push(`${u.post_id}: couldn't delete ${u.video_id} — ${(e as Error).message}`));
      if (w) { await db.from("yt_uploads").delete().eq("post_id", u.post_id); ups.delete(u.post_id); log.push(`${u.post_id}: changed — starting again`); }
      else { await save(u.post_id, { status: "cancelled", session_url: null }); u.status = "cancelled"; log.push(`${u.post_id}: no longer scheduled — taken down`); }
    }

    // 2. Work through what's wanted.
    for (const p of posts.values()) {
      const w = wish(p);
      if (!w) continue;
      let u = ups.get(p.id);
      // A failed or cancelled try starts over when the post is changed or moved.
      if (u && (u.status === "failed" || u.status === "cancelled") && (u.fp !== w.fp || u.publish_at !== w.at)) { await db.from("yt_uploads").delete().eq("post_id", p.id); u = undefined; }
      if (u && (u.status === "live" || u.status === "failed" || u.status === "cancelled")) continue;
      // A page with no channel (GooCampus World) when the post went to several: nothing to do for it.
      if (!w.channel || !CHANNELS[w.channel]) continue;
      if (!w.video) { if (!u) await fail(p, w.channel, new Error("A Short has to be exactly one video.")); continue; }
      const at = Date.parse(w.at);

      try {
        if (!u) {
          if (at - Date.now() > START_BEFORE_MS) continue;
          const head = await fetch(w.video, { method: "HEAD", cache: "no-store" });
          const size = Number(head.headers.get("content-length") || 0);
          if (!head.ok || !size) throw new Error("Couldn't read the video file.");
          const publishAt = at - Date.now() > 3 * 60_000 ? new Date(at).toISOString() : null;
          const session = await startUpload(w.channel, { title: w.title, description: w.description, publishAt }, size, head.headers.get("content-type") || "video/mp4");
          u = { post_id: p.id, channel: w.channel, fp: w.fp, status: "uploading", session_url: session, size, sent: 0, video_id: null, publish_at: w.at, error: null };
          await db.from("yt_uploads").upsert({ ...u, updated_at: new Date().toISOString() }, { onConflict: "post_id" });
          log.push(`${p.id}: upload started (${Math.round(size / 1e6)} MB)`);
        }

        if (u.status === "uploading" && u.session_url && u.size) {
          if (Date.now() - started > PIECES_FOR_MS) continue;   // next run
          let r;
          try { r = await sendPieces(u.channel, u.session_url, w.video, u.size, started + PIECES_FOR_MS); }
          catch (e) {
            if ((e as Error).message !== "expired") throw e;
            await db.from("yt_uploads").delete().eq("post_id", p.id);   // session gone: start over next run
            log.push(`${p.id}: upload session expired — starting again`);
            continue;
          }
          if ("next" in r) { await save(p.id, { sent: r.next }); log.push(`${p.id}: ${Math.round((100 * r.next) / u.size)}% sent`); continue; }
          // Whole file in. If its time came while it was uploading, it goes public now.
          if (Date.parse(u.publish_at || w.at) <= Date.now() + 60_000) await setTiming(u.channel, r.videoId, null);
          await save(p.id, { status: "scheduled", video_id: r.videoId, sent: u.size, session_url: null });
          u = { ...u, status: "scheduled", video_id: r.videoId };
          log.push(`${p.id}: uploaded as ${r.videoId}`);
        }

        if (u.status === "scheduled" && u.video_id) {
          // Moved to another time after the upload: move YouTube's publish time too.
          if (u.publish_at !== w.at) {
            await setTiming(u.channel, u.video_id, at - Date.now() > 3 * 60_000 ? new Date(at).toISOString() : null);
            await save(p.id, { publish_at: w.at });
            log.push(`${p.id}: moved to ${w.at}`);
            continue;
          }
          if (Date.now() < at + 60_000) continue;
          const s = await videoState(u.channel, u.video_id);
          if (s.problem) throw new Error(s.problem);
          if (s.privacy === "public") {
            const link = shortUrl(u.video_id);
            await save(p.id, { status: "live" });
            await writeBackLink({ postId: p.id, platform: "youtube", url: link });
            await tell(db, p, true, CHANNELS[u.channel].name, link);
            log.push(`${p.id}: live ${link}`);
          } else if (Date.now() > at + PRIVATE_GRACE_MS) {
            // The usual cause until Google's audit passes: API uploads stay private.
            throw new Error(`It's on YouTube but still private (${shortUrl(u.video_id)}). Until Google approves the dashboard's YouTube audit, YouTube keeps uploads from it private.`);
          }
        }
      } catch (e) {
        await fail(p, w.channel, e);
      }
    }
    return NextResponse.json({ ok: true, looked: posts.size, log });
  } catch (err) {
    return NextResponse.json({ ...safeError(err, "YouTube Shorts run failed"), log }, { status: 500 });
  }
}
