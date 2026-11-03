import { NextResponse } from "next/server";
import { rosterByEmail, endSessions } from "@/lib/team-db";
import { getSupabase } from "@/lib/supabase";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { inviteKey, wrongGuess, type InvitePayload } from "@/lib/invites";

// POST /api/account/accept-invite  { email, code, newPassword }
//
// The one public write in the account area: a new team member turns the code an
// admin emailed them into a password of their own choosing. No session exists yet,
// which is the whole point — so it is rate-limited by IP, and every failure returns
// the same wording whether the email is unknown, the code is wrong, or the code has
// expired. Anything more specific would turn this into a way to test which
// addresses are on the roster.
export const dynamic = "force-dynamic";

const MIN_LEN = 8;
const BAD = "That email and code don't match an active invite. Check the email, or ask for a new invite.";

export async function POST(req: Request) {
  const ip = getClientIp(req.headers);
  const gate = rateLimit(`accept-invite:${ip}`, 10, 10 * 60_000);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${Math.ceil((gate.retryAfterSec || 60) / 60)} minute(s).` },
      { status: 429 },
    );
  }

  let email = "", code = "", newPassword = "";
  try {
    const body = await req.json();
    email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    code = typeof body?.code === "string" ? body.code.trim() : "";
    newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  if (!email || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter your email and the 6-digit code from the invite." }, { status: 400 });
  }
  if (newPassword.length < MIN_LEN) {
    return NextResponse.json({ error: `Password must be at least ${MIN_LEN} characters.` }, { status: 400 });
  }

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Database not configured." }, { status: 500 });

  const user = await rosterByEmail(email);
  if (!user) return NextResponse.json({ error: BAD }, { status: 400 });

  const { data: row } = await sb.from("discover_cache").select("payload").eq("cache_key", inviteKey(user.id)).single();
  const invite = row?.payload as InvitePayload | undefined;
  if (!invite?.codeHash || !invite.expiresAt) return NextResponse.json({ error: BAD }, { status: 400 });
  if (Date.now() > invite.expiresAt) {
    await sb.from("discover_cache").delete().eq("cache_key", inviteKey(user.id));
    return NextResponse.json({ error: "That invite has expired — ask for a new one." }, { status: 400 });
  }
  if (!verifyPassword(code, invite.codeHash)) {
    if (await wrongGuess(sb, inviteKey(user.id), invite)) return NextResponse.json({ error: "Too many wrong codes — that code no longer works. Ask for a new one." }, { status: 400 });
    return NextResponse.json({ error: BAD }, { status: 400 });
  }

  const { error } = await sb.from("ind_users").update({ password_hash: hashPassword(newPassword) }).eq("id", user.id);
  if (error) return NextResponse.json({ error: "Couldn't set the password — please try again." }, { status: 502 });

  // A reset password ends any session still open with the old one.
  await endSessions(user.id).catch(() => {});

  // One-time: burn the code so the same email can't be replayed.
  await sb.from("discover_cache").delete().eq("cache_key", inviteKey(user.id)).then(() => {}, () => {});

  return NextResponse.json({ ok: true, name: user.first || user.name || "" });
}
