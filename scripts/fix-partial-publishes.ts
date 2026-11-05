// Posts that reached Instagram but were recorded as failed.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/fix-partial-publishes.ts [--apply]
//
// The IG/FB publisher posts to Instagram, then to Facebook, and marks the whole
// row failed if EITHER leg fails. Samvaya's Facebook page token has no
// pages_manage_posts, so its Facebook leg always 403s - and every Samvaya post
// since 4 Nov has been recorded as failed despite being live on Instagram.
//
// A row is only corrected when Instagram actually returned a media id, which is
// proof that leg succeeded. The Facebook failure is kept in the row so the real
// problem stays visible rather than being tidied away.

import { getSupabase } from "../lib/supabase";

const APPLY = process.argv.includes("--apply");

async function main() {
  const sb = getSupabase()!;
  const { data, error } = await sb.from("mh_posts")
    .select("id, particulars, publish_status, failure_reason, instagram_url, published_at, custom")
    .not("failure_reason", "is", null);
  if (error) throw error;

  const hit = (data || []).filter((p) => {
    const c = (p.custom || {}) as Record<string, unknown>;
    return !!c.ig_media_id && p.publish_status === "failed";
  });

  console.log(`${(data || []).length} rows carry a failure | ${hit.length} of them DID reach Instagram\n`);
  for (const p of hit) {
    const c = p.custom as Record<string, unknown>;
    console.log(`  ${p.particulars.slice(0, 54)}`);
    console.log(`      ig media ${c.ig_media_id}  ->  ${p.instagram_url || c.ig_url_done}`);
  }
  if (!APPLY) { console.log("\nDry run. Add --apply to correct them."); return; }

  let done = 0;
  for (const p of hit) {
    const c = p.custom as Record<string, unknown>;
    const { error: e } = await sb.from("mh_posts").update({
      publish_status: "published",
      published_at: p.published_at || (c.ig_ready_at as string) || new Date().toISOString(),
      instagram_url: p.instagram_url || (c.ig_url_done as string) || null,
      // Kept, not cleared: Facebook really did fail and that still needs fixing.
      failure_reason: `Instagram published. Facebook did not: ${p.failure_reason}`,
    }).eq("id", p.id);
    if (e) { console.log(`  ! ${p.particulars}: ${e.message}`); continue; }
    await sb.from("mh_activity").insert({
      post_id: p.id, actor_key: null, action: "published",
      to_value: (p.instagram_url || c.ig_url_done || "") as string,
    });
    done++;
  }
  console.log(`\n${done} rows corrected - they now read as published on Instagram, with the Facebook failure still recorded.`);
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
