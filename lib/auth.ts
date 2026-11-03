// HMAC-signed session cookie + simple CSRF helpers.
// The cookie value is `<random-token>.<hmac-sig>` — only the server (which knows
// SESSION_SECRET) can produce a valid signature, so a leaked SESSION_SECRET
// is still safer than the previous "cookie value equals SESSION_SECRET" pattern.

import { cookies } from "next/headers";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { buildPayload, readPayload } from "@/lib/session-payload";
import { lastKnownRosterUser } from "@/lib/team-db";

const COOKIE = "gc_session";
// No fixed lifetime any more — a session ends with the IST day, so the next
// morning's sign-in is a real sign-in and attendance can stamp it. See
// lib/session-payload.endOfISTDaySec.

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET not set or too short (need 32+ chars)");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Cookie value is `<payload>.<sig>` where payload is either just `<token>` (legacy,
// no identity), `<userId>:<token>` (carries who logged in), or `<userId>:a:<token>`
// (logged in as an admin — the middleware reads this flag to open /dashboard/* without
// a DB lookup; it's inside the signed payload so it can't be forged). The signature
// always covers the whole payload, so the middleware's verify (which signs everything
// before the last dot) keeps working unchanged whichever form is present.
function makeCookieValue(userId?: string | null, isAdmin?: boolean): string {
  // The token starts with when it was issued, so a session can be ended early
  // (ind_users.sessions_since). Same 4-part payload, so the middleware is unchanged.
  const token = `${Math.floor(Date.now() / 1000).toString(36)}_${randomBytes(24).toString("hex")}`;
  const payload = buildPayload(userId, isAdmin, token);
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

/** Seconds until the current session expires — drives the cookie's maxAge. */
function maxAgeFor(payload: string): number {
  const read = readPayload(payload);
  return read ? Math.max(1, read.exp - Math.floor(Date.now() / 1000)) : 1;
}

function parseVerified(value: string | undefined): { valid: boolean; userId: string | null } {
  if (!value || !value.includes(".")) return { valid: false, userId: null };
  const idx = value.lastIndexOf(".");
  const payload = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  if (!payload || !sig) return { valid: false, userId: null };
  try {
    if (!safeEqual(sig, sign(payload))) return { valid: false, userId: null };
  } catch {
    return { valid: false, userId: null };
  }
  // Signature is good. Now: is it still today's session, and who is it?
  // A valid signature on an expired payload is still expired — the whole point
  // of carrying exp inside the signed blob is that this check cannot be skipped
  // by replaying the cookie after the browser would have dropped it.
  const read = readPayload(payload);
  if (!read) return { valid: false, userId: null };
  // Ended early? (sign-out, password change, switched off.) Older tokens carry no
  // issue time and count as issued at 0.
  const since = lastKnownRosterUser(read.userId)?.sessionsSince;
  if (since) {
    const tok = payload.slice(payload.lastIndexOf(":") + 1);
    const iat = tok.includes("_") ? parseInt(tok.split("_")[0], 36) || 0 : 0;
    if (iat < since) return { valid: false, userId: null };
  }
  return { valid: true, userId: read.userId };
}

function verifyCookieValue(value: string | undefined): boolean {
  return parseVerified(value).valid;
}

export function isLoggedIn(): boolean {
  return parseVerified(cookies().get(COOKIE)?.value).valid;
}

// Who is logged in? Returns the userId embedded in the session, or null (legacy session).
export function getSessionUserId(): string | null {
  return parseVerified(cookies().get(COOKIE)?.value).userId;
}

// Is the current session an admin? Reads the signed `:a:` flag in the cookie
// payload (`<userId>:a:<token>`) — the same flag the Edge middleware trusts to
// open /dashboard/*. Lets server components branch on admin without a DB lookup.
//
// The cookie's flag is only what was true at sign-in. When the roster has been read,
// Team & access wins: making someone admin, taking it away, or switching off "Can
// sign in" applies on their next request, not their next login (27 Oct audit, A9).
export function getSessionIsAdmin(): boolean {
  const value = cookies().get(COOKIE)?.value;
  const v = value ? parseVerified(value) : null;
  if (!value || !v?.valid) return false;
  const u = lastKnownRosterUser(v.userId);
  if (u) return u.isAdmin && u.active;
  return readPayload(value.slice(0, value.lastIndexOf(".")))?.isAdmin ?? false;
}

export function setSession(userId?: string | null, isAdmin?: boolean) {
  const value = makeCookieValue(userId, isAdmin);
  cookies().set(COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Matches the exp inside the signed payload, so the browser drops the
    // cookie at the same moment the server stops honouring it.
    maxAge: maxAgeFor(value.slice(0, value.lastIndexOf("."))),
  });
}

export function clearSession() {
  cookies().delete(COOKIE);
}

// Exposed for the middleware (which runs in the Edge runtime and can't use node:crypto directly,
// but Next.js middleware actually CAN use the Web Crypto API; we re-export to keep one source of truth).
export { verifyCookieValue };
