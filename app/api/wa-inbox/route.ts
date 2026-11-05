import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getSessionUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";
import { fetchRoster } from "@/lib/team-db";
import { contactMetaMap, knownLabels, EMPTY_META, mediaOf } from "@/lib/wa-inbox";

// WhatsApp Inbox for the official number +91 74116 54951.
// Incoming messages land in `wa_messages` through n8n "WA Inbox — receive" (see
// wa_ingest() in Supabase); replies go out through /api/wa-inbox/send.
//
//   GET /api/wa-inbox                  -> conversations, newest first
//   GET /api/wa-inbox?contact=9198...  -> that chat's messages (and marks them read)

const WINDOW_MS = 24 * 60 * 60 * 1000; // WhatsApp allows free-text replies for 24h after their last message

export async function GET(req: Request) {
  const denied = await requireSection("sales");
  if (denied) return denied;
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  const contact = new URL(req.url).searchParams.get("contact");

  try {
    if (contact) {
      const { data, error } = await db.from("wa_messages")
        .select("id, direction, kind, body, status, error, sent_by, created_at, raw")
        .eq("contact", contact).order("created_at", { ascending: true }).limit(500);
      if (error) throw error;
      await db.from("wa_messages").update({ read_at: new Date().toISOString() })
        .eq("contact", contact).eq("direction", "in").is("read_at", null);
      // Say WHAT is attached, never the raw Meta object: it carries ids of
      // theirs that the browser has no use for. The bytes themselves come from
      // /api/wa-inbox/media, which is behind the same session guard.
      const messages = (data ?? []).map(({ raw, ...m }) => {
        const media = mediaOf(raw);
        return media
          ? { ...m, media: { mime: media.mime, filename: media.filename, caption: media.caption } }
          : m;
      });
      return NextResponse.json({ messages });
    }

    const { data, error } = await db.from("wa_messages")
      .select("contact, contact_name, direction, kind, body, read_at, created_at")
      .order("created_at", { ascending: false }).limit(3000);
    if (error) throw error;
    type Conv = { contact: string; name: string | null; last: string; lastAt: string; lastDir: string; unread: number; lastInAt: string | null; open: boolean };
    const by = new Map<string, Conv>();
    for (const m of data ?? []) {
      let c = by.get(m.contact);
      if (!c) by.set(m.contact, c = { contact: m.contact, name: null, last: m.body || `[${m.kind}]`, lastAt: m.created_at, lastDir: m.direction, unread: 0, lastInAt: null, open: false });
      if (!c.name && m.contact_name) c.name = m.contact_name;
      if (m.direction === "in") {
        if (!c.lastInAt) c.lastInAt = m.created_at;
        if (!m.read_at) c.unread++;
      }
    }

    // Who is handling each chat, and what it is about. One query for the whole
    // list; the Sales Hub lead is NOT fetched here — that is an Airtable call per
    // number, so it waits until a chat is actually opened.
    const contacts = [...by.keys()];
    const [metaMap, roster, labels] = await Promise.all([
      contactMetaMap(contacts),
      fetchRoster().catch(() => []),
      knownLabels().catch(() => [] as string[]),
    ]);

    const now = Date.now();
    const conversations = [...by.values()].map((c) => {
      const meta = metaMap.get(c.contact) ?? EMPTY_META(c.contact);
      return {
        ...c,
        // A name somebody typed beats the WhatsApp profile name, which students
        // set to nicknames.
        name: meta.display_name || c.name,
        open: !!c.lastInAt && now - Date.parse(c.lastInAt) < WINDOW_MS,
        assignedTo: meta.assigned_to,
        labels: meta.labels,
        chatStatus: meta.status,
        hasNote: !!meta.note,
      };
    });

    return NextResponse.json({
      conversations,
      unread: conversations.reduce((s, c) => s + c.unread, 0),
      // For the assign picker and the label filter, so the page doesn't need its
      // own round trips to draw the toolbar.
      team: roster.filter((u) => u.active).map((u) => ({ id: u.id, name: u.first || u.name })),
      labels,
      // So "My chats" can mean something without the page asking who it is.
      me: getSessionUserId(),
    });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't load WhatsApp messages"), { status: 500 });
  }
}
