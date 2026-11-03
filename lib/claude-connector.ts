import { createHash, randomBytes } from "crypto";
import { getSupabase } from "@/lib/supabase";
import { rosterById } from "@/lib/team-db";
import { canConnectClaude } from "@/lib/permissions";

// Personal keys for the Claude connector (/api/mcp). Nandu finalises content in Claude
// Code, then tells Claude to create the task — Claude calls the dashboard with his key.
//
// Only a SHA-256 of the key is stored (discover_cache, no migration): one row maps
// hash → person, one row maps person → their current hash, so issuing a new key
// replaces the old one and revoking kills it. The key itself is shown once.
// Access also needs the "Connect Claude" permission (Team page) — checked on every call.
const SOURCE = "claude_key";
const hash = (k: string) => createHash("sha256").update(k).digest("hex");
type KeyRow = { userId: string; createdAt: string; lastUsedAt?: string };

export async function canUseConnector(userId: string): Promise<boolean> {
  const u = await rosterById(userId);
  return canConnectClaude(u);
}

export async function connectorStatus(userId: string): Promise<{ connected: boolean; createdAt?: string; lastUsedAt?: string }> {
  const sb = getSupabase();
  if (!sb) return { connected: false };
  const { data: me } = await sb.from("discover_cache").select("payload").eq("cache_key", `claude-key-user:${userId}`).eq("source", SOURCE).maybeSingle();
  const h = (me?.payload as { hash?: string } | null)?.hash;
  if (!h) return { connected: false };
  const { data } = await sb.from("discover_cache").select("payload").eq("cache_key", `claude-key:${h}`).eq("source", SOURCE).maybeSingle();
  const row = data?.payload as KeyRow | undefined;
  return row ? { connected: true, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt } : { connected: false };
}

export async function revokeKey(userId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data: me } = await sb.from("discover_cache").select("payload").eq("cache_key", `claude-key-user:${userId}`).eq("source", SOURCE).maybeSingle();
  const h = (me?.payload as { hash?: string } | null)?.hash;
  if (h) await sb.from("discover_cache").delete().eq("cache_key", `claude-key:${h}`).eq("source", SOURCE);
  await sb.from("discover_cache").delete().eq("cache_key", `claude-key-user:${userId}`).eq("source", SOURCE);
}

export async function issueKey(userId: string): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  await revokeKey(userId);
  // The person's id is part of the key (gck_nandu_…) so anyone looking at one can
  // tell whose it is — it identifies, it doesn't unlock; the random part does.
  const key = `gck_${userId.toLowerCase().replace(/[^a-z0-9]/g, "")}_${randomBytes(24).toString("base64url")}`;
  const h = hash(key), now = new Date().toISOString();
  const { error } = await sb.from("discover_cache").upsert([
    { cache_key: `claude-key:${h}`, source: SOURCE, last_fetched: now, payload: { userId, createdAt: now } satisfies KeyRow },
    { cache_key: `claude-key-user:${userId}`, source: SOURCE, last_fetched: now, payload: { hash: h } },
  ], { onConflict: "cache_key" });
  if (error) throw new Error(error.message);
  return key;
}

// Bearer key → the person it belongs to (null if unknown, revoked or not allowed).
export async function userForKey(key: string | null | undefined): Promise<string | null> {
  if (!key || !key.startsWith("gck_")) return null;
  const sb = getSupabase();
  if (!sb) return null;
  const h = hash(key);
  const { data } = await sb.from("discover_cache").select("payload").eq("cache_key", `claude-key:${h}`).eq("source", SOURCE).maybeSingle();
  const row = data?.payload as KeyRow | undefined;
  if (!row || !(await canUseConnector(row.userId))) return null;
  sb.from("discover_cache").update({ payload: { ...row, lastUsedAt: new Date().toISOString() } }).eq("cache_key", `claude-key:${h}`).then(() => {}, () => {});
  return row.userId;
}
