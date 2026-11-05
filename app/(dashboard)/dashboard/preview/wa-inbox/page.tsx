"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { LoadingBlock } from "@/components/LoadingBlock";
import {
  IconBrandWhatsapp, IconSearch, IconSend, IconCheck, IconChecks, IconAlertTriangle, IconClock, IconMessageCircle,
  IconInfoCircle, IconTemplate, IconUserCheck, IconShieldCheck, IconCoinRupee, IconGauge,
  IconUser, IconTag, IconNote, IconPlus, IconX, IconExternalLink, IconChevronDown, IconArchive, IconBan, IconInbox,
} from "@tabler/icons-react";

// WhatsApp Inbox — the official number +91 74116 54951 (the one the eBook and lead
// workflows send from). Replies used to go nowhere; n8n "WA Inbox — receive" now
// saves them in Supabase `wa_messages`, and replies go out through n8n
// "WA Inbox — send reply". Free-text replies are only allowed by WhatsApp within
// 24 hours of the person's last message, so the reply box closes after that.
//
// One number serves the whole team, so a chat also carries who is handling it,
// what it is about and whether it is done — see wa_contacts and lib/wa-inbox.ts.

type Conv = {
  contact: string; name: string | null; last: string; lastAt: string; lastDir: string;
  unread: number; lastInAt: string | null; open: boolean;
  assignedTo: string | null; labels: string[]; chatStatus: "open" | "closed" | "spam"; hasNote: boolean;
};
type Msg = { id: string; direction: "in" | "out"; kind: string; body: string | null; status: string | null; error: string | null; sent_by: string | null; created_at: string };
type Meta = { contact: string; display_name: string | null; assigned_to: string | null; labels: string[]; note: string | null; status: "open" | "closed" | "spam" };
type Lead = { name: string; phone: string | null; email: string | null; counsellor: string | null; source: string | null; leadStatus: string | null; url: string };
type Member = { id: string; name: string };
type QuickReply = { id: string; text: string; created_by: string | null };

