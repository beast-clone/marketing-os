// Keeps the LinkedIn access token alive on its own.
//
// LinkedIn access tokens last 2 months. Before this existed, one expiring meant
// posting AND the analytics tab both went dead until someone noticed and pasted a
// new token by hand. The refresh token is good for a year, so renewal can be
// automatic — it just never was.
//
// The new token goes into Supabase (`mh_integration_tokens`), not the env file,
// because a deployed build cannot rewrite its own env. getIntegrationToken()
// already prefers the Supabase row, so both local and Netlify pick it up with no
// redeploy. LinkedIn also hands back a NEW refresh token each time and retires
// the old one, so that gets stored alongside — miss it and the next renewal
// fails with refresh_token_client_mismatch.

import { getIntegrationToken, saveIntegrationToken } from "@/lib/integration-tokens";
import { getSupabase } from "@/lib/supabase";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

// Renew this far ahead of expiry. Comfortably longer than any cron gap, so the
// token is replaced well before anything can 401.
const RENEW_WITHIN_DAYS = 14;

export type RefreshOutcome =
  | { ok: true; refreshed: false; reason: string; expiresAt: string | null }
  | { ok: true; refreshed: true; expiresAt: string }
  | { ok: false; error: string };

async function currentExpiry(): Promise<string | null> {
  const supa = getSupabase();
  if (!supa) return null;
  const { data } = await supa
    .from("mh_integration_tokens")
    .select("expires_at")
    .eq("provider", "linkedin")
    .maybeSingle();
  return (data?.expires_at as string) || null;
}

export async function ensureFreshLinkedInToken(force = false): Promise<RefreshOutcome> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, error: "LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET not set — cannot renew" };
  }

  const expiresAt = await currentExpiry();
  if (!force && expiresAt) {
    const daysLeft = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
    if (daysLeft > RENEW_WITHIN_DAYS) {
      return { ok: true, refreshed: false, reason: `${Math.round(daysLeft)} days left`, expiresAt };
    }
  }

  const refreshToken = await getIntegrationToken("linkedin_refresh");
  if (!refreshToken) return { ok: false, error: "no LinkedIn refresh token stored" };

  const res = await fetchWithTimeout("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    return { ok: false, error: `LinkedIn ${res.status}: ${json.error_description || json.error || "refresh failed"}` };
  }

  const newExpiry = new Date(Date.now() + (json.expires_in || 0) * 1000).toISOString();
  await saveIntegrationToken("linkedin", json.access_token, {
    expiresAt: newExpiry,
    note: "auto-renewed from refresh token",
  });
  // Rotated refresh token — store it or the NEXT renewal is the one that breaks.
  if (json.refresh_token) {
    await saveIntegrationToken("linkedin_refresh", json.refresh_token, { note: "rotated by LinkedIn" });
  }
  return { ok: true, refreshed: true, expiresAt: newExpiry };
}
