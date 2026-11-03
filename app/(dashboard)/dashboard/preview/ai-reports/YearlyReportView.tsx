"use client";
import { useEffect, useRef, useState } from "react";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { type ManualSection } from "@/lib/report-manual";
import type { YearMonth } from "@/lib/report-year";
import { AddedSections, Loading, Section, Stats } from "./MonthlyReportView";

// One year's report (lib/report-year.ts): what was made, by primary interest, month,
// type and owner, plus leads and platforms month by month. Every table has
// "Copy table" — rows and columns, ready to paste into a report section or a sheet.
type Tally = { name: string; tasks: number; published: number; types: Record<string, number> };
type Year = {
  year: string; years: string[];
  content: { total: number; published: number; from: string | null; to: string | null; bySbu: Tally[]; byType: Tally[]; byOwner: Tally[] };
  months: YearMonth[];
};

const monthShort = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
const day = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const show = (v: number | string | null | undefined) => (v == null || v === "" ? "—" : typeof v === "number" ? v.toLocaleString("en-IN") : v);
// L/K like the imported Notion figures ("9.91L", "40.1K").
const compact = (v: number | string | null | undefined) => {
  if (typeof v !== "number") return show(v);
  if (v >= 100_000) return `${(v / 100_000).toFixed(2).replace(/\.?0+$/, "")}L`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(v);
};
const SOURCE: Record<YearMonth["source"], string> = { copy: "", partial: "to date", notion: "Notion", none: "" };

export function YearlyReportView({ year }: { year: string }) {
  const [d, setD] = useState<Year | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sections, setSectionsState] = useState<ManualSection[] | null>(null);
  const ref = useRef<ManualSection[]>([]);

  useEffect(() => {
    setD(null); setErr(null); setSectionsState(null);
    fetch(`/api/reports/yearly?year=${year}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then((j) => setD(j as Year))
      .catch((e) => setErr((e as Error).message));
    fetch(`/api/reports/manual?month=${year}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { ref.current = j?.fields?.sections ?? []; setSectionsState(ref.current); })
      .catch(() => setSectionsState([]));
  }, [year]);

  const save = () => fetch("/api/reports/manual", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ month: year, patch: { sections: ref.current } }),
  }).catch(() => {});
  const setSections = (next: ManualSection[], saveNow = false) => { ref.current = next; setSectionsState(next); if (saveNow) save(); };

  const now = new Date().toISOString().slice(0, 7);
  const current = year === now.slice(0, 4);

  return (
    <article className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 md:p-8 space-y-9">
      <header className="border-b border-gray-100 pb-5">
        <div className="text-[11px] uppercase tracking-widest text-brand font-semibold mb-1">Yearly performance</div>
        <h1 className="text-xl font-semibold text-[#232D42] tracking-tight">{year} Yearly Report</h1>
        <div className="text-[12.5px] text-gray-500 mt-1">GooCampus · all channels · {current ? `Jan – ${monthShort(now)} (to date)` : "January – December"}</div>
      </header>

      {err ? <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-[13px] text-rose-800">Couldn&rsquo;t load — {err}</div>
        : !d ? <Loading /> : (
        <>
          <div className="rounded-xl border px-4 py-2.5 text-[12.5px] bg-brand-light border-[#D5DBF8] text-[#2138B0]">
            {d.content.total
              ? <>Content is counted from the Airtable Backup and the Master sheet — tasks dated {day(d.content.from!)} to {day(d.content.to!)}.{d.content.from! > `${year}-01-31` ? ` Earlier ${year} tasks are only in Airtable, so they aren't counted.` : ""}</>
              : <>No tasks dated {year} in the Airtable Backup or the Master sheet.</>}
          </div>

          <AddedSections sections={sections ?? []} loaded={sections != null} onChange={setSections} onBlur={save} />

          <Section title="The year in numbers">
            <Stats items={[
              ["Content made", d.content.total], ["Published", d.content.published],
              ...sumOf(d.months, "leads", "Leads"), ...sumOf(d.months, "organic", "Organic leads"),
            ]} />
          </Section>

          <Section title="Content by primary interest" note="Tasks, published, and the four biggest formats.">
            <TallyTable first="Primary interest" rows={d.content.bySbu} withTypes />
          </Section>

          <Section title="Content by month" note="Tasks dated in each month · leads from each month's saved report (all leads, and organic only).">
            <CopyTable
              header={["Month", "Tasks", "Published", "Leads", "Organic leads"]}
              rows={d.months.map((m) => [monthShort(m.month) + (SOURCE[m.source] ? ` · ${SOURCE[m.source]}` : ""), m.tasks, m.published, show(m.leads), show(m.organic)])}
              total={["Total", d.content.total, d.content.published, ...sumCells(d.months, ["leads", "organic"])]}
            />
          </Section>

          <div className="grid lg:grid-cols-2 gap-6">
            <Section title="Content by type"><TallyTable first="Type" rows={d.content.byType} /></Section>
            <Section title="Content by owner"><TallyTable first="Owner" rows={d.content.byOwner} /></Section>
          </div>

          <Section title="Platforms by month" note="From each month's saved report; months marked Notion come from the imported Notion report.">
            <CopyTable
              header={["Month", "IG followers", "IG reach", "YT subscribers", "YT views", "LinkedIn followers", "LinkedIn impressions"]}
              rows={d.months.map((m) => [monthShort(m.month) + (SOURCE[m.source] ? ` · ${SOURCE[m.source]}` : ""), show(m.igFollowers), compact(m.igReach), show(m.ytSubs), compact(m.ytViews), show(m.liFollowers), show(m.liImpressions)])}
            />
          </Section>
        </>
      )}
    </article>
  );
}

