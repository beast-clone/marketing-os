import { getSupabase } from "@/lib/supabase";
import { askPerplexity } from "@/lib/ai";
import { todayIST } from "@/lib/date";
import { listPendingDateChanges } from "@/lib/date-approvals";

// "Plan with AI" on the Content calendar (Praveen, 4 Nov 2026 — docs/ai-planner-prototype/v4.html).
//
// The AI reads each task's content, searches the web for what is timely for its
// Primary Interest (Perplexity sonar-pro — real searches, real source links), and
// suggests days that would land each post when it matters. It never changes anything:
// the calendar shows its plan beside the original, and the person applies what they
// want through the usual date-change path (approvals and history included).
//
// The rules are enforced HERE, not trusted to the model:
//   · a task only moves within its own Monday–Sunday week;
//   · never to a day before today;
//   · nothing already in the Scheduler, published, rejected, or waiting for a date
//     approval is sent to the AI at all.

export type PlanMove = {
  id: string; title: string; primaryInterest: string; from: string; to: string;
  why: string; brief: { about: string; now: string; date: string; effect: string };
  sources: string[]; ok: boolean; blocked?: string;
};
export type Plan = {
  runAt: string; summary: string; searches: { query: string; finding: string }[];
  moves: PlanMove[]; keep: { id: string; title: string; why: string }[];
  citations: string[]; cost: number; tasks: number; skipped: number;
};

type Row = { id: string; particulars: string | null; type: string | null; sbu: string | null; status: string | null; publish_status: string | null; publishing_date: string | null; content: string | null; caption: string | null };

