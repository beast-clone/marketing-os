import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { activeTeamIds } from "@/lib/team-db";
import { getSessionUserId } from "@/lib/auth";

// POST /api/marketing-hub/comments  { postId, authorKey, body }
// Adds one comment to mh_comments. Used by the inline comments thread.


export async function POST(req: Request) {
  const VALID_KEYS = await activeTeamIds();   // the Team page roster, not a typed list
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const body = (await req.json()) as { postId?: string; authorKey?: string; body?: string };
    if (!body.postId) return NextResponse.json({ error: "postId required" }, { status: 400 });
    // The author is whoever is signed in — never the body's authorKey, which let
    // anyone post in a colleague's name (security audit, 3 Nov 2026).
    const author = (getSessionUserId() || "").toLowerCase();
    if (!VALID_KEYS.has(author)) return NextResponse.json({ error: "Only team members can comment." }, { status: 403 });
    if (!body.body || body.body.trim().length === 0) {
      return NextResponse.json({ error: "body required" }, { status: 400 });
    }

    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    const { data, error } = await sb
      .from("mh_comments")
      .insert({ post_id: body.postId, author_key: author, body: body.body.trim() })
      .select("id, author_key, body, resolved, created_at")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ comment: data });
  } catch (err) {
    return NextResponse.json(safeError(err, "Comment add failed"), { status: 502 });
  }
}
