import { getIntegrationToken, saveIntegrationToken } from "@/lib/integration-tokens";
import { getSupabase } from "@/lib/supabase";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

// Sending mail as a GooCampus Google account, through the Gmail API rather than
// SMTP. This exists because the dashboard already has a Google OAuth client (the
// one behind "Sign in with Google"), so connecting mail is a scope on something
// that already works instead of a second credential to create and look after.
//
// What is stored, in mh_integration_tokens:
//   "gmail"          the account currently sending, address in `note`
//   "gmail:<email>"  every account that has ever been connected
//
// The second set is what makes switching sender free. A grant is per address and
// it lasts, so once info@ has agreed we never need to ask it again — picking it
// from the dropdown just copies its refresh token into the active row. Access
// tokens are minted on demand and never stored: they last an hour, and a dead one
// in a table is worse than no row at all.
//
// The scope is gmail.send only: permission to send, not to read a single message.

const CLIENT_ID = process.env.GOOGLE_LOGIN_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_LOGIN_CLIENT_SECRET || "";

export const GMAIL_SCOPES = "openid email https://www.googleapis.com/auth/gmail.send";
export function hasGoogleClient(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

// The address mail will go out as, or null when nobody has connected one.
export async function gmailSender(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data } = await sb.from("mh_integration_tokens").select("note").eq("provider", "gmail").maybeSingle();
    return (data?.note as string) || null;
  } catch { return null; }
}

export async function hasGmailApi(): Promise<boolean> {
  if (!hasGoogleClient()) return false;
  return !!(await getIntegrationToken("gmail"));
}

// Access tokens live an hour; keep one in memory so a run of notices is one mint,
// not one per message. Fifty minutes, so it is never used in its last stretch.
let access: { token: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  if (access && Date.now() < access.until) return access.token;
  const refresh = await getIntegrationToken("gmail");
  if (!refresh) throw new Error("Gmail is not connected.");
  const r = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const j = (await r.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !j.access_token) {
    // A revoked or expired consent lands here. Say so plainly — "invalid_grant"
    // on its own has sent people hunting for the wrong problem.
    const why = j.error === "invalid_grant"
      ? "Google has revoked the connection (password change, or consent removed). Connect Gmail again."
      : j.error_description || j.error || `HTTP ${r.status}`;
    throw new Error(why);
  }
  access = { token: j.access_token, until: Date.now() + Math.min((j.expires_in || 3600), 3000) * 1000 };
  return access.token;
}

// Exchange the one-time code from the consent screen for a lasting refresh token,
// and remember which address agreed to it.
export async function saveGmailGrant(code: string, redirectUri: string): Promise<string> {
  const r = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const j = (await r.json()) as { refresh_token?: string; id_token?: string; error_description?: string; error?: string };
  if (!r.ok) throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
  if (!j.refresh_token) {
    // Google only hands one out on the first consent unless asked properly; the
    // start route sends prompt=consent so this should not happen.
    throw new Error("Google returned no refresh token. Remove the app at myaccount.google.com/permissions and connect again.");
  }
  // The id_token carries the address that consented — no extra read scope needed.
  let email = "";
  try {
    const payload = JSON.parse(Buffer.from((j.id_token || "").split(".")[1] || "", "base64").toString("utf8")) as { email?: string };
    email = payload.email || "";
  } catch { /* fall through to the error below */ }
  if (!email) throw new Error("Couldn't read which Google account was connected.");
  // Both: the active sender, and this address remembered for next time.
  await saveIntegrationToken("gmail", j.refresh_token, { note: email });
  await saveIntegrationToken(`gmail:${email.toLowerCase()}`, j.refresh_token, { note: email });
  access = null;
  return email;
}

// Every address that has agreed, so the dropdown can offer them.
export async function listGmailAccounts(): Promise<string[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data } = await sb.from("mh_integration_tokens").select("note").like("provider", "gmail:%");
    const list = [...new Set(((data || []) as { note: string | null }[]).map((r) => r.note || "").filter(Boolean))];
    // An account connected before per-address rows existed has no remembered copy,
    // so switching away from it would be one-way. Mirror it the first time we look.
    const { data: live } = await sb.from("mh_integration_tokens").select("token, note").eq("provider", "gmail").maybeSingle();
    const active = (live?.note as string) || "";
    if (active && live?.token && !list.some((e) => e.toLowerCase() === active.toLowerCase())) {
      await saveIntegrationToken(`gmail:${active.toLowerCase()}`, live.token as string, { note: active });
      list.push(active);
    }
    return list.sort();
  } catch { return []; }
}

// Make a remembered account the one that sends. No trip to Google: its grant is
// already held, and consent is per address rather than per session.
export async function switchGmailSender(email: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data } = await sb.from("mh_integration_tokens").select("token, note").eq("provider", `gmail:${email.toLowerCase()}`).maybeSingle();
  if (!data?.token) throw new Error("That account hasn’t been connected — use Connect another account.");
  await saveIntegrationToken("gmail", data.token as string, { note: (data.note as string) || email });
  access = null;
}

// Disconnect forgets the lot, not just which one is active — somebody turning
// sending off expects the grants gone, not parked where one click revives them.
// Google keeps its own record until it is removed at myaccount.google.com/permissions.
export async function disconnectGmail(): Promise<void> {
  const sb = getSupabase();
  if (sb) {
    await sb.from("mh_integration_tokens").delete().eq("provider", "gmail");
    await sb.from("mh_integration_tokens").delete().like("provider", "gmail:%");
  }
  access = null;
}

// Googles errors put the cause in the first sentence and then a paragraph of
// console links. safeError() replaces anything over 200 characters with a generic
// line, so the whole diagnosis was arriving as "Gmail refused the message" and the
// real reason — the Gmail API not being enabled — only existed in the server log.
const firstSentence = (s: string) => (s.split(/(?<=.)s/)[0] || s).trim().slice(0, 160);

// ── building the message ─────────────────────────────────────────────────────
// A header that is not plain ASCII has to be encoded or Gmail mangles it, and the
// counselling notices are routinely in Kannada.
const header = (v: string) =>
  // eslint-disable-next-line no-control-regex
  /^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;

function rfc822({ from, to, subject, text, html }: { from: string; to: string; subject: string; text?: string; html?: string }): string {
  const boundary = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const head = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${header(subject)}`,
    "MIME-Version: 1.0",
  ];
  // Both parts when we have both, so a plain-text client still gets something
  // readable rather than a wall of markup.
  if (text && html) {
    return [
      ...head,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(text, "utf8").toString("base64"),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(html, "utf8").toString("base64"),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }
  const body = html || text || "";
  return [
    ...head,
    `Content-Type: text/${html ? "html" : "plain"}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf8").toString("base64"),
    "",
  ].join("\r\n");
}

export async function sendViaGmail(msg: { to: string; subject: string; text?: string; html?: string; fromName?: string }): Promise<void> {
  const addr = await gmailSender();
  if (!addr) throw new Error("Gmail is not connected.");
  const from = msg.fromName ? `${header(msg.fromName)} <${addr}>` : addr;
  const raw = Buffer.from(rfc822({ from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html }), "utf8")
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const r = await fetchWithTimeout("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!r.ok) {
    const t = await r.text();
    let why = t.slice(0, 300);
    try { why = (JSON.parse(t) as { error?: { message?: string } }).error?.message || why; } catch { /* keep the raw text */ }
    throw new Error(`Gmail refused it: ${firstSentence(why)}`);
  }
}
