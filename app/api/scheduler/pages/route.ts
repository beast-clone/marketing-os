import { NextResponse } from "next/server";
import { loadPublishPages } from "@/lib/publish-pages-server";

// The pages the Scheduler can post to — the three GooCampus pages and every brand
// linked on the Brands page (lib/publish-pages.ts). Signed-in users only (middleware).
//   GET /api/scheduler/pages → { pages }
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ pages: await loadPublishPages() });
}
