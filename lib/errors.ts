// Sanitize error messages for client-facing JSON responses.
// Server logs the full error; the client only sees a generic message + a request ID.

import { randomUUID } from "crypto";
import { redactUrl } from "@/lib/fetch-with-timeout";

const TOKEN_FRAGMENT_RE = /(EAA[\w]{10,}|sb_secret_\w+|sk-proj-[\w-]+|apify_api_[\w]+|pat[A-Za-z0-9]{10,}\.[\w]+|sp_sk_\w+|nfp_[\w]+)/g;

export function redactSecrets(s: string): string {
  return redactUrl(s).replace(TOKEN_FRAGMENT_RE, "[redacted]");
}

export type SafeError = { error: string; ref?: string };

export function safeError(err: unknown, fallbackMessage = "An unexpected error occurred"): SafeError {
  const ref = randomUUID().slice(0, 8);
  const raw = err instanceof Error ? err.message : String(err);
  // Log the detail server-side, with any key or token in it blanked — the raw
  // error object could carry a Meta key in a URL or message (security audit, 3 Nov 2026).
  const stack = err instanceof Error && err.stack ? err.stack : raw;
  console.error(`[err:${ref}]`, redactSecrets(stack));

  // Only surface short, token-safe messages to the client
  if (!raw) return { error: fallbackMessage, ref };
  const stripped = raw.replace(TOKEN_FRAGMENT_RE, "[redacted]");

  // If the message is suspiciously long, or still looks like a Meta/OpenAI raw error, return a generic one
  if (stripped.length > 200) return { error: fallbackMessage, ref };
  if (/access[_ ]token|app[_ ]secret|api[_ ]key/i.test(stripped)) return { error: "Upstream auth error — check server logs", ref };
  return { error: stripped, ref };
}
