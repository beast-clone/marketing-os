import { NextResponse } from "next/server";
import { requireSection, guardRate } from "@/lib/api-guard";
import { safeError } from "@/lib/errors";

// Write a WhatsApp template here and send it to Meta for approval, instead of
// going to WhatsApp Manager.
//
//   POST /api/wa-inbox/templates/new   { name, category, body, footer?, example[] }
//
// Approval is Meta's, not ours — a submitted template is PENDING until they
// decide, usually minutes but sometimes a day. Nothing can be sent with it until
// then, which the UI says.

const HOOK = process.env.WA_TEMPLATES_URL || "https://n8n.srv1046538.hstgr.cloud/webhook/wa-inbox-templates";
const WABA = process.env.WA_BUSINESS_ACCOUNT_ID || "";
const CATEGORIES = new Set(["UTILITY", "MARKETING", "AUTHENTICATION"]);

export async function POST(req: Request) {
  const denied = await requireSection("sales");
  if (denied) return denied;
  const limited = guardRate(req, "wa-template-new", 10, 60_000);
  if (limited) return limited;
  const secret = process.env.WA_INBOX_SEND_SECRET;
  if (!secret) return NextResponse.json({ error: "WhatsApp isn't configured on this server (WA_INBOX_SEND_SECRET)." }, { status: 500 });
  if (!WABA) return NextResponse.json({ error: "WA_BUSINESS_ACCOUNT_ID isn't set." }, { status: 500 });

  const b = await req.json().catch(() => ({}));
  // Meta's rule, enforced here so the error arrives before the round trip:
  // lowercase letters, digits and underscores only.
  const name = String(b.name || "").trim().toLowerCase().replace(/\s+/g, "_");
  const category = String(b.category || "UTILITY").toUpperCase();
  const body = String(b.body || "").trim();
  const footer = String(b.footer || "").trim();
  const language = String(b.language || "en").trim();

  if (!/^[a-z0-9_]{1,512}$/.test(name)) return NextResponse.json({ error: "The name can only use lowercase letters, numbers and underscores." }, { status: 400 });
  if (!CATEGORIES.has(category)) return NextResponse.json({ error: "Category must be UTILITY, MARKETING or AUTHENTICATION." }, { status: 400 });
  if (!body) return NextResponse.json({ error: "Write the message first." }, { status: 400 });
  if (body.length > 1024) return NextResponse.json({ error: "The message can be at most 1024 characters." }, { status: 400 });

  // Meta refuses a template whose variables have no example values, and the
  // error it gives is obscure, so check it here where we can say why.
  const vars = Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
  const example: string[] = Array.isArray(b.example) ? b.example.map((v: unknown) => String(v).trim()) : [];
  if (vars > 0 && (example.length < vars || example.some((v) => !v))) {
    return NextResponse.json({ error: `Give an example for each blank — Meta rejects a template without them. This one has ${vars}.` }, { status: 400 });
  }
  // Numbering must run 1, 2, 3 with nothing skipped.
  for (let i = 1; i <= vars; i++) {
    if (!body.includes(`{{${i}}}`)) return NextResponse.json({ error: `The blanks must run 1 to ${vars} with none missing — {{${i}}} isn't there.` }, { status: 400 });
  }

  const components: Record<string, unknown>[] = [{
    type: "BODY",
    text: body,
    ...(vars > 0 ? { example: { body_text: [example.slice(0, vars)] } } : {}),
  }];
  if (footer) components.push({ type: "FOOTER", text: footer.slice(0, 60) });

  try {
    const r = await fetch(HOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-wa-inbox-secret": secret },
      body: JSON.stringify({ action: "create-template", wabaId: WABA, template: { name, language, category, components } }),
      signal: AbortSignal.timeout(30_000),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || out?.error) {
      const why = out?.error?.error_user_msg || out?.error?.message || `WhatsApp answered ${r.status}`;
      return NextResponse.json({ error: String(why).slice(0, 300) }, { status: 502 });
    }
    // Meta returns the new id and where it put it — it may recategorise, e.g.
    // move something that reads like an advert out of UTILITY, so report back
    // what it actually decided rather than what was asked for.
    return NextResponse.json({
      id: out.id ?? null,
      status: out.status ?? "PENDING",
      category: out.category ?? category,
      name,
    });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't submit the template"), { status: 502 });
  }
}
