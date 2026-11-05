import { getSupabase } from "@/lib/supabase";
import { freshPublishState, NOT_PUBLISHING } from "@/lib/scheduler-lock";
import { logQueueAction, istTime } from "@/lib/publish-history";
import { trashTasks } from "@/lib/task-trash";
import { loadPublishPages } from "@/lib/publish-pages-server";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

// Putting a post into the publish queue (mh_posts) — shared by the Scheduler page
// (/api/scheduler/enqueue) and the Claude connector's schedule_post, so both follow
// exactly the same rules (3 Nov 2026). It does NOT publish to Meta itself: it sets
// publish_status='scheduled' + schedule_time and the publisher picks it up. Callers
// check who may schedule to which page first (requireSchedulerPages / maySchedulePage).
//
//  • taskId present  → UPDATE that Output-Ready row (it then leaves "To schedule")
//  • taskId absent   → INSERT a new manual post

export type EnqueueBody = {
  taskId?: string;
  particulars?: string;
  publishTo?: string;          // channel: Instagram/Facebook/both
  publishToPage?: string;      // primary account
  pages?: string[];            // optional cross-post accounts (defaults to [publishToPage])
  caption?: string;
  mediaUrls?: string[];
  collaborators?: string[];    // Instagram usernames to auto-invite (max 3)
  format?: string;             // "post" | "reel" | "story" — what the publisher should build
  coverUrl?: string;           // reel cover image, already uploaded
  channels?: string[];         // ["instagram","facebook"] — which of Meta's two
  captionFb?: string;          // a different caption for Facebook, when asked for
  draft?: boolean;             // park it; the worker only picks up "scheduled"
  sbu?: string;                // brand / business unit — the calendar's "Interest"
  scheduleTimeISO?: string;    // absent/empty → publish "now" (schedule_time = now)
  alsoStory?: boolean;         // also post the same single photo / reel as a Story
};

export type Sb = NonNullable<ReturnType<typeof getSupabase>>;

// "Also share as a Story" (Praveen, 27 Oct — like Meta's own scheduler). The Story is
// its own queue row beside the post: same file, pages, networks and time, so the
// publisher (which already posts IG + FB stories) sends both in the same run.
// Instagram and Facebook only — LinkedIn has no Stories. Re-queueing the post updates
// its Story instead of adding another; unticking bins a Story that hasn't gone out.
async function syncStory(sb: Sb, postId: string, want: boolean, row: Record<string, unknown>, title: string, when: string, draft: boolean, actor: string) {
  const { data: found } = await sb.from("mh_posts").select("id, publish_status").eq("custom->>story_of", postId).is("custom->>frame", null).limit(5);
  const open = (found || []).find((r) => r.publish_status !== "published" && r.publish_status !== "publishing");
  if (!want) {
    if (open) await trashTasks(sb, [open.id], actor);
    return;
  }
  // Already out (or going out right now) — never post the same Story twice.
  if (!open && (found || []).length) return;
  if (open) {
    const { error } = await sb.from("mh_posts").update(row).eq("id", open.id).or(NOT_PUBLISHING);
    if (error) throw new Error(`story: ${error.message}`);
    await logQueueAction(sb, open.id, draft ? "publish_draft_saved" : when === "now" ? "publish_now" : "publish_scheduled", null, istTime(String(row.schedule_time)));
    return;
  }
  const { data, error } = await sb.from("mh_posts").insert({
    particulars: `${title} · Story`.slice(0, 200),
    status: "Ready to Publish",
    needs_review: false,
    synced_to_scheduler: false,
    type: "Story",
    ...row,
  }).select("id").single();
  if (error) throw new Error(`story: ${error.message}`);
  await logQueueAction(sb, data.id, draft ? "publish_draft_saved" : when === "now" ? "publish_now" : "publish_scheduled", null, istTime(String(row.schedule_time)));
}

