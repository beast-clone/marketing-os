import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { safeError } from "@/lib/errors";
import { fetchRoster } from "@/lib/team-db";
import { connectorStatus, revokeKey } from "@/lib/claude-connector";
import { listGrants, revokeAllGrants } from "@/lib/oauth";

// Everyone's Claude connections, for admins (System → Connectors). Each row is named
// after its person and app — "Nandu's Claude Code", "Nikhil's personal key" — so a
// connection is never anonymous (Praveen, 3 Nov 2026: a key shared through one Claude
// made a teammate's work show up under his name).
//   GET                 → { people: [{ id, name, key: {createdAt,lastUsedAt}|null, grants: [...] }] }
//   DELETE ?user=<id>   → ends that person's key and every app they connected
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSection("system");
  if (denied) return denied;
  try {
    const roster = (await fetchRoster()).filter((u) => u.active);
    const people = await Promise.all(roster.map(async (u) => {
      const [key, grants] = await Promise.all([connectorStatus(u.id), listGrants(u.id)]);
      return { id: u.id, name: u.first || u.name || u.id, key: key.connected ? { createdAt: key.createdAt, lastUsedAt: key.lastUsedAt } : null, grants };
    }));
    return NextResponse.json({ people: people.filter((p) => p.key || p.grants.length) });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't load connections"), { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const denied = await requireSection("system");
  if (denied) return denied;
  const user = (new URL(req.url).searchParams.get("user") || "").toLowerCase();
  if (!(await fetchRoster()).some((u) => u.id === user)) return NextResponse.json({ error: "Unknown person" }, { status: 400 });
  await Promise.all([revokeKey(user), revokeAllGrants(user)]);
  return NextResponse.json({ ok: true });
}
