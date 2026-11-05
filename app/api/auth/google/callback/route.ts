import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/public-origin";
import { cookies } from "next/headers";
import { setSession } from "@/lib/auth";
import { rosterByEmail } from "@/lib/team-db";
import { recordLogin } from "@/lib/attendance";

// GET /api/auth/google/callback?code=...&state=...
// Completes the Google login: verifies state, swaps the code for the user's
// Google email, confirms it's an active @goocampus.in teammate, then mints the
// normal gc_session and sends them into the app. Any failure bounces to /login
// with a reason flag (never a raw error).

// Never cache — this reads the state cookie + query code and sets the session.
export const dynamic = "force-dynamic";

function back(origin: string, reason: string) {
  const u = new URL("/login", origin);
  u.searchParams.set("google", reason);
  return NextResponse.redirect(u);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  // Must match the origin used in /start (and a URI registered in Google) — the same
  // helper picks it (lib/public-origin).
  const origin = publicOrigin(req);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = cookies();
  const savedState = jar.get("g_oauth_state")?.value;
  jar.delete("g_oauth_state");

  if (!code || !state || !savedState || state !== savedState) return back(origin, "failed");

  const clientId = process.env.GOOGLE_LOGIN_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_LOGIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) return back(origin, "off");

  try {
    // 1) exchange the code for an access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${origin}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return back(origin, "failed");
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) return back(origin, "failed");

    // 2) read the verified email
    const uiRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!uiRes.ok) return back(origin, "failed");
    const ui = (await uiRes.json()) as { email?: string; email_verified?: boolean };
    const email = (ui.email || "").toLowerCase();

    // 3) only verified GooCampus workspace emails
    if (!email || ui.email_verified === false || !email.endsWith("@goocampus.in")) {
      return back(origin, "denied");
    }

    // 4) must be an active teammate in the roster
    const person = await rosterByEmail(email);
    if (!person || !person.active) return back(origin, "unknown");

    // 5) log them in exactly like the password flow — clock-in included
    setSession(person.id, person.isAdmin);
    await recordLogin(person.id);
    return NextResponse.redirect(new URL(person.isAdmin ? "/dashboard" : "/me", origin));
  } catch {
    return back(origin, "failed");
  }
}
