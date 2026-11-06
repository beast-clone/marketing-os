// Airtable Content Calendar bridge.
// We don't touch the Meta API directly — we just write a row to the same Airtable
// table that the existing n8n Sync V3 + Native Scheduler pipeline already watches.
//
// Flow: dashboard writes row -> n8n Sync V3 picks up within ~1 min -> Native Scheduler
// publishes within ~1 min -> Telegram notifier marks Published. Worst-case lag ~2 min.

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { getSupabase } from "@/lib/supabase";
import { nextPublisherCheck } from "@/lib/publisher-clock";

const BASE_ID = "appLdJFTrothBLDc0";
const CONTENT_CALENDAR_TABLE = "tblRlOFss2lDKE9EG";   // Content Calendar (caption source + legacy create-post)

function token(): string {
  const t = process.env.AIRTABLE_API_KEY;
  if (!t) throw new Error("AIRTABLE_API_KEY not configured");
  return t;
}

type AttachmentInput = { url: string; filename?: string };

export type CreatePostInput = {
  particulars: string;            // short title for the row, e.g. "AMC Aug intake reel"
  publishTo: "Facebook" | "Instagram" | "Instagram/Facebook";
  publishToPage: string;          // a page value (lib/publish-pages.ts)
  caption: string;                // the body the post will use (Sync V3 will split IG vs FB)
  mediaUrls: string[];            // 1+ urls (image/video/reel). For carousels send multiple.
  scheduleTimeISO?: string;       // when to publish; omit to use Sync V3's default (now + 2h)
  sbu?: string;                   // e.g. "GooCampus Edu", optional
  type?: string;                  // e.g. "Reel", "Image", "Carousel"
};

type AirtableRecord = {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
};