const fmtNum = (d: string) => (d.startsWith("91") && d.length === 12 ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`);
const initials = (c: Conv) => (c.name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "#";
const when = (iso: string) => {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
const hoursLeft = (lastInAt: string | null) => lastInAt ? Math.max(0, Math.ceil((Date.parse(lastInAt) + 864e5 - Date.now()) / 36e5)) : 0;

function Tick({ m }: { m: Msg }) {
  if (m.direction !== "out") return null;
  if (m.status === "failed") return <IconAlertTriangle size={13} className="text-red-200" title={m.error || "Failed"} />;
  if (m.status === "read") return <IconChecks size={14} className="text-white" />;
  if (m.status === "delivered") return <IconChecks size={14} className="text-white/70" />;
  return <IconCheck size={13} className="text-white/70" />;
}

// WhatsApp's own rules, in plain words (Meta docs, checked 5 Nov 2026 — see docs/WA_INBOX_SPEC.md).
const RULES: { icon: typeof IconClock; title: string; text: string }[] = [
  { icon: IconClock, title: "24-hour reply window", text: "When someone messages us, we can reply freely for 24 hours. Every new message from them restarts the 24 hours." },
  { icon: IconTemplate, title: "After 24 hours: templates only", text: "If they haven't written in the last 24 hours, we can only send a Meta-approved template. The free reply box opens again as soon as they write back." },
  { icon: IconUserCheck, title: "Only people who said yes", text: "Message only people who agreed to hear from GooCampus (form, website, call). Never message bought or scraped numbers." },
  { icon: IconShieldCheck, title: "Blocks and reports hurt the number", text: "If people block or report us, the number's quality drops and Meta can limit or pause it. Keep messages useful and expected." },
  { icon: IconGauge, title: "Sending limits", text: "Templates to people outside the window are capped per day by Meta. Don't send the same person more than one message every few seconds." },
  { icon: IconCoinRupee, title: "Cost", text: "Templates are charged per message (marketing costs the most). Since 1 Oct 2026 Meta also charges replies beyond a free monthly allowance." },
];

const STATUS_LABEL: Record<Meta["status"], string> = { open: "Open", closed: "Closed", spam: "Spam" };

function SectionTitle({ icon: Icon, children }: { icon: typeof IconUser; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-[#232D42]">
      <Icon size={16} className="text-brand" />{children}
    </div>
  );
}

/**
 * Everything about the person on the other end: who they are in the Sales Hub,
 * who here is handling them, what the chat is about, and WhatsApp's rules.
 *
 * The rules used to fill this panel on their own. They matter most the first few
 * times, so they stay — folded away, below the things that change per chat.
 */
function ContactPanel({ cur, meta, lead, leadLoading, team, save, saving }: {
  cur: Conv | null; meta: Meta | null; lead: Lead | null; leadLoading: boolean;
  team: Member[]; save: (patch: Partial<Meta>) => void; saving: boolean;
}) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { setNote(meta?.note || ""); setNewLabel(""); }, [meta?.contact, meta?.note]);

  const left = cur ? hoursLeft(cur.lastInAt) : 0;
  const addLabel = () => {
    const l = newLabel.trim();
    if (!l || !meta) return;
    if (!meta.labels.includes(l)) save({ labels: [...meta.labels, l] });
    setNewLabel("");
  };

  return (
    <aside className="hidden w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-gray-100 bg-white p-4 xl:flex">
      {cur && (
        <div className={`rounded-xl px-3.5 py-3 ${cur.open ? "bg-brand-light" : "bg-[#F6F7FB]"}`}>
          <div className={`flex items-center gap-1.5 text-sm font-medium ${cur.open ? "text-brand" : "text-[#232D42]"}`}>
            <IconClock size={16} />{cur.open ? `Reply window open · ${left}h left` : "Reply window closed"}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[#8A92A6]">
            {cur.open
              ? "You can type any reply now. It closes 24 hours after their last message unless they write again."
              : cur.lastInAt
                ? "They last wrote more than 24 hours ago. Only an approved template can go out until they reply."
                : "They have never written to us, so only an approved template can go out."}
          </p>
        </div>
      )}

      {cur && meta && (<>
        {/* Who is handling it */}
        <div>
          <SectionTitle icon={IconUser}>Handled by</SectionTitle>
          <PreviewSelect
            value={meta.assigned_to || ""}
            onChange={(v) => save({ assigned_to: v || null })}
            options={[{ value: "", label: "Nobody yet" }, ...team.map((m) => ({ value: m.id, label: m.name }))]}
            placeholder="Nobody yet"
            size="sm"
          />
          <div className="mt-2 flex gap-1.5">
            {(["open", "closed", "spam"] as const).map((s) => (
              <button key={s} type="button" onClick={() => save({ status: s })}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium ${
                  meta.status === s ? "border-brand bg-brand-light text-brand" : "border-gray-100 text-[#8A92A6] hover:bg-[#F6F7FB]"}`}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        {/* What it's about */}
        <div>
          <SectionTitle icon={IconTag}>Labels</SectionTitle>
          {meta.labels.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {meta.labels.map((l) => (
                <span key={l} className="inline-flex items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-medium text-brand">
                  {l}
                  <button type="button" onClick={() => save({ labels: meta.labels.filter((x) => x !== l) })} aria-label={`Remove ${l}`}>
                    <IconX size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLabel(); } }}
              placeholder="Add a label" maxLength={40}
              className="min-w-0 flex-1 rounded-lg border border-gray-100 bg-[#F6F7FB] px-2.5 py-1.5 text-xs text-[#232D42] outline-none focus:border-brand" />
            <button type="button" onClick={addLabel} disabled={!newLabel.trim()}
              className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg bg-brand text-white disabled:opacity-40" aria-label="Add label">
              <IconPlus size={14} />
            </button>
          </div>
        </div>

        {/* A note for whoever picks this up next */}
        <div>
          <SectionTitle icon={IconNote}>Note</SectionTitle>
          <textarea value={note} onChange={(e) => setNote(e.target.value)}
            onBlur={() => { if ((meta.note || "") !== note) save({ note: note || null }); }}
            rows={3} maxLength={2000} placeholder="Anything the next person should know"
            className="w-full resize-none rounded-lg border border-gray-100 bg-[#F6F7FB] px-2.5 py-2 text-xs text-[#232D42] outline-none focus:border-brand" />
          <div className="mt-1 h-3 text-[10.5px] text-[#8A92A6]">{saving ? "Saving…" : ""}</div>
        </div>

        {/* Who they are, read live from the Sales Hub */}
        <div>
          <SectionTitle icon={IconUserCheck}>In the Sales Hub</SectionTitle>
          {leadLoading ? (
            <div className="text-xs text-[#8A92A6]">Looking them up…</div>
          ) : lead ? (
            <div className="rounded-xl bg-[#F6F7FB] px-3 py-2.5">
              <div className="text-xs font-medium text-[#232D42]">{lead.name}</div>
              <dl className="mt-1.5 space-y-1 text-[11px]">
                {lead.leadStatus && <div className="flex gap-2"><dt className="w-[62px] shrink-0 text-[#8A92A6]">Status</dt><dd className="text-[#232D42]">{lead.leadStatus}</dd></div>}
                {lead.counsellor && <div className="flex gap-2"><dt className="w-[62px] shrink-0 text-[#8A92A6]">Counsellor</dt><dd className="text-[#232D42]">{lead.counsellor}</dd></div>}
                {lead.source && <div className="flex gap-2"><dt className="w-[62px] shrink-0 text-[#8A92A6]">Source</dt><dd className="text-[#232D42]">{lead.source}</dd></div>}
                {lead.email && <div className="flex gap-2"><dt className="w-[62px] shrink-0 text-[#8A92A6]">Email</dt><dd className="truncate text-[#232D42]">{lead.email}</dd></div>}
              </dl>
              <a href={lead.url} target="_blank" rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline">
                Open in Sales Hub <IconExternalLink size={11} />
              </a>
            </div>
          ) : (
            <div className="rounded-xl bg-[#F6F7FB] px-3 py-2.5 text-[11px] leading-relaxed text-[#8A92A6]">
              No lead in the Sales Hub with this number. They may have written in before filling anything.
            </div>
          )}
        </div>
      </>)}

      {/* The rules — folded, because they're the same every time */}
      <div className="mt-auto border-t border-gray-100 pt-3">
        <button type="button" onClick={() => setRulesOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 text-sm font-medium text-[#232D42]">
          <IconInfoCircle size={16} className="text-brand" />WhatsApp rules
          <IconChevronDown size={14} className={`ml-auto text-[#8A92A6] transition-transform ${rulesOpen ? "rotate-180" : ""}`} />
        </button>
        {rulesOpen && (
          <ul className="mt-2.5 space-y-2.5">
            {RULES.map((r) => (
              <li key={r.title} className="flex gap-2.5">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand-light text-brand"><r.icon size={14} /></span>
                <span>
                  <span className="block text-xs font-medium text-[#232D42]">{r.title}</span>
                  <span className="block text-xs leading-relaxed text-[#8A92A6]">{r.text}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

type FilterKey = "all" | "unread" | "needsReply" | "mine" | "unassigned";
const FILTERS: { key: FilterKey; label: string; icon: typeof IconInbox }[] = [
  { key: "all", label: "All", icon: IconInbox },
  { key: "unread", label: "Unread", icon: IconMessageCircle },
  { key: "needsReply", label: "Window open", icon: IconClock },
  { key: "mine", label: "Mine", icon: IconUser },
  { key: "unassigned", label: "Unassigned", icon: IconUserCheck },
];

function Inbox() {
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [team, setTeam] = useState<Member[]>([]);
  const [allLabels, setAllLabels] = useState<string[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [labelFilter, setLabelFilter] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [leadLoading, setLeadLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [quick, setQuick] = useState<QuickReply[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    try {
      const r = await fetch("/api/wa-inbox", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't load");
      setConvs(j.conversations); setTeam(j.team || []); setAllLabels(j.labels || []); setMe(j.me ?? null); setErr("");
    } catch (e) { setErr((e as Error).message); }
  }, []);
  const loadThread = useCallback(async (c: string) => {
    const r = await fetch(`/api/wa-inbox?contact=${c}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setMsgs(j.messages);
  }, []);
  const loadContact = useCallback(async (c: string) => {
    setLeadLoading(true); setMeta(null); setLead(null);
    const r = await fetch(`/api/wa-inbox/contact?contact=${c}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setMeta(j.meta); setLead(j.lead); }
    setLeadLoading(false);
  }, []);

  const loadQuick = useCallback(async () => {
    const r = await fetch("/api/wa-inbox/quick-replies", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setQuick(j.replies || []);
  }, []);

  useEffect(() => { loadList(); loadQuick(); const t = setInterval(loadList, 15000); return () => clearInterval(t); }, [loadList, loadQuick]);
  useEffect(() => {
    if (!sel) return;
    setMsgs(null); setSendErr(""); loadThread(sel).then(loadList); loadContact(sel);
    const t = setInterval(() => loadThread(sel), 8000);
    return () => clearInterval(t);
  }, [sel, loadThread, loadList, loadContact]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs?.length]);

  /** Save a change to this chat's details, and keep the list in step. */
  const save = useCallback(async (patch: Partial<Meta>) => {
    if (!sel) return;
    setSaving(true);
    // Show it immediately — these are one-click actions and waiting on a round
    // trip to see a label appear makes the panel feel broken.
    setMeta((m) => (m ? { ...m, ...patch } as Meta : m));
    try {
      const r = await fetch("/api/wa-inbox/contact", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact: sel, ...patch }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setMeta(j.meta); else setErr(j.error || "Couldn't save");
      loadList();
    } catch (e) { setErr((e as Error).message); }
    setSaving(false);
  }, [sel, loadList]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (convs || []).filter((c) => {
      // Closed and spam chats are out of the way unless asked for, so the inbox
      // shows what still needs doing rather than everything that ever arrived.
      if (!showDone && c.chatStatus !== "open") return false;
      if (filter === "unread" && !c.unread) return false;
      if (filter === "needsReply" && !c.open) return false;
      if (filter === "mine" && c.assignedTo !== me) return false;
      if (filter === "unassigned" && c.assignedTo) return false;
      if (labelFilter && !c.labels.includes(labelFilter)) return false;
      if (!s) return true;
      return (c.name || "").toLowerCase().includes(s) || c.contact.includes(s.replace(/\D/g, "") || "~") || c.last.toLowerCase().includes(s);
    });
  }, [convs, q, filter, labelFilter, showDone, me]);
  const cur = convs?.find((c) => c.contact === sel) || null;
  const nameOf = (id: string | null) => team.find((m) => m.id === id)?.name || id;

  /** Keep the reply you just typed, so the next person doesn't retype it. */
  async function saveQuick() {
    const text = draft.trim();
    if (!text) return;
    const r = await fetch("/api/wa-inbox/quick-replies", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setQuick((q) => (q.some((x) => x.id === j.reply.id) ? q : [j.reply, ...q]));
    else setSendErr(j.error || "Couldn't save that reply");
  }
  async function removeQuick(id: string) {
    setQuick((q) => q.filter((x) => x.id !== id));
    await fetch(`/api/wa-inbox/quick-replies?id=${id}`, { method: "DELETE" });
  }

  async function send() {
    if (!sel || !draft.trim() || sending) return;
    setSending(true); setSendErr("");
    try {
      const r = await fetch("/api/wa-inbox/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: sel, text: draft }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't send");
      setMsgs((m) => [...(m || []), j.message]); setDraft(""); loadList();
    } catch (e) { setSendErr((e as Error).message); }
    setSending(false);
  }

  if (!convs && !err) return <LoadingBlock label="Loading WhatsApp chats…" />;

  return (
    <div className="flex h-[calc(100vh-230px)] min-h-[520px] overflow-hidden rounded-2xl border border-gray-100 bg-white">
      {/* Conversations */}
      <aside className="flex w-[330px] shrink-0 flex-col border-r border-gray-100">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-light text-brand"><IconBrandWhatsapp size={18} /></span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-[#232D42]">+91 74116 54951</div>
            <div className="text-xs text-[#8A92A6]">{list.length} shown · {convs?.reduce((s, c) => s + c.unread, 0) ?? 0} unread</div>
          </div>
        </div>

        <div className="space-y-2 px-3 py-2">
          <label className="flex items-center gap-2 rounded-lg border border-gray-100 bg-[#F6F7FB] px-2.5 py-1.5 text-sm">
            <IconSearch size={15} className="text-[#8A92A6]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number or message" className="w-full bg-transparent text-[#232D42] outline-none placeholder:text-[#8A92A6]" />
          </label>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" onClick={() => setFilter(f.key)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  filter === f.key ? "bg-brand text-white" : "bg-[#F6F7FB] text-[#8A92A6] hover:text-[#232D42]"}`}>
                <f.icon size={12} />{f.label}
              </button>
            ))}
          </div>
          {(allLabels.length > 0 || labelFilter) && (
            <div className="flex flex-wrap gap-1">
              {allLabels.map((l) => (
                <button key={l} type="button" onClick={() => setLabelFilter(labelFilter === l ? "" : l)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    labelFilter === l ? "bg-brand-light text-brand ring-1 ring-brand" : "bg-[#F6F7FB] text-[#8A92A6] hover:text-[#232D42]"}`}>
                  <IconTag size={11} />{l}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setShowDone((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-medium text-[#8A92A6] hover:text-brand">
            <IconArchive size={12} />{showDone ? "Hide closed and spam" : "Show closed and spam"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {err && <div className="m-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
          {!err && list.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-[#8A92A6]">
              {convs?.length ? "No chats match." : "No replies yet. When someone replies on WhatsApp to +91 74116 54951, the chat appears here."}
            </div>
          )}
          {list.map((c) => (
            <button key={c.contact} type="button" onClick={() => setSel(c.contact)}
              className={`flex w-full items-start gap-3 border-b border-gray-50 px-4 py-3 text-left ${sel === c.contact ? "bg-brand-light" : "hover:bg-[#F6F7FB]"}`}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-light text-xs font-medium text-brand">{initials(c)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm ${c.unread ? "font-semibold" : "font-medium"} text-[#232D42]`}>{c.name || fmtNum(c.contact)}</span>
                  <span className={`shrink-0 text-[11px] ${c.unread ? "text-brand" : "text-[#8A92A6]"}`}>{when(c.lastAt)}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className="truncate text-xs text-[#8A92A6]">{c.lastDir === "out" ? "You: " : ""}{c.last}</span>
                  {c.unread > 0 && <span className="ml-auto grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-brand px-1 text-[10px] font-medium text-white">{c.unread}</span>}
                </span>
                {(c.assignedTo || c.labels.length > 0 || c.hasNote || c.chatStatus !== "open") && (
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    {c.assignedTo && <span className="rounded-full bg-[#F6F7FB] px-1.5 py-0.5 text-[10px] font-medium text-[#8A92A6]">{nameOf(c.assignedTo)}</span>}
                    {c.labels.slice(0, 2).map((l) => (
                      <span key={l} className="rounded-full bg-brand-light px-1.5 py-0.5 text-[10px] font-medium text-brand">{l}</span>
                    ))}
                    {c.hasNote && <IconNote size={11} className="text-[#8A92A6]" />}
                    {c.chatStatus !== "open" && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-[#8A92A6]">
                        {c.chatStatus === "spam" ? <IconBan size={10} /> : <IconArchive size={10} />}{STATUS_LABEL[c.chatStatus]}
                      </span>
                    )}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* Chat */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#F6F7FB]">
        {!cur ? (
          <div className="grid flex-1 place-items-center text-center">
            <div>
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand-light text-brand"><IconMessageCircle size={24} /></span>
              <div className="mt-3 text-sm font-medium text-[#232D42]">Pick a chat to read and reply</div>
              <div className="mt-1 text-xs text-[#8A92A6]">Replies go out from +91 74116 54951.</div>
            </div>
          </div>
        ) : (<>
          <header className="flex items-center gap-3 border-b border-gray-100 bg-white px-5 py-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-light text-xs font-medium text-brand">{initials(cur)}</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[#232D42]">{cur.name || fmtNum(cur.contact)}</div>
              <div className="text-xs text-[#8A92A6]">
                {fmtNum(cur.contact)}
                {cur.assignedTo ? <> · handled by <span className="text-[#232D42]">{nameOf(cur.assignedTo)}</span></> : " · nobody yet"}
              </div>
            </div>
            <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${cur.open ? "bg-brand-light text-brand" : "bg-gray-100 text-[#8A92A6]"}`}>
              <IconClock size={12} />{cur.open ? `Free reply · ${hoursLeft(cur.lastInAt)}h left` : "Templates only"}
            </span>
            {me && cur.assignedTo !== me && (
              <button type="button" onClick={() => save({ assigned_to: me })}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-100 px-2.5 py-1.5 text-[11px] font-medium text-[#232D42] hover:bg-[#F6F7FB]">
                <IconUser size={12} />Take this chat
              </button>
            )}
          </header>

          <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
            {!msgs ? <LoadingBlock label="Loading chat…" /> : msgs.map((m) => (
              <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[78%] rounded-xl px-3 py-2 text-sm ${m.direction === "out" ? "bg-brand text-white" : "border border-gray-100 bg-white text-[#232D42]"}`}>
                  {m.kind !== "text" && <div className={`mb-0.5 text-[11px] uppercase tracking-wide ${m.direction === "out" ? "text-white/70" : "text-[#8A92A6]"}`}>{m.kind}</div>}
                  <div className="whitespace-pre-wrap break-words">{m.body || (m.kind === "text" ? "" : `(${m.kind} — open WhatsApp to view)`)}</div>
                  <div className={`mt-1 flex items-center justify-end gap-1 text-[10.5px] ${m.direction === "out" ? "text-white/70" : "text-[#8A92A6]"}`}>
                    {m.direction === "out" && m.sent_by ? <span>{m.sent_by} ·</span> : null}
                    {when(m.created_at)} <Tick m={m} />
                  </div>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <footer className="border-t border-gray-100 bg-white px-4 py-3">
            {sendErr && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{sendErr}</div>}
            {cur.open && (quick.length > 0 || draft.trim()) && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {quick.map((r) => (
                  <span key={r.id} className="group inline-flex max-w-[260px] items-center gap-1 rounded-full bg-[#F6F7FB] py-1 pl-2.5 pr-1 text-[11px] text-[#232D42]">
                    <button type="button" onClick={() => setDraft(r.text)} title={r.text} className="truncate">
                      {r.text.split("\n")[0]}
                    </button>
                    <button type="button" onClick={() => removeQuick(r.id)} aria-label="Remove this quick reply"
                      className="shrink-0 text-[#8A92A6] opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-600">
                      <IconX size={11} />
                    </button>
                  </span>
                ))}
                {draft.trim() && !quick.some((r) => r.text === draft.trim()) && (
                  <button type="button" onClick={saveQuick}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-200 px-2.5 py-1 text-[11px] font-medium text-[#8A92A6] hover:border-brand hover:text-brand">
                    <IconPlus size={11} />Save this reply
                  </button>
                )}
              </div>
            )}
            {cur.open ? (
              <div className="flex items-end gap-2">
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={4096}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Write a reply… (Enter to send, Shift+Enter for a new line)"
                  className="min-h-[44px] flex-1 resize-none rounded-xl border border-gray-100 bg-[#F6F7FB] px-3 py-2 text-sm text-[#232D42] outline-none focus:border-brand" />
                <button type="button" onClick={send} disabled={!draft.trim() || sending}
                  className="inline-flex h-[44px] items-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-medium text-white disabled:opacity-50">
                  <IconSend size={16} />{sending ? "Sending…" : "Send"}
                </button>
              </div>
            ) : (
              <div className="rounded-xl bg-[#F6F7FB] px-3 py-2.5 text-xs text-[#8A92A6]">
                It&apos;s been more than 24 hours since their last message, so WhatsApp only allows an approved template now. Free replies open again as soon as they write back.
              </div>
            )}
          </footer>
        </>)}
      </section>
      <ContactPanel cur={cur} meta={meta} lead={lead} leadLoading={leadLoading} team={team} save={save} saving={saving} />
    </div>
  );
}

export default function Page() {
  return (
    <PreviewDashboardShell active="wa-inbox" title="WhatsApp Inbox"
      subtitle="Read and reply to WhatsApp messages sent to +91 74116 54951."
      hideAccountPicker hideRange>
      {() => <Inbox />}
    </PreviewDashboardShell>
  );
}
