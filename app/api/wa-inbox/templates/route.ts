import { NextResponse } from "next/server";
import { requireSection, guardRate } from "@/lib/api-guard";
import { getSessionUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";
import { WABA, askTemplates, listTemplates } from "@/lib/wa-templates";

// Approved WhatsApp templates — the only thing allowed once the 24-hour window
// has closed.
//
//   GET  /api/wa-inbox/templates         -> the approved ones, with their variables
//   GET  /api/wa-inbox/templates?all=1   -> every template with Meta's status (Templates tab)
//   POST /api/wa-inbox/templates   -> send one  { to, name, language, variables[] }
//
// The dashboard has no WhatsApp credentials — they live in n8n — so both go
// through the "WA Inbox — templates" workflow (lib/wa-templates.ts).

export async function GET(req: Request) {
  const denied = await requireSection("sales");
  if (denied) return denied;
  if (!WABA) return NextResponse.json({ templates: [], error: "WA_BUSINESS_ACCOUNT_ID isn't set, so templates can't be listed." });
  try {
    const all = await listTemplates();
    if (new URL(req.url).searchParams.get("all") === "1") return NextResponse.json({ templates: all, total: all.length });
    // Only approved ones are sendable, and Meta returns every status.
    return NextResponse.json({ templates: all.filter((t) => t.status === "APPROVED"), total: all.length });
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
  // Meta refuses a blank with line breaks, tabs or 4+ spaces in a row (error 132018),
  // so a typed message's lines are joined with " · " — what was sent is what we store.
  for (let i = 0; i < variables.length; i++) {
    variables[i] = variables[i].trim().replace(/\s*\n+\s*/g, " · ").replace(/\t/g, " ").replace(/ {4,}/g, "   ");
  }

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
    const r = await askTemplates({ action: "send", payload });
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
