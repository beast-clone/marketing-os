import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
// DataForSEO, for GEO SEO (28 Oct). Login + API password from DATAFORSEO_LOGIN /
// DATAFORSEO_PASSWORD (the API password, not the website sign-in).
//
// Every call answers with { tasks: [{ status_code, status_message, cost, id, result }] }.
// 20000 = ok, 20100 = task created; anything else is an error for that task.

const BASE = "https://api.dataforseo.com";

export type DfsTask = { id: string; status_code: number; status_message: string; cost?: number; tag?: string; result?: Record<string, unknown>[] | null };

export function hasDataForSeo(): boolean {
  return !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

async function call(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 50_000): Promise<DfsTask[]> {
  if (!hasDataForSeo()) throw new Error("DataForSEO isn't connected (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).");
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString("base64");
  const res = await fetchWithTimeout(BASE + path, {
    method, cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { status_code?: number; status_message?: string; tasks?: DfsTask[] } | null;
  if (!json) throw new Error(`DataForSEO answered ${res.status}`);
  if (json.status_code && json.status_code >= 40000) throw new Error(`DataForSEO: ${json.status_message}`);
  return json.tasks || [];
}

export const dfsPost = (path: string, body: unknown, timeoutMs?: number) => call("POST", path, body, timeoutMs);
export const dfsGet = (path: string, timeoutMs?: number) => call("GET", path, undefined, timeoutMs);

/** Account: balance, total added, today's spend and requests, the daily spend cap. */
export async function dfsAccount() {
  const [t] = await dfsGet("/v3/appendix/user_data");
  type Day = { day?: { total?: number } };
  const r = (t?.result?.[0] || {}) as { login?: string; money?: { total?: number; balance?: number; limits?: Day; statistics?: Day }; rates?: { statistics?: Day } };
  return {
    login: r.login || "",
    balance: r.money?.balance ?? null,
    totalAdded: r.money?.total ?? null,
    dayLimitUsd: r.money?.limits?.day?.total ?? null,
    spentToday: r.money?.statistics?.day?.total ?? null,
    requestsToday: r.rates?.statistics?.day?.total ?? null,
  };
}

/** DataForSEO's own error log (last 100). */
export async function dfsErrors() {
  const [t] = await dfsPost("/v3/appendix/errors", [{ limit: 100 }]);
  if (!t || t.status_code !== 20000) return [];
  return ((t.result || []) as { id?: string; datetime?: string; function?: string; error_code?: number; error_message?: string; http_url?: string }[])
    .map((e) => ({ id: e.id || "", at: e.datetime || "", what: e.function || e.http_url || "", code: e.error_code ?? null, message: e.error_message || "" }));
}
