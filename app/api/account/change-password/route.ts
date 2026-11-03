import { NextResponse } from "next/server";
import { getSessionUserId, getSessionIsAdmin, setSession } from "@/lib/auth";
import { endSessions } from "@/lib/team-db";
import { getSupabase } from "@/lib/supabase";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { wrongGuess } from "@/lib/invites";

// POST /api/account/change-password  { code, newPassword }
// Verifies the emailed OTP (from /api/account/otp) for the LOGGED-IN user, then sets
// their own password_hash. Self-service — no admin needed, only the session user.
export const dynamic = "force-dynamic";

const MIN_LEN = 8;
const otpKey = (uid: string) => `pwd_otp:${uid}`;

export async function POST(req: Request) {
  const uid = getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let code = "", newPassword = "";
  try {
    const body = await req.json();
    code = typeof body?.code === "string" ? body.code.trim() : "";
    newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  if (newPassword.length < MIN_LEN) {
    return NextResponse.json({ error: `Password must be at least ${MIN_LEN} characters.` }, { status: 400 });
  }
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the 6-digit code from your email." }, { status: 400 });
  }

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Database not configured." }, { status: 500 });

  const { data: row } = await sb.from("discover_cache").select("payload").eq("cache_key", otpKey(uid)).single();
  const otp = row?.payload as { codeHash?: string; expiresAt?: number; tries?: number } | undefined;
  if (!otp?.codeHash || !otp.expiresAt) {
    return NextResponse.json({ error: "No active code — request a new one." }, { status: 400 });
  }
  if (Date.now() > otp.expiresAt) {
    await sb.from("discover_cache").delete().eq("cache_key", otpKey(uid));
    return NextResponse.json({ error: "That code has expired — request a new one." }, { status: 400 });
  }
  if (!verifyPassword(code, otp.codeHash)) {
    if (await wrongGuess(sb, otpKey(uid), otp)) return NextResponse.json({ error: "Too many wrong codes — request a new one." }, { status: 400 });
    return NextResponse.json({ error: "That code isn't right — check your email and try again." }, { status: 400 });
  }

  const { error } = await sb.from("ind_users").update({ password_hash: hashPassword(newPassword) }).eq("id", uid);
  if (error) return NextResponse.json({ error: "Couldn't update the password — please try again." }, { status: 502 });

  // A new password ends every other session; this browser gets a fresh one.
  const wasAdmin = getSessionIsAdmin();
  await endSessions(uid);
  setSession(uid, wasAdmin);

  // One-time code — burn it after a successful change.
  await sb.from("discover_cache").delete().eq("cache_key", otpKey(uid)).then(() => {}, () => {});

  return NextResponse.json({ ok: true });
}
