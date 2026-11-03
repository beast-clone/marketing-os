"use client";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/use-api";
import { FilterPopover } from "@/components/FilterBuilder";
import { EMPTY_FILTER, evalFilter, type FilterFieldDef, type FilterModel } from "@/lib/filter-model";
import { fmtDateTime } from "@/lib/date";
import { isClosedStatus } from "@/lib/lead-status";
import MissingFieldsModal, { gateFromResponse, type GateBlock } from "../MissingFieldsModal";
import { PreviewSelect } from "../PreviewSelect";
import { BrandLoader } from "@/components/BrandLoader";
import { LoadingBlock } from "@/components/LoadingBlock";
import {
  IconRefresh, IconArrowsExchange, IconTimeline, IconChevronLeft, IconCircleCheck,
  IconAlertTriangle, IconStarFilled, IconStar, IconHourglassLow, IconBrandTelegram, IconSearch,
} from "@tabler/icons-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from "recharts";

// Stacked-bar colours for the day-wise interest chart (last = grey for "Other").
const PALETTE = ["#3A57E8", "#0EA5E9", "#1AA053", "#F2B01E", "#8B5CF6", "#EC4899", "#8A92A6"];

// The chart can be sliced by any of these dimensions (all carried on each lead).
// `noun` is the already-cased form for the heading — lowercasing the label turned
// the SBU acronym into "sbu".
const BREAKDOWNS = [
  { v: "interest", label: "Primary Interest", noun: "Primary Interest" },
  { v: "sbu", label: "SBU", noun: "SBU" },
  { v: "counsellor", label: "Counsellor", noun: "counsellor" },
  { v: "source", label: "Source", noun: "source" },
] as const;
type BreakBy = (typeof BREAKDOWNS)[number]["v"];

// Sales Hub → Leads.
//
// Six tabs over ONE Airtable read (the API returns every aggregate from a single
// CRM fetch, cached 15 min) because these questions are all asked of the same
// 800-ish rows and paging the CRM once per tab would be four times the cost:
//
//   Per day     — how many arrived, and who got them
//   By interest — which interests generate, and whether anyone owns the result
//   Counsellors — how many leads each person holds and how much is worked
//   Tracker     — starred leads plus anything the two alert rules caught
//   Transfer    — bulk reassign, e.g. when someone is unexpectedly on leave
//   Roles       — what each holder IS; the switch that decides all of the above

type Role = "counsellor" | "pool" | "partner" | "inactive";
type BoardRow = { key: string; label: string; dow: string; total: number; by: Record<string, number>; cold: number };
type BoardLead = {
  id: string; name: string; source: string; interest: string; sbu: string; counsellor: string;
  counsellorUserId: string; status: string; day: string; date: string;
  daysUntouched: number; cold: boolean; link: string;
  role: Role; ageDays: number; callAttempts: number; flaggedNew: boolean; flaggedPool: boolean;
};
// What you can filter a lead by on the tracker — the same builder the Marketing
// Hub master sheet uses ("add filtering, like in airtable" — Maheen, 22 Sep).
// The search box stays for "I know roughly what it's called"; this is for
// everything the search can't express, like "pool AND older than a date".
const TRACKER_FILTER_FIELDS: FilterFieldDef<BoardLead>[] = [
  { key: "name", label: "Name", type: "text", get: (l) => l.name || "" },
  { key: "interest", label: "Primary Interest", type: "select", get: (l) => l.interest || "" },
  { key: "sbu", label: "SBU", type: "select", get: (l) => l.sbu || "" },
  { key: "source", label: "Source", type: "select", get: (l) => l.source || "" },
  { key: "status", label: "Status", type: "select", get: (l) => l.status || "" },
  { key: "counsellor", label: "Counsellor", type: "select", get: (l) => l.counsellor || "" },
  { key: "role", label: "Held by", type: "select", get: (l) => l.role || "" },
  { key: "date", label: "Arrived", type: "date", get: (l) => (l.date || "").slice(0, 10) },
  { key: "cold", label: "Cold", type: "checkbox", get: (l) => !!l.cold },
];

type InterestRow = {
  interest: string; total: number; assigned: number; pool: number; partner: number;
  other: number; newOver2: number; poolStuck: number;
};
type HolderRow = {
  holder: string; userId: string; role: Role; total: number; stillNew: number;
  newOver2: number; idle7: number; neverCalled: number;
  byStatus: { key: string; n: number }[]; byInterest: { key: string; n: number }[];
};
type RosterEntry = { name: string; userId: string; email: string; label: string; inRoster: boolean };
type AssignmentRow = { key: string; label: string; dow: string; total: number; by: Record<string, number> };
type AssignmentBoard = {
  range: { from: string; to: string };
  bucket: "day" | "week" | "month";
  counsellors: string[];
  rows: AssignmentRow[];
  totals: { total: number; by: Record<string, number> };
  byInterest: { counsellor: string; interest: string; n: number }[];
  source: "assignment-log";
};
type Board = {
  range: { from: string; to: string };
  bucket: "day" | "week" | "month";
  generated: number;
  counsellors: string[];
  rows: BoardRow[];
  totals: { total: number; by: Record<string, number>; cold: number };
  roster: RosterEntry[];
  leads: BoardLead[];
  allLeads: BoardLead[];
  interests: InterestRow[];
  holders: HolderRow[];
  alerts: { newOver2: number; poolStuck: number; poolStuck15: number };
  roles: Record<string, Role>;
  // The Telegram source of truth — per-day-per-counsellor counts from the Lead
  // Distribution log (real Assigned Time). Empty if that read failed.
  assignments: AssignmentBoard;
};

