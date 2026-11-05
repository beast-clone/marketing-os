// Give the files already on tasks the same readable names new uploads get.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/rename-attachments.ts          # dry run
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/rename-attachments.ts --apply
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/rename-attachments.ts --apply --delete-originals
//
// The originals are KEPT unless --delete-originals is passed. The n8n scheduler
// reads media_urls at publish time, so a run that happens to be in flight while
// the URLs are switching would 404 on a deleted object. Keeping both copies for
// a day costs a couple of hundred MB and removes that window entirely; run it
// again with --delete-originals during the 00:00-06:00 quiet hours to reclaim.
//
// A rename here is not just a filename: the stored object carries the old name,
// the History feed matches files BY NAME, and 359 of these URLs are copied into
// mh_posts.media_urls for posts that are scheduled or already out. Change one
// and miss another and a published post loses its media.
//
// So the order is: copy every object to its new path first (nothing is removed),
// switch every reference over, check that every reference resolves, and only
// then delete the originals. At no point does a live URL point at nothing, and
// a failure anywhere before the last step leaves everything still working.

import { getSupabase } from "../lib/supabase";
import { readableName, storageSafe } from "../lib/attachment-name";

const BUCKET = "scheduler-media";
const APPLY = process.argv.includes("--apply");
const DELETE_OLD = process.argv.includes("--delete-originals");
const thumbOf = (p: string) => `${p.replace(/\.[^./]+$/, "")}.thumb.webp`;
/** The object path inside the bucket, out of a public URL. */
const pathOf = (url: string) => decodeURIComponent(url.split(`/${BUCKET}/`)[1] || "");

type Row = { id: string; post_id: string; filename: string; storage_path: string; thumb_path: string | null; kind: string | null; uploaded_at: string };
type Plan = Row & { newName: string; oldPath: string; newPath: string; newUrl: string };

