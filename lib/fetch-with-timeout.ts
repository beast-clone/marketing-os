// Hardened fetch wrapper — every upstream call (Meta, Apify, OpenAI, HikerAPI,
// SendPulse, Supabase REST) should go through this so one hung connection can't
// freeze a route forever.
//
// Default timeout is 30s — generous enough for paginated Meta calls + OpenAI
// reasoning. Override per-call when you know the budget is tighter (e.g. inbox
// reply should fail fast at 10s).

export const DEFAULT_TIMEOUT_MS = 30_000;

// Anything slower than this gets written to the log with how long it took.
// Three seconds is past the point where a person notices the page is waiting,
// and well short of the timeout, so a call that is merely sluggish — not
// broken — still shows up. Netlify keeps function logs, so this is what makes
// "which upstream is slow today" answerable after the fact instead of needing
// somebody to catch it live.
export const SLOW_MS = 3_000;

// Query values that are secrets (Meta page keys, the app secret, API keys) never
// leave in an error — the URL used to be logged whole (security audit, 3 Nov 2026).
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:access_token|input_token|client_secret|appsecret_proof|fb_exchange_token|api_key|apikey|key|token|secret|code)=)[^&#]*/gi, "$1[redacted]");
}

export class FetchTimeoutError extends Error {
  constructor(public url: string, public timeoutMs: number) {
    super(`Upstream request timed out after ${timeoutMs}ms`);
    this.name = "FetchTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(input, { ...rest, signal: controller.signal });
    const ms = Date.now() - started;
    // Redacted, because these URLs carry page keys and API keys in the query.
    if (ms >= SLOW_MS) console.warn(`[slow upstream] ${ms}ms ${res.status} ${redactUrl(String(input))}`);
    return res;
  } catch (err) {
    const ms = Date.now() - started;
    if ((err as { name?: string })?.name === "AbortError") {
      console.warn(`[upstream timeout] ${ms}ms ${redactUrl(String(input))}`);
      throw new FetchTimeoutError(redactUrl(String(input)), timeoutMs);
    }
    // A call that fails slowly is worth seeing too — a DNS or TLS problem looks
    // like nothing at all in the logs otherwise.
    if (ms >= SLOW_MS) console.warn(`[slow upstream, failed] ${ms}ms ${redactUrl(String(input))}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
