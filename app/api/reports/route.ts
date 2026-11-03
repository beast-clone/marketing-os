import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getSessionIsAdmin } from "@/lib/auth";
import {
  listReports, getReport, listTrash, trashReport, restoreReport, deleteReportPermanent, updateReportText, type ReportPlatform,
} from "@/lib/report-store";
import { safeError } from "@/lib/errors";
import { getSessionUserId } from "@/lib/auth";

// Saved-report archive API.
//   GET  /api/reports?platform=instagram        -> saved reports for one platform
//   GET  /api/reports?platform=..&accountId=..  -> narrowed to one account
//   GET  /api/reports                            -> all saved reports (all platforms)
//   GET  /api/reports?trash=1                    -> reports in the Recycle Bin
//   GET  /api/reports?key=report:..              -> the full stored report payload
//   DELETE /api/reports?key=..                   -> move report to the Recycle Bin (soft)
//   DELETE /api/reports?key=..&permanent=1       -> delete forever (only from the bin)
//   POST /api/reports { action:"restore", key }  -> recover a report from the bin
export async function GET(req: Request) {
  const __denied = await requireSection("analytics");
  if (__denied) return __denied;

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (key) {
      const report = await getReport(key);
      if (!report) return NextResponse.json({ error: "report not found" }, { status: 404 });
      return NextResponse.json({ report });
    }
    if (url.searchParams.get("trash") === "1") {
      return NextResponse.json({ reports: await listTrash() });
    }
    const platform = (url.searchParams.get("platform") || undefined) as ReportPlatform | undefined;
    const accountId = url.searchParams.get("accountId") || undefined;
    const reports = await listReports({ platform, accountId });
    return NextResponse.json({ reports });
  } catch (err) {
    return NextResponse.json(safeError(err, "Failed to load reports"), { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const __denied = await requireSection("analytics");
  if (__denied) return __denied;

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
    const permanent = url.searchParams.get("permanent") === "1";
    // Deleting for good can't be undone, so it's admins only (security audit, 3 Nov 2026).
    if (permanent && !getSessionIsAdmin()) return NextResponse.json({ error: "Only an admin can delete a report for good." }, { status: 403 });
    const ok = permanent ? await deleteReportPermanent(key) : await trashReport(key);
    if (!ok) return NextResponse.json({ error: permanent ? "not in Recycle Bin" : "report not found" }, { status: 404 });
    return NextResponse.json({ ok: true, permanent });
  } catch (err) {
    return NextResponse.json(safeError(err, "Failed to delete report"), { status: 500 });
  }
}

export async function POST(req: Request) {
  const __denied = await requireSection("analytics");
  if (__denied) return __denied;

  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string; key?: string };
    if (body.action !== "restore" || !body.key) return NextResponse.json({ error: "expected { action: 'restore', key }" }, { status: 400 });
    const ok = await restoreReport(body.key);
    if (!ok) return NextResponse.json({ error: "report not found in Recycle Bin" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(safeError(err, "Failed to restore report"), { status: 500 });
  }
}

// PATCH /api/reports { key, edits: { "<dot.path>": "<new text>" } }
//   Correct the wording of a saved report. Only string fields can be changed —
//   updateReportText rejects any path that doesn't already hold text, so the
//   measurements can't be rewritten through here.
export async function PATCH(req: Request) {
  const __denied = await requireSection("analytics");
  if (__denied) return __denied;

  try {
    const body = (await req.json().catch(() => ({}))) as { key?: string; edits?: Record<string, unknown> };
    if (!body.key || !body.edits || typeof body.edits !== "object") {
      return NextResponse.json({ error: "expected { key, edits }" }, { status: 400 });
    }
    const edits: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.edits)) {
      if (typeof v === "string") edits[k] = v.slice(0, 20_000);
    }
    if (!Object.keys(edits).length) return NextResponse.json({ error: "no text to save" }, { status: 400 });

    const actor = getSessionUserId() || "someone";
    const res = await updateReportText(body.key, edits, actor);
    if (!res.ok && !res.applied.length) {
      return NextResponse.json({ error: "Nothing was saved — the report may have been deleted, or those fields aren't text.", rejected: res.rejected }, { status: 404 });
    }
    return NextResponse.json({ ...res, ok: true, editedBy: actor });
  } catch (err) {
    return NextResponse.json(safeError(err, "Failed to save the report"), { status: 500 });
  }
}
