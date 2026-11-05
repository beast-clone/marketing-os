// Mints a Google API access token from the GA4 service account (zero-dependency
// JWT, same pattern as lib/ga4.ts) for ANY read scope. Kept separate so adding a
// second Google API (Search Console) doesn't touch the working GA4 path.
// Credentials: GA4_CLIENT_EMAIL / GA4_PRIVATE_KEY in .env.local.
import crypto from "crypto";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const CLIENT_EMAIL = process.env.GA4_CLIENT_EMAIL || "";
const PRIVATE_KEY = (process.env.GA4_PRIVATE_KEY || "").replace(/\\n/g, "\n");

export const SERVICE_ACCOUNT_EMAIL = CLIENT_EMAIL;
export function hasGoogleServiceAccount(): boolean {
  return Boolean(CLIENT_EMAIL && PRIVATE_KEY);
}

const b64url = (s: string | Buffer) =>
  Buffer.from(s).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

// One cached token per scope (a token is scope-bound).
const cache = new Map<string, { token: string; exp: number }>();

export async function googleAccessToken(scope: string): Promise<string> {
  const hit = cache.get(scope);
  if (hit && Date.now() < hit.exp - 60_000) return hit.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: CLIENT_EMAIL, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  signer.end();
  const jwt = `${header}.${claim}.${b64url(signer.sign(PRIVATE_KEY))}`;

  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`Google token error: ${JSON.stringify(json)}`);
  cache.set(scope, { token: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 });
  return json.access_token;
}
