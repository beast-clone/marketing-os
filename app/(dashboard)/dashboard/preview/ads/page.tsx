"use client";
import { LoadingBlock } from "@/components/LoadingBlock";
import { useEffect, useMemo, useRef, useState } from "react";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { HeaderSlot } from "@/app/(dashboard)/dashboard/preview/HeaderSlot";
import { Overlay } from "@/app/(dashboard)/dashboard/preview/Overlay";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { useApi } from "@/lib/use-api";
import { LiveIndicator } from "@/components/LiveIndicator";
import { MetricCard } from "@/components/MetricCard";
import { IconSparkles, IconAlertTriangle, IconCircleCheck, IconBulb, IconTrophy, IconChevronDown, IconPhoto, IconBook, IconHeartHandshake, IconHeartbeat, IconHelpCircle, IconMapPin, IconPlayerPlay, IconPlayerStop, IconSchool, IconSpeakerphone, IconWorld } from "@tabler/icons-react";
import { TrendChart } from "@/components/TrendChart";
import { fmtDateShort } from "@/lib/date";
import { SoundVideo } from "@/components/SoundVideo";

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
  status: string | null; start_time: string | null; end_time: string | null; objective: string | null;
};

// Ad flight badge — "1 Jul → ongoing" (live) or "1 Jul → 21 Jul" (ended). Green when active.
function flightLabel(ad: Ad): { text: string; active: boolean } | null {
  if (!ad.start_time && !ad.status) return null;
  const active = ad.status === "ACTIVE";
  const d = (iso: string | null) => (iso ? fmtDateShort(iso) : null);
  const start = d(ad.start_time);
  const end = d(ad.end_time);
  const tail = end || (active ? "ongoing" : "paused");
  return { text: start ? `${start} → ${tail}` : active ? "Active" : "Paused", active };
}
const OBJECTIVE_LABEL: Record<string, string> = {
  OUTCOME_LEADS: "Lead generation", LEAD_GENERATION: "Lead generation", OUTCOME_TRAFFIC: "Traffic",
  LINK_CLICKS: "Traffic", OUTCOME_ENGAGEMENT: "Engagement", OUTCOME_SALES: "Sales", CONVERSIONS: "Conversions",
  OUTCOME_AWARENESS: "Awareness", MESSAGES: "Messages", OUTCOME_APP_PROMOTION: "App promotion",
};

// Per-AD deterministic AI read — written for someone who has NEVER run ads.
// Plain headline + an explanation that teaches the metric + a clear action.
// Rule-based (never guesses) from this ad's own numbers vs the campaign average.
function adSuggestion(ad: Ad, avgCpl: number): { headline: string; explain: string; action: string } {
  const ctr = ad.ctr.toFixed(2);
  const freq = ad.frequency.toFixed(1);
  const seen = Math.max(1, Math.round(ad.frequency));
  if (ad.frequency > 3.5) return {
    headline: "People are seeing this ad too many times",
    explain: `“Frequency” is ${freq} — on average each person has already seen this exact ad about ${seen} times. When people keep seeing the same ad they start to ignore it (and some get annoyed), so clicks and leads slowly fall even though you keep paying for it.`,
    action: "Swap in a fresh image or video, or show it to a new / wider group of people. A new creative almost always brings performance back up.",
  };
  if (ad.ctr > 0 && ad.ctr < 1) return {
    headline: "Hardly anyone is clicking this ad",
    explain: `“CTR” (click-through rate) is ${ctr}% — out of every 100 people who saw it, fewer than 1 actually clicked. That usually means the first thing they notice (the picture or the opening line) isn’t catching their eye.`,
    action: "Try a stronger opening — a bolder image, a clearer benefit, or a question in the first line — and run it against this ad to see which does better.",
  };
  if (ad.leads > 0 && avgCpl > 0 && ad.costPerLead > avgCpl * 1.4) return {
    headline: "This ad is costing too much per lead",
    explain: `Every lead (person who filled the form) from this ad costs ${fmtINR(ad.costPerLead)}. Your other ads in this campaign average about ${fmtINR(avgCpl)} — so you’re paying well over the odds here for the same result.`,
    action: "Move some budget to the cheaper ads, or narrow who this ad targets. Watch it for a few days — if the cost stays high, switch it off.",
  };
  if (ad.leads > 0 && avgCpl > 0 && ad.costPerLead <= avgCpl * 0.8) return {
    headline: "This is one of your best ads — it’s a bargain",
    explain: `Each lead from this ad costs only ${fmtINR(ad.costPerLead)}, cheaper than your campaign average of ${fmtINR(avgCpl)}. In simple terms, your money goes further here than on your other ads.`,
    action: "Give this ad more of your daily budget. Putting money behind your cheapest, best-working ad is the fastest way to get more leads for the same spend.",
  };
  if (ad.status && ad.status !== "ACTIVE") return {
    headline: "This ad is switched off right now",
    explain: ad.leads > 0
      ? `It isn’t running or spending at the moment. While it was live, it brought in ${fmtNum(ad.leads)} leads at ${fmtINR(ad.costPerLead)} each.`
      : "It isn’t running or spending at the moment, and it didn’t record any leads while it was live.",
    action: ad.leads > 0
      ? "If those numbers look good to you, turn it back on for your next push. If it was expensive, it’s fine to leave it off."
      : "Leave it off for now — only bring it back if you give it a new image or message to test.",
  };
  return {
    headline: "This ad is doing fine — nothing to fix",
    explain: `Its click rate (${ctr}%) and frequency (${freq} — people have seen it about ${seen} time${seen === 1 ? "" : "s"}) are both in a healthy range, so there’s no problem to act on right now.`,
    action: "Just keep it running as it is and check back in a few days.",
  };
}

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
  liveAds?: LiveAd[];                        // switched on RIGHT NOW (Meta effective_status ACTIVE)
  // When the SERVER last called Meta — not when this browser got the response.
  fetchedAt?: string;
  fromCache?: boolean;
};
type LiveAd = {
  ad_id: string; ad_name: string; campaign_name: string; adset_name: string;
  objective: string | null; destination: string | null; offPixel: boolean;
  thumbnail: string | null;
  startedAt: string | null;          // YYYY-MM-DD the ad began delivering
  spend: number; reach: number; impressions: number; leads: number; clicks: number; ctr: number;
  costPerLead: number; costPerClick: number;
};

// "12 Aug · 34d" — the date answers when, the age answers how long, and how long
// is usually the actual question when you are looking at a list of running ads.
function startedLabel(iso: string | null): { date: string; age: string } | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  const days = Math.max(0, Math.round((Date.now() - d.getTime()) / 86_400_000));
  return {
    date: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    age: days === 0 ? "today" : days === 1 ? "1d" : `${days}d`,
  };
}

// Which number actually judges a campaign depends on what it was set up to do.
// Printing "0 leads" against a clicks campaign reads as failure when leads were
// never the point — that is the confusion this whole section exists to remove.
const CLICK_OBJECTIVES = ["LINK_CLICKS", "OUTCOME_TRAFFIC", "OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT", "POST_ENGAGEMENT", "REACH", "BRAND_AWARENESS", "VIDEO_VIEWS"];
const goalOf = (objective: string | null) =>
  CLICK_OBJECTIVES.includes(objective || "") ? "clicks" as const : "leads" as const;

