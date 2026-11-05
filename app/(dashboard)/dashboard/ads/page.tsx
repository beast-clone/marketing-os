"use client";
import { useEffect, useRef, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useApi } from "@/lib/use-api";
import { LiveIndicator } from "@/components/LiveIndicator";
import { MetricCard } from "@/components/MetricCard";
import { TrendChart } from "@/components/TrendChart";

type AdsTotals = {
  spend: number; impressions: number; reach: number; clicks: number;
  cpm: number; cpc: number; ctr: number; frequency: number;
  leads: number; messagingStarted: number; purchases: number;
  linkClicks: number; postEngagement: number;
  costPerLead: number; costPerMessage: number; costPerPurchase: number;
  roas: number;
};

type Campaign = AdsTotals & {
  campaign_id: string;
  campaign_name: string;
  daily_budget: number;      // 0 when Meta doesn't expose one (usually paused / very old campaigns)
  lifetime_budget: number;
  status: string;            // ACTIVE | PAUSED | DELETED | ARCHIVED
};
type DayCampaignSpend = { campaign_id: string; campaign_name: string; spend: number; reach: number; impressions: number; leads: number };
type Ad = AdsTotals & {
  ad_id: string; ad_name: string; adset_id: string; adset_name: string;
  creative_thumbnail: string | null; creative_body: string | null;
  creative_title: string | null; permalink: string | null;
};

type DaySummary = { date: string; spend: number; reach: number; impressions: number; leads: number };
type DayAd = { ad_id: string; ad_name: string; spend: number; reach: number; impressions: number; cpm: number; ctr: number; leads: number };

type AdsData = {
  account: { id: string; name: string };
  totals: AdsTotals;
  series: { date: string; spend: number; impressions: number; reach: number; clicks: number; cpm: number; ctr: number; leads: number }[];
  campaigns: Campaign[];
  daySummary?: DaySummary;
  activeAds?: DayAd[];
  yesterdayByCampaign?: DayCampaignSpend[];  // per-campaign spend for yesterday, feeds the new budget-vs-spend section
};

