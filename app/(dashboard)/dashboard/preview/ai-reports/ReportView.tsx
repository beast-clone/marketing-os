"use client";
import { IconClock, IconHeart, IconMessageCircle, IconTrophy } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtDateShort, fmtDateTime } from "@/lib/date";

export type Period = "weekly" | "monthly" | "quarterly";

export type ReportPayload = {
  meta: {
    period: Period;
    label: string;
    account: string;
    dateRange: { from: string; to: string };
    generatedAt: string;
    latencyMs: number;
  };
  executiveSummary: string;
  highlights: { label: string; value: string; delta?: string; insight: string }[];
  contentMix: {
    totalPosts: number;
    byFormat: { format: string; count: number; avgReach: number; avgEng: number; erPct: number }[];
    insight: string;
  };
  topPosts: {
    rank: number; title: string; permalink: string; mediaUrl: string; type: string;
    timestamp: string; reach: number; likes: number; comments: number; engagementRate: number; whyItWorked: string;
  }[];
  followerGrowth: {
    gained: number; dailyAvg: number;
    bestDay: { date: string; gain: number } | null;
    worstDay: { date: string; gain: number } | null;
    insight: string;
  };
  reachOverview: { total: number; deltaPct: number; insight: string };
  engagementOverview: { total: number; deltaPct: number | null; engagementRatePct: number; insight: string };
  audienceInsights: {
    topCountries: { label: string; value: number }[];
    topCities: { label: string; value: number }[];
    ageBreakdown: { label: string; value: number }[];
    genderBreakdown: { label: string; value: number }[];
    insight: string;
  };
  bestTimes: { day: string; hour: number; followersOnline: number }[];
  recommendations: { title: string; why: string; action: string }[];
  postMetricsTable: {
    date: string; type: string; caption: string; mediaUrl?: string; permalink?: string;
    reach: number; likes: number; comments: number; saves: number; shares: number; erPct: number;
  }[];
  trend: { date: string; reach: number; engagement: number; newFollowers: number }[];
  leadsSales: {
    totals: { leads: number; contracts: number; revenue: number; conversionPct: number; firstActivityAvgHrs: number | null };
    paidLeads?: number;
    paidBySource?: { name: string; count: number }[];
    inflowByDay: { date: string; count: number }[];
    bySource: { name: string; count: number }[];
    byInterest: { name: string; count: number }[];
    byStatus: { name: string; count: number }[];
    counsellors: { name: string; assigned: number; contracts: number; revenue: number }[];
    revenueTrend: { month: string; revenue: number; contracts: number }[];
    insight: string;
  } | null;
};

export const PERIOD_META: Record<Period, { title: string; sub: string; icon: string }> = {
  weekly:    { title: "Weekly report",    sub: "Last 7 days · run every Monday",           icon: "📅" },
  monthly:   { title: "Monthly report",   sub: "Last 30 days · run on the 4th–5th",         icon: "📆" },
  quarterly: { title: "Quarterly report", sub: "Last 90 days · run on the 1st of the quarter", icon: "📊" },
};

function fmtHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-IN");
}

