import { randomInt } from "node:crypto";
import type { getSupabase } from "@/lib/supabase";

// Shared shape for dashboard invite codes.
//
// An invite is a 6-digit code, stored scrypt-hashed in discover_cache — the plain
// code only ever exists inside the email. It has its own key prefix so it can never
// collide with a self-service password-reset code (`pwd_otp:`) that the same person
// might have in flight, and a 24-hour life rather than 10 minutes because a new
// joiner may not open their email straight away.

export const INVITE_TTL_MS = 24 * 60 * 60_000;

export const inviteKey = (uid: string) => `invite_otp:${uid}`;

export type InvitePayload = { codeHash?: string; expiresAt?: number; tries?: number };

// Codes are drawn from the OS's secure random source (Math.random is predictable),
// and a code dies after MAX_CODE_TRIES wrong guesses, counted in the database so
// the limit holds across server instances (security audit, 3 Nov 2026).
export const newCode = () => String(randomInt(100000, 1000000));
export const MAX_CODE_TRIES = 5;

/** Records a wrong guess on a stored code; deletes it once it reaches the limit. Returns true when it was burned. */
export async function wrongGuess(
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  key: string,
  payload: { tries?: number } & Record<string, unknown>,
): Promise<boolean> {
  const tries = (payload.tries || 0) + 1;
  if (tries >= MAX_CODE_TRIES) { await sb.from("discover_cache").delete().eq("cache_key", key); return true; }
  await sb.from("discover_cache").update({ payload: { ...payload, tries } }).eq("cache_key", key);
  return false;
}