const LOCKED = new Set(["Published/Scheduled", "Rejected/Not Published"]);
const day = (d: string | null) => (d ? d.slice(0, 10) : "");
/** The Monday that starts this date's week (dates are plain YYYY-MM-DD, India). */
export function weekStart(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;   // Mon = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
const clean = (s: unknown) => String(s ?? "").replace(/\s*\[\d+\](?:\[\d+\])*/g, "").replace(/\s{2,}/g, " ").trim();

function parseJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const SYSTEM = (today: string) => [
  "You plan the Instagram/Facebook calendar for GooCampus — an Indian company that helps doctors and students: NEET UG/PG counselling in India, medical careers abroad (Australia AMC, UK PLAB, UAE DHA/DOH, New Zealand), mentorship, and Samvaya Matrimony (a matrimony brand).",
  `Today is ${today} (India). For EACH task, work out its real topic from its content, then SEARCH THE WEB for what is happening right now on that topic (exam and counselling dates, official notices, news, festivals, seasonal interest).`,
  "Then suggest a different day ONLY where it clearly helps the post land when it matters. Most tasks should stay. A task may only move to another day in the SAME Monday-Sunday week as its current date, and never before today.",
  "Return ONLY JSON: { summary: string (2 sentences, what is timely), searches: [{ query, finding (1 factual sentence with dates) }] (the searches you actually ran), moves: [{ id, to: 'YYYY-MM-DD', why (one short sentence), brief: { about (the post), now (what is happening, with dates), date (why the new day), effect (what changes) }, sources: [url] }], keep: [{ id, why }] (2-4 notable ones) }.",
  "Every 'now' must be backed by a URL in that move's sources. Do not invent facts — if you find nothing current for a topic, say so in searches. No [1] markers.",
].join("\n");

/** Plan the given tasks. `ids` = what is in view on the calendar; only the next 14
 *  days are considered. Spends Perplexity credit (recorded in ai_usage as ai-planner). */
export async function buildPlan(ids: string[]): Promise<Plan> {
  const sb = getSupabase();
  if (!sb) throw new Error("Database not configured");
  const today = todayIST();
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10);
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from("mh_posts")
      .select("id, particulars, type, sbu, status, publish_status, publishing_date, content, caption")
      .in("id", ids.slice(i, i + 200)).gte("publishing_date", today).lte("publishing_date", `${until}T23:59:59`);
    if (error) throw new Error(error.message);
    rows.push(...((data || []) as Row[]));
  }
  const waiting = new Set((await listPendingDateChanges(sb)).map((r) => r.postId));
  const eligible = rows.filter((r) => !r.publish_status && !LOCKED.has(r.status || "") && !waiting.has(r.id)).slice(0, 80);
  const skipped = rows.length - eligible.length;
  if (!eligible.length) return { runAt: new Date().toISOString(), summary: "Nothing to plan in the next two weeks for what's in view.", searches: [], moves: [], keep: [], citations: [], cost: 0, tasks: 0, skipped };

  // Small groups by Primary Interest, searched in parallel — keeps each call quick
  // (a server function is cut off at ~26 s) and each search focused.
  const groups = new Map<string, Row[]>();
  for (const r of eligible) { const k = r.sbu || "Other"; groups.set(k, [...(groups.get(k) || []), r]); }
  const batches: Row[][] = [];
  let cur: Row[] = [];
  for (const list of [...groups.values()].sort((a, b) => b.length - a.length)) {
    if (cur.length && cur.length + list.length > 12) { batches.push(cur); cur = []; }
    cur.push(...list);
  }
  if (cur.length) batches.push(cur);

  const byId = new Map(eligible.map((r) => [r.id, r]));
  const results = await Promise.all(batches.slice(0, 6).map(async (batch) => {
    const tasks = batch.map((r) => ({
      id: r.id, title: r.particulars, type: r.type, primary_interest: r.sbu, date: day(r.publishing_date),
      content: String(r.content || r.caption || "").replace(/https?:\/\/\S+/g, "").replace(/[#*>_`]/g, "").replace(/\s+/g, " ").slice(0, 350),
    }));
    try {
      const res = await askPerplexity(SYSTEM(today), JSON.stringify(tasks), { model: "sonar-pro", maxTokens: 2200, timeoutMs: 24_000, feature: "ai-planner", detail: { label: `Plan with AI · ${tasks.length} tasks` } });
      return { json: parseJson(res.text), citations: res.citations, cost: res.usage.cost || 0 };
    } catch (e) {
      return { json: null, citations: [], cost: 0, error: (e as Error).message };
    }
  }));

  const plan: Plan = { runAt: new Date().toISOString(), summary: "", searches: [], moves: [], keep: [], citations: [], cost: 0, tasks: eligible.length, skipped };
  const summaries: string[] = [];
  for (const r of results) {
    plan.cost += r.cost;
    plan.citations.push(...r.citations);
    const j = r.json as { summary?: string; searches?: { query?: string; finding?: string }[]; moves?: { id?: string; to?: string; why?: string; brief?: Record<string, string>; sources?: string[] }[]; keep?: { id?: string; why?: string }[] } | null;
    if (!j) continue;
    if (j.summary) summaries.push(clean(j.summary));
    for (const s of j.searches || []) if (s?.query) plan.searches.push({ query: clean(s.query), finding: clean(s.finding) });
    for (const m of j.moves || []) {
      const row = m?.id ? byId.get(m.id) : undefined;
      const to = typeof m?.to === "string" ? m.to.slice(0, 10) : "";
      if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(to)) continue;
      const from = day(row.publishing_date);
      if (to === from) continue;
      // The rules — checked here, whatever the model said.
      const blocked = to < today ? "That day has already passed."
        : weekStart(to) !== weekStart(from) ? `${to} is in a different week — moves stay within the task's own Monday–Sunday week.`
        : undefined;
      plan.moves.push({
        id: row.id, title: row.particulars || "(untitled)", primaryInterest: row.sbu || "", from, to,
        why: clean(m.why), brief: { about: clean(m.brief?.about), now: clean(m.brief?.now), date: clean(m.brief?.date), effect: clean(m.brief?.effect) },
        sources: (Array.isArray(m.sources) ? m.sources : []).filter((u) => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 5),
        ok: !blocked, ...(blocked ? { blocked } : {}),
      });
    }
    for (const k of j.keep || []) { const row = k?.id ? byId.get(k.id) : undefined; if (row) plan.keep.push({ id: row.id, title: row.particulars || "", why: clean(k.why) }); }
  }
  plan.summary = summaries.join(" ") || (results.some((r) => "error" in r) ? "The search didn't finish — try again in a moment." : "No changes suggested.");
  plan.citations = [...new Set(plan.citations)];
  plan.cost = Math.round(plan.cost * 10000) / 10000;
  return plan;
}
