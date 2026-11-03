import { NextResponse } from "next/server";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { getSessionUserId } from "@/lib/auth";
import { rosterById } from "@/lib/team-db";
import { canSeeTab } from "@/lib/permissions";

// Airtable Backup (sql/airtable_archive.sql) — read-only. There is no write here:
// the rows are a backup, filled by scripts/archive-airtable-calendar.mjs.
//   GET          → { rows }  every task, list columns only
//   GET ?id=rec… → { row }   one task in full (content, caption, files, other fields)
export const dynamic = "force-dynamic";
const LIST = "airtable_id, title, type, status, sbu, owner, publishing_date, created_at, files";

export async function GET(req: Request) {
  const me = await rosterById(getSessionUserId());
  if (!canSeeTab(me, "archive")) return NextResponse.json({ error: "Your access doesn't include the Airtable Backup — ask an admin to switch it on in Team & access." }, { status: 403 });
  const sb = getSupabase(); if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const { data, error } = await sb.from("mh_archive").select("*").eq("airtable_id", id).maybeSingle();
      if (error) throw error;
      return data ? NextResponse.json({ row: data }) : NextResponse.json({ error: "Not in the backup" }, { status: 404 });
    }
    // PostgREST caps a select at 1000 rows, so page through.
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("mh_archive").select(LIST)
        .order("publishing_date", { ascending: false, nullsFirst: false }).order("airtable_id").range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []).map((r) => ({ ...r, files: Array.isArray(r.files) ? r.files.length : 0 })));
      if (!data || data.length < 1000) break;
    }
    return NextResponse.json({ rows });
  } catch (err) { return NextResponse.json(safeError(err, "Couldn't load the backup"), { status: 502 }); }
}
