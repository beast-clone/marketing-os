import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { getSupabase } from "@/lib/supabase";
import { airtableList, CRM_TABLE, pickName, dateRangeFormula } from "@/lib/sales-hub";
import { pickUser } from "@/lib/lead-assignment";
import { SOURCE, trackKey, getLastRun, setLastRun, type LeadTrack, type StatusEvent } from "@/lib/lead-status-track";
import { safeError } from "@/lib/errors";

// Nightly lead-status snapshot. Airtable overwrites Lead Status in place and hides
// field-revision history, so we record stage changes ourselves: read the leads
// modified since the last run, and for each whose status differs from what we last
// saw, append a status-change event (unseen leads get a baseline, no event). This
// makes "first contacted" + time-to-contact trackable from now on.
//
//   GET /api/cron/lead-status-snapshot            -> since the last run (or 2 days on first run)
//   GET /api/cron/lead-status-snapshot?days=7     -> look back N days (first-run / manual seed)
//
// Auth: header `x-cron-secret: <CRON_SECRET>`. Meant to run once a day.

export const dynamic = "force-dynamic";
const CHUNK = 200;
const MAX = 8000; // runaway guard for one run — a normal night is far fewer

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const t0 = Date.now();

  try {
    const url = new URL(req.url);
    const daysParam = Number(url.searchParams.get("days"));
    const lastRun = await getLastRun(sb);
    // Where to start looking. After the first run, re-scan from a day before the last
    // run (a safety overlap); on the first run, look back a couple of days (or ?days=).
    let sinceDay: string;
    if (lastRun) { const d = new Date(lastRun); d.setUTCDate(d.getUTCDate() - 1); sinceDay = d.toISOString().slice(0, 10); }
    else { const d = new Date(); d.setUTCDate(d.getUTCDate() - (Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 2)); sinceDay = d.toISOString().slice(0, 10); }

    const rows = await airtableList<Record<string, unknown>>(CRM_TABLE, {
      filterByFormula: dateRangeFormula("Actual Last Modified", sinceDay, "2999-12-31"),
      fields: ["Lead Status", "Counsellor", "Actual Last Modified"],
      pageSize: 100, maxRecords: MAX,
    });

    const now = new Date().toISOString();
    let changed = 0, seeded = 0, unchanged = 0;

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const keys = chunk.map((r) => trackKey(r.id));
      const { data: existingRows } = await sb.from("discover_cache").select("cache_key,payload").in("cache_key", keys);
      const existing = new Map<string, LeadTrack>();
      for (const e of existingRows || []) existing.set(e.cache_key as string, e.payload as LeadTrack);

      const upserts: { cache_key: string; source: string; last_fetched: string; payload: LeadTrack }[] = [];
      for (const r of chunk) {
        const status = pickName(r.fields["Lead Status"]);
        const counsellor = pickUser(r.fields["Counsellor"])?.name || "";
        const at = pickName(r.fields["Actual Last Modified"]) || now;
        const prev = existing.get(trackKey(r.id));
        if (!prev) {
          upserts.push({ cache_key: trackKey(r.id), source: SOURCE, last_fetched: now, payload: { last: status, counsellor, events: [], updatedAt: now } });
          seeded++;
        } else if (prev.last !== status) {
          const events: StatusEvent[] = [...(prev.events || []), { at, from: prev.last, to: status }].slice(-50);
          upserts.push({ cache_key: trackKey(r.id), source: SOURCE, last_fetched: now, payload: { last: status, counsellor, events, updatedAt: now } });
          changed++;
        } else { unchanged++; }
      }
      if (upserts.length) await sb.from("discover_cache").upsert(upserts, { onConflict: "cache_key" });
    }

    await setLastRun(sb, now);
    return NextResponse.json({ ok: true, sinceDay, scanned: rows.length, changed, seeded, unchanged, capped: rows.length >= MAX, latencyMs: Date.now() - t0 });
  } catch (err) {
    return NextResponse.json(safeError(err, "Something went wrong"), { status: 502 });
  }
}
