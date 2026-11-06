// WhatsApp templates as Meta has them, fetched through n8n (the dashboard holds no
// WhatsApp credentials). Shared by /api/wa-inbox/templates (the Templates page and
// the chat composer) and /api/cron/wa-templates (status-change alerts).
//
// Meta does not let you look up a phone number's parent WhatsApp Business Account,
// so the id is configuration: WA_BUSINESS_ACCOUNT_ID.

const HOOK = process.env.WA_TEMPLATES_URL || "https://n8n.srv1046538.hstgr.cloud/webhook/wa-inbox-templates";
export const WABA = process.env.WA_BUSINESS_ACCOUNT_ID || "";

type Component = { type: string; format?: string; text?: string; buttons?: { type: string; text?: string }[] };
export type WaTemplate = {
  name: string; language: string; category: string;
  header: string | null; body: string; footer: string | null;
  /** How many {{1}}-style blanks the body has — the UI asks for exactly this many. */
  variables: number;
  /** Button labels that go out with the message (quick replies, links). */
  buttons: string[];
  /** Meta's review state: APPROVED, PENDING, REJECTED, PAUSED, DISABLED. */
  status: string;
  /** Why Meta refused it, when it did. */
  reason: string | null;
};

function shape(t: { name: string; language: string; category: string; status?: string; rejected_reason?: string; components?: Component[] }): WaTemplate {
  const parts = t.components || [];
  const body = parts.find((c) => c.type === "BODY")?.text || "";
  const header = parts.find((c) => c.type === "HEADER");
  return {
    name: t.name, language: t.language, category: t.category,
    // An image or video header has no text to show; say so rather than leave a blank.
    header: header ? (header.text || (header.format ? `(${header.format.toLowerCase()})` : null)) : null,
    body,
    footer: parts.find((c) => c.type === "FOOTER")?.text || null,
    // Highest placeholder number, not how many appear: a body using {{1}} twice
    // and {{2}} once needs two values, not three.
    variables: Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]))),
    buttons: (parts.find((c) => c.type === "BUTTONS")?.buttons || []).map((x) => x.text || "").filter(Boolean),
    status: t.status || "APPROVED",
    reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
  };
}

/** POST to the "WA Inbox — templates" n8n workflow. */
export async function askTemplates(body: unknown): Promise<Response> {
  const secret = process.env.WA_INBOX_SEND_SECRET;
  if (!secret) throw new Error("WhatsApp sending isn't configured on this server (WA_INBOX_SEND_SECRET).");
  return fetch(HOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-wa-inbox-secret": secret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

/** Every template on the account, any status. */
export async function listTemplates(): Promise<WaTemplate[]> {
  if (!WABA) throw new Error("WA_BUSINESS_ACCOUNT_ID isn't set, so templates can't be listed.");
  const r = await askTemplates({ action: "list", wabaId: WABA });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out?.error?.message || out?.message || `n8n answered ${r.status}`);
  return (out.data || []).map(shape);
}
