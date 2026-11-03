import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getSessionUserId } from "@/lib/auth";
import { safeError } from "@/lib/errors";
import { SCOPES, listConnectors, createConnector, rotateConnectorKey, setConnectorScopes, deleteConnector } from "@/lib/connectors";

// Connectors other than Claude (lib/connectors). Admins only — the System section.
//   GET                               → { connectors, scopes }
//   POST   { name, scopes }           → { key, connector }   (key shown once)
//   PATCH  { id, op: "rotate" }       → { key }
//   PATCH  { id, op: "scopes", scopes } → { ok }
//   DELETE ?id=…                      → { ok }   (its key stops working at once)
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSection("system");
  if (denied) return denied;
  try {
    return NextResponse.json({ connectors: await listConnectors(), scopes: SCOPES });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't load connectors"), { status: 502 });
  }
}

export async function POST(req: Request) {
  const denied = await requireSection("system");
  if (denied) return denied;
  try {
    const b = (await req.json().catch(() => ({}))) as { name?: string; scopes?: unknown };
    const { key, connector } = await createConnector(String(b.name || ""), b.scopes, getSessionUserId() || "");
    const { hash: _h, ...safe } = connector;
    return NextResponse.json({ key, connector: safe });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const denied = await requireSection("system");
  if (denied) return denied;
  try {
    const b = (await req.json().catch(() => ({}))) as { id?: string; op?: string; scopes?: unknown };
    if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
    if (b.op === "rotate") return NextResponse.json({ key: await rotateConnectorKey(b.id) });
    if (b.op === "scopes") { await setConnectorScopes(b.id, b.scopes); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ error: "op must be rotate or scopes" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const denied = await requireSection("system");
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteConnector(id);
  return NextResponse.json({ ok: true });
}