function fmtINR(n: number) {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// Cost per click is often under a rupee — show paise there instead of "₹0".
function fmtPer(n: number) {
  return n > 0 && n < 10 ? `₹${n.toFixed(2)}` : fmtINR(n);
}
function fmtNum(n: number) {
  return n.toLocaleString("en-IN");
}

function fmtDay(iso: string) {
  return fmtDateShort(iso, iso);
}

export default function AdsPage() {
  return (
    <PreviewDashboardShell active="ads" title="Ads" hideAccountPicker subtitle="Meta ad performance — spend, leads, campaigns and daily delivery, with an AI analyst.">
      {({ range }) => <Ads range={range} />}
    </PreviewDashboardShell>
  );
}

function Ads({ range }: { range: { from: string; to: string } }) {
  const qs = new URLSearchParams({ from: range.from, to: range.to }).toString();
  const [forceAt, setForceAt] = useState(0);
  // `force` bypasses the shared 2-hour cache, so Refresh re-asks Meta rather than
  // handing back the same cached payload and looking like it did nothing.
  const { data, error, isLoading, refresh } = useApi<AdsData>(`/api/ads?${qs}${forceAt ? `&force=1&t=${forceAt}` : ""}`);
  const loading = isLoading;
  const fetchData = () => { setForceAt(Date.now()); refresh(); };
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  // Which campaign the analyst panel is focused on (null = whole account).
  const [focusCampaign, setFocusCampaign] = useState<string | null>(null);
  // …or on one ad inside it (28 Oct): its own numbers beside its campaign's.
  const [focusAd, setFocusAd] = useState<string | null>(null);

  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const fetchStartRef = useRef<number>(0);
  useEffect(() => { if (isLoading) fetchStartRef.current = Date.now(); }, [isLoading]);
  useEffect(() => {
    if (data && !isLoading) {
      // Use the server's timestamp when it sends one. Stamping Date.now() here
      // made a two-hour-old cached payload report itself as "just now", which is
      // the opposite of what this indicator exists to tell you.
      const served = data.fetchedAt ? new Date(data.fetchedAt).getTime() : NaN;
      setFetchedAt(Number.isFinite(served) ? served : Date.now());
      setLatencyMs(Date.now() - fetchStartRef.current);
    }
  }, [data, isLoading]);

  // Into the shell's top bar rather than above the content — it is a status
  // control like the token badge, not part of the page.
  const live = (
    <HeaderSlot>
      <LiveIndicator fetchedAt={fetchedAt} latencyMs={latencyMs} loading={loading} onRefresh={fetchData} error={error ? error.message : null} />
    </HeaderSlot>
  );

  if (loading && !data) return <>{live}<LoadingBlock label="Loading ads data…" /></>;
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
      <div className="flex items-center justify-end flex-wrap gap-2 mb-3">
        <div className="text-xs text-gray-400">
          Ad account ID: {data.account.id}
        </div>
      </div>

      {/* WHAT'S LIVE RIGHT NOW, and the analyst reading it, side by side.
          Full-width the two stacked to over 1,100px apart, so the advice about a
          campaign sat a scroll away from the campaign itself. Beside each other,
          picking a row re-points the analyst at that campaign — which is the
          question people actually have ("is THIS one worth the money?"), not the
          account average. Splits only at xl (1280px): at the lg breakpoint the left column was narrow
          enough to truncate campaign names to "Ope…" and wrap each row over five
          lines, which is worse than stacking. */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4 items-start">
        {data.liveAds && (
          <LiveAdsSection
            ads={data.liveAds}
            rangeLabel={`${fmtDay(range.from)} – ${fmtDay(range.to)}`}
            selected={focusAd ? null : focusCampaign}
            onSelect={(name) => { setFocusAd(null); setFocusCampaign(name); }}
            selectedAd={focusAd}
            onSelectAd={(ad) => { setFocusAd(ad?.ad_id ?? null); if (ad) setFocusCampaign(ad.campaign_name); }}
          />
        )}
        <div className="xl:sticky xl:top-4">
          {focusAd && data.liveAds?.some((a) => a.ad_id === focusAd)
            ? <AdPanel ad={data.liveAds.find((a) => a.ad_id === focusAd)!} siblings={data.liveAds.filter((a) => a.campaign_name === data.liveAds!.find((x) => x.ad_id === focusAd)!.campaign_name)}
                onBack={() => setFocusAd(null)} onAll={() => { setFocusAd(null); setFocusCampaign(null); }} />
            : <AdsAnalyst range={range} campaign={focusCampaign} onClear={() => setFocusCampaign(null)} />}
        </div>
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
  if (!data) return <LoadingBlock size={18} className="!py-2 !flex-row !justify-start !gap-2" label="Loading breakdowns…" />;

  const cards = [
    { title: "By platform", rows: data.platform, pretty: prettyPlatform },
    { title: "By placement", rows: data.placement, pretty: prettyPlacement },
    { title: "By age", rows: data.age, pretty: (k: string) => k },
    { title: "By gender", rows: data.gender, pretty: titleCase },
    { title: "Top regions", rows: data.region, pretty: (k: string) => k },
  ].filter((c) => (c.rows?.length ?? 0) > 0);
  if (cards.length === 0) return null;

  // Bento: fill the last row instead of leaving an empty cell. On a 3-col grid, a last
  // row of 2 → the final card spans 2 cols; a last row of 1 → it spans the full 3. On a
  // 2-col grid, a lone last card spans both. Spanned cards render donut-left / legend-right.
  const n = cards.length;
  const xlRem = n % 3;
  const xlLastStart = xlRem === 0 ? n : n - xlRem;
  const spanFor = (i: number) => {
    const parts: string[] = [];
    if (i >= xlLastStart) {
      if (xlRem === 1) parts.push("xl:col-span-3");
      else if (xlRem === 2 && i === n - 1) parts.push("xl:col-span-2");
    }
    if (n % 2 === 1 && i === n - 1) parts.push("md:col-span-2");
    return parts.join(" ");
  };

  return (
    <div className="mt-6">
      <div className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-2">Where the spend &amp; leads land</div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {cards.map((c, i) => {
          const span = spanFor(i);
          return <BreakdownCard key={c.title} title={c.title} rows={c.rows} showLeads={showLeads} pretty={c.pretty} spanClass={span} wide={span.includes("col-span-2") || span.includes("col-span-3")} />;
        })}
      </div>
    </div>
  );
}

// Distinct categorical palette for donut slices (brand-anchored).
const BD_COLORS = ["#3A57E8", "#6E48F8", "#0EA5E9", "#12B886", "#F59E0B", "#E8590C", "#E11D48", "#9AA3B8"];

