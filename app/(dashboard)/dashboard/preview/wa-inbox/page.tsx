"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { LoadingBlock } from "@/components/LoadingBlock";
import {
  IconBrandWhatsapp, IconSearch, IconSend, IconCheck, IconChecks, IconAlertTriangle, IconClock, IconMessageCircle,
  IconInfoCircle, IconTemplate, IconUserCheck, IconShieldCheck, IconCoinRupee, IconGauge,
} from "@tabler/icons-react";

// WhatsApp Inbox — the official number +91 74116 54951 (the one the eBook and lead
// workflows send from). Replies used to go nowhere; n8n "WA Inbox — receive" now
// saves them in Supabase `wa_messages`, and replies go out through n8n
// "WA Inbox — send reply". Free-text replies are only allowed by WhatsApp within
// 24 hours of the person's last message, so the reply box closes after that.

type Conv = { contact: string; name: string | null; last: string; lastAt: string; lastDir: string; unread: number; lastInAt: string | null; open: boolean };
type Msg = { id: string; direction: "in" | "out"; kind: string; body: string | null; status: string | null; error: string | null; sent_by: string | null; created_at: string };

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

function RulesPanel({ cur }: { cur: Conv | null }) {
  const left = cur ? hoursLeft(cur.lastInAt) : 0;
  return (
    <aside className="hidden w-[290px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-gray-100 bg-white p-4 xl:flex">
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
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-[#232D42]"><IconInfoCircle size={16} className="text-brand" />WhatsApp rules</div>
        <ul className="space-y-2.5">
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
      </div>
    </aside>
  );
}

function Inbox() {
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    try {
      const r = await fetch("/api/wa-inbox", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't load");
      setConvs(j.conversations); setErr("");
    } catch (e) { setErr((e as Error).message); }
  }, []);
  const loadThread = useCallback(async (c: string) => {
    const r = await fetch(`/api/wa-inbox?contact=${c}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setMsgs(j.messages);
  }, []);

  useEffect(() => { loadList(); const t = setInterval(loadList, 15000); return () => clearInterval(t); }, [loadList]);
  useEffect(() => {
    if (!sel) return;
    setMsgs(null); setSendErr(""); loadThread(sel).then(loadList);
    const t = setInterval(() => loadThread(sel), 8000);
    return () => clearInterval(t);
  }, [sel, loadThread, loadList]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs?.length]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (convs || []).filter((c) => !s || (c.name || "").toLowerCase().includes(s) || c.contact.includes(s.replace(/\D/g, "") || "~") || c.last.toLowerCase().includes(s));
  }, [convs, q]);
  const cur = convs?.find((c) => c.contact === sel) || null;

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
      <aside className="flex w-[320px] shrink-0 flex-col border-r border-gray-100">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-light text-brand"><IconBrandWhatsapp size={18} /></span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-[#232D42]">+91 74116 54951</div>
            <div className="text-xs text-[#8A92A6]">{convs?.length ?? 0} chats · {convs?.reduce((s, c) => s + c.unread, 0) ?? 0} unread</div>
          </div>
        </div>
        <div className="px-3 py-2">
          <label className="flex items-center gap-2 rounded-lg border border-gray-100 bg-[#F6F7FB] px-2.5 py-1.5 text-sm">
            <IconSearch size={15} className="text-[#8A92A6]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number or message" className="w-full bg-transparent text-[#232D42] outline-none placeholder:text-[#8A92A6]" />
          </label>
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
              <div className="text-xs text-[#8A92A6]">{fmtNum(cur.contact)}</div>
            </div>
            <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${cur.open ? "bg-brand-light text-brand" : "bg-gray-100 text-[#8A92A6]"}`}>
              <IconClock size={12} />{cur.open ? `Free reply · ${hoursLeft(cur.lastInAt)}h left` : "Templates only"}
            </span>
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
      <RulesPanel cur={cur} />
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
