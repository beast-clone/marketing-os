"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  IconSearch, IconArrowLeft, IconSparkles, IconPlayerPlayFilled, IconExternalLink,
  IconLayoutGrid, IconMovie, IconFileText, IconBrandLinkedin, IconBrandInstagram, IconPalette, IconCircleCheck, IconPencil, IconBolt, IconBulb, IconRefresh,
} from "@tabler/icons-react";
import { PLAYBOOK_GUIDES } from "@/lib/playbook-guides";
import { LoadingBlock } from "@/components/LoadingBlock";
import MissingFieldsModal, { gateFromResponse, type GateBlock } from "../MissingFieldsModal";
import { useSbus } from "@/lib/use-sbus";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { useTeam, mergeTeam } from "@/lib/use-team";

// The marketing library (Corey Haines' open pack + a Pillar Content skill), run via
// Perplexity. Lives inside Content Studio as the "Playbooks" tab. After a result,
// you can turn it into only the formats you pick (the V2 "choose your output" step).

type SkillMeta = { slug: string; name: string; category: string; version: string; description: string; chars: number };
type DeriveDraft = { format: string; label: string; dest: string; content: string };

const CAT_ORDER = ["SEO & Content", "CRO", "Content & Copy", "Paid & Measurement", "Growth & Retention", "Sales & GTM", "Strategy"];

// The output formats a result can be turned into (the "choose what to make" step).
const FORMATS = [
  { key: "carousel", label: "Instagram Carousel", sub: "5–7 slides", icon: IconLayoutGrid },
  { key: "reel", label: "Reel / Shorts", sub: "30–45s script", icon: IconMovie },
  { key: "blog", label: "Blog article", sub: "SEO long-form", icon: IconFileText },
  { key: "linkedin", label: "LinkedIn post", sub: "120–180 words", icon: IconBrandLinkedin },
  { key: "instagram", label: "IG caption", sub: "single image", icon: IconBrandInstagram },
  { key: "poster", label: "Poster brief", sub: "for a designer", icon: IconPalette },
];

// Producers a piece can be assigned to on approval (same roster the Create tab uses).
// Plus anyone added on the Team page (appended in DerivedCard).
const TEAM = [
  { key: "manya", label: "Manya" },
  { key: "praveen", label: "Praveen" },
  { key: "nikhil", label: "Nikhil" },
  { key: "nandu", label: "Nandu" },
];