const fmtInt = (n: number) => n.toLocaleString("en-IN");
const ROLE_LABEL: Record<Role, string> = {
  counsellor: "Counsellor", pool: "Holding pool", partner: "Partner router", inactive: "Inactive",
};
const ROLE_PILL: Record<Role, string> = {
  counsellor: "bg-emerald-50 text-emerald-700",
  pool: "bg-brand-light text-[#2138B0]",
  partner: "bg-amber-50 text-amber-700",
  inactive: "bg-gray-100 text-gray-500",
};
const TABS = [
  { key: "day", label: "Per day" },
  { key: "interest", label: "By interest" },
  { key: "counsellors", label: "Counsellors" },
  { key: "tracker", label: "Leads tracker" },
  { key: "transfer", label: "Transfer" },
  { key: "roles", label: "Roles" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const dash = <span className="text-gray-300">—</span>;
const n0 = (n: number) => (n ? fmtInt(n) : dash);

// `only` pins the component to a single view and hides the tab bar — each Sales Hub
// sub-page renders one. Without it (nothing does today) the tab bar comes back.
export function LeadAssignment({ range, only }: { range: { from: string; to: string }; only?: TabKey }) {
  const [tabState, setTab] = useState<TabKey>(only ?? "day");
  const tab = only ?? tabState;
  const [bucket, setBucket] = useState<"day" | "week" | "month">("day");
  const [openDay, setOpenDay] = useState<BoardRow | null>(null);
  const [track, setTrack] = useState<BoardLead | null>(null);
  const [reassign, setReassign] = useState<BoardLead | null>(null);
  const [drill, setDrill] = useState<"new" | "notcalled" | "waiting" | null>(null);
  // "Track from" cutoff — ignore leads created before this day on the tracker, so the
  // stale backlog (weeks-old leads nobody will touch) doesn't clutter the flags.
  // Persisted, so it sticks once the team sets it live. "" = off (count everything).
  const [since, setSince] = useState<string>("");
  useEffect(() => { try { const v = localStorage.getItem("leadtracker-since"); if (v) setSince(v); } catch { /* private mode */ } }, []);
  useEffect(() => { try { if (since) localStorage.setItem("leadtracker-since", since); else localStorage.removeItem("leadtracker-since"); } catch { /* private mode */ } }, [since]);
  const todayIso = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()), []);

  const qs = new URLSearchParams({ from: range.from, to: range.to, bucket }).toString();
  const { data, isLoading, error, refresh } = useApi<Board>(`/api/leads-crm/assignments?${qs}`);
  const { data: tracked, refresh: refreshTracked } = useApi<{ ids: string[]; persisted: boolean }>("/api/leads-crm/tracked");

  // Card numbers respect the "track from" cutoff (recomputed from allLeads) when set.
  const trackLeads = useMemo(() => (since && data ? data.allLeads.filter((l) => l.date >= since) : (data?.allLeads ?? [])), [data, since]);
  const genCount = since && data ? trackLeads.length : (data?.generated ?? 0);
  const notCalled = since && data ? trackLeads.filter((l) => l.flaggedNew).length : (data?.alerts.newOver2 ?? 0);
  const waiting = since && data ? trackLeads.filter((l) => l.flaggedPool).length : (data?.alerts.poolStuck ?? 0);

  const dayLeads = useMemo(
    () => (openDay ? (data?.leads || []).filter((l) => l.day === openDay.key) : []),
    [data, openDay],
  );

  // ONE date filter per page — the range in the page header. The chart used to
  // carry its own 7d/30d/90d override, which meant two competing time controls on
  // screen and a chart that could silently disagree with every number around it.
  const chartSrc = data;

  // Day-wise leads stacked by the chosen dimension — top 6 categories + "Other", oldest → newest.
  const [breakBy, setBreakBy] = useState<BreakBy>("interest");
  const chart = useMemo(() => {
    if (!chartSrc) return { rows: [] as Record<string, string | number>[], keys: [] as string[] };
    const fieldOf = (l: BoardLead) =>
      breakBy === "sbu" ? (l.sbu || "Other")
      : breakBy === "counsellor" ? (l.counsellor || "Unassigned")
      : breakBy === "source" ? (l.source || "—")
      : (l.interest || "No Primary Interest");
    const tally = new Map<string, number>();
    for (const l of chartSrc.allLeads) { const k = fieldOf(l); tally.set(k, (tally.get(k) || 0) + 1); }
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map((e) => e[0]);
    const topSet = new Set(top);
    const byBucket = new Map<string, Record<string, number>>();
    let hasOther = false;
    for (const l of chartSrc.allLeads) {
      let k = fieldOf(l);
      if (!topSet.has(k)) { hasOther = true; k = "Other"; }
      const m = byBucket.get(l.day) || {};
      m[k] = (m[k] || 0) + 1;
      byBucket.set(l.day, m);
    }
    const otherUsed = hasOther || top.includes("Other");
    const keys = otherUsed ? [...top.filter((k) => k !== "Other"), "Other"] : top;
    const rows = [...chartSrc.rows].reverse().map((r) => {
      const m = byBucket.get(r.key) || {};
      const row: Record<string, string | number> = { label: r.label };
      for (const k of keys) row[k] = m[k] || 0;
      return row;
    });
    return { rows, keys };
  }, [chartSrc, breakBy]);

  // Pinning threw away the response, so when the write failed the star simply
  // didn't move and nothing was said — the click looked like it did nothing.
  // Now it moves immediately, confirms, and reverts loudly if the write is refused.
  const [pinNote, setPinNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});

  const toggleStar = async (lead: BoardLead, on: boolean) => {
    setOptimistic((o) => ({ ...o, [lead.id]: on }));
    setPinNote(null);
    try {
      const res = await fetch("/api/leads-crm/tracked", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ leadId: lead.id, leadName: lead.name, on }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOptimistic((o) => { const n = { ...o }; delete n[lead.id]; return n; });
        setPinNote({ ok: false, text: (j as { error?: string }).error || `Couldn't save that (HTTP ${res.status}).` });
        return;
      }
      setPinNote({ ok: true, text: on ? `“${lead.name}” added to the Leads tracker.` : `“${lead.name}” removed from the tracker.` });
      refreshTracked();
    } catch (e) {
      setOptimistic((o) => { const n = { ...o }; delete n[lead.id]; return n; });
      setPinNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const starred = new Set(tracked?.ids || []);
  // Apply the in-flight optimistic state on top of what the server last told us.
  for (const [id, on] of Object.entries(optimistic)) { if (on) starred.add(id); else starred.delete(id); }

  return (
    <div className={`relative bg-white rounded-xl border border-gray-100 ${tab === "tracker" ? "px-6 pt-4 pb-6" : "p-6"}`}>
      {/* While a new range is loading, dim + show the app's default BrandLoader so
          the switch never feels stuck AND looks the same as loading everywhere else. */}
      {isLoading && (
        <div className="absolute inset-0 z-20 rounded-xl bg-white/75 flex flex-col items-center justify-center gap-3">
          <BrandLoader size={40} />
          <div className="text-[13px] text-[#8A92A6] font-medium">Loading…</div>
        </div>
      )}
      {/* On the tracker this row would be empty (title/subtitle are hidden), so we
          skip it and move Refresh next to the summary intro below — no wasted gap. */}
      {tab !== "tracker" && (
        <div className={`flex flex-wrap items-baseline justify-between gap-3 ${only ? "mb-3" : "mb-4"}`}>
          <div>
            {!only && <div className="text-base font-medium text-[#232D42]">Leads</div>}
            {tab !== "roles" && (
              <div className="text-sm text-gray-500">
                {data ? `${fmtInt(data.generated)} leads generated in this window` : "Loading…"}
              </div>
            )}
          </div>
          <button onClick={() => refresh()} title="Refresh"
            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-[#4A5468] hover:border-gray-300 inline-flex items-center gap-1">
            <IconRefresh size={13} /> Refresh
          </button>
        </div>
      )}

      {/* Plain-English health check — the tracker is where non-technical users land,
          so spell out what each number means and what to do, not the internal rules. */}
      {tab === "tracker" && data && (
        <div className="mb-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="text-[13px] text-gray-500">Here&apos;s how your leads are doing right now. The two coloured cards are the ones that need someone to act.</div>
            <button onClick={() => refresh()} title="Refresh" className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-[#4A5468] hover:border-gray-300 inline-flex items-center gap-1 flex-shrink-0">
              <IconRefresh size={13} /> Refresh
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button onClick={() => setDrill("new")} className="text-left rounded-xl border border-gray-100 bg-[#F6F7FB] p-4 hover:border-gray-300 transition">
              <div className="text-[1.6rem] font-semibold text-[#232D42] leading-none">{fmtInt(genCount)}</div>
              <div className="text-[13px] font-medium text-[#232D42] mt-2">New leads came in</div>
              <div className="text-[12px] text-gray-500 mt-0.5">During the period you&apos;ve selected above. <span className="text-brand">See where from →</span></div>
            </button>
            <button onClick={() => setDrill("notcalled")} className="text-left rounded-xl border border-amber-200 bg-amber-50 p-4 hover:border-amber-300 transition">
              <div className="text-[1.6rem] font-semibold text-[#9A5B10] leading-none">{fmtInt(notCalled)}</div>
              <div className="text-[13px] font-medium text-[#8A5B12] mt-2">Nobody has called these yet</div>
              <div className="text-[12px] text-[#9A6B2E] mt-0.5">A counsellor has them, still marked &ldquo;New&rdquo; 2+ days on. <span className="text-[#8A5B12] font-medium underline">See the list →</span></div>
            </button>
            <button onClick={() => setDrill("waiting")} className="text-left rounded-xl border border-red-200 bg-red-50 p-4 hover:border-red-300 transition">
              <div className="text-[1.6rem] font-semibold text-[#B0203A] leading-none">{fmtInt(waiting)}</div>
              <div className="text-[13px] font-medium text-[#8E2C21] mt-2">Waiting to be assigned</div>
              <div className="text-[12px] text-[#A24236] mt-0.5">No counsellor has picked these up in over 2 days. <span className="text-[#8E2C21] font-medium underline">See the list →</span></div>
            </button>
          </div>
          <div className="text-[12px] text-gray-400 mt-3">Click any card above for the detail — or use the list below to open, chase, or reassign these leads.</div>

          {/* Reset / start-from-a-day: ignore the old backlog nobody will touch. */}
          <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px]">
            <span className="text-gray-500">Only track leads from</span>
            <input type="date" value={since} max={todayIso} onChange={(e) => setSince(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-[12.5px] text-[#232D42]" />
            <span className="text-gray-400">onwards.</span>
            {since !== todayIso && <button onClick={() => setSince(todayIso)} className="text-brand font-medium hover:underline">Start fresh from today</button>}
            {since && <button onClick={() => setSince("")} className="text-gray-500 hover:underline">Show all</button>}
            {since
              ? <span className="text-[#8A5B12] bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">Hiding leads older than {since}</span>
              : <span className="text-gray-400">Set this when you go live so the old backlog stops showing here.</span>}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Couldn&apos;t load — {(error as Error).message}
        </div>
      )}

      {pinNote && (
        <div className={`mb-4 flex items-start gap-2 text-[13px] rounded-lg px-3 py-2.5 border ${
          pinNote.ok ? "bg-emerald-50 border-emerald-200 text-[#1F7256]" : "bg-red-50 border-red-200 text-[#8E2C21]"}`}>
          {pinNote.ok ? <IconCircleCheck size={16} className="flex-shrink-0 mt-0.5" /> : <IconAlertTriangle size={16} className="flex-shrink-0 mt-0.5" />}
          <span className="leading-relaxed">{pinNote.text}</span>
          <button onClick={() => setPinNote(null)} className="ml-auto text-lg leading-none opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {/* The two rules the team asked for. Full banners on the hub page; on a
          sub-page they collapse to one line so the data starts near the top. */}
      {only && tab !== "roles" && tab !== "tracker" && data && (data.alerts.newOver2 > 0 || data.alerts.poolStuck > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-[12.5px]">
          {data.alerts.newOver2 > 0 && (
            <a href="/dashboard/preview/sales-ops/tracker" className="inline-flex items-center gap-1.5 text-[#C0392B] hover:underline">
              <IconAlertTriangle size={13} />
              <b className="font-semibold">{fmtInt(data.alerts.newOver2)}</b> stuck in “New” &gt; 2 days
            </a>
          )}
          {data.alerts.poolStuck > 0 && (
            <a href="/dashboard/preview/sales-ops/interests" className="inline-flex items-center gap-1.5 text-[#B7791F] hover:underline">
              <IconHourglassLow size={13} />
              <b className="font-semibold">{fmtInt(data.alerts.poolStuck)}</b> unassigned in the pool &gt; 2 days
            </a>
          )}
        </div>
      )}
      {!only && data && data.alerts.newOver2 > 0 && (
        <button onClick={() => { setTab("tracker"); setOpenDay(null); }}
          className="w-full text-left mb-2.5 flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5 hover:border-red-300">
          <IconAlertTriangle size={16} className="text-[#C0392B] flex-shrink-0 mt-0.5" />
          <span className="text-[13px] text-[#8E2C21] leading-relaxed">
            <b className="font-semibold">{fmtInt(data.alerts.newOver2)} assigned leads are still sitting in “New” with no edit for over 2 days.</b>{" "}
            Nobody has worked them since they arrived.
          </span>
        </button>
      )}
      {!only && data && data.alerts.poolStuck > 0 && (
        <button onClick={() => { setTab("interest"); setOpenDay(null); }}
          className="w-full text-left mb-4 flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 hover:border-amber-300">
          <IconHourglassLow size={16} className="text-[#B7791F] flex-shrink-0 mt-0.5" />
          <span className="text-[13px] text-[#8A6D1F] leading-relaxed">
            <b className="font-semibold">{fmtInt(data.alerts.poolStuck)} leads have sat in the pool more than 2 days without being assigned.</b>{" "}
            {fmtInt(data.alerts.poolStuck15)} of them are 15+ days old.
          </span>
        </button>
      )}

      <div className={`flex gap-1 border-b border-gray-100 mb-5 flex-wrap ${only ? "hidden" : ""}`}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setOpenDay(null); }}
            className={`text-[13.5px] font-medium px-3 py-2 border-b-2 -mb-px transition-colors ${
              tab === t.key ? "text-brand border-brand" : "text-gray-500 border-transparent hover:text-[#232D42]"}`}>
            {t.label}
            {t.key === "tracker" && starred.size > 0 && (
              <span className="ml-1.5 text-[11px] bg-brand-light text-[#2138B0] rounded-full px-1.5">{starred.size}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── PER DAY ─────────────────────────────────────────────── */}
      {tab === "day" && data && (openDay ? (
        <>
          <div className="flex items-center gap-2.5 mb-4">
            <button onClick={() => setOpenDay(null)} className="text-[13px] text-brand hover:underline inline-flex items-center gap-0.5">
              <IconChevronLeft size={15} /> Back
            </button>
            <div>
              <div className="font-medium text-[#232D42]">{openDay.label}</div>
              <div className="text-sm text-gray-500">{fmtInt(dayLeads.length)} leads</div>
            </div>
          </div>
          <LeadTable leads={dayLeads} starred={starred} onStar={toggleStar} onTrack={setTrack} onReassign={setReassign} />
        </>
      ) : (
        <>
          {(() => {
            // Counts come from the assignment log (real Assigned Time = the Telegram
            // source) when available; otherwise fall back to the CRM board so the
            // page still works if that read failed.
            const fromLog = data.assignments.counsellors.length > 0;
            const src = fromLog ? data.assignments : data;
            const r = data.rows[0]; // CRM "today" row — carries label/dow/cold + drill-down target
            const asgToday = fromLog ? data.assignments.rows.find((x) => x.key === r?.key) : null;
            const cnts: Record<string, number> = asgToday ? asgToday.by : (r?.by ?? {});
            const totalCnt = asgToday ? asgToday.total : (r?.total ?? 0);
            const tmax = Math.max(1, ...src.counsellors.map((c) => cnts[c] || 0));
            return (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-gray-500">
                    <span><b className="text-[#232D42] font-semibold">{fmtInt(src.totals.total)}</b> {fromLog ? "assigned to counsellors" : "worked by counsellors"}</span>
                    {src.counsellors.map((c) => (
                      <span key={c}>{c.split(" ")[0]} <b className="text-[#232D42] font-medium">{fmtInt(src.totals.by[c] || 0)}</b></span>
                    ))}
                  </div>
                  <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                    {(["day", "week", "month"] as const).map((b) => (
                      <button key={b} onClick={() => setBucket(b)}
                        className={`text-xs px-3 py-1.5 capitalize ${bucket === b ? "bg-brand text-white" : "text-[#4A5468] hover:bg-gray-50"}`}>{b}</button>
                    ))}
                  </div>
                </div>
                {fromLog ? (
                  <div className="text-[11.5px] text-gray-400 mb-4 -mt-0.5 flex items-center gap-1.5">
                    <IconBrandTelegram size={13} className="text-brand" /> Same source as your 11:59 PM Telegram summary — the assignment log, keyed on when each lead was actually handed over.
                  </div>
                ) : <div className="mb-4" />}
                {r && (
                  <button onClick={() => setOpenDay(r)}
                    className="w-full text-left rounded-2xl border border-gray-100 bg-[#FAFBFF] px-7 py-6 hover:border-brand hover:bg-white transition-colors flex flex-col md:flex-row md:items-center gap-x-10 gap-y-5">
                    <div className="md:w-[220px] flex-shrink-0">
                      <div className="text-[13px] font-medium text-[#232D42] flex items-center gap-2 flex-wrap">
                        <span>{r.dow && <span className="text-gray-400 font-normal mr-1.5">{r.dow}</span>}{r.label}</span>
                        <span className="text-[10px] text-brand bg-brand-light rounded-full px-1.5 py-0.5">Today</span>
                        {r.cold > 0 && <span className="text-[10px] text-[#B7791F] bg-amber-50 rounded-full px-1.5 py-0.5">{r.cold} cold</span>}
                      </div>
                      <div className="flex items-baseline gap-2 mt-2.5">
                        <span className="text-[46px] leading-none font-semibold text-[#232D42] tabular-nums">{totalCnt}</span>
                        <span className="text-[13px] text-gray-400">{fromLog ? "assigned" : `lead${totalCnt === 1 ? "" : "s"}`}</span>
                      </div>
                    </div>
                    <div className="flex-1 w-full grid gap-x-10 gap-y-3.5 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
                      {src.counsellors.map((c) => (
                        <div key={c} className="flex items-center gap-3">
                          <span className="text-[12.5px] text-gray-500 w-[72px] flex-shrink-0 truncate">{c.split(" ")[0]}</span>
                          <span className="flex-1 h-[9px] rounded-full bg-gray-100 overflow-hidden">
                            <span className="block h-full rounded-full bg-brand" style={{ width: `${((cnts[c] || 0) / tmax) * 100}%` }} />
                          </span>
                          <span className="text-[13.5px] tabular-nums w-[34px] text-right flex-shrink-0 font-medium text-[#232D42]">{cnts[c] || dash}</span>
                        </div>
                      ))}
                    </div>
                  </button>
                )}
                {fromLog && (
                  <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-6">
                    <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
                      <div className="text-[15px] font-medium text-[#232D42]">Manager roll-up</div>
                      <div className="text-xs text-gray-400 flex items-center gap-1.5">
                        <IconBrandTelegram size={13} className="text-brand" /> same breakdown as your daily Telegram · {data.assignments.range.from} → {data.assignments.range.to}
                      </div>
                    </div>
                    <div className="text-[12.5px] text-gray-500 mb-4">Leads assigned per counsellor in this window, split by Primary Interest.</div>
                    <div className="space-y-3">
                      {src.counsellors.map((c) => {
                        const ints = data.assignments.byInterest.filter((x) => x.counsellor === c).sort((a, b) => b.n - a.n);
                        return (
                          <div key={c} className="flex flex-col md:flex-row md:items-start gap-2 md:gap-4 border-b border-gray-50 pb-3 last:border-b-0 last:pb-0">
                            <div className="md:w-[220px] flex-shrink-0 flex items-center gap-2">
                              <span className="w-7 h-7 rounded-full bg-brand-light text-[#2138B0] text-xs font-semibold flex items-center justify-center flex-shrink-0">{c.slice(0, 1).toUpperCase()}</span>
                              <span className="font-medium text-[#232D42] text-[13.5px]">{c}</span>
                              <span className="text-[13.5px] tabular-nums font-semibold text-[#232D42] ml-auto">{fmtInt(src.totals.by[c] || 0)}</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                              {ints.length ? ints.map((x) => (
                                <span key={x.interest} className="text-[11.5px] bg-[#F3F5FA] text-[#3B4457] rounded-full px-2.5 py-1">
                                  {x.interest} <b className="font-semibold text-[#232D42]">{x.n}</b>
                                </span>
                              )) : <span className="text-[12px] text-gray-400">—</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                      <span className="text-[12.5px] text-gray-500">Total assigned this window</span>
                      <span className="text-[15px] font-semibold text-[#232D42] tabular-nums">{fmtInt(src.totals.total)}</span>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
          {chart.rows.length > 0 && (
            <div className="mt-7">
              <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                <div>
                  <div className="text-[14px] font-medium text-[#232D42]">Leads per {bucket} by {BREAKDOWNS.find((b) => b.v === breakBy)?.noun}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    One bar per {bucket}, full height = all leads that arrived.
                    {" "}Colours split it by the 6 biggest — the rest group into <b className="font-medium">Other</b>.
                  </div>

                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                    Break down by
                    <PreviewSelect value={breakBy} onChange={(v) => setBreakBy(v as BreakBy)}
                      options={BREAKDOWNS.map((b) => ({ value: b.v, label: b.label }))} />
                  </label>

                </div>
              </div>
              <div style={{ width: "100%", height: 300 }}>
                <ResponsiveContainer>
                  <BarChart data={chart.rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF0F4" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8A92A6" }} minTickGap={16} tickLine={false} axisLine={{ stroke: "#EEF0F4" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#8A92A6" }} allowDecimals={false} tickLine={false} axisLine={false} width={30} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #EEF0F4" }}
                      labelFormatter={(l, payload) => {
                        const total = (payload || []).reduce((sum, p) => sum + (Number(p.value) || 0), 0);
                        return `${l} — ${total} lead${total === 1 ? "" : "s"}`;
                      }} />
                    <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 6 }} iconType="circle" iconSize={9} />
                    {chart.keys.map((k, i) => (
                      <Bar key={k} dataKey={k} stackId="s" fill={PALETTE[i % PALETTE.length]}
                        radius={i === chart.keys.length - 1 ? [3, 3, 0, 0] : undefined} maxBarSize={38} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <Foot>
            The card at the top is <b className="text-[#3B4457] font-medium">today</b> — click it for today&apos;s leads.
            <b className="text-[#3B4457] font-medium"> Cold</b> = no CRM activity in over 7 days. Days are counted in IST.
          </Foot>
        </>
      ))}

      {/* ── BY INTEREST ─────────────────────────────────────────── */}
      {tab === "interest" && data && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <Head cols={["Primary Interest", "Leads", "Assigned", "In pool", "Partner", "Other", "New >2d", "Stuck in pool"]} firstLeft />
              <tbody>
                {data.interests.map((i) => {
                  const orphan = i.assigned === 0 && i.pool > 0;
                  return (
                    <tr key={i.interest} className={`border-b border-gray-50 hover:bg-gray-50 ${orphan ? "bg-red-50/40" : ""}`}
                      style={orphan ? { boxShadow: "inset 3px 0 0 #C0392B" } : undefined}>
                      <td className="py-2.5 pr-4 text-left text-[#232D42]">
                        {i.interest}
                        {orphan && <span className="ml-2 text-[10px] bg-red-100 text-[#C0392B] rounded-full px-1.5 py-0.5">never assigned</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium">{fmtInt(i.total)}</td>
                      <td className="py-2.5 px-3 text-right">{n0(i.assigned)}</td>
                      <td className="py-2.5 px-3 text-right">{i.pool ? <span className="text-[11px] bg-brand-light text-[#2138B0] rounded-full px-2 py-0.5">{i.pool}</span> : dash}</td>
                      <td className="py-2.5 px-3 text-right">{n0(i.partner)}</td>
                      <td className="py-2.5 px-3 text-right">{n0(i.other)}</td>
                      <td className="py-2.5 px-3 text-right">{i.newOver2 ? <span className="text-[#C0392B] font-medium">{i.newOver2}</span> : dash}</td>
                      <td className="py-2.5 pl-3 text-right">{i.poolStuck ? <span className="text-[#B7791F] font-medium">{i.poolStuck}</span> : dash}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t border-gray-100 font-semibold text-[#232D42]">
                  <td className="py-3 pr-4 text-left">{data.interests.length} interests</td>
                  <td className="py-3 px-3 text-right">{fmtInt(data.generated)}</td>
                  <td className="py-3 px-3 text-right">{fmtInt(data.interests.reduce((s, i) => s + i.assigned, 0))}</td>
                  <td className="py-3 px-3 text-right">{fmtInt(data.interests.reduce((s, i) => s + i.pool, 0))}</td>
                  <td className="py-3 px-3 text-right">{fmtInt(data.interests.reduce((s, i) => s + i.partner, 0))}</td>
                  <td className="py-3 px-3 text-right">{fmtInt(data.interests.reduce((s, i) => s + i.other, 0))}</td>
                  <td className="py-3 px-3 text-right">{fmtInt(data.alerts.newOver2)}</td>
                  <td className="py-3 pl-3 text-right">{fmtInt(data.alerts.poolStuck)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <Foot>
            <b className="text-[#3B4457] font-medium">New &gt;2d</b> = assigned to a counsellor, still “New”, no edit in over 2 days.{" "}
            <b className="text-[#3B4457] font-medium">Stuck in pool</b> = created over 2 days ago and still unassigned.{" "}
            A row with leads but nobody assigned is flagged red — that interest is generating and going nowhere.
          </Foot>
        </>
      )}

      {/* ── COUNSELLORS ─────────────────────────────────────────── */}
      {tab === "counsellors" && data && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <Head cols={["Holder", "Role", "Leads held", "Still “New”", "New >2d", "No edit >7d", "Never called", "Worked"]} firstLeft secondLeft />
              <tbody>
                {data.holders.map((h) => {
                  const worked = h.total ? Math.round(((h.total - h.stillNew) / h.total) * 100) : 0;
                  return (
                    <tr key={h.holder} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 pr-4 text-left font-medium text-[#232D42]">{h.holder}</td>
                      <td className="py-2.5 px-3 text-left">
                        <span className={`text-[11px] rounded-full px-2 py-0.5 ${ROLE_PILL[h.role]}`}>{ROLE_LABEL[h.role]}</span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium">{fmtInt(h.total)}</td>
                      <td className="py-2.5 px-3 text-right">{n0(h.stillNew)}</td>
                      <td className="py-2.5 px-3 text-right">{h.newOver2 ? <span className="text-[#C0392B] font-medium">{h.newOver2}</span> : dash}</td>
                      <td className="py-2.5 px-3 text-right">{h.idle7 ? <span className="text-[#B7791F]">{h.idle7}</span> : dash}</td>
                      <td className="py-2.5 px-3 text-right">{n0(h.neverCalled)}</td>
                      <td className="py-2.5 pl-3">
                        <div className="flex items-center gap-2 justify-end">
                          <span className="w-[70px] h-[6px] rounded-full bg-gray-100 overflow-hidden">
                            <span className="block h-full rounded-full"
                              style={{ width: `${worked}%`, background: worked < 25 ? "#C0392B" : worked < 55 ? "#B7791F" : "#1F7256" }} />
                          </span>
                          <span className="w-[34px] text-right">{worked}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Foot>
            <b className="text-[#3B4457] font-medium">Never called</b> = Call Attempts is empty or zero, so a call made but not logged looks the same as no call.{" "}
            <b className="text-[#3B4457] font-medium">Worked</b> = share of their leads moved past “New”.
          </Foot>

          <div className="grid gap-3 mt-5 md:grid-cols-2">
            {data.holders.filter((h) => h.total >= 2).map((h) => (
              <div key={h.holder} className="rounded-xl border border-gray-100 p-4">
                <div className="flex items-baseline justify-between gap-2 mb-3">
                  <div className="font-medium text-[#232D42]">{h.holder}</div>
                  <div className="text-xs text-gray-400">{fmtInt(h.total)} leads</div>
                </div>
                <Split title="By stage" rows={h.byStatus.slice(0, 7)} total={h.total} critKey="New" />
                <div className="h-3" />
                <Split title="By interest" rows={h.byInterest.slice(0, 6)} total={h.total} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── TRACKER ─────────────────────────────────────────────── */}
      {tab === "tracker" && data && (
        <TrackerTab data={data} since={since} starred={starred} persisted={tracked?.persisted !== false}
          onStar={toggleStar} onTrack={setTrack} />
      )}

      {/* ── TRANSFER ────────────────────────────────────────────── */}
      {tab === "transfer" && data && <TransferTab data={data} onDone={refresh} />}

      {/* ── ROLES ───────────────────────────────────────────────── */}
      {tab === "roles" && data && <RolesTab data={data} onSaved={refresh} />}

      {track && (
        <LeadTracker lead={track} onClose={() => setTrack(null)}
          onReassign={() => { setReassign(track); setTrack(null); }}
          pinned={starred.has(track.id)} onPin={(on) => toggleStar(track, on)}
          allowReassign={tab !== "tracker"} />
      )}
      {reassign && (
        <ReassignModal lead={reassign} roster={data?.roster || []} roles={data?.roles || {}}
          onClose={() => setReassign(null)} onDone={() => { setReassign(null); refresh(); }} />
      )}
      {drill && data && (
        <TrackerDrill kind={drill} leads={trackLeads} generated={genCount} onClose={() => setDrill(null)}
          onOpenLead={(l) => { setTrack(l); setDrill(null); }} />
      )}
    </div>
  );
}

/* ── shared bits ───────────────────────────────────────────────── */

function Head({ cols, firstLeft, secondLeft }: { cols: string[]; firstLeft?: boolean; secondLeft?: boolean }) {
  return (
    <thead>
      <tr className="text-gray-500 border-b border-gray-100">
        {cols.map((c, i) => (
          <th key={c} className={`py-2.5 font-normal text-[11px] uppercase tracking-wide whitespace-nowrap ${
            (i === 0 && firstLeft) || (i === 1 && secondLeft) ? "text-left" : "text-right"
          } ${i === 0 ? "pr-4" : i === cols.length - 1 ? "pl-3" : "px-3"}`}>{c}</th>
        ))}
      </tr>
    </thead>
  );
}

function Foot({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-gray-400 mt-4 pt-3 border-t border-gray-100 leading-relaxed">{children}</div>;
}

function Split({ title, rows, total, critKey }: { title: string; rows: { key: string; n: number }[]; total: number; critKey?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium mb-2">{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2">
            <span className="text-[11.5px] text-gray-500 w-[130px] truncate flex-shrink-0">{r.key}</span>
            <span className="flex-1 h-[6px] rounded-full bg-gray-100 overflow-hidden">
              <span className="block h-full rounded-full" style={{ width: `${(r.n / total) * 100}%`, background: r.key === critKey ? "#C0392B" : "#3A57E8" }} />
            </span>
            <span className="text-[11.5px] tabular-nums w-[30px] text-right flex-shrink-0 text-[#232D42]">{r.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Drill-down when a summary card on the tracker is clicked. "new" = where the leads
// came from (by interest + source); "notcalled" / "waiting" = the actual list, 10 a
// page with next/prev. Rows open the lead's full History. All from data.allLeads.
function DrillShell({ title, sub, onClose, children }: { title: string; sub: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-6 overflow-y-auto preview-scope" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-gray-100">
          <div className="min-w-0">
            <div className="text-lg font-medium text-[#232D42]">{title}</div>
            <div className="text-[13px] text-gray-500 mt-0.5">{sub}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none flex-shrink-0">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TrackerDrill({ kind, leads, generated, onClose, onOpenLead }: {
  kind: "new" | "notcalled" | "waiting"; leads: BoardLead[]; generated: number; onClose: () => void; onOpenLead: (l: BoardLead) => void;
}) {
  const [page, setPage] = useState(0);
  const PER = 10;

  if (kind === "new") {
    const group = (key: (l: BoardLead) => string): [string, number][] => {
      const m = new Map<string, number>();
      for (const l of leads) { const k = key(l) || "—"; m.set(k, (m.get(k) || 0) + 1); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const total = leads.length || 1;
    const Bars = ({ heading, rows }: { heading: string; rows: [string, number][] }) => (
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-2.5">{heading}</div>
        <div className="flex flex-col gap-1.5">
          {rows.slice(0, 12).map(([label, n]) => (
            <div key={label} className="flex items-center gap-2 text-[13px]">
              <div className="w-44 truncate text-[#3B4457]" title={label}>{label}</div>
              <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-brand rounded-full" style={{ width: `${Math.round((n / total) * 100)}%` }} /></div>
              <div className="w-20 text-right tabular-nums text-[#232D42] font-medium">{fmtInt(n)} <span className="text-gray-400 font-normal">· {Math.round((n / total) * 100)}%</span></div>
            </div>
          ))}
        </div>
      </div>
    );
    return (
      <DrillShell title="New leads — where they came from" sub={`${fmtInt(generated)} new leads in the selected period`} onClose={onClose}>
        <div className="flex flex-col gap-6 p-6">
          <Bars heading="By Primary Interest" rows={group((l) => l.interest)} />
          <Bars heading="By lead source" rows={group((l) => l.source)} />
        </div>
      </DrillShell>
    );
  }

  const list = leads.filter((l) => (kind === "notcalled" ? l.flaggedNew : l.flaggedPool));
  const pages = Math.max(1, Math.ceil(list.length / PER));
  const p = Math.min(page, pages - 1);
  const slice = list.slice(p * PER, p * PER + PER);
  const title = kind === "notcalled" ? "Nobody has called these yet" : "Waiting to be assigned";
  const sub = kind === "notcalled"
    ? `${fmtInt(list.length)} leads a counsellor hasn't started — still "New" 2+ days on`
    : `${fmtInt(list.length)} leads with no counsellor, sitting in the holding pool 2+ days`;

  return (
    <DrillShell title={title} sub={sub} onClose={onClose}>
      <div className="p-6">
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          {slice.map((l) => (
            <button key={l.id} onClick={() => onOpenLead(l)} className="w-full text-left flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-[#232D42] truncate">{l.name}</div>
                <div className="text-[11px] text-gray-400 truncate">{l.interest} · {l.source}</div>
              </div>
              {kind === "notcalled"
                ? <div className="text-[12px] text-gray-500 whitespace-nowrap">{l.counsellor || "—"} · <span className="text-[#C0392B]">{l.daysUntouched}d untouched</span></div>
                : <div className="text-[12px] text-gray-500 whitespace-nowrap">In pool · <span className="text-[#B0203A]">{l.ageDays}d waiting</span></div>}
            </button>
          ))}
          {slice.length === 0 && <div className="px-4 py-8 text-center text-gray-400 text-sm">None right now ✓</div>}
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between mt-3 text-[12.5px] text-gray-500">
            <span>Showing {p * PER + 1}–{Math.min((p + 1) * PER, list.length)} of {fmtInt(list.length)}</span>
            <div className="flex items-center gap-1">
              <button disabled={p === 0} onClick={() => setPage(p - 1)} className="px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:border-gray-300">‹ Prev</button>
              <span className="px-1">Page {p + 1} / {pages}</span>
              <button disabled={p >= pages - 1} onClick={() => setPage(p + 1)} className="px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:border-gray-300">Next ›</button>
            </div>
          </div>
        )}
        {kind === "waiting" && <div className="text-[12px] text-gray-400 mt-3.5">These have no counsellor yet — the round-robin hasn&apos;t handed them out (e.g. they came in outside working hours, or the interest has no active counsellor). Assign them from the Transfer tab, or open one for its details.</div>}
      </div>
    </DrillShell>
  );
}

function LeadTable({ leads, starred, onStar, onTrack, onReassign, showWhy, allowReassign = true }: {
  leads: BoardLead[]; starred: Set<string>;
  onStar: (l: BoardLead, on: boolean) => void;
  onTrack: (l: BoardLead) => void; onReassign: (l: BoardLead) => void;
  showWhy?: boolean;
  // The Leads-tracker page is for following leads, nothing else — moving them is
  // what the Transfer page is for, and having both here just duplicated it.
  allowReassign?: boolean;
}) {
  if (leads.length === 0) return <div className="text-sm text-gray-400 py-8 text-center">Nothing here.</div>;
  return (
    <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white">
          <tr className="text-gray-500 border-b border-gray-100">
            <th className="py-2.5 w-8"></th>
            <th className="py-2.5 pr-3 font-normal text-left text-[11px] uppercase tracking-wide">Lead</th>
            <th className="py-2.5 px-3 font-normal text-left text-[11px] uppercase tracking-wide">Interest</th>
            <th className="py-2.5 px-3 font-normal text-left text-[11px] uppercase tracking-wide">Counsellor</th>
            <th className="py-2.5 px-3 font-normal text-left text-[11px] uppercase tracking-wide">Stage</th>
            {showWhy && <th className="py-2.5 px-3 font-normal text-left text-[11px] uppercase tracking-wide">Why</th>}
            <th className="py-2.5 pl-3 font-normal text-right text-[11px] uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody>
          {leads.slice(0, 300).map((l) => {
            const on = starred.has(l.id);
            return (
              <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2.5">
                  <button onClick={() => onStar(l, !on)} title={on ? "Unpin from tracker" : "Pin to tracker"}
                    className={on ? "text-[#E0A930]" : "text-gray-300 hover:text-[#E0A930]"}>
                    {on ? <IconStarFilled size={15} /> : <IconStar size={15} />}
                  </button>
                </td>
                <td className="py-2.5 pr-3">
                  <div className="font-medium text-[#232D42] max-w-[210px] truncate">{l.name}</div>
                  <div className="text-[11px] text-gray-400">{l.source}</div>
                </td>
                <td className="py-2.5 px-3">
                  <span className={`text-[11px] rounded-full px-2 py-0.5 ${l.cold ? "bg-amber-50 text-amber-700" : "bg-brand-light text-[#2138B0]"}`}>
                    {l.interest}{l.cold ? ` · cold ${l.daysUntouched}d` : ""}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-gray-500">{l.counsellor || <span className="text-gray-300">Unassigned</span>}</td>
                <td className="py-2.5 px-3 text-gray-500">{l.status}</td>
                {showWhy && (
                  <td className="py-2.5 px-3">
                    {l.flaggedNew && <span className="text-[11px] bg-red-50 text-[#C0392B] rounded-full px-2 py-0.5">New, untouched {l.daysUntouched}d</span>}
                    {l.flaggedPool && <span className="text-[11px] bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">In pool {l.ageDays}d</span>}
                  </td>
                )}
                <td className="py-2.5 pl-3">
                  <div className="flex items-center gap-1.5 justify-end">
                    <button onClick={() => onTrack(l)} title="See this lead's history — stage changes, calls and meetings"
                      className="text-xs inline-flex items-center gap-1 border border-gray-200 rounded-lg px-2.5 py-1 text-[#4A5468] hover:border-brand hover:text-brand whitespace-nowrap">
                      <IconTimeline size={13} /> History
                    </button>
                    {allowReassign && (
                      <button onClick={() => onReassign(l)}
                        className="text-xs inline-flex items-center gap-1 border border-gray-200 rounded-lg px-2.5 py-1 text-[#4A5468] hover:border-brand hover:text-brand whitespace-nowrap">
                        <IconArrowsExchange size={13} /> Reassign
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {leads.length > 300 && (
        <div className="text-xs text-gray-400 mt-3">Showing the first 300 of {fmtInt(leads.length)} — narrow the range to see the rest.</div>
      )}
    </div>
  );
}

/* ── tracker tab ───────────────────────────────────────────────── */

function TrackerTab({ data, since, starred, persisted, onStar, onTrack }: {
  data: Board; since?: string; starred: Set<string>; persisted: boolean;
  onStar: (l: BoardLead, on: boolean) => void; onTrack: (l: BoardLead) => void;
}) {
  // Tracking only. Moving a lead lives on the Transfer page.
  const noop = () => {};
  // The "track from" cutoff hides the pre-cutoff backlog from the flags + search
  // (but never from Pinned — those are the user's own picks).
  const inRange = (l: BoardLead) => !since || l.date >= since;
  // Find-a-lead-to-track search — filters this period's leads by name / interest /
  // source / counsellor, 10 a page, each pinnable with the star.
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterModel>(EMPTY_FILTER);
  const [page, setPage] = useState(0);
  const PER = 10;
  const query = q.trim().toLowerCase();
  // Either control on its own narrows the list; together they both apply.
  const hasFilter = filter.conditions.length > 0;
  const matches = query || hasFilter
    ? data.allLeads.filter((l) => inRange(l)
        && (!query || `${l.name} ${l.interest} ${l.source} ${l.counsellor}`.toLowerCase().includes(query))
        && (!hasFilter || evalFilter(l, filter, TRACKER_FILTER_FIELDS)))
    : [];
  const trackerOptionsFor = (key: string) => {
    const def = TRACKER_FILTER_FIELDS.find((f) => f.key === key);
    if (!def || def.type !== "select") return [];
    const seen = new Set(data.allLeads.map((l) => String(def.get(l) || "")).filter(Boolean));
    return [...seen].sort().map((v) => ({ value: v, label: v }));
  };
  const mPages = Math.max(1, Math.ceil(matches.length / PER));
  const mp = Math.min(page, mPages - 1);
  const mSlice = matches.slice(mp * PER, mp * PER + PER);
  const pinned = data.allLeads.filter((l) => starred.has(l.id));
  const flagged = data.allLeads
    .filter((l) => !starred.has(l.id) && (l.flaggedNew || l.flaggedPool) && inRange(l))
    .sort((a, b) => (b.flaggedNew ? b.daysUntouched : b.ageDays) - (a.flaggedNew ? a.daysUntouched : a.ageDays));

  return (
    <>
      {!persisted && (
        <div className="mb-4 flex items-start gap-2 text-[12.5px] text-[#8A6D1F] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          <IconAlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
          <span>Pinning won&apos;t stick yet — run <b>supabase/lead-roles-and-tracking.sql</b> in the Supabase SQL editor once. Everything else on this tab works.</span>
        </div>
      )}
      {/* Find a lead to watch — search this period, then star it into Pinned below. */}
      <div className="text-sm font-medium text-[#232D42] mb-1">Find a lead to track</div>
      <div className="text-[12.5px] text-gray-500 mb-3">Don&apos;t know the name? Search by Primary Interest (or name/source/counsellor), then click the ☆ star to pin it to your list below.</div>
      <div className="relative mb-4 max-w-md">
        <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search by name, Primary Interest, source or counsellor…"
          className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-brand" />
      </div>
      <div className="mb-4 flex items-center gap-2">
        <FilterPopover<BoardLead> filter={filter} fields={TRACKER_FILTER_FIELDS} optionsFor={trackerOptionsFor}
          onChange={(f) => { setFilter(f); setPage(0); }}
          emptyNote="No conditions — showing every lead in this period. Add one below." />
      </div>
      {(query || hasFilter) && (
        <div className="mb-6">
          {matches.length ? (
            <>
              <LeadTable leads={mSlice} starred={starred} onStar={onStar} onTrack={onTrack} onReassign={noop} allowReassign={false} />
              {mPages > 1 && (
                <div className="flex items-center justify-between mt-3 text-[12.5px] text-gray-500">
                  <span>Showing {mp * PER + 1}–{Math.min((mp + 1) * PER, matches.length)} of {fmtInt(matches.length)}</span>
                  <div className="flex items-center gap-1">
                    <button disabled={mp === 0} onClick={() => setPage(mp - 1)} className="px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:border-gray-300">‹ Prev</button>
                    <span className="px-1">Page {mp + 1} / {mPages}</span>
                    <button disabled={mp >= mPages - 1} onClick={() => setPage(mp + 1)} className="px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:border-gray-300">Next ›</button>
                  </div>
                </div>
              )}
            </>
          ) : <div className="text-sm text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">No leads match {query ? <>&ldquo;{q}&rdquo;</> : "that filter"} in this period. Try another word, loosen the filter, or widen the date range at the top.</div>}
        </div>
      )}

      <div className="text-sm font-medium text-[#232D42] mb-3">
        Pinned <span className="text-gray-400 font-normal">· {fmtInt(pinned.length)}</span>
      </div>
      {pinned.length > 0
        ? <LeadTable leads={pinned} starred={starred} onStar={onStar} onTrack={onTrack} onReassign={noop} allowReassign={false} />
        : <div className="text-sm text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">
            Nothing pinned yet. Open any lead&apos;s <b className="font-medium text-[#3B4457]">History</b> and choose
            <b className="font-medium text-[#3B4457]"> Add to tracker</b> — or click the star beside it in any list.
          </div>}

      <div className="text-sm font-medium text-[#232D42] mt-7 mb-3">
        Flagged automatically <span className="text-gray-400 font-normal">· {fmtInt(flagged.length)}</span>
      </div>
      <LeadTable leads={flagged} starred={starred} onStar={onStar} onTrack={onTrack} onReassign={noop} showWhy allowReassign={false} />

      <Foot>
        Every lead&apos;s history is recorded nightly regardless — pinning only decides what shows up here.
        Flagged = assigned but still “New” after 2 days, or sitting in the pool more than 2 days.
      </Foot>
    </>
  );
}

/* ── transfer tab ──────────────────────────────────────────────── */

function TransferTab({ data, onDone }: { data: Board; onDone: () => void }) {
  const holders = data.holders.map((h) => h.holder);
  const [fromHolder, setFromHolder] = useState(holders[0] || "");
  const [minIdle, setMinIdle] = useState(2);
  const [status, setStatus] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [toUserId, setToUserId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ requested: number; failed: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gate, setGate] = useState<GateBlock | null>(null);

  // Dead leads are excluded unless you deliberately pick that stage. Robin alone
  // holds 104 junk leads; with them in the list, "select all" hands the next
  // counsellor a pile of work that can never go anywhere.
  const matches = useMemo(() => data.allLeads.filter((l) =>
    (l.counsellor || "Unassigned") === fromHolder &&
    l.daysUntouched >= minIdle &&
    (status ? l.status === status : !isClosedStatus(l.status))
  ), [data, fromHolder, minIdle, status]);

  const statuses = useMemo(() => [...new Set(data.allLeads.filter((l) => (l.counsellor || "Unassigned") === fromHolder).map((l) => l.status))].sort(), [data, fromHolder]);
  const closedHeld = useMemo(() => data.allLeads.filter((l) =>
    (l.counsellor || "Unassigned") === fromHolder && l.daysUntouched >= minIdle && isClosedStatus(l.status)).length,
    [data, fromHolder, minIdle]);
  const fromUserId = data.holders.find((h) => h.holder === fromHolder)?.userId || "";
  const targets = data.roster.filter((r) => r.userId !== fromUserId);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = matches.length > 0 && matches.every((l) => sel.has(l.id));

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/leads-crm/transfer", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ leadIds: [...sel], fromUserId, toUserId, notes }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const block = gateFromResponse(res.status, j, `${sel.size} leads`);
        if (block) setGate(block);
        else setErr((j as { error?: string }).error || `HTTP ${res.status}`);
        return;
      }
      setDone({ requested: (j as { requested: number }).requested, failed: (j as { failed: number }).failed });
      setSel(new Set());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="py-8 text-center">
        <IconCircleCheck size={30} className="text-[#1F7256] mx-auto mb-3" />
        <div className="text-lg font-medium text-[#232D42]">{fmtInt(done.requested)} transfer request{done.requested === 1 ? "" : "s"} raised</div>
        <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto leading-relaxed">
          They&apos;re in Airtable&apos;s <b>Transfer Ownership</b> table. The n8n workflow moves them on its 20-minute cycle,
          then the new owner shows up here.
          {done.failed > 0 && <span className="text-[#C0392B]"> {done.failed} could not be written — try those again.</span>}
        </p>
        <button onClick={() => { setDone(null); onDone(); }} className="mt-5 text-sm font-medium bg-brand text-white rounded-lg px-4 py-2">Done</button>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <Field label="Currently with">
          <PreviewSelect value={fromHolder} onChange={(v) => { setFromHolder(v); setStatus(""); setSel(new Set()); }}
            options={data.holders.map((h) => ({ value: h.holder, label: `${h.holder} (${h.total})` }))} />
        </Field>
        <Field label="Untouched for">
          <PreviewSelect value={String(minIdle)} onChange={(v) => { setMinIdle(+v); setSel(new Set()); }}
            options={[
              { value: "0", label: "any" }, { value: "2", label: "more than 2 days" },
              { value: "7", label: "more than 7 days" }, { value: "14", label: "more than 14 days" },
            ]} />
        </Field>
        <Field label="Stage">
          <PreviewSelect value={status} onChange={(v) => { setStatus(v); setSel(new Set()); }} placeholder="Any stage"
            options={[{ value: "", label: "Any open stage" }, ...statuses.map((x) => ({ value: x, label: isClosedStatus(x) ? `${x} (closed)` : x }))]} />
        </Field>
        <div className="text-sm text-gray-500 pb-2">
          <b className="text-[#232D42]">{fmtInt(matches.length)}</b> match{matches.length === 1 ? "" : "es"}
          {!status && closedHeld > 0 && (
            <span className="text-gray-400"> · {fmtInt(closedHeld)} closed hidden</span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-gray-100 rounded-lg">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="text-gray-500 border-b border-gray-100">
              <th className="py-2.5 px-3 w-9">
                <input type="checkbox" checked={allOn} onChange={(e) => setSel(e.target.checked ? new Set(matches.map((l) => l.id)) : new Set())}
                  className="accent-[#3A57E8]" title="Select all matches" />
              </th>
              <th className="py-2.5 pr-3 font-normal text-left text-[11px] uppercase tracking-wide">Lead</th>
              <th className="py-2.5 px-3 font-normal text-left text-[11px] uppercase tracking-wide">Interest</th>
              <th className="py-2.5 px-3 font-normal text-left text-[11px] uppercase tracking-wide">Stage</th>
              <th className="py-2.5 px-3 font-normal text-right text-[11px] uppercase tracking-wide">Idle</th>
              <th className="py-2.5 px-3 font-normal text-left text-[11px] uppercase tracking-wide">Arrived</th>
            </tr>
          </thead>
          <tbody>
            {matches.slice(0, 300).map((l) => (
              <tr key={l.id} onClick={() => toggle(l.id)} className={`border-b border-gray-50 cursor-pointer ${sel.has(l.id) ? "bg-brand-light/40" : "hover:bg-gray-50"}`}>
                <td className="py-2.5 px-3"><input type="checkbox" checked={sel.has(l.id)} onChange={() => toggle(l.id)} onClick={(e) => e.stopPropagation()} className="accent-[#3A57E8]" /></td>
                <td className="py-2.5 pr-3 font-medium text-[#232D42] max-w-[220px] truncate">{l.name}</td>
                <td className="py-2.5 px-3 text-gray-500 max-w-[160px] truncate">{l.interest}</td>
                <td className="py-2.5 px-3 text-gray-500">{l.status}</td>
                <td className="py-2.5 px-3 text-right"><span className={l.daysUntouched > 7 ? "text-[#C0392B] font-medium" : "text-gray-400"}>{l.daysUntouched}d</span></td>
                <td className="py-2.5 px-3 text-gray-400">{l.date}</td>
              </tr>
            ))}
            {matches.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-gray-400">Nothing matches those filters.</td></tr>}
          </tbody>
        </table>
        {matches.length > 300 && <div className="text-xs text-gray-400 p-3">Showing 300 of {fmtInt(matches.length)} — select-all still applies to all {fmtInt(matches.length)}.</div>}
      </div>

      <div className="sticky bottom-2 mt-3 bg-white border border-brand rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-sm"><b className="font-semibold text-[#232D42]">{fmtInt(sel.size)}</b> selected</span>
        <span className="text-sm text-gray-500">→ move to</span>
        <PreviewSelect value={toUserId} onChange={setToUserId} placeholder="Pick a counsellor…"
          options={targets.map((r) => ({ value: r.userId, label: `${r.name}${r.inRoster ? "" : " (not on the Counsellors list)"}` }))} />
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason — goes into Transfer Notes"
          className="flex-1 min-w-[200px] border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <button onClick={submit} disabled={busy || sel.size === 0}
          className="text-sm font-medium bg-brand text-white rounded-lg px-4 py-2 disabled:opacity-45 disabled:cursor-not-allowed">
          {busy ? "Requesting…" : "Reassign"}
        </button>
      </div>

      {err && <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

      <div className="flex items-start gap-2 text-[12.5px] text-[#8A6D1F] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 mt-4 leading-relaxed">
        <IconAlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
        <span>
          This writes one <b>Pending</b> row per lead into Airtable&apos;s Transfer Ownership table; the n8n workflow
          <b> Transfer Ownership on CRM</b> then changes the owner within 20 minutes. Whether it waits for the
          <b> Confirm Transfer</b> tickbox depends on that workflow&apos;s <b>Transfer Pending</b> view filter, which the
          API won&apos;t expose — treat a bulk reassign as live until that&apos;s confirmed.
        </span>
      </div>
      {gate && <MissingFieldsModal {...gate} onClose={() => setGate(null)} />}
    </>
  );
}

const SELECT = "border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-[#232D42]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10.5px] uppercase tracking-wide text-gray-500">{label}</label>
      {children}
    </div>
  );
}

/* ── roles tab ─────────────────────────────────────────────────── */

type RolesMeta = Record<string, { updatedBy: string | null; updatedAt: string | null }>;

function RolesTab({ data, onSaved }: { data: Board; onSaved: () => void }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, Role>>(data.roles);
  // Who changed each role and when — the roles table keeps its own audit columns.
  const { data: rolesInfo, refresh: refreshRoles } =
    useApi<{ roles: Record<string, Role>; meta: RolesMeta }>("/api/leads-crm/roles");
  const meta: RolesMeta = rolesInfo?.meta || {};

  const save = async (holder: string, role: Role) => {
    setSaving(holder); setErr(null);
    const prev = local[holder];
    setLocal((r) => ({ ...r, [holder]: role }));
    try {
      const res = await fetch("/api/leads-crm/roles", {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ holder, role }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setLocal((r) => ({ ...r, [holder]: prev })); // put it back — the save didn't stick
        setErr((j as { error?: string }).error || `HTTP ${res.status}`);
        return;
      }
      refreshRoles();
      onSaved();
    } catch (e) {
      setLocal((r) => ({ ...r, [holder]: prev }));
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSaving(null); }
  };

  return (
    <>
      {err && <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-100">
              <th className="py-2.5 pr-4 font-normal text-left text-[11px] uppercase tracking-wide">Holder</th>
              <th className="py-2.5 px-3 font-normal text-left text-[11px] uppercase tracking-wide">Role</th>
              <th className="py-2.5 px-3 font-normal text-left text-[11px] uppercase tracking-wide">Changed by</th>
              <th className="py-2.5 pl-3 font-normal text-left text-[11px] uppercase tracking-wide">When</th>
            </tr>
          </thead>
          <tbody>
            {data.holders.map((h) => {
              const m = meta[h.holder];
              return (
                <tr key={h.holder} className="border-b border-gray-50">
                  <td className="py-2.5 pr-4 font-medium text-[#232D42] whitespace-nowrap">{h.holder}</td>
                  <td className="py-2.5 px-3">
                    <PreviewSelect value={local[h.holder] || "inactive"} disabled={saving === h.holder}
                      onChange={(v) => save(h.holder, v as Role)}
                      options={(Object.keys(ROLE_LABEL) as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
                  </td>
                  {/* Never edited since it was seeded — no name to show, so say nothing. */}
                  <td className="py-2.5 px-3 text-gray-500">{m?.updatedBy || dash}</td>
                  <td className="py-2.5 pl-3 text-gray-500 whitespace-nowrap">
                    {m?.updatedBy && m?.updatedAt ? fmtDateTime(m.updatedAt) : dash}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── lead tracker drawer ───────────────────────────────────────── */

type TrackEvent = {
  at: string;
  kind: "arrived" | "assigned" | "reenquiry" | "meeting" | "contract" | "callback" | "closed" | "touched" | "stage";
  title: string; detail?: string; who?: string; rating?: number | null;
};
type TrackPayload = {
  lead: Record<string, unknown> & { name: string; status: string; counsellor: string };
  events: TrackEvent[];
  note: string;
};

// One colour per kind of thing that happened, so the timeline reads at a glance.
const EVENT_DOT: Record<TrackEvent["kind"], string> = {
  arrived: "#8A92A6", assigned: "#3A57E8", reenquiry: "#B7791F", meeting: "#1F7256",
  contract: "#7C3AED", callback: "#0EA5E9", closed: "#C0392B", touched: "#C7D2F7", stage: "#E0791F",
};

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[#B7791F]" title={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => i <= n ? <IconStarFilled key={i} size={12} /> : <IconStar key={i} size={12} className="text-gray-300" />)}
    </span>
  );
}

function LeadTracker({ lead, onClose, onReassign, pinned, onPin, allowReassign = true }: {
  lead: BoardLead; onClose: () => void; onReassign: () => void;
  pinned: boolean; onPin: (on: boolean) => void; allowReassign?: boolean;
}) {
  const { data, isLoading, error } = useApi<TrackPayload>(`/api/leads-crm/lead-track?id=${encodeURIComponent(lead.id)}`);
  const l = data?.lead as (TrackPayload["lead"] & Record<string, string | number | boolean>) | undefined;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-6 overflow-y-auto preview-scope" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-gray-100">
          <div className="min-w-0">
            <div className="text-lg font-medium text-[#232D42] truncate">{lead.name}</div>
            <div className="text-sm text-gray-500 mt-0.5">{lead.interest} · {lead.source} · with {lead.counsellor || "nobody"}</div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* This is what actually puts a lead on the Leads-tracker page. It used to
                live only as a small star in the row, where nobody found it. */}
            <button onClick={() => onPin(!pinned)}
              title={pinned ? "Remove from the Leads tracker page" : "Pin this lead to the Leads tracker page"}
              className={`text-xs font-medium rounded-lg px-3 py-1.5 inline-flex items-center gap-1 border ${
                pinned ? "border-[#E0A930] text-[#8A6D1F] bg-amber-50" : "border-gray-200 text-[#4A5468] hover:border-brand hover:text-brand"}`}>
              {pinned ? <IconStarFilled size={13} /> : <IconStar size={13} />}
              {pinned ? "On tracker" : "Add to tracker"}
            </button>
            {allowReassign && (
              <button onClick={onReassign} className="text-xs font-medium bg-brand text-white rounded-lg px-3 py-1.5 inline-flex items-center gap-1">
                <IconArrowsExchange size={13} /> Reassign
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
          </div>
        </div>

        <div className="max-h-[72vh] overflow-y-auto">
          {error && <div className="m-6 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Couldn&apos;t load — {(error as Error).message}</div>}
          {isLoading && !data && <LoadingBlock className="!py-6" size={24} />}

          {data && l && (
            <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr]">
              <div className="p-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-6">
                  <Mini label="Stage now" value={String(l.status)} />
                  <Mini label="Idle" value={`${l.daysUntouched}d`} tone={Number(l.daysUntouched) > 7 ? "warn" : undefined} />
                  <Mini label="Call attempts" value={String(l.callAttempts ?? 0)} />
                  {l.firstContactAt
                    ? <Mini label="First contacted" value={`${String(l.firstContactAt).slice(0, 10)}${typeof l.timeToContactDays === "number" ? ` · ${l.timeToContactDays}d` : ""}`} />
                    : <Mini label="Arrived" value={String(l.createdAt || "").slice(0, 10) || "—"} />}
                </div>

                <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-3">
                  What happened <span className="normal-case tracking-normal text-gray-400">· from Airtable</span>
                </div>
                {data.events.length > 0 ? (
                  <ol className="relative border-l border-gray-200 ml-1">
                    {data.events.map((e, i) => (
                      <li key={i} className="ml-4 pb-4">
                        <span className="absolute -left-[4.5px] w-2 h-2 rounded-full ring-2 ring-white"
                          style={{ background: EVENT_DOT[e.kind] || "#3A57E8" }} />
                        <div className="text-[11px] text-gray-400 tabular-nums">
                          {fmtDateTime(e.at)}
                        </div>
                        <div className="text-[13px] text-[#232D42] font-medium">
                          {e.title}
                          {e.rating ? <span className="ml-1.5 align-middle"><Stars n={e.rating} /></span> : null}
                        </div>
                        {(e.detail || e.who) && (
                          <div className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">
                            {e.who && <span className="text-[#4A5468]">{e.who}</span>}
                            {e.who && e.detail && " · "}
                            {e.detail}
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : <div className="text-sm text-gray-400">Nothing recorded on this lead beyond its arrival.</div>}
              </div>

              <div className="p-6 md:border-l border-gray-100">
                {typeof l.notes === "string" && l.notes && (
                  <>
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-2">Counsellor notes</div>
                    <div className="text-[12.5px] text-[#4A5468] leading-relaxed whitespace-pre-wrap border border-gray-100 rounded-lg p-3 mb-4">
                      {String(l.notes).slice(0, 1200)}
                    </div>
                  </>
                )}
                {typeof l.automatedNotes === "string" && l.automatedNotes && (
                  <>
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-2">From the form</div>
                    <div className="text-[12.5px] text-gray-500 leading-relaxed border border-gray-100 rounded-lg p-3 mb-4">
                      {l.automatedNotes.slice(0, 600)}
                    </div>
                  </>
                )}

                <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-2">Details</div>
                <dl className="text-[12.5px] flex flex-col gap-1.5 mb-4">
                  {([
                    ["Counsellor", l.counsellor || "nobody"],
                    ["Last edited by", l.lastModifiedBy || "—"],
                    ["Source", l.source],
                    ["Campaign", l.campaign],
                    ["Location", l.location],
                    ["Callback", l.scheduledCallback ? fmtDateTime(String(l.scheduledCallback)) : ""],
                  ] as [string, unknown][]).filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3">
                      <dt className="text-gray-400">{k}</dt>
                      <dd className="text-[#232D42] text-right">{String(v)}</dd>
                    </div>
                  ))}
                </dl>

                <div className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-lg p-3 leading-relaxed">
                  {data.note}
                </div>
                {typeof l.link === "string" && l.link && (
                  <a href={l.link} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline mt-3 inline-block">Open in Airtable →</a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, node, tone }: { label: string; value?: string; node?: React.ReactNode; tone?: "warn" }) {
  return (
    <div className="rounded-lg border border-gray-100 px-3 py-2">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-[15px] font-semibold mt-0.5 ${tone === "warn" ? "text-[#B7791F]" : "text-[#232D42]"}`}>{node ?? value}</div>
    </div>
  );
}

/* ── single reassign ───────────────────────────────────────────── */

function ReassignModal({ lead, roster, roles, onClose, onDone }: {
  lead: BoardLead; roster: RosterEntry[]; roles: Record<string, Role>; onClose: () => void; onDone: () => void;
}) {
  const [toUserId, setToUserId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState<GateBlock | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ requestId: number | null } | null>(null);

  // Inactive holders can't receive leads — that's what the role means.
  const options = roster.filter((r) => r.userId !== lead.counsellorUserId && (roles[r.name] || "inactive") !== "inactive");

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/leads-crm/transfer", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ leadId: lead.id, fromUserId: lead.counsellorUserId, toUserId, notes, leadName: lead.name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const block = gateFromResponse(res.status, j, lead.name);
        if (block) setGate(block);
        else setErr((j as { error?: string }).error || `HTTP ${res.status}`);
        return;
      }
      setDone({ requestId: (j as { requestId: number | null }).requestId ?? null });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-start justify-center p-6 overflow-y-auto preview-scope" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg my-10 p-6" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <>
            <div className="flex items-center gap-2 text-[#1F7256] mb-2">
              <IconCircleCheck size={20} /><span className="text-lg font-medium">Reassignment requested</span>
            </div>
            <p className="text-sm text-[#4A5468] leading-relaxed">
              Request {done.requestId != null && <b>#{done.requestId} </b>}is in Airtable&apos;s <b>Transfer Ownership</b> table.
              The n8n workflow moves <b>{lead.name}</b> from {lead.counsellor || "nobody"} on its 20-minute cycle.
            </p>
            <div className="flex justify-end mt-5">
              <button onClick={onDone} className="text-sm font-medium bg-brand text-white rounded-lg px-4 py-2">Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="text-lg font-medium text-[#232D42]">Reassign {lead.name}</div>
            <p className="text-sm text-gray-500 mt-1 mb-4">currently with {lead.counsellor || "nobody"}</p>

            <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Move to <span className="text-rose-500">*</span></label>
            <div className="mb-4">
              <PreviewSelect value={toUserId} onChange={setToUserId} placeholder="Pick a counsellor…" className="w-full justify-between"
                options={options.map((r) => ({ value: r.userId, label: `${r.name}${r.inRoster ? "" : " (not on the Counsellors list)"}` }))} />
            </div>

            <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Reason <span className="text-rose-500">*</span></label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              placeholder="e.g. Jeswin is on leave this week — Robin can call her today."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-1" />
            <div className="text-xs text-gray-400 mb-4">Goes into Transfer Notes in Airtable.</div>

            {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{err}</div>}

            <div className="flex items-start gap-2 text-[12px] text-[#8A6D1F] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 mb-4 leading-relaxed">
              <IconAlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
              <span>Picked up by n8n within 20 minutes. Whether it waits for the <b>Confirm Transfer</b> tickbox depends on the <b>Transfer Pending</b> view filter — treat it as live until confirmed.</span>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900 px-3 py-2">Cancel</button>
              <button onClick={submit} disabled={busy} className="text-sm font-medium bg-brand text-white rounded-lg px-4 py-2 disabled:opacity-50">
                {busy ? "Requesting…" : "Reassign"}
              </button>
            </div>
          </>
        )}
        {gate && <div onClick={(e) => e.stopPropagation()}><MissingFieldsModal {...gate} onClose={() => setGate(null)} /></div>}
      </div>
    </div>
  );
}
