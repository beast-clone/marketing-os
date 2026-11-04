"use client";

import { useEffect, useState } from "react";
import { IconSparkles, IconX, IconSearch, IconExternalLink, IconBan, IconPin, IconCheck, IconWorldSearch, IconBulb, IconCalendar, IconListDetails, IconArrowRight, IconCalendarSearch } from "@tabler/icons-react";
import type { Plan, PlanMove } from "@/lib/ai-planner";

// "Plan with AI" for the Content calendar (Praveen, 4 Nov 2026 —
// docs/ai-planner-prototype/v4.html). The calendar never changes on its own: the plan
// is shown beside it with an Original / AI plan switch, and only what the person
// applies is saved (through /api/post-planner/apply — approvals and history included).

export type { Plan, PlanMove };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const dm = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** The panel: runs the plan (with progress), then shows why & sources. */
export function AiPlanPanel({ open, onClose, plan, running, error, excluded, onToggle, onSeeCalendar }: {
  open: boolean; onClose: () => void; plan: Plan | null; running: boolean; error: string;
  excluded: Set<string>; onToggle: (id: string, on: boolean) => void; onSeeCalendar: () => void;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => { if (!running) return; setTick(0); const t = setInterval(() => setTick((n) => n + 1), 1600); return () => clearInterval(t); }, [running]);
  if (!open) return null;
  const steps = ["Reading each task's content", "Searching the web for what's timely for each Primary Interest", "Checking official notices and news, with sources", "Applying the rules: same week only, never before today"];
  const ok = plan?.moves.filter((m) => m.ok) || [];
  const bad = plan?.moves.filter((m) => !m.ok) || [];
  return (
    <div className="fixed inset-0 z-50 bg-[#232D42]/35 flex justify-end" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[560px] h-full bg-white flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 text-[16px] font-semibold text-[#232D42]"><IconSparkles size={18} className="text-[#6D4AE8]" />{plan ? "AI plan · why & sources" : "Plan with AI"}</div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#8A92A6] hover:bg-[#F6F7FB]" aria-label="Close"><IconX size={18} /></button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          {running ? (
            <div className="flex flex-col items-center gap-4 py-12 text-center">
              <div className="w-14 h-14 rounded-full border-[5px] border-[#6D4AE8]/15 border-t-[#6D4AE8] border-r-[#6D4AE8] animate-spin" />
              <div className="text-[13.5px] font-medium text-[#232D42]">Planning the next two weeks…</div>
              <div className="text-left text-[12.5px] text-[#4A5468] space-y-1.5">
                {steps.slice(0, Math.min(steps.length, tick + 1)).map((s, i) => (
                  <div key={s} className="flex items-center gap-2">{i < tick ? <IconCheck size={14} className="text-[#0F6E3C]" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-[#6D4AE8]/40 border-t-[#6D4AE8] animate-spin" />}{s}</div>
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="text-[13px] text-[#C03221] bg-[#FDECEC] rounded-xl px-4 py-3">{error}</div>
          ) : plan ? (
            <>
              <div className="flex items-center justify-between text-[12px] text-[#4A5468] bg-[#F6F7FB] rounded-xl px-3 py-2 mb-3 gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5"><span className="inline-flex items-center gap-1 bg-[#E8F6EE] text-[#0F6E3C] rounded-full px-2 py-0.5 font-semibold"><IconWorldSearch size={12} />Real web search</span>this run <b className="font-semibold text-[#232D42]">${plan.cost.toFixed(3)}</b></span>
                <span>{plan.tasks} tasks read · {plan.citations.length} sources</span>
              </div>
              <div className="bg-[#EFEAFE] rounded-xl px-4 py-3 mb-3">
                <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-[#3F2A9C] mb-1"><IconBulb size={15} />What&apos;s timely</div>
                <p className="text-[12.5px] text-[#3B4457] leading-relaxed m-0">{plan.summary}</p>
              </div>
              {plan.searches.length > 0 && <Head>What it searched — and found</Head>}
              {plan.searches.map((s, i) => (
                <div key={i} className="border border-gray-100 rounded-xl px-3 py-2 mb-1.5">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#3F2A9C]"><IconSearch size={13} />{s.query}</div>
                  <div className="text-[12px] text-[#4A5468] mt-0.5 leading-snug">{s.finding}</div>
                </div>
              ))}
              <Head>Moves in the AI plan ({ok.length}) — untick to leave one out</Head>
              {ok.length === 0 && <div className="text-[12.5px] text-[#8A92A6]">No moves — the calendar already fits what&apos;s timely.</div>}
              {ok.map((m) => (
                <label key={m.id} className="flex gap-2.5 items-start border border-gray-100 rounded-xl px-3 py-2.5 mb-2 cursor-pointer">
                  <input type="checkbox" className="mt-1 accent-[#6D4AE8]" checked={!excluded.has(m.id)} onChange={(e) => onToggle(m.id, e.target.checked)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[#232D42]">{m.title}</div>
                    <div className="flex items-center gap-1.5 text-[12.5px] mt-0.5"><span className="text-[#8A92A6] line-through">{dm(m.from)}</span><IconArrowRight size={13} /><span className="font-semibold text-[#6D4AE8]">{dm(m.to)}</span><span className="text-[#A6ACBE]">· {m.primaryInterest}</span></div>
                    <div className="text-[12px] text-[#4A5468] mt-1">{m.why}</div>
                    <Brief m={m} />
                  </div>
                </label>
              ))}
              {bad.length > 0 && <Head>Suggested by the AI but not allowed</Head>}
              {bad.map((m) => (
                <div key={m.id} className="flex gap-2.5 items-start border border-[#F5C9C3] bg-[#FDECEC] rounded-xl px-3 py-2.5 mb-2">
                  <IconBan size={15} className="text-[#C03221] mt-0.5 shrink-0" />
                  <div><div className="text-[13px] font-medium text-[#232D42]">{m.title}</div>
                    <div className="text-[12px] text-[#C03221] mt-0.5">AI wanted {dm(m.from)} → {dm(m.to)}. {m.blocked} It stays on {dm(m.from)}.</div></div>
                </div>
              ))}
              {plan.keep.length > 0 && <Head>Stays where it is</Head>}
              {plan.keep.map((k) => (
                <div key={k.id} className="flex gap-2.5 items-start border border-dashed border-gray-200 bg-[#FBFBFD] rounded-xl px-3 py-2 mb-1.5">
                  <IconPin size={14} className="text-[#8A92A6] mt-0.5 shrink-0" /><div><div className="text-[12.5px] font-medium text-[#232D42]">{k.title}</div><div className="text-[12px] text-[#4A5468]">{k.why}</div></div>
                </div>
              ))}
              {plan.citations.length > 0 && <Head>All {plan.citations.length} sources it used</Head>}
              <div className="flex flex-col gap-1">{plan.citations.map((u) => <Src key={u} u={u} long />)}</div>
              <div className="border border-gray-100 rounded-xl px-3 py-2.5 mt-4 text-[12px] text-[#4A5468] leading-relaxed">
                <b className="font-semibold text-[#232D42]">Rules the dashboard enforces</b> — not the AI: moves stay inside the task&apos;s own week (Mon–Sun) · never before today · nothing already scheduled, published or waiting for a date approval is touched{plan.skipped ? ` (${plan.skipped} left out for that)` : ""} · if you need admin approval for date changes, applying sends the moves to Approvals.
              </div>
            </>
          ) : null}
        </div>
        {plan && !running && (
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-100">
            <span className="text-[12.5px] text-[#8A92A6]">Nothing changes until you apply.</span>
            <button onClick={onSeeCalendar} className="inline-flex items-center gap-1.5 bg-[#6D4AE8] hover:brightness-95 text-white text-[13px] font-medium rounded-lg px-4 py-2"><IconCalendarSearch size={15} />See it on the calendar</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Head({ children }: { children: React.ReactNode }) {
  return <div className="text-[11.5px] font-semibold tracking-wider uppercase text-[#8A92A6] mt-4 mb-1.5">{children}</div>;
}
function Src({ u, long }: { u: string; long?: boolean }) {
  return <a href={u} target="_blank" rel="noopener noreferrer" className="text-[11.5px] text-brand hover:underline inline-flex items-center gap-1 truncate max-w-full"><IconExternalLink size={12} className="shrink-0" />{long ? `${host(u)} — ${u.replace(/^https?:\/\//, "").slice(0, 64)}` : host(u)}</a>;
}
export function Brief({ m, open }: { m: PlanMove; open?: boolean }) {
  return (
    <details className="mt-2 border border-gray-100 rounded-lg bg-[#FBFBFD] px-2.5 py-2" open={open} onClick={(e) => e.stopPropagation()}>
      <summary className="cursor-pointer text-[12px] font-semibold text-[#3F2A9C] list-none">Why it moves</summary>
      {([["The post", m.brief.about], ["What's happening", m.brief.now], [`Why ${dm(m.to)}`, m.brief.date], ["Knock-on", m.brief.effect]] as const).filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="text-[12px] text-[#3B4457] leading-snug mt-1.5"><span className="block text-[10.5px] font-semibold tracking-wider uppercase text-[#8A92A6]">{k}</span>{v}</div>
      ))}
      {m.sources.length > 0 && <div className="mt-1.5 flex flex-col gap-0.5"><span className="block text-[10.5px] font-semibold tracking-wider uppercase text-[#8A92A6]">Sources</span>{m.sources.map((u) => <Src key={u} u={u} />)}</div>}
    </details>
  );
}

/** The Original / AI plan switch, shown once a plan exists. */
export function AiPlanBar({ aiView, setAiView, count, onWhy, onApply, onDiscard, applying }: {
  aiView: boolean; setAiView: (v: boolean) => void; count: number; onWhy: () => void; onApply: () => void; onDiscard: () => void; applying: boolean;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap bg-white border border-[#D9CEFB] rounded-2xl px-4 py-2.5 mb-3">
      <div className="inline-flex bg-[#F6F7FB] border border-gray-100 rounded-xl p-[3px]">
        <button onClick={() => setAiView(false)} className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium ${!aiView ? "bg-white text-[#232D42] ring-1 ring-gray-100" : "text-[#4A5468]"}`}><IconCalendar size={14} />Original</button>
        <button onClick={() => setAiView(true)} className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium ${aiView ? "bg-[#6D4AE8] text-white" : "text-[#4A5468]"}`}><IconSparkles size={14} />AI plan <span className={`rounded-full px-1.5 text-[11.5px] ${aiView ? "bg-white/25" : "bg-[#EFEAFE] text-[#6D4AE8]"}`}>{count}</span></button>
      </div>
      <span className="text-[12.5px] text-[#8A92A6]">{aiView ? `Showing the AI's version · ${count} task${count === 1 ? "" : "s"} on a different day · not applied` : "Showing your calendar as it is"}</span>
      <span className="ml-auto flex gap-2">
        <button onClick={onWhy} className="inline-flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-[#4A5468] hover:border-brand hover:text-brand"><IconListDetails size={14} />Why &amp; sources</button>
        <button onClick={onApply} disabled={!count || applying} className="inline-flex items-center gap-1.5 bg-[#6D4AE8] text-white rounded-lg px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-40"><IconCheck size={14} />{applying ? "Applying…" : `Apply AI plan (${count})`}</button>
        <button onClick={onDiscard} className="inline-flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-[#4A5468] hover:border-[#C03221] hover:text-[#C03221]"><IconX size={14} />Discard</button>
      </span>
    </div>
  );
}
