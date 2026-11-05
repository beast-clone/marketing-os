// The spreadsheets this dashboard can already see, for picking one from a list
// instead of hunting for its URL.
//
// Worth being exact about whose list this is: the dashboard signs in as its own
// service account, not as the person using it. So this returns the sheets that
// have been shared with that account — not everything in anyone's Drive. A sheet
// nobody has shared with it is invisible here and still has to be pasted in.

import { googleAccessToken, SERVICE_ACCOUNT_EMAIL } from "@/lib/google-jwt";
import { SheetError } from "@/lib/sheets";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly";

export type DriveSheet = { id: string; name: string; canEdit: boolean; modifiedTime: string };

export async function listSpreadsheets(): Promise<DriveSheet[]> {
  const token = await googleAccessToken(SCOPE);
  const q = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
    `&fields=files(id,name,modifiedTime,capabilities(canEdit))&pageSize=100&orderBy=modifiedTime desc` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const reason = body?.error?.details?.[0]?.reason || body?.error?.errors?.[0]?.reason || "";
    if (reason === "SERVICE_DISABLED" || reason === "accessNotConfigured") {
      throw new SheetError(
        "The Google Drive API is switched off for this project, so the dashboard can't list your sheets. " +
        "Turn it on in the Google Cloud console (project 227161816049) and this list fills itself — " +
        "pasting a link works either way.",
        "api-off",
      );
    }
    throw new SheetError(body?.error?.message || `Drive API error ${res.status}`, "other");
  }

  return (body.files || []).map((f: { id: string; name: string; modifiedTime: string; capabilities?: { canEdit?: boolean } }) => ({
    id: f.id,
    name: f.name,
    canEdit: Boolean(f.capabilities?.canEdit),
    modifiedTime: f.modifiedTime,
  }));
}

export { SERVICE_ACCOUNT_EMAIL };