// A story with several frames (Praveen, 3 Nov 2026). Meta publishes one image or one
// video per story — there is no carousel story — so each frame after the first is
// its own queue row, linked to the post by custom.story_of (so Cancel, Delete draft
// and Reschedule take it along) and numbered by custom.frame. All frames share the
// post's time — 10 ms apart, so the publisher's run (every minute) sends them
// together, in frame order (it sorts what's due by schedule_time). No minute gaps:
// Praveen, 3 Nov 2026 — "it should go all at once". Re-queueing updates the frames; ones no longer wanted are binned;
// a frame already out is never sent again.
export const FRAME_STEP_MS = 10;
async function syncFrames(sb: Sb, postId: string, frames: string[], row: Record<string, unknown>, title: string, when: string, draft: boolean, actor: string) {
  const { data: found } = await sb.from("mh_posts").select("id, publish_status, custom").eq("custom->>story_of", postId).not("custom->>frame", "is", null);
  const byFrame = new Map<number, { id: string; publish_status: string | null }>();
  for (const r of (found || []) as { id: string; publish_status: string | null; custom: Record<string, unknown> | null }[]) byFrame.set(Number(r.custom?.frame), r);
  const base = Date.parse(String(row.schedule_time));
  const total = frames.length + 1;
  for (let i = 0; i < frames.length; i++) {
    const n = i + 2;
    const at = new Date(base + (i + 1) * FRAME_STEP_MS).toISOString();
    const fields = { ...row, media_urls: [frames[i]], schedule_time: at, custom: { ...(row.custom as object), frame: n } };
    const have = byFrame.get(n);
    if (have && (have.publish_status === "published" || have.publish_status === "publishing")) continue;
    if (have) {
      const { error } = await sb.from("mh_posts").update({ ...fields, particulars: `${title} · Story ${n}/${total}`.slice(0, 200) }).eq("id", have.id).or(NOT_PUBLISHING);
      if (error) throw new Error(`story frame: ${error.message}`);
      await logQueueAction(sb, have.id, draft ? "publish_draft_saved" : when === "now" ? "publish_now" : "publish_scheduled", null, istTime(at));
      continue;
    }
    const { data, error } = await sb.from("mh_posts").insert({
      particulars: `${title} · Story ${n}/${total}`.slice(0, 200),
      status: "Ready to Publish", needs_review: false, synced_to_scheduler: false, type: "Story",
      ...fields,
    }).select("id").single();
    if (error) throw new Error(`story frame: ${error.message}`);
    await logQueueAction(sb, data.id, draft ? "publish_draft_saved" : when === "now" ? "publish_now" : "publish_scheduled", null, istTime(at));
  }
  const extra = [...byFrame.entries()].filter(([n, r]) => n > total && r.publish_status !== "published" && r.publish_status !== "publishing").map(([, r]) => r.id);
  if (extra.length) await trashTasks(sb, extra, actor);
}

// Instagram allows up to 3 collaborators; normalise (strip leading @, blanks) and cap.
function cleanCollaborators(raw?: string[]): string[] | null {
  if (!raw) return null;
  const list = raw
    .map((s) => (s || "").trim().replace(/^@+/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/+$/, ""))
    .filter(Boolean)
    .slice(0, 3);
  return list.length ? list : null;
}

export type EnqueueResult =
  | { ok: true; id: string; when: string; scheduleTime: string; mode: "updated" | "inserted"; story: boolean }
  | { error: string; status: number };