export function PlaybooksLibrary() {
  const [skills, setSkills] = useState<SkillMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState<SkillMeta | null>(null);

  useEffect(() => {
    fetch("/api/marketing-skills")
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setSkills((d.skills || []) as SkillMeta[]); })
      .catch((e) => setError((e as Error).message));
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = skills || [];
    if (!term) return list;
    return list.filter((s) => `${s.name} ${s.category} ${s.description}`.toLowerCase().includes(term));
  }, [skills, q]);

  const byCat = useMemo(() => {
    const m = new Map<string, SkillMeta[]>();
    for (const s of filtered) { const a = m.get(s.category) || []; a.push(s); m.set(s.category, a); }
    return CAT_ORDER.filter((c) => m.has(c)).map((c) => ({ cat: c, items: m.get(c)! }));
  }, [filtered]);

  if (active) return <SkillRunner skill={active} onBack={() => setActive(null)} />;

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-2xl px-4 py-2.5 mb-6 focus-within:border-brand transition">
        <IconSearch size={18} className="text-[#8A92A6] shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${skills?.length ?? 50} playbooks — copywriting, SEO, pricing, cold email…`}
          className="flex-1 bg-transparent outline-none text-[14px] text-[#232D42] placeholder:text-[#B4BAC6]"
        />
        {skills && <span className="text-[12px] text-[#8A92A6]">{filtered.length} / {skills.length}</span>}
      </div>

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 px-5 py-4 text-sm">Couldn&rsquo;t load — {error}</div>}
      {!skills && !error && <LoadingBlock className="!py-10" />}

      {byCat.map(({ cat, items }) => (
        <div key={cat} className="mb-7">
          <div className="text-[11px] uppercase tracking-wide text-[#8A92A6] font-semibold mb-2.5">{cat} · {items.length}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {items.map((s) => (
              <button
                key={s.slug}
                onClick={() => setActive(s)}
                className="text-left rounded-2xl border border-gray-100 bg-white p-4 hover:border-brand hover:shadow-sm transition group"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="text-[14px] font-medium text-[#232D42]">{s.name}</div>
                  <span className="text-brand opacity-0 group-hover:opacity-100 transition inline-flex items-center gap-1 text-[11.5px] font-medium shrink-0"><IconPlayerPlayFilled size={11} /> Run</span>
                </div>
                <div className="text-[12px] text-[#8A92A6] leading-snug line-clamp-3">{s.description}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
      {skills && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-10 text-center text-[#8A92A6]">No playbook matches “{q}”.</div>
      )}
    </div>
  );
}

// Render bold + strip Perplexity's inline [1][2] citation refs and stray ** noise.
function inlineMd(s: string, keyBase: string) {
  const clean = s.replace(/\[\d+\](\s*\[\d+\])*/g, "");
  return clean.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p)
      ? <strong key={`${keyBase}-${i}`} className="font-semibold text-[#232D42]">{p.slice(2, -2)}</strong>
      : <span key={`${keyBase}-${i}`}>{p.replace(/\*\*/g, "")}</span>,
  );
}

// Lightweight markdown → clean styled output (headings, bullets, bold). Keeps it
// professional; no raw ### / ** symbols shown.
function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: JSX.Element[] = [];
  let bullets: string[] = [];
  const flush = (k: string) => {
    if (!bullets.length) return;
    const b = bullets; bullets = [];
    out.push(<ul key={`ul-${k}`} className="list-disc pl-5 space-y-1 my-2">{b.map((x, j) => <li key={j}>{inlineMd(x, `li-${k}-${j}`)}</li>)}</ul>);
  };
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    // A line that is nothing but bold — "**Follow-up 2**" — is a section heading, and
    // the model writes them that way constantly. Rendered as an ordinary paragraph it
    // got the same 6px margin as body text, so three emails ran together in one wall
    // with no visible seam between them.
    const soloBold = line.match(/^\*\*(.+?)\*\*:?\s*$/);
    if (/^#{1,6}\s+/.test(line) || soloBold) {
      flush(String(i));
      const label = soloBold ? soloBold[1] : line.replace(/^#{1,6}\s+/, "");
      out.push(
        <div key={i} className="font-semibold text-[#232D42] text-[14px] mt-5 mb-2 pt-4 border-t border-gray-100 first:mt-0 first:pt-0 first:border-t-0">
          {inlineMd(label, `h-${i}`)}
        </div>,
      );
    }
    else if (/^\s*[-*]\s+/.test(line)) { bullets.push(line.replace(/^\s*[-*]\s+/, "")); }
    else if (line.trim() === "") { flush(String(i)); }
    else { flush(String(i)); out.push(<p key={i} className="my-1.5">{inlineMd(line, `p-${i}`)}</p>); }
  });
  flush("end");
  return <div className="text-[13.5px] text-[#232D42] leading-relaxed">{out}</div>;
}

