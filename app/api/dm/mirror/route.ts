// Called by n8n every time it processes a DM. Mirrors the conversation into Supabase.
import { sameSecret } from "@/lib/cron-auth";
// Usage: POST /api/dm/mirror  with header x-cron-secret
//
// Header only. ?secret= used to be accepted too, which writes a live credential
// into Netlify access logs, the n8n execution record and any proxy in between —
// log stores whose retention and access control are not this app's, and which
// nobody rotates. n8n sends the header, so nothing legitimate used the query form.
// Body: { account, sender_id, username?, direction: "in"|"out", text, source?: "user"|"ai"|"human", message_id?, at? }
import { NextResponse } from "next/server";
import { recordInbound, recordOutbound } from "@/lib/dm";
import { safeError } from "@/lib/errors";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  return sameSecret(req.headers.get("x-cron-secret"), secret);
}

export async function POST(req: Request) {
  // Server-to-server webhook (n8n) — authed by CRON_SECRET only. It has no user
  // session, so a requireSection() gate here would (wrongly) 401 every call, which
  // is what was silently blocking DM mirroring.
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json() as {
      account: string; sender_id: string; username?: string;
      direction: "in" | "out"; text: string;
      source?: "user" | "ai" | "human"; message_id?: string; at?: string;
    };
    if (!body.account || !body.sender_id || !body.text || !body.direction) {
      return NextResponse.json({ error: "Missing account / sender_id / direction / text" }, { status: 400 });
    }
    if (body.direction === "in") {
      const t = await recordInbound({ account: body.account, sender_id: body.sender_id, username: body.username, text: body.text, messageId: body.message_id, at: body.at });
      return NextResponse.json({ ok: true, thread: t });
    } else {
      const t = await recordOutbound({ account: body.account, sender_id: body.sender_id, text: body.text, source: body.source === "human" ? "human" : "ai", messageId: body.message_id, at: body.at });
      return NextResponse.json({ ok: true, thread: t });
    }
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't update the conversation"), { status: 500 });
  }
}
