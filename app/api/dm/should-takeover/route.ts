// Called by n8n at the START of the workflow to decide: AI mode or human takeover.
import { sameSecret } from "@/lib/cron-auth";
// Usage: GET /api/dm/should-takeover?account=...&sender_id=...&secret=...
// Returns:
//   { mode: "ai" | "human", queued_reply: string | null }
// If queued_reply is non-null, n8n should send that text as the DM (single-shot — it's popped from queue on read).
// If mode is "human" with no queued_reply, n8n should NOT call the AI and should NOT respond (just save the message via /api/dm/mirror).
import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getThread, popQueuedReply, recordInbound } from "@/lib/dm";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  return sameSecret(req.headers.get("x-cron-secret"), secret);
}

export async function GET(req: Request) {
  const __denied = await requireSection("sales");
  if (__denied) return __denied;

  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const account = url.searchParams.get("account") || "";
  const sender_id = url.searchParams.get("sender_id") || "";
  const inboundText = url.searchParams.get("text") || ""; // optional: also record the incoming text here, so n8n only needs ONE call to us
  const username = url.searchParams.get("username") || undefined;
  if (!account || !sender_id) return NextResponse.json({ error: "Missing account / sender_id" }, { status: 400 });

  // If n8n passed the incoming text, record it now (saves an extra mirror call).
  if (inboundText) await recordInbound({ account, sender_id, username, text: inboundText });

  const thread = await getThread(account, sender_id);
  const mode = thread?.mode || "ai";
  const queued = await popQueuedReply(account, sender_id);
  return NextResponse.json({
    mode,
    queued_reply: queued?.reply || null,
  });
}
