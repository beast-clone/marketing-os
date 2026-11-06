import { NextResponse } from "next/server";
import { sameSecret } from "@/lib/cron-auth";
import { getSupabase } from "@/lib/supabase";
import { postSlack, hasSlack } from "@/lib/slack";
import { safeError } from "@/lib/errors";
import { fetchRoster } from "@/lib/team-db";
import { canAccessSection } from "@/lib/permissions";
import { listTemplates, type WaTemplate } from "@/lib/wa-templates";

// Tell the team when Meta changes a WhatsApp template's verdict (Praveen, 6 Nov 2026):
// approved, rejected, paused, disabled, or moved from utility to marketing.
// Point n8n at this every 15 minutes, 10 AM to 6 PM IST.
//   GET /api/cron/wa-templates   (header: x-cron-secret: <CRON_SECRET>)
//
// Meta gives no "what changed" list, so this keeps the last verdict it saw per
// template (wa_template_status, sql/051) and compares. The very first run only
// records — announcing all 71 existing templates as "news" would be noise.
export const dynamic = "force-dynamic";

const APP_URL = process.env.APP_URL || "https://goocampus-ig-dashboard.netlify.app";
const BASE_PATH = process.env.BASE_PATH ?? "/gc-dashboard";
const PAGE = "/dashboard/preview/wa-inbox/templates";

const WORD: Record<string, { emoji: string; say: string }> = {
  APPROVED: { emoji: "✅", say: "was approved by Meta — ready to send" },
  REJECTED: { emoji: "❌", say: "was rejected by Meta" },
  PENDING: { emoji: "⏳", say: "is waiting for Meta's review" },
  IN_APPEAL: { emoji: "⏳", say: "is in appeal with Meta" },
  PAUSED: { emoji: "⏸️", say: "was paused by Meta (people kept blocking or ignoring it)" },
  DISABLED: { emoji: "🚫", say: "was disabled by Meta" },
};
const nice = (c: string) => c.charAt(0) + c.slice(1).toLowerCase();

type Prev = { name: string; language: string; status: string; category: string };
type Change = { t: WaTemplate; emoji: string; text: string };

function describe(t: WaTemplate, prev: Prev | undefined): Change | null {
  // A brand-new template that is merely waiting is something we just did ourselves.
  if (!prev) return t.status === "PENDING" ? null : { t, emoji: WORD[t.status]?.emoji || "🔔", text: `${t.name} ${WORD[t.status]?.say || `is now ${t.status}`}` };
  const parts: string[] = [];
  if (prev.status !== t.status) parts.push(WORD[t.status]?.say || `changed to ${t.status}`);
  if (prev.category !== t.category) parts.push(`was moved from ${nice(prev.category)} to ${nice(t.category)} by Meta`);
  if (!parts.length) return null;
  const emoji = prev.status !== t.status ? WORD[t.status]?.emoji || "🔔" : "🏷️";
  return { t, emoji, text: `${t.name} ${parts.join(", and ")}` };
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  try {
    const live = await listTemplates();
    const { data: seen, error } = await db.from("wa_template_status").select("name, language, status, category");
    if (error) throw error;
    const key = (x: { name: string; language: string }) => `${x.name}|${x.language}`;
    const prev = new Map((seen ?? []).map((r) => [key(r), r as Prev]));
    const firstRun = prev.size === 0;

    const changes = firstRun ? [] : live.map((t) => describe(t, prev.get(key(t)))).filter((c): c is Change => !!c);
    const stamp = new Date().toISOString();

    if (changes.length) {
      // ── The dashboard bell — everyone who can open the WhatsApp inbox ────────
      const roster = await fetchRoster().catch(() => []);
      const team = roster.filter((u) => u.active && canAccessSection(u, "sales")).map((u) => u.id);
      const rows = changes.flatMap((c) => team.map((person) => ({
        recipient_key: person,
        // One row per verdict, so the same change is never announced twice.
        source_id: `wa-tpl:${key(c.t)}:${c.t.status}:${c.t.category}`,
        kind: "template",
        category: "whatsapp",
        action_needed: false,
        emoji: c.emoji,
        title: `Template ${c.text}`,
        sub: c.t.reason ? `Meta's reason: ${c.t.reason.replace(/_/g, " ").toLowerCase()}` : c.t.body.slice(0, 160),
        post_id: null,
        payload: { href: `${PAGE}?open=${encodeURIComponent(c.t.name)}` },
        created_at: stamp,
      })));
      if (rows.length) await db.from("mh_notifications").upsert(rows, { onConflict: "recipient_key,source_id", ignoreDuplicates: true });

      // ── Slack ──────────────────────────────────────────────────────────────
      if (hasSlack()) {
        const head = changes.length === 1 ? "A WhatsApp template changed" : `${changes.length} WhatsApp templates changed`;
        const lines = changes.map((c) => `${c.emoji} *${c.t.name}* ${c.text.slice(c.t.name.length + 1)}${c.t.reason ? ` — reason: ${c.t.reason.replace(/_/g, " ").toLowerCase()}` : ""}`);
        await postSlack(`${head}\n${lines.join("\n")}\n${APP_URL}${BASE_PATH}${PAGE}`);
      }
    }

    // Remember what Meta says now, whether or not anything was announced.
    if (live.length) {
      await db.from("wa_template_status").upsert(
        live.map((t) => ({ name: t.name, language: t.language, status: t.status, category: t.category, reason: t.reason, updated_at: stamp })),
        { onConflict: "name,language" },
      );
    }

    return NextResponse.json({ ok: true, templates: live.length, firstRun, changed: changes.length, slack: hasSlack(), changes: changes.map((c) => c.text) });
  } catch (err) {
    return NextResponse.json(safeError(err, "Couldn't check WhatsApp templates"), { status: 500 });
  }
}
