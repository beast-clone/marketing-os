import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { getSupabase } from "@/lib/supabase";
import { postSlack, hasSlack } from "@/lib/slack";
import { safeError } from "@/lib/errors";
import { fetchRoster } from "@/lib/team-db";
import { canAccessSection } from "@/lib/permissions";
import { waitingReplies } from "@/lib/wa-inbox";

// Nudge the team when a WhatsApp reply has been sitting unanswered.
// Point n8n at this every 15 minutes during office hours.
//   GET /api/cron/wa-unread   (header: x-cron-secret: <CRON_SECRET>)
//
// WhatsApp replies are worth money and expire: free replies are only allowed for
// 24 hours after the person writes, so one left overnight costs a template to
// reopen. Nobody watches the tab all day, so the tab has to speak up — in Slack
// and in the dashboard bell, the same way a Watcher announces a new notice.
export const dynamic = "force-dynamic";

const APP_URL = process.env.APP_URL || "https://goocampus-ig-dashboard.netlify.app";
const BASE_PATH = process.env.BASE_PATH ?? "/gc-dashboard";
const INBOX = "/dashboard/preview/wa-inbox";

const fmtNum = (d: string) => (d.startsWith("91") && d.length === 12 ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`);

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  try {
    const waited = await waitingReplies();
    if (waited.length === 0) return NextResponse.json({ ok: true, waiting: 0, alerted: 0 });

    // Only announce what we haven't announced. alerted_at records the last message
    // we spoke about for a chat, so a conversation that sits unread all afternoon
    // is mentioned once — but a NEW message in that same chat is announced again,
    // because that is new news.
    const { data: seen } = await db.from("wa_contacts")
      .select("contact, alerted_at").in("contact", waited.map((w) => w.contact));
    const alertedAt = new Map((seen ?? []).map((r) => [r.contact, r.alerted_at as string | null]));

    const fresh = waited.filter((w) => {
      const prev = alertedAt.get(w.contact);
      return !prev || Date.parse(prev) < w.newestAt;
    });
    if (fresh.length === 0) return NextResponse.json({ ok: true, waiting: waited.length, alerted: 0 });

    const now = Date.now();
    const stamp = new Date().toISOString();
    const mins = (w: { oldestAt: number }) => Math.round((now - w.oldestAt) / 60_000);
    const whoOf = (w: { name: string | null; contact: string }) => w.name || fmtNum(w.contact);

    // ── The dashboard bell ───────────────────────────────────────────────────
    // An assigned chat is one person's problem; an unassigned one is everybody's,
    // so it goes to whoever can actually open the inbox. Not an action item: those
    // stay pinned until something marks them done, and "they replied" is news, not
    // a task with a finish line.
    const roster = await fetchRoster().catch(() => []);
    const salesTeam = roster.filter((u) => u.active && canAccessSection(u, "sales")).map((u) => u.id);
    const rows = fresh.flatMap((w) => {
      const to = w.assignedTo ? [w.assignedTo] : salesTeam;
      return to.map((person) => ({
        recipient_key: person,
        // Keyed on Meta's message id, so one reply is announced once per person
        // however often this runs, while their next message announces again.
        source_id: `wa:${w.contact}:${w.newestId}`,
        kind: "message",
        category: "whatsapp",
        action_needed: false,
        emoji: "💬",
        title: `${whoOf(w)} replied on WhatsApp`,
        sub: `${w.body.slice(0, 160)}${w.count > 1 ? ` · ${w.count} unread` : ""} · waiting ${mins(w)} min`,
        post_id: null,
        payload: { href: `${INBOX}?contact=${w.contact}` },
        created_at: stamp,
      }));
    });
    if (rows.length) {
      await db.from("mh_notifications").upsert(rows, { onConflict: "recipient_key,source_id", ignoreDuplicates: true });
    }

    // ── Slack ────────────────────────────────────────────────────────────────
    if (hasSlack()) {
      const lines = fresh.map((w) => {
        const tail = w.assignedTo ? ` — ${w.assignedTo}'s chat` : " — nobody has taken it";
        return `• *${whoOf(w)}*${tail}, waiting ${mins(w)} min: “${w.body.slice(0, 120)}”`;
      });
      const title = fresh.length === 1 ? "1 WhatsApp reply is waiting" : `${fresh.length} WhatsApp replies are waiting`;
      await postSlack(`${title}\n${lines.join("\n")}\n${APP_URL}${BASE_PATH}${INBOX}`);
    }

    // Mark them announced whether or not Slack is configured: without this, a
    // workspace with no webhook would re-count the same chats forever and the
    // endpoint would never settle.
    await db.from("wa_contacts").upsert(
      fresh.map((w) => ({ contact: w.contact, alerted_at: stamp })),
      { onConflict: "contact" },
    );

    return NextResponse.json({
      ok: true, waiting: waited.length, alerted: fresh.length,
      bell: rows.length, slack: hasSlack(),
    });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't check WhatsApp replies"), { status: 500 });
  }
}
