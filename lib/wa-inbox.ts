// What we know ABOUT a WhatsApp chat, as opposed to what was said in it.
//
// wa_messages is the transcript. This is the other half: who is handling the
// chat, what it is about, whether it still needs an answer — and, read live from
// the Sales Hub, who the number belongs to.
//
// One number serves the whole team, so without this two people answer the same
// student and neither can tell the other already had it.

import { getSupabase } from "@/lib/supabase";
import { airtableList, CRM_TABLE, SALES_HUB_BASE, pickName } from "@/lib/sales-hub";

export type ContactMeta = {
  contact: string;
  display_name: string | null;
  assigned_to: string | null;
  labels: string[];
  note: string | null;
  status: "open" | "closed" | "spam";
  updated_at: string | null;
  updated_by: string | null;
};

export const EMPTY_META = (contact: string): ContactMeta => ({
  contact, display_name: null, assigned_to: null, labels: [], note: null,
  status: "open", updated_at: null, updated_by: null,
});

/**
 * Metadata for many chats at once, as a map.
 *
 * One query for the whole list rather than one per chat: the inbox renders every
 * conversation on first paint, and a per-row lookup would be a few hundred round
 * trips to colour in some chips.
 *
 * A contact with no row is not an error — most chats have never been touched —
 * so callers get EMPTY_META for those and never have to null-check.
 */
export async function contactMetaMap(contacts: string[]): Promise<Map<string, ContactMeta>> {
  const map = new Map<string, ContactMeta>();
  const db = getSupabase();
  if (!db || contacts.length === 0) return map;
  const { data } = await db.from("wa_contacts")
    .select("contact, display_name, assigned_to, labels, note, status, updated_at, updated_by")
    .in("contact", [...new Set(contacts)]);
  for (const r of data ?? []) map.set(r.contact, { ...EMPTY_META(r.contact), ...r, labels: r.labels ?? [] });
  return map;
}

export async function contactMeta(contact: string): Promise<ContactMeta> {
  return (await contactMetaMap([contact])).get(contact) ?? EMPTY_META(contact);
}

/** Every label anyone has used, so the filter bar offers real ones, not a guess. */
export async function knownLabels(): Promise<string[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db.from("wa_contacts").select("labels").not("labels", "eq", "{}");
  const all = new Set<string>();
  for (const r of data ?? []) for (const l of (r.labels ?? [])) all.add(l);
  return [...all].sort((a, b) => a.localeCompare(b));
}

// ── Who is this number? ─────────────────────────────────────────────────────

export type WaLead = {
  name: string;
  phone: string | null;
  email: string | null;
  counsellor: string | null;
  source: string | null;
  leadStatus: string | null;
  url: string;
};

const last10 = (v: string): string => {
  const d = (v || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
};

/**
 * The Sales Hub lead behind a WhatsApp number, or null.
 *
 * Matched on the last 10 digits, because the same person is stored as
 * 9876543210, +919876543210 and 919876543210 depending on which form or import
 * created them, while WhatsApp always hands us the full international form.
 *
 * Read live rather than copied into wa_contacts: the counsellor and lead status
 * change in Airtable all day, and a stale copy shown beside a live chat is worse
 * than no copy at all. Any failure returns null — the panel simply says it found
 * nothing, and the inbox keeps working.
 */
export async function leadForNumber(contact: string): Promise<WaLead | null> {
  const ten = last10(contact);
  if (!ten || !process.env.AIRTABLE_API_KEY) return null;
  try {
    const rows = await airtableList<Record<string, unknown>>(CRM_TABLE, {
      // FIND over the raw text field, because the stored format varies; the
      // dedicated 10-digit column is not filled on every row.
      filterByFormula: `OR(FIND('${ten}', {Mobile Number} & ''), {Raw 10-Digit Number}='${ten}')`,
      fields: ["Full Name", "Mobile Number", "Email", "Counsellor", "Lead Source (n8n)", "Lead Status"],
      maxRecords: 1,
    });
    const r = rows[0];
    if (!r) return null;
    return {
      name: pickName(r.fields["Full Name"]) || "Unnamed lead",
      phone: pickName(r.fields["Mobile Number"]) || null,
      email: pickName(r.fields["Email"]) || null,
      counsellor: pickName(r.fields["Counsellor"]) || null,
      source: pickName(r.fields["Lead Source (n8n)"]) || null,
      leadStatus: pickName(r.fields["Lead Status"]) || null,
      url: `https://airtable.com/${SALES_HUB_BASE}/${CRM_TABLE}/${r.id}`,
    };
  } catch {
    return null;
  }
}
