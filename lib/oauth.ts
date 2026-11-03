import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getSupabase } from "@/lib/supabase";
import { canUseConnector } from "@/lib/claude-connector";

// OAuth for the Claude connector.
//
// The personal-key version worked but made a person carry a secret by hand, and that
// is exactly how it went wrong in practice: setting it up live on 27 Sep 2026 the key
// ended up pasted into a chat window, because the flow asks you to copy a credential
// and put it somewhere. Airtable and the other connectors don't have that failure mode
// because nobody ever sees a key — you click Connect, sign in, approve.
//
// So: the dashboard becomes a small OAuth server. Claude registers itself, sends the
// person here to approve, and gets a token that expires and renews on its own. Manya,
// Nandu and Nikhil never handle a secret.
//
// Stored in discover_cache like the personal keys are — same reasoning, no migration
// needed and the table already holds this kind of short-lived server state. Only
// SHA-256 hashes of codes and tokens are stored, so a dump of the table hands over
// nothing usable.
//
// The personal-key path is deliberately left working alongside this: Claude Code in a
// terminal is happier with a header, and breaking Nandu's existing setup to ship this
// would be rude.

const SOURCE = "oauth";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const secret = () => randomBytes(32).toString("base64url");

export const CODE_TTL_MS = 5 * 60_000;             // an auth code is redeemed seconds after it is issued
export const ACCESS_TTL_MS = 8 * 60 * 60_000;      // short — the refresh token is what gives continuity
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60_000;

export type OAuthClient = { clientId: string; name: string; redirectUris: string[]; createdAt: string };
type CodeRow = { userId: string; clientId: string; redirectUri: string; challenge: string; expiresAt: number };
type TokenRow = { userId: string; clientId: string; expiresAt: number; gen: number };
type GrantRow = { clientId: string; name: string; createdAt: string; lastUsedAt?: string };

const sb = () => {
  const c = getSupabase();
  if (!c) throw new Error("Supabase not configured");
  return c;
};

async function put(key: string, payload: unknown) {
  const { error } = await sb().from("discover_cache").upsert(
    [{ cache_key: key, source: SOURCE, last_fetched: new Date().toISOString(), payload }],
    { onConflict: "cache_key" },
  );
  if (error) throw new Error(error.message);
}

async function get<T>(key: string): Promise<T | null> {
  const { data } = await sb().from("discover_cache").select("payload").eq("cache_key", key).eq("source", SOURCE).maybeSingle();
  return (data?.payload as T) ?? null;
}

async function drop(key: string) {
  await sb().from("discover_cache").delete().eq("cache_key", key).eq("source", SOURCE);
}

/* ------------------------------------------------------------------ clients */

/** A redirect target we're willing to send someone's authorisation code to.
 *
 *  Exact-matching against what the client registered is the real protection; this is a
 *  second fence, so that a registration can't nominate a plain-http address on the open
 *  internet where the code would travel in clear text. Localhost over http is allowed
 *  because a desktop app listening on a loopback port never leaves the machine, and
 *  custom schemes are allowed because that is how native apps receive callbacks. */
export function redirectUriAllowed(uri: string): boolean {
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash) return false;                                   // fragments can't be a redirect target
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  // Native-app scheme, e.g. claude://…  — no host to reason about, so exact match does the work.
  return /^[a-z][a-z0-9+.-]*:$/i.test(u.protocol) && u.protocol !== "javascript:" && u.protocol !== "data:";
}

export async function registerClient(name: string, redirectUris: string[]): Promise<OAuthClient> {
  const clean = redirectUris.map((u) => u.trim()).filter(Boolean);
  if (!clean.length) throw new Error("redirect_uris is required");
  if (clean.length > 10) throw new Error("too many redirect_uris");
  for (const u of clean) if (!redirectUriAllowed(u)) throw new Error(`redirect_uri not allowed: ${u}`);

  const clientId = `gcc_${randomBytes(16).toString("hex")}`;
  const client: OAuthClient = {
    clientId,
    name: (name || "").trim().slice(0, 80) || "Claude",
    redirectUris: clean,
    createdAt: new Date().toISOString(),
  };
  await put(`oauth-client:${clientId}`, client);
  return client;
}

export const getClient = (clientId: string) =>
  clientId ? get<OAuthClient>(`oauth-client:${clientId}`) : Promise.resolve(null);

/* -------------------------------------------------------------- auth codes */

/** Issue a one-time code for a person who has just approved on the consent screen. */
export async function issueCode(args: {
  userId: string; clientId: string; redirectUri: string; challenge: string;
}): Promise<string> {
  const code = secret();
  const row: CodeRow = {
    userId: args.userId, clientId: args.clientId, redirectUri: args.redirectUri,
    challenge: args.challenge, expiresAt: Date.now() + CODE_TTL_MS,
  };
  await put(`oauth-code:${sha(code)}`, row);
  return code;
}

function pkceOk(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  // S256 only. "plain" is in the spec but exists for clients that can't hash, which
  // is nobody here, and it removes the entire point of PKCE.
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed), b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Redeem a code.
 *
 *  Single use: the row is deleted before anything else is checked, so a replay finds
 *  nothing even if it arrives a millisecond later. That also means a WRONG PKCE
 *  verifier burns the code — deliberate. A mismatched verifier means either a broken
 *  client or someone redeeming a code they intercepted, and in the second case the
 *  right move is to make the code worthless rather than leave it available for a
 *  second, better-formed attempt. A genuine client just starts the flow again. */
