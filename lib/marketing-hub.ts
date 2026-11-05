import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
// Read-only client for the GooCampus Marketing Hub Airtable base.
//
// Base: appLdJFTrothBLDc0
// Tables used:
//   Content Calendar (tblRlOFss2lDKE9EG) — 4,294 rows, the main planning surface
//
// NO WRITES in Phase 1. When we add creates/edits later, they'll shadow-write
// to Airtable + Supabase; do not add PATCH/POST helpers here until then.

export const MARKETING_HUB_BASE = "appLdJFTrothBLDc0";
export const CONTENT_CALENDAR_TABLE = "tblRlOFss2lDKE9EG";

function token(): string {
  const t = process.env.AIRTABLE_API_KEY;
  if (!t) throw new Error("AIRTABLE_API_KEY not configured");
  return t;
}

type AirtableListResponse<T = Record<string, unknown>> = {
  records: Array<{ id: string; fields: T; createdTime?: string }>;
  offset?: string;
};

export async function airtableList<T = Record<string, unknown>>(
  tableId: string,
  params: {
    filterByFormula?: string;
    /** Only records in this view, with the view's own filters applied. */
    view?: string;
    fields?: string[];
    pageSize?: number;
    maxRecords?: number;
    sort?: Array<{ field: string; direction?: "asc" | "desc" }>;
  } = {},
): Promise<Array<{ id: string; fields: T; createdTime?: string }>> {
  const out: Array<{ id: string; fields: T; createdTime?: string }> = [];
  let offset: string | undefined;
  const cap = params.maxRecords ?? 50_000;

  do {
    const qs = new URLSearchParams();
    qs.set("pageSize", String(params.pageSize ?? 100));
    if (params.filterByFormula) qs.set("filterByFormula", params.filterByFormula);
    if (params.view) qs.set("view", params.view);
    (params.fields || []).forEach((f) => qs.append("fields[]", f));
    (params.sort || []).forEach((s, i) => {
      qs.append(`sort[${i}][field]`, s.field);
      if (s.direction) qs.append(`sort[${i}][direction]`, s.direction);
    });
    if (offset) qs.set("offset", offset);

    const r = await fetchWithTimeout(`https://api.airtable.com/v0/${MARKETING_HUB_BASE}/${tableId}?${qs}`, {
      headers: { Authorization: `Bearer ${token()}` },
      cache: "no-store",
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Airtable ${r.status}: ${text.slice(0, 200)}`);
    }
    const json = (await r.json()) as AirtableListResponse<T>;
    for (const rec of json.records) {
      out.push({ id: rec.id, fields: rec.fields, createdTime: rec.createdTime });
      if (out.length >= cap) return out;
    }
    offset = json.offset;
  } while (offset);

  return out;
}

export function pickName(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(pickName).filter(Boolean).join(", ");
  if (typeof v === "object" && v) {
    const o = v as Record<string, unknown>;
    if (typeof o.name === "string") return o.name;
    if (typeof o.email === "string") return o.email;
    if (typeof o.url === "string") return o.url;
  }
  return "";
}

export function pickList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(pickName).filter(Boolean);
  const single = pickName(v);
  return single ? [single] : [];
}

export function pickAttachments(v: unknown): { url: string; filename: string; type?: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a) => a && typeof a === "object")
    .map((a) => {
      const o = a as Record<string, unknown>;
      return {
        url: typeof o.url === "string" ? o.url : "",
        filename: typeof o.filename === "string" ? o.filename : "",
        type: typeof o.type === "string" ? o.type : undefined,
      };
    })
    .filter((a) => a.url);
}

// The active marketing team (Sramana removed 2026-07-06; no Team-1/Team-2 splits).
export const MARKETING_TEAM = ["Nikhil", "Nandu", "Praveen", "Manya", "Maheen Ejaz"] as const;
