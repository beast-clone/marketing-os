import { NextResponse } from "next/server";
import { clearSession, getSessionUserId } from "@/lib/auth";
import { endSessions } from "@/lib/team-db";

// The logout buttons (header menu + sidebar) submit a plain HTML <form method="post">,
// which NAVIGATES the browser to this response. So instead of returning JSON (which
// left the user staring at {"ok":true}), redirect after clearing the session.
// 303 → the browser follows with a GET. APP_URL keeps the URL on the real prod
// origin (on Netlify req.url is the deploy-permalink host).
//
// Signing out lands on the marketing page rather than straight back at /login:
// being dumped on a password box reads like the sign-out failed.
export async function POST(req: Request) {
  // Signing out ends this person's sessions on every device, so a copied cookie
  // stops working too (security audit, 3 Nov 2026).
  await endSessions(getSessionUserId()).catch(() => {});
  clearSession();
  const origin = (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, "");
  return NextResponse.redirect(`${origin}/landing.html`, 303);
}
