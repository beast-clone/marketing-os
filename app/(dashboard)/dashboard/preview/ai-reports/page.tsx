"use client";
import { IconBuilding, IconPrinter } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { BrandLoader } from "@/components/BrandLoader";
import { ReportView, PERIOD_META, type ReportPayload, type Period } from "./ReportView";
import { MonthlyReportView } from "./MonthlyReportView";
import { YearlyReportView } from "./YearlyReportView";
import { TeamReports } from "./TeamReportView";
import { HISTORY_FIRST } from "@/lib/report-history";

export default function AIReportsPage() {
  // Lifted so the shell can hide the account picker on Monthly: the monthly report is
  // the company report for the main GooCampus accounts and ignores the picker.
  const [period, setPeriod] = useState<View>("monthly");
  return (
    <PreviewDashboardShell active="ai-reports" title="Monthly Reports" subtitle="The full monthly report in the team's format — live data + imported history. Weekly & quarterly rollups available too; generated reports are stored under Reports." hideRange
      hideAccountPicker={period === "monthly" || period === "yearly" || period === "team"}>
      {({ accountId }) => <AIReports accountId={accountId} period={period} setPeriod={setPeriod} />}
    </PreviewDashboardShell>
  );
}

// Monthly and Yearly are the company reports (list on the left); weekly / quarterly
// are the per-account generator.
type View = Period | "yearly" | "team";

