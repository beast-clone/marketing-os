import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { loadPublishPages } from "@/lib/publish-pages-server";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { writeBackLink } from "@/lib/mh-linkback";
import { accountIdForSbu, matchPost, WINDOW_DAYS, shiftDate, type MatchTask } from "@/lib/post-match";
import { fetchLivePosts, withinDays, type LinkPlatform } from "@/lib/published-posts";
import { fetchContentTypes } from "@/lib/content-types-db";
import { fetchSbus } from "@/lib/sbus-db";

// Nightly: fill in the links for posts that went live today, without anyone asking.
//   GET /api/cron/link-published   (header: x-cron-secret: <CRON_SECRET>)
//
// The dashboard's own publishers report their link back the moment they publish. The
// team publishes from the apps instead, so for those tasks nothing ever did — on
// 27 Sep 2026 every one of the 41 published tasks had no link at all. The task modal
// now has a button to go and find them; this is the same thing on a schedule, so the
// ordinary case needs nobody to press anything.
//
// It applies ONLY matches that are not in doubt. Everything uncertain is deliberately
// left for a person, who gets the same candidates on the task itself — unattended is
// exactly when a wrong link is most dangerous, because there is no one watching it be
// chosen and a wrong link looks just like a right one.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// How far back to look. This is meant to catch what just went out, not to rewrite
// history — a long lookback re-reads the same old tasks every night for nothing, and
// the oldest matches are the least certain. Override with ?days= for a one-off.
const DEFAULT_LOOKBACK_DAYS = 7;
// A ceiling so one run can't turn into an unbounded crawl of the whole table.
const MAX_TASKS = 200;

const todayIso = () => new Date().toISOString().slice(0, 10);

type Row = {
  id: string; particulars: string | null; caption: string | null;
  publishing_date: string | null; sbu: string | null; type: string | null;
  instagram_url: string | null; facebook_url: string | null; linkedin_url: string | null;
};

