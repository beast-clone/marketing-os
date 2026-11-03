import { createHash, randomBytes, randomUUID } from "crypto";
import { getSupabase } from "@/lib/supabase";

// Connectors other than Claude — n8n, another AI tool, a script (System → Connectors,
// Praveen 3 Nov 2026). An admin names one and ticks what it may do; it gets its own
// key and everything it changes goes under its own name, never a person's.
//
// Same storage as the Claude keys (discover_cache, no migration): `connector:<id>`
// holds the connector, `connector-key:<sha256>` points a key at it. Only the hash of
// a key is stored; the key itself is shown once.
const SOURCE = "connector";
const sha = (k: string) => createHash("sha256").update(k).digest("hex");

export const SCOPES = [
  { key: "read", label: "Read tasks", desc: "See tasks, search them, see what's due" },
  { key: "create", label: "Create tasks", desc: "Owner, Primary Interest and type must be given, as for anyone" },
  { key: "update", label: "Change tasks", desc: "Status, priority, owner, caption and content — same checks as a person" },
  { key: "dates", label: "Change dates", desc: "Date changes still wait for admin approval" },
  { key: "radar", label: "Read Content Radar", desc: "What Content Radar has found" },
] as const;
export type Scope = (typeof SCOPES)[number]["key"];

export type Connector = {
  id: string; name: string; scopes: Scope[]; hash: string; keyEnd: string;
  createdBy: string; createdAt: string; lastUsedAt?: string;
};

const db = () => {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  return sb;
};
const cleanScopes = (s: unknown): Scope[] =>
  Array.isArray(s) ? SCOPES.map((x) => x.key).filter((k) => s.includes(k)) : [];
const newKey = (name: string) =>
  `gcx_${name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16) || "connector"}_${randomBytes(24).toString("base64url")}`;

async function save(c: Connector) {
  const now = new Date().toISOString();
  const { error } = await db().from("discover_cache").upsert([
    { cache_key: `connector:${c.id}`, source: SOURCE, last_fetched: now, payload: c },
    { cache_key: `connector-key:${c.hash}`, source: SOURCE, last_fetched: now, payload: { id: c.id } },
  ], { onConflict: "cache_key" });
  if (error) throw new Error(error.message);
}

export async function listConnectors(): Promise<Omit<Connector, "hash">[]> {
  const { data } = await db().from("discover_cache").select("payload").like("cache_key", "connector:%").eq("source", SOURCE);
  return ((data || []).map((r) => r.payload as Connector))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(({ hash: _h, ...c }) => c);
}

async function getConnector(id: string): Promise<Connector | null> {
  const { data } = await db().from("discover_cache").select("payload").eq("cache_key", `connector:${id}`).eq("source", SOURCE).maybeSingle();
  return (data?.payload as Connector) ?? null;
}

/** New connector → its key (shown once). */
export async function createConnector(name: string, scopes: unknown, createdBy: string) {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new Error("Give it a name");
  if ((await listConnectors()).some((c) => c.name.toLowerCase() === clean.toLowerCase())) throw new Error("There's already a connector with that name");
  const key = newKey(clean);
  const c: Connector = { id: randomUUID(), name: clean, scopes: cleanScopes(scopes), hash: sha(key), keyEnd: key.slice(-4), createdBy, createdAt: new Date().toISOString() };
  await save(c);
  return { key, connector: c };
}

/** A new key; the old one stops working at once. */
export async function rotateConnectorKey(id: string): Promise<string> {
  const c = await getConnector(id);
  if (!c) throw new Error("Connector not found");
  await db().from("discover_cache").delete().eq("cache_key", `connector-key:${c.hash}`).eq("source", SOURCE);
  const key = newKey(c.name);
  await save({ ...c, hash: sha(key), keyEnd: key.slice(-4) });
  return key;
}

export async function setConnectorScopes(id: string, scopes: unknown) {
  const c = await getConnector(id);
  if (!c) throw new Error("Connector not found");
  await save({ ...c, scopes: cleanScopes(scopes) });
}

export async function deleteConnector(id: string) {
  const c = await getConnector(id);
  if (!c) return;
  await db().from("discover_cache").delete().in("cache_key", [`connector:${id}`, `connector-key:${c.hash}`]).eq("source", SOURCE);
}

/** Key → its connector (null if unknown or disconnected). Stamps "last used". */
export async function connectorForKey(key: string): Promise<Connector | null> {
  if (!key.startsWith("gcx_")) return null;
  const { data } = await db().from("discover_cache").select("payload").eq("cache_key", `connector-key:${sha(key)}`).eq("source", SOURCE).maybeSingle();
  const id = (data?.payload as { id?: string } | null)?.id;
  const c = id ? await getConnector(id) : null;
  if (!c || c.hash !== sha(key)) return null;
  if (!c.lastUsedAt || Date.now() - Date.parse(c.lastUsedAt) > 60_000) save({ ...c, lastUsedAt: new Date().toISOString() }).catch(() => {});
  return c;
}
