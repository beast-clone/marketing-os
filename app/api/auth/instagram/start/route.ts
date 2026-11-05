import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSessionIsAdmin, isLoggedIn } from "@/lib/auth";
import { ACCOUNTS } from "@/lib/accounts";
import { readRegistry } from "@/lib/brand-accounts";
import { IG_LOGIN_SCOPES, igLoginReady, instagramRedirect } from "@/lib/instagram-login";

// GET /api/auth/instagram/start?brand=goocampus_india
// Brands page → Connect Instagram only (lib/instagram-login.ts): sends an admin to
// Instagram to sign in with the brand's Instagram account — no Facebook Page needed.
// Dynamic: a prerendered copy would freeze one `state` and break every later try.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const here = new URL(req.url);
  const brand = here.searchParams.get("brand") || "";
  const back = (flag: string, why?: string) => {
    const u = new URL("/dashboard/preview/brands", here.origin);
    u.searchParams.set("brand", brand); u.searchParams.set("ig", flag);
    if (why) u.searchParams.set("why", why);
    return NextResponse.redirect(u);
  };
  if (!isLoggedIn()) return NextResponse.redirect(new URL("/login", here.origin));
  if (!getSessionIsAdmin()) return back("failed", "Only an admin can connect a brand's accounts.");
  const known = ACCOUNTS.some((a) => a.id === brand) || (await readRegistry()).added.some((a) => a.id === brand);
  if (!known) return back("failed", "No such brand.");
  if (!igLoginReady()) return back("failed", "Instagram login isn't set up yet — the Instagram app ID and secret are missing on the server.");

  const state = `${randomBytes(16).toString("hex")}.${brand}`;
  const auth = new URL("https://www.instagram.com/oauth/authorize");
  auth.searchParams.set("client_id", process.env.INSTAGRAM_APP_ID!);
  auth.searchParams.set("redirect_uri", instagramRedirect(req.url));
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", IG_LOGIN_SCOPES);
  auth.searchParams.set("state", state);
  // Always ask which account — the browser may already be signed in to another brand's.
  auth.searchParams.set("force_reauth", "true");
  const res = NextResponse.redirect(auth);
  res.cookies.set("ig_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
