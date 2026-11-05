// Google Sheets, read and written with the dashboard's existing service account
// (GA4_CLIENT_EMAIL / GA4_PRIVATE_KEY — the same one Analytics and Search Console
// use). No per-person consent and no token expiry: a sheet is reachable once it
// has been shared with that account's email.
//
// Leads are never copied anywhere. These functions are the whole storage layer.

import { googleAccessToken, SERVICE_ACCOUNT_EMAIL } from "@/lib/google-jwt";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/** Pulls the id out of a full Sheets URL, or accepts a bare id. */
export function spreadsheetIdFrom(input: string): string | null {
  const s = (input || "").trim();
  if (!s) return null;
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  // A bare id: Google's are long and have no slashes or spaces.
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return null;
}

export class SheetError extends Error {
  constructor(message: string, readonly kind: "not-shared" | "not-found" | "api-off" | "other") {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await googleAccessToken(SCOPE);
  const res = await fetchWithTimeout(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body as T;

  // Turn Google's errors into something a person can act on. "403" on its own
  // sends someone hunting; "share it with this address" does not.
  const reason = body?.error?.details?.[0]?.reason || "";
  const msg = body?.error?.message || `Sheets API error ${res.status}`;
  if (reason === "SERVICE_DISABLED") {
    throw new SheetError("The Google Sheets API is switched off for this project.", "api-off");
  }
  if (res.status === 403) {
    throw new SheetError(
      `The dashboard can't open that sheet. Share it with ${SERVICE_ACCOUNT_EMAIL} as an Editor, then try again.`,
      "not-shared",
    );
  }
  if (res.status === 404) {
    throw new SheetError("No sheet with that link — check the URL.", "not-found");
  }
  throw new SheetError(msg, "other");
}

export type SheetTab = { title: string; rows: number; columns: number };

/** Tab names in a spreadsheet, plus its title. */
export async function listTabs(spreadsheetId: string): Promise<{ title: string; tabs: SheetTab[] }> {
  const j = await call<{
    properties?: { title?: string };
    sheets?: { properties?: { title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[];
  }>(`/${spreadsheetId}?fields=properties.title,sheets.properties(title,gridProperties)`);

  return {
    title: j.properties?.title || "Untitled",
    tabs: (j.sheets || []).map((s) => ({
      title: s.properties?.title || "",
      rows: s.properties?.gridProperties?.rowCount || 0,
      columns: s.properties?.gridProperties?.columnCount || 0,
    })).filter((t) => t.title),
  };
}

export type SheetData = {
  headers: string[];
  /** One object per row, keyed by header. Blank trailing rows are dropped. */
  rows: Record<string, string>[];
};

/**
 * Reads a tab as objects keyed by its header row.
 *
 * Google omits trailing empty cells, so a row shorter than the header is normal
 * and its missing columns become "". Reading positionally instead would silently
 * shift every value after the first gap.
 */
export async function readTab(spreadsheetId: string, tab: string): Promise<SheetData> {
  const range = encodeURIComponent(`${tab}`);
  const j = await call<{ values?: string[][] }>(`/${spreadsheetId}/values/${range}?majorDimension=ROWS`);
  const values = j.values || [];
  if (values.length === 0) return { headers: [], rows: [] };

  const headers = (values[0] || []).map((h) => (h || "").trim());
  const rows = values.slice(1)
    .map((r) => {
      const o: Record<string, string> = {};
      // Trimmed. Hand-maintained sheets are full of stray whitespace — this one
      // holds "Will not be attending " and "decision pending " — and an untrimmed
      // value never matches the trimmed list of choices built from the same
      // column, so a row with a real status rendered as though it had none.
      headers.forEach((h, i) => { if (h) o[h] = (r[i] ?? "").toString().trim(); });
      return o;
    })
    // A wholly blank row is spacing, not a lead.
    .filter((o) => Object.values(o).some((v) => v.trim() !== ""));

  return { headers, rows };
}

/** A1 column letter for a zero-based index: 0 → A, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1, s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Writes single cells. Values go in as plain text — a status is a dropdown in the
 * dashboard and an ordinary word in the sheet, with no data validation attached.
 */
export async function writeCells(
  spreadsheetId: string,
  updates: { tab: string; row: number; column: number; value: string }[],
): Promise<void> {
  if (updates.length === 0) return;
  await call(`/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "RAW",   // RAW, so "Confirmed" never becomes a formula or a date
      data: updates.map((u) => ({
        range: `${u.tab}!${columnLetter(u.column)}${u.row}`,
        values: [[u.value]],
      })),
    }),
  });
}