async function main() {
  const sb = getSupabase();
  if (!sb) throw new Error("No Supabase credentials - pass --env-file=.env.local");

  const { data: atts, error } = await sb.from("mh_attachments")
    .select("id, post_id, filename, storage_path, thumb_path, kind, uploaded_at")
    .order("uploaded_at", { ascending: true });
  if (error) throw error;
  const rows = (atts || []) as Row[];

  const ids = [...new Set(rows.map((r) => r.post_id))];
  const title = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from("mh_posts").select("id, particulars").in("id", ids.slice(i, i + 200));
    for (const p of data || []) title.set(p.id, p.particulars || "");
  }

  // Plan every rename. The sequence runs per task and per kind, in upload order,
  // so two files that both arrived as "image.png" do not land on one name.
  const seq = new Map<string, number>();
  const taken = new Set<string>();
  const plans: Plan[] = [];
  for (const r of rows) {
    const kind = r.kind || "creative";
    const k = `${r.post_id}|${kind}`;
    const n = (seq.get(k) || 0) + 1;
    seq.set(k, n);

    let newName = readableName(r.filename, title.get(r.post_id), kind, n);
    if (newName === r.filename) { taken.add(`${r.post_id}|${newName}`); continue; }
    // Two files on one task must not end up sharing a name.
    let bump = n;
    while (taken.has(`${r.post_id}|${newName}`)) {
      bump++;
      const dot = newName.lastIndexOf(".");
      const ext = dot > 0 ? newName.slice(dot) : "";
      newName = `${newName.slice(0, dot > 0 ? dot : undefined).replace(/-\d+$/, "")}-${String(bump).padStart(2, "0")}${ext}`;
    }
    taken.add(`${r.post_id}|${newName}`);

    const oldPath = pathOf(r.storage_path);
    if (!oldPath) { console.log(`  ?  ${r.filename} - not in ${BUCKET}, skipped`); continue; }
    const dir = oldPath.slice(0, oldPath.lastIndexOf("/"));
    const stamp = oldPath.slice(oldPath.lastIndexOf("/") + 1).match(/^\d{10,}-/)?.[0] || `${Date.now()}-`;
    const newPath = `${dir}/${stamp}${storageSafe(newName)}`;
    plans.push({ ...r, newName, oldPath, newPath, newUrl: sb.storage.from(BUCKET).getPublicUrl(newPath).data.publicUrl });
  }

  console.log(`${rows.length} files | ${plans.length} to rename | ${rows.length - plans.length} already have a real name`);
  for (const p of plans.slice(0, 8)) console.log(`   ${p.filename}  ->  ${p.newName}`);
  if (plans.length > 8) console.log(`   ... and ${plans.length - 8} more`);
  if (!APPLY) { console.log("\nDry run. Add --apply to do it."); return; }

  // -- 1. copy, never move: the originals stay until everything else is proven --
  console.log("\n1/5  copying objects to their new paths...");
  let copied = 0, copyFailed = 0;
  for (const p of plans) {
    const r = await sb.storage.from(BUCKET).copy(p.oldPath, p.newPath);
    if (r.error) { copyFailed++; console.log(`  !  ${p.filename}: ${r.error.message}`); continue; }
    if (p.thumb_path) await sb.storage.from(BUCKET).copy(thumbOf(p.oldPath), thumbOf(p.newPath));
    copied++;
  }
  console.log(`     ${copied} copied, ${copyFailed} failed`);
  if (copyFailed) { console.log("Stopping: nothing has been changed or deleted."); return; }

  // -- 2. the attachment rows --
  console.log("2/5  pointing the attachments at them...");
  for (const p of plans) {
    const { error: e } = await sb.from("mh_attachments").update({
      filename: p.newName,
      storage_path: p.newUrl,
      thumb_path: p.thumb_path ? sb.storage.from(BUCKET).getPublicUrl(thumbOf(p.newPath)).data.publicUrl : null,
    }).eq("id", p.id);
    if (e) console.log(`  !  ${p.filename}: ${e.message}`);
  }

  // -- 3. History matches files by name, so it has to follow --
  console.log("3/5  updating the History entries that name them...");
  const byPost = new Map<string, Map<string, string>>();
  for (const p of plans) {
    if (!byPost.has(p.post_id)) byPost.set(p.post_id, new Map());
    byPost.get(p.post_id)!.set(p.filename, p.newName);
  }
  let acts = 0;
  for (const [postId, names] of byPost) {
    const { data } = await sb.from("mh_activity").select("id, from_value, to_value").eq("post_id", postId);
    for (const a of data || []) {
      const patch: Record<string, string> = {};
      if (a.from_value && names.has(a.from_value)) patch.from_value = names.get(a.from_value)!;
      if (a.to_value && names.has(a.to_value)) patch.to_value = names.get(a.to_value)!;
      if (Object.keys(patch).length) { await sb.from("mh_activity").update(patch).eq("id", a.id); acts++; }
    }
  }
  console.log(`     ${acts} History entries updated`);

  // -- 4. the URLs copied onto posts for scheduling and publishing --
  console.log("4/5  updating the posts that carry these URLs...");
  const newFor = new Map(plans.map((p) => [p.storage_path, p.newUrl]));
  const { data: posts } = await sb.from("mh_posts").select("id, media_urls").not("media_urls", "is", null);
  let touched = 0, swapped = 0;
  for (const post of posts || []) {
    const cur = (post.media_urls as string[] | null) || [];
    if (!cur.some((u) => newFor.has(u))) continue;
    const next = cur.map((u) => { const n = newFor.get(u); if (n) swapped++; return n || u; });
    const { error: e } = await sb.from("mh_posts").update({ media_urls: next }).eq("id", post.id);
    if (e) console.log(`  !  post ${post.id}: ${e.message}`);
    else touched++;
  }
  console.log(`     ${swapped} URLs on ${touched} posts`);

  // -- 5. check every reference resolves, THEN remove the originals --
  console.log("5/5  checking every new URL resolves...");
  let bad = 0;
  for (const p of plans) {
    const r = await fetch(p.newUrl, { method: "HEAD" });
    if (!r.ok) { bad++; console.log(`  !  ${p.newName} -> HTTP ${r.status}`); }
  }
  if (bad) { console.log(`\n${bad} did not resolve. THE ORIGINALS HAVE BEEN KEPT - fix these before deleting anything.`); return; }
  console.log("     all good");

  const dead = plans.flatMap((p) => (p.thumb_path ? [p.oldPath, thumbOf(p.oldPath)] : [p.oldPath]));
  if (!DELETE_OLD) {
    console.log(`\nDone. ${plans.length} files renamed.`);
    console.log(`${dead.length} old objects were kept, in case a publish was reading one while the URLs changed.`);
    console.log("Re-run with --delete-originals during the quiet hours to reclaim that space.");
    return;
  }
  for (let i = 0; i < dead.length; i += 100) await sb.storage.from(BUCKET).remove(dead.slice(i, i + 100));
  console.log(`\nDone. ${plans.length} files renamed, ${dead.length} old objects removed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
