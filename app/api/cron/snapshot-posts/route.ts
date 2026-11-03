import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { getAccount } from "@/lib/instagram";
import { snapshotPostsForMonth, snapshotAllAccountsPostsForMonth, currentMonth } from "@/lib/post-history";
import { snapshotAudienceForMonth, snapshotAllAccountsAudienceForMonth } from "@/lib/audience-history";
import { safeError } from "@/lib/errors";
import { warmBrandAccounts } from "@/lib/brand-accounts";

// Freeze one month of post performance per account into Supabase, so past months
// stay stable + instant on the Overview (see lib/post-history.ts).
//
//   GET /api/cron/snapshot-posts                          -> CURRENT month, ALL accounts
//   GET /api/cron/snapshot-posts?month=2026-08            -> that month, ALL accounts
//   GET /api/cron/snapshot-posts?month=2026-08&accountId=goocampus  -> one account
//
// Per-post insights = one Meta call each, so a month is 15–30s per account. On a
// serverless host, snapshot ONE account per call (pass accountId) to stay under the
// function timeout; run locally without accountId to do them all in one go.
//
// Auth: header `x-cron-secret: <CRON_SECRET>`.

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await warmBrandAccounts();   // include brands connected on the Brands page

  const url = new URL(req.url);
  const month = url.searchParams.get("month") || currentMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }
  const accountId = url.searchParams.get("accountId");
  const only = url.searchParams.get("only"); // "audience" | "posts" | null (both)
  const doPosts = only !== "audience";
  const doAudience = only !== "posts";
  const t0 = Date.now();

  try {
    if (accountId) {
      const acc = getAccount(accountId);
      if (!acc) return NextResponse.json({ error: `Unknown account ${accountId}` }, { status: 400 });
      const [posts, audience] = await Promise.all([
        doPosts ? snapshotPostsForMonth(acc, month) : Promise.resolve(null),
        doAudience ? snapshotAudienceForMonth(acc, month) : Promise.resolve(null),
      ]);
      return NextResponse.json({ month, results: [{ accountId, posts, audience }], latencyMs: Date.now() - t0 });
    }
    const [postResults, audResults] = await Promise.all([
      doPosts ? snapshotAllAccountsPostsForMonth(month) : Promise.resolve([]),
      doAudience ? snapshotAllAccountsAudienceForMonth(month) : Promise.resolve([]),
    ]);
    const postsWritten = postResults.filter((r) => r.ok).reduce((s, r) => s + (r.count || 0), 0);
    return NextResponse.json({
      month,
      accountsOk: postResults.filter((r) => r.ok).length,
      accountsFailed: postResults.filter((r) => !r.ok).length,
      postsWritten,
      audienceOk: audResults.filter((r) => r.ok).length,
      latencyMs: Date.now() - t0,
      results: postResults,
      audience: audResults,
    });
  } catch (err) {
    return NextResponse.json(safeError(err, "Something went wrong"), { status: 502 });
  }
}
