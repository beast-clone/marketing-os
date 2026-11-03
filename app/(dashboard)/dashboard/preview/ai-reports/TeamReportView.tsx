"use client";
import { useEffect, useRef, useState } from "react";
import { type ManualSection } from "@/lib/report-manual";
import type { Person } from "@/lib/report-team";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { AddedSections, Loading, Section, Stats } from "./MonthlyReportView";
import { CopyTable } from "./YearlyReportView";

// Team and individual reports (lib/report-team.ts; plan docs/team-report-prototype/v1.html).
// The list on the left: Team, then each person under their role. A person's report is
// only their main role's work.
const ROLE: Record<Person["role"], string> = { writer: "Content writer", designer: "Graphic designer", editor: "Video editor" };
const ROLE_GROUP: [Person["role"], string][] = [["writer", "Content writers"], ["designer", "Graphic designers"], ["editor", "Video editors"]];
const UNIT: Record<Person["role"], string> = { writer: "Content approved", designer: "Designs delivered", editor: "Videos delivered" };
const monthName = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
// "Content writer 24 · Graphic designer 3", for the team table.
const extraText = (p: Person) => p.extra.map((e) => `${ROLE[e.role]} ${e.delivered}`).join(" · ") || "—";
const pct = (a: number, of: number) => (of ? `${Math.round((a / of) * 100)}%` : "—");
const days = (t: number | null) => (t == null ? "—" : `${t} day${t === 1 ? "" : "s"}`);
const dmy = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—");

function lastMonths(n: number) {
  const out: string[] = []; const d = new Date();
  for (let i = 0; i < n; i++) { out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); d.setDate(1); d.setMonth(d.getMonth() - 1); }
  return out;
}

