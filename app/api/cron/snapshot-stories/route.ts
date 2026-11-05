import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { getConfiguredAccounts, type IGAccountConfig, graphFor } from "@/lib/instagram";
import { getSupabase } from "@/lib/supabase";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { safeError } from "@/lib/errors";
import { warmBrandAccounts } from "@/lib/brand-accounts";

// Hourly cron. For every account, fetch currently-live stories + insights, download the
// (soon-to-expire) image bytes from Meta's CDN, upload to the story-snapshots bucket in
// Supabase Storage, and upsert a row in the `story_snapshots` table. Analytics get
// refreshed on every run, so the very last hour before expiry captures the near-final
// numbers. After 24h Meta drops the story from /stories, but the Supabase row survives
// forever — usable for monthly reports.
//
//   GET /api/cron/snapshot-stories
//   Header: x-cron-secret: <CRON_SECRET>

const GRAPH = "https://graph.facebook.com/v25.0";
const BUCKET = "story-snapshots";

type IGStoryRaw = {
  id: string;
  caption?: string;
  media_type?: "IMAGE" | "VIDEO";
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp: string;
};

type InsightsResp = { data?: Array<{ name: string; values?: Array<{ value: number }> }> };

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await warmBrandAccounts();   // include brands connected on the Brands page

  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  // Bucket is idempotent — safe to call every run.
  try { await db.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 25 * 1024 * 1024 }); } catch { /* exists */ }

  const t0 = Date.now();
  const accounts = getConfiguredAccounts();
  const summary: Array<{ account: string; storiesFound: number; snapshotsWritten: number; imagesUploaded: number; error?: string }> = [];

  for (const acct of accounts) {
    const s = { account: acct.id, storiesFound: 0, snapshotsWritten: 0, imagesUploaded: 0 };
    try {
      const stories = await fetchStories(acct);
      s.storiesFound = stories.length;
      for (const story of stories) {
        const written = await snapshotOne(db, acct, story);
        s.snapshotsWritten += written.rows;
        s.imagesUploaded += written.uploaded;
      }
      summary.push(s);
    } catch (err) {
      summary.push({ ...s, error: (err as Error).message });
    }
  }

  return NextResponse.json({ ok: true, tookMs: Date.now() - t0, summary });
}

async function fetchStories(acct: IGAccountConfig): Promise<IGStoryRaw[]> {
  const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";
  const url = `${graphFor(acct.pageAccessToken)}/${acct.igUserId}/stories?fields=${fields}&access_token=${acct.pageAccessToken}`;
  const r = await fetchWithTimeout(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Meta stories ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { data?: IGStoryRaw[] };
  return j.data ?? [];
}

async function fetchInsights(acct: IGAccountConfig, storyId: string) {
  const metrics = "reach,replies,views,follows,profile_visits,navigation";
  const url = `${graphFor(acct.pageAccessToken)}/${storyId}/insights?metric=${metrics}&access_token=${acct.pageAccessToken}`;
  const r = await fetchWithTimeout(url, { cache: "no-store" });
  const out = { reach: 0, replies: 0, views: 0, follows: 0, profile_visits: 0, navigation: 0 };
  if (!r.ok) return out;
  const j = (await r.json()) as InsightsResp;
  for (const ins of j.data ?? []) {
    const v = ins.values?.[0]?.value;
    if (typeof v !== "number") continue;
    if (ins.name in out) (out as unknown as Record<string, number>)[ins.name] = v;
  }
  return out;
}

// Snapshot one story: upload image if not already stored, then upsert the row with the
// latest analytics.  Rows only written when the analytics call succeeds — otherwise a
// half-empty row would poison later runs.
async function snapshotOne(
  db: ReturnType<typeof getSupabase>,
  acct: IGAccountConfig,
  story: IGStoryRaw,
): Promise<{ rows: number; uploaded: number }> {
  if (!db) return { rows: 0, uploaded: 0 };

  const insights = await fetchInsights(acct, story.id);
  const path = `${acct.id}/${story.id}${story.media_type === "VIDEO" ? ".jpg" : ".jpg"}`;

  // Check if we've already stored the image (avoid re-downloading Meta's CDN bytes hourly).
  const { data: existing } = await db.storage.from(BUCKET).list(acct.id, { search: story.id, limit: 1 });
  let storedImageUrl: string | null = null;
  let uploaded = 0;
  if (existing && existing.length > 0) {
    storedImageUrl = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } else {
    // Download from Meta's signed CDN URL (thumbnail for videos, media_url for images)
    const cdnUrl = story.thumbnail_url || story.media_url;
    if (cdnUrl) {
      try {
        const imgResp = await fetchWithTimeout(cdnUrl, { cache: "no-store" });
        if (imgResp.ok) {
          const buf = Buffer.from(await imgResp.arrayBuffer());
          const contentType = imgResp.headers.get("content-type") || "image/jpeg";
          const { error: upErr } = await db.storage.from(BUCKET).upload(path, buf, { contentType, upsert: true });
          if (!upErr) {
            storedImageUrl = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
            uploaded = 1;
          }
        }
      } catch { /* store row without image — try next run */ }
    }
  }

  const row = {
    account_id: acct.id,
    story_id: story.id,
    caption: story.caption ?? "",
    media_type: story.media_type ?? "IMAGE",
    permalink: story.permalink ?? "",
    posted_at: story.timestamp,
    stored_image_url: storedImageUrl,
    original_media_url: story.media_url ?? story.thumbnail_url ?? "",
    reach: insights.reach,
    views: insights.views,
    replies: insights.replies,
    follows: insights.follows,
    profile_visits: insights.profile_visits,
    navigation: insights.navigation,
    captured_at: new Date().toISOString(),
  };

  const { error } = await db.from("story_snapshots").upsert(row, { onConflict: "story_id" });
  if (error) throw new Error(`upsert ${story.id}: ${error.message}`);
  return { rows: 1, uploaded };
}
