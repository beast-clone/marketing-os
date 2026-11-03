import { NextResponse } from "next/server";
import { rosterByEmail } from "@/lib/team-db";
import { getSupabase } from "@/lib/supabase";
import { hashPassword } from "@/lib/passwords";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { inviteKey, newCode } from "@/lib/invites";
import { sendMail, hasEmail } from "@/lib/email";

// POST /api/account/forgot-password  { email }
//
// The way back in for someone who has forgotten their password. Until this
// existed there was none: the shared team password was removed on 4 Oct so every
// account needs its own, and the only recovery routes left were Google sign-in
// (which does not work outside production) or an admin running
// scripts/set-password.ts. Anyone else was simply locked out.
//
// It emails a 6-digit code and stops there. The second half — code plus new
// password — is already built and public at /api/account/accept-invite, and this
// writes the code in exactly the shape that route reads, so there is one
// verification path rather than two that can drift apart.
//
// Shorter-lived than an invite: a reset is something you asked for seconds ago,
// where a new joiner may not open their email until tomorrow. accept-invite
// honours whatever expiresAt it finds, so the same key carries both.
//
// It answers the same way whether or not the address is on the roster. The
// login route goes to some length to avoid confirming which addresses are real;
// an endpoint that said "no such account" would hand that back, and this one
// needs no session at all.
export const dynamic = "force-dynamic";

const RESET_TTL_MS = 15 * 60_000;
const SENT = "If that address is on the team, a code is on its way. It expires in 15 minutes.";

export async function POST(req: Request) {
  // Two limits. By IP, to stop someone walking the roster; by address, so one
  // person's inbox can't be used as a weapon even from many IPs.
  const ip = getClientIp(req.headers);
  const byIp = rateLimit(`forgot:${ip}`, 5, 15 * 60_000);
  if (!byIp.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${Math.ceil((byIp.retryAfterSec || 60) / 60)} minute(s).` },
      { status: 429 },
    );
  }

  let email = "";
  try {
    const body = await req.json();
    email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter the email address you sign in with." }, { status: 400 });
  }

  // Configuration problems are worth saying out loud — they reveal nothing about
  // who is on the roster, and a silent success here would strand the person.
  if (!(await hasEmail())) {
    return NextResponse.json({ error: "Email isn't set up on this dashboard, so a code can't be sent. Ask an admin." }, { status: 503 });
  }
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Database not configured." }, { status: 500 });

  const byEmail = rateLimit(`forgot-addr:${email}`, 3, 15 * 60_000);
  if (!byEmail.allowed) return NextResponse.json({ ok: true, message: SENT });

  const user = await rosterByEmail(email);
  // Unknown address, deactivated account, or no email on file: same answer, and
  // nothing sent. Deactivation is deliberately indistinguishable here, for the
  // same reason the login route checks it only after the password.
  if (!user || !user.active || !user.email) {
    return NextResponse.json({ ok: true, message: SENT });
  }

  const code = newCode();
  const expiresAt = Date.now() + RESET_TTL_MS;

  // Same key an invite uses, so a reset replaces any invite still in flight for
  // this person rather than leaving two live codes. Only the hash is stored; the
  // code itself exists in the email and nowhere else.
  const { error } = await sb.from("discover_cache").upsert(
    { cache_key: inviteKey(user.id), source: "invite_otp", last_fetched: new Date().toISOString(), payload: { codeHash: hashPassword(code), expiresAt } },
    { onConflict: "cache_key" },
  );
  if (error) return NextResponse.json({ error: "Couldn't start the reset — please try again." }, { status: 502 });

  const who = user.first || user.name || "there";
  try {
    await sendMail({
      to: user.email,
      subject: "Reset your GooCampus dashboard password",
      text: `Hi ${who},\n\nYour password reset code is ${code}.\nIt expires in 15 minutes.\n\nIf you didn't ask for this, ignore this email — your password hasn't changed.\n\n— GooCampus Dashboard`,
      html: `<div style="font-family:Inter,Arial,sans-serif;color:#232D42">
        <p>Hi ${who},</p>
        <p>Here's the code to reset your dashboard password:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px;color:#3A57E8">${code}</p>
        <p style="color:#8A92A6;font-size:13px">It expires in 15 minutes.</p>
        <p style="color:#8A92A6;font-size:13px">If you didn't ask for this, you can ignore this email — your password hasn't changed.</p>
        <p style="color:#8A92A6;font-size:13px">— GooCampus Dashboard</p>
      </div>`,
    });
  } catch {
    return NextResponse.json({ error: "Couldn't send the email — please try again shortly." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, message: SENT });
}
