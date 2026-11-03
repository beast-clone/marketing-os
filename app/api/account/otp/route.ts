import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { rosterById } from "@/lib/team-db";
import { getSupabase } from "@/lib/supabase";
import { hashPassword } from "@/lib/passwords";
import { newCode } from "@/lib/invites";
import { sendMail, hasEmail, maskEmail } from "@/lib/email";

// POST /api/account/otp
// Self-service: emails a 6-digit code to the LOGGED-IN user's own address, to be
// entered when changing their password. The code is stored hashed (scrypt) with a
// 10-minute expiry in discover_cache; the plain code only ever lives in the email.
export const dynamic = "force-dynamic";

const TTL_MS = 10 * 60_000;
const otpKey = (uid: string) => `pwd_otp:${uid}`;

export async function POST() {
  const uid = getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const user = await rosterById(uid);
  if (!user?.email) {
    return NextResponse.json({ error: "No email is on file for your account — ask an admin to add one on the Team page." }, { status: 400 });
  }
  if (!(await hasEmail())) {
    return NextResponse.json({ error: "Email sending isn't set up yet (GMAIL_USER / GMAIL_APP_PASSWORD)." }, { status: 503 });
  }

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Database not configured." }, { status: 500 });

  const code = newCode();
  const expiresAt = Date.now() + TTL_MS;

  const { error } = await sb.from("discover_cache").upsert(
    { cache_key: otpKey(uid), source: "pwd_otp", last_fetched: new Date().toISOString(), payload: { codeHash: hashPassword(code), expiresAt } },
    { onConflict: "cache_key" },
  );
  if (error) return NextResponse.json({ error: "Couldn't start the reset — please try again." }, { status: 502 });

  try {
    await sendMail({
      to: user.email,
      subject: "Your GooCampus dashboard verification code",
      text: `Hi ${user.first || user.name || "there"},\n\nYour verification code is ${code}.\nIt expires in 10 minutes. If you didn't request this, you can ignore this email.\n\n— GooCampus Dashboard`,
      html: `<div style="font-family:Inter,Arial,sans-serif;color:#232D42">
        <p>Hi ${user.first || user.name || "there"},</p>
        <p>Your verification code for changing your password is:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px;color:#3A57E8">${code}</p>
        <p style="color:#8A92A6;font-size:13px">It expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
        <p style="color:#8A92A6;font-size:13px">— GooCampus Dashboard</p>
      </div>`,
    });
  } catch {
    return NextResponse.json({ error: "Couldn't send the email — check the mail settings and try again." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, sentTo: maskEmail(user.email) });
}
