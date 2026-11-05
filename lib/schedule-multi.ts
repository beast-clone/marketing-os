import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
// Cross-post fan-out for the Scheduler.
//
// Given a source Post Scheduler row and a list of "Publish To Page" values, this:
//   1. Updates the source row: sets Publish To Page = pages[0], Schedule Time = iso,
//      Status = "To Be Scheduled".
//   2. For each additional page in pages[1..], reads the source row's copyable fields
//      (particulars, captions, media attachments, primary interest, type, platform,
//      publish-to) and creates a new row with Publish To Page overridden.
//
// n8n's Native Scheduler then fires one publish per row on its next cron tick.

const BASE_ID = "appLdJFTrothBLDc0";
const POST_SCHEDULER_TABLE = "tblMuZHH5c2lP6oTD";

function token(): string {
  const t = process.env.AIRTABLE_API_KEY;
  if (!t) throw new Error("AIRTABLE_API_KEY not configured");
  return t;
}

async function airtableFetch(input: string, init: RequestInit) {
  const r = await fetchWithTimeout(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Airtable ${r.status}: ${text.slice(0, 200)}`);
  }
  return r.json();
}

export async function scheduleMulti(recordId: string, iso: string, pages: string[]): Promise<{ updated: string; created: string[] }> {
  if (pages.length === 0) throw new Error("pages array is empty");
  const first = pages[0];
  const rest = pages.slice(1);

  // 1. Update source row in place.
  await airtableFetch(`https://api.airtable.com/v0/${BASE_ID}/${POST_SCHEDULER_TABLE}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: { "Publish To Page": first, "Schedule Time": iso, Status: "To Be Scheduled" } }),
  });

  if (rest.length === 0) return { updated: recordId, created: [] };

  // 2. Read the source row so we know what to copy.
  const src = await airtableFetch(`https://api.airtable.com/v0/${BASE_ID}/${POST_SCHEDULER_TABLE}/${recordId}`, {
    method: "GET",
  }) as { fields: Record<string, unknown> };

  const f = src.fields;
  function selectName(v: unknown): string {
    if (!v) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object" && v && "name" in v) return String((v as { name?: string }).name || "");
    return "";
  }

  // Attachment fields can be duplicated by passing the URL of each existing attachment
  // — Airtable re-fetches and stores its own copy for the new row.
  const srcAttachments = Array.isArray(f["Media/ Post"]) ? f["Media/ Post"] as Array<{ url?: string }> : [];
  const copyAttachments = srcAttachments
    .filter((a) => a?.url)
    .map((a) => ({ url: a.url as string }));

  // Build the base field-set that every duplicate row will share.
  const baseFields: Record<string, unknown> = {
    Particulars: String(f.Particulars || ""),
    Caption: String(f.Caption || ""),
    "Instagram Caption": String(f["Instagram Caption"] || ""),
    "Facebook Caption": String(f["Facebook Caption"] || ""),
    "Schedule Time": iso,
    Status: "To Be Scheduled",
  };
  const platform = selectName(f.Platform);
  if (platform) baseFields.Platform = platform;
  const type = String(f.Type || "");
  if (type) baseFields.Type = type;
  const primaryInterest = selectName(f["Primary Interest"]);
  if (primaryInterest) baseFields["Primary Interest"] = primaryInterest;
  if (copyAttachments.length > 0) baseFields["Media/ Post"] = copyAttachments;

  // 3. Create one duplicate per remaining page.
  const records = rest.map((page) => ({ fields: { ...baseFields, "Publish To Page": page } }));

  const created = await airtableFetch(`https://api.airtable.com/v0/${BASE_ID}/${POST_SCHEDULER_TABLE}`, {
    method: "POST",
    body: JSON.stringify({ records }),
  }) as { records: Array<{ id: string }> };

  return { updated: recordId, created: (created.records || []).map((r) => r.id) };
}
