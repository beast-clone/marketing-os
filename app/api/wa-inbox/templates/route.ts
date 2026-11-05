import { NextResponse } from "next/server";
import { requireSection, guardRate } from "@/lib/api-guard";
import { getSessionUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";

// Approved WhatsApp templates — the only thing allowed once the 24-hour window
// has closed.
//
//   GET  /api/wa-inbox/templates   -> the approved ones, with their variables
//   POST /api/wa-inbox/templates   -> send one  { to, name, language, variables[] }
//
// The dashboard has no WhatsApp credentials — they live in n8n — so both go
// through the "WA Inbox — templates" workflow over the same webhook secret the
// reply sender uses. Meta does not let you look up a phone number's parent
// WhatsApp Business Account, so the id is configuration, not something to
// discover: WA_BUSINESS_ACCOUNT_ID.

const HOOK = process.env.WA_TEMPLATES_URL || "https://n8n.srv1046538.hstgr.cloud/webhook/wa-inbox-templates";
const WABA = process.env.WA_BUSINESS_ACCOUNT_ID || "";

type Component = { type: string; format?: string; text?: string };
export type WaTemplate = {
  name: string; language: string; category: string;
  header: string | null; body: string; footer: string | null;
  /** How many {{1}}-style blanks the body has — the UI asks for exactly this many. */
  variables: number;
};

function shape(t: { name: string; language: string; category: string; components?: Component[] }): WaTemplate {
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
  };
}

async function ask(body: unknown): Promise<Response> {
  const secret = process.env.WA_INBOX_SEND_SECRET;
  if (!secret) throw new Error("WhatsApp sending isn't configured on this server (WA_INBOX_SEND_SECRET).");
  return fetch(HOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-wa-inbox-secret": secret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

export async function GET() {
  const denied = await requireSection("sales");
  if (denied) return denied;
  if (!WABA) return NextResponse.json({ templates: [], error: "WA_BUSINESS_ACCOUNT_ID isn't set, so templates can't be listed." });
  try {
    const r = await ask({ action: "list", wabaId: WABA });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out?.error?.message || out?.message || `n8n answered ${r.status}`);
    const all: WaTemplate[] = (out.data || []).map(shape);
    // Only approved ones are sendable, and n8n returns every status.
    const approved = (out.data || []).filter((t: { status?: string }) => t.status === "APPROVED").map(shape);
    return NextResponse.json({ templates: approved, total: all.length });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't load WhatsApp templates"), { status: 502 });
  }
}

export async function POST(req: Request) {
  const denied = await requireSection("sales");
  if (denied) return denied;
  const limited = guardRate(req, "wa-template-send", 20, 60_000);
  if (limited) return limited;
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const b = await req.json().catch(() => ({}));
  const to = String(b.to || "").replace(/\D/g, "");
  const name = String(b.name || "").trim();
  const language = String(b.language || "en").trim();
  const variables: string[] = Array.isArray(b.variables) ? b.variables.map((v: unknown) => String(v)) : [];
  if (!to || !name) return NextResponse.json({ error: "Pick a template first" }, { status: 400 });
  if (variables.some((v) => !v.trim())) return NextResponse.json({ error: "Fill in every blank before sending" }, { status: 400 });

  // Meta's own message shape, built here so n8n stays a dumb pipe and a template
  // with any arrangement of variables works without touching the workflow.
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name,
      language: { code: language },
      ...(variables.length
        ? { components: [{ type: "body", parameters: variables.map((text) => ({ type: "text", text })) }] }
        : {}),
    },
  };

  try {
    const r = await ask({ action: "send", payload });
    const out = await r.json().catch(() => ({}));
    const id: string | undefined = out?.messages?.[0]?.id;
    if (!r.ok || !id) {
      const why = out?.error?.message || out?.error || out?.message || `n8n answered ${r.status}`;
      return NextResponse.json({ error: `WhatsApp didn't send it: ${typeof why === "string" ? why : JSON.stringify(why)}`.slice(0, 300) }, { status: 502 });
    }

    // Record it in the thread like any other outgoing message, so the chat reads
    // as one conversation rather than silently skipping what reopened it.
    const preview = variables.reduce((s, v, i) => s.split(`{{${i + 1}}}`).join(v), String(b.preview || `[template: ${name}]`));
    const row = { wa_message_id: id, contact: to, direction: "out", kind: "template", body: preview, status: "sent", sent_by: getSessionUserId() };
    const { data, error } = await db.from("wa_messages").insert(row)
      .select("id, direction, kind, body, status, error, sent_by, created_at").single();
    if (error) throw error;
    return NextResponse.json({ message: data });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't send the template"), { status: 502 });
  }
}