// "Wednesday, 16 Jul" — spell out the weekday so a non-expert instantly gets which day.
// The AI can return the date in a few shapes (ISO, "16 Jul", already-formatted), so
// parse defensively and fall back to the raw string rather than showing "Invalid Date".
function fmtDayLong(date: string): string {
  if (!date) return "—";
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00` : date;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
}

// `storageKey` turns on editing: the prose becomes text boxes and Save writes it
// back to that saved report. Reports read as final and get sent on, but a model
// wrote them and sometimes phrases a thing badly or misses context only a person
// has ("report needs edit access" — Maheen, 22 Sep). Without a key the report is
// read-only exactly as before — a freshly generated one has nowhere to save to yet.
export function ReportView({ report, regenerating, storageKey, onSaved }: {
  report: ReportPayload; regenerating: boolean; storageKey?: string; onSaved?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = Object.keys(drafts).length > 0;

  // One prose block. Reading shows the edited text the moment it is typed, so what
  // you see after Save is what you were already looking at.
  const prose = (path: string, value: string, className: string) => {
    const shown = drafts[path] ?? value;
    if (!editing) return <p className={className}>{shown}</p>;
    return (
      <textarea value={shown} rows={Math.min(10, Math.max(2, Math.ceil(shown.length / 90)))}
        onChange={(e) => setDrafts((d) => ({ ...d, [path]: e.target.value }))}
        className={`${className} w-full border border-brand/40 rounded-lg px-2.5 py-2 bg-[#FCFCFF] outline-none focus:border-brand resize-y`} />
    );
  };

  const save = async () => {
    if (!storageKey || !dirty) { setEditing(false); return; }
    setSaving(true); setSaveError(null);
    try {
      const r = await fetch("/api/reports", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ key: storageKey, edits: drafts }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setEditing(false);
      onSaved?.();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally { setSaving(false); }
  };

  const chartWidth = 720;
  const chartHeight = 140;
  // Posts table: 20 per page with Next/Prev instead of one long scroll.
  const POSTS_PER_PAGE = 20;
  const [postPage, setPostPage] = useState(0);
  const postPageCount = Math.max(1, Math.ceil(report.postMetricsTable.length / POSTS_PER_PAGE));
  const pagePosts = report.postMetricsTable.slice(postPage * POSTS_PER_PAGE, postPage * POSTS_PER_PAGE + POSTS_PER_PAGE);
  // Highlight the single best-reach post so it's easy to spot at a glance.
  const topReachIdx = report.postMetricsTable.length
    ? report.postMetricsTable.reduce((best, p, i, arr) => (p.reach > arr[best].reach ? i : best), 0)
    : -1;

  return (
    <article className={`bg-white border border-gray-200 rounded-2xl shadow-sm p-6 md:p-8 space-y-8 ${regenerating ? "opacity-70" : ""}`}>
      {/* Header */}
      <header className="border-b border-gray-100 pb-6">
        <div className="text-[11px] uppercase tracking-widest text-brand font-semibold mb-2">
          {report.meta.period === "weekly" ? "Weekly performance" : report.meta.period === "monthly" ? "Monthly performance" : "Quarterly performance"}
        </div>
        <h1 className="text-base font-medium text-[#232D42] tracking-tight leading-tight">
          {report.meta.label}
        </h1>
        <div className="text-[12.5px] text-gray-500 mt-1">
          @{report.meta.account} · Generated {fmtDateTime(report.meta.generatedAt)}
        </div>
        {storageKey && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {editing ? (
              <>
                <button onClick={save} disabled={saving}
                  className="h-8 px-3 rounded-lg bg-brand text-white text-[12.5px] font-medium disabled:opacity-50">
                  {saving ? "Saving…" : dirty ? "Save changes" : "Done"}
                </button>
                <button onClick={() => { setDrafts({}); setSaveError(null); setEditing(false); }} disabled={saving}
                  className="h-8 px-3 rounded-lg border border-gray-200 text-[12.5px] text-[#4A5468] disabled:opacity-50">
                  Discard
                </button>
                <span className="text-[12px] text-gray-500">Only the written parts can be changed — the numbers and charts are measurements.</span>
              </>
            ) : (
              <button onClick={() => setEditing(true)}
                className="h-8 px-3 rounded-lg border border-gray-200 text-[12.5px] text-[#4A5468] hover:border-brand hover:text-brand">
                Edit the wording
              </button>
            )}
            {saveError && <span className="text-[12px] text-rose-600">{saveError}</span>}
          </div>
        )}
      </header>

      {/* Executive summary */}
      {report.executiveSummary && (
        <section>
          <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-2">Executive summary</div>
          {prose("executiveSummary", report.executiveSummary, "text-[15px] text-gray-800 leading-relaxed")}
        </section>
      )}

      {/* Highlights */}
      <section>
        <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">Highlights</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {report.highlights.map((h, i) => (
            <div key={h.label} className="border border-gray-200 rounded-xl p-4">
              <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold">{h.label}</div>
              <div className="flex items-baseline gap-2 mt-1">
                <div className="text-[24px] font-semibold tabular-nums tracking-tight">{h.value}</div>
                {h.delta && (
                  <div className={`text-[12px] font-semibold ${h.delta.startsWith("-") || h.delta.startsWith("−") ? "text-rose-700" : "text-emerald-700"}`}>
                    {h.delta}
                  </div>
                )}
              </div>
              {(h.insight || editing) && <div className="mt-2">{prose(`highlights.${i}.insight`, h.insight, "text-[12px] text-gray-600 leading-snug")}</div>}
            </div>
          ))}
        </div>
      </section>

      {/* Performance trend — reach & engagement over the period */}
      {report.trend && report.trend.length > 1 && (
        <section>
          <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">Performance trend</div>
          <div className="border border-gray-200 rounded-xl p-4">
            <TrendLineChart data={report.trend} />
          </div>
        </section>
      )}

      {/* Content mix */}
      <section>
        <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">Content mix</div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.2fr] gap-5 items-start">
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-widest">Format</th>
                  <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-widest">Posts</th>
                  <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-widest">Avg reach</th>
                  <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-widest">ER</th>
                </tr>
              </thead>
              <tbody>
                {report.contentMix.byFormat.map((f) => (
                  <tr key={f.format} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium text-gray-900">{f.format}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{f.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(f.avgReach)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{f.erPct}%</td>
                  </tr>
                ))}
                <tr className="border-t border-gray-100 bg-gray-50">
                  <td className="px-3 py-2 font-semibold text-gray-900">Total</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{report.contentMix.totalPosts}</td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tbody>
            </table>
          </div>
          {report.contentMix.insight && (
            <div className="border border-brand/30 bg-brand/5 rounded-xl p-4">
              <div className="text-xs uppercase tracking-widest text-brand font-semibold mb-2">Read on the mix</div>
              {prose("contentMix.insight", report.contentMix.insight, "text-[13px] text-gray-800 leading-relaxed")}
            </div>
          )}
        </div>
      </section>

      {/* Top posts */}
      {report.topPosts.length > 0 && (
        <section>
          <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">Top 5 posts by reach</div>
          <div className="space-y-3">
            {report.topPosts.map((p) => (
              <a
                key={p.rank}
                href={p.permalink}
                target="_blank"
                rel="noreferrer"
                className="grid grid-cols-[36px_88px_1fr_auto] items-center gap-4 border border-gray-200 rounded-xl p-3 hover:border-brand transition"
              >
                <div className="text-[22px] font-semibold tabular-nums text-gray-300 text-center">{p.rank}</div>
                <div className="aspect-[4/5] rounded-md bg-gray-100 overflow-hidden">
                  {p.mediaUrl ? <img src={p.mediaUrl} alt="" className="w-full h-full object-contain" loading="lazy" decoding="async" /> : <div className="w-full h-full flex items-center justify-center text-2xl text-gray-300">▢</div>}
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold">
                    {p.type === "REEL" ? "Reel" : p.type === "CAROUSEL_ALBUM" ? "Carousel" : "Static"} · {fmtDateShort(p.timestamp)}
                  </div>
                  <div className="text-[13.5px] font-medium text-gray-900 leading-snug mt-0.5 line-clamp-2">{p.title}</div>
                  {p.whyItWorked && <div className="text-[12px] text-gray-600 mt-1 leading-snug italic">Why it worked: {p.whyItWorked}</div>}
                </div>
                <div className="text-right text-[12px] text-gray-700 tabular-nums whitespace-nowrap">
                  <div><b>{fmtNum(p.reach)}</b> reach</div>
                  <div className="text-gray-500">{fmtNum(p.likes)} <IconHeart size={12} stroke={1.8} className="inline -mt-0.5" />· {fmtNum(p.comments)} <IconMessageCircle size={12} stroke={1.8} className="inline -mt-0.5" /></div>
                  <div className="text-gray-500">{p.engagementRate}% ER</div>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Follower growth */}
      <section>
        <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">Follower growth</div>
        <div className="text-[12px] text-gray-500 mb-3">How many new people followed you — and which single day pulled the most.</div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.2fr] gap-5 items-stretch">
          <div className="border border-gray-200 rounded-xl p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <MiniFact big={`+${fmtNum(report.followerGrowth.gained)}`} lbl="New followers this period" />
              <MiniFact big={`+${report.followerGrowth.dailyAvg}`} lbl="Average per day" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Best day — the single day that gained the most followers */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-bold">● Best day</div>
                <div className="text-2xl font-semibold text-emerald-700 tabular-nums mt-1 leading-none">+{fmtNum(report.followerGrowth.bestDay?.gain || 0)}</div>
                <div className="text-[12.5px] font-medium text-[#232D42] mt-1.5">{report.followerGrowth.bestDay ? fmtDayLong(report.followerGrowth.bestDay.date) : "—"}</div>
                <div className="text-[11px] text-emerald-700/80 mt-0.5">most new followers in one day</div>
              </div>
              {/* Slowest day — fewest followers gained */}
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="text-[10px] uppercase tracking-wide text-gray-500 font-bold">● Slowest day</div>
                <div className={`text-2xl font-semibold tabular-nums mt-1 leading-none ${(report.followerGrowth.worstDay?.gain ?? 0) < 0 ? "text-rose-600" : "text-gray-600"}`}>{(report.followerGrowth.worstDay?.gain ?? 0) >= 0 ? "+" : ""}{fmtNum(report.followerGrowth.worstDay?.gain ?? 0)}</div>
                <div className="text-[12.5px] font-medium text-[#232D42] mt-1.5">{report.followerGrowth.worstDay ? fmtDayLong(report.followerGrowth.worstDay.date) : "—"}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">fewest new followers in one day</div>
              </div>
            </div>
          </div>
          {report.followerGrowth.insight && (
            <div className="border border-brand/30 bg-brand/5 rounded-xl p-4">
              <div className="text-xs uppercase tracking-widest text-brand font-semibold mb-2">What this means</div>
              {prose("followerGrowth.insight", report.followerGrowth.insight, "text-[13px] text-gray-800 leading-relaxed")}
            </div>
          )}
        </div>
      </section>

      {/* Reach + Engagement side-by-side */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TwoLineCard title="Reach" value={fmtNum(report.reachOverview.total)} delta={report.reachOverview.deltaPct}
          insight={prose("reachOverview.insight", report.reachOverview.insight, "text-[12.5px] text-gray-700 leading-snug")} />
        <TwoLineCard title="Engagement" value={fmtNum(report.engagementOverview.total)} delta={report.engagementOverview.deltaPct}
          insight={prose("engagementOverview.insight", report.engagementOverview.insight, "text-[12.5px] text-gray-700 leading-snug")}
          extra={`Engagement rate: ${report.engagementOverview.engagementRatePct}%`} />
      </section>

      {/* Leads & sales — from the Sales Hub CRM for the same window */}
      {report.leadsSales && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Leads &amp; sales</div>
            <div className="text-xs text-gray-400">Sales Hub CRM · same date range</div>
          </div>

          {/* Top-line numbers */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <LeadStat big={fmtNum(report.leadsSales.totals.leads)} lbl="Leads collected" />
            <LeadStat big={fmtNum(report.leadsSales.totals.contracts)} lbl="Contracts closed" />
            <LeadStat big={`${report.leadsSales.totals.conversionPct}%`} lbl="Lead → contract" accent />
            <LeadStat big={`₹${fmtNum(report.leadsSales.totals.revenue)}`} lbl="Revenue" />
          </div>

          {report.leadsSales.totals.firstActivityAvgHrs != null && (
            <div className="mb-4 flex items-start gap-2 text-[12px] text-gray-600 bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5">
              <span><IconClock size={14} stroke={1.8} className="inline -mt-0.5" /></span>
              <span>
                <b className="text-[#232D42]">Avg first response: {report.leadsSales.totals.firstActivityAvgHrs} hrs</b>
                {" "}(~{Math.round((report.leadsSales.totals.firstActivityAvgHrs / 24) * 10) / 10} days) —
                the average time a new DM lead waited before anyone replied, across this {report.meta.period === "weekly" ? "week" : report.meta.period === "quarterly" ? "quarter" : "month"}. Lower is better.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Leads inflow chart */}
            {report.leadsSales.inflowByDay.length > 1 && (
              <div className="border border-gray-200 rounded-xl p-4">
                <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">Leads inflow</div>
                <VBars data={report.leadsSales.inflowByDay.map((d) => ({ label: d.date, value: d.count }))} color="#3A57E8" />
              </div>
            )}
            {/* Revenue trend (last 6 months) */}
            {report.leadsSales.revenueTrend.length > 0 && (
              <div className="border border-gray-200 rounded-xl p-4">
                <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">Revenue trend · last 6 months</div>
                <VBars
                  data={report.leadsSales.revenueTrend.map((m) => ({ label: m.month, value: m.revenue }))}
                  color="#059669"
                  fmt={(v) => `₹${fmtNum(v)}`}
                  labelFmt={(m) => new Date(m + "-01").toLocaleDateString("en-IN", { month: "short" })}
                />
              </div>
            )}
          </div>

          {/* Counsellor performance table */}
          {report.leadsSales.counsellors.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden mt-4">
              <table className="w-full text-[12.5px]">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-widest">Counsellor</th>
                    <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-widest">Assigned</th>
                    <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-widest">Contracts</th>
                    <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-widest">Conv.</th>
                    <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-widest">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {report.leadsSales.counsellors.map((c) => (
                    <tr key={c.name} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-medium text-gray-900">{c.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(c.assigned)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(c.contracts)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{c.assigned > 0 ? Math.round((c.contracts / c.assigned) * 100) : 0}%</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">₹{fmtNum(c.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Lead source split */}
          {report.leadsSales.bySource.length > 0 && (
            <div className="mt-4 border border-gray-200 rounded-xl p-4">
              <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">Where leads came from</div>
              <div className="text-[12px] text-gray-500 mb-3">Share of leads by source — organic / DM only (paid ads excluded).</div>
              <PercentBars data={report.leadsSales.bySource} color="#3A57E8" />
            </div>
          )}

          {/* Paid ads — counted separately from the organic/DM numbers */}
          {(report.leadsSales.paidLeads || 0) > 0 && (
            <div className="mt-4 border border-amber-200 bg-amber-50/40 rounded-xl p-4">
              <div className="text-xs uppercase tracking-widest text-amber-800 font-semibold mb-1">Paid ads — counted separately</div>
              <div className="text-[12px] text-amber-800/80 mb-3">
                <b>{fmtNum(report.leadsSales.paidLeads || 0)} leads</b> from paid marketing — <b>not</b> included in the organic / DM numbers above.
              </div>
              {report.leadsSales.paidBySource && report.leadsSales.paidBySource.length > 0 && (
                <PercentBars data={report.leadsSales.paidBySource} color="#B45309" />
              )}
            </div>
          )}

          {report.leadsSales.insight && (
            <div className="mt-4 border border-brand/30 bg-brand/5 rounded-xl p-4">
              <div className="text-xs uppercase tracking-widest text-brand font-semibold mb-2">Read on leads &amp; sales</div>
              {prose("leadsSales.insight", report.leadsSales.insight, "text-[13px] text-gray-800 leading-relaxed")}
            </div>
          )}
        </section>
      )}

      {/* Audience */}
      {(report.audienceInsights.topCountries.length > 0 || report.audienceInsights.topCities.length > 0) && (
        <section>
          <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">Who you reached</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {report.audienceInsights.topCountries.length > 0 && (
              <div className="border border-gray-200 rounded-xl p-4">
                <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-2">Top countries</div>
                <div className="space-y-1.5 text-[12.5px]">
                  {report.audienceInsights.topCountries.slice(0, 5).map((c) => (
                    <div key={c.label} className="flex items-baseline justify-between">
                      <span>{c.label}</span><span className="tabular-nums text-gray-500">{fmtNum(c.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {report.audienceInsights.topCities.length > 0 && (
              <div className="border border-gray-200 rounded-xl p-4">
                <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-2">Top cities</div>
                <div className="space-y-1.5 text-[12.5px]">
                  {report.audienceInsights.topCities.slice(0, 5).map((c) => (
                    <div key={c.label} className="flex items-baseline justify-between">
                      <span>{c.label}</span><span className="tabular-nums text-gray-500">{fmtNum(c.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {report.audienceInsights.insight && (
            <div className="mt-3 border border-brand/30 bg-brand/5 rounded-xl p-4">
              <div className="text-xs uppercase tracking-widest text-brand font-semibold mb-2">Read on audience</div>
              {prose("audienceInsights.insight", report.audienceInsights.insight, "text-[13px] text-gray-800 leading-relaxed")}
            </div>
          )}
        </section>
      )}

      {/* Metrics table */}
      {report.postMetricsTable.length > 0 && (
        <section>
          <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">All posts in this range</div>
          {/* How many of each type we posted — on top, then the breakdown */}
          <div className="flex items-center gap-2.5 flex-wrap mb-4">
            {report.contentMix.byFormat.map((f) => (
              <span key={f.format} className="text-[14px] font-medium px-4 py-2 rounded-xl bg-gray-100 text-[#232D42]">{f.format} · <b className="tabular-nums text-[15px]">{f.count}</b></span>
            ))}
            <span className="text-[14px] font-medium px-4 py-2 rounded-xl bg-brand-light text-brand">Total · <b className="tabular-nums text-[15px]">{report.contentMix.totalPosts}</b></span>
          </div>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-gray-50 text-xs uppercase tracking-widest text-gray-500 font-semibold">
                  <tr>
                    <th className="text-left px-3 py-2">Post</th>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-right px-3 py-2">Reach</th>
                    <th className="text-right px-3 py-2">Likes</th>
                    <th className="text-right px-3 py-2">Comm.</th>
                    <th className="text-right px-3 py-2">Saves</th>
                    <th className="text-right px-3 py-2">Shares</th>
                    <th className="text-right px-3 py-2">ER</th>
                  </tr>
                </thead>
                <tbody>
                  {pagePosts.map((p, i) => {
                    const isTop = postPage * POSTS_PER_PAGE + i === topReachIdx;
                    return (
                    <tr key={i} className={`border-t border-gray-100 ${isTop ? "bg-emerald-50/70" : "hover:bg-gray-50"}`}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0 border ${isTop ? "border-emerald-300" : "border-gray-100"}`}>
                            {p.mediaUrl
                              ? <img src={p.mediaUrl} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                              : <div className="w-full h-full flex items-center justify-center text-gray-300">▢</div>}
                          </div>
                          <div className="min-w-0">
                            {isTop && <span className="inline-block text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5 mb-1"><IconTrophy size={11} stroke={2} className="inline -mt-0.5 mr-0.5" />Best reach</span>}
                            <div className="max-w-[460px] text-[12.5px] text-[#232D42] line-clamp-2 leading-snug" title={p.caption}>{p.caption}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums whitespace-nowrap text-gray-500">{fmtDateShort(p.date)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{p.type}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${isTop ? "font-semibold text-emerald-700" : ""}`}>{fmtNum(p.reach)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(p.likes)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(p.comments)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(p.saves)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(p.shares)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.erPct}%</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {postPageCount > 1 && (
            <div className="flex items-center justify-between mt-3 text-[12px] text-gray-500 flex-wrap gap-2">
              <span>Showing {postPage * POSTS_PER_PAGE + 1}–{Math.min((postPage + 1) * POSTS_PER_PAGE, report.postMetricsTable.length)} of {report.postMetricsTable.length} posts</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPostPage((p) => Math.max(0, p - 1))} disabled={postPage === 0} className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:border-brand disabled:opacity-40 disabled:cursor-not-allowed">← Prev</button>
                <span className="tabular-nums text-gray-700">Page {postPage + 1} / {postPageCount}</span>
                <button onClick={() => setPostPage((p) => Math.min(postPageCount - 1, p + 1))} disabled={postPage >= postPageCount - 1} className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:border-brand disabled:opacity-40 disabled:cursor-not-allowed">Next →</button>
              </div>
            </div>
          )}
        </section>
      )}

      <footer className="pt-6 border-t border-gray-100 text-[11px] text-gray-400 italic">
        Live data from Meta&rsquo;s Instagram Graph API for @{report.meta.account}. AI prose written by Perplexity from the pre-computed numbers above.
      </footer>
    </article>
  );
}

function MiniFact({ big, lbl }: { big: string; lbl: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2">
      <div className="text-[18px] font-semibold tabular-nums leading-none">{big}</div>
      <div className="text-xs uppercase tracking-widest text-gray-500 mt-1 leading-tight">{lbl}</div>
    </div>
  );
}

function TwoLineCard({ title, value, delta, insight, extra }: { title: string; value: string; delta: number | null; insight: React.ReactNode; extra?: string }) {
  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold">{title}</div>
      <div className="flex items-baseline gap-2 mt-1">
        <div className="text-[24px] font-semibold tabular-nums tracking-tight">{value}</div>
        {delta != null && (
          <div className={`text-[12px] font-semibold ${delta < 0 ? "text-rose-700" : "text-emerald-700"}`}>
            {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
          </div>
        )}
      </div>
      {extra && <div className="text-[11.5px] text-gray-500 mt-1">{extra}</div>}
      {insight && <div className="text-[12.5px] text-gray-700 mt-2 leading-snug">{insight}</div>}
    </div>
  );
}

function LeadStat({ big, lbl, accent }: { big: string; lbl: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl p-4 border ${accent ? "border-brand/30 bg-brand/5" : "border-gray-200"}`}>
      <div className={`text-[22px] font-semibold tabular-nums tracking-tight ${accent ? "text-brand" : "text-gray-900"}`}>{big}</div>
      <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mt-1">{lbl}</div>
    </div>
  );
}

// Smooth a series of points into a flowing cubic-bezier path (Catmull-Rom).
function smoothLine(pts: [number, number][]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const d = [`M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(`C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`);
  }
  return d.join(" ");
}

// Performance-trend chart. Reach and engagement live on very different scales, so
// instead of overlapping two lines (where one hides the other), you TOGGLE between
// them. Each is drawn as a single smooth, gradient-filled curve zoomed to its own
// min→max band so day-to-day movement and spikes are clearly visible.
function TrendLineChart({ data }: { data: { date: string; reach: number; engagement: number; newFollowers: number }[] }) {
  const [metric, setMetric] = useState<"reach" | "engagement">("reach");
  const W = 720, H = 190, PL = 8, PR = 8, PT = 16, PB = 24;
  const n = data.length;
  const color = metric === "reach" ? "#3A57E8" : "#059669";
  const label = metric === "reach" ? "Reach" : "Engagement";

  const vals = data.map((d) => d[metric]);
  const dataMax = Math.max(1, ...vals);
  const dataMin = Math.min(...vals);
  const peakIdx = vals.reduce((best, v, i) => (v > vals[best] ? i : best), 0);
  // Zoom the vertical axis to the data band (with headroom) so the shape stands out.
  const pad = (dataMax - dataMin) * 0.15 || dataMax * 0.1 || 1;
  const lo = Math.max(0, dataMin - pad), hi = dataMax + pad;
  const x = (i: number) => PL + (i / Math.max(1, n - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - PT - PB);
  const pts: [number, number][] = data.map((d, i) => [x(i), y(d[metric])]);
  const line = smoothLine(pts);
  const baseY = H - PB;
  const area = pts.length > 1 ? `${line} L${x(n - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z` : "";
  const gid = `trendfill-${metric}`;

  const fmtDay = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const ticks = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        {/* Toggle: click to switch which metric the curve shows */}
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
          {(["reach", "engagement"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`text-[12px] font-medium px-3 py-1 rounded-md transition ${
                metric === m ? "bg-white text-[#232D42] shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {m === "reach" ? "Reach" : "Engagement"}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-gray-400 tabular-nums">
          Peak <b className="text-[#232D42]">{dataMax.toLocaleString("en-IN")}</b> on {fmtDay(data[peakIdx]?.date || "")}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.38} />
            <stop offset="60%" stopColor={color} stopOpacity={0.12} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={PL} x2={W - PR} y1={PT + g * (H - PT - PB)} y2={PT + g * (H - PT - PB)} stroke="#f1f1f4" strokeWidth={1} />
        ))}
        {area && <path d={area} fill={`url(#${gid})`} stroke="none" />}
        <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        {/* Peak marker */}
        {n > 1 && <circle cx={x(peakIdx)} cy={y(vals[peakIdx])} r={3.5} fill={color} stroke="#fff" strokeWidth={1.5} />}
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-gray-400" style={{ fontSize: 10 }}>
            {fmtDay(data[i].date)}
          </text>
        ))}
      </svg>
      <div className="text-xs text-gray-400 mt-1 italic">
        {label} over the period, zoomed to its own range so day-to-day movement is visible. Tap the other tab to switch.
      </div>
    </div>
  );
}

// Vertical bar chart for a time series (leads inflow, revenue by month).
function VBars({ data, color, fmt, labelFmt }: {
  data: { label: string; value: number }[];
  color: string;
  fmt?: (v: number) => string;
  labelFmt?: (l: string) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const peakIdx = data.reduce((best, d, i, arr) => (d.value > arr[best].value ? i : best), 0);
  const peak = data[peakIdx];
  // Cap the number of x-axis labels so dense day-series stay readable.
  const step = Math.max(1, Math.ceil(data.length / 6));
  const lbl = (l: string) => (labelFmt ? labelFmt(l) : new Date(l).toLocaleDateString("en-IN", { day: "numeric", month: "short" }));
  const val = (v: number) => (fmt ? fmt(v) : fmtNum(v));
  return (
    <div>
      <div className="flex items-stretch gap-[3px] h-[120px]">
        {data.map((d, i) => {
          const isPeak = i === peakIdx;
          return (
            <div key={i} className="flex-1 flex flex-col justify-end group relative">
              {/* Hover tooltip — day + exact count */}
              <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-1 -translate-y-full whitespace-nowrap rounded-md bg-[#232D42] text-white text-[10.5px] px-2 py-1 opacity-0 group-hover:opacity-100 transition z-10 shadow">
                {lbl(d.label)}: <b>{val(d.value)}</b>{isPeak ? " · best day" : ""}
              </div>
              <div className="rounded-t-sm transition-opacity group-hover:opacity-80" style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 2 : 0, background: isPeak ? "#10B981" : color }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5 text-xs text-gray-400 tabular-nums">
        {data.filter((_, i) => i % step === 0 || i === data.length - 1).map((d, i) => (
          <span key={i}>{lbl(d.label)}</span>
        ))}
      </div>
      <div className="text-[11px] text-gray-500 mt-1.5 flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
        Best day <b className="text-emerald-700">{val(peak.value)}</b> on {lbl(peak.label)} · hover any bar for its count
      </div>
    </div>
  );
}

// Horizontal ranked bars for a category split (lead sources).
// Lead-source split: full name on its own line (never truncated) + % share, with a
// thin under-bar. Percentages, not a big bar chart.
function PercentBars({ data, color }: { data: { name: string; count: number }[]; color: string }) {
  const total = Math.max(1, data.reduce((s, d) => s + d.count, 0));
  const sorted = [...data].sort((a, b) => b.count - a.count);
  return (
    <div className="space-y-3">
      {sorted.map((d) => {
        const pct = Math.round((d.count / total) * 100);
        return (
          <div key={d.name}>
            <div className="flex items-baseline justify-between gap-3 text-[12.5px] mb-1">
              <span className="text-[#232D42] break-words">{d.name}</span>
              <span className="tabular-nums whitespace-nowrap font-medium text-[#232D42]">{pct}%<span className="text-gray-400 font-normal"> · {fmtNum(d.count)}</span></span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RankBars({ data, color }: { data: { name: string; count: number }[]; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.name} className="grid grid-cols-[130px_1fr_48px] items-center gap-3 text-[12.5px]">
          <div className="truncate text-gray-900" title={d.name}>{d.name}</div>
          <div className="h-3 bg-gray-100 rounded overflow-hidden">
            <div className="h-full rounded" style={{ width: `${(d.count / max) * 100}%`, background: color }} />
          </div>
          <div className="text-right tabular-nums text-gray-500">{fmtNum(d.count)}</div>
        </div>
      ))}
    </div>
  );
}
