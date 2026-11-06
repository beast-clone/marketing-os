import { getSupabase } from "@/lib/supabase";
import { bustMarketingHubCache } from "@/lib/mh-cache";

// Write a published post's live URL back onto its mh_posts row — the single seam
// every publisher (the app-direct IG route, or n8n after it publishes to
// FB/LinkedIn) calls once a post goes live. Fills the right platform column,
// stamps published_at, logs the change to the activity feed (actor=null → shows
// as "System"/automation), and busts the read cache so the Published Links
// section + My Day reflect it immediately, everywhere the post appears.

export type LinkPlatform = "instagram" | "facebook" | "linkedin" | "youtube";

const COLUMN: Record<LinkPlatform, string> = {
  instagram: "instagram_url",
  facebook: "facebook_url",
  linkedin: "linkedin_url",
  youtube: "youtube_url",
};
const ACTION: Record<LinkPlatform, string> = {
  instagram: "instagram_url_changed",
  facebook: "facebook_url_changed",
  linkedin: "linkedin_url_changed",
  youtube: "youtube_url_changed",
};

// Resolve a post by mh_posts.id or airtable_record_id (n8n knows the Airtable id).
async function resolvePostId(
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  ref: { postId?: string; airtableRecordId?: string },
): Promise<string | null> {
  if (ref.postId) return ref.postId;
  if (ref.airtableRecordId) {
    const { data } = await sb.from("mh_posts").select("id").eq("airtable_record_id", ref.airtableRecordId).limit(1).maybeSingle();
    return data?.id || null;
  }
  return null;
}

export async function writeBackLink(args: {
  postId?: string;
  airtableRecordId?: string;
  platform: LinkPlatform;
  url: string;
  /** Who filled it in. Omitted for automation, which the feed renders as "System". */
  actor?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase not configured" };
  if (!args.url || !args.url.trim()) return { ok: false, error: "url is required" };

  const id = await resolvePostId(sb, args);
  if (!id) return { ok: false, error: "post not found (need a valid postId or airtableRecordId)" };

  const col = COLUMN[args.platform];
  const before = await sb.from("mh_posts").select(`${col}, published_at`).eq("id", id).maybeSingle();
  const prev = (before.data as Record<string, unknown> | null)?.[col] as string | null | undefined;

  const patch: Record<string, unknown> = { [col]: args.url };
  if (!(before.data as { published_at?: string | null } | null)?.published_at) patch.published_at = new Date().toISOString();

  const { error } = await sb.from("mh_posts").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };

  // Only log when the link actually changed (idempotent re-publishes stay quiet).
  if ((prev || null) !== args.url) {
    await sb.from("mh_activity").insert({
      post_id: id,
      actor_key: args.actor || null, // no actor → automation → "System" in the feed
      action: ACTION[args.platform],
      from_value: prev || null,
      to_value: args.url,
    });
  }

  bustMarketingHubCache();
  return { ok: true, id };
}

// A post scheduled to several pages gets one extra mh_posts row per extra page
// (schedule-multi), and each publishes — and gets its links — on its own row. Copy
// those links onto the task they came from, so the task shows every live link
// (Praveen, 22 Oct: "the links should be added to that task also"). Runs with the
// 15-minute watchers cron; only looks at the last 3 days.
export async function syncCloneLinks(): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const since = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
  const { data: clones } = await sb.from("mh_posts")
    .select("id, custom, instagram_url, facebook_url, linkedin_url")
    .not("custom->>source_task_id", "is", null).gte("published_at", since).limit(100);
  let n = 0;
  for (const c of (clones || []) as { id: string; custom: { source_task_id?: string } | null; instagram_url: string | null; facebook_url: string | null; linkedin_url: string | null }[]) {
    const taskId = c.custom?.source_task_id;
    if (!taskId || taskId === c.id) continue;
    const { data: task } = await sb.from("mh_posts").select("instagram_url, facebook_url, linkedin_url").eq("id", taskId).maybeSingle();
    if (!task) continue;
    for (const platform of ["instagram", "facebook", "linkedin"] as LinkPlatform[]) {
      const col = COLUMN[platform] as "instagram_url" | "facebook_url" | "linkedin_url";
      const mine = (c[col] || "").split(/\s*,\s*/).filter(Boolean);
      if (!mine.length) continue;
      const theirs = ((task as Record<string, string | null>)[col] || "").split(/\s*,\s*/).filter(Boolean);
      const merged = [...theirs, ...mine.filter((u) => !theirs.includes(u))];
      if (merged.length === theirs.length) continue;
      const res = await writeBackLink({ postId: taskId, platform, url: merged.join(" , ") });
      if (res.ok) n++;
    }
  }
  return n;
}
