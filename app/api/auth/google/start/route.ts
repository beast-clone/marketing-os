import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { publicOrigin } from "@/lib/public-origin";

// GET /api/auth/google/start
// Kicks off "Sign in with your GooCampus Google account". If the Google OAuth
// login client isn't configured yet, it bounces back to /login with a friendly
// flag instead of erroring — so the button is safe to show in a demo.

// MUST be dynamic: without this Next statically prerenders this route, freezing a
// single OAuth `state` + Set-Cookie into a year-long CDN cache. Cache hits then
// strip the fresh cookie, so the callback's state check fails ("failed") for anyone
// whose browser doesn't already hold that exact cookie. Force a fresh render (new
// state + fresh cookie) on every request, and never cache it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  // The address the person opened (lib/public-origin): the live site or a preview link
  // comes back to itself; never the deploy-permalink host, which Google would reject.
  const origin = publicOrigin(req);
  const clientId = process.env.GOOGLE_LOGIN_CLIENT_ID;

  if (!clientId) {
    const back = new URL("/login", origin);
    back.searchParams.set("google", "off");
    return NextResponse.redirect(back);
  }

  const state = randomBytes(16).toString("hex");
  const redirectUri = `${origin}/api/auth/google/callback`;

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email profile");
  auth.searchParams.set("state", state);
  auth.searchParams.set("hd", "goocampus.in"); // hint: only the GooCampus workspace
  auth.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(auth);
  res.cookies.set("g_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  res.headers.set("Cache-Control", "no-store, max-age=0"); // never let a CDN cache the state/cookie
  return res;
}
