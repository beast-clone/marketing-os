import { NextRequest, NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getAccount, graphFor } from "@/lib/instagram";
import { safeError } from "@/lib/errors";

const GRAPH = "https://graph.facebook.com/v25.0";

// GET /api/scheduler/media-children?mediaId=<carousel-id>&accountId=goocampus
// Returns every slide's media URL for a CAROUSEL_ALBUM (so a repost keeps all images).
export async function GET(req: NextRequest) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  const mediaId = req.nextUrl.searchParams.get("mediaId");
  const accountId = req.nextUrl.searchParams.get("accountId") || "goocampus";
  if (!mediaId) return NextResponse.json({ error: "mediaId required" }, { status: 400 });
  const acct = getAccount(accountId);
  if (!acct) return NextResponse.json({ error: "unknown account" }, { status: 400 });
  try {
    const url = `${graphFor(acct.pageAccessToken)}/${mediaId}?fields=children{media_url,thumbnail_url,media_type}&access_token=${encodeURIComponent(acct.pageAccessToken)}`;
    const r = await fetch(url, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok || d.error) return NextResponse.json({ error: d.error?.message || `HTTP ${r.status}` }, { status: 502 });
    const urls: string[] = ((d.children?.data as { media_url?: string; thumbnail_url?: string }[]) || [])
      .map((c) => c.media_url || c.thumbnail_url || "")
      .filter(Boolean);
    return NextResponse.json({ urls });
  } catch (e) {
    return NextResponse.json(safeError(e, "Couldn't complete that scheduling action"), { status: 502 });
  }
}
