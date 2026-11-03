import { NextResponse } from "next/server";
import { requireSection, ownPerson } from "@/lib/api-guard";
import { getSessionIsAdmin } from "@/lib/auth";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { activeTeamIds } from "@/lib/team-db";

// Per-person notepad. Simple CRUD on mh_notes.
//   GET    /api/marketing-hub/notes?person=manya
//   POST   /api/marketing-hub/notes  { person, body }
//   PATCH  /api/marketing-hub/notes  { id, body?, done? }
//   DELETE /api/marketing-hub/notes?id=<uuid>


// A notepad is its owner's alone (admins can open anyone's, as on My Day).
async function normalizePerson(v: string | null | undefined): Promise<string | null> {
  const k = ownPerson(v);
  return k && (await activeTeamIds()).has(k) ? k : null;
}

// Editing or deleting a note by id: only its owner (or an admin).
async function ownsNote(sb: NonNullable<ReturnType<typeof getSupabase>>, id: string): Promise<boolean> {
  if (getSessionIsAdmin()) return true;
  const { data } = await sb.from("mh_notes").select("member_key").eq("id", id).maybeSingle();
  return !!data && data.member_key === ownPerson(null);
}

export async function GET(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const url = new URL(req.url);
    const person = await normalizePerson(url.searchParams.get("person"));
    if (!person) return NextResponse.json({ error: "person is required (a team member id)" }, { status: 400 });

    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    const { data, error } = await sb
      .from("mh_notes")
      .select("id, member_key, body, done, position, created_at, updated_at")
      .eq("member_key", person)
      .order("done", { ascending: true })
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    return NextResponse.json({ notes: data || [] });
  } catch (err) {
    return NextResponse.json(safeError(err, "Notes fetch failed"), { status: 502 });
  }
}

export async function POST(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const body = (await req.json()) as { person?: string; body?: string };
    const person = await normalizePerson(body.person);
    if (!person) return NextResponse.json({ error: "person required" }, { status: 400 });
    if (!body.body || body.body.trim().length === 0) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }

    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    const { data, error } = await sb
      .from("mh_notes")
      .insert({ member_key: person, body: body.body.trim() })
      .select("id, member_key, body, done, position, created_at")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ note: data });
  } catch (err) {
    return NextResponse.json(safeError(err, "Note add failed"), { status: 502 });
  }
}

export async function PATCH(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const body = (await req.json()) as { id?: string; body?: string; done?: boolean };
    if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const patch: Record<string, unknown> = {};
    if (typeof body.body === "string") patch.body = body.body.trim();
    if (typeof body.done === "boolean") patch.done = body.done;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }

    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    if (!(await ownsNote(sb, body.id))) return NextResponse.json({ error: "That note belongs to someone else." }, { status: 403 });

    const { data, error } = await sb
      .from("mh_notes")
      .update(patch)
      .eq("id", body.id)
      .select("id, body, done, updated_at")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ note: data });
  } catch (err) {
    return NextResponse.json(safeError(err, "Note update failed"), { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    if (!(await ownsNote(sb, id))) return NextResponse.json({ error: "That note belongs to someone else." }, { status: 403 });
    const { error } = await sb.from("mh_notes").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(safeError(err, "Note delete failed"), { status: 502 });
  }
}
