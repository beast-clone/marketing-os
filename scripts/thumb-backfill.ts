// Make thumbnails for images uploaded before thumbnails existed.
//
// New uploads get one automatically (lib/thumbnail.ts, called from the two
// attach routes). This is for the back catalogue: it walks the images that have
// no thumb_path yet, biggest first, so the worst offenders are fixed in the
// first run even if it is stopped early.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/thumb-backfill.ts [limit]
//
// Safe to re-run and safe to interrupt: each row is recorded as it is done, and
// a row that already has a thumbnail is skipped.

import { getSupabase } from "../lib/supabase";
import { storeThumb } from "../lib/thumbnail";

const BUCKET = "scheduler-media";
const kb = (n: number) => `${Math.round(n / 1024)} KB`;

async function main() {
  const limit = Number(process.argv[2] || 50);
  const sb = getSupabase();
  if (!sb) throw new Error("No Supabase credentials — run this with --env-file=.env.local");

  const { data: rows, error } = await sb.from("mh_attachments")
    .select("id, filename, storage_path, mime_type, size_bytes")
    .is("thumb_path", null).like("mime_type", "image/%")
    .order("size_bytes", { ascending: false, nullsFirst: false }).limit(limit);
  if (error) throw error;
  if (!rows?.length) { console.log("Every image already has a thumbnail."); return; }

  console.log(`${rows.length} image${rows.length === 1 ? "" : "s"} to do, biggest first.\n`);
  let made = 0, skipped = 0, failed = 0, before = 0, after = 0;

  for (const a of rows) {
    // The public URL is .../object/public/<bucket>/<path>, and the path is encoded.
    const objectPath = decodeURIComponent(a.storage_path.split(`/${BUCKET}/`)[1] || "");
    if (!objectPath) { failed++; console.log(`  ?  ${a.filename} — not in ${BUCKET}`); continue; }

    const url = await storeThumb(sb as never, BUCKET, objectPath, a.mime_type || "");
    if (!url) { skipped++; console.log(`  –  ${a.filename} — already small enough`); continue; }

    const { error: upErr } = await sb.from("mh_attachments").update({ thumb_path: url }).eq("id", a.id);
    if (upErr) { failed++; console.log(`  !  ${a.filename} — ${upErr.message}`); continue; }

    // Read the size back rather than trusting the encoder, so the numbers below
    // are what the browser will actually download.
    const size = Number((await fetch(url, { method: "HEAD" })).headers.get("content-length") || 0);
    made++; before += a.size_bytes || 0; after += size;
    console.log(`  ✓  ${a.filename} — ${kb(a.size_bytes || 0)} → ${kb(size)}`);
  }

  console.log(`\n${made} made, ${skipped} already small, ${failed} failed.`);
  if (made) console.log(`Tiles now load ${kb(after)} instead of ${kb(before)} — ${Math.round((1 - after / before) * 100)}% less.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
