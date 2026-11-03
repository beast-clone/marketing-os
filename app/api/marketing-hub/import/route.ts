import { NextResponse } from "next/server";
import { requireSection, requireCapability } from "@/lib/api-guard";
import { importFromAirtable, IMPORT_FILTER_KEYS, isNetworkError, LOST_CONNECTION, type ImportFilters } from "@/lib/airtable-import";
import { safeError } from "@/lib/errors";

// Pull a window of Airtable's Content Calendar into the master sheet.
//
//   POST { from?, to?, dryRun?, facetsOnly?, filters? } — reads the Airtable view IMPORT_VIEW
//     → { inRange, facets, scanned, created, updated, skipped, errors }
//   filters: { owner?, collaborators?, type?, status?, sbu? } — arrays of Airtable values.
//
// Manual, one way, and idempotent on Airtable's record id — press it twice and the
// second press updates rather than duplicates.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const denied = await requireSection("content");
  if (denied) return denied;
  // The section alone let anyone with Content past the Edit / Change dates switches (security audit, 3 Nov 2026).
  { const __noCap = await requireCapability("create_tasks"); if (__noCap) return __noCap; }
  { const __noCap = await requireCapability("edit_tasks"); if (__noCap) return __noCap; }

  try {
    const b = (await req.json().catch(() => ({}))) as { from?: string; to?: string; dryRun?: boolean; facetsOnly?: boolean; filters?: Record<string, unknown> };
    const from = (b.from || "").trim();
    const to = (b.to || "").trim();
    // Dates are optional: the Airtable view decides what's in scope; dates only narrow it.
    if ((from && !DATE.test(from)) || (to && !DATE.test(to))) {
      return NextResponse.json({ error: "Those dates aren't valid." }, { status: 400 });
    }
    if (from && to && from > to) {
      return NextResponse.json({ error: "The start date is after the end date." }, { status: 400 });
    }
    // A whole year in one press is a long request and a lot of writes; the button
    // offers months, and this is the backstop for a hand-typed range.
    const days = from && to ? (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 : 0;
    if (days > 400) {
      return NextResponse.json({ error: "That range is over a year. Import it a few months at a time." }, { status: 400 });
    }

    const filters: ImportFilters = {};
    for (const k of IMPORT_FILTER_KEYS) {
      const v = b.filters?.[k];
      if (Array.isArray(v)) filters[k] = v.filter((x): x is string => typeof x === "string");
    }
    // Newest change wins, like the hourly sync — the button used to overwrite the team's edits.
    const result = await importFromAirtable({ from, to, dryRun: Boolean(b.dryRun), facetsOnly: Boolean(b.facetsOnly), filters, newestWins: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Per-record failures are caught inside the loop, so an error reaching here came
    // before any write — "nothing was imported" is true.
    if (isNetworkError(err)) { console.error("[import] network", err); return NextResponse.json({ error: LOST_CONNECTION }, { status: 502 }); }
    return NextResponse.json(safeError(err, "Couldn't import from Airtable"), { status: 502 });
  }
}
