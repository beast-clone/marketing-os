"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoadingBlock } from "@/components/LoadingBlock";
import {
  IconCheck, IconClock, IconX, IconFileText, IconStar, IconList, IconSearch, IconPlus, IconSend,
  IconArrowBackUp, IconUser, IconCalendar, IconCash, IconBell, IconHeart, IconPencil, IconAlertTriangle, IconInfoCircle,
} from "@tabler/icons-react";
import { DEFAULT_GROUPS, DEFAULT_TEMPLATES, DEFAULT_FOOTER, type DefaultTemplate } from "@/lib/wa-default-templates";

// WhatsApp Inbox → Templates (Praveen, 6 Nov 2026 — prototype public/mockups/wa-templates.html).
//
// Every template on +91 74116 54951 with Meta's verdict, GooCampus's default set
// for when a chat's 24-hour window has closed, and a form to write one and send it
// to Meta for approval. Status is Meta's, read live; nothing here is stored by us.

type Live = { name: string; language: string; category: string; header: string | null; body: string; footer: string | null; variables: number; buttons: string[]; status: string; reason: string | null };
type Draft = { name: string; category: "UTILITY" | "MARKETING"; body: string; example: string[]; footer: string; buttons: string[]; typed?: number[] };

const GROUP_ICON = [IconArrowBackUp, IconUser, IconCalendar, IconFileText, IconCash, IconBell, IconHeart];
const STATUS: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: "Approved", cls: "bg-[#E3F5EA] text-[#137A3E]" },
  PENDING: { label: "Waiting for Meta", cls: "bg-[#FDF3E1] text-[#9A5B0B]" },
  IN_APPEAL: { label: "Waiting for Meta", cls: "bg-[#FDF3E1] text-[#9A5B0B]" },
  REJECTED: { label: "Rejected", cls: "bg-[#FDE7E7] text-[#C0342E]" },
  PAUSED: { label: "Paused by Meta", cls: "bg-[#F1F2F6] text-[#5A6273]" },
  DISABLED: { label: "Disabled by Meta", cls: "bg-[#F1F2F6] text-[#5A6273]" },
  NONE: { label: "Not created yet", cls: "bg-[#F1F2F6] text-[#5A6273]" },
};
const chip = (s: string) => STATUS[s] || { label: s, cls: "bg-[#F1F2F6] text-[#5A6273]" };
const USED_BY: Record<string, string> = {
  india_payment_successful_v2: "India eBook workflow", india_access_ready_: "India eBook workflow", india_payment_failed_retry: "India eBook workflow",
  als_enquiry_callback_v2: "ALS Leads workflow", als_new_inquiry_alert: "ALS Leads workflow (to Jeswin)",
  amc_payment_successful: "AMC eBook workflow", amc_access_ready_: "AMC eBook workflow", amc_payment_failed_retry: "AMC eBook workflow",
  goocampus_callback_alert: "Round-robin lead assignment", samvaya_waitlist_confirmation: "Samvaya waitlist", neet_pg_al_ameen_event: "NEET PG Bijapur event",
};
const usedBy = (n: string) => USED_BY[n] || (n.startsWith("samvaya") ? "Samvaya" : n.startsWith("gc_") ? "GooCampus default" : "—");

