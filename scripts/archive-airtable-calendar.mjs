// Backup of Airtable's Content Calendar into the dashboard's Airtable archive
// (mh_archive, sql/airtable_archive.sql) — Praveen, 3 Nov 2026. Read-only copy for
// safekeeping and yearly counts; it never touches the Master sheet.
//
//   node scripts/archive-airtable-calendar.mjs --dry-run   (counts only, writes nothing)
//   node scripts/archive-airtable-calendar.mjs             (copy rows + files)
//   node scripts/archive-airtable-calendar.mjs 2026-01-01  (a different start date)
//
// A task belongs if its Publishing Date or its created date is on/after the start.
// Safe to run again: rows are matched on the Airtable id, and a file already copied
// is not uploaded twice. Files go to storage because Airtable's links expire.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split("\n")
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const BASE = "appLdJFTrothBLDc0", TABLE = "tblRlOFss2lDKE9EG", BUCKET = "scheduler-media";
const DRY = process.argv.includes("--dry-run");
const START = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || "2026-04-01";

async function airtable() {
  let out = [], offset;
  do {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100${offset ? `&offset=${offset}` : ""}`, { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } });
    if (!r.ok) throw new Error(`Airtable: ${r.status} ${await r.text()}`);
    const d = await r.json();
    out = out.concat(d.records); offset = d.offset;
  } while (offset);
  return out;
}

const safe = (n) => n.replace(/[^\w.\-]+/g, "_").slice(-120);
async function copyFiles(list, recId) {
  const out = [];
  for (const a of list || []) {
    const path = `archive/${recId}/${a.id}-${safe(a.filename || "file")}`;
    const pub = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const head = await fetch(pub, { method: "HEAD" });
    if (!head.ok) {
      const res = await fetch(a.url);
      if (!res.ok) throw new Error(`download ${a.filename}: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const { error } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: a.type || "application/octet-stream", upsert: true });
      if (error) throw new Error(`upload ${a.filename}: ${error.message}`);
    }
    out.push({ url: pub, name: a.filename || "file", mime: a.type || "", size: a.size || 0 });
  }
  return out;
}

const day = (s) => (s ? String(s).slice(0, 10) : null);
const name = (p) => (p && (p.name || p.email)) || null;
// Kept as their own columns; everything else on the record goes into `fields` as it was.
const OWN = ["Particulars", "Type", "Status", "SBU", "Priority", "Owner", "Collaborators", "Created by", "Publishing Date",
  "Due Date", "Completion Time", "Platform(s)", "Content", "Caption", "Additional Info", "Attachments", "Created Date", "Last Modified", "Slack Cache"];

const records = (await airtable()).filter((r) => (r.fields["Publishing Date"] || "") >= START || (r.createdTime || "") >= START);
const fileCount = records.reduce((n, r) => n + (r.fields["Attachments"] || []).length, 0);
console.log(`${records.length} Content Calendar tasks from ${START} · ${fileCount} files${DRY ? " · dry run, nothing written" : ""}`);
if (DRY) process.exit(0);

let done = 0, failed = 0;
for (const r of records) {
  const f = r.fields;
  try {
    const rest = Object.fromEntries(Object.entries(f).filter(([k]) => !OWN.includes(k)));
    const row = {
      airtable_id: r.id,
      title: f["Particulars"]?.trim() || null,
      type: f["Type"] || null, status: f["Status"] || null, sbu: f["SBU"] || null, priority: f["Priority"] || null,
      owner: name(f["Owner"]), collaborators: (f["Collaborators"] || []).map(name).filter(Boolean), created_by: name(f["Created by"]),
      publishing_date: day(f["Publishing Date"]), due_date: day(f["Due Date"]), completion_time: f["Completion Time"] || null,
      platforms: f["Platform(s)"] || [],
      content: f["Content"] || null, caption: f["Caption"] || null, additional_info: f["Additional Info"] || null,
      files: await copyFiles(f["Attachments"], r.id),
      fields: rest,
      created_at: f["Created Date"] || r.createdTime, modified_at: f["Last Modified"] || null,
    };
    const { error } = await sb.from("mh_archive").upsert(row, { onConflict: "airtable_id" });
    if (error) throw new Error(error.message);
    done++;
    if (done % 100 === 0) console.log(`  ${done} / ${records.length}`);
  } catch (e) {
    failed++;
    console.log(`  failed ${r.id} "${f["Particulars"] || ""}": ${e.message}`);
  }
}
console.log(`Done: ${done} archived, ${failed} failed.`);
