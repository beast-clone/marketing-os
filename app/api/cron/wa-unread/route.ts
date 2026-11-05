import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { getSupabase } from "@/lib/supabase";
import { postSlack, hasSlack } from "@/lib/slack";
import { safeError } from "@/lib/errors";

// Nudge Slack when a WhatsApp reply has been sitting unanswered.
// Point n8n at this every 15 minutes during office hours.
//   GET /api/cron/wa-unread   (header: x-cron-secret: <CRON_SECRET>)
//
// WhatsApp replies are worth money and expire: free replies are only allowed for
// 24 hours after the person writes, so one left overnight costs a template to
// reopen. Nobody watches the tab all day, so the tab has to speak up.
export const dynamic = "force-dynamic";

const APP_URL = process.env.APP_URL || "https://goocampus-ig-dashboard.netlify.app";
const BASE_PATH = process.env.BASE_PATH ?? "/gc-dashboard";

// How long a message may sit before it is worth interrupting someone. Short
// enough to matter, long enough that a reply being typed right now is not
// announced to the whole team.
const GRACE_MS = 10 * 60_000;

const fmtNum = (d: string) => (d.startsWith("91") && d.length === 12 ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`);

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  try {
    const { data: unread, error } = await db.from("wa_messages")
      .select("contact, contact_name, body, created_at")
      .eq("direction", "in").is("read_at", null)
      .order("created_at", { ascending: false }).limit(500);
    if (error) throw error;

    // Newest unread per contact, and how long the oldest has waited.
    type Waiting = { contact: string; name: string | null; body: string; newest: number; oldest: number; count: number };
    const by = new Map<string, Waiting>();
    for (const m of unread ?? []) {
      const t = Date.parse(m.created_at);
      const w = by.get(m.contact);
      if (!w) by.set(m.contact, { contact: m.contact, name: m.contact_name, body: m.body || "(attachment)", newest: t, oldest: t, count: 1 });
      else { w.oldest = Math.min(w.oldest, t); w.count++; }
    }

    const now = Date.now();
    const waited = [...by.values()].filter((w) => now - w.oldest >= GRACE_MS);
    if (waited.length === 0) return NextResponse.json({ ok: true, waiting: 0, alerted: 0 });

    // Only shout about what we haven't shouted about. alerted_at records the last
    // message we announced for a chat, so a conversation that sits unread all
    // afternoon is mentioned once, not every quarter of an hour — but a NEW
    // message in that same chat is announced again, because that is new news.
    const { data: seen } = await db.from("wa_contacts")
      .select("contact, alerted_at, assigned_to").in("contact", waited.map((w) => w.contact));
    const seenBy = new Map((seen ?? []).map((r) => [r.contact, r]));

    const fresh = waited.filter((w) => {
      const prev = seenBy.get(w.contact)?.alerted_at;
      return !prev || Date.parse(prev) < w.newest;
    });
    if (fresh.length === 0) return NextResponse.json({ ok: true, waiting: waited.length, alerted: 0 });

    if (hasSlack()) {
      const lines = fresh.map((w) => {
        const mins = Math.round((now - w.oldest) / 60_000);
        const who = w.name || fmtNum(w.contact);
        const owner = seenBy.get(w.contact)?.assigned_to;
        const tail = owner ? ` — ${owner}'s chat` : " — nobody has taken it";
        return `• *${who}*${tail}, waiting ${mins} min: “${w.body.slice(0, 120)}”`;
      });
      const title = fresh.length === 1 ? "1 WhatsApp reply is waiting" : `${fresh.length} WhatsApp replies are waiting`;
      await postSlack(`${title}\n${lines.join("\n")}\n${APP_URL}${BASE_PATH}/dashboard/preview/wa-inbox`);
    }

    // Mark them announced whether or not Slack is configured: without this, a
    // workspace with no webhook would re-count the same chats forever and the
    // endpoint would never settle.
    const stamp = new Date().toISOString();
    await db.from("wa_contacts").upsert(
      fresh.map((w) => ({ contact: w.contact, alerted_at: stamp })),
      { onConflict: "contact" },
    );

    return NextResponse.json({ ok: true, waiting: waited.length, alerted: fresh.length, slack: hasSlack() });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't check WhatsApp replies"), { status: 500 });
  }
}