async function airtablePost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetchWithTimeout(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    timeoutMs: 15_000,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Airtable POST ${r.status}: ${text.slice(0, 200)}`);
  }
  return r.json() as Promise<T>;
}

async function airtableGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const r = await fetchWithTimeout(`https://api.airtable.com/v0/${BASE_ID}/${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token()}` },
    cache: "no-store",
    timeoutMs: 15_000,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Airtable GET ${r.status}: ${text.slice(0, 200)}`);
  }
  return r.json() as Promise<T>;
}

export async function createContentCalendarRow(input: CreatePostInput): Promise<{ id: string; createdTime: string }> {
  // Build the field map. Only include fields with values — Airtable rejects unknown nulls.
  const fields: Record<string, unknown> = {
    Particulars: input.particulars,
    "Publish To": input.publishTo,
    "Publish To Page": input.publishToPage,
    Caption: input.caption,
    Content: input.caption,                  // Sync V3 reads either; safe to mirror
    Status: "Ready to Publish",
  };
  if (input.sbu) fields.SBU = input.sbu;
  if (input.type) fields.Type = input.type;

  // Media: prefer Attachments (Airtable will fetch from URL)
  if (input.mediaUrls.length > 0) {
    const attachments: AttachmentInput[] = input.mediaUrls.map((u) => ({ url: u }));
    fields.Attachments = attachments;
  }

  // Schedule: if explicit time given, we set it on the CC row so Sync V3 can pass it through.
  // Sync V3 will copy this into Post Scheduler.Schedule Time.
  if (input.scheduleTimeISO) {
    fields["Schedule Time"] = input.scheduleTimeISO;
  }

  const res = await airtablePost<{ records: AirtableRecord[] }>(CONTENT_CALENDAR_TABLE, {
    records: [{ fields }],
    typecast: true,
  });
  const row = res.records[0];
  return { id: row.id, createdTime: row.createdTime };
}

// Pull the writer's long-form body straight from the Content Calendar row.
// The Supabase mirror (mh_posts) doesn't carry the "Content" rich-text field,
// so the task-detail panel fetches it live by Airtable record id when opened.
export async function fetchContentCalendarBody(
  recordId: string,
): Promise<{ content: string; notes: string }> {
  try {
    const rec = await airtableGet<AirtableRecord>(`${CONTENT_CALENDAR_TABLE}/${recordId}`);
    const f = rec.fields || {};
    const asText = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    return { content: asText(f["Content"]), notes: asText(f["Content Notes"]) };
  } catch {
    return { content: "", notes: "" };
  }
}

// The team writes the ready-to-post caption inside the Content rich-text field,
// under a "Caption:" heading (e.g. "### Caption:"), followed by the caption text
// and a trailing bracketed keyword/hashtag block. Pull just that section so the
// scheduler can auto-fill the Caption field. Light markdown strip for cleanliness.
export function extractCaptionFromContent(content: string): string {
  if (!content) return "";
  let body: string;
  // Prefer a line that is only "Caption:" (with optional #/*/> markdown around it).
  const heading = content.match(/^[#>*_\s]*caption\s*:?\s*$/im);
  if (heading && heading.index != null) {
    body = content.slice(heading.index + heading[0].length);
  } else {
    // Fall back to an inline "Caption:" marker anywhere in the content.
    const idx = content.search(/caption\s*:/i);
    if (idx < 0) return "";
    body = content.slice(idx).replace(/^\s*caption\s*:/i, "");
  }
  return body
    .replace(/\*\*/g, "")        // bold markers
    .replace(/^#{1,6}\s*/gm, "") // stray headings
    .trim();
}

const isVideoUrl = (u?: string | null) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u || "");

export type ScheduledPost = {
  id: string;
  particulars: string;
  publishToPage: string;
  primaryInterest: string;         // e.g. "Study Abroad", "University Programs"
  platform: string;                // "Facebook" | "Instagram/Facebook"
  type: string;                    // "Image" | "Reel" | "Carousel" (freeform)
  caption: string;
  fullCaption: string;             // untrimmed — used by the edit modal
  igCaption: string;               // Instagram-specific override, if any
  fbCaption: string;               // Facebook-specific override, if any
  thumbnailUrl: string | null;     // first attachment thumbnail for the card
  coverUrl: string | null;         // reel cover, when one was chosen
  igMediaId: string | null;        // Instagram media id, for insights
  mediaUrls: string[];             // all media (carousel slides / video), in order
  scheduleTime: string | null;
  status: string;                  // raw Airtable status
  effectiveStatus: EffectiveStatus; // what the UI should show
  failureReason: string | null;    // populated when effectiveStatus === "failed"
  instagramUrl: string | null;
  facebookUrl: string | null;
  publishedAt: string | null;
  updatedAt?: string | null;       // last change to the row — when "publishing" began
  prepState?: "sending" | "ready" | "error" | null;   // file sent ahead of the time (publisher v3)
  prepError?: string | null;
  processingTry?: number | null;   // set while Instagram is still processing a video
  format?: string | null;          // "post" | "reel" | "story" — what the publisher builds
  storyOf?: string | null;         // set on a post's "also as a Story" — the post's id
  // What reopening a draft in Create post needs (27 Oct).
  pages?: string[];                // every page ticked, not only the first
  channels?: string[];             // "instagram" / "facebook"
  mediaFb?: string[];              // Facebook's own set (custom.media_fb), when it differs from Instagram's
  collaborators?: string[];
  captionFbOverride?: string | null; // the separate Facebook caption, when one was written
  /** Also as a YouTube Short (custom.youtube) — its title, and how the upload stands (yt_uploads). */
  youtubeTitle?: string | null;
  youtube?: { status: string; pct: number; error: string | null; url: string | null } | null;
};

export type EffectiveStatus = "scheduled" | "publishing" | "published" | "failed" | "draft" | "unknown";

// A scheduled post is treated as stuck/failed if the worker misses its window:
//   - 'scheduled' past its schedule_time by >5 min = the publish worker never picked it up
//   - 'publishing' with no IG/FB URL for >10 min = stuck mid-publish (likely a Meta error)
const STUCK_SCHEDULED_MS = 5 * 60 * 1000;
const STUCK_PUBLISHING_MS = 10 * 60 * 1000;

// Supabase-native queue. Reads mh_posts rows that have entered the publish pipeline
// (publish_status is set), so the Calendar/Scheduled counters reflect exactly what
// the enqueue action wrote. This is the single source of truth for the scheduler queue.
type MhQueueRow = {
  id: string;
  particulars: string | null;
  sbu: string | null;
  type: string | null;
  caption: string | null;
  media_urls: string[] | null;
  publish_to: string | null;
  publish_to_page: string | null;
  publish_to_pages: string[] | null;
  schedule_time: string | null;
  publish_status: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  youtube_url?: string | null;
  published_at: string | null;
  custom: Record<string, unknown> | null;
  failure_reason: string | null;
  updated_at: string | null;
  collaborators: string[] | null;
};

// Must match fingerprint() in n8n/publisher-v3 — what the file sent ahead was made
// from. A different one means the post changed since, and the upload is redone.
function prepFingerprint(r: MhQueueRow): string {
  const c = (r.custom || {}) as Record<string, unknown>;
  const a: unknown[] = [r.media_urls || [], r.caption || "", c.caption_fb || "", c.cover_url || "", r.collaborators || [], c.publish_format || "reel", c.channels || [], r.publish_to_pages || []];
  if (Array.isArray(c.media_fb) && c.media_fb.length) a.push(c.media_fb);
  return JSON.stringify(a);
}
function prepStateOf(r: MhQueueRow): { state: "sending" | "ready" | "error" | null; error: string | null } {
  const p = (r.custom as Record<string, unknown> | null)?.prep as { fp?: string; error?: string; ig?: { ready?: boolean } } | undefined;
  if (!p || p.fp !== prepFingerprint(r)) return { state: null, error: null };
  if (p.error) return { state: "error", error: p.error };
  return { state: p.ig && !p.ig.ready ? "sending" : "ready", error: null };
}

function deriveSupabaseStatus(
  ps: string | null,
  scheduleTime: string | null,
  hasUrl: boolean,
  processing = false,
): { effective: EffectiveStatus; failureReason: string | null } {
  const now = Date.now();
  const schedMs = scheduleTime ? new Date(scheduleTime).getTime() : null;
  switch ((ps || "").toLowerCase()) {
    case "published":
      return { effective: "published", failureReason: null };
    case "failed":
      // The row's own failure_reason is what Meta actually said; it is filled in by
      // the caller. This generic line is only the fallback when nothing was recorded.
      return { effective: "failed", failureReason: "Publish failed — no reason was recorded by the worker." };
    case "publishing":
      if (hasUrl) return { effective: "published", failureReason: null };
      if (schedMs && now - schedMs > STUCK_PUBLISHING_MS) {
        return { effective: "failed", failureReason: `Stuck in "Publishing" for ${Math.floor((now - schedMs) / 60000)} min — Meta API likely failed. Check the worker log.` };
      }
      return { effective: "publishing", failureReason: null };
    case "scheduled":
      // A reel Instagram is still processing is handed back as "scheduled" between
      // publisher runs (up to 20 of them) — waiting, not stuck. And a post due while
      // the publisher sleeps (after 23:55 IST) waits for 6:00. Stuck = still here 5
      // min after the run that should have taken it.
      if (processing) return { effective: "scheduled", failureReason: null };
      if (schedMs && schedMs <= now && now - nextPublisherCheck(schedMs) > STUCK_SCHEDULED_MS) {
        return { effective: "failed", failureReason: `Scheduled ${Math.floor((now - schedMs) / 60000)} min ago but never picked up by the publish worker. Check the n8n worker is active.` };
      }
      return { effective: "scheduled", failureReason: null };
    // Saved from Create post, never sent — the Scheduler's Drafts list (27 Oct).
    case "draft":
      return { effective: "draft", failureReason: null };
    default:
      return { effective: "unknown", failureReason: null };
  }
}

export async function fetchScheduledQueueFromSupabase(limit = 100): Promise<ScheduledPost[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data, error } = await sb
    .from("mh_posts")
    .select("id, particulars, sbu, type, caption, media_urls, publish_to, publish_to_page, publish_to_pages, schedule_time, publish_status, instagram_url, facebook_url, youtube_url, published_at, custom, failure_reason, updated_at, collaborators")
    .not("publish_status", "is", null)
    .order("schedule_time", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data as MhQueueRow[] | null) || [];

  // Creatives may live in mh_attachments (uploaded via the detail modal), not only the
  // media_urls column — join them so calendar cards show the REAL creative instead of
  // falling back to a blank/placeholder. kind != 'reference' (those are input briefs).
  const ids = rows.map((r) => r.id);
  const attByPost = new Map<string, string[]>();
  if (ids.length) {
    const { data: atts } = await sb
      .from("mh_attachments")
      .select("post_id, storage_path, kind")
      .in("post_id", ids)
      .not("kind", "in", "(reference,attachment,thumbnail)")   // attachments are working files, never media;
      .order("sort_order", { ascending: true, nullsFirst: false })   // the order set by dragging the tiles, then
      .order("uploaded_at", { ascending: true })   // first uploaded = first slide (22 Oct)
    for (const a of (atts as { post_id: string; storage_path: string | null }[] | null) || []) {
      if (!a.storage_path) continue;
      const arr = attByPost.get(a.post_id) || [];
      arr.push(a.storage_path);
      attByPost.set(a.post_id, arr);
    }
  }

  // How each YouTube Short upload stands (sql/052, /api/cron/youtube-shorts).
  const ytIds = rows.filter((r) => (r.custom as { youtube?: unknown } | null)?.youtube).map((r) => r.id);
  const ytByPost = new Map<string, { status: string; size: number | null; sent: number; error: string | null; video_id: string | null }>();
  if (ytIds.length) {
    const { data: ups } = await sb.from("yt_uploads").select("post_id, status, size, sent, error, video_id").in("post_id", ytIds);
    for (const u of ups || []) ytByPost.set(u.post_id as string, u as never);
  }

  return rows.map((r) => {
    const pages = r.publish_to_pages || [];
    const fullCaption = r.caption || "";
    const hasUrl = !!(r.instagram_url || r.facebook_url);
    const cust = (r.custom && typeof r.custom === "object" ? r.custom : {}) as Record<string, unknown>;
    // Waiting on Instagram to finish a file — either the publisher's own upload or one
    // sent ahead that wasn't ready at the post's time — is processing, not stuck.
    const prepIg = (cust.prep as { ig?: { id?: string; ready?: boolean } } | undefined)?.ig;
    const processing = !!cust.ig_creation_id || !!(prepIg?.id && !prepIg.ready && r.schedule_time && new Date(r.schedule_time).getTime() <= Date.now());
    const derived = deriveSupabaseStatus(r.publish_status, r.schedule_time, hasUrl, processing);
    const effective = derived.effective;
    // Prefer what the worker actually wrote. Overwriting it with "check the worker
    // log" is what made every failure look identical and unactionable.
    const failureReason = (r.failure_reason && String(r.failure_reason).trim()) || derived.failureReason;
    // Prefer the real media_urls; fall back to attachment creatives when that's empty.
    const media = (r.media_urls && r.media_urls.length) ? r.media_urls : (attByPost.get(r.id) || []);
    const cover = typeof cust.cover_url === "string" && cust.cover_url ? cust.cover_url : null;
    return {
      id: r.id,
      particulars: r.particulars || "",
      publishToPage: r.publish_to_page || pages[0] || "",
      primaryInterest: r.sbu || "",
      platform: r.publish_to || "",
      type: r.type || "",
      caption: fullCaption.slice(0, 220),
      fullCaption,
      igCaption: "",
      fbCaption: "",
      // A card thumbnail has to be an IMAGE. media[0] is the mp4 for a reel, and an
      // mp4 in an <img> renders as a broken-image icon — so the chosen cover stands
      // in when there is one.
      thumbnailUrl: (isVideoUrl(media[0]) && cover) ? cover : (media[0] || null),
      coverUrl: cover,
      igMediaId: typeof cust.ig_media_id === "string" ? cust.ig_media_id : null,
      mediaUrls: media,
      scheduleTime: r.schedule_time,
      status: r.publish_status || "",
      effectiveStatus: effective,
      failureReason,
      instagramUrl: r.instagram_url,
      facebookUrl: r.facebook_url,
      publishedAt: r.published_at,
      updatedAt: r.updated_at,
      processingTry: cust.ig_creation_id ? Math.max(1, Number(cust.attempts) || 1) : null,
      format: typeof cust.publish_format === "string" ? cust.publish_format : null,
      storyOf: typeof cust.story_of === "string" ? cust.story_of : null,
      pages,
      channels: Array.isArray(cust.channels) ? (cust.channels as string[]) : [],
      mediaFb: Array.isArray(cust.media_fb) ? (cust.media_fb as string[]) : [],
      collaborators: r.collaborators || [],
      captionFbOverride: typeof cust.caption_fb === "string" ? cust.caption_fb : null,
      youtubeTitle: (cust.youtube as { title?: string } | null)?.title || null,
      youtube: (() => {
        if (!cust.youtube) return null;
        const u = ytByPost.get(r.id);
        return { status: u?.status || "waiting", pct: u?.size ? Math.round((100 * u.sent) / u.size) : 0, error: u?.error || null, url: r.youtube_url || null };
      })(),
      prepState: prepStateOf(r).state,
      prepError: prepStateOf(r).error,
    } as ScheduledPost;
  });
}
