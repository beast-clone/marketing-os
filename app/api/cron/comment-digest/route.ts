import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { commentsSince } from "@/lib/comments";
import { sendMail } from "@/lib/email";

// Daily comment digest — point n8n at this once a day (~9 PM IST). Collects every
// comment left on the dashboard today and emails ONE summary (no email on a quiet
// day, so the inbox never fills up).
//   GET /api/cron/comment-digest   (header: x-cron-secret: <CRON_SECRET>)
export const dynamic = "force-dynamic";

const TO = process.env.COMMENT_DIGEST_TO || "info@goocampus.in";
const APP_URL = process.env.APP_URL || "https://goocampus-ig-dashboard.netlify.app";
// Comment paths are stored without the app's basePath (usePathname strips it), so
// prefix it here or the "open this page" links 404 on the deployed /gc-dashboard site.
const BASE_PATH = process.env.BASE_PATH ?? "/gc-dashboard";

// Start of today in IST (UTC+5:30), as a UTC ISO string.
function istMidnightIso(): string {
  const now = Date.now();
  const ist = new Date(now + 5.5 * 3_600_000);
  const istMidnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 0, 0, 0);
  return new Date(istMidnight - 5.5 * 3_600_000).toISOString();
}
const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const since = istMidnightIso();
    const comments = await commentsSince(since);
    if (comments.length === 0) return NextResponse.json({ ok: true, sent: false, count: 0 });

    // Group by page path.
    const byPath = new Map<string, typeof comments>();
    for (const c of comments) { const list = byPath.get(c.path) || []; list.push(c); byPath.set(c.path, list); }

    const dateLabel = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
    const subject = `GooCampus Dashboard — ${comments.length} comment${comments.length === 1 ? "" : "s"} today (${dateLabel})`;

    const sections: string[] = [];
    const textLines: string[] = [`${comments.length} comment(s) left on the dashboard today (${dateLabel}):`, ""];
    for (const [path, list] of byPath) {
      const url = `${APP_URL}${BASE_PATH}${path}`;
      sections.push(`<div style="margin:18px 0 6px"><a href="${esc(url)}" style="color:#3A57E8;text-decoration:none;font-weight:600;font-size:14px">${esc(path)}</a></div>`);
      textLines.push(`${path}  (${url})`);
      for (const c of list) {
        sections.push(
          `<div style="border-left:3px solid #E9ECFB;padding:6px 0 6px 12px;margin:8px 0">` +
          `<div style="font-size:12px;color:#8A92A6"><b style="color:#232D42">${esc(c.author)}</b> · ${fmtTime(c.ts)}</div>` +
          `<div style="font-size:14px;color:#232D42;white-space:pre-wrap;margin-top:2px">${esc(c.text)}</div></div>`,
        );
        textLines.push(`  - ${c.author} (${fmtTime(c.ts)}): ${c.text}`);
      }
    }

    const html =
      `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:0 auto">` +
      `<h2 style="font-size:18px;color:#232D42;font-weight:600">Dashboard comments — ${dateLabel}</h2>` +
      `<p style="font-size:14px;color:#8A92A6">${comments.length} comment${comments.length === 1 ? "" : "s"} left today, grouped by page.</p>` +
      sections.join("") +
      `<p style="font-size:12px;color:#8A92A6;margin-top:24px">Sent by the GooCampus Marketing OS end-of-day digest.</p></div>`;

    await sendMail({ to: TO, subject, text: textLines.join("\n"), html });
    return NextResponse.json({ ok: true, sent: true, count: comments.length, to: TO });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "digest failed" }, { status: 502 });
  }
}
