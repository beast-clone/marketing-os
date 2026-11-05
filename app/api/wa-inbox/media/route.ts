import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";
import { mediaOf } from "@/lib/wa-inbox";

// A photo, PDF or voice note somebody sent us on WhatsApp.
//
//   GET /api/wa-inbox/media?message=<wa_messages.id>
//
// Meta keeps incoming media behind the WhatsApp token and throws it away after
// 30 days, so it has to be fetched and kept. The fetch goes through n8n, which
// holds the token; the copy lives in the PRIVATE `wa-media` bucket, because this
// is mark sheets, certificates and ID photos belonging to other people. Every
// other bucket in this project is public — none of them would do.
//
// Served through this route rather than a public URL so the session guard
// decides who sees it, and an <img src> just works.

const HOOK = process.env.WA_TEMPLATES_URL || "https://n8n.srv1046538.hstgr.cloud/webhook/wa-inbox-templates";
const BUCKET = "wa-media";
// The bucket's own ceiling. WhatsApp allows documents far larger, but those come
// back through a webhook response, and a 100 MB one would tie up n8n and the
// function. Anything bigger is opened in WhatsApp instead, which the UI says.
const MAX = 25 * 1024 * 1024;

export async function GET(req: Request) {
  const denied = await requireSection("sales");
  if (denied) return denied;
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const messageId = new URL(req.url).searchParams.get("message");
  if (!messageId) return NextResponse.json({ error: "Which message?" }, { status: 400 });

  try {
    const { data: row, error } = await db.from("wa_messages")
      .select("id, kind, raw").eq("id", messageId).maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json({ error: "No such message" }, { status: 404 });

    const media = mediaOf(row.raw);
    if (!media) return NextResponse.json({ error: "That message has no attachment" }, { status: 404 });

    const path = `${media.id}`;
    const disposition = media.filename
      // Only a document gets a download name; a photo should open, not download.
      ? `attachment; filename="${media.filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120)}"`
      : "inline";
    const headers = {
      "Content-Type": media.mime,
      "Content-Disposition": disposition,
      // Private: it is somebody's document, and the route is behind a session.
      "Cache-Control": "private, max-age=86400",
    };

    // Already kept? Serve that — Meta's copy may well be gone by now.
    const cached = await db.storage.from(BUCKET).download(path);
    if (cached.data) return new NextResponse(await cached.data.arrayBuffer(), { headers });

    const secret = process.env.WA_INBOX_SEND_SECRET;
    if (!secret) return NextResponse.json({ error: "WhatsApp isn't configured on this server (WA_INBOX_SEND_SECRET)." }, { status: 500 });

    const r = await fetch(HOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-wa-inbox-secret": secret },
      body: JSON.stringify({ action: "media", mediaId: media.id }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const why = await r.text().catch(() => "");
      // Meta deletes media after 30 days; say that rather than a bare failure,
      // because it is the likeliest reason and nothing can be done about it.
      return NextResponse.json({
        error: r.status === 404 || /not found|expired/i.test(why)
          ? "WhatsApp no longer has this file — it keeps attachments for about 30 days."
          : `Couldn't fetch it: ${why.slice(0, 200) || r.status}`,
      }, { status: 502 });
    }
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length > MAX) {
      return NextResponse.json({ error: "That file is too big to show here — open it in WhatsApp." }, { status: 413 });
    }

    // Keep it, so the next person doesn't re-fetch and it survives Meta's 30 days.
    // upsert, because two people opening the same chat at once both get here.
    const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: media.mime, upsert: true });
    if (up.error) {
      // Still show it — failing to cache is not a reason to fail the person.
      return new NextResponse(bytes, { headers });
    }
    return new NextResponse(bytes, { headers });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't load the attachment"), { status: 500 });
  }
}