function BreakdownCard({ title, rows, showLeads, pretty, spanClass = "", wide = false }: { title: string; rows: BreakdownRow[]; showLeads: boolean; pretty: (k: string) => string; spanClass?: string; wide?: boolean }) {
  // Donut of spend share. Focus (hover on desktop, tap on touch) highlights a slice
  // and the centre shows that row's %, spend and cost-per-lead. 0-spend rows are dropped.
  // `wide` (a bento column-span) lays the donut on the left with the legend beside it.
  const [focus, setFocus] = useState<number | null>(null);
  const slices = rows.slice(0, 8).filter((r) => r.spend > 0);
  const total = slices.reduce((s, r) => s + r.spend, 0) || 1;
  const R = 48, SW = 12, C = 2 * Math.PI * R;   // thin ring → big centre hole for the numbers
  const cpl = (r: BreakdownRow) => (r.leads > 0 ? Math.round(r.spend / r.leads) : null);
  const col = (i: number) => BD_COLORS[i % BD_COLORS.length];
  let acc = 0;
  const arcs = slices.map((r, i) => { const frac = r.spend / total; const a = { r, i, dash: frac * C, offset: -acc * C }; acc += frac; return a; });
  const foc = focus != null && focus < slices.length ? slices[focus] : null;
  const toggle = (i: number) => setFocus((f) => (f === i ? null : i));

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-5 ${spanClass}`}>
      <div className="text-sm font-medium mb-3">{title}</div>
      {slices.length === 0 ? (
        <div className="text-[12px] text-gray-400 py-6 text-center">No spend to break down.</div>
      ) : (
        <div className={wide ? "flex flex-col md:flex-row md:items-center gap-4 md:gap-8" : "flex flex-col items-center gap-4"}>
          {/* Big donut — the focused slice's label, %, spend & CPL all sit INSIDE the ring */}
          <div className="relative shrink-0 self-center" style={{ width: 208, height: 208 }}>
            <svg width="208" height="208" viewBox="0 0 120 120">
              {arcs.map((a) => (
                <circle key={a.i} cx="60" cy="60" r={R} fill="none"
                  stroke={col(a.i)} strokeWidth={focus === a.i ? SW + 3 : SW}
                  strokeDasharray={`${a.dash.toFixed(2)} ${(C - a.dash).toFixed(2)}`}
                  strokeDashoffset={a.offset.toFixed(2)} transform="rotate(-90 60 60)"
                  style={{ opacity: focus == null || focus === a.i ? 1 : 0.3, transition: "opacity .12s, stroke-width .12s", cursor: "pointer" }}
                  onMouseEnter={() => setFocus(a.i)} onMouseLeave={() => setFocus(null)} onClick={() => toggle(a.i)} />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none" style={{ padding: "0 46px" }}>
              {foc ? (
                <>
                  <div className="text-[11px] font-semibold leading-tight truncate max-w-full" style={{ color: col(focus!) }}>{pretty(foc.key)}</div>
                  <div className="text-[30px] font-semibold tabular-nums leading-none mt-1 text-[#232D42]">{((foc.spend / total) * 100).toFixed(1)}<span className="text-[16px]">%</span></div>
                  <div className="text-[11px] text-gray-500 tabular-nums mt-1 leading-tight">{fmtINR(foc.spend)}</div>
                  {showLeads && (foc.leads > 0
                    ? <div className="text-[11px] text-gray-500 tabular-nums leading-tight">{fmtNum(foc.leads)} leads · {fmtINR(cpl(foc)!)}/lead</div>
                    : <div className="text-[11px] text-gray-400 leading-tight">no leads</div>)}
                </>
              ) : (
                <>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Total spend</div>
                  <div className="text-[24px] font-semibold tabular-nums leading-none mt-1 text-[#232D42]">{fmtINR(total)}</div>
                  <div className="text-[11px] text-gray-400 mt-1">{slices.length} {slices.length === 1 ? "item" : "items"} · hover a slice</div>
                </>
              )}
            </div>
          </div>
          {/* Legend — below the donut normally, beside it (filling the width) when wide */}
          <div className={wide ? "grid grid-cols-2 md:grid-cols-[minmax(0,220px)_minmax(0,220px)] gap-x-6 gap-y-1 md:justify-start w-full md:flex-1 md:min-w-0" : "w-full grid grid-cols-2 gap-x-3 gap-y-0.5"}>
            {slices.map((r, i) => {
              const on = focus === i;
              return (
                <div key={r.key} onMouseEnter={() => setFocus(i)} onMouseLeave={() => setFocus(null)} onClick={() => toggle(i)}
                  className={`flex items-center gap-2 px-1.5 py-1 rounded-lg cursor-pointer transition-colors ${on ? "bg-gray-50" : "hover:bg-gray-50"}`}>
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: col(i), outline: on ? `2px solid ${col(i)}33` : "none" }} />
                  <span className="flex-1 min-w-0 truncate text-[12px] font-medium text-gray-700">{pretty(r.key)}</span>
                  <span className="text-[12px] font-semibold tabular-nums text-[#232D42]">{((r.spend / total) * 100).toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Live right now ----------------
// Deliberately plain: a count, then one row per running ad. No deltas, no
// scoring, no advice — the rest of the page does that. This section only
// answers "which ads are switched on".
function LiveAdsSection({ ads, rangeLabel, selected, onSelect, selectedAd, onSelectAd }: {
  ads: LiveAd[]; rangeLabel: string;
  // Which campaign the analyst panel beside this list is describing.
  selected?: string | null;
  onSelect?: (name: string | null) => void;
  // Or which single ad (its row is highlighted instead).
  selectedAd?: string | null;
  onSelectAd?: (ad: LiveAd | null) => void;
}) {
  // Grouped by campaign: 7 campaign rows read at a glance where 26 flat ad rows
  // do not, and the campaign is the level you actually move budget at.
  const groups = useMemo(() => {
    const by = new Map<string, LiveAd[]>();
    for (const a of ads) {
      const k = a.campaign_name;
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(a);
    }
    return [...by.entries()]
      .map(([name, list]) => {
        const spend = list.reduce((s, x) => s + x.spend, 0);
        const leads = list.reduce((s, x) => s + x.leads, 0);
        const clicks = list.reduce((s, x) => s + x.clicks, 0);
        const goal = goalOf(list[0]?.objective ?? null);
        const count = goal === "clicks" ? clicks : leads;
        // A leads campaign sending people off-Meta to a page without the pixel
        // reports 0 because Meta never sees the signup — flag it as unmeasured
        // rather than letting it read as a dead campaign.
        const untracked = goal === "leads" && leads === 0 && list.some((x) => x.offPixel);
        // Earliest of its running ads — when this campaign last started putting
        // something in front of people, which is not the same as when the
        // campaign object was created.
        const starts = list.map((x) => x.startedAt).filter((x): x is string => !!x).sort();
        return {
          name, ads: [...list].sort((x, y) => y.spend - x.spend),
          startedAt: starts[0] || null,
          spend, leads, clicks, goal, count, untracked,
          destination: list.find((x) => x.destination)?.destination || null,
          costPer: count > 0 ? spend / count : 0,
        };
      })
      .sort((a, b) => b.spend - a.spend);
  }, [ads]);

  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (name: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const allOpen = open.size === groups.length && groups.length > 0;

  const spend = ads.reduce((s, a) => s + a.spend, 0);
  const leads = ads.reduce((s, a) => s + a.leads, 0);
  const campaigns = groups.length;
  const untrackedCount = groups.filter((g) => g.untracked).length;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="flex items-baseline justify-between flex-wrap gap-x-4 gap-y-1 px-5 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="relative flex w-2 h-2">
            <span className="animate-ping absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex rounded-full w-2 h-2 bg-emerald-500" />
          </span>
          <span className="text-base font-semibold text-[#232D42]">Live right now</span>
          <span className="text-sm text-gray-500">
            {ads.length} {ads.length === 1 ? "ad" : "ads"} running across {campaigns} {campaigns === 1 ? "campaign" : "campaigns"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-500">
            {fmtINR(spend)} spent · {fmtNum(leads)} leads
            {/* Say the total is short rather than presenting it as complete. */}
            {untrackedCount > 0 && <span className="text-amber-700"> · {untrackedCount} not tracked</span>}
            {" "}<span className="text-gray-400">({rangeLabel})</span>
          </div>
          {groups.length > 0 && (
            <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.name)))}
              className="text-[11.5px] font-medium text-brand hover:underline">
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          )}
        </div>
      </div>

      {ads.length === 0 ? (
        <div className="px-5 py-6 text-sm text-gray-500">Nothing is running at the moment — every ad is paused.</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {groups.map((g) => {
            const isOpen = open.has(g.name);
            return (
              <div key={g.name}>
                {/* The row selects the campaign for the analyst panel; the chevron
                    alone expands its ads. Two jobs, so they get separate hit areas
                    rather than one control that guesses which you meant. */}
                <button type="button"
                  onClick={() => onSelect?.(selected === g.name ? null : g.name)}
                  aria-pressed={selected === g.name}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-left transition ${
                    selected === g.name ? "bg-brand-light" : "hover:bg-gray-50"
                  }`}>
                  <span role="button" tabIndex={-1} aria-label={isOpen ? "Hide ads" : "Show ads"}
                    onClick={(e) => { e.stopPropagation(); toggle(g.name); }}
                    className="flex-shrink-0 -m-1 p-1 rounded hover:bg-gray-200/70">
                    <IconChevronDown size={15} stroke={2}
                      className={`text-gray-400 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-[#232D42] truncate" title={g.name}>{g.name}</div>
                    <div className="text-[11.5px] text-gray-500">
                      {g.ads.length} {g.ads.length === 1 ? "ad" : "ads"} live
                      <span className="text-gray-300"> · </span>
                      {g.goal === "clicks" ? "optimised for clicks" : "optimised for leads"}
                      {(() => {
                        const st = startedLabel(g.startedAt);
                        return st ? <><span className="text-gray-300"> · </span>running {st.age} (since {st.date})</> : null;
                      })()}
                      {g.destination && <><span className="text-gray-300"> · </span>{g.destination}</>}
                    </div>
                  </div>
                  <div className="hidden sm:block text-right w-24 flex-shrink-0">
                    <div className="text-[13px] font-medium text-[#232D42] tabular-nums">{fmtINR(g.spend)}</div>
                    <div className="text-[11px] text-gray-400">spent</div>
                  </div>
                  <div className="text-right w-20 flex-shrink-0">
                    <div className="text-[13px] font-medium text-[#232D42] tabular-nums">{g.untracked ? "—" : fmtNum(g.count)}</div>
                    <div className="text-[11px] text-gray-400">{g.goal === "clicks" ? "clicks" : "leads"}</div>
                  </div>
                  <div className="text-right w-24 flex-shrink-0">
                    {g.untracked ? (
                      <>
                        <div className="text-[12px] font-medium text-amber-700">not tracked</div>
                        <div className="text-[11px] text-gray-400" title={`The Meta pixel isn't installed on ${g.destination}, so signups there can't be counted.`}>no pixel on site</div>
                      </>
                    ) : (
                      <>
                        <div className="text-[13px] font-medium text-[#232D42] tabular-nums">{g.count > 0 ? fmtPer(g.costPer) : g.spend > 0 ? "—" : "not spent yet"}</div>
                        <div className="text-[11px] text-gray-400">{g.count > 0 ? (g.goal === "clicks" ? "per click" : "per lead") : g.spend > 0 ? `no ${g.goal}` : ""}</div>
                      </>
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className="bg-gray-50/60 divide-y divide-gray-100">
                    {g.ads.map((a) => (
                      <button type="button" key={a.ad_id} onClick={() => onSelectAd?.(selectedAd === a.ad_id ? null : a)} aria-pressed={selectedAd === a.ad_id}
                        className={`w-full text-left flex items-center gap-3 pl-12 pr-5 py-2.5 transition ${selectedAd === a.ad_id ? "bg-brand-light" : "hover:bg-gray-100/70"}`}>
                        <div className="w-9 h-9 rounded-md bg-white overflow-hidden flex-shrink-0 border border-gray-200">
                          {a.thumbnail
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={a.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                            : <div className="w-full h-full grid place-items-center text-gray-300"><IconPhoto size={15} stroke={1.6} /></div>}
                        </div>
                        <div className="min-w-0 flex-1 text-[12.5px] text-[#232D42] truncate"
                          title={a.startedAt ? `${a.ad_name}\nStarted ${a.startedAt}` : a.ad_name}>{a.ad_name}</div>
                        <div className="hidden sm:block text-right w-24 flex-shrink-0 text-[12.5px] text-gray-600 tabular-nums">{fmtINR(a.spend)}</div>
                        {(() => {
                          // Same goal as its campaign, so the columns line up.
                          const n = g.goal === "clicks" ? a.clicks : a.leads;
                          const per = g.goal === "clicks" ? a.costPerClick : a.costPerLead;
                          return (
                            <>
                              <div className="text-right w-20 flex-shrink-0 text-[12.5px] text-gray-600 tabular-nums">{g.untracked ? "—" : fmtNum(n)}</div>
                              {/* A live ad with no spend yet is normal — say so instead of "₹0". */}
                              <div className="text-right w-24 flex-shrink-0 text-[12.5px] text-gray-600 tabular-nums">
                                {g.untracked ? "not tracked" : n > 0 ? fmtPer(per) : a.spend > 0 ? "—" : "not spent yet"}
                              </div>
                            </>
                          );
                        })()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- One ad (28 Oct) ----------------
// Picking an ad inside a campaign shows that ad on its own: what it spent and got,
// how it compares with the other ads in the same campaign, and how often people saw
// it. Straight from Meta's numbers — the same goal (leads or clicks) as its campaign.
function AdPanel({ ad, siblings, onBack, onAll }: { ad: LiveAd; siblings: LiveAd[]; onBack: () => void; onAll: () => void }) {
  const goal = goalOf(ad.objective);
  const word = goal === "clicks" ? "click" : "lead";
  const n = goal === "clicks" ? ad.clicks : ad.leads;
  const per = goal === "clicks" ? ad.costPerClick : ad.costPerLead;
  const campSpend = siblings.reduce((s, x) => s + x.spend, 0);
  const campN = siblings.reduce((s, x) => s + (goal === "clicks" ? x.clicks : x.leads), 0);
  const campPer = campN > 0 ? campSpend / campN : 0;
  // The open ad's creative at full size: a video plays with sound, a picture shows
  // whole (28 Oct). Looked up only for the open ad.
  const [video, setVideo] = useState<{ kind: "video" | "image"; url: string; poster: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    setVideo(null);
    fetch(`/api/ads/video?ad=${ad.ad_id}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive) setVideo(j?.video || null); }).catch(() => {});
    return () => { alive = false; };
  }, [ad.ad_id]);
  const share = campSpend > 0 ? Math.round((ad.spend / campSpend) * 100) : 0;
  const freq = ad.reach > 0 ? ad.impressions / ad.reach : 0;
  const ranked = siblings.filter((x) => (goal === "clicks" ? x.clicks : x.leads) > 0)
    .sort((x, y) => (goal === "clicks" ? x.costPerClick - y.costPerClick : x.costPerLead - y.costPerLead));
  const rank = ranked.findIndex((x) => x.ad_id === ad.ad_id);
  const vs = campPer > 0 && n > 0 ? Math.round(((per - campPer) / campPer) * 100) : null;
  const st = startedLabel(ad.startedAt);
  const untracked = goal === "leads" && ad.leads === 0 && ad.offPixel;

  const lines: { tone: "good" | "warn" | "plain"; text: string }[] = [];
  if (ad.spend === 0) lines.push({ tone: "plain", text: "It hasn't spent anything yet in this period — Meta may still be holding it back or it has only just started." });
  else if (untracked) lines.push({ tone: "warn", text: `It sends people to ${ad.destination}, where the Meta pixel isn't installed — so signups there can't be counted. Zero leads here doesn't mean zero interest.` });
  else if (n === 0) lines.push({ tone: "warn", text: `It has spent ${fmtINR(ad.spend)} and brought no ${word}s yet.` });
  else {
    lines.push({ tone: "plain", text: `It spent ${fmtINR(ad.spend)} and brought ${fmtNum(n)} ${word}${n === 1 ? "" : "s"} — ${fmtPer(per)} each.` });
    if (vs != null && siblings.length > 1) lines.push({
      tone: vs <= -10 ? "good" : vs >= 15 ? "warn" : "plain",
      text: vs <= -10 ? `That's ${Math.abs(vs)}% cheaper per ${word} than its campaign as a whole (${fmtPer(campPer)}).`
        : vs >= 15 ? `That's ${vs}% dearer per ${word} than its campaign as a whole (${fmtPer(campPer)}).`
        : `That's about the same as its campaign as a whole (${fmtPer(campPer)} per ${word}).`,
    });
    if (ranked.length > 1 && rank >= 0) lines.push({ tone: rank === 0 ? "good" : "plain", text: rank === 0 ? `Cheapest of the ${ranked.length} ads in this campaign.` : `Number ${rank + 1} of ${ranked.length} ads in this campaign by cost per ${word}.` });
  }
  if (siblings.length > 1 && ad.spend > 0) lines.push({ tone: "plain", text: `It took ${share}% of the campaign's ${fmtINR(campSpend)} spend.` });
  if (ad.reach > 0) lines.push({
    tone: freq > 3.5 ? "warn" : "plain",
    text: `Seen ${fmtNum(ad.impressions)} times by ${fmtNum(ad.reach)} people — about ${freq.toFixed(1)} times each${freq > 3.5 ? ", which is a lot; people start ignoring an ad they keep seeing" : ""}.`,
  });
  if (ad.impressions > 0) lines.push({ tone: ad.ctr > 0 && ad.ctr < 1 ? "warn" : "plain", text: `${ad.ctr.toFixed(2)}% of the people who saw it clicked${ad.ctr > 0 && ad.ctr < 1 ? " — under 1% usually means the picture or first line isn't stopping people" : ""}.` });

  const tile = (v: string, l: string) => (
    <div className="bg-white rounded-xl border border-gray-100 px-3 py-2.5"><div className="text-[17px] font-medium text-[#232D42] tabular-nums">{v}</div><div className="text-[11px] text-[#8A92A6]">{l}</div></div>
  );
  return (
    <div className="rounded-2xl border-[1.5px] border-brand overflow-hidden mb-4" style={{ background: "linear-gradient(180deg,#E9ECFB,#ffffff)" }}>
      <div className="px-5 py-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-12 h-12 rounded-lg bg-white overflow-hidden flex-shrink-0 border border-gray-200">
            {ad.thumbnail
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={ad.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
              : <div className="w-full h-full grid place-items-center text-gray-300"><IconPhoto size={18} stroke={1.6} /></div>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-[#232D42] truncate" title={ad.ad_name}>{ad.ad_name}</div>
            <div className="text-[11px] text-brand-ink truncate" title={ad.campaign_name}>Ad in {ad.campaign_name}</div>
            <div className="text-[11px] text-[#8A92A6] truncate">
              {goal === "clicks" ? "Optimised for clicks" : "Optimised for leads"}{st ? ` · running ${st.age} (since ${st.date})` : ""}{ad.destination ? ` · ${ad.destination}` : ""}
            </div>
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            <button onClick={onBack} className="text-xs font-semibold text-brand border border-brand rounded-lg px-3 py-1.5 bg-white hover:bg-brand-light">← Campaign</button>
            <button onClick={onAll} className="text-[11px] text-[#8A92A6] hover:text-brand">All campaigns</button>
          </div>
        </div>
        {video && (
          // The box hugs the video, so a tall reel has no black bars beside it.
          <div className="relative mb-3 mx-auto w-fit max-w-full rounded-xl overflow-hidden bg-black">
            {video.kind === "video"
              ? <SoundVideo src={video.url} poster={video.poster || undefined} open loop={false} className="block max-h-[420px] w-auto max-w-full" />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={video.url} alt="" className="block max-h-[420px] w-auto max-w-full" loading="lazy" decoding="async" />}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {tile(fmtINR(ad.spend), "spent")}
          {tile(untracked ? "—" : fmtNum(n), `${word}s`)}
          {tile(untracked || n === 0 ? "—" : fmtPer(per), `per ${word}`)}
        </div>
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-100">
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2.5 items-start px-3.5 py-2.5 text-[13px] text-[#232D42] leading-relaxed">
              {l.tone === "good" ? <IconCircleCheck size={16} className="text-[#1AA053] mt-0.5 shrink-0" />
                : l.tone === "warn" ? <IconAlertTriangle size={16} className="text-[#F16A1B] mt-0.5 shrink-0" />
                : <span className="w-4 shrink-0" />}
              <span>{l.text}</span>
            </div>
          ))}
        </div>
        {siblings.length > 1 && (
          <div className="mt-3 bg-white rounded-xl border border-gray-100">
            <div className="px-3.5 py-2 text-[11px] uppercase tracking-wide text-[#8A92A6]">Other ads in this campaign</div>
            {siblings.filter((x) => x.ad_id !== ad.ad_id).sort((x, y) => y.spend - x.spend).slice(0, 6).map((x) => {
              const xn = goal === "clicks" ? x.clicks : x.leads;
              return (
                <div key={x.ad_id} className="flex items-center gap-2 px-3.5 py-2 border-t border-gray-100 text-[12.5px]">
                  <span className="flex-1 truncate text-[#232D42]">{x.ad_name}</span>
                  <span className="tabular-nums text-[#8A92A6]">{fmtINR(x.spend)}</span>
                  <span className="tabular-nums text-[#8A92A6] w-24 text-right">{xn > 0 ? `${fmtPer(goal === "clicks" ? x.costPerClick : x.costPerLead)}/${word}` : `no ${word}s`}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- AI Ads Analyst ----------------
type Diag = { key: string; label: string; status: "good" | "warn" | "crit"; evidence: string; fix: string; campaigns: string[] };
type AnalystData = {
  // Absent on the single-campaign payload, which carries `stats` instead.
  totals?: { spend: number; campaigns: number; leads: number; avgCPL: number; days: number };
  best?: { name: string; cpl: number } | null;
  worst?: { name: string; cpl: number } | null;
  diagnostics: Diag[];
  table?: { name: string; spend: number; leads: number; cpl: number; vsAvg: number | null; frequency: number; ctr: number }[];
  // Single-campaign mode.
  campaign?: string;
  notRunning?: boolean;
  stats?: { goal?: "clicks"; clicks?: number; cpc?: number; liveAvgCPC?: number; spend: number; leads: number; cpl: number; vsAvgPct: number | null; liveAvgCPL: number; frequency: number; ctr: number; cpm: number };
  summary: { verdict: string; recommendations: { title: string; detail: string }[] };
  // How many campaigns the advice actually covers, and how many were skipped for
  // being switched off — so the header can say so instead of implying it read all.
  liveCount?: number;
  stoppedCount?: number;
  aiUsed: boolean;
  error?: string;
};

const SEV: Record<Diag["status"], { chip: string; Icon: typeof IconAlertTriangle }> = {
  good: { chip: "bg-emerald-50 text-emerald-700", Icon: IconCircleCheck },
  warn: { chip: "bg-amber-50 text-amber-700", Icon: IconAlertTriangle },
  crit: { chip: "bg-rose-50 text-rose-700", Icon: IconAlertTriangle },
};
// Plain-English "what this means" for each diagnostic — for someone new to ads.
const DIAG_EXPLAIN: Record<string, string> = {
  fatigue: "The same people are seeing your ad too many times. After about 3–4 views most people start ignoring it (some get annoyed), so you keep paying but get fewer clicks and leads.",
  cpl: "“Cost per lead” is how much you pay for one person's contact details. When it's much higher than your other ads, you're overpaying for the same result — that money would go further elsewhere.",
  learning: "When an ad is brand new, Facebook needs about 50 leads before it learns who to show it to. Until then results bounce around — so don't judge it or edit it yet, or it starts over.",
  pacing: "The ad isn't spending the full daily budget you set, so it's reaching fewer people than it could. Usually the bid is too low or the audience is too narrow.",
  ctr: "“Click-through rate” is the share of people who clicked after seeing the ad. A low number means the picture or opening line isn't catching attention.",
  cpm: "“CPM” is what it costs to show your ad to 1,000 people. A high CPM means it's expensive just to reach your audience — often because several ads are chasing the same people.",
  ok: "No problems found — your ads are running in a healthy range.",
};

// Perplexity returns light markdown (**bold**). Render **…** as real bold and drop any
// stray asterisks, so figures like **₹144,640** read bold instead of showing literal **.
function md(text: string) {
  if (!text) return text;
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(p);
    return m
      ? <strong key={i} className="font-semibold text-[#232D42]">{m[1]}</strong>
      : <span key={i}>{p.replace(/\*\*/g, "")}</span>;
  });
}

// Ordered recommendations use numbered badges (professional), not emoji.
function RecBadge({ n }: { n: number }) {
  return <span className="shrink-0 w-5 h-5 rounded-md bg-brand-light text-brand text-[11px] font-bold flex items-center justify-center mt-px">{n}</span>;
}

function AdsAnalyst({ range, campaign, onClear }: {
  range: { from: string; to: string };
  // When set, the panel describes this one campaign instead of the account.
  campaign?: string | null;
  onClear?: () => void;
}) {
  const qs = new URLSearchParams({ from: range.from, to: range.to, ...(campaign ? { campaign } : {}) }).toString();
  const { data } = useApi<AnalystData>(`/api/ads/analyst?${qs}`);
  const [open, setOpen] = useState(false);
  const [openDiag, setOpenDiag] = useState<string | null>(null);
  const [openRec, setOpenRec] = useState<number | null>(0);
  // Selecting a campaign refetches; without this the whole panel vanished for a
  // second and the layout jumped.
  if (!data && campaign) {
    return (
      <div className="rounded-2xl border-[1.5px] border-brand overflow-hidden h-full" style={{ background: "linear-gradient(180deg,#E9ECFB,#ffffff)" }}>
        <div className="px-5 py-4 text-[12.5px] text-[#8A92A6]">Reading “{campaign}”…</div>
      </div>
    );
  }
  if (!data || data.error || !data.summary) return null;

  return (
    <>
      <div className="rounded-2xl border-[1.5px] border-brand overflow-hidden mb-4" style={{ background: "linear-gradient(180deg,#E9ECFB,#ffffff)" }}>
        <div className="px-5 py-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-8 h-8 rounded-lg bg-brand text-white flex items-center justify-center shrink-0"><IconSparkles size={18} stroke={1.8} /></span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#232D42] truncate">
                {data.campaign || "AI Ads Analyst"}
              </div>
              {/* "updated daily" was wrong on both counts — the analyst caches for 6 hours,
                  and it only ever covers campaigns that are still switched on. Say both,
                  since the whole complaint was advice about an already-stopped campaign. */}
              <div className="text-[11px] text-brand-ink truncate">
                {data.campaign
                  ? <>This campaign only · {data.aiUsed ? "Perplexity" : "computed"} from your live ad data</>
                  : <>
                      {data.aiUsed ? "Perplexity · grounded on your live ad data" : "Computed from your live ad data"}
                      {typeof data.liveCount === "number" ? ` · ${data.liveCount} running campaign${data.liveCount === 1 ? "" : "s"}` : ""}
                      {data.stoppedCount ? ` · ${data.stoppedCount} stopped one${data.stoppedCount === 1 ? "" : "s"} ignored` : ""}
                    </>}
              </div>
            </div>
            {data.campaign
              ? <button onClick={() => onClear?.()} className="ml-auto text-xs font-semibold text-brand border border-brand rounded-lg px-3 py-1.5 bg-white hover:bg-brand-light shrink-0">← All campaigns</button>
              : <button onClick={() => setOpen(true)} className="ml-auto text-xs font-semibold text-brand border border-brand rounded-lg px-3 py-1.5 bg-white hover:bg-brand-light shrink-0">View full report →</button>}
          </div>

          {data.stats && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { l: "spent", v: fmtINR(data.stats.spend) },
                ...(data.stats.goal === "clicks"
                  ? [{ l: "clicks", v: fmtNum(data.stats.clicks || 0) }, { l: "per click", v: fmtPer(data.stats.cpc || 0) }]
                  : [{ l: "leads", v: fmtNum(data.stats.leads) }, { l: "per lead", v: fmtINR(data.stats.cpl) }]),
              ].map((x) => (
                <div key={x.l} className="bg-white border border-gray-100 rounded-lg px-3 py-2">
                  <div className="text-[15px] font-semibold text-[#232D42] tabular-nums">{x.v}</div>
                  <div className="text-[10.5px] text-[#8A92A6]">{x.l}</div>
                </div>
              ))}
            </div>
          )}
          {/* How this campaign sits against the others still running — the only
              comparison that tells you whether its cost is actually a problem. */}
          {data.stats && data.stats.vsAvgPct !== null && (
            <div className={`text-[11.5px] mb-3 ${data.stats.vsAvgPct > 0 ? "text-[#C0392B]" : "text-[#2F9E6F]"}`}>
              {data.stats.goal === "clicks"
                ? (data.stats.vsAvgPct > 0
                  ? `${data.stats.vsAvgPct}% more expensive per click than the ${fmtPer(data.stats.liveAvgCPC || 0)} average across the running click campaigns.`
                  : `${Math.abs(data.stats.vsAvgPct)}% cheaper per click than the ${fmtPer(data.stats.liveAvgCPC || 0)} average across the running click campaigns.`)
                : data.stats.vsAvgPct > 0
                ? `${data.stats.vsAvgPct}% more expensive per lead than the ${fmtINR(data.stats.liveAvgCPL)} average across everything running.`
                : `${Math.abs(data.stats.vsAvgPct)}% cheaper per lead than the ${fmtINR(data.stats.liveAvgCPL)} average across everything running.`}
            </div>
          )}

          <div className="text-[13px] text-[#232D42] bg-white border border-gray-100 rounded-lg px-3 py-2.5 mb-3 leading-relaxed">{md(data.summary.verdict)}</div>

          <div className="space-y-1.5">
            {data.summary.recommendations.map((r, i) => { const on = openRec === i; return (
              <div key={i} className="bg-white border border-gray-100 rounded-lg overflow-hidden">
                <button onClick={() => setOpenRec(on ? null : i)} className="w-full flex gap-2.5 items-center text-left px-3 py-2 hover:bg-gray-50/60 transition-colors">
                  <RecBadge n={i + 1} />
                  <span className="flex-1 text-[12.5px] text-gray-800 font-medium">{md(r.title)}</span>
                  <IconChevronDown size={15} className={`text-gray-400 shrink-0 transition-transform ${on ? "rotate-180" : ""}`} />
                </button>
                {on && <div className="px-3 pb-3 pl-[38px] text-[12px] text-gray-600 leading-relaxed">{md(r.detail)}</div>}
              </div>
            ); })}
          </div>

          <div className="mt-3 pt-3 border-t border-brand/20">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-gray-400">Delivery diagnostics</span>
              {data.diagnostics.map((d) => { const I = SEV[d.status].Icon; const on = openDiag === d.key; return (
                <button key={d.key} onClick={() => setOpenDiag(on ? null : d.key)}
                  className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full transition ${SEV[d.status].chip} ${on ? "ring-2 ring-brand/40" : "hover:brightness-95"}`}>
                  <I size={12} stroke={2.2} /> {d.label}{d.campaigns.length ? ` · ${d.campaigns.length}` : ""}
                </button>
              ); })}
              <span className="text-[10px] text-gray-400">— tap a flag to see what it means</span>
            </div>
            {openDiag && (() => { const d = data.diagnostics.find((x) => x.key === openDiag); if (!d) return null; return (
              <div className="mt-2.5 bg-white border border-gray-100 rounded-lg p-3.5">
                <div className="text-[12.5px] font-semibold text-[#232D42] mb-1">{d.label}{d.campaigns.length ? ` — ${d.campaigns.length} campaign${d.campaigns.length === 1 ? "" : "s"} affected` : ""}</div>
                <div className="text-[12px] text-gray-700 leading-relaxed">{DIAG_EXPLAIN[d.key] || d.evidence}</div>
                {d.campaigns.length > 0 && <div className="text-[12px] text-gray-600 mt-1.5"><b className="text-brand-ink font-semibold">Which ones: </b>{d.campaigns.join(", ")}</div>}
                {d.fix && <div className="text-[12px] text-[#232D42] mt-1.5"><b className="text-brand-ink font-semibold">What to do: </b>{d.fix}</div>}
              </div>
            ); })()}
          </div>
        </div>
      </div>

      {open && <AnalystReport data={data} range={range} onClose={() => setOpen(false)} />}
    </>
  );
}

function AnalystReport({ data, range, onClose }: { data: AnalystData; range: { from: string; to: string }; onClose: () => void }) {
  return (
    <Overlay onClose={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl my-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
          <div>
            <div className="text-base font-semibold flex items-center gap-2"><IconSparkles size={18} stroke={1.8} className="text-brand" /> AI Ads Analyst — full report</div>
            <div className="text-xs text-gray-500 mt-0.5">{range.from} → {range.to}{data.totals ? ` · ${data.totals.campaigns} campaigns · ${fmtINR(data.totals.spend)}` : ""} · {data.aiUsed ? "AI narrative on deterministic diagnostics" : "deterministic diagnostics"}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4 bg-[#F6F7FB] rounded-b-2xl">
          {/* Executive summary */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-brand-ink mb-3">Executive summary</div>
            <div className="text-sm text-[#232D42] bg-brand-light border border-brand/15 rounded-lg px-3.5 py-3 leading-relaxed">{md(data.summary.verdict)}</div>
            <div className="mt-3 space-y-1.5">
              {data.summary.recommendations.map((r, i) => (
                <div key={i} className="flex gap-2.5 items-start text-[13px] bg-[#F6F7FB] border border-gray-100 rounded-lg px-3 py-2"><RecBadge n={i + 1} /><span><b className="text-[#232D42]">{md(r.title)}.</b> <span className="text-gray-600">{md(r.detail)}</span></span></div>
              ))}
            </div>
          </div>

          {/* Budget efficiency table */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-brand-ink mb-3">Budget efficiency — where every rupee goes</div>
            <div className="overflow-x-auto border border-gray-100 rounded-xl">
              <table className="w-full text-[13px] min-w-[640px]">
                <thead><tr className="bg-[#F3F5FA] text-[#8A92A6] text-left border-b border-gray-100">
                  <th className="py-2.5 px-3 font-semibold text-[10.5px] uppercase tracking-[0.05em]">Campaign</th>
                  <th className="py-2.5 px-3 font-semibold text-[10.5px] uppercase tracking-[0.05em] text-right">Spend</th>
                  <th className="py-2.5 px-3 font-semibold text-[10.5px] uppercase tracking-[0.05em] text-right">Leads</th>
                  <th className="py-2.5 px-3 font-semibold text-[10.5px] uppercase tracking-[0.05em] text-right">CPL</th>
                  <th className="py-2.5 px-3 font-semibold text-[10.5px] uppercase tracking-[0.05em] text-right">vs avg</th>
                  <th className="py-2.5 px-3 font-semibold text-[10.5px] uppercase tracking-[0.05em] text-right">Freq</th>
                </tr></thead>
                <tbody>
                  {(data.table || []).map((r) => (
                    <tr key={r.name} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors">
                      <td className="py-2.5 px-3 max-w-[280px] truncate" title={r.name}>{r.name}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{fmtINR(r.spend)}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{r.leads || "—"}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-semibold">{r.leads ? fmtINR(r.cpl) : "—"}</td>
                      <td className={`py-2.5 px-3 text-right tabular-nums ${r.vsAvg == null ? "text-gray-300" : r.vsAvg <= 0 ? "text-emerald-600" : "text-rose-600"}`}>{r.vsAvg == null ? "—" : `${r.vsAvg > 0 ? "+" : ""}${r.vsAvg}%`}</td>
                      <td className={`py-2.5 px-3 text-right tabular-nums ${r.frequency > 3.5 ? "text-amber-600 font-semibold" : "text-gray-500"}`}>{r.frequency || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.best && data.worst && data.best.name !== data.worst.name && (
              <div className="flex gap-2 items-start text-[12.5px] text-[#232D42] bg-brand-light border border-brand/15 rounded-lg px-3 py-2.5 mt-3">
                <IconBulb size={16} stroke={1.8} className="text-brand shrink-0 mt-px" />
                <span>Best CPL: <b>{data.best.name}</b> at {fmtINR(data.best.cpl)} · Worst: <b>{data.worst.name}</b> at {fmtINR(data.worst.cpl)}. Shifting budget toward the best campaign lowers blended CPL.</span>
              </div>
            )}
          </div>

          {/* Delivery diagnostics — evidence */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-brand-ink mb-3">Delivery diagnostics — the actual checks (deterministic)</div>
            <div className="space-y-2">
              {data.diagnostics.map((d) => (
                <div key={d.key} className="bg-[#F6F7FB] border border-gray-100 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    {(() => { const I = SEV[d.status].Icon; return (
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full ${SEV[d.status].chip}`}><I size={12} stroke={2.2} /> {d.label}</span>
                    ); })()}
                  </div>
                  <div className="text-[12.5px] text-gray-800"><b className="text-gray-500 font-medium">Proof:</b> {d.evidence}</div>
                  {d.fix && <div className="text-[12px] text-gray-600 mt-1"><b className="text-gray-500 font-medium">Fix:</b> {d.fix}</div>}
                </div>
              ))}
            </div>
            <div className="text-[11px] text-gray-400 mt-3">Each diagnostic is a fixed threshold checked against your live Meta numbers — a flag is true or it doesn&apos;t appear. {data.aiUsed ? "The narrative above is written by Perplexity on top of these numbers." : "The narrative is generated deterministically from these numbers."}</div>
          </div>
        </div>
      </div>
    </Overlay>
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

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50 text-[11px] uppercase tracking-wide text-gray-500 font-medium">
        Daily budget vs yesterday&apos;s spend &middot; {fmtDay(summary.date)}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">
        {/* LEFT: budget context — total + max cap */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 font-medium">Total daily budget</div>
            <div className="text-3xl font-semibold text-gray-900 mt-1 tabular-nums">{fmtINR(totalDailyBudget)}</div>
            <div className="text-[11px] text-gray-500 mt-1">
              across {activeCampaigns.length} active campaign{activeCampaigns.length === 1 ? "" : "s"}
            </div>
          </div>

          {totalDailyBudget > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 font-medium">Max spend cap</div>
              <div className="text-xl font-semibold text-gray-700 mt-1 tabular-nums">{fmtINR(maxSpendCap)}</div>
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
              <div className="text-xs uppercase tracking-wide text-gray-500 font-medium">Total spent yesterday</div>
              {utilization !== null && (
                <div className={`text-[11px] font-semibold tabular-nums ${overBudget ? "text-amber-600" : "text-brand"}`}>
                  {utilization.toFixed(0)}% of budget
                </div>
              )}
            </div>
            <div className="text-3xl font-semibold text-gray-900 mt-1 tabular-nums">{fmtINR(summary.spend)}</div>
            {totalDailyBudget > 0 && (
              // Bar's 100% = Meta's max cap (budget +25%). Blue fill = actual spend,
              // dark tick = the set budget (80% of the track), hatched tail = headroom.
              <div className="relative h-2 bg-gray-100 rounded-full mt-2.5 overflow-hidden" title={`Spent ${fmtINR(summary.spend)} · budget ${fmtINR(totalDailyBudget)} · Meta max ${fmtINR(maxSpendCap)}`}>
                <div className="absolute inset-y-0 right-0 w-1/5" style={{ background: "repeating-linear-gradient(45deg,#C7D0F7,#C7D0F7 3px,transparent 3px,transparent 6px)" }} />
                <div className="absolute inset-y-0 left-0 bg-brand rounded-full transition-all" style={{ width: `${Math.min(100, (summary.spend / maxSpendCap) * 100)}%` }} />
                <div className="absolute inset-y-0 w-px bg-gray-500/60" style={{ left: "80%" }} />
              </div>
            )}
          </div>

          {/* Reach — total across all active campaigns yesterday */}
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 font-medium">Total reach yesterday</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">{fmtNum(summary.reach)}</div>
            <div className="text-[11px] text-gray-500 mt-0.5">unique accounts reached across all active campaigns</div>
          </div>

          {/* Leads — total across all active campaigns yesterday */}
          {hasLeads && (
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 font-medium">Total leads yesterday</div>
              <div className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">{fmtNum(summary.leads)}</div>
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
          // The bar's 100% is Meta's real ceiling (budget + 25% overspend), so the fill
          // shows true utilisation instead of flat-lining at "100%". The set budget sits
          // at 80% of the track (1 / 1.25); the hatched tail is Meta's headroom.
          const max = budget > 0 ? budget * (1 + OVERSPEND_CAP_PCT) : 0;
          const pctOfMax = max > 0 ? Math.min(100, (r.spend / max) * 100) : null;
          const overBudget = budget > 0 && r.spend > budget;
          return (
            <div key={r.campaign_id} className="px-5 py-2.5 grid grid-cols-12 items-center gap-3">
              <div className="col-span-6 min-w-0 flex items-center gap-2">
                <span className={`inline-block w-1.5 h-4 rounded-full ${cat.color} shrink-0`} />
                <span className="text-sm text-gray-900 truncate" title={r.campaign_name}>{r.campaign_name}</span>
                <span className="text-xs text-gray-400 shrink-0">{cat.emoji}</span>
              </div>
              <div className="col-span-2 text-right text-sm font-semibold tabular-nums text-gray-900">{fmtINR(r.spend)}</div>
              <div className="col-span-2 text-right text-[11px] text-gray-500 tabular-nums">
                {budget > 0 ? `of ${fmtINR(budget)}/day` : <span className="text-gray-300">no budget</span>}
              </div>
              <div className="col-span-2">
                {pctOfMax !== null ? (
                  <div className="flex items-center gap-2" title={`Spent ${fmtINR(r.spend)} · budget ${fmtINR(budget)}/day · Meta max ${fmtINR(max)}`}>
                    <div className="relative flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      {/* Meta's +25% headroom (80→100% of the track) */}
                      <div className="absolute inset-y-0 right-0 w-1/5" style={{ background: "repeating-linear-gradient(45deg,#C7D0F7,#C7D0F7 3px,transparent 3px,transparent 6px)" }} />
                      {/* actually spent */}
                      <div className="absolute inset-y-0 left-0 bg-brand rounded-full" style={{ width: `${pctOfMax}%` }} />
                      {/* set-budget marker */}
                      <div className="absolute inset-y-0 w-px bg-gray-500/60" style={{ left: "80%" }} />
                    </div>
                    <div className={`text-xs font-semibold tabular-nums w-8 text-right ${overBudget ? "text-amber-600" : "text-gray-600"}`}>
                      {pctOfMax.toFixed(0)}%
                    </div>
                  </div>
                ) : (
                  <div className="h-2 bg-gray-50 rounded-full" />
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
          <div className="px-5 py-2.5 text-xs uppercase tracking-wide text-gray-500 font-medium">
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
                    <div className="h-full bg-brand rounded-full" style={{ width: topSpend > 0 ? `${(ad.spend / topSpend) * 100}%` : "0%" }} />
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
      <div className="text-xs uppercase tracking-wide text-gray-500 font-medium">{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-0.5 tabular-nums">{value}</div>
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
    <svg width={w} height={h} className="text-brand shrink-0" aria-label="14-day spend trend">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" points={points} />
    </svg>
  );
}

// Auto-classify each campaign into a "Primary Interest" bucket based on keywords in
// its name. Order matters — the FIRST matching rule wins, so put more-specific rules
// higher. Tweak this table when you launch a new campaign theme.
type InterestKey = "amc_australia" | "university_masters" | "mbbs_ug" | "walk_in" | "als" | "samvaya" | "traffic_boost" | "other";
type InterestDef = { key: InterestKey; label: string; emoji: React.ReactNode; color: string; keywords: (string | RegExp)[] };

const INTERESTS: InterestDef[] = [
  // Coordinated palette — a restrained blue-led range (brand family + one warm, one rose)
  // so the category dots read as a considered system, not a random rainbow.
  { key: "amc_australia",       label: "Australia AMC Pathway",    emoji: <IconWorld size={13} stroke={1.8} className="inline -mt-0.5" />, color: "bg-brand",       keywords: ["AMC", "AUS-PGCP", "AHPRA", /\bAustralia\b/i] },
  { key: "university_masters",  label: "University / Masters",     emoji: <IconSchool size={13} stroke={1.8} className="inline -mt-0.5" />, color: "bg-indigo-400",   keywords: ["University Programs", "Masters", "Post-Graduate", /\bPG\b/] },
  { key: "mbbs_ug",             label: "MBBS / Undergrad",         emoji: <IconBook size={13} stroke={1.8} className="inline -mt-0.5" />, color: "bg-sky-500",      keywords: ["MBBS", /\bUG\b/, "Study Abroad"] },
  { key: "walk_in",             label: "Walk-in / Events",         emoji: <IconMapPin size={13} stroke={1.8} className="inline -mt-0.5" />, color: "bg-amber-400",    keywords: ["Walk-in", "Walk in", "State-wise"] },
  { key: "als",                 label: "ALS Certification",        emoji: <IconHeartbeat size={13} stroke={1.8} className="inline -mt-0.5" />, color: "bg-rose-400",     keywords: ["ALS"] },
  { key: "samvaya",             label: "Samvaya Matrimony",        emoji: <IconHeartHandshake size={13} stroke={1.8} className="inline -mt-0.5" />, color: "bg-violet-400",   keywords: ["Samvaya", "Matrimony"] },
  { key: "traffic_boost",       label: "Traffic / Boosted Posts",  emoji: <IconSpeakerphone size={13} stroke={1.8} className="inline -mt-0.5" />, color: "bg-teal-400",     keywords: ["Traffic Ads", "Instagram post:", "Boosted"] },
];

function classifyCampaign(name: string): InterestDef {
  for (const def of INTERESTS) {
    for (const kw of def.keywords) {
      const matched = typeof kw === "string" ? name.toLowerCase().includes(kw.toLowerCase()) : kw.test(name);
      if (matched) return def;
    }
  }
  return { key: "other", label: "Other / Unclassified", emoji: <IconHelpCircle size={13} stroke={1.8} className="inline -mt-0.5" />, color: "bg-gray-400", keywords: [] };
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
          <PreviewSelect value={statusFilter} onChange={(v) => setStatusFilter(v as typeof statusFilter)} options={[
            { value: "all", label: "All statuses" }, { value: "ACTIVE", label: "Active only" }, { value: "PAUSED", label: "Paused only" },
          ]} />
          <PreviewSelect value={categoryFilter} onChange={(v) => setCategoryFilter(v as typeof categoryFilter)} options={[
            { value: "all", label: "All categories" },
            ...orderedInterests.map((i) => ({ value: i.key, label: i.label })),
            ...(presentCategories.has("other") ? [{ value: "other", label: "Other / Unclassified" }] : []),
          ]} />
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
                    {c.campaign_id === topId && <span className="mr-1" title="Top performer"><IconTrophy size={13} stroke={1.8} className="inline -mt-0.5 text-amber-500" /></span>}
                    <span className="text-brand hover:underline">{c.campaign_name}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-700">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${cat.color}`} />
                      {cat.emoji} {cat.label}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-block text-xs uppercase tracking-wide px-1.5 py-0.5 rounded ${
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
            <div className="text-xs text-gray-500 mt-0.5">{sub}</div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-baseline justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 font-medium">Spend</div>
            <div className="text-base font-semibold text-gray-900 tabular-nums">{fmtINR(spend)}</div>
          </div>
          {showLeads && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                {leads > 0 ? "Cost / Lead" : "Leads"}
              </div>
              <div className="text-base font-semibold text-gray-900 tabular-nums">
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
  // Campaign-average CPL — the baseline each ad's AI suggestion compares against.
  // Uses the mean of the ads' own costPerLead (same metric as ad.costPerLead), so the
  // comparison is apples-to-apples, not spend/leads vs Meta's cost_per_action.
  const avgCpl = ads && ads.length ? (() => { const v = ads.filter((x) => x.leads > 0 && x.costPerLead > 0).map((x) => x.costPerLead); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; })() : 0;

  return (
    <Overlay onClose={onClose} className="fixed inset-0 z-[300] flex items-end md:items-center justify-center bg-black/40">
      <div
        className="bg-white w-full md:max-w-5xl md:rounded-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-brand/10 bg-brand-light flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-lg bg-brand text-white flex items-center justify-center shrink-0"><IconSparkles size={19} stroke={1.8} /></span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-brand-ink uppercase tracking-wide">Campaign · AI report</div>
              <div className="text-base font-semibold text-[#232D42] truncate">{campaign.campaign_name}</div>
              <div className="text-xs text-brand-ink/70 mt-0.5">
                {fmtINR(campaign.spend)} spend &middot; {fmtNum(campaign.impressions)} impressions
                {campaign.leads > 0 && <> &middot; {fmtNum(campaign.leads)} leads @ {fmtINR(campaign.costPerLead)}</>}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-brand-ink/50 hover:text-brand-ink text-xl px-2 shrink-0">×</button>
        </div>

        <div className="overflow-y-auto p-6 bg-[#F6F7FB]">
          {loading && <LoadingBlock label="Loading ads…" />}
          {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</div>}
          {ads && ads.length === 0 && <div className="text-sm text-gray-500">No ads in this range.</div>}
          {ads && ads.length > 0 && (
            <div className="space-y-3">
              {ads.map((ad) => (
                <div
                  key={ad.ad_id}
                  className={`flex gap-4 p-4 border rounded-xl ${ad.ad_id === topAdId ? "border-brand bg-brand-light" : "border-gray-100 bg-white"}`}
                >
                  {ad.creative_thumbnail ? (
                    <img src={ad.creative_thumbnail} alt="" className="w-24 h-24 rounded-lg object-cover bg-gray-100 flex-shrink-0" loading="lazy" decoding="async" />
                  ) : (
                    <div className="w-24 h-24 rounded-lg bg-gray-100 flex-shrink-0 flex items-center justify-center text-xs text-gray-400">No preview</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {ad.ad_id === topAdId && <IconTrophy size={15} stroke={1.8} className="text-brand shrink-0" />}
                      <div className="font-medium truncate text-[#232D42]" title={ad.ad_name}>{ad.ad_name}</div>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">Ad set: {ad.adset_name}</div>
                    {(() => { const fl = flightLabel(ad); return fl ? (
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${fl.active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                          {fl.active ? <IconPlayerPlay size={12} stroke={2} className="inline -mt-0.5" /> : <IconPlayerStop size={12} stroke={2} className="inline -mt-0.5" />} {fl.text}
                        </span>
                        {ad.objective && <span className="text-[11px] text-gray-500">{OBJECTIVE_LABEL[ad.objective] || ad.objective}</span>}
                      </div>
                    ) : null; })()}
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
                    {/* Per-ad AI read — beginner-friendly: what it means + what to do */}
                    {(() => { const s = adSuggestion(ad, avgCpl); return (
                      <div className="mt-3 bg-brand-light border border-brand/15 rounded-lg px-3.5 py-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <IconSparkles size={15} stroke={1.8} className="text-brand shrink-0" />
                          <span className="text-[12.5px] font-semibold text-brand-ink">AI read · {s.headline}</span>
                        </div>
                        <div className="text-[12px] text-[#232D42] leading-relaxed">{s.explain}</div>
                        <div className="text-[12px] text-[#232D42] leading-relaxed mt-1.5"><b className="text-brand-ink font-semibold">What to do: </b>{s.action}</div>
                      </div>
                    ); })()}
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
    </Overlay>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-gray-400 uppercase tracking-wide" style={{ fontSize: 12 }}>{label}</div>
      <div className="font-medium text-gray-900">{value}</div>
    </div>
  );
}