/** `actor` is who did it (for the recycle bin when an unticked Story is removed). */
export async function enqueuePost(sb: Sb, b: EnqueueBody, actor: string): Promise<EnqueueResult> {
  const scheduleTime = b.scheduleTimeISO && b.scheduleTimeISO.trim() ? b.scheduleTimeISO : new Date().toISOString();
  const when: "now" | "scheduled" = b.scheduleTimeISO && b.scheduleTimeISO.trim() ? "scheduled" : "now";
  const pages = (b.pages && b.pages.length ? b.pages : (b.publishToPage ? [b.publishToPage] : [])).filter(Boolean);
  let media = (b.mediaUrls || []).filter((u) => u && u.trim());

  // Format and cover ride in `custom` (jsonb), which mh_posts already carries for
  // fields outside the fixed schema. No migration, and the publisher reads the row
  // whole. NOT the `type` column: that is the Marketing Hub's editorial type and
  // already holds things like "Reel Thumbnail" and "YouTube Long-Form".
  const format = b.format === "reel" ? "reel" : b.format === "story" ? "story" : "post";
  // A multi-frame story: the post's own row carries frame 1, the rest get their own
  // rows (syncFrames below). Taken out before the carousel rules, which don't apply.
  const storyFrames = format === "story" && media.length > 1 ? media.slice(1) : [];
  if (storyFrames.length) {
    if (media.length > 10) return { error: "A story can have at most 10 frames here — remove some and try again.", status: 400 };
    media = [media[0]];
  }
  const cover = (b.coverUrl || "").trim();

  // Empty or missing channels means both, which is what every post did before this
  // existed — an old row must not suddenly publish nowhere.
  let channels = (b.channels || []).filter((c) => c === "instagram" || c === "facebook");
  // Which files go where (Praveen, 28 Oct). Facebook can't take a carousel with video
  // slides (it posts a still instead):
  //   - video slides AND pictures = two versions of one post: the videos are the
  //     Instagram carousel (media_urls), the pictures go to Facebook (custom.media_fb);
  //   - several videos only = Instagram only;
  //   - several pictures = the same set to both; Facebook posts them all as one
  //     multi-photo post (custom.media_fb), not just the first picture.
  const isVideo = (u: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u);
  const vids = media.filter(isVideo), pics = media.filter((u) => !isVideo(u));
  let mediaFb: string[] | null = null;
  if (vids.length && pics.length) { media = vids; mediaFb = pics; }
  else if (vids.length > 1) channels = ["instagram"];
  else if (pics.length > 1) mediaFb = pics;
  if (media.length > 10 || (mediaFb && mediaFb.length > 10)) return { error: "Instagram and Facebook take at most 10 slides — remove some and try again.", status: 400 };
  // Video size (28 Oct): Instagram publishes videos up to 300 MB from outside its app,
  // Facebook up to 1 GB by link. Bigger than 300 MB → Facebook only; bigger than 1 GB
  // → neither will take it. Sizes come from the files themselves (HEAD), so every
  // screen and old draft is held to it.
  const sizeOf = async (u: string) => {
    const r = await fetchWithTimeout(u, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null);
    return Number(r?.headers.get("content-length") || 0);
  };
  const vidSizes = await Promise.all(vids.map(sizeOf));
  const MB = 1024 * 1024;
  if (vidSizes.some((n) => n > 1024 * MB)) return { error: "A video is over 1 GB — Facebook takes up to 1 GB from here and Instagram up to 300 MB, so it can't be posted.", status: 400 };
  if (vidSizes.some((n) => n > 300 * MB)) {
    // A carousel of video slides only goes to Instagram, so with one too big nothing can take it.
    if (vids.length > 1 && !pics.length) return { error: "A video slide is over 300 MB — Instagram doesn't take that from here, and Facebook doesn't take carousels with video slides.", status: 400 };
    channels = ["facebook"];
  }
  // A brand connected with "Connect Instagram only" has no Facebook page (5 Nov):
  // its posts go to Instagram only, whatever the screen sent.
  const pageList = await loadPublishPages();
  if (pages.some((v) => pageList.find((p) => p.value === v)?.instagramOnly)) {
    if (channels.length === 1 && channels[0] === "facebook") return { error: "This brand is connected with Instagram only, and the video is over 300 MB — Instagram doesn't take that from here.", status: 400 };
    channels = ["instagram"];
    mediaFb = null;
  }
  const fbCaption = (b.captionFb || "").trim();
  const customPatch = {
    publish_format: format,
    cover_url: cover || null,
    channels: channels.length ? channels : ["instagram", "facebook"],
    caption_fb: fbCaption || null,
    media_fb: mediaFb,
  };

  const sbu = (b.sbu || "").trim();

  const common = {
    // Only written when the composer actually collected one — an empty string
    // would wipe the brand off a row that already had it.
    ...(sbu ? { sbu } : {}),
    caption: b.caption || null,
    media_urls: media.length ? media : null,
    publish_to: b.publishTo || null,
    publish_to_pages: pages.length ? pages : null,
    collaborators: cleanCollaborators(b.collaborators),
    schedule_time: scheduleTime,
    publish_status: (b.draft ? "draft" : "scheduled") as "draft" | "scheduled",
  };

  // A Story is one photo or one video, and only a feed post or reel gets one beside it.
  const wantStory = !!b.alsoStory && (format === "post" || format === "reel") && media.length === 1;
  const storyFor = (postId: string) => syncStory(sb, postId, wantStory, {
    ...common,
    collaborators: null,   // Stories can't carry collaborators
    custom: { publish_format: "story", cover_url: null, channels: customPatch.channels, caption_fb: null, story_of: postId },
  }, (b.particulars || "Post").trim(), when, !!b.draft, actor);
  const framesFor = (postId: string) => syncFrames(sb, postId, storyFrames, {
    ...common,
    collaborators: null,
    custom: { publish_format: "story", cover_url: null, channels: customPatch.channels, caption_fb: null, story_of: postId },
  }, (b.particulars || "Story").trim(), when, !!b.draft, actor);

  if (b.taskId) {
    // Merge into whatever custom already holds. An Output-Ready row can carry other
    // custom fields (claim_role, and any column the Marketing Hub has added), and
    // replacing the object outright would quietly delete them.
    const { data: existing } = await sb.from("mh_posts").select("custom, publish_status, media_urls, caption").eq("id", b.taskId).maybeSingle();
    // Never re-queue a post the publisher is sending right now — that is a double post.
    if (existing?.publish_status === "publishing") return { error: "It's being published right now — wait a minute, then refresh.", status: 409 };
    // Forget what already went out only when the post itself changed. Re-queueing the
    // same post (taken out after Instagram went and Facebook failed) must not post
    // Instagram a second time (22 Oct review).
    const newVersion = JSON.stringify(existing?.media_urls || []) !== JSON.stringify(media.length ? media : [])
      || (existing?.caption || "") !== (b.caption || "");
    const merged = { ...freshPublishState(existing?.custom, newVersion), ...customPatch };
    const { data, error } = await sb.from("mh_posts").update({ ...common, custom: merged }).eq("id", b.taskId).or(NOT_PUBLISHING).select("id").single();
    if (error) throw new Error(error.message);
    await logQueueAction(sb, data.id, b.draft ? "publish_draft_saved" : when === "now" ? "publish_now" : "publish_scheduled", null, istTime(scheduleTime));
    await storyFor(data.id);
    await framesFor(data.id);
    return { ok: true, id: data.id, when: b.draft ? "draft" : when, scheduleTime, mode: "updated", story: wantStory };
  }

  // New manual post
  if (!b.particulars || !b.particulars.trim()) {
    return { error: "particulars (title) is required for a new post", status: 400 };
  }
  const { data, error } = await sb
    .from("mh_posts")
    .insert({
      particulars: b.particulars.trim(),
      status: "Ready to Publish",   // content-workflow status (enum)
      needs_review: false,
      synced_to_scheduler: false,
      // Only for a reel or a story, and only on a new row — `type` is the
      // Marketing Hub's editorial type and an existing one is not ours to
      // overwrite.
      ...(format === "reel" ? { type: "Reel" } : format === "story" ? { type: "Story" } : {}),
      custom: customPatch,
      ...common,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await logQueueAction(sb, data.id, b.draft ? "publish_draft_saved" : when === "now" ? "publish_now" : "publish_scheduled", null, istTime(scheduleTime));
  if (wantStory) await storyFor(data.id);
  if (storyFrames.length) await framesFor(data.id);
  return { ok: true, id: data.id, when, scheduleTime, mode: "inserted", story: wantStory };
}
