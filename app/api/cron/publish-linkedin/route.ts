import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";
import { publishToPages, uploadMedia, orgUrnFor, type PreparedMedia } from "@/lib/linkedin-publish";
import { linkedinToken } from "@/lib/linkedin";
import { ensureFreshLinkedInToken } from "@/lib/linkedin-refresh";

// Cron worker — publishes due LinkedIn scheduled posts. Fully separate from the Meta
// (n8n) pipeline. Trigger this on a schedule from your existing cron pinger / n8n:
//   POST (or GET) /api/cron/publish-linkedin   with header  x-cron-secret: <CRON_SECRET>
// Runs every few minutes; publishes rows whose schedule_time has passed.
export const dynamic = "force-dynamic";

async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  // Renew the LinkedIn token before publishing anything. This tick runs every few
  // minutes anyway, which makes it the natural place to keep the 2-month token
  // alive — it is a no-op until the token is inside its renewal window. Never let
  // a renewal problem stop the publish attempt; the publish reports its own error.
  const tokenState = await ensureFreshLinkedInToken().catch((e) => ({ ok: false as const, error: (e as Error).message }));

  // Reap anything stranded mid-publish before looking for new work.
  //
  // The try/catch below stops this happening from an ordinary error, but a
  // process killed between the claim and the status write — a serverless
  // timeout, an instance recycled — still leaves a row claimed forever, and
  // nothing else ever looks at it again.
  //
  // Stranded rows go to 'failed', NOT back to 'scheduled'. There is no way to
  // tell from here whether the post reached LinkedIn before the process died,
  // and a wrong retry puts a duplicate on a public company page. A false
  // failure costs someone re-scheduling it; a false retry is visible to every
  // follower. The error text says exactly that, so whoever looks knows to
  // check the page before resending.
  const STRANDED_AFTER_MS = 15 * 60_000;
  const strandedBefore = new Date(Date.now() - STRANDED_AFTER_MS).toISOString();
  const { data: reaped } = await sb
    .from("linkedin_scheduled_posts")
    .update({ status: "failed", error: "Stranded mid-publish — the run did not finish. Check the LinkedIn page before rescheduling: it may already be live." })
    .eq("status", "publishing").lt("schedule_time", strandedBefore)
    .select("id");

  const nowIso = new Date().toISOString();
  // Send ahead — AFTER the due posts, so uploading tomorrow's PDF can never make a
  // post that is due now late (or strand it if the run is cut short).
  const prepareSoon = async (): Promise<number> => {
    // Send ahead: upload the image / PDF of posts due in the next 30 minutes, so at the
    // time only the post itself is created (22 Oct: "if it is going at 5:30, it should
    // go at 5:30"). Best effort — anything not uploaded here is uploaded at the time.
    const soonIso = new Date(Date.now() + 30 * 60_000).toISOString();
    const { data: soon } = await sb.from("linkedin_scheduled_posts")
      .select("id, pages, image_url, prepared")
      .eq("status", "scheduled").gt("schedule_time", nowIso).lte("schedule_time", soonIso)
      .not("image_url", "is", null).limit(10);
    let preparedCount = 0;
    if (soon?.length) {
      const token = await linkedinToken().catch(() => null);
      for (const row of token ? soon : []) {
        const prepared: PreparedMedia = { ...((row.prepared as PreparedMedia) || {}) };
        let changed = false;
        for (const page of (row.pages as string[]) || []) {
          const org = orgUrnFor(page);
          if (!org || prepared[page]?.src === row.image_url) continue;
          try { prepared[page] = { src: row.image_url as string, urn: await uploadMedia(token!, org, row.image_url as string) }; changed = true; preparedCount++; }
          catch { /* uploaded at the time instead */ }
        }
        if (changed) await sb.from("linkedin_scheduled_posts").update({ prepared }).eq("id", row.id).eq("status", "scheduled");
      }
    }

    return preparedCount;
  };
  // Due = scheduled and time has passed. Bounded batch so a tick can't run away.
  const { data: due, error } = await sb
    .from("linkedin_scheduled_posts")
    .select("id, pages, body, image_url, prepared")
    .eq("status", "scheduled")
    .lte("schedule_time", nowIso)
    .order("schedule_time", { ascending: true })
    .limit(10);
  if (error) return NextResponse.json(safeError(new Error(error.message), "query failed"), { status: 502 });
  const reapedCount = (reaped || []).length;
  if (!due || due.length === 0) return NextResponse.json({ ok: true, published: 0, processed: 0, prepared: await prepareSoon(), reaped: reapedCount, token: tokenState });

  let published = 0;
  const outcomes: { id: string; status: string }[] = [];
  for (const row of due) {
    // Claim the row so overlapping ticks can't double-publish (only proceed if we flip
    // it from 'scheduled' to 'publishing').
    const { data: claimed } = await sb
      .from("linkedin_scheduled_posts")
      .update({ status: "publishing" })
      .eq("id", row.id).eq("status", "scheduled")
      .select("id").maybeSingle();
    if (!claimed) { outcomes.push({ id: row.id, status: "skipped" }); continue; }

    // publishToPages must not be able to throw past this point. The row is
    // already flipped to 'publishing', and the next tick only claims rows that
    // are still 'scheduled' — so an escaping error left the post stuck in
    // 'publishing' for good: never retried, never marked failed, never
    // surfaced. It simply never went out.
    let results: Awaited<ReturnType<typeof publishToPages>>;
    try {
      results = await publishToPages((row.pages as string[]) || [], (row.body as string) || "", row.image_url as string | null, row.prepared as PreparedMedia | null);
    } catch (e) {
      results = ((row.pages as string[]) || []).map((p) => ({ page: p, ok: false, error: (e as Error).message }));
    }
    const anyOk = results.some((r) => r.ok);
    const finalStatus = anyOk ? "published" : "failed";
    if (anyOk) published++;
    await sb.from("linkedin_scheduled_posts").update({
      status: finalStatus,
      results,
      error: anyOk ? null : results.map((r) => (r.ok ? "" : r.error)).filter(Boolean).join("; "),
      published_at: anyOk ? new Date().toISOString() : null,
    }).eq("id", row.id);
    outcomes.push({ id: row.id, status: finalStatus });
  }

  return NextResponse.json({ ok: true, processed: due.length, published, prepared: await prepareSoon(), reaped: reapedCount, outcomes, token: tokenState });
}

export async function POST(req: Request) { return run(req); }
export async function GET(req: Request) { return run(req); }
