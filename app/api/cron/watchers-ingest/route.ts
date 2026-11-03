import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { getSupabase } from "@/lib/supabase";
import { checkWatcher, type Watcher } from "@/lib/watchers";
import { safeError } from "@/lib/errors";

// Check a watcher using HTML fetched somewhere else.
//
//   POST /api/cron/watchers-ingest    header: x-cron-secret: <CRON_SECRET>
//   { "watcherId": "<uuid>", "html": "<!doctype html>…" }
//   { "url": "https://…",    "html": "…" }     // matches on the watcher's url
//
// Why this exists: cetonline.karnataka.gov.in serves an Indian IP in well under
// a second and refuses Netlify's US ones, so the KEA watcher recorded "Couldn't
// open the page" on every single run while the page was perfectly healthy. That
// is a network-level block — no timeout, retry or user-agent here can get past
// it. n8n runs on a host the site does answer, so it fetches the page and hands
// the HTML to this endpoint; from there the normal code path takes over, which
// means link extraction, diffing, dashboard notifications, email and Telegram
// all behave exactly as they do for a watcher this server can reach itself.
//
// It lives under /api/cron/ deliberately: middleware exempts that prefix from the
// CSRF origin check precisely because these routes authenticate by header
// secret instead, and n8n has no browser origin to send. It writes only to the named
// watcher, and takes HTML rather than a URL to fetch on the caller's behalf —
// an endpoint that fetched arbitrary URLs would be a tidy little SSRF hole.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !sameSecret(req.headers.get("x-cron-secret"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { watcherId?: string; url?: string; html?: string };
  const { watcherId, url, html } = body;
  if (!watcherId && !url) return NextResponse.json({ error: "watcherId or url required" }, { status: 400 });
  if (typeof html !== "string") return NextResponse.json({ error: "html required" }, { status: 400 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  try {
    const q = sb.from("mh_watchers").select("*");
    const { data, error } = await (watcherId ? q.eq("id", watcherId) : q.eq("url", url!)).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Watcher not found" }, { status: 404 });

    // An empty body means the caller's own fetch failed. Passing it through as
    // null records that honestly instead of logging "no links on the page",
    // which would send someone looking at the wrong thing.
    const result = await checkWatcher(data as Watcher, html.trim() ? html : null);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(safeError(err, "Watcher ingest failed"), { status: 502 });
  }
}
