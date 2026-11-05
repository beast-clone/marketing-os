import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionIsAdmin, isLoggedIn } from "@/lib/auth";
import { getConfiguredAccounts } from "@/lib/instagram";
import { saveInstagramLogin, instagramRedirect } from "@/lib/instagram-login";

// GET /api/auth/instagram/callback?code=…&state=<nonce>.<brand>
// Where Instagram sends the admin back. Saves the brand's Instagram key and returns to
// the Brands page with a flag the page turns into a sentence.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const here = new URL(req.url);
  const state = here.searchParams.get("state") || "";
  const brand = state.split(".")[1] || "";
  const back = (flag: string, why?: string) => {
    const u = new URL("/dashboard/preview/brands", here.origin);
    u.searchParams.set("brand", brand); u.searchParams.set("ig", flag);
    if (why) u.searchParams.set("why", why.slice(0, 200));
    const res = NextResponse.redirect(u);
    res.cookies.delete("ig_oauth_state");
    return res;
  };
  if (!isLoggedIn()) return NextResponse.redirect(new URL("/login", here.origin));
  if (!getSessionIsAdmin()) return back("failed", "Only an admin can connect a brand's accounts.");
  if (here.searchParams.get("error")) return back("failed", "Instagram permission was cancelled. Nothing changed.");
  const code = (here.searchParams.get("code") || "").replace(/#_$/, "");   // Instagram appends #_
  if (!code || !state || state !== cookies().get("ig_oauth_state")?.value) {
    return back("failed", "The sign-in took too long or was started somewhere else. Try again.");
  }
  try {
    const taken = (igUserId: string) => getConfiguredAccounts().find((a) => a.igUserId === igUserId)?.id ?? null;
    const handle = await saveInstagramLogin(code, instagramRedirect(req), brand, taken);
    return back("connected", handle);
  } catch (e) {
    return back("failed", (e as Error).message);
  }
}
