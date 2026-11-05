"use client";
import { IconShoppingBag } from "@tabler/icons-react";
import { useState, useEffect } from "react";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { LoadingBlock } from "@/components/LoadingBlock";

type CompetitorAd = {
  ad_archive_id: string;
  page_name: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  ad_text: string | null;
  cta_text: string | null;
  cta_url: string | null;
  images: string[];
  videos: string[];
  video_posters: string[];
  permalink: string | null;
  publisher_platforms: string[];
};

const PRESETS = [
  { label: "IMG Education", queries: ["MBBS abroad", "Study medicine abroad", "NEET PG"] },
  { label: "Matrimony", queries: ["Matrimony India", "Brahmin matrimony", "wedding match"] },
  { label: "Test Prep", queries: ["NEET coaching", "JEE coaching", "career counselling"] },
];

export default function CompetitorsPage() {
  return (
    <PreviewDashboardShell active="competitors" title="Competitor Ads" hideAccountPicker hideRange subtitle="Search the Meta Ad Library to see the ads your competitors are running right now.">
      {() => <Competitors />}
    </PreviewDashboardShell>
  );
}

function Competitors() {
  const [query, setQuery] = useState("MBBS abroad");
  const [country, setCountry] = useState("IN");
  const [activeOnly, setActiveOnly] = useState(true);
  const [fullCreative, setFullCreative] = useState(false);
  const [ads, setAds] = useState<CompetitorAd[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ source: "cache" | "live"; cacheAge: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [hideDPA, setHideDPA] = useState(true);
  const [exactAdvertiser, setExactAdvertiser] = useState(false);
  const [usage, setUsage] = useState<{ usedUsd: number; limitUsd: number } | null>(null);

  // "Exact advertiser" → keep only ads whose page name contains every word of
  // the query (so "GooCampus Edu" shows only GooCampus Edu, not every ad that
  // merely matched "edu"). Off → broad keyword results.
  const matchesAdvertiser = (name: string) => {
    const q = (searchedQuery || "").trim().toLowerCase();
    if (!q) return true;
    const n = name.toLowerCase();
    return q.split(/\s+/).filter(Boolean).every((w) => n.includes(w));
  };

  useEffect(() => {
    fetch("/api/competitors/usage")
      .then((r) => r.json())
      .then((d) => { if (typeof d.usedUsd === "number") setUsage({ usedUsd: d.usedUsd, limitUsd: d.limitUsd }); })
      .catch(() => {});
  }, []);

  const syncFromApify = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/competitors/sync", { method: "POST" });
      const d = await res.json();
      if (d.error) setSyncResult(`Error: ${d.error}`);
      else setSyncResult(`Synced ${d.uniqueQueriesSynced} unique queries from ${d.totalRunsFound} past scans. No new cost.`);
    } catch (e) {
      setSyncResult(`Error: ${String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const search = async (q?: string, force = false) => {
    const finalQ = (q ?? query).trim();
    if (!finalQ) return;
    setLoading(true);
    setError(null);
    setSearchedQuery(finalQ);
    try {
      const qs = new URLSearchParams({ q: finalQ, country, active: String(activeOnly), limit: "30", full: String(fullCreative) });
      if (force) qs.set("force", "true");
      const res = await fetch(`/api/competitors?${qs}`);
      const d = await res.json();
      if (d.error) {
        setError(d.error);
        setAds(null);
        setMeta(null);
      } else {
        setAds(d.ads);
        setMeta({ source: d.source, cacheAge: d.cacheAge });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium">Search Facebook Ad Library</div>
            {usage && (() => {
              const pct = usage.limitUsd > 0 ? Math.min(100, (usage.usedUsd / usage.limitUsd) * 100) : 0;
              const tone = pct >= 80 ? "bg-red-50 text-red-700 border-red-200" : pct >= 50 ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200";
              return (
                <span
                  className={`text-[11px] rounded-full border px-2 py-0.5 ${tone}`}
                  title={`Apify scraper usage this billing cycle — ${pct.toFixed(0)}% of the free monthly budget. Live searches cost a few cents each; cached results are free.`}
                >
                  Apify credits: ${usage.usedUsd.toFixed(2)} / ${usage.limitUsd.toFixed(0)} used
                </span>
              );
            })()}
          </div>
          <button
            onClick={syncFromApify}
            disabled={syncing}
            className="text-xs rounded-full bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 px-3 py-1 disabled:opacity-50"
            title="Pull all your past competitor scans into the dashboard. Free — reuses already-fetched data."
          >
            {syncing ? "Syncing…" : "↻ Sync past competitor scans (free)"}
          </button>
        </div>
        {syncResult && (
          <div className="text-xs mb-3 px-3 py-2 rounded bg-amber-50 border border-amber-200 text-amber-800">{syncResult}</div>
        )}
        <div className="flex flex-col md:flex-row gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Competitor brand, keyword, or page name…"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <PreviewSelect value={country} onChange={setCountry} options={[
            { value: "IN", label: "India" },
            { value: "ALL", label: "All countries" },
            { value: "US", label: "United States" },
            { value: "GB", label: "United Kingdom" },
            { value: "AU", label: "Australia" },
            { value: "AE", label: "UAE" },
          ]} />
          <label className="flex items-center gap-2 text-xs text-gray-600 px-2">
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            Active only
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-600 px-2" title="Show only ads from the advertiser you typed (exact page name). Turn off for a broad keyword search.">
            <input type="checkbox" checked={exactAdvertiser} onChange={(e) => setExactAdvertiser(e.target.checked)} />
            Exact advertiser
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-600 px-2" title="Pulls per-variant creatives for catalog ads (a heavier scan).">
            <input type="checkbox" checked={fullCreative} onChange={(e) => setFullCreative(e.target.checked)} />
            Full creative
          </label>
          <button
            onClick={() => search()}
            disabled={loading}
            className="rounded-lg bg-brand text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {PRESETS.map((p) => (
            <div key={p.label} className="flex items-center gap-1">
              <span className="text-gray-500">{p.label}:</span>
              {p.queries.map((q) => (
                <button
                  key={q}
                  onClick={() => { setQuery(q); search(q); }}
                  className="rounded-full bg-gray-100 hover:bg-brand-light hover:text-brand px-2.5 py-1"
                >
                  {q}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-4 rounded-lg mb-4">
          {error}
        </div>
      )}

      {searchedQuery && !loading && !error && ads && (() => {
        const real = ads.filter((a) => !(a.ad_text && /\{\{[^}]+\}\}/.test(a.ad_text)));
        const dpaCount = ads.length - real.length;
        const shownReal = exactAdvertiser ? real.filter((a) => matchesAdvertiser(a.page_name)) : real;
        const realCount = shownReal.length;
        return (
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-xs text-gray-500">
              {realCount} {exactAdvertiser ? "" : "real "}{realCount === 1 ? "ad" : "ads"}
              {exactAdvertiser ? " from " : " for "}&ldquo;{searchedQuery}&rdquo;
              {dpaCount > 0 && (
                <>
                  {" "}&middot;{" "}
                  <button
                    onClick={() => setHideDPA(!hideDPA)}
                    className="underline hover:text-gray-900"
                  >
                    {hideDPA ? `+ ${dpaCount} catalog ads hidden` : `Hide ${dpaCount} catalog ads`}
                  </button>
                </>
              )}
              {meta && (
                <>
                  {" "}&middot;{" "}
                  <span className={meta.source === "cache" ? "text-gray-500" : "text-green-600"}>
                    {meta.source === "cache" ? `cached ${meta.cacheAge}` : `live · just scraped`}
                  </span>
                </>
              )}
            </div>
            <button
              onClick={() => search(searchedQuery, true)}
              className="text-xs rounded-full border border-gray-200 px-3 py-1 hover:bg-gray-50"
              title="Force a fresh scan — bypasses the 7-day cache."
            >
              ↻ Refresh now
            </button>
          </div>
        );
      })()}

      {loading && <LoadingBlock label="Loading… live scrapes take 10-30s, cache hits are instant" />}

      {ads && ads.length === 0 && !loading && (
        <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-6 text-center">No ads found. Try a different query or country.</div>
      )}

      {ads && ads.length > 0 && (() => {
        let visible = hideDPA
          ? ads.filter((a) => !(a.ad_text && /\{\{[^}]+\}\}/.test(a.ad_text)))
          : ads;
        if (exactAdvertiser) visible = visible.filter((a) => matchesAdvertiser(a.page_name));
        if (visible.length === 0 && exactAdvertiser) {
          return (
            <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-6 text-center">
              No ads from an advertiser named &ldquo;{searchedQuery}&rdquo;. Uncheck &ldquo;Exact advertiser&rdquo; to see all keyword matches, or check the exact page name spelling.
            </div>
          );
        }
        if (visible.length === 0) {
          return (
            <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-6 text-center">
              All {ads.length} results are catalog (DPA) ads. Click &ldquo;+ catalog ads hidden&rdquo; above to show them.
            </div>
          );
        }
        return (
          <div className="columns-1 md:columns-2 lg:columns-3 gap-4">
            {visible.map((ad) => (
              <div key={ad.ad_archive_id} className="break-inside-avoid mb-4">
                <AdCard ad={ad} />
              </div>
            ))}
          </div>
        );
      })()}

      {!ads && !loading && !error && (
        <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-6">
          Enter a competitor name, brand, or keyword above and click Search. Results come from Meta&apos;s public Ad Library.
        </div>
      )}
    </>
  );
}

function CreativeMedia({
  vid, img, poster, isDPA, permalink,
}: {
  vid: string | undefined;
  img: string | undefined;
  poster: string | undefined;
  isDPA: boolean;
  permalink: string | null;
}) {
  const [videoFailed, setVideoFailed] = useState(false);

  const renderImage = (src: string) => (
    <div className="bg-gray-50 mx-auto w-fit max-w-full">
      <img src={src} alt="" className="block w-auto max-w-full max-h-[70vh]" loading="lazy" decoding="async" />
    </div>
  );

  if (vid && !videoFailed) {
    return (
      <div className="bg-black mx-auto w-fit max-w-full">
        <video
          src={vid}
          poster={poster || undefined}
          controls
          autoPlay
          playsInline
          preload="metadata"
          className="block w-auto max-w-full max-h-[70vh]"
          onError={() => setVideoFailed(true)}
        />
      </div>
    );
  }

  if (vid && videoFailed && poster) {
    return (
      <div className="bg-gray-50 mx-auto w-fit max-w-full relative">
        <img src={poster} alt="" className="block w-auto max-w-full max-h-[70vh]" loading="lazy" decoding="async" />
        <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
          Video URL expired — {permalink ? <a href={permalink} target="_blank" rel="noreferrer" className="underline">open in Ad Library</a> : "open in Ad Library"}
        </div>
      </div>
    );
  }

  if (img) return renderImage(img);
  if (poster) return renderImage(poster);

  if (isDPA) {
    return (
      <div className="bg-gradient-to-br from-amber-50 to-orange-50 px-4 py-3 flex items-center gap-3 text-xs">
        <div className="text-xl flex-shrink-0"><IconShoppingBag size={22} stroke={1.6} className="text-gray-400" /></div>
        <div>
          <div className="font-medium text-amber-700">Catalog (Dynamic Product) Ad</div>
          <div className="text-amber-600 text-[11px]">Creative is per-product — enable &ldquo;Full creative&rdquo; or open in Ad Library.</div>
        </div>
      </div>
    );
  }

  return <div className="bg-gray-50 px-4 py-3 text-xs text-gray-500">No creative captured for this ad.</div>;
}

function AdCard({ ad }: { ad: CompetitorAd }) {
  const img = ad.images?.[0];
  const vid = ad.videos?.[0];
  const poster = ad.video_posters?.[0];
  const isDPA = !!(ad.ad_text && /\{\{[^}]+\}\}/.test(ad.ad_text));

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="text-sm font-medium truncate" title={ad.page_name}>{ad.page_name}</div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${ad.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
          {ad.is_active ? "Active" : "Inactive"}
        </span>
      </div>
      <CreativeMedia vid={vid} img={img} poster={poster} isDPA={isDPA} permalink={ad.permalink} />

      <div className="p-4 flex-1 flex flex-col">
        {ad.ad_text && !isDPA && (
          <p className="text-xs text-gray-700 line-clamp-4 mb-2 whitespace-pre-wrap">{ad.ad_text}</p>
        )}
        {ad.ad_text && isDPA && (
          <p className="text-[11px] text-gray-400 italic line-clamp-1 mb-2">Template: {ad.ad_text}</p>
        )}
        {ad.cta_text && (
          <div className="text-xs mb-2">
            <span className="font-medium">CTA:</span> {ad.cta_text}
            {ad.cta_url && (
              <a href={ad.cta_url} target="_blank" rel="noreferrer" className="text-brand hover:underline ml-1 truncate inline-block max-w-[160px] align-bottom">
                {new URL(ad.cta_url).hostname}
              </a>
            )}
          </div>
        )}
        <div className="text-xs text-gray-500 mt-auto">
          {ad.start_date && <span>Started {ad.start_date}</span>}
          {ad.publisher_platforms.length > 0 && (
            <span className="ml-2">&middot; {ad.publisher_platforms.join(", ")}</span>
          )}
        </div>
        {ad.permalink && (
          <a href={ad.permalink} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline mt-2">
            View in Ad Library ↗
          </a>
        )}
      </div>
    </div>
  );
}