function AIReports({ accountId, period, setPeriod }: { accountId: string; period: View; setPeriod: (p: View) => void }) {
  // "monthly" = the full-format template report (default). weekly/quarterly = the
  // live single-account generator (ReportView). savedMode = opened from the archive.
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState<Period | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMode, setSavedMode] = useState(false);
  // The archive key of the report on screen — what an edit is saved back to.
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const autoedFor = useRef<string | null>(null);

  const reqId = useRef(0); // only the latest request may set the report (quick account switches)
  const generate = async (p: Period, force = false) => {
    const id = ++reqId.current;
    setLoading(p);
    setError(null);
    setPeriod(p);
    try {
      const qs = new URLSearchParams({ accountId, period: p, ...(force ? { force: "1" } : {}) }).toString();
      const r = await fetch(`/api/ai-report?${qs}`);
      const d = await r.json();
      if (id !== reqId.current) return;
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setReport(d as ReportPayload);
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message);
    } finally {
      if (id === reqId.current) setLoading(null);
    }
  };

  // Open an archived report as-is when ?saved=<key> is present.
  useEffect(() => {
    const keyFromUrl = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("saved") : null;
    if (!keyFromUrl) return;
    if (autoedFor.current === `saved:${keyFromUrl}`) return;
    autoedFor.current = `saved:${keyFromUrl}`;
    setSavedMode(true);
    setSavedKey(keyFromUrl);
    setReport(null);
    setError(null);
    setLoading("monthly");
    fetch(`/api/reports?key=${encodeURIComponent(keyFromUrl)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        const rep = d.report as ReportPayload;
        setReport(rep);
        setPeriod(rep.meta.period);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(null));
  }, [setPeriod]); // setPeriod is a stable useState setter from the page

  // Weekly / quarterly follow the account picker: switching accounts regenerates.
  const lastAccount = useRef(accountId);
  useEffect(() => {
    if (lastAccount.current === accountId) return;
    lastAccount.current = accountId;
    if (!savedMode && (period === "weekly" || period === "quarterly")) generate(period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const pick = (p: View) => {
    setError(null);
    if (p === "monthly" || p === "yearly" || p === "team") { setPeriod(p); setReport(null); }
    else { generate(p); }
  };

  // Saved archive report → render it read-only with the old ReportView.
  if (savedMode) {
    return (
      <div className="max-w-[1200px] mx-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-brand-light text-brand">Saved report</span>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:border-brand"><IconPrinter size={14} stroke={1.8} className="inline -mt-0.5 mr-1" />Export / Print</button>
            <a href="/dashboard/preview/reports/social" className="text-[12px] font-medium px-3 py-1.5 rounded-lg text-gray-500 hover:text-gray-900">← Back to Reports</a>
          </div>
        </div>
        {loading && <div className="flex justify-center py-16"><BrandLoader size={40} /></div>}
        {report && <ReportView report={report} regenerating={false} storageKey={savedKey ?? undefined} />}
        {error && <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-[13px] text-rose-800">{error}</div>}
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto">
      {/* Cadence switcher + print. Monthly = the full-format template report. */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {(["monthly", "weekly", "quarterly", "yearly", "team"] as View[]).map((p) => (
            <button
              key={p}
              onClick={() => pick(p)}
              disabled={loading === p}
              className={`text-[12px] font-medium px-3 py-1.5 rounded-lg border transition ${period === p ? "border-brand bg-brand text-white" : "border-gray-200 bg-white text-gray-700 hover:border-brand"} disabled:opacity-50`}
            >
              {loading === p ? "…" : p === "yearly" ? "Yearly report" : p === "team" ? "Team report" : PERIOD_META[p].title}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {(period === "monthly" || period === "yearly") && (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg bg-brand-light text-brand" title="The monthly report doesn't change with the account picker. Weekly and Quarterly follow it.">
              <IconBuilding size={14} stroke={1.8} />Company report · main GooCampus accounts
            </span>
          )}
          <button onClick={() => window.print()} className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:border-brand"><IconPrinter size={14} stroke={1.8} className="inline -mt-0.5 mr-1" />Export / Print</button>
        </div>
      </div>

      {period === "monthly" ? (
        <MonthlyReports />
      ) : period === "yearly" ? (
        <YearlyReports />
      ) : period === "team" ? (
        <TeamReports />
      ) : loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <BrandLoader size={40} />
          <div className="text-[13px] text-[#8A92A6] font-medium">Preparing your {period} report… (up to ~30s)</div>
        </div>
      ) : error ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-[13px] text-rose-800">Couldn&rsquo;t generate — {error}</div>
      ) : report ? (
        <ReportView report={report} regenerating={loading !== null} />
      ) : null}
    </div>
  );
}

// Every month from the first imported one to this month, newest first.
function allMonths(): string[] {
  const d = new Date();
  const out: string[] = [];
  for (let y = d.getFullYear(), m = d.getMonth() + 1; `${y}-${String(m).padStart(2, "0")}` >= HISTORY_FIRST; m === 1 ? (y--, m = 12) : m--) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

// Monthly: every month's report in a list on the left (as My Day lists tasks), the
// chosen one on the right. ?month=YYYY-MM keeps the choice in the link.
function MonthlyReports() {
  const months = allMonths();
  const [month, setMonth] = useState(months[0]);
  // Read ?month= after mount — the server render has no URL, and must match.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("month");
    if (q && allMonths().includes(q)) setMonth(q);
  }, []);
  const pick = (m: string) => {
    setMonth(m);
    const u = new URL(window.location.href);
    if (m === months[0]) u.searchParams.delete("month"); else u.searchParams.set("month", m);
    window.history.replaceState(null, "", u.toString());
  };
  const name = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 items-start">
      <aside className="bg-white border border-gray-100 rounded-2xl p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto print:hidden">
        <div className="text-[15px] font-semibold text-[#232D42] px-2 pt-1 pb-2.5">All reports</div>
        {months.map((m) => (
          <button key={m} onClick={() => pick(m)}
            className={`block w-full text-left px-3 py-2.5 rounded-xl text-[13.5px] mb-0.5 transition ${m === month ? "bg-brand-light text-[#2138B0] font-medium" : "text-[#232D42] hover:bg-[#F6F7FB]"}`}>
            {name(m)}
          </button>
        ))}
      </aside>
      {/* min-w-0: a wide table scrolls inside its card instead of widening the page */}
      <div className="min-w-0"><MonthlyReportView key={month} month={month} /></div>
    </div>
  );
}

// Yearly: every year in a list on the left, the chosen one on the right (?year=YYYY).
function YearlyReports() {
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - Number(HISTORY_FIRST.slice(0, 4)) + 1 }, (_, i) => String(thisYear - i));
  const [year, setYear] = useState(years[0]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("year");
    if (q && years.includes(q)) setYear(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pick = (y: string) => {
    setYear(y);
    const u = new URL(window.location.href);
    u.searchParams.delete("month");
    if (y === years[0]) u.searchParams.delete("year"); else u.searchParams.set("year", y);
    window.history.replaceState(null, "", u.toString());
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 items-start">
      <aside className="bg-white border border-gray-100 rounded-2xl p-3 lg:sticky lg:top-4 print:hidden">
        <div className="text-[15px] font-semibold text-[#232D42] px-2 pt-1 pb-2.5">All reports</div>
        {years.map((y) => (
          <button key={y} onClick={() => pick(y)}
            className={`block w-full text-left px-3 py-2.5 rounded-xl text-[13.5px] mb-0.5 transition ${y === year ? "bg-brand-light text-[#2138B0] font-medium" : "text-[#232D42] hover:bg-[#F6F7FB]"}`}>
            {y}
          </button>
        ))}
      </aside>
      <div className="min-w-0"><YearlyReportView key={year} year={year} /></div>
    </div>
  );
}
