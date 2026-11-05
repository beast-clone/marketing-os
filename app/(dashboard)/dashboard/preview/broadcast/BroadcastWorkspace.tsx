"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  IconSearch, IconFilter, IconChevronLeft, IconChevronRight, IconPlus, IconTrash,
  IconCircleCheck, IconCircleDashed, IconClock, IconAlertTriangle, IconChecks, IconChartBar,
  IconMessage, IconBrandWhatsapp, IconPhoto, IconRepeat, IconUsersGroup, IconClipboardCheck,
} from "@tabler/icons-react";
import { LoadingBlock } from "@/components/LoadingBlock";
import { confirmDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";
import { ComposeModal, renderWa, type ComposeSeed } from "./ComposeModal";
import { GroupMembers } from "./GroupMembers";
import type { Recipient } from "./RecipientPicker";
import { Overlay } from "@/app/(dashboard)/dashboard/preview/Overlay";
import { WhatsAppAccount } from "./WhatsAppAccount";
import { waFailureText, chatDisplay, REPEAT_LABEL, repeatOf, type WaMessage, type WaStatus } from "@/lib/whatsapp";
import { prettyPhone, type WaAccount } from "@/lib/whatsapp-session";

// Community Broadcast — the whole WhatsApp workspace, laid out like the tool it
// replaces: every scheduled message down the left, a month of sends in the middle,
// and composing in a popup. History is kept for good, so it can feed a report later.

const IST = "en-IN";
type View = "month" | "week" | "day";

// am/pm, because that is how the composer, the confirmation line and the detail
// view all say it — 24-hour here was the odd one out.
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(IST, { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
const dayKey = (d: Date | string) => (typeof d === "string" ? new Date(d) : d).toLocaleDateString("en-CA");

// "in 3 minutes" / "6 days ago" — the rail reads as a timeline, not a list of stamps.
function relative(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const mins = Math.round(Math.abs(diff) / 60000);
  const say = mins < 1 ? "less than a minute" : mins < 60 ? `${mins} minute${mins === 1 ? "" : "s"}`
    : mins < 1440 ? `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? "" : "s"}`
    : `${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? "" : "s"}`;
  return diff >= 0 ? `in ${say}` : `${say} ago`;
}

const STATUS_STYLE: Record<WaStatus, { pill: string; dot: string; label: string; icon: React.ReactNode }> = {
  scheduled: { pill: "bg-amber-50 text-amber-700", dot: "bg-amber-400", label: "Scheduled", icon: <IconClock size={12} /> },
  sending: { pill: "bg-blue-50 text-blue-700", dot: "bg-blue-400", label: "Sending", icon: <IconCircleDashed size={12} className="animate-spin" /> },
  sent: { pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: "Sent", icon: <IconCircleCheck size={12} /> },
  delivered: { pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: "Delivered", icon: <IconChecks size={12} /> },
  failed: { pill: "bg-rose-50 text-rose-700", dot: "bg-rose-500", label: "Failed", icon: <IconAlertTriangle size={12} /> },
  canceled: { pill: "bg-gray-100 text-gray-500", dot: "bg-gray-300", label: "Cancelled", icon: <IconTrash size={12} /> },
};

export function BroadcastWorkspace() {
  const [rows, setRows] = useState<WaMessage[] | null>(null);
  const [q, setQ] = useState("");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [compose, setCompose] = useState<{ open: boolean; date?: string; seed?: ComposeSeed } | null>(null);
  // Groups this number is in — for the members panel. Read once, cheaply, from
  // the same list the picker uses.
  const [groups, setGroups] = useState<Recipient[] | null>(null);
  const [showGroups, setShowGroups] = useState(false);
  useEffect(() => {
    fetch("/api/scheduler/whatsapp/recipients", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setGroups(((d.recipients || []) as Recipient[]).filter((r) => r.kind === "group")))
      .catch(() => setGroups([]));
  }, []);
  const [selected, setSelected] = useState<string | null>(null);
  // With two numbers linked, a row that just says "Pandey Ji" does not tell you
  // which of your numbers it leaves from (Praveen, 23 Sep). Only shown when there
  // is more than one — with a single number it is noise.
  const [accounts, setAccounts] = useState<WaAccount[]>([]);
  useEffect(() => {
    fetch("/api/scheduler/whatsapp/session", { cache: "no-store" })
      .then((r) => r.json()).then((d) => setAccounts((d.accounts || []) as WaAccount[])).catch(() => {});
  }, []);
  const fromLabel = (m: WaMessage): string | null => {
    if (accounts.length < 2) return null;
    const a = accounts.find((x) => x.name === (m.payload?.session || "default")) || null;
    return a ? (a.label || prettyPhone(a.phone) || a.name) : null;
  };

  const load = () => fetch("/api/scheduler/whatsapp", { cache: "no-store" })
    .then((r) => r.json()).then((d) => setRows(d.messages || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  // Poll while anything is still on its way.
  useEffect(() => {
    if (!rows?.some((r) => r.status === "scheduled" || r.status === "sending")) return;
    const t = setTimeout(load, 8000);
    return () => clearTimeout(t);
  }, [rows]);

  const all = rows || [];
  const failedCount = all.filter((r) => r.status === "failed").length;

  const listed = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((r) => !onlyFailed || r.status === "failed")
      .filter((r) => !needle || (r.body || "").toLowerCase().includes(needle) || (r.chat_label || r.chat_id).toLowerCase().includes(needle));
  }, [all, q, onlyFailed]);

  const upcoming = listed.filter((r) => r.status === "scheduled" || r.status === "sending")
    .sort((a, b) => a.schedule_time.localeCompare(b.schedule_time));
  const earlier = listed.filter((r) => !(r.status === "scheduled" || r.status === "sending"))
    .sort((a, b) => b.schedule_time.localeCompare(a.schedule_time));

  const cancel = async (m: WaMessage) => {
    const ok = await confirmDialog({
      title: "Cancel this message?",
      body: <>It won&apos;t be sent to {m.chat_label || chatDisplay(m.chat_id)}.</>,
      action: "Cancel message", danger: true,
    });
    if (!ok) return;
    await fetch("/api/scheduler/whatsapp/cancel", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ id: m.id }),
    });
    load();
  };

  // Deleting removes the record. Cancelling only stops a send, and a cancelled row
  // stays visible on purpose — you usually want to see that it was pulled.
  const remove = async (ids: string[]) => {
    if (!ids.length) return;
    const qs = ids.map((id) => `id=${encodeURIComponent(id)}`).join("&");
    await fetch(`/api/scheduler/whatsapp?${qs}`, { method: "DELETE", credentials: "same-origin" }).catch(() => {});
    load();
  };

  const removeOne = async (m: WaMessage) => {
    const ok = await confirmDialog({
      title: "Delete this message?",
      body: m.status === "scheduled"
        ? <>It won&apos;t be sent, and it&apos;s removed from the list for good.</>
        : <>It&apos;s removed from the list for good. Anything already sent stays sent.</>,
      action: "Delete", danger: true,
    });
    if (!ok) return;
    await remove([m.id]);
  };

  const clearFailed = async () => {
    if (!failedCount) return;
    if (!await confirmDialog({ title: `Clear ${failedCount} failed message${failedCount === 1 ? "" : "s"}?`, body: "They're deleted from the list. Nothing is sent.", action: "Clear", danger: true })) return;
    // These used to go to /cancel, which only ever matches a row still waiting —
    // so clearing failed messages quietly did nothing at all.
    await remove(all.filter((r) => r.status === "failed").map((r) => r.id));
  };

  // "Send again": the same message, waiting for a new time. Everything is carried
  // over except the schedule — that is the one thing you are here to change.
  const sendAgain = (m: WaMessage) => {
    const repeat = repeatOf(m.payload);
    setCompose({
      open: true,
      seed: {
        kind: m.kind,
        chats: m.kind === "status" ? [] : [{ id: m.chat_id, label: m.chat_label || chatDisplay(m.chat_id), kind: "contact" }],
        body: m.body || "",
        imageUrl: m.image_url || "",
        poll: m.payload?.poll || null,
        session: (m.payload as { session?: string } | null)?.session,
      },
    });
    setSelected(null);
    void repeat;
  };

  const selectedRow = selected ? all.find((r) => r.id === selected) || null : null;

  return (
    <div className="preview-scope">
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* Left rail — every scheduled message, kept for good */}
        <aside className="bg-white border border-gray-100 rounded-2xl flex flex-col max-h-[calc(100vh-190px)]">
          <div className="px-3 py-3 border-b border-gray-100">
            <WhatsAppAccount />
            <button onClick={() => setShowGroups(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 text-[12.5px] font-medium text-[#4A5468] px-3 py-1.5 mb-2 hover:border-brand hover:text-brand">
              <IconUsersGroup size={14} /> Groups &amp; members
            </button>
            {/* For the official API, where a template must be approved before it can
                be sent. Nothing to do with this tab's own sending, which goes through
                WAHA and needs no template — but this is where people come looking when
                a template keeps coming back. */}
            <Link href="/dashboard/preview/broadcast/template-check"
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 text-[12.5px] font-medium text-[#4A5468] px-3 py-1.5 mb-2 hover:border-brand hover:text-brand">
              <IconClipboardCheck size={14} /> Template check
            </Link>
            <button onClick={() => setCompose({ open: true })}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand text-white text-[13px] font-medium px-3 py-2 mb-2 hover:bg-brand-dark">
              <IconPlus size={15} /> New message
            </button>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5">
              <IconSearch size={15} className="text-[#8A92A6]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search scheduled messages"
                className="flex-1 min-w-0 outline-none text-[13px] text-[#232D42] bg-transparent" />
              <button onClick={() => setOnlyFailed((v) => !v)} title="Show failed only"
                className={`flex-shrink-0 ${onlyFailed ? "text-brand" : "text-[#8A92A6] hover:text-[#232D42]"}`}><IconFilter size={15} /></button>
            </div>
            {failedCount > 0 && (
              <button onClick={clearFailed} className="mt-2 text-[12px] text-[#C03221] hover:underline">Clear failed ({failedCount})</button>
            )}
          </div>

          <div className="overflow-y-auto flex-1">
            {rows === null ? <div className="p-6"><LoadingBlock label="Loading…" /></div>
              : listed.length === 0 ? <div className="px-4 py-10 text-center text-[13px] text-[#8A92A6]">{all.length ? "Nothing matches that search." : "Nothing scheduled yet."}</div>
              : (
                <>
                  {upcoming.length > 0 && <RailGroup fromLabel={fromLabel} title="Upcoming" rows={upcoming} selected={selected} onSelect={setSelected} onDelete={removeOne} />}
                  {earlier.length > 0 && <RailGroup fromLabel={fromLabel} title="Earlier" rows={earlier} selected={selected} onSelect={setSelected} onDelete={removeOne} />}
                </>
              )}
          </div>
        </aside>

        {/* Main — the calendar */}
        <section className="bg-white border border-gray-100 rounded-2xl">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 flex-wrap">
            <button onClick={() => setCursor(new Date())} className="text-[12.5px] font-medium rounded-lg border border-gray-200 px-3 py-1.5 text-[#4A5468] hover:border-brand hover:text-brand">Today</button>
            <button onClick={() => setCursor(step(cursor, view, -1))} className="w-7 h-7 rounded-lg border border-gray-200 grid place-items-center text-[#4A5468] hover:border-brand hover:text-brand"><IconChevronLeft size={15} /></button>
            <button onClick={() => setCursor(step(cursor, view, 1))} className="w-7 h-7 rounded-lg border border-gray-200 grid place-items-center text-[#4A5468] hover:border-brand hover:text-brand"><IconChevronRight size={15} /></button>
            <div className="ml-1">
              <div className="text-[15px] font-medium text-[#232D42] leading-tight">{headline(cursor, view)}</div>
              <div className="text-[11.5px] text-[#8A92A6]">{countIn(all, cursor, view)} sends this {view}</div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="inline-flex bg-[#F6F7FB] border border-gray-100 rounded-lg p-0.5 gap-0.5">
                {(["month", "week", "day"] as View[]).map((v) => (
                  <button key={v} onClick={() => setView(v)}
                    className={`text-[12.5px] font-medium px-3 py-1.5 rounded-md capitalize transition ${view === v ? "bg-white text-brand border border-gray-100" : "text-[#8A92A6] hover:text-[#232D42]"}`}>{v}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4">
            {rows === null ? <div className="h-64 grid place-items-center"><LoadingBlock label="Loading…" /></div>
              : <Grid rows={all} view={view} cursor={cursor} selected={selected}
                  onSelect={setSelected} onAdd={(d) => setCompose({ open: true, date: d })}
                  onOpenDay={(d) => { setCursor(new Date(d)); setView("day"); }} />}
          </div>
        </section>
      </div>

      {showGroups && (
        <GroupMembers
          session={(accounts.find((a) => a.status === "WORKING")?.name) || "default"}
          sessionPhone={accounts.find((a) => a.status === "WORKING")?.phone || null}
          groups={groups}
          onClose={() => setShowGroups(false)}
          // "Message this group" hands off to the composer — sending lives in one
          // place, and picks up every check that lives there.
          onMessageGroup={(g) => { setShowGroups(false); setCompose({ open: true, seed: { kind: "message", chats: [g], body: "", imageUrl: "" } }); }}
        />
      )}

      {compose?.open && (
        <ComposeModal initialDate={compose.date} seed={compose.seed} onClose={() => setCompose(null)} onSaved={load} />
      )}

      {/* Clicking anything in the rail or the calendar opens it in full — the preview
          is short and a tooltip cannot show an image, a poll or a failure reason. */}
      {selectedRow && (
        <MessageDetail m={selectedRow} fromLabel={fromLabel} onClose={() => setSelected(null)}
          onCancel={() => { cancel(selectedRow); setSelected(null); }}
          onSendAgain={() => sendAgain(selectedRow)}
          onDelete={() => { removeOne(selectedRow); setSelected(null); }} />
      )}
    </div>
  );
}

function RailGroup({ title, rows, selected, onSelect, onDelete, fromLabel }: {
  title: string; rows: WaMessage[]; selected: string | null;
  onSelect: (id: string) => void; onDelete: (m: WaMessage) => void;
  fromLabel: (m: WaMessage) => string | null;
}) {
  return (
    <div>
      <div className="px-4 py-1.5 text-[10.5px] uppercase tracking-wide text-[#8A92A6] bg-[#F6F7FB]">{title}</div>
      {rows.map((m) => {
        const st = STATUS_STYLE[m.status];
        return (
          <button key={m.id} onClick={() => onSelect(m.id)}
            className={`w-full text-left px-3 py-2.5 border-b border-gray-50 flex gap-2.5 ${selected === m.id ? "bg-brand-light/40" : "hover:bg-[#F6F7FB]"}`}>
            <span className="w-8 h-8 rounded-full bg-brand-light text-brand grid place-items-center flex-shrink-0">
              {m.kind === "poll" ? <IconChartBar size={15} /> : m.kind === "status" ? <IconBrandWhatsapp size={15} /> : m.image_url ? <IconPhoto size={15} /> : <IconMessage size={15} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium text-[#232D42] truncate">{m.chat_label || chatDisplay(m.chat_id)}</span>
              <span className="block text-[11.5px] text-[#8A92A6] truncate">{m.body || (m.kind === "poll" ? m.payload?.poll?.name || "Poll" : "Image")}</span>
              <span className="flex items-center gap-1.5 mt-1">
                <span className="text-[11px] text-[#8A92A6]">{relative(m.schedule_time)} · {timeOf(m.schedule_time)}
                {repeatOf(m.payload) && <IconRepeat size={11} className="inline ml-1 -mt-0.5 text-[#8A92A6]" />}</span>
                {fromLabel(m) && <span className="text-[10px] text-[#8A92A6] truncate" title={`Goes out from ${fromLabel(m)}`}>· from {fromLabel(m)}</span>}
                <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${st.pill}`}>{st.label}</span>
              </span>
            </span>
            <span onClick={(e) => { e.stopPropagation(); onDelete(m); }} title="Delete"
              className="text-gray-300 hover:text-[#C03221] flex-shrink-0"><IconTrash size={14} /></span>
          </button>
        );
      })}
    </div>
  );
}

// ── calendar helpers ──────────────────────────────────────────────────────────
const startOfWeek = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; };
function step(d: Date, view: View, dir: 1 | -1) {
  const x = new Date(d);
  if (view === "month") x.setMonth(x.getMonth() + dir);
  else x.setDate(x.getDate() + dir * (view === "week" ? 7 : 1));
  return x;
}
function headline(d: Date, view: View) {
  if (view === "month") return d.toLocaleDateString(IST, { month: "long", year: "numeric" });
  if (view === "day") return d.toLocaleDateString(IST, { weekday: "long", day: "numeric", month: "long" });
  const s = startOfWeek(d), e = new Date(s); e.setDate(s.getDate() + 6);
  return `${s.toLocaleDateString(IST, { day: "numeric", month: "short" })} – ${e.toLocaleDateString(IST, { day: "numeric", month: "short" })}`;
}
function rangeOf(d: Date, view: View): [Date, Date] {
  if (view === "month") return [new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)];
  if (view === "day") { const a = new Date(d); a.setHours(0, 0, 0, 0); const b = new Date(d); b.setHours(23, 59, 59); return [a, b]; }
  const a = startOfWeek(d); const b = new Date(a); b.setDate(a.getDate() + 6); b.setHours(23, 59, 59); return [a, b];
}
const countIn = (rows: WaMessage[], d: Date, view: View) => {
  const [a, b] = rangeOf(d, view);
  return rows.filter((r) => { const t = new Date(r.schedule_time).getTime(); return t >= a.getTime() && t <= b.getTime(); }).length;
};

function Grid({ rows, view, cursor, selected, onSelect, onAdd, onOpenDay }: {
  rows: WaMessage[]; view: View; cursor: Date; selected: string | null;
  onSelect: (id: string) => void; onAdd: (date: string) => void;
  /** "+3 more" — a month cell only has room for three, so hand the day over to Day view. */
  onOpenDay: (date: Date) => void;
}) {
  const byDay = useMemo(() => {
    const m = new Map<string, WaMessage[]>();
    for (const r of rows) {
      const k = dayKey(r.schedule_time);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    for (const list of m.values()) list.sort((a, b) => a.schedule_time.localeCompare(b.schedule_time));
    return m;
  }, [rows]);

  const days: Date[] = useMemo(() => {
    if (view === "day") return [new Date(cursor)];
    if (view === "week") { const s = startOfWeek(cursor); return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d; }); }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;
    const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const out: Date[] = [];
    for (let i = 0; i < lead; i++) out.push(new Date(NaN));
    for (let i = 1; i <= total; i++) out.push(new Date(cursor.getFullYear(), cursor.getMonth(), i));
    return out;
  }, [cursor, view]);

  const today = dayKey(new Date());
  const cols = view === "day" ? 1 : 7;

  return (
    <div>
      {view !== "day" && (
        <div className="grid gap-1 text-[11px] text-[#8A92A6] mb-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="px-1">{d}</div>)}
        </div>
      )}
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
        {days.map((d, i) => {
          if (isNaN(d.getTime())) return <div key={`pad${i}`} className="min-h-[104px] rounded-lg bg-[#F6F7FB]/40" />;
          const k = dayKey(d);
          const items = byDay.get(k) || [];
          const isToday = k === today;
          // A day that has already been and gone can be read, never written to:
          // its "New" shortcut would open the composer on a date the scheduler
          // rejects anyway. Today still counts as schedulable — the rest of
          // today is still ahead.
          const past = k < today;
          return (
            <div key={k} className={`group relative rounded-lg border p-1.5 ${view === "day" ? "min-h-[360px]" : view === "week" ? "min-h-[220px]" : "min-h-[104px]"} ${isToday ? "border-brand bg-brand-light/20" : past ? "border-gray-100 bg-[#F6F7FB]/60" : "border-gray-100"}`}>
              <div className="flex items-center gap-1 mb-1">
                <span className={`text-[11px] ${isToday ? "text-white bg-brand rounded-full w-5 h-5 grid place-items-center" : past ? "text-[#C9CDD8]" : "text-[#8A92A6]"}`}>{d.getDate()}</span>
                {past ? (
                  <span className="ml-auto opacity-0 group-hover:opacity-100 transition text-[10.5px] text-[#C9CDD8]">Gone</span>
                ) : (
                  <button onClick={() => onAdd(k)} title="Schedule a message on this day"
                    className="ml-auto opacity-0 group-hover:opacity-100 transition text-[10.5px] text-brand hover:underline inline-flex items-center gap-0.5"><IconPlus size={11} /> New</button>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {items.slice(0, view === "month" ? 3 : 12).map((m) => {
                  const st = STATUS_STYLE[m.status];
                  return (
                    <button key={m.id} onClick={() => onSelect(m.id)}
                      title={`${m.chat_label || chatDisplay(m.chat_id)} — ${m.body || m.payload?.poll?.name || "image"}`}
                      className={`flex items-center gap-1 text-[10.5px] rounded px-1 py-0.5 w-full text-left ${selected === m.id ? "ring-1 ring-brand" : ""} ${st.pill}`}>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
                      <span className="tabular-nums flex-shrink-0">{timeOf(m.schedule_time)}</span>
                      <span className="truncate">{m.chat_label || chatDisplay(m.chat_id)}</span>
                    </button>
                  );
                })}
                {view === "month" && items.length > 3 && (
                  <button onClick={() => onOpenDay(d)}
                    className="text-[10.5px] text-[#8A92A6] hover:text-brand hover:underline px-1 text-left">
                    +{items.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// One scheduled message, in full. Reached by clicking it in the rail or on the
// calendar — the list only has room for a truncated line, and a tooltip cannot
// show an image, poll options, or why a send failed.
function MessageDetail({ m, onClose, onCancel, onSendAgain, onDelete, fromLabel }: {
  m: WaMessage; onClose: () => void; onCancel: () => void; onSendAgain: () => void; onDelete: () => void;
  fromLabel?: (m: WaMessage) => string | null;
}) {
  const st = STATUS_STYLE[m.status];
  const when = new Date(m.schedule_time);
  const poll = m.kind === "poll" ? m.payload?.poll : null;
  const repeat = repeatOf(m.payload);
  const stamp = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(IST, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : "—";

  return (
    <Overlay onClose={onClose}>
      {/* .preview-scope sets a max-width of its own, which beats the utility class, so the
          width goes inline. The class still has to be here: Overlay portals to <body>,
          outside the page's scope, and without it the brand tokens are gone. */}
      <div onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520 }}
        className="preview-scope w-full my-6 bg-white rounded-2xl border border-gray-100 p-5 max-h-[86vh] overflow-y-auto">
      <div className="flex items-start gap-2 mb-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium text-[#232D42] truncate">
            {m.chat_label || chatDisplay(m.chat_id)}
          </div>
          <div className="text-[12px] text-[#8A92A6] truncate">{chatDisplay(m.chat_id)}</div>
          {fromLabel?.(m) && (
            <div className="text-[12px] text-[#8A92A6] truncate mt-0.5">Goes out from <span className="text-[#4A5468]">{fromLabel(m)}</span></div>
          )}
        </div>
        <span className={`inline-flex items-center gap-1 text-[11.5px] font-medium rounded-full px-2 py-0.5 flex-shrink-0 ${st.pill}`}>
          {st.icon} {st.label}
        </span>
      </div>

      {/* The message as WhatsApp will render it */}
      <div className="rounded-xl border p-3 mb-3" style={{ background: "var(--wa-bg)", borderColor: "var(--wa-border)" }}>
        <div className="ml-auto max-w-[320px] rounded-xl rounded-tr-sm px-2 pt-2 pb-1.5" style={{ background: "var(--wa-bubble)" }}>
          {m.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.image_url} alt="" className="w-full rounded-lg mb-1.5 block"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} loading="lazy" decoding="async" />
          )}
          {poll ? (
            <div className="text-[13px]" style={{ color: "var(--wa-ink)" }}>
              <div className="font-medium mb-1.5">{poll.name}</div>
              <div className="flex flex-col gap-1.5">
                {poll.options.map((o, i) => (
                  <div key={i} className="rounded-lg border px-2 py-1 text-[12.5px]"
                    style={{ borderColor: "var(--wa-optline)", color: "var(--wa-ink)" }}>{o}</div>
                ))}
              </div>
              <div className="text-[10.5px] mt-1.5" style={{ color: "var(--wa-meta)" }}>
                {poll.multipleAnswers ? "Select one or more" : "Select one"}
              </div>
            </div>
          ) : (
            <div className="text-[13px] whitespace-pre-wrap break-words leading-snug" style={{ color: "var(--wa-ink)" }}>
              {m.body ? renderWa(m.body) : <span className="italic" style={{ color: "var(--wa-meta)" }}>No text</span>}
            </div>
          )}
          <div className="flex items-center justify-end gap-1 text-[10.5px] mt-0.5" style={{ color: "var(--wa-meta)" }}>
            {when.toLocaleTimeString(IST, { hour: "numeric", minute: "2-digit", hour12: true })}
            <IconChecks size={13} style={{ color: "var(--wa-tick)" }} />
          </div>
        </div>
      </div>

      {/* Why it failed comes first — it is the reason anyone opens a failed row */}
      {m.error && (() => {
        const why = waFailureText(m.error);
        return (
          <div className="rounded-lg bg-[#FDECEA] text-[#C0392B] text-[12.5px] px-3 py-2 mb-3">
            <div className="flex items-start gap-1.5">
              <IconAlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span className="min-w-0 break-words">{why.text}</span>
            </div>
            {why.detail && (
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[11.5px] text-[#C0392B]/70 hover:text-[#C0392B] select-none">
                  What WhatsApp actually said
                </summary>
                <div className="mt-1 text-[11px] break-words font-mono opacity-80">{why.detail}</div>
              </details>
            )}
          </div>
        );
      })()}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px] mb-4">
        <dt className="text-[#8A92A6]">Type</dt>
        <dd className="text-[#232D42] capitalize">{m.kind}{m.image_url ? " with an image" : ""}</dd>
        {repeat && (<><dt className="text-[#8A92A6]">Repeats</dt>
          <dd className="text-[#232D42]">
            {REPEAT_LABEL[repeat.rule]}
            {repeat.until ? ` until ${stamp(repeat.until)}` : " — until you cancel it"}
          </dd></>)}
        <dt className="text-[#8A92A6]">Scheduled for</dt>
        <dd className="text-[#232D42]">{stamp(m.schedule_time)} · {relative(m.schedule_time)}</dd>
        {m.sent_at && (<><dt className="text-[#8A92A6]">Sent</dt><dd className="text-[#232D42]">{stamp(m.sent_at)}</dd></>)}
        <dt className="text-[#8A92A6]">Created</dt>
        <dd className="text-[#232D42]">{stamp(m.created_at)}{m.created_by ? ` · ${m.created_by}` : ""}</dd>
        {m.wa_message_id && (<><dt className="text-[#8A92A6]">WhatsApp id</dt>
          <dd className="text-[#8A92A6] font-mono text-[11px] break-all">{m.wa_message_id}</dd></>)}
      </dl>

      <div className="flex items-center gap-2">
        {m.status === "scheduled" && (
          <button onClick={onCancel}
            className="inline-flex items-center gap-1 text-[13px] text-[#4A5468] rounded-xl border border-gray-200 px-3 py-2 hover:border-brand hover:text-brand">
            <IconCircleDashed size={14} /> {repeat ? "Stop this repeating" : "Cancel, keep the record"}
          </button>
        )}
        <button onClick={onSendAgain}
          className="inline-flex items-center gap-1 text-[13px] text-[#4A5468] rounded-xl border border-gray-200 px-3 py-2 hover:border-brand hover:text-brand">
          <IconRepeat size={14} /> Send again
        </button>
        <button onClick={onDelete}
          className="inline-flex items-center gap-1 text-[13px] text-[#C03221] rounded-xl border border-gray-200 px-3 py-2 hover:border-[#C03221]">
          <IconTrash size={14} /> Delete
        </button>
          <button onClick={onClose} className="ml-auto text-[13px] text-[#4A5468] px-3 py-2 rounded-xl hover:bg-[#F6F7FB]">Close</button>
        </div>
      </div>
    </Overlay>
  );
}