// A generated output — editable, then Approve → assign to a producer, which creates
// a Content-Pending item in the pipeline (reuses /api/marketing-hub/create, the same
// hand-off the Create tab uses). It never publishes directly.
function DerivedCard({ d, skillName, source, isNew, onTokens }: { d: DeriveDraft; skillName: string; source: string; isNew?: boolean; onTokens?: (n: number) => void }) {
  const rosterTeam = useTeam();
  const [, bumpTeam] = useState(0);
  useEffect(() => {
    if (mergeTeam(TEAM, rosterTeam, (t) => t.key, (p) => ({ key: p.id, label: p.first }), ["maheen"])) bumpTeam((n) => n + 1);
  }, [rosterTeam]);
  const sbus = useSbus();   // live brand list (sql/027)
  const [text, setText] = useState(d.content);
  const [editing, setEditing] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [assignee, setAssignee] = useState("manya");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  // A playbook draft carries no brand of its own, so the approver picks one — the
  // create gate refuses a task with no SBU.
  const [sbu, setSbu] = useState("");
  const [gate, setGate] = useState<GateBlock | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  // Custom prompt to regenerate just this card (e.g. "add 2 bullets per slide", or a reference link).
  const [cardPrompt, setCardPrompt] = useState("");
  const [regenning, setRegenning] = useState(false);
  const [regenErr, setRegenErr] = useState<string | null>(null);

  const regenerate = async () => {
    const p = cardPrompt.trim();
    if (!p || regenning) return;
    setRegenning(true); setRegenErr(null);
    try {
      const r = await fetch("/api/content/derive", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, formats: [d.format], custom: p }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      const draft = (j.drafts || [])[0];
      if (!draft?.content) throw new Error("Nothing came back — try rephrasing the prompt.");
      setText(draft.content); onTokens?.(typeof j.tokens === "number" ? j.tokens : 0); setCardPrompt("");
    } catch (e) { setRegenErr((e as Error).message); }
    finally { setRegenning(false); }
  };

  const approve = async () => {
    setSending(true);
    setSendErr(null);
    try {
      const title = `${skillName} — ${d.label}`;
      const res = await fetch("/api/marketing-hub/create", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ title, content: text, owner: assignee, sbu: sbu || undefined }),
      });
      if (res.ok) { setSentTo(TEAM.find((t) => t.key === assignee)?.label || assignee); setPickOpen(false); return; }
      const j = await res.json().catch(() => ({}));
      const block = gateFromResponse(res.status, j, title);
      if (block) setGate(block);
      else setSendErr((j as { error?: string }).error || `HTTP ${res.status}`);
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : String(e));
    } finally { setSending(false); }
  };

  return (
    <div className={`rounded-2xl border bg-white p-4 ${isNew ? "border-brand" : "border-gray-100"}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[13px] font-medium text-[#232D42]">{d.label}</span>
        {isNew && <span className="text-[10px] font-semibold uppercase tracking-wide text-white bg-brand rounded-full px-2 py-0.5">New</span>}
      </div>
      {editing ? (
        <div className="space-y-2.5">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} className="w-full text-[12.5px] text-[#232D42] border border-gray-200 rounded-lg p-2 leading-relaxed focus:border-brand outline-none resize-y" />
          <div className="rounded-lg border border-gray-100 bg-[#F9FAFC] p-2.5">
            <label className="text-[11.5px] font-medium text-[#232D42]">Custom prompt — tell it what to change, then regenerate</label>
            <div className="flex items-start gap-2 mt-1.5">
              <textarea value={cardPrompt} onChange={(e) => setCardPrompt(e.target.value)} rows={2}
                placeholder={`e.g. Each slide: a heading + 2 bullets. Or paste a reference link to match its style.`}
                className="flex-1 text-[12px] text-[#232D42] border border-gray-200 rounded-lg p-2 bg-white focus:border-brand outline-none resize-y" />
              <button onClick={regenerate} disabled={!cardPrompt.trim() || regenning}
                className="shrink-0 text-[11.5px] inline-flex items-center gap-1 bg-brand text-white rounded-lg px-3 py-2 hover:bg-brand-dark disabled:opacity-50">
                <IconSparkles size={13} /> {regenning ? "Working…" : "Regenerate"}
              </button>
            </div>
            {regenErr && <div className="text-[11px] text-rose-600 mt-1">{regenErr}</div>}
            <div className="text-[11px] text-[#8A92A6] mt-1">Rewrites only this {d.label}. Facts still come only from the verified source.</div>
          </div>
        </div>
      ) : <MarkdownLite text={text} />}
      <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-gray-100">
        <button onClick={() => setEditing((v) => !v)} className="text-[11.5px] inline-flex items-center gap-1 border border-gray-200 rounded-lg px-2.5 py-1 text-[#4A5468] hover:border-gray-300"><IconPencil size={12} /> {editing ? "Done" : "Edit"}</button>
        <div className="ml-auto">
          {sentTo ? (
            <span className="text-[11.5px] inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-1"><IconCircleCheck size={13} /> Assigned to {sentTo}</span>
          ) : pickOpen ? (
            <div className="inline-flex items-center gap-2">
              <span className="text-[11.5px] text-[#8A92A6]">Assign to</span>
              <PreviewSelect size="sm" value={assignee} onChange={setAssignee}
                options={TEAM.map((t) => ({ value: t.key, label: t.label }))} />
              <PreviewSelect size="sm" value={sbu} onChange={setSbu} title="Primary interest — what this is for" placeholder="Primary interest…"
                options={sbus.map((o) => ({ value: o, label: o }))} />
              <button onClick={approve} disabled={sending} className="text-[11.5px] inline-flex items-center gap-1 bg-brand text-white rounded-md px-3 py-1.5 hover:bg-brand-dark disabled:opacity-60">{sending ? "Sending…" : "Confirm"}</button>
              <button onClick={() => setPickOpen(false)} className="text-[11.5px] text-[#8A92A6] hover:text-[#232D42] px-1">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setPickOpen(true)} className="text-[11.5px] inline-flex items-center gap-1 bg-brand text-white rounded-lg px-3 py-1.5 hover:bg-brand-dark"><IconCircleCheck size={13} /> Approve</button>
          )}
        </div>
      </div>
      {sendErr && <div className="text-[11.5px] text-red-700 bg-red-50 rounded-lg px-2.5 py-1.5 mt-2">Couldn&apos;t assign — {sendErr}</div>}
      {gate && <MissingFieldsModal {...gate} onClose={() => setGate(null)} />}
    </div>
  );
}

// One labelled line in the "How to use this playbook" cheat-sheet.
function GuideField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-[#8A92A6] font-semibold mb-0.5">{label}</div>
      <div className="text-[13px] text-[#232D42] leading-snug">{children}</div>
    </div>
  );
}

function SkillRunner({ skill, onBack }: { skill: SkillMeta; onBack: () => void }) {
  const [task, setTask] = useState("");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [citations, setCitations] = useState<string[]>([]);
  // What the run produced — "copy" is the deliverable itself (an SMS, an email),
  // "research" is material you could build content from. See lib/marketing-skills.
  const [kind, setKind] = useState<"copy" | "research">("research");
  // Their own instructions instead of the playbook's framework.
  const [useCustom, setUseCustom] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  // Voice for the run. Empty = whatever the playbook itself says.
  const [tone, setTone] = useState("");
  const [error, setError] = useState<string | null>(null);
  // "Choose your output" step (V2)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deriving, setDeriving] = useState(false);
  const [derived, setDerived] = useState<DeriveDraft[]>([]);
  const [deriveErr, setDeriveErr] = useState<string | null>(null);
  // Playbooks always run on Perplexity Sonar — see the note by "Your task" below.
  // Both bill to the same Perplexity balance; Claude writes better but costs more.
  const engine = "sonar" as const;
  const [ran, setRan] = useState(false);
  // Token usage so the team can see what each generation costs (Perplexity billing).
  const [runTokens, setRunTokens] = useState<number | null>(null);
  const [runCost, setRunCost] = useState<number | null>(null);
  const [deriveTokens, setDeriveTokens] = useState(0);
  // Formats made in the most recent generation — tagged "New" so the team spots them.
  const [newFormats, setNewFormats] = useState<Set<string>>(new Set());
  // Masonry: each card is placed into whichever column is currently shorter, in
  // generation order (Pinterest-style) — packs tight with no big gaps. Once a card
  // is assigned a column it stays there, so its edit state never resets.
  const col0Ref = useRef<HTMLDivElement>(null);
  const col1Ref = useRef<HTMLDivElement>(null);
  const [colOf, setColOf] = useState<Record<string, 0 | 1>>({});

  // "Verified" needs BOTH: sources came back AND the output is the kind of thing
  // sources can verify. Perplexity searches on every call, so a request to write three
  // WhatsApp reminders still came back with 15 citations — and the panel then stamped
  // "Verified — 15 live sources" across three message templates. Nothing in them was a
  // factual claim those pages had confirmed. Sources READ is not output VERIFIED, and a
  // badge that cannot tell the difference teaches people to ignore it.
  const verified = kind === "research" && citations.length > 0;

  const run = async () => {
    const t = task.trim();
    if (!t || loading) return;
    setLoading(true); setError(null); setOutput(null); setCitations([]);
    setSelected(new Set()); setDerived([]); setDeriveErr(null); setRunTokens(null); setRunCost(null); setDeriveTokens(0); setNewFormats(new Set()); setColOf({});
    try {
      const r = await fetch("/api/marketing-skills/run", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: skill.slug, task: t, engine, customPrompt: useCustom ? customPrompt : undefined, tone: tone || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setOutput(d.output || "—"); setCitations(d.citations || []); setRunTokens(typeof d.tokens === "number" ? d.tokens : 0);
      setKind(d.kind === "copy" ? "copy" : "research");
      setRunCost(typeof d.cost === "number" ? d.cost : null); setRan(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // V2 — turn the result into ONLY the picked formats.
  const generate = async () => {
    // Only make formats not already on the board — new outputs ADD, never replace.
    const toMake = Array.from(selected).filter((f) => !derived.some((d) => d.format === f));
    if (!output || !toMake.length || deriving) return;
    setDeriving(true); setDeriveErr(null);
    try {
      const r = await fetch("/api/content/derive", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: output, formats: toMake }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setDerived((prev) => [...prev, ...((d.drafts || []) as DeriveDraft[])]);
      setDeriveTokens((prev) => prev + (typeof d.tokens === "number" ? d.tokens : 0));
      setNewFormats(new Set(((d.drafts || []) as DeriveDraft[]).map((x) => x.format)));
      setSelected(new Set());
    } catch (e) {
      setDeriveErr((e as Error).message);
    } finally {
      setDeriving(false);
    }
  };

  // Place one unassigned card per pass into the currently-shorter column. Runs again
  // after each assignment (colOf changes) until every card has a column.
  useLayoutEffect(() => {
    const next = derived.find((d) => colOf[d.format] === undefined);
    if (!next) return;
    const h0 = col0Ref.current?.offsetHeight ?? 0;
    const h1 = col1Ref.current?.offsetHeight ?? 0;
    setColOf((m) => ({ ...m, [next.format]: h1 < h0 ? 1 : 0 }));
  }, [derived, colOf]);

  return (
    <div className="w-full">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#4A5468] hover:text-[#232D42] mb-4">
        <IconArrowLeft size={16} /> All playbooks
      </button>

      <div className="rounded-2xl border border-gray-100 bg-white p-5 mb-4">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-brand-light text-brand shrink-0"><IconSparkles size={16} /></span>
          <div className="text-[16px] font-medium text-[#232D42]">{skill.name}</div>
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F1F3F9] text-[#6B7280]">{skill.category}</span>
          {ran && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#EAF6EE] text-emerald-700">
              Perplexity Sonar
            </span>
          )}
          {runTokens !== null && (
            <span
              className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-[12px] font-medium text-amber-900"
              title="Billed to your Perplexity balance for this topic — the playbook run plus every output you generate. Watch this before generating dozens of formats."
            >
              <IconBolt size={13} className="text-amber-600" />
              {(runTokens + deriveTokens).toLocaleString()} tokens
              <span className="text-amber-700 font-normal">
                {runCost != null ? `· $${runCost.toFixed(4)} run` : `· run ${runTokens.toLocaleString()}`}{deriveTokens > 0 ? ` + outputs ${deriveTokens.toLocaleString()}` : ""}
              </span>
            </span>
          )}
        </div>
        <div className="text-[12.5px] text-[#8A92A6] leading-snug">{skill.description}</div>
      </div>

      {(() => {
        const g = PLAYBOOK_GUIDES[skill.slug];
        if (!g) return null;
        return (
          <div className="rounded-2xl border border-[#D7DDFB] bg-brand-light/40 p-5 mb-4">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-brand mb-3 flex items-center gap-1.5"><IconBulb size={14} /> How to use this playbook</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
              <GuideField label="What it is">{g.tagline}</GuideField>
              <GuideField label="Use it when">{g.useWhen}</GuideField>
              <GuideField label="You&rsquo;ll get">{g.expect}</GuideField>
              <GuideField label="How to check it">{g.verify}</GuideField>
            </div>
            <div className="mt-4 rounded-xl border border-[#C9D2F9] bg-white p-3">
              <div className="text-[10.5px] uppercase tracking-wide text-[#8A92A6] font-semibold mb-1">Try this</div>
              <div className="flex items-start gap-3">
                <p className="flex-1 text-[13px] text-[#232D42] italic">&ldquo;{g.example}&rdquo;</p>
                <button onClick={() => setTask(g.example)} className="shrink-0 text-[11.5px] inline-flex items-center gap-1 border border-brand text-brand rounded-lg px-2.5 py-1 hover:bg-brand-light transition"><IconSparkles size={12} /> Use this example</button>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="rounded-2xl border border-gray-100 bg-white p-5 mb-4">
        {/* One engine here, no picker.
            A playbook produces research and strategy — the thing Perplexity is for,
            because it reads live sources and cites them. Claude does the writing, in
            Content Studio's Create tab. Offering both here made every run a decision
            about model choice before you had even typed the task. */}
        <label className="text-[12px] font-semibold text-[#232D42] uppercase tracking-wide">Your task</label>
        <div className="mt-1.5 text-[11.5px] text-[#8A92A6] leading-snug">
          Perplexity Sonar Pro — the playbook framework grounded in live web sources.
        </div>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder={`Describe your task — the ${skill.name} playbook will produce it for GooCampus.`}
          rows={4}
          className="w-full mt-2 rounded-xl border border-gray-200 focus:border-brand outline-none p-3 text-[13.5px] text-[#232D42] resize-y"
        />
        {/* Your own instructions instead of the playbook's.
            It REPLACES the framework rather than being added to it — the playbook is
            roughly ten thousand characters of instruction, so anything appended to it
            loses every disagreement. Off by default: the playbook is the reason to be
            on this screen. */}
        {useCustom ? (
          <div className="mt-3 rounded-xl border border-brand/30 bg-brand-light/30 p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[12px] font-semibold text-[#232D42]">Your prompt</span>
              <span className="text-[11.5px] text-[#8A92A6]">used instead of the {skill.name} framework</span>
              <button onClick={() => setUseCustom(false)}
                className="ml-auto text-[11.5px] text-[#8A92A6] hover:text-brand underline">
                Use the playbook instead
              </button>
            </div>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder={"Tell it how to write this. e.g. \"You are a WhatsApp copywriter for an Indian medical-education consultancy. Write short messages, no emojis, one clear action per message.\""}
              rows={4}
              className="w-full rounded-lg border border-gray-200 focus:border-brand outline-none p-3 text-[13px] text-[#232D42] resize-y bg-white"
            />
            <div className="text-[11.5px] text-[#A6ACBE] mt-1.5">
              GooCampus context is still added for you — you do not need to explain the business.
            </div>
          </div>
        ) : null}

        {/* The two controls sit on one line, both as buttons. The custom-prompt option
            was an underlined link floating on its own above an empty row — it read as a
            footnote rather than the other way to run this. */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {!useCustom && (
            <button onClick={() => setUseCustom(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white text-[13px] font-medium text-[#4A5468] px-3.5 py-2 hover:border-brand hover:text-brand transition">
              <IconPencil size={13} /> Add a custom prompt
            </button>
          )}
          {useCustom && !customPrompt.trim() && (
            <span className="text-[11.5px] text-[#C03221]">Write the prompt, or switch back to the playbook.</span>
          )}
          <button
            onClick={run}
            disabled={!task.trim() || loading || (useCustom && !customPrompt.trim())}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-brand text-white text-[13px] font-medium px-4 py-2 disabled:opacity-40 hover:bg-brand-dark transition"
          >
            <IconPlayerPlayFilled size={13} /> {loading ? "Running…" : useCustom ? "Run your prompt" : "Run playbook"}
          </button>
        </div>
      </div>

      {loading && <div className="rounded-2xl border border-gray-100 bg-white p-5 text-[13px] text-[#8A92A6]">{useCustom ? "Running your prompt" : `Applying the ${skill.name} framework`} via Perplexity Sonar… this can take 20–40s.</div>}
      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 px-5 py-4 text-sm">Couldn&rsquo;t run — {error}</div>}
      {output && (
        <>
          {/* Choose what to make — but only when there IS something to make.
              A playbook that writes an SMS, an email or an ad has already produced the
              finished thing in its own channel; offering to turn a WhatsApp reminder
              into an Instagram carousel is not a choice anybody wants. Those runs get
              the copy and nothing else. */}
          {kind === "research" && (
          <div className="rounded-2xl border border-gray-100 bg-white px-5 py-4 mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-medium text-[#232D42] mr-1">Make from this:</span>
              {FORMATS.map((f) => {
                const made = derived.some((d) => d.format === f.key);
                const on = selected.has(f.key);
                const Icon = f.icon;
                if (made) return (
                  <span key={f.key} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12.5px] font-medium text-emerald-700">
                    <IconCircleCheck size={13} /> {f.label} · made
                  </span>
                );
                return (
                  <button key={f.key} onClick={() => toggle(f.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition ${on ? "border-brand bg-brand-light text-brand-dark" : "border-gray-200 text-[#4A5468] hover:border-gray-300"}`}>
                    {on ? <IconCircleCheck size={13} /> : <Icon size={13} />} {f.label}
                  </button>
                );
              })}
              {(() => {
                const n = Array.from(selected).filter((f) => !derived.some((d) => d.format === f)).length;
                return (
                  <button onClick={generate} disabled={!n || deriving}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-brand text-white text-[13px] font-medium px-4 py-2 disabled:opacity-40 hover:bg-brand-dark transition">
                    <IconPlayerPlayFilled size={12} /> {deriving ? "Generating…" : n ? `Generate ${n}` : "Pick a format"}
                  </button>
                );
              })()}
            </div>
            <div className="text-[11.5px] text-[#8A92A6] mt-2">Pick any format and generate — new outputs add to the board below, they don&rsquo;t replace what&rsquo;s there. Not happy with one? Click <span className="font-medium text-[#4A5468]">Edit</span> on it to tweak the text or give a custom prompt. Approve to assign it to a producer — nothing publishes directly.</div>
          </div>
          )}

          {deriveErr && <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 px-5 py-4 text-sm">Couldn&rsquo;t generate — {deriveErr}</div>}

          {/* The result.
              "Verified" is claimed only when sources actually came back. It used to be
              unconditional, so a WhatsApp template that cited nothing still carried a
              green tick reading "Verified — 0 live sources", which is worse than no
              badge: it teaches people the badge means nothing. */}
          <div className={`rounded-2xl border bg-white p-5 mb-4 ${verified ? "border-emerald-200" : "border-gray-100"}`}>
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <div className={`text-[10.5px] uppercase tracking-wide font-semibold ${verified ? "text-emerald-700" : "text-[#8A92A6]"}`}>
                {verified ? "Source · verified" : kind === "copy" ? "Ready to use" : "Result"}
              </div>
              {verified ? (
                <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1"><IconCircleCheck size={14} /> Verified — {citations.length} live source{citations.length === 1 ? "" : "s"}</div>
              ) : (
                // Not happy with it? Change the voice and run it again, right here —
                // rather than scrolling back up to the task box to find the button.
                <div className="inline-flex items-center gap-2">
                  <PreviewSelect className="w-[150px]" value={tone} onChange={setTone}
                    options={[{ value: "", label: "Default tone" },
                              { value: "professional", label: "Professional" },
                              { value: "friendly", label: "Friendly" },
                              { value: "direct", label: "Direct" },
                              { value: "warm", label: "Warm" }]} />
                  <button onClick={run} disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-[12.5px] font-medium text-[#4A5468] px-3 py-1.5 hover:border-brand hover:text-brand disabled:opacity-40 transition">
                    <IconRefresh size={13} /> {loading ? "Regenerating…" : "Regenerate"}
                  </button>
                </div>
              )}
            </div>
            <MarkdownLite text={output} />
            {citations.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                {!verified && <div className="text-[11px] text-[#A6ACBE] mb-1">What it read while writing this:</div>}
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {citations.slice(0, 8).map((c, i) => (
                  <a key={i} href={c} target="_blank" rel="noopener noreferrer" className="text-[11.5px] text-brand hover:underline inline-flex items-center gap-1 max-w-[300px] truncate">
                    <IconExternalLink size={10} className="shrink-0" /> <span className="truncate">{c}</span>
                  </a>
                ))}
              </div>
              </div>
            )}
          </div>

          {/* Outputs — masonry: each card drops into the shorter column, in generation
              order. Packs tight (no gaps) and keeps a sensible order. */}
          {(deriving || derived.length > 0) && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <div ref={col0Ref} className="flex flex-col gap-4">
                  {derived.filter((d) => colOf[d.format] === 0).map((d) => (
                    <DerivedCard key={d.format} d={d} skillName={skill.name} source={output || ""} isNew={newFormats.has(d.format)} onTokens={(n) => setDeriveTokens((p) => p + n)} />
                  ))}
                </div>
                <div ref={col1Ref} className="flex flex-col gap-4">
                  {derived.filter((d) => colOf[d.format] === 1).map((d) => (
                    <DerivedCard key={d.format} d={d} skillName={skill.name} source={output || ""} isNew={newFormats.has(d.format)} onTokens={(n) => setDeriveTokens((p) => p + n)} />
                  ))}
                </div>
              </div>
              {deriving && <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-5 text-[13px] text-[#8A92A6]">Creating your selected format(s)… 20–40s.</div>}
            </>
          )}
        </>
      )}
    </div>
  );
}
