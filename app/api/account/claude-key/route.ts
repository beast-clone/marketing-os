import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { canUseConnector, connectorStatus, issueKey, revokeKey } from "@/lib/claude-connector";
import { listGrants, revokeAllGrants } from "@/lib/oauth";
import { rosterById } from "@/lib/team-db";

// GET    → { allowed, connected, createdAt, lastUsedAt, grants[] }   (System → Connectors)
// POST   → { key }  a new personal key (shown once; replaces any old one)
// DELETE → disconnect: revokes the personal key AND every OAuth token
//
// Two ways to be connected now: the OAuth grants (what the Claude app uses after you
// click Connect) and a personal key (Claude Code, and anything that only takes a URL).
// Disconnect has to clear both, or "Disconnect" would leave one of them live — which
// is worse than not offering the button.
// Allowed only with the "Connect Claude" permission (Team page) or for admins.
export const dynamic = "force-dynamic";

export async function GET() {
  const uid = getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const allowed = await canUseConnector(uid);
  if (!allowed) return NextResponse.json({ allowed: false, connected: false, grants: [] });
  const [status, grants, me] = await Promise.all([connectorStatus(uid), listGrants(uid), rosterById(uid)]);
  return NextResponse.json({ allowed, ...status, grants, who: me?.first || me?.name || uid, isAdmin: !!me?.isAdmin });
}

export async function POST() {
  const uid = getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!(await canUseConnector(uid))) return NextResponse.json({ error: "Ask an admin to switch on “Connect Claude” for you (Team page)." }, { status: 403 });
  return NextResponse.json({ key: await issueKey(uid) });
}

export async function DELETE() {
  const uid = getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  await Promise.all([revokeKey(uid), revokeAllGrants(uid)]);
  return NextResponse.json({ ok: true });
}