/** A template as WhatsApp shows it, with the blanks filled and highlighted. */
export function Bubble({ body, values, footer, buttons, typed = [] }: { body: string; values: string[]; footer?: string | null; buttons?: string[]; typed?: number[] }) {
  const parts = body.split(/(\{\{\d+\}\})/g);
  return (
    <div>
      <div className="whitespace-pre-wrap break-words rounded-[10px_10px_10px_2px] border border-[#E4E7EE] bg-white px-3 py-2 text-[13px] leading-relaxed text-[#232D42]">
        {parts.map((p, i) => {
          const m = p.match(/^\{\{(\d+)\}\}$/);
          if (!m) return <span key={i}>{p}</span>;
          const n = Number(m[1]);
          return <span key={i} className={`rounded px-1 text-[12px] ${typed.includes(n) ? "bg-[#FFF4D6] text-[#7A5300]" : "bg-brand-light text-[#2138B0]"}`}>{values[n - 1] || p}</span>;
        })}
        {footer && <span className="mt-1.5 block text-[11.5px] text-[#8A92A6]">{footer}</span>}
      </div>
      {!!buttons?.length && (
        <div className="mt-1.5">
          <div className="flex flex-wrap gap-1.5">
            {buttons.map((b) => <span key={b} className="inline-flex cursor-default items-center gap-1 rounded-lg border border-[#DCE1F8] bg-white px-2 py-1 text-[12px] text-brand"><IconArrowBackUp size={12} />{b}</span>)}
          </div>
          <div className="group relative mt-1 inline-flex items-center gap-1 text-[11px] text-[#8A92A6]">
            <IconInfoCircle size={13} className="text-brand" aria-hidden />
            <span>Buttons the student taps in WhatsApp</span>
            <div role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 hidden w-64 rounded-lg border border-gray-100 bg-[#232D42] px-3 py-2 text-[11.5px] leading-relaxed text-white group-hover:block">
              These are a preview — they don&apos;t do anything here. On the student&apos;s phone they show under the message. When they tap one, that word (for example &quot;{buttons[0]}&quot;) comes to our Chats as their reply, and the 24-hour window opens again so you can type to them freely.{buttons.some((b) => /call/i.test(b)) && <> A &quot;Call&quot; button doesn&apos;t ring anyone — it tells us they want a call back.</>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const fromDefault = (d: DefaultTemplate): Draft => ({ name: d.name, category: d.category, body: d.body, example: [...d.example], footer: DEFAULT_FOOTER, buttons: [...d.buttons], typed: d.typed });

async function submitDraft(d: Draft): Promise<{ ok: boolean; msg: string }> {
  const r = await fetch("/api/wa-inbox/templates/new", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: d.name, category: d.category, body: d.body, footer: d.footer, example: d.example, buttons: d.buttons }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, msg: j.error || "Couldn't submit it" };
  return { ok: true, msg: `"${j.name}" sent to Meta — ${String(j.category || d.category).toLowerCase()}, ${chip(j.status || "PENDING").label.toLowerCase()}.` };
}

function Drawer({ draft, live, onClose, onSubmitted }: { draft: Draft; live: Live | null; onClose: () => void; onSubmitted: (msg: string) => void }) {
  const readOnly = !!live && live.status !== "REJECTED";
  // A rejected template is fixed and sent again under a new name — Meta keeps the old one.
  const [d, setD] = useState<Draft>(live?.status === "REJECTED" ? { ...draft, name: `${draft.name}_v2` } : draft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const vars = Math.max(0, ...[...d.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
  useEffect(() => { setD((x) => ({ ...x, example: Array.from({ length: vars }, (_, i) => x.example[i] || "") })); }, [vars]);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const input = "w-full rounded-lg border border-[#E2E5EC] bg-white px-3 py-2 text-[13px] text-[#232D42] outline-none focus:border-brand disabled:bg-[#F6F7FB]";

  async function go() {
    setBusy(true); setErr("");
    const r = await submitDraft(d);
    setBusy(false);
    if (r.ok) onSubmitted(r.msg); else setErr(r.msg);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#232D42]/35" onClick={onClose}>
      <div className="flex h-full w-[880px] max-w-full flex-col bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-[#DCE1F8] bg-brand-light px-5 py-4">
          <IconPencil size={18} className="text-brand" />
          <h3 className="text-[16px] font-medium text-[#232D42]">{live ? live.name : draft.name ? "Edit before sending" : "New template"}</h3>
          <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${chip(live ? live.status : "NONE").cls}`}>{live ? chip(live.status).label : "Draft"}</span>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg border border-[#E2E5EC] bg-white p-1.5 text-[#8A92A6] hover:text-[#232D42]" aria-label="Close"><IconX size={15} /></button>
        </div>
        <div className="grid flex-1 grid-cols-[1fr_300px] gap-6 overflow-auto px-5 py-5">
          <div className="space-y-4">
            {live?.reason && (
              <div className="flex gap-2 rounded-lg bg-[#FDE7E7] px-3 py-2.5 text-[12.5px] text-[#C0342E]">
                <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>Meta rejected it: <b className="font-medium">{live.reason.replace(/_/g, " ").toLowerCase()}</b>. Edit it below and send it again under a new name.</span>
              </div>
            )}
            {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{err}</div>}
            <div>
              <label className="mb-1 block text-[12px] text-[#8A92A6]">Name</label>
              <input disabled={readOnly} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. gc_missed_reply_followup" className={input} />
              <p className="mt-1 text-[11.5px] text-[#8A92A6]">Lowercase letters, numbers and underscores. Only we see it.</p>
            </div>
            <div>
              <label className="mb-1 block text-[12px] text-[#8A92A6]">Category</label>
              <div className="flex gap-1.5">
                {(["UTILITY", "MARKETING"] as const).map((c) => (
                  <button key={c} type="button" disabled={readOnly} onClick={() => set({ category: c })}
                    className={`h-9 flex-1 rounded-lg border text-[12.5px] font-medium ${d.category === c ? "border-brand bg-brand-light text-[#2138B0]" : "border-[#E2E5EC] bg-white text-[#4A5468]"}`}>
                    {c === "UTILITY" ? "Utility" : "Marketing"}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-[#8A92A6]"><b className="font-medium">Utility</b> — about something the person asked for or is in the middle of (their enquiry, payment, session). Cheaper. <b className="font-medium">Marketing</b> — offers, events, people gone quiet. Meta moves a template to Marketing if it reads like a promotion.</p>
            </div>
            <div>
              <label className="mb-1 block text-[12px] text-[#8A92A6]">Message</label>
              <textarea disabled={readOnly} value={d.body} onChange={(e) => set({ body: e.target.value })} rows={6} maxLength={1024} className={`${input} resize-y leading-relaxed`} />
              {!readOnly && (
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[#8A92A6]">
                  Use {"{{1}}"}, {"{{2}}"}… for what you type each time you send it. It can&apos;t start or end with a blank.
                  <button type="button" onClick={() => set({ body: `${d.body}{{${vars + 1}}}` })}
                    className="inline-flex items-center gap-1 rounded-md border border-[#E2E5EC] bg-white px-2 py-0.5 font-medium text-[#232D42] hover:border-brand"><IconPlus size={12} />Add a blank</button>
                </p>
              )}
            </div>
            {vars > 0 && !readOnly && (
              <div>
                <label className="mb-1 block text-[12px] text-[#8A92A6]">An example for each blank (Meta reviews it with these)</label>
                <div className="grid grid-cols-[60px_1fr] items-center gap-x-2.5 gap-y-1.5">
                  {d.example.map((v, i) => (<Fragment key={i}>
                    <span className="text-[12px] text-[#8A92A6]">{`{{${i + 1}}}`}</span>
                    <input value={v} onChange={(e) => set({ example: d.example.map((x, j) => (j === i ? e.target.value : x)) })} className={input} />
                  </Fragment>))}
                </div>
              </div>
            )}
            <div>
              <label className="mb-1 block text-[12px] text-[#8A92A6]">Footer (optional)</label>
              <input disabled={readOnly} value={d.footer} maxLength={60} onChange={(e) => set({ footer: e.target.value })} className={input} />
            </div>
            <div>
              <label className="mb-1 block text-[12px] text-[#8A92A6]">Buttons (optional, up to 3 quick replies)</label>
              <input disabled={readOnly} value={d.buttons.join(", ")} onChange={(e) => set({ buttons: e.target.value.split(",").map((s) => s.trimStart()).slice(0, 3) })}
                placeholder="Comma separated, e.g. Continue chat, Call me" className={input} />
              <p className="mt-1 text-[11.5px] text-[#8A92A6]">Buttons go out with the message. When they tap one, the 24-hour window opens and you can type freely again.</p>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[12px] text-[#8A92A6]">Preview</label>
            <div className="rounded-2xl border border-[#EEF0F4] bg-[#F0F2F7] p-3">
              <div className="-mx-3 -mt-3 mb-3 flex items-center gap-2 rounded-t-2xl border-b border-[#EEF0F4] bg-white px-3 py-2.5 text-[12.5px] font-medium text-[#232D42]">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-light text-[10px] text-brand">GC</span>GooCampus Edu Solutions
              </div>
              <Bubble body={d.body || "Your message appears here."} values={d.example} footer={d.footer} buttons={d.buttons.map((b) => b.trim()).filter(Boolean)} typed={d.typed} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-[#EEF0F4] px-5 py-3.5">
          <span className="mr-auto max-w-[440px] text-[12px] text-[#8A92A6]">
            {readOnly ? (live?.status === "APPROVED" ? "Approved by Meta — it can be sent from any chat." : "Waiting for Meta's review. This page checks again every two minutes.")
              : "Meta reviews every template, usually within minutes. Nothing can be sent with it until it's approved."}
          </span>
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-[#E2E5EC] bg-white px-3.5 text-[13px] font-medium text-[#232D42]">{readOnly ? "Close" : "Cancel"}</button>
          {!readOnly && (
            <button type="button" onClick={go} disabled={busy || !d.name.trim() || !d.body.trim()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[13px] font-medium text-white hover:bg-[#2138B0] disabled:opacity-50">
              <IconSend size={15} />{busy ? "Sending to Meta…" : "Send to Meta for approval"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type Item = { key: string; name: string; group: string; def: DefaultTemplate | null; live: Live | null; status: string };
// The Status card, styled like the Scheduler's (Praveen, 6 Nov).
const SEGS: { key: string; name: string; hint: string; tone: string; tint: string; Icon: typeof IconList; match: (i: Item) => boolean }[] = [
  { key: "ALL", name: "All templates", hint: "Everything on this number", tone: "#3A57E8", tint: "rgba(58,87,232,0.12)", Icon: IconList, match: () => true },
  { key: "APPROVED", name: "Approved", hint: "Ready to send", tone: "#1AA053", tint: "rgba(26,160,83,0.12)", Icon: IconCheck, match: (i) => i.status === "APPROVED" },
  { key: "PENDING", name: "Waiting for Meta", hint: "Under review", tone: "#D9861B", tint: "rgba(226,154,46,0.12)", Icon: IconClock, match: (i) => i.status === "PENDING" || i.status === "IN_APPEAL" },
  { key: "REJECTED", name: "Rejected", hint: "Needs a fix", tone: "#E5484D", tint: "rgba(229,72,77,0.12)", Icon: IconAlertTriangle, match: (i) => ["REJECTED", "PAUSED", "DISABLED"].includes(i.status) },
  { key: "NONE", name: "Defaults to create", hint: "Not sent to Meta yet", tone: "#4A5468", tint: "rgba(74,84,104,0.10)", Icon: IconFileText, match: (i) => i.status === "NONE" },
  { key: "UTILITY", name: "Utility", hint: "Cheaper, rarely rejected", tone: "#0A66C2", tint: "rgba(10,102,194,0.10)", Icon: IconStar, match: (i) => i.status !== "NONE" && (i.live?.category || i.def?.category) === "UTILITY" },
  { key: "MARKETING", name: "Marketing", hint: "Opt-in only, costs more", tone: "#B4661E", tint: "rgba(180,102,30,0.10)", Icon: IconBell, match: (i) => i.status !== "NONE" && (i.live?.category || i.def?.category) === "MARKETING" },
];

// Laid out like Chats (Praveen, 6 Nov): the list on the left with search and the
// status tabs, the selected template in the middle as WhatsApp shows it, and its
// details on the right.
export default function TemplatesTab({ startNew = false }: { startNew?: boolean }) {
  const [live, setLive] = useState<Live[] | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [seg, setSeg] = useState("ALL");
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState<{ draft: Draft; live: Live | null } | null>(
    startNew ? { draft: { name: "", category: "UTILITY", body: "", example: [], footer: DEFAULT_FOOTER, buttons: [] }, live: null } : null);
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/wa-inbox/templates?all=1", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't load templates");
      setLive(j.templates || []); setErr(j.error || "");
    } catch (e) { setErr((e as Error).message); setLive((x) => x ?? []); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 120_000); return () => clearInterval(t); }, [load]);

  // Defaults in their groups first (whether or not they exist yet), then everything else.
  const items = useMemo<Item[]>(() => {
    const byName = new Map((live || []).map((t) => [t.name, t]));
    const defs: Item[] = DEFAULT_GROUPS.flatMap((g) => g.items.map((d) => {
      const lt = byName.get(d.name) || null;
      return { key: d.name, name: d.name, group: g.title, def: d, live: lt, status: lt ? lt.status : "NONE" };
    }));
    const others: Item[] = (live || []).filter((t) => !DEFAULT_TEMPLATES.some((d) => d.name === t.name))
      .map((t) => ({ key: `${t.name}|${t.language}`, name: t.name, group: "Other templates", def: null, live: t, status: t.status }));
    return [...defs, ...others];
  }, [live]);
  const segCount = (k: string) => items.filter((i) => SEGS.find((s) => s.key === k)!.match(i)).length;
  const notCreated = items.filter((i) => i.status === "NONE" && i.def).map((i) => i.def!);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase(); const m = SEGS.find((x) => x.key === seg)!.match;
    return items.filter((i) => m(i) && (!s || `${i.name} ${i.live?.body || i.def?.body || ""}`.toLowerCase().includes(s)));
  }, [items, q, seg]);
  const groups = useMemo(() => {
    const out: { title: string; list: Item[] }[] = [];
    for (const i of shown) { const g = out.find((x) => x.title === i.group); if (g) g.list.push(i); else out.push({ title: i.group, list: [i] }); }
    return out;
  }, [shown]);
  const cur = items.find((i) => i.key === sel) || null;
  // ?open=<name> — a status-change notification opens that template.
  const opened = useRef(false);
  useEffect(() => {
    if (!live || opened.current) return;
    opened.current = true;   // once — the 2-minute refresh must not undo the user's own pick
    const want = new URLSearchParams(window.location.search).get("open");
    const hit = want && items.find((i) => i.name === want);
    if (hit) setSel(hit.key);
  }, [live, items]);

  async function sendOne(d: DefaultTemplate) {
    setBusy(true); setNote("");
    const r = await submitDraft(fromDefault(d));
    setBusy(false); setNote(r.msg); if (r.ok) load();
  }
  async function sendAll() {
    const todo = notCreated; let ok = 0; const failed: string[] = [];
    for (let i = 0; i < todo.length; i++) {
      setBulk(`Sending ${i + 1} of ${todo.length}…`);
      const r = await submitDraft(fromDefault(todo[i]));
      if (r.ok) ok++; else failed.push(`${todo[i].name}: ${r.msg}`);
      if (i < todo.length - 1) await new Promise((res) => setTimeout(res, 2500));   // stay well under Meta's and our rate limits
    }
    setBulk(""); setNote(`${ok} sent to Meta for approval.${failed.length ? ` ${failed.length} didn't go: ${failed.join(" · ")}` : ""}`);
    load();
  }
  const newDraft = () => setOpen({ draft: { name: "", category: "UTILITY", body: "", example: [], footer: DEFAULT_FOOTER, buttons: [] }, live: null });
  const draftOf = (i: Item): Draft => i.def ? fromDefault(i.def)
    : { name: i.name, category: i.live?.category === "MARKETING" ? "MARKETING" : "UTILITY", body: i.live?.body || "", example: [], footer: i.live?.footer || "", buttons: i.live?.buttons || [] };

  if (!live) return <LoadingBlock label="Loading templates from Meta…" />;

  const catOf = (i: Item) => (i.live?.category || i.def?.category || "UTILITY");
  const catChip = (c: string) => <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${c === "MARKETING" ? "bg-[#FDF3E1] text-[#9A5B0B]" : "bg-[#F6F7FB] text-[#4A5468]"}`}>{c.toLowerCase()}</span>;
  const GroupIcon = (title: string) => GROUP_ICON[DEFAULT_GROUPS.findIndex((g) => g.title === title)] || IconList;
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1 text-[12.5px]"><span className="text-[#8A92A6]">{k}</span><span className="text-right text-[#232D42]">{v}</span></div>
  );

  return (
    <div className="space-y-3">
      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{err}</div>}
      {note && <div className="flex items-start gap-2 rounded-lg bg-brand-light px-3 py-2 text-[12.5px] text-[#2138B0]"><IconCheck size={15} className="mt-0.5 shrink-0" /><span>{note}</span>
        <button type="button" onClick={() => setNote("")} className="ml-auto" aria-label="Dismiss"><IconX size={14} /></button></div>}

      <div className="grid grid-cols-[232px_minmax(300px,380px)_minmax(0,1fr)] items-start gap-3">
        {/* 1 — statuses */}
        <aside className="sticky top-3 flex max-h-[calc(100vh-24px)] min-h-[420px] flex-col rounded-[14px] border border-[#EEF0F4] bg-white">
          <div className="border-b border-[#EEF0F4] px-3.5 pb-2.5 pt-3 text-[16px] font-medium text-[#232D42]">Status</div>
          <div className="overflow-y-auto p-1.5">
            {SEGS.map((st) => {
              const on = seg === st.key;
              return (
                <button key={st.key} type="button" onClick={() => setSeg(st.key)} title={`${st.name} — ${st.hint}`}
                  className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-[9px] text-left text-[#232D42] ${on ? "" : "hover:bg-[#F8F9FC]"}`}
                  style={on ? { background: st.tint } : undefined}>
                  <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg" style={{ background: st.tint, color: st.tone }}><st.Icon size={16} stroke={1.8} /></span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{st.name}
                    <span className="block truncate text-[11.5px] font-normal text-[#8A92A6]">{st.hint}</span></span>
                  <span className="min-w-[26px] shrink-0 rounded-full px-2 py-px text-center text-[12.5px] font-medium"
                    style={on ? { background: "#fff", color: st.tone } : { background: "#F1F3F7", color: "#4A5468" }}>{segCount(st.key)}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* 2 — the templates in that status */}
        <section className="sticky top-3 flex max-h-[calc(100vh-24px)] min-h-[420px] flex-col rounded-[14px] border border-[#EEF0F4] bg-white">
          <div className="flex items-center gap-2 border-b border-[#EEF0F4] px-3.5 pb-2.5 pt-3">
            <div className="min-w-0"><div className="text-[16px] font-medium text-[#232D42]">{SEGS.find((x) => x.key === seg)!.name}</div>
              <div className="text-[11.5px] text-[#8A92A6]">{shown.length} template{shown.length === 1 ? "" : "s"}</div></div>
            <button type="button" onClick={newDraft}
              className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg bg-brand px-2.5 text-[12px] font-medium text-white hover:bg-[#2138B0]"><IconPlus size={14} />New template</button>
          </div>
          <div className="flex flex-col gap-2 px-3.5 py-2.5">
            <label className="flex items-center gap-2 rounded-[10px] border border-gray-100 bg-[#F6F7FB] px-2.5 py-2 text-[13px]">
              <IconSearch size={15} className="shrink-0 text-[#8A92A6]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or text"
                className="w-full bg-transparent text-[#232D42] outline-none placeholder:text-[#8A92A6]" />
            </label>
            {notCreated.length > 0 && (
              <button type="button" onClick={sendAll} disabled={!!bulk}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-brand bg-brand-light text-[12px] font-medium text-[#2138B0] disabled:opacity-60">
                <IconSend size={14} />{bulk || `Send ${notCreated.length} new default${notCreated.length === 1 ? "" : "s"} for approval`}
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto border-t border-[#EEF0F4]">
            {groups.length === 0 && <div className="px-6 py-10 text-center text-[13px] text-[#8A92A6]">Nothing here.</div>}
            {groups.map((g) => {
              const GI = GroupIcon(g.title);
              return (
                <div key={g.title}>
                  <div className="sticky top-0 z-[1] flex items-center gap-1.5 bg-[#FAFBFD] px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-[#8A92A6]">
                    <GI size={13} />{g.title}<span className="ml-auto normal-case tracking-normal">{g.list.length}</span>
                  </div>
                  {g.list.map((i) => (
                    <button key={i.key} type="button" onClick={() => setSel(i.key)}
                      className={`block w-full border-b border-gray-50 px-3.5 py-2.5 text-left ${sel === i.key ? "bg-brand-light" : "hover:bg-[#F6F7FB]"}`}>
                      <span className="flex items-center gap-2">
                        <span className="truncate font-mono text-[12.5px] text-[#232D42]">{i.name}</span>
                        <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${chip(i.status).cls}`}>{chip(i.status).label}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-[#8A92A6]">{(i.live?.body || i.def?.body || "").replace(/\n+/g, " ")}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </section>

        {/* 3 — the opened template */}
        <section className="sticky top-3 flex max-h-[calc(100vh-24px)] min-h-[420px] flex-col overflow-hidden rounded-[14px] border border-[#EEF0F4] bg-white">
          {!cur ? (
            <div className="grid flex-1 place-items-center p-6 text-center">
              <div>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand-light text-brand"><IconFileText size={24} /></span>
                <div className="mt-3 text-[14px] font-medium text-[#232D42]">Pick a template to see it</div>
                <div className="mx-auto mt-1 max-w-[320px] text-[12px] leading-relaxed text-[#8A92A6]">
                  <b className="font-medium">Utility</b> is about their own enquiry, payment or session — cheaper and rarely rejected.
                  {" "}<b className="font-medium">Marketing</b> costs more and goes only to people who opted in. Meta reviews every template, usually in minutes.
                </div>
              </div>
            </div>
          ) : (<>
            <header className="flex flex-wrap items-center gap-2 border-b border-[#EEF0F4] px-4 py-3">
              <span className="font-mono text-[14px] text-[#232D42]">{cur.name}</span>
              {catChip(catOf(cur))}
              <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${chip(cur.status).cls}`}>{chip(cur.status).label}</span>
              <div className="ml-auto flex items-center gap-2">
                {cur.status === "NONE" && cur.def && (<>
                  <button type="button" onClick={() => setOpen({ draft: draftOf(cur), live: null })}
                    className="h-8 rounded-lg border border-[#E2E5EC] bg-white px-3 text-[12.5px] font-medium text-[#232D42]">Edit first</button>
                  <button type="button" onClick={() => sendOne(cur.def!)} disabled={busy}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white hover:bg-[#2138B0] disabled:opacity-60"><IconSend size={14} />{busy ? "Sending…" : "Send for approval"}</button>
                </>)}
                {cur.status === "REJECTED" && (
                  <button type="button" onClick={() => setOpen({ draft: draftOf(cur), live: cur.live })}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white"><IconPencil size={14} />Fix and resend</button>
                )}
                {cur.live && cur.status !== "REJECTED" && (
                  <button type="button" onClick={() => setOpen({ draft: { ...draftOf(cur), name: `${cur.name}_v2` }, live: null })}
                    className="h-8 rounded-lg border border-[#E2E5EC] bg-white px-3 text-[12.5px] font-medium text-[#232D42]">Copy as new</button>
                )}
              </div>
            </header>
            <div className="flex flex-1 flex-wrap items-start gap-5 overflow-y-auto bg-[#F6F7FB] p-5">
              <div className="min-w-[280px] max-w-[420px] flex-1">
                <div className="rounded-2xl border border-[#EEF0F4] bg-[#F0F2F7] p-3">
                  <div className="-mx-3 -mt-3 mb-3 flex items-center gap-2 rounded-t-2xl border-b border-[#EEF0F4] bg-white px-3 py-2.5 text-[12.5px] font-medium text-[#232D42]">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-light text-[10px] text-brand">GC</span>GooCampus Edu Solutions
                  </div>
                  {cur.live?.header && <div className="mb-1 text-[12px] font-medium text-[#232D42]">{cur.live.header}</div>}
                  <Bubble body={cur.live?.body || cur.def?.body || ""} values={cur.def?.example || []}
                    footer={cur.live ? cur.live.footer : DEFAULT_FOOTER} buttons={cur.live?.buttons || cur.def?.buttons || []} typed={cur.def?.typed} />
                </div>
                <p className="mt-2.5 text-center text-[12px] text-[#8A92A6]">
                  {cur.status === "APPROVED" ? "Approved — pick it from the template button in any chat."
                    : cur.status === "NONE" ? "Not on WhatsApp yet. Send it for approval to use it."
                    : cur.status === "REJECTED" ? "Rejected by Meta — see the reason beside it."
                    : "Waiting for Meta's review. This page checks again every two minutes."}
                  {cur.def ? " Highlighted words are examples of what you type." : ""}
                </p>
              </div>
              <div className="flex min-w-[240px] flex-1 flex-col gap-3">
                {cur.live?.reason && (
                  <div className="flex gap-2 rounded-xl bg-[#FDE7E7] px-3.5 py-3 text-[12.5px] text-[#C0342E]">
                    <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <span><b className="font-medium">Meta&apos;s reason:</b> {cur.live.reason.replace(/_/g, " ").toLowerCase()}</span>
                  </div>
                )}
                {cur.def && (
                  <div className="rounded-xl bg-white px-3.5 py-3">
                    <div className="flex items-center gap-1.5 text-[13px] font-medium text-[#2138B0]"><IconStar size={15} />When to use it</div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-[#4A5468]">{cur.def.when}</p>
                  </div>
                )}
                <div className="rounded-xl bg-white px-3.5 py-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-[#232D42]"><IconList size={15} className="text-brand" />Details</div>
                  {row("Status", <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${chip(cur.status).cls}`}>{chip(cur.status).label}</span>)}
                  {row("Category", catChip(catOf(cur)))}
                  {row("Language", cur.live?.language || "en")}
                  {row("Blanks", String(Math.max(0, ...[...(cur.live?.body || cur.def?.body || "").matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))))}
                  {row("Buttons", (cur.live?.buttons || cur.def?.buttons || []).length || "—")}
                  {row("Used by", usedBy(cur.name))}
                </div>
                {catOf(cur) === "MARKETING" && cur.def?.category === "UTILITY" && (
                  <p className="rounded-xl bg-[#FDF3E1] px-3.5 py-3 text-[12px] leading-relaxed text-[#9A5B0B]">
                    We asked for utility; Meta made it marketing. It still sends, at the marketing rate, and only to people who opted in.
                  </p>
                )}
                {cur.def?.note && <p className="text-[12px] leading-relaxed text-[#8A92A6]">{cur.def.note}</p>}
              </div>
            </div>
          </>)}
        </section>
      </div>

      {open && <Drawer draft={open.draft} live={open.live} onClose={() => setOpen(null)}
        onSubmitted={(m) => { setOpen(null); setNote(m); load(); }} />}
    </div>
  );
}