// "Leads" tile = the sum over months that have a number, saying which months when not all.
function sumOf(months: YearMonth[], key: "leads" | "organic", label: string): [string, number | string | null, string?][] {
  const have = months.filter((m) => typeof m[key] === "number" || (typeof m[key] === "string" && /\d/.test(m[key] as string)));
  if (!have.length) return [];
  const total = have.reduce((n, m) => n + Number(String(m[key]).replace(/,/g, "")), 0);
  const notion = have.filter((m) => m.source === "notion");
  const note = have.length < months.length ? `${monthShort(have[0].month).split(" ")[0]}–${monthShort(have[have.length - 1].month)}`
    : notion.length && notion.length < have.length ? `${monthShort(notion[notion.length - 1].month).split(" ")[0]} and before from Notion, then CRM estimate` : undefined;
  return [[label, total, note]];
}
function sumCells(months: YearMonth[], keys: ("leads" | "organic")[]) {
  return keys.map((k) => {
    const nums = months.map((m) => m[k]).filter((v) => v != null && /\d/.test(String(v))).map((v) => Number(String(v).replace(/,/g, "")));
    return nums.length ? nums.reduce((a, b) => a + b, 0).toLocaleString("en-IN") : "—";
  });
}

function TallyTable({ first, rows, withTypes }: { first: string; rows: Tally[]; withTypes?: boolean }) {
  const all = new Map<string, number>();
  for (const r of rows) for (const [t, n] of Object.entries(r.types)) all.set(t, (all.get(t) || 0) + n);
  const types = withTypes ? [...all.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t) : [];
  return (
    <CopyTable
      header={[first, "Tasks", "Published", ...types]}
      rows={rows.map((r) => [r.name, r.tasks, r.published, ...types.map((t) => r.types[t] || 0)])}
      total={["Total", rows.reduce((n, r) => n + r.tasks, 0), rows.reduce((n, r) => n + r.published, 0), ...types.map((t) => all.get(t) || 0)]}
    />
  );
}

export function CopyTable({ header, rows, total }: { header: string[]; rows: (string | number)[][]; total?: (string | number)[] }) {
  const [done, setDone] = useState(false);
  const fmt = (c: string | number) => (typeof c === "number" ? c.toLocaleString("en-IN") : c);
  const copy = async () => {
    const lines = [header, ...rows, ...(total ? [total] : [])].map((r) => r.map((c) => String(fmt(c)).replace(/[\t\n]+/g, " ")).join("\t")).join("\n");
    await navigator.clipboard.writeText(lines); setDone(true); setTimeout(() => setDone(false), 1800);
  };
  return (
    <div>
      <div className="flex justify-end mb-2">
        <button onClick={copy} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-gray-200 bg-white text-[12px] font-medium text-[#4A5468] hover:border-brand hover:text-brand print:hidden">
          {done ? <IconCheck size={14} stroke={2} className="text-emerald-600" /> : <IconCopy size={14} stroke={1.8} />}{done ? "Copied" : "Copy table"}
        </button>
      </div>
      <div className="border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-[12.5px] whitespace-nowrap">
          <thead className="bg-gray-50 text-gray-500">
            <tr>{header.map((h, i) => <th key={h} className={`px-3 py-2 font-semibold text-[11px] uppercase tracking-wide ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="border-t border-gray-100">
                {r.map((c, ci) => <td key={ci} className={`px-3 py-2 tabular-nums ${ci ? "text-right text-gray-600" : "text-left text-[#232D42]"}`}>{fmt(c)}</td>)}
              </tr>
            ))}
            {total && (
              <tr className="border-t border-gray-200 bg-brand-light/50 font-semibold text-[#232D42]">
                {total.map((c, ci) => <td key={ci} className={`px-3 py-2 tabular-nums ${ci ? "text-right" : "text-left"}`}>{fmt(c)}</td>)}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
