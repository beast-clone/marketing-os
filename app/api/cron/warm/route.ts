import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { createHmac, randomBytes } from "crypto";
import { buildPayload } from "@/lib/session-payload";
import { format, subDays } from "date-fns";
import { fetchRoster } from "@/lib/team-db";

// Cache warm-up job.
//
// The heavy endpoints (Ads, Leads, YouTube, AI Reports, per-post insights) are
// slow on a COLD cache — 5–30s. This job pre-loads them so a real visitor (or a
// live demo) always lands on a warm cache. It mints a short-lived admin session
// the same way lib/auth.ts does, then hits each endpoint server-side (no force —
// it fills cold caches and returns instantly for already-warm ones).
//
//   GET /api/cron/warm    Header: x-cron-secret: <CRON_SECRET>   (or ?secret=)
//
// Schedule it (n8n / Netlify scheduled function / external cron) every ~30 min in
// production. In local dev, instrumentation.ts fires it automatically on boot.

const ACCOUNTS = ["goocampus", "goocampusworld", "12thplusdotcom", "samvaya_matrimony"];

// The session has to belong to a REAL admin, not a made-up one.
//
// This used to mint `warm:a:<token>`. The signed `:a:` flag is enough for the
// Edge middleware, so the cookie looked fine — but requireSection() (added in the
// 2026-08 authorization audit) ignores that flag and looks the id up in the team
// roster. There is no user called "warm", so every single target answered 403 and
// the job warmed nothing while reporting a cheerful 200. Borrowing a real admin's
// id makes the roster lookup succeed, which is what the cookie was always
// claiming anyway. Still gated on CRON_SECRET, so nothing outside can mint one.
async function mintSession(): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return "";
  const admin = (await fetchRoster()).find((u) => u.isAdmin && u.active);
  if (!admin) return "";
  const token = randomBytes(24).toString("hex");
  // Built with the shared builder, not by hand. Hand-rolling it here is how this
  // cookie ended up in the pre-expiry 3-field shape after sessions gained an
  // expiry: still correctly signed, so it looked fine, and refused by the
  // middleware on every target — the same silent "warms nothing, reports 200"
  // failure described above, arrived at a second way.
  const payload = buildPayload(admin.id, true, token);
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `gc_session=${payload}.${sig}`;
}

export async function GET(req: Request) {
  // Header only. The secret used to be accepted as ?secret= too, which puts a
  // live credential into Netlify's access logs, the n8n execution record and
  // anyone's browser history — somewhere it is never rotated out of. Every
  // other /api/cron route already takes the header alone; n8n sends it that
  // way, so nothing legitimate was using the query form.
  //
  // Note the `secret &&` below: with CRON_SECRET unset this route is open. That
  // is deliberate for local dev, where instrumentation.ts fires it on boot, and
  // safe in production because the variable is always set there.
  const secret = process.env.CRON_SECRET;
  // Without CRON_SECRET it is open only in local dev, never in production
  // (security audit, 3 Nov 2026).
  if (secret ? !sameSecret(req.headers.get("x-cron-secret"), secret) : process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookie = await mintSession();
  if (!cookie) return NextResponse.json({ error: "SESSION_SECRET not configured, or no active admin in the roster" }, { status: 500 });

  // App base = everything before "/api/cron/warm" (keeps any basePath prefix intact).
  const appBase = req.url.slice(0, req.url.indexOf("/api/cron/warm"));
  const to = format(new Date(), "yyyy-MM-dd");
  const from = format(subDays(new Date(), 30), "yyyy-MM-dd");

  // Per-account core (what the analytics tabs hit) + org-wide heavy endpoints.
  const targets: string[] = [];
  for (const a of ACCOUNTS) {
    targets.push(`/api/insights?accountId=${a}&from=${from}&to=${to}`);
    targets.push(`/api/posts?accountId=${a}&from=${from}&to=${to}&limit=500&insights=true`);
    targets.push(`/api/audience?accountId=${a}`);
  }
  targets.push(`/api/overview-tips?accountId=goocampus&from=${from}&to=${to}`);
  targets.push(`/api/ads?from=${from}&to=${to}`);
  targets.push(`/api/ads/breakdowns?from=${from}&to=${to}`);
  targets.push(`/api/leads?accountId=goocampus&from=${from}&to=${to}`);
  targets.push(`/api/leads-crm?from=${from}&to=${to}`);
  targets.push(`/api/leads-crm/counsellor?name=all&from=${from}&to=${to}`); // Sales Hub per-lead first-contact table
  targets.push(`/api/youtube`);
  targets.push(`/api/youtube/uploads`);
  targets.push(`/api/ai-report?accountId=goocampus&period=monthly`);
  targets.push(`/api/post-planner`);

  const t0 = Date.now();
  const results = await Promise.all(
    targets.map(async (path) => {
      const s = Date.now();
      try {
        const r = await fetch(appBase + path, { headers: { cookie }, cache: "no-store" });
        return { path: path.split("?")[0], status: r.status, ms: Date.now() - s };
      } catch (e) {
        return { path: path.split("?")[0], status: 0, ms: Date.now() - s, error: (e as Error).message.slice(0, 60) };
      }
    }),
  );

  const ok = results.filter((r) => r.status === 200).length;
  return NextResponse.json({
    warmed: results.length,
    ok,
    failed: results.length - ok,
    totalMs: Date.now() - t0,
    at: new Date().toISOString(),
    results,
  });
}