function fmtINR(n: number) {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function fmtNum(n: number) {
  return n.toLocaleString("en-IN");
}

function fmtDay(iso: string) {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

export default function AdsPage() {
  return (
    <DashboardShell title="Ads" hideAccountPicker>
      {({ range }) => <Ads range={range} />}
    </DashboardShell>
  );
}

function Ads({ range }: { range: { from: string; to: string } }) {
  const qs = new URLSearchParams({ from: range.from, to: range.to }).toString();
  const { data, error, isLoading, refresh } = useApi<AdsData>(`/api/ads?${qs}`);
  const loading = isLoading;
  const fetchData = () => refresh();
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const fetchStartRef = useRef<number>(0);
  useEffect(() => { if (isLoading) fetchStartRef.current = Date.now(); }, [isLoading]);
  useEffect(() => {
    if (data && !isLoading) { setFetchedAt(Date.now()); setLatencyMs(Date.now() - fetchStartRef.current); }
  }, [data, isLoading]);

  const live = <LiveIndicator fetchedAt={fetchedAt} latencyMs={latencyMs} loading={loading} onRefresh={fetchData} />;

  if (loading && !data) return <>{live}<div className="text-sm text-gray-500">Loading ads data…</div></>;
  if (error) return <>{live}<div className="text-sm text-red-600 bg-red-50 p-4 rounded-lg">Error: {error.message}</div></>;
  if (!data) return <>{live}<div className="text-sm text-gray-500">No data.</div></>;

  const hasLeads = data.totals.leads > 0;
  const hasMessages = data.totals.messagingStarted > 0;
  const hasPurchases = data.totals.purchases > 0;

  // 7-day average (excluding yesterday) so the yesterday-vs-average deltas are meaningful.
  // If the series is too short we simply don't render deltas — leaving raw numbers is clearer than
  // showing a wobbling one-day comparison.
  const priorSeries = data.series.slice(-8, -1);   // 7 days ending the day before yesterday
  const avg7 = priorSeries.length >= 3 ? {
    spend: priorSeries.reduce((s, x) => s + x.spend, 0) / priorSeries.length,
    reach: priorSeries.reduce((s, x) => s + x.reach, 0) / priorSeries.length,
    leads: priorSeries.reduce((s, x) => s + x.leads, 0) / priorSeries.length,
  } : null;

  return (
    <>
      {live}
      <div className="mb-4 text-xs text-gray-500">
        Ad account: <span className="font-medium text-gray-700">{data.account.name}</span> ({data.account.id})
      </div>

      {/* HEADLINE — Total daily budget vs yesterday's actual spend (with delta chip + sparkline).
          Only ACTIVE campaigns contribute to the budget number since paused campaigns don't burn. */}
      {data.daySummary && (
        <BudgetHero
          campaigns={data.campaigns}
          summary={data.daySummary}
          avg7={avg7}
          sparkline={data.series}
          hasLeads={hasLeads}
        />
      )}

      {/* PER-CAMPAIGN yesterday spend with individual budget-usage bars */}
      {data.yesterdayByCampaign && data.yesterdayByCampaign.length > 0 && (
        <div className="mt-4">
          <YesterdayCampaignSpend rows={data.yesterdayByCampaign} campaigns={data.campaigns} />
        </div>
      )}

      {/* Range totals */}
      <div className="mt-6">
        <div className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-2">Range totals</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <MetricCard label="Spend" value={fmtINR(data.totals.spend)} />
          <MetricCard label="Impressions" value={fmtNum(data.totals.impressions)} />
          <MetricCard label="Reach" value={fmtNum(data.totals.reach)} />
          <MetricCard label="Link Clicks" value={fmtNum(data.totals.linkClicks || data.totals.clicks)} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          {hasLeads && <MetricCard label="Leads" value={fmtNum(data.totals.leads)} />}
          {hasLeads && <MetricCard label="Cost / Lead" value={fmtINR(data.totals.costPerLead)} />}
          {hasMessages && <MetricCard label="Messages Started" value={fmtNum(data.totals.messagingStarted)} />}
          {hasMessages && <MetricCard label="Cost / Message" value={fmtINR(data.totals.costPerMessage)} />}
          {hasPurchases && <MetricCard label="Purchases" value={fmtNum(data.totals.purchases)} />}
          {hasPurchases && <MetricCard label="ROAS" value={data.totals.roas.toFixed(2) + "x"} />}
          {data.totals.postEngagement > 0 && <MetricCard label="Post Engagement" value={fmtNum(data.totals.postEngagement)} />}
          {!hasLeads && !hasMessages && !hasPurchases && (
            <div className="md:col-span-4 text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-3">
              No conversion data — campaigns may not have Pixel/Lead-form tracking configured for this range.
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <MetricCard label="CPM" value={fmtINR(data.totals.cpm)} />
          <MetricCard label="CPC" value={fmtINR(data.totals.cpc)} />
          <MetricCard label="CTR" value={data.totals.ctr.toFixed(2) + "%"} />
          <MetricCard label="Frequency" value={data.totals.frequency.toFixed(2)} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TrendChart title="Spend over time" data={data.series} dataKey="spend" />
          {hasLeads ? (
            <TrendChart title="Leads over time" data={data.series} dataKey="leads" />
          ) : (
            <TrendChart title="Impressions over time" data={data.series} dataKey="impressions" />
          )}
          <TrendChart title="Reach over time" data={data.series} dataKey="reach" />
          <TrendChart title="Clicks over time" data={data.series} dataKey="clicks" />
        </div>
      </div>

      {/* Breakdowns — where the spend & leads actually land (platform, placement, demographics, region) */}
      <AdBreakdowns range={range} showLeads={hasLeads} />

      {/* All campaigns — flat table with Category column + dropdown filter. Replaces the old
          grouped view; the classifyCampaign() logic is still what colors the Category chips. */}
      <div className="mt-6">
        <CampaignsTable
          campaigns={data.campaigns}
          onSelect={(c) => setSelectedCampaign(c)}
          showLeads={hasLeads}
        />
      </div>

      {selectedCampaign && (
        <CampaignDrilldown
          campaign={selectedCampaign}
          range={range}
          onClose={() => setSelectedCampaign(null)}
        />
      )}
    </>
  );
}

// Breakdowns — Meta insights split by platform, placement, age, gender, region.
// Fetched from its own endpoint so the main Ads page isn't slowed by the extra calls.
type BreakdownRow = { key: string; spend: number; impressions: number; reach: number; clicks: number; leads: number };
type Breakdowns = { platform: BreakdownRow[]; placement: BreakdownRow[]; age: BreakdownRow[]; gender: BreakdownRow[]; region: BreakdownRow[] };

function prettyPlatform(k: string) {
  return ({ instagram: "Instagram", facebook: "Facebook", audience_network: "Audience Network", messenger: "Messenger", unknown: "Unknown" } as Record<string, string>)[k] || k;
}
function prettyPlacement(k: string) {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function titleCase(k: string) {
  return k.charAt(0).toUpperCase() + k.slice(1);
}

function AdBreakdowns({ range, showLeads }: { range: { from: string; to: string }; showLeads: boolean }) {
  const qs = new URLSearchParams({ from: range.from, to: range.to }).toString();
  const { data } = useApi<Breakdowns>(`/api/ads/breakdowns?${qs}`);
  if (!data) return <div className="mt-6 text-xs text-gray-400">Loading breakdowns…</div>;

  const cards = [
    { title: "By platform", rows: data.platform, pretty: prettyPlatform },
    { title: "By placement", rows: data.placement, pretty: prettyPlacement },
    { title: "By age", rows: data.age, pretty: (k: string) => k },
    { title: "By gender", rows: data.gender, pretty: titleCase },
    { title: "Top regions", rows: data.region, pretty: (k: string) => k },
  ].filter((c) => (c.rows?.length ?? 0) > 0);
  if (cards.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-2">Where the spend &amp; leads land</div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {cards.map((c) => <BreakdownCard key={c.title} title={c.title} rows={c.rows} showLeads={showLeads} pretty={c.pretty} />)}
      </div>
    </div>
  );
}

function BreakdownCard({ title, rows, showLeads, pretty }: { title: string; rows: BreakdownRow[]; showLeads: boolean; pretty: (k: string) => string }) {
  const max = rows[0]?.spend || 1;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="text-sm font-medium mb-3">{title}</div>
      <div className="space-y-2.5">
        {rows.slice(0, 8).map((r) => (
          <div key={r.key}>
            <div className="flex items-center justify-between gap-2 text-[12px] mb-1">
              <span className="font-medium text-gray-700 truncate">{pretty(r.key)}</span>
              <span className="text-gray-500 tabular-nums whitespace-nowrap flex-shrink-0">
                {fmtINR(r.spend)}{showLeads && r.leads > 0 ? ` · ${fmtNum(r.leads)} leads` : ""}
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full" style={{ width: `${(r.spend / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// HEADLINE card — LEFT column: total daily budget + Meta's ~25% overspend cap (so the
// reader knows the maximum Meta will actually burn before pausing). RIGHT column:
// yesterday's ACCOUNT-TOTAL Spent / Reach / Leads stacked vertically, each labelled as
// a total across all active campaigns. Sparkline killed — didn't add signal.
//
// Meta doc: daily campaigns can spend up to ~25% over the daily budget on high-performing
// days, but the 7-day rolling total stays within 7× budget. See
// https://www.facebook.com/business/help/195560197672385
const OVERSPEND_CAP_PCT = 0.25;

function BudgetHero({
  campaigns, summary, hasLeads,
}: {
  campaigns: Campaign[];
  summary: DaySummary;
  avg7: { spend: number; reach: number; leads: number } | null;   // still accepted so callers don't need to change; unused visually now
  sparkline: { date: string; spend: number }[];                    // ditto — retained but not rendered
  hasLeads: boolean;
}) {
  const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE");
  const totalDailyBudget = activeCampaigns.reduce((s, c) => s + c.daily_budget, 0);
  const maxSpendCap = totalDailyBudget * (1 + OVERSPEND_CAP_PCT);
  const utilization = totalDailyBudget > 0 ? (summary.spend / totalDailyBudget) * 100 : null;
  const overBudget = utilization !== null && utilization >= 100;
  const utilizationClamped = utilization !== null ? Math.min(100, utilization) : null;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50 text-[11px] uppercase tracking-wide text-gray-500 font-medium">
        Daily budget vs yesterday&apos;s spend &middot; {fmtDay(summary.date)}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">
        {/* LEFT: budget context — total + max cap */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">Total daily budget</div>
            <div className="text-3xl font-bold text-gray-900 mt-1 tabular-nums">{fmtINR(totalDailyBudget)}</div>
            <div className="text-[11px] text-gray-500 mt-1">
              across {activeCampaigns.length} active campaign{activeCampaigns.length === 1 ? "" : "s"}
            </div>
          </div>

          {totalDailyBudget > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">Max spend cap</div>
              <div className="text-xl font-bold text-gray-700 mt-1 tabular-nums">{fmtINR(maxSpendCap)}</div>
              <div className="text-[11px] text-gray-500 mt-1 leading-snug">
                Meta may burn up to 25% over budget on a high-performing day before pausing.
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: yesterday's account-total performance, stacked vertically */}
        <div className="px-5 py-4 space-y-4">
          {/* Spent — with % of budget bar underneath so utilization is visible without a separate visual */}
          <div>
            <div className="flex items-baseline justify-between">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">Total spent yesterday</div>
              {utilization !== null && (
                <div className={`text-[11px] font-semibold tabular-nums ${overBudget ? "text-rose-600" : "text-emerald-600"}`}>
                  {utilization.toFixed(0)}% of budget
                </div>
              )}
            </div>
            <div className="text-3xl font-bold text-gray-900 mt-1 tabular-nums">{fmtINR(summary.spend)}</div>
            {utilizationClamped !== null && (
              <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${overBudget ? "bg-rose-500" : "bg-emerald-500"}`}
                  style={{ width: `${utilizationClamped}%` }}
                />
              </div>
            )}
          </div>

          {/* Reach — total across all active campaigns yesterday */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">Total reach yesterday</div>
            <div className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{fmtNum(summary.reach)}</div>
            <div className="text-[11px] text-gray-500 mt-0.5">unique accounts reached across all active campaigns</div>
          </div>

          {/* Leads — total across all active campaigns yesterday */}
          {hasLeads && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">Total leads yesterday</div>
              <div className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{fmtNum(summary.leads)}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">form submissions across all active campaigns</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Per-campaign spend for yesterday with individual daily-budget usage bars. Sorted by
// spend descending so the biggest spenders are on top. Includes a Category chip so the
// user can eyeball the theme mix at the same glance.
function YesterdayCampaignSpend({ rows, campaigns }: { rows: DayCampaignSpend[]; campaigns: Campaign[] }) {
  const budgetById = new Map(campaigns.map((c) => [c.campaign_id, c.daily_budget]));
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 text-sm font-medium">
        Individual campaign spend &middot; yesterday
        <span className="text-gray-400 font-normal"> ({rows.length} spent)</span>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map((r) => {
          const cat = classifyCampaign(r.campaign_name);
          const budget = budgetById.get(r.campaign_id) ?? 0;
          const usage = budget > 0 ? Math.min(100, (r.spend / budget) * 100) : null;
          const over = usage !== null && usage >= 100;
          return (
            <div key={r.campaign_id} className="px-5 py-2.5 grid grid-cols-12 items-center gap-3">
              <div className="col-span-6 min-w-0 flex items-center gap-2">
                <span className={`inline-block w-1.5 h-4 rounded-full ${cat.color} shrink-0`} />
                <span className="text-sm text-gray-900 truncate" title={r.campaign_name}>{r.campaign_name}</span>
                <span className="text-[10px] text-gray-400 shrink-0">{cat.emoji}</span>
              </div>
              <div className="col-span-2 text-right text-sm font-semibold tabular-nums text-gray-900">{fmtINR(r.spend)}</div>
              <div className="col-span-2 text-right text-[11px] text-gray-500 tabular-nums">
                {budget > 0 ? `of ${fmtINR(budget)}` : <span className="text-gray-300">no budget</span>}
              </div>
              <div className="col-span-2">
                {usage !== null ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${over ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${usage}%` }} />
                    </div>
                    <div className={`text-[10px] font-semibold tabular-nums w-8 text-right ${over ? "text-rose-600" : "text-gray-600"}`}>
                      {usage.toFixed(0)}%
                    </div>
                  </div>
                ) : (
                  <div className="h-1.5 bg-gray-50 rounded-full" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// [kept for reference — replaced by BudgetHero above] Old snapshot component.
function DailySnapshot({
  summary, ads, avg7, sparkline, hasLeads,
}: {
  summary: DaySummary;
  ads: DayAd[];
  avg7: { spend: number; reach: number; leads: number } | null;
  sparkline: { date: string; spend: number }[];
  hasLeads: boolean;
}) {
  const top3 = ads.slice(0, 3);
  const topSpend = top3[0]?.spend ?? 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900">Yesterday &middot; {fmtDay(summary.date)}</div>
          {avg7 && <div className="text-[11px] text-gray-500 mt-0.5">Compared with the 7-day average before that</div>}
        </div>
        <MiniSparkline data={sparkline.slice(-14)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-100">
        <DeltaStat label="Spent" value={fmtINR(summary.spend)} delta={avg7 ? pctDelta(summary.spend, avg7.spend) : null} lowerIsBetter />
        <DeltaStat label="Reached" value={fmtNum(summary.reach)} delta={avg7 ? pctDelta(summary.reach, avg7.reach) : null} />
        {hasLeads && <DeltaStat label="Leads" value={fmtNum(summary.leads)} delta={avg7 ? pctDelta(summary.leads, avg7.leads) : null} />}
        {!hasLeads && <DeltaStat label="Leads" value="—" delta={null} />}
      </div>

      {top3.length > 0 && (
        <div className="border-t border-gray-100 bg-gray-50/50">
          <div className="px-5 py-2.5 text-[10px] uppercase tracking-wide text-gray-500 font-medium">
            Top {top3.length} active ad{top3.length === 1 ? "" : "s"} yesterday
          </div>
          <div className="divide-y divide-gray-100 bg-white">
            {top3.map((ad) => (
              <div key={ad.ad_id} className="px-5 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-900 truncate" title={ad.ad_name}>{ad.ad_name}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {fmtNum(ad.reach)} reached &middot; {ad.ctr.toFixed(2)}% CTR
                    {ad.leads > 0 && <> &middot; {fmtNum(ad.leads)} leads</>}
                  </div>
                  <div className="h-1 bg-gray-100 rounded-full mt-1 overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full" style={{ width: topSpend > 0 ? `${(ad.spend / topSpend) * 100}%` : "0%" }} />
                  </div>
                </div>
                <div className="text-xs font-semibold text-gray-900 shrink-0">{fmtINR(ad.spend)}</div>
              </div>
            ))}
          </div>
          {ads.length > 3 && (
            <div className="px-5 py-2.5 text-[11px] text-gray-500 border-t border-gray-100">
              +{ads.length - 3} more ads spent yesterday — see the group tables above for the full breakdown.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function pctDelta(current: number, baseline: number): number | null {
  if (!baseline) return null;
  return ((current - baseline) / baseline) * 100;
}

function DeltaStat({ label, value, delta, lowerIsBetter }: { label: string; value: string; delta: number | null; lowerIsBetter?: boolean }) {
  const positive = delta !== null && delta > 0;
  const negative = delta !== null && delta < 0;
  const isGood = lowerIsBetter ? negative : positive;
  const isBad = lowerIsBetter ? positive : negative;
  return (
    <div className="px-5 py-4">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-0.5 tabular-nums">{value}</div>
      {delta !== null && Math.abs(delta) > 0.5 ? (
        <div className={`text-[11px] mt-1 flex items-center gap-1 ${isGood ? "text-emerald-600" : isBad ? "text-rose-600" : "text-gray-500"}`}>
          <span>{positive ? "▲" : "▼"}</span>
          <span>{Math.abs(delta).toFixed(1)}% vs 7-day avg</span>
        </div>
      ) : delta !== null ? (
        <div className="text-[11px] mt-1 text-gray-500">≈ same as 7-day avg</div>
      ) : (
        <div className="text-[11px] mt-1 text-gray-400">no baseline yet</div>
      )}
    </div>
  );
}

function MiniSparkline({ data }: { data: { date: string; spend: number }[] }) {
  if (data.length < 2) return null;
  const w = 120, h = 32, pad = 2;
  const max = Math.max(...data.map((d) => d.spend), 1);
  const min = Math.min(...data.map((d) => d.spend));
  const dx = (w - pad * 2) / (data.length - 1);
  const points = data.map((d, i) => {
    const x = pad + i * dx;
    const range = max - min || 1;
    const y = h - pad - ((d.spend - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="text-violet-500 shrink-0" aria-label="14-day spend trend">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" points={points} />
    </svg>
  );
}

// Auto-classify each campaign into a "primary interest" bucket based on keywords in
// its name. Order matters — the FIRST matching rule wins, so put more-specific rules
// higher. Tweak this table when you launch a new campaign theme.
type InterestKey = "amc_australia" | "university_masters" | "mbbs_ug" | "walk_in" | "als" | "samvaya" | "traffic_boost" | "other";
type InterestDef = { key: InterestKey; label: string; emoji: string; color: string; keywords: (string | RegExp)[] };

const INTERESTS: InterestDef[] = [
  { key: "amc_australia",       label: "Australia AMC Pathway",    emoji: "🇦🇺", color: "bg-red-500",     keywords: ["AMC", "AUS-PGCP", "AHPRA", /\bAustralia\b/i] },
  { key: "university_masters",  label: "University / Masters",     emoji: "🎓", color: "bg-violet-500",   keywords: ["University Programs", "Masters", "Post-Graduate", /\bPG\b/] },
  { key: "mbbs_ug",             label: "MBBS / Undergrad",         emoji: "📚", color: "bg-blue-500",     keywords: ["MBBS", /\bUG\b/, "Study Abroad"] },
  { key: "walk_in",             label: "Walk-in / Events",         emoji: "📍", color: "bg-amber-500",    keywords: ["Walk-in", "Walk in", "State-wise"] },
  { key: "als",                 label: "ALS Certification",        emoji: "❤️", color: "bg-rose-500",     keywords: ["ALS"] },
  { key: "samvaya",             label: "Samvaya Matrimony",        emoji: "💍", color: "bg-pink-500",     keywords: ["Samvaya", "Matrimony"] },
  { key: "traffic_boost",       label: "Traffic / Boosted Posts",  emoji: "📣", color: "bg-teal-500",     keywords: ["Traffic Ads", "Instagram post:", "Boosted"] },
];

function classifyCampaign(name: string): InterestDef {
  for (const def of INTERESTS) {
    for (const kw of def.keywords) {
      const matched = typeof kw === "string" ? name.toLowerCase().includes(kw.toLowerCase()) : kw.test(name);
      if (matched) return def;
    }
  }
  return { key: "other", label: "Other / Unclassified", emoji: "❓", color: "bg-gray-400", keywords: [] };
}

// Flat campaign table with a Category column and a Category filter dropdown at the top-right.
// Option A per product ask — cleaner than accordions or card grids: one table, one header row,
// coloured category chips inline. Trophy icon still marks the best performer overall.
function CampaignsTable({ campaigns, onSelect, showLeads }: { campaigns: Campaign[]; onSelect: (c: Campaign) => void; showLeads: boolean }) {
  const [categoryFilter, setCategoryFilter] = useState<InterestKey | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "ACTIVE" | "PAUSED">("all");

  const topId = campaigns.length > 0 ? campaigns
    .filter((c) => showLeads ? c.leads > 0 : c.impressions > 1000)
    .sort((a, b) => showLeads ? a.costPerLead - b.costPerLead : b.ctr - a.ctr)[0]?.campaign_id : null;

  // Categories that appear in this data — populates the dropdown so we don't show empty options.
  const presentCategories = new Set(campaigns.map((c) => classifyCampaign(c.campaign_name).key));
  const orderedInterests = INTERESTS.filter((i) => presentCategories.has(i.key));

  const filtered = campaigns.filter((c) => {
    if (categoryFilter !== "all" && classifyCampaign(c.campaign_name).key !== categoryFilter) return false;
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-medium">
          All campaigns
          <span className="text-gray-400 font-normal"> · {filtered.length} of {campaigns.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            <option value="all">All statuses</option>
            <option value="ACTIVE">Active only</option>
            <option value="PAUSED">Paused only</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as typeof categoryFilter)}
            className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            <option value="all">All categories</option>
            {orderedInterests.map((i) => (
              <option key={i.key} value={i.key}>{i.label}</option>
            ))}
            {presentCategories.has("other") && <option value="other">Other / Unclassified</option>}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="text-left px-5 py-3 font-medium">Campaign</th>
              <th className="text-left px-3 py-3 font-medium">Category</th>
              <th className="text-left px-3 py-3 font-medium">Status</th>
              <th className="text-right px-3 py-3 font-medium">Daily Budget</th>
              <th className="text-right px-3 py-3 font-medium">Spend</th>
              <th className="text-right px-3 py-3 font-medium">Impressions</th>
              {showLeads && <th className="text-right px-3 py-3 font-medium">Leads</th>}
              {showLeads && <th className="text-right px-3 py-3 font-medium">Cost/Lead</th>}
              <th className="text-right px-5 py-3 font-medium">CTR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr><td colSpan={showLeads ? 9 : 7} className="px-5 py-8 text-center text-gray-400 text-sm">
                No campaigns match these filters.
              </td></tr>
            )}
            {filtered.map((c) => {
              const cat = classifyCampaign(c.campaign_name);
              const isActive = c.status === "ACTIVE";
              return (
                <tr key={c.campaign_id} onClick={() => onSelect(c)} className="hover:bg-brand-light cursor-pointer transition">
                  <td className="px-5 py-3 max-w-xs truncate" title={c.campaign_name}>
                    {c.campaign_id === topId && <span className="mr-1" title="Top performer">🏆</span>}
                    <span className="text-brand hover:underline">{c.campaign_name}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-700">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${cat.color}`} />
                      {cat.emoji} {cat.label}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-block text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                      isActive ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
                    }`}>{c.status}</span>
                  </td>
                  <td className="px-3 py-3 text-right text-xs text-gray-600 tabular-nums">
                    {c.daily_budget > 0 ? fmtINR(c.daily_budget) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right font-medium">{fmtINR(c.spend)}</td>
                  <td className="px-3 py-3 text-right">{fmtNum(c.impressions)}</td>
                  {showLeads && <td className="px-3 py-3 text-right">{c.leads > 0 ? fmtNum(c.leads) : "—"}</td>}
                  {showLeads && <td className="px-3 py-3 text-right">{c.costPerLead > 0 ? fmtINR(c.costPerLead) : "—"}</td>}
                  <td className="px-5 py-3 text-right">{c.ctr.toFixed(2)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Deprecated card variant — kept in case we want to reuse the styling later. Unreferenced.
function InterestCard({
  active, onClick, emoji, color, label, sub, spend, leads, showLeads,
}: {
  active: boolean;
  onClick: () => void;
  emoji: string;
  color: string;
  label: string;
  sub: string;
  spend: number;
  leads: number;
  showLeads: boolean;
}) {
  const cpl = leads > 0 ? spend / leads : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border transition overflow-hidden ${
        active
          ? "border-brand shadow-md ring-2 ring-brand/20 bg-white"
          : "border-gray-200 bg-white hover:border-brand/40 hover:shadow-sm"
      }`}
    >
      <div className={`h-1 ${color}`} />
      <div className="p-3.5">
        <div className="flex items-center gap-2">
          <span className="text-xl">{emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-gray-900 leading-tight truncate">{label}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-baseline justify-between gap-2">
          <div>
            <div className="text-[12px] uppercase tracking-wide text-gray-500 font-medium">Spend</div>
            <div className="text-base font-bold text-gray-900 tabular-nums">{fmtINR(spend)}</div>
          </div>
          {showLeads && (
            <div className="text-right">
              <div className="text-[12px] uppercase tracking-wide text-gray-500 font-medium">
                {leads > 0 ? "Cost / Lead" : "Leads"}
              </div>
              <div className="text-base font-bold text-gray-900 tabular-nums">
                {leads > 0 ? fmtINR(cpl) : "—"}
              </div>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function CampaignDrilldown({ campaign, range, onClose }: { campaign: Campaign; range: { from: string; to: string }; onClose: () => void }) {
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    fetch(`/api/ads/campaign/${campaign.campaign_id}?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setAds(d.ads);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [campaign.campaign_id, range]);

  const hasLeads = ads ? ads.some((a) => a.leads > 0) : false;
  const topAdId = ads && ads.length > 0
    ? ads.filter((a) => hasLeads ? a.leads > 0 : a.impressions > 500)
        .sort((a, b) => hasLeads ? a.costPerLead - b.costPerLead : b.ctr - a.ctr)[0]?.ad_id
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white w-full md:max-w-5xl md:rounded-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500 uppercase">Campaign</div>
            <div className="text-lg font-semibold">{campaign.campaign_name}</div>
            <div className="text-xs text-gray-500 mt-1">
              {fmtINR(campaign.spend)} spend &middot; {fmtNum(campaign.impressions)} impressions
              {campaign.leads > 0 && <> &middot; {fmtNum(campaign.leads)} leads @ {fmtINR(campaign.costPerLead)}</>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 text-xl px-2">×</button>
        </div>

        <div className="overflow-y-auto p-6">
          {loading && <div className="text-sm text-gray-500">Loading ads…</div>}
          {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</div>}
          {ads && ads.length === 0 && <div className="text-sm text-gray-500">No ads in this range.</div>}
          {ads && ads.length > 0 && (
            <div className="space-y-3">
              {ads.map((ad) => (
                <div
                  key={ad.ad_id}
                  className={`flex gap-4 p-4 border rounded-xl ${ad.ad_id === topAdId ? "border-brand bg-brand-light" : "border-gray-100"}`}
                >
                  {ad.creative_thumbnail ? (
                    <img src={ad.creative_thumbnail} alt="" className="w-24 h-24 rounded-lg object-cover bg-gray-100 flex-shrink-0" loading="lazy" decoding="async" />
                  ) : (
                    <div className="w-24 h-24 rounded-lg bg-gray-100 flex-shrink-0 flex items-center justify-center text-xs text-gray-400">No preview</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {ad.ad_id === topAdId && <span title="Top performer">🏆</span>}
                      <div className="font-medium truncate" title={ad.ad_name}>{ad.ad_name}</div>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">Ad set: {ad.adset_name}</div>
                    {ad.creative_body && <div className="text-xs text-gray-600 mt-1 line-clamp-2">{ad.creative_body}</div>}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3 text-xs">
                      <Stat label="Spend" value={fmtINR(ad.spend)} />
                      <Stat label="Impressions" value={fmtNum(ad.impressions)} />
                      {hasLeads
                        ? <Stat label="Leads" value={ad.leads > 0 ? fmtNum(ad.leads) : "—"} />
                        : <Stat label="Clicks" value={fmtNum(ad.clicks)} />}
                      {hasLeads
                        ? <Stat label="Cost/Lead" value={ad.costPerLead > 0 ? fmtINR(ad.costPerLead) : "—"} />
                        : <Stat label="CPC" value={fmtINR(ad.cpc)} />}
                      <Stat label="CTR" value={ad.ctr.toFixed(2) + "%"} />
                    </div>
                    {ad.permalink && (
                      <a href={ad.permalink} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline mt-2 inline-block">
                        Open ad on Facebook ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-gray-400 uppercase tracking-wide" style={{ fontSize: 10 }}>{label}</div>
      <div className="font-medium text-gray-900">{value}</div>
    </div>
  );
}