export function TeamReports() {
  const months = lastMonths(12);
  const [month, setMonth] = useState(months[0]);
  const [who, setWho] = useState("team");
  const [data, setData] = useState<{ people: Person[]; all: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null); setErr(null);
    fetch(`/api/reports/team?month=${month}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then((j) => { setData(j); if (!j.all && j.people[0]) setWho(j.people[0].key); })
      .catch((e) => setErr((e as Error).message));
  }, [month]);

  const people = data?.people ?? [];
  const person = people.find((p) => p.key === who);
  const item = (key: string, label: string, initials: string) => (
    <button key={key} onClick={() => setWho(key)}
      className={`flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-xl text-[13.5px] mb-0.5 transition ${who === key ? "bg-brand-light text-[#2138B0] font-medium" : "text-[#232D42] hover:bg-[#F6F7FB]"}`}>
      <span className={`w-6 h-6 rounded-full grid place-items-center text-[10.5px] font-semibold flex-none ${who === key ? "bg-brand text-white" : "bg-[#EEF0F5] text-[#4A5468]"}`}>{initials}</span>{label}
    </button>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 items-start">
      <aside className="bg-white border border-gray-100 rounded-2xl p-3 lg:sticky lg:top-4 print:hidden">
        <div className="text-[15px] font-semibold text-[#232D42] px-2 pt-1 pb-2">Reports</div>
        {data?.all !== false && item("team", "Team", "T")}
        {ROLE_GROUP.map(([role, label]) => {
          const inRole = people.filter((p) => p.role === role);
          return inRole.length ? (
            <div key={role}>
              <div className="text-[11px] uppercase tracking-wide text-[#8A92A6] px-2 pt-3 pb-1.5">{label}</div>
              {inRole.map((p) => item(p.key, p.name, p.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()))}
            </div>
          ) : null;
        })}
      </aside>
      <div className="min-w-0">
        <article className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 md:p-8 space-y-9">
          <header className="border-b border-gray-100 pb-5 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-brand font-semibold mb-1">{person ? ROLE[person.role] : "Team performance"}</div>
              <h1 className="text-xl font-semibold text-[#232D42] tracking-tight">{person ? person.name : "Team report"} · {monthName(month)}</h1>
              <div className="text-[12.5px] text-gray-500 mt-1">{person ? `${ROLE[person.role]} work only` : "Everyone, side by side"} · {month === months[0] ? "this month to date" : "full month"}</div>
            </div>
            <PreviewSelect value={month} onChange={setMonth} ariaLabel="Month" options={months.map((m) => ({ value: m, label: monthName(m) }))} />
          </header>
          {err ? <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-[13px] text-rose-800">Couldn&rsquo;t load — {err}</div>
            : !data ? <Loading />
            : person ? <PersonReport key={`${month}~${person.key}`} p={person} month={month} />
            : <TeamReport key={month} people={people} month={month} />}
        </article>
      </div>
    </div>
  );
}

// "Add a section" notes for this report (stored per month and person / team).
function useNotes(key: string) {
  const [sections, set] = useState<ManualSection[] | null>(null);
  const ref = useRef<ManualSection[]>([]);
  useEffect(() => {
    fetch(`/api/reports/manual?month=${encodeURIComponent(key)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { ref.current = j?.fields?.sections ?? []; set(ref.current); })
      .catch(() => set([]));
  }, [key]);
  const save = () => { fetch("/api/reports/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: key, patch: { sections: ref.current } }) }).catch(() => {}); };
  const onChange = (next: ManualSection[], now = false) => { ref.current = next; set(next); if (now) save(); };
  return <AddedSections sections={sections ?? []} loaded={sections != null} onChange={onChange} onBlur={save} />;
}

function TeamReport({ people, month }: { people: Person[]; month: string }) {
  const notes = useNotes(`${month}~team`);
  const sum = (ps: Person[], k: "delivered" | "onTime" | "onTimeOf" | "sentBack" | "openNow" | "overdueNow") => ps.reduce((n, p) => n + p[k], 0);
  return (
    <>
      <div className="rounded-xl border px-4 py-2.5 text-[12.5px] bg-brand-light border-[#D5DBF8] text-[#2138B0]">
        Each person is counted for their own role only. Delivered = content approved (writers) or the design / video marked ready (designers, editors), once per task.
      </div>
      {notes}
      <Section title="Everyone" note="Open now and overdue now are as of today.">
        <CopyTable
          header={["Person", "Role", "Delivered", "On time", "Sent back", "Open now", "Overdue now", "Additional roles"]}
          rows={people.map((p) => [p.name, ROLE[p.role], p.delivered, pct(p.onTime, p.onTimeOf), p.sentBack, p.openNow, p.overdueNow, extraText(p)])}
          total={["Team", "", sum(people, "delivered"), pct(sum(people, "onTime"), sum(people, "onTimeOf")), sum(people, "sentBack"), sum(people, "openNow"), sum(people, "overdueNow"), ""]}
        />
      </Section>
      {ROLE_GROUP.map(([role, label]) => {
        const ps = people.filter((p) => p.role === role);
        if (!ps.length) return null;
        return (
          <Section key={role} title={label}>
            <CopyTable
              header={role === "writer" ? ["Person", "Approved", "Sent back", "Edits", "Tasks created"] : ["Person", role === "designer" ? "Designs" : "Videos", "On time", "Sent back", "Avg. turnaround", "Files uploaded"]}
              rows={ps.map((p) => role === "writer" ? [p.name, p.delivered, p.sentBack, p.edits, p.created] : [p.name, p.delivered, pct(p.onTime, p.onTimeOf), p.sentBack, days(p.turnaround), p.uploads])}
            />
          </Section>
        );
      })}
    </>
  );
}

function PersonReport({ p, month }: { p: Person; month: string }) {
  const notes = useNotes(`${month}~${p.key}`);
  const writer = p.role === "writer";
  return (
    <>
      {notes}
      <Section title="The month in numbers">
        <Stats items={writer ? [
          [UNIT[p.role], p.delivered], ["Sent back for changes", p.sentBack, p.delivered ? `${pct(p.sentBack, p.delivered)} of pieces` : undefined],
          ["Content edits", p.edits], ["Tasks created", p.created],
        ] : [
          [UNIT[p.role], p.delivered], ["On time", pct(p.onTime, p.onTimeOf), p.onTimeOf ? `${p.onTime} of ${p.onTimeOf} by their date` : undefined],
          ["Sent back", p.sentBack, "after delivery"], ["Avg. turnaround", days(p.turnaround), "from starting to ready"],
        ]} />
      </Section>
      {!writer && (
        <Section title="Right now">
          <Stats items={[["Files uploaded this month", p.uploads], ["Open now", p.openNow, "at this stage"], ["Overdue now", p.overdueNow]]} />
        </Section>
      )}
      <Section title="By type">
        <CopyTable
          header={writer ? ["Type", "Approved", "Sent back"] : ["Type", "Delivered", "On time", "Sent back", "Avg. turnaround"]}
          rows={p.byType.map((g) => writer ? [g.name, g.delivered, g.sentBack] : [g.name, g.delivered, pct(g.onTime, g.onTimeOf), g.sentBack, days(g.turnaround)])}
          total={writer ? ["Total", p.delivered, p.sentBack] : ["Total", p.delivered, pct(p.onTime, p.onTimeOf), p.sentBack, days(p.turnaround)]}
        />
      </Section>
      <Section title="By primary interest">
        <CopyTable header={["Primary interest", writer ? "Approved" : "Delivered", "Sent back"]} rows={p.bySbu.map((g) => [g.name, g.delivered, g.sentBack])} total={["Total", p.delivered, p.sentBack]} />
      </Section>
      {p.extra.length > 0 && (
        <Section title="Additional roles" note={`Work outside ${p.name.split(" ")[0]}'s main role (${ROLE[p.role].toLowerCase()}) — not counted in the numbers above.`}>
          <div className="space-y-5">
            <CopyTable
              header={["Role", "Delivered", "On time", "Sent back"]}
              rows={p.extra.map((e) => [ROLE[e.role], e.delivered, pct(e.onTime, e.onTimeOf), e.sentBack])}
            />
            {p.extra.map((e) => (
              <div key={e.role}>
                <div className="text-[12px] font-medium text-[#4A5468] mb-2">{ROLE[e.role]} · {e.delivered} {e.role === "writer" ? "approved" : "delivered"}</div>
                <CopyTable
                  header={["Task", "Type", "Primary interest", "Due", e.role === "writer" ? "Approved" : "Delivered", "On time", "Sent back"]}
                  rows={e.items.map((d) => [d.title, d.type, d.sbu, dmy(d.due), dmy(d.delivered), d.onTime == null ? "—" : d.onTime ? "Yes" : "Late", d.sentBack ? `${d.sentBack}×` : "—"])}
                />
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section title={writer ? "Pieces" : p.role === "designer" ? "Designs" : "Videos"} note="Everything delivered this month.">
        {p.items.length ? (
          <CopyTable
            header={["Task", "Type", "Primary interest", "Due", writer ? "Approved" : "Delivered", "On time", "Sent back"]}
            rows={p.items.map((d) => [d.title, d.type, d.sbu, dmy(d.due), dmy(d.delivered), d.onTime == null ? "—" : d.onTime ? "Yes" : "Late", d.sentBack ? `${d.sentBack}×` : "—"])}
          />
        ) : <div className="text-[13px] text-gray-400">Nothing delivered this month.</div>}
      </Section>
    </>
  );
}