export async function consumeCode(args: {
  code: string; clientId: string; redirectUri: string; verifier: string;
}): Promise<{ userId: string } | { error: string }> {
  if (!args.code) return { error: "code is required" };
  const key = `oauth-code:${sha(args.code)}`;
  const row = await get<CodeRow>(key);
  await drop(key);
  if (!row) return { error: "invalid_grant" };
  if (row.expiresAt < Date.now()) return { error: "invalid_grant" };
  if (row.clientId !== args.clientId) return { error: "invalid_grant" };
  if (row.redirectUri !== args.redirectUri) return { error: "invalid_grant" };
  if (!pkceOk(args.verifier, row.challenge)) return { error: "invalid_grant" };
  return { userId: row.userId };
}

/* ------------------------------------------------------------------ tokens */

/* ------------------------------------------------------------------ grants
 *
 * Tokens are stored under a hash of themselves, which is right for secrecy but means
 * there is no way to look up "every token belonging to Maheen" in order to revoke it.
 *
 * So each person carries a generation number. Every token records the generation it
 * was minted under, and Disconnect simply increments it — which invalidates every
 * token that person holds, everywhere, at once, without the table ever needing to know
 * which tokens those were.
 */

export const currentGen = async (userId: string): Promise<number> =>
  (await get<{ gen: number }>(`oauth-gen:${userId}`))?.gen ?? 0;

/** Disconnect: every existing token for this person stops working immediately. */
export async function revokeAllGrants(userId: string): Promise<void> {
  const gen = await currentGen(userId);
  await put(`oauth-gen:${userId}`, { gen: gen + 1 });
  const grants = await listGrants(userId);
  for (const g of grants) await drop(`oauth-grant:${userId}:${g.clientId}`);
}

export type { GrantRow };
export async function listGrants(userId: string): Promise<GrantRow[]> {
  const { data } = await sb().from("discover_cache").select("payload")
    .like("cache_key", `oauth-grant:${userId}:%`).eq("source", SOURCE);
  return ((data || []).map((r) => r.payload as GrantRow)).filter(Boolean);
}

export async function issueTokens(userId: string, clientId: string, clientName?: string) {
  const access = secret(), refresh = secret();
  const now = Date.now();
  const gen = await currentGen(userId);
  await put(`oauth-at:${sha(access)}`, { userId, clientId, expiresAt: now + ACCESS_TTL_MS, gen } satisfies TokenRow);
  await put(`oauth-rt:${sha(refresh)}`, { userId, clientId, expiresAt: now + REFRESH_TTL_MS, gen } satisfies TokenRow);
  // So Connectors can show what is connected, and offer to disconnect it.
  // Kept across refreshes so "connected on" stays the day they approved it.
  const prev = await get<GrantRow>(`oauth-grant:${userId}:${clientId}`);
  await put(`oauth-grant:${userId}:${clientId}`, {
    clientId, name: clientName || prev?.name || (await getClient(clientId))?.name || "Claude",
    createdAt: prev?.createdAt || new Date().toISOString(), lastUsedAt: prev?.lastUsedAt,
  } satisfies GrantRow);
  return { access, refresh, expiresIn: Math.floor(ACCESS_TTL_MS / 1000) };
}

/** Access token → the person it belongs to.
 *
 *  Permission is re-checked here, not just at sign-in: taking "Connect Claude" away on
 *  the Team page has to stop an already-issued token, or revoking access would mean
 *  waiting up to eight hours for it to lapse. */
/** Access token → who and which app (e.g. Nandu, "Claude Code"), so each call can be
 *  told apart. Also stamps the connection's "last used" (at most every 5 minutes). */
export async function connectionForAccessToken(tok: string | null | undefined): Promise<{ userId: string; app: string } | null> {
  if (!tok) return null;
  const key = `oauth-at:${sha(tok)}`;
  const row = await get<TokenRow>(key);
  if (!row) return null;
  if (row.expiresAt < Date.now()) { drop(key).catch(() => {}); return null; }
  // Minted before the last Disconnect → dead, whatever its expiry says.
  if ((row.gen ?? 0) !== (await currentGen(row.userId))) return null;
  if (!(await canUseConnector(row.userId))) return null;
  const gkey = `oauth-grant:${row.userId}:${row.clientId}`;
  const grant = await get<GrantRow>(gkey);
  if (grant && (!grant.lastUsedAt || Date.now() - Date.parse(grant.lastUsedAt) > 5 * 60_000)) {
    put(gkey, { ...grant, lastUsedAt: new Date().toISOString() }).catch(() => {});
  }
  return { userId: row.userId, app: grant?.name || "Claude" };
}

/** Refresh tokens rotate: the old one dies as the new pair is minted, so a stolen
 *  refresh token is good for one use and its use is visible (the real client's next
 *  refresh fails). */
export async function rotateRefresh(tok: string, clientId: string) {
  if (!tok) return null;
  const key = `oauth-rt:${sha(tok)}`;
  const row = await get<TokenRow>(key);
  if (!row) return null;
  await drop(key);
  if (row.expiresAt < Date.now() || row.clientId !== clientId) return null;
  if ((row.gen ?? 0) !== (await currentGen(row.userId))) return null;
  if (!(await canUseConnector(row.userId))) return null;
  return { userId: row.userId, ...(await issueTokens(row.userId, clientId)) };
}

/* ------------------------------------------------------------------ issuer */

/** The public origin to put in metadata and redirects.
 *
 *  Pinned to APP_URL rather than the request's host: on Netlify a request can arrive on
 *  a deploy-permalink host, and an issuer that changes per deploy breaks the client's
 *  own checks. Same reason the Google auth routes pin it. */
export function issuer(fallbackUrl: string): string {
  const fromEnv = process.env.APP_URL || process.env.URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return new URL(fallbackUrl).origin;
}
