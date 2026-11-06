import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { CHANNELS } from "@/lib/youtube-channels";
import { uploadReady } from "@/lib/youtube-upload";
import { cached } from "@/lib/api-cache";

// GET /api/scheduler/youtube-ready?channel=goocampus → { ready, title?, reason? }
// Whether the Scheduler can upload Shorts to this channel: connected from the
// dashboard with upload permission (lib/youtube-upload.ts). The composer greys the
// YouTube tick out and says why when it can't.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;
  const channel = new URL(req.url).searchParams.get("channel") || "";
  if (!CHANNELS[channel]) return NextResponse.json({ ready: false, reason: "no YouTube channel" });
  // A minute's cache: the composer asks on every page tick, Google needn't hear it each time.
  return NextResponse.json(await cached(`ytready:${channel}`, 60_000, () => uploadReady(channel)));
}
