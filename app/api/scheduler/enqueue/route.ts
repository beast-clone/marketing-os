import { NextResponse } from "next/server";
import { requireSection, requireSchedulerPages } from "@/lib/api-guard";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";
import { getSessionUserId } from "@/lib/auth";
import { enqueuePost, type EnqueueBody } from "@/lib/scheduler-enqueue";

// POST /api/scheduler/enqueue — puts a post into the publish queue. The work lives in
// lib/scheduler-enqueue (shared with the Claude connector); this checks who's asking
// and which pages they may schedule to.
export async function POST(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const b = (await req.json()) as EnqueueBody;
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    const pages = (b.pages && b.pages.length ? b.pages : (b.publishToPage ? [b.publishToPage] : [])).filter(Boolean);
    const __pages = await requireSchedulerPages(pages);
    if (__pages) return __pages;
    const res = await enqueuePost(sb, b, (getSessionUserId() || "scheduler").toLowerCase());
    if ("error" in res) return NextResponse.json({ error: res.error, ...(res.status === 409 ? { publishing: true } : {}) }, { status: res.status });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(safeError(err, "Enqueue failed"), { status: 502 });
  }
}
