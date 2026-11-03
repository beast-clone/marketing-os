"use client";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { LoadingBlock } from "@/components/LoadingBlock";
import { useApi } from "@/lib/use-api";
import type { RevenueReport, Payment } from "@/lib/revenue";
import {
  IconCurrencyRupee, IconReceipt, IconCalculator, IconChartBar, IconUsers, IconSourceCode, IconSchool,
  IconAlertTriangle, IconExternalLink, IconArrowUpRight, IconArrowDownRight,
} from "@tabler/icons-react";

// Sales Hub → Revenue. Programme revenue from the Sales Hub "Revenue Tracker" table
// (lib/revenue.ts). Nandu's comment on the Leads tracker: "Kindly please add revenue tracker".
export default function Page() {
  return (
    <PreviewDashboardShell active="sales" title="Revenue" subtitle="Programme revenue booked in the Sales Hub — by month, counsellor, source and programme." hideAccountPicker compact>
      {({ range }) => <Revenue from={range.from} to={range.to} />}
    </PreviewDashboardShell>
  );
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const short = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(n >= 1e6 ? 1 : 2)}L` : inr(n));
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
const dayLabel = (p: Payment) => (p.date ? new Date(`${p.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : `${monthLabel(p.month)} (no date)`);

function Card({ icon, title, sub, right, children }: { icon: React.ReactNode; title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-100 rounded-xl">
      <div className="flex items-start gap-3 px-4 py-3 border-b border-gray-100">
        <span className="w-8 h-8 rounded-lg bg-brand-light text-brand grid place-items-center flex-shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-medium text-[#232D42]">{title}</div>
          {sub && <div className="text-[12px] text-[#8A92A6] mt-0.5">{sub}</div>}
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Revenue({ from, to }: { from: string; to: string }) {
  const { data, error, isLoading } = useApi<RevenueReport & { error?: string }>(`/api/sales-ops/revenue?from=${from}&to=${to}`);
  if (error || data?.error) return <div className="bg-white border border-gray-100 rounded-xl p-6 text-[14px] text-rose-600">Couldn&apos;t load revenue: {error?.message || data?.error}</div>;
  if (!data) return <div className="bg-white border border-gray-100 rounded-xl p-6"><LoadingBlock label={isLoading ? "Reading the Revenue Tracker…" : undefined} /></div>;

  const { totals, previous } = data;
  const delta = previous.revenue ? ((totals.revenue - previous.revenue) / previous.revenue) * 100 : null;
  const missingInRange = totals.payments - totals.withAmount;
  const maxTrend = Math.max(1, ...data.trend.map((b) => b.revenue));

  return (
    <div className="preview-scope space-y-4">
      {/* The data gap first — until it's filled, every total here is understated. */}
      {data.needsAttention.length > 0 && (
        <a href="#needs" className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 hover:border-amber-300">
          <IconAlertTriangle size={17} stroke={1.8} className="flex-shrink-0 mt-px" />
          <span>
            <b className="font-medium">{data.needsAttention.length} payments in the Revenue Tracker have no amount or date</b>
            {missingInRange > 0 && <> — {missingInRange} of them in this period, so the total below is lower than what was actually booked</>}.
            {" "}Fill them in Airtable (list at the bottom) and this page updates within 10 minutes.
          </span>
        </a>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: <IconCurrencyRupee size={16} stroke={1.8} />, label: "Revenue booked", value: inr(totals.revenue),
            note: delta == null ? `previous period: ${inr(previous.revenue)}` : <span className={`inline-flex items-center gap-0.5 ${delta >= 0 ? "text-emerald-700" : "text-rose-600"}`}>{delta >= 0 ? <IconArrowUpRight size={13} /> : <IconArrowDownRight size={13} />}{Math.abs(delta).toFixed(0)}% vs previous {inr(previous.revenue)}</span> },
          { icon: <IconReceipt size={16} stroke={1.8} />, label: "Payments", value: String(totals.payments), note: `previous period: ${previous.payments}` },
          { icon: <IconAlertTriangle size={16} stroke={1.8} />, label: "With an amount", value: `${totals.withAmount} of ${totals.payments}`, note: missingInRange ? `${missingInRange} missing the amount` : "all filled in" },
          { icon: <IconCalculator size={16} stroke={1.8} />, label: "Average payment", value: totals.avg == null ? "—" : inr(totals.avg), note: "of payments with an amount" },
        ].map((k) => (
          <div key={k.label} className="bg-white border border-gray-100 rounded-xl px-4 py-3">
            <div className="flex items-center gap-1.5 text-[12px] text-[#8A92A6]">{k.icon}{k.label}</div>
            <div className="text-[22px] font-medium text-[#232D42] mt-1 tabular-nums">{k.value}</div>
            <div className="text-[12px] text-[#8A92A6] mt-0.5">{k.note}</div>
          </div>
        ))}
      </div>

      {/* Monthly trend */}
      <Card icon={<IconChartBar size={17} stroke={1.8} />} title="By month" sub="Last 12 months. Striped = payments logged that month with no amount filled in.">
        <div className="flex items-end gap-2 h-[180px]">
          {data.trend.map((b) => {
            const h = b.revenue ? Math.max(4, (b.revenue / maxTrend) * 150) : b.payments ? 18 : 2;
            return (
              <div key={b.key} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1" title={`${monthLabel(b.key)} · ${inr(b.revenue)} · ${b.payments} payment${b.payments === 1 ? "" : "s"}`}>
                <div className="text-[11px] text-[#4A5468] tabular-nums whitespace-nowrap">{b.revenue ? short(b.revenue) : b.payments ? "₹ ?" : ""}</div>
                <div className={`w-full max-w-[44px] rounded-t ${b.revenue ? "bg-brand" : b.payments ? "border border-dashed border-amber-300 bg-amber-50" : "bg-gray-100"}`} style={{ height: h }} />
                <div className="text-[11px] text-[#8A92A6] whitespace-nowrap">{monthLabel(b.key)}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {([
          ["By counsellor", <IconUsers key="c" size={17} stroke={1.8} />, data.byCounsellor, "Owner in the Revenue Tracker"],
          ["By lead source", <IconSourceCode key="s" size={17} stroke={1.8} />, data.bySource, "Where the lead came from"],
          ["By programme", <IconSchool key="p" size={17} stroke={1.8} />, data.byProgramme, "Primary Interest (split evenly if more than one)"],
        ] as const).map(([title, icon, rows, sub]) => {
          const max = Math.max(1, ...rows.map((r) => r.revenue));
          return (
            <Card key={title} icon={icon} title={title} sub={sub}>
              {rows.length === 0 ? <div className="text-[14px] text-[#8A92A6]">No payments in this period.</div> : (
                <ul className="space-y-2.5">
                  {rows.slice(0, 8).map((r) => (
                    <li key={r.key}>
                      <div className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="text-[#232D42] truncate">{r.key}</span>
                        <span className="text-[#232D42] tabular-nums whitespace-nowrap">{inr(r.revenue)} <span className="text-[#8A92A6]">· {r.payments}</span></span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 mt-1"><div className="h-full rounded-full bg-brand" style={{ width: `${(r.revenue / max) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      {/* Payments in range */}
      <Card icon={<IconReceipt size={17} stroke={1.8} />} title={`Payments in this period (${data.payments.length})`} sub="Newest first. Open takes you to the payment in Airtable.">
        {data.payments.length === 0 ? <div className="text-[14px] text-[#8A92A6]">No payments in this period.</div> : <PaymentTable rows={data.payments} />}
      </Card>

      {/* The gap */}
      <div id="needs">
        <Card icon={<IconAlertTriangle size={17} stroke={1.8} />} title={`Needs an amount or date (${data.needsAttention.length})`}
          sub="Every payment in the Revenue Tracker, any month, that's missing its amount or payment date. Open it in Airtable to fill it in.">
          {data.needsAttention.length === 0 ? <div className="text-[14px] text-[#8A92A6]">Nothing missing ✓</div> : <PaymentTable rows={data.needsAttention} showMissing />}
        </Card>
      </div>
    </div>
  );
}

function PaymentTable({ rows, showMissing }: { rows: (Payment & { missing?: ("amount" | "date")[] })[]; showMissing?: boolean }) {
  return (
    <div className="overflow-x-auto -mx-4 -mb-4">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left">
            <th className="px-4 py-2 font-normal">Client</th>
            <th className="px-4 py-2 font-normal">Date</th>
            <th className="px-4 py-2 font-normal text-right">Amount</th>
            <th className="px-4 py-2 font-normal">Counsellor</th>
            <th className="px-4 py-2 font-normal">Source</th>
            <th className="px-4 py-2 font-normal">Programme</th>
            {showMissing && <th className="px-4 py-2 font-normal">Missing</th>}
            <th className="px-4 py-2 font-normal" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-2 text-[#232D42]">{p.client}</td>
              <td className="px-4 py-2 whitespace-nowrap">{dayLabel(p)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-[#232D42]">{p.amount == null ? <span className="text-amber-700">—</span> : inr(p.amount)}</td>
              <td className="px-4 py-2">{p.owner}</td>
              <td className="px-4 py-2">{p.source}</td>
              <td className="px-4 py-2">{p.programmes.join(", ") || "—"}</td>
              {showMissing && (
                <td className="px-4 py-2">
                  <span className="flex gap-1">{p.missing?.map((m) => <span key={m} className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-medium">{m}</span>)}</span>
                </td>
              )}
              <td className="px-4 py-2 text-right whitespace-nowrap">
                <a href={p.airtableUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">Open <IconExternalLink size={13} stroke={1.8} /></a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