export async function GET(req: Request) {
  await fetchSbus();   // brand → page comes from the database (sql/040)
  await loadPublishPages();   // pages of brands linked on the Brands page
  await fetchContentTypes();   // registers dashboard-added types into VIDEO_TYPES (sql/028)
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    const url = new URL(req.url);
    const days = Math.max(1, Math.min(120, parseInt(url.searchParams.get("days") || "", 10) || DEFAULT_LOOKBACK_DAYS));
    const dry = url.searchParams.get("dry") === "1";
    // One account per call. Almost all the time is the platform fetches — three
    // accounts x three platforms measured 21s, and a synchronous Netlify function is
    // killed at 26. Split this way each call is a third of that, and the scheduled
    // function fires the three in parallel so the night still finishes in one go.
    // No account = all of them, which is what a manual or local run wants.
    const onlyAccount = url.searchParams.get("account") || "";
    const today = todayIso();
    const since = shiftDate(today, -days);

    // Only tasks that actually went out. A task still in the pipeline has no live post
    // to find, and matching one anyway would attach a link to work that was never
    // published. Published/Scheduled is the only status that means "it is out there".
    const { data, error } = await sb
      .from("mh_posts")
      .select("id, particulars, caption, publishing_date, sbu, type, instagram_url, facebook_url, linkedin_url")
      .eq("status", "Published/Scheduled")
      .gte("publishing_date", since)
      .lte("publishing_date", today)
      .order("publishing_date", { ascending: false })
      .limit(MAX_TASKS);
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });

    const rows = (data as Row[] | null) || [];
    // Something is missing on at least one platform, and we know where it was posted.
    const todo = rows.filter((r) =>
      r.publishing_date && accountIdForSbu(r.sbu) &&
      (!r.instagram_url || !r.facebook_url || !r.linkedin_url));

    // Group by account and fetch each account's posts ONCE for the whole span, then
    // narrow per task. Fetching per task would be one Meta/LinkedIn round trip each —
    // the difference between a handful of calls a night and several hundred.
    const byAccount = new Map<string, Row[]>();
    for (const r of todo) {
      const acc = accountIdForSbu(r.sbu) as string;
      if (onlyAccount && acc !== onlyAccount) continue;
      byAccount.set(acc, [...(byAccount.get(acc) || []), r]);
    }

    // Every link already on the board, so a post that belongs to one task can never
    // be handed to another. Read once — the table is small and this is a night job.
    const { data: existingRows } = await sb
      .from("mh_posts")
      .select("id, instagram_url, facebook_url, linkedin_url");
    const claimed = new Map<string, string>();   // url -> task id that already has it
    for (const r of (existingRows as Row[] | null) || []) {
      for (const u of [r.instagram_url, r.facebook_url, r.linkedin_url]) if (u) claimed.set(u, r.id);
    }

    type Proposal = { task: Row; platform: LinkPlatform; url: string; score: number; caption: string };
    const proposals: Proposal[] = [];
    const leftForAPerson: { id: string; platform: LinkPlatform; title: string; choices: number; why?: string }[] = [];
    const linked: { id: string; platform: LinkPlatform; url: string; title: string }[] = [];
    const failures: { id: string; platform: LinkPlatform; error: string }[] = [];

    for (const [accountId, tasks] of byAccount) {
      // The span has to cover every task's own window, not just the lookback.
      const dates = tasks.map((t) => t.publishing_date as string).sort();
      const live = await fetchLivePosts(accountId, shiftDate(dates[0], -WINDOW_DAYS), shiftDate(dates[dates.length - 1], WINDOW_DAYS));

      for (const task of tasks) {
        const mt: MatchTask = { particulars: task.particulars, caption: task.caption, publishing_date: task.publishing_date, type: task.type };
        const existing: Record<LinkPlatform, string | null> = {
          instagram: task.instagram_url, facebook: task.facebook_url, linkedin: task.linkedin_url,
        };
        for (const platform of ["instagram", "facebook", "linkedin"] as LinkPlatform[]) {
          if (existing[platform]) continue;                       // already has one
          if (live[platform].reason) continue;                    // nothing to search
          const pool = withinDays(live[platform].posts, task.publishing_date as string, WINDOW_DAYS)
            // A post that already belongs to another task is not a candidate for this
            // one. Without this the same LinkedIn post was proposed for two different
            // carousels — each match looked fine on its own, which is exactly how a
            // wrong link gets in.
            .filter((post) => !post.permalink || !claimed.has(post.permalink));
          const { confident, candidates } = matchPost(mt, pool);
          if (!confident) {
            if (candidates.length) leftForAPerson.push({ id: task.id, platform, title: task.particulars || "", choices: candidates.length });
            continue;
          }
          proposals.push({ task, platform, url: confident.url, score: confident.score, caption: confident.caption });
        }
      }
    }

    // Two tasks can still reach for the same post inside one run, since each was
    // matched on its own. The best scoring task keeps it; the others go back to being
    // a question for a person rather than a coin toss.
    const bestForUrl = new Map<string, Proposal>();
    for (const p of proposals) {
      const cur = bestForUrl.get(p.url);
      if (!cur || p.score > cur.score) bestForUrl.set(p.url, p);
    }
    for (const p of proposals) {
      if (bestForUrl.get(p.url) !== p) {
        leftForAPerson.push({ id: p.task.id, platform: p.platform, title: p.task.particulars || "", choices: 1, why: "another task matched the same post more strongly" });
      }
    }

    for (const p of bestForUrl.values()) {
      if (dry) { linked.push({ id: p.task.id, platform: p.platform, url: p.url, title: p.task.particulars || "" }); continue; }
      // Through the one write-back seam, so a link filled by the night job is stamped
      // and logged exactly like one filled by a person or by a publisher.
      const res = await writeBackLink({ postId: p.task.id, platform: p.platform, url: p.url });
      if (res.ok) { linked.push({ id: p.task.id, platform: p.platform, url: p.url, title: p.task.particulars || "" }); claimed.set(p.url, p.task.id); }
      else failures.push({ id: p.task.id, platform: p.platform, error: res.error });
    }

    return NextResponse.json({
      ok: true,
      dry,
      window: { since, today, days },
      account: onlyAccount || "all",
      considered: [...byAccount.values()].reduce((n, v) => n + v.length, 0),
      accounts: [...byAccount.keys()],
      linked,
      // Not a failure — these are the ones a person should look at on the task itself.
      needsAPerson: leftForAPerson,
      failures,
    });
  } catch (err) {
    return NextResponse.json(safeError(err, "Nightly link fill failed"), { status: 502 });
  }
}
