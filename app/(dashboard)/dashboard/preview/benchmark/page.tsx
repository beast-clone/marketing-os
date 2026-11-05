"use client";
import { IconHeart, IconMessageCircle, IconStar, IconTrophy, IconTrash, IconSettings, IconX } from "@tabler/icons-react";
import { confirmDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";
import { SoundVideo } from "@/components/SoundVideo";
import { useCallback, useEffect, useState } from "react";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { LiveIndicator } from "@/components/LiveIndicator";
import { useApi } from "@/lib/use-api";
import { fmtDateShort } from "@/lib/date";

type CompetitorMedia = {
  id: string;
  caption?: string;
  media_type: string;
  thumbnail_url?: string;
  media_url?: string;
  permalink?: string;
  timestamp: string;
  like_count: number;
  comments_count: number;
  children?: { data: { id: string; media_type: string; media_url?: string; thumbnail_url?: string }[] };
};
type Competitor = {
  username: string;
  name?: string;
  biography?: string;
  profile_picture_url?: string;
  followers_count: number;
  follows_count?: number;
  media_count: number;
  recent: CompetitorMedia[];
  avgLikesRecent: number;
  avgCommentsRecent: number;
  engagementRatePct: number;
  postsLast30d: number;
};
type ErrorRow = { error: string; username: string };
type BenchmarkData = {
  niche: string;
  niches: string[];
  queriedAt: string;
  latencyMs: number;
  sourceAccount: { id: string; handle: string };
  competitors: (Competitor | ErrorRow)[];
};

function isError(c: Competitor | ErrorRow): c is ErrorRow {
  return (c as ErrorRow).error !== undefined;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// A tracked competitor carries a manual category + a metrics period (days; 0 = all recent).
type WatchPage = { label: string; url: string };
type Tracked = { handle: string; category: string; period: number; platform?: string; sbu?: string; youtube?: string; name?: string; website?: string; watchPages?: WatchPage[] | null };
type TrackedPatch = { name?: string; website?: string; youtube?: string; watchPages?: WatchPage[] };

// People paste whatever the address bar gave them. Pull the UC… id out of a
// channel URL; anything else is handed back trimmed and the API says if it is wrong.
function ytId(raw: string): string {
  const v = (raw || "").trim();
  if (!v) return "";
  const m = v.match(/channel\/(UC[\w-]{20,})/) || v.match(/^(UC[\w-]{20,})$/);
  return m ? m[1] : v;
}
const PERIODS: { value: number; label: string }[] = [
  { value: 7, label: "7 days" }, { value: 30, label: "30 days" }, { value: 90, label: "90 days" }, { value: 0, label: "All recent" },
];
const periodLabel = (d: number) => PERIODS.find((p) => p.value === d)?.label ?? `${d}d`;

// Recompute a competitor's headline metrics over the last `days` (0 = all recent). Note:
// business_discovery only returns ~25 recent posts, so short windows use whatever falls in them.
function periodMetrics(c: Competitor, days: number) {
  if (!days || !c.recent?.length) return { avgLikes: c.avgLikesRecent, avgComments: c.avgCommentsRecent, er: c.engagementRatePct, posts: c.postsLast30d };
  const cutoff = Date.now() - days * 86_400_000;
  const inP = c.recent.filter((m) => new Date(m.timestamp).getTime() >= cutoff);
  const n = inP.length;
  const avgLikes = n ? Math.round(inP.reduce((s, m) => s + m.like_count, 0) / n) : 0;
  const avgComments = n ? Math.round(inP.reduce((s, m) => s + m.comments_count, 0) / n) : 0;
  const er = c.followers_count > 0 && n > 0 ? ((avgLikes + avgComments) / c.followers_count) * 100 : 0;
  return { avgLikes, avgComments, er, posts: n };
}

export default function BenchmarkPage() {
  return (
    <PreviewDashboardShell active="benchmark" title="Competitors" subtitle="Track competitor Instagram accounts — followers, posting cadence, engagement, and their top-performing posts." hideAccountPicker hideRange>
      {({ accountId, range }) => <BenchmarkInner accountId={accountId} range={range} />}
    </PreviewDashboardShell>
  );
}

function BenchmarkInner({ accountId }: { accountId: string; range: { from: string; to: string } }) {
  const [niche, setNiche] = useState<string>("");
  const [customHandles, setCustomHandles] = useState("");
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [detail, setDetail] = useState<Competitor | null>(null);   // in-dashboard competitor drill-down
  // Which competitor's profile is open, by handle. "" is the overview grid.
  // Asked for as tabs carrying each brand's own logo and name, so adding more
  // trackers stays readable (Praveen, 28 Sept).
  const [profile, setProfile] = useState<string>("");
  // Edit / remove competitors in one list (Praveen, 29 Sep: "there is no option to
  // delete the competitor"). The ✕ on cards only existed in the Tracked grid.
  const [managing, setManaging] = useState(false);
  const [openMedia, setOpenMedia] = useState<CompetitorMedia | null>(null);
  // Tracked competitors are team data, so they are rows now, not localStorage.
  // They used to be saved per browser, which is why "I've added 2-3; now it's not
  // there" (Nandu, 26 Sept) — his list only ever existed in the browser he added it
  // in. Anything still sitting in a browser is lifted to the server once, so nobody
  // loses what they already added.
  const [tracked, setTracked] = useState<Tracked[]>([]);
  const [trackCat, setTrackCat] = useState("");
  const [trackSbu, setTrackSbu] = useState("");
  const [trackYt, setTrackYt] = useState("");
  const [trackPlatform, setTrackPlatform] = useState("instagram");
  const [trackPeriod, setTrackPeriod] = useState(30);
  // Narrow the tracked list. "create another filter for instagram and youtube to
  // choose from" and "filter competitors by Primary Interest" (Manya, 28 Sept).
  const [filterPlatform, setFilterPlatform] = useState("all");
  const [filterSbu, setFilterSbu] = useState("all");
  // false until sql/029_competitors.sql has been run — then this page keeps its old
  // per-browser behaviour instead of silently dropping what people add.
  const [serverTracked, setServerTracked] = useState(true);
  const [trackedReady, setTrackedReady] = useState(false);

  const readLocal = useCallback((): Tracked[] => {
    try {
      const raw = localStorage.getItem(`bm-tracked-${accountId}`);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map((x: unknown) => typeof x === "string" ? { handle: x, category: "Uncategorized", period: 30 } : x as Tracked)
        : [];
    } catch { return []; }
  }, [accountId]);

  const loadTracked = useCallback(async () => {
    try {
      const r = await fetch(`/api/benchmark/tracked?accountId=${encodeURIComponent(accountId)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.available === false) { setServerTracked(false); setTracked(readLocal()); setTrackedReady(true); return; }
      setServerTracked(true);
      const rows: Tracked[] = (j.items || []).map((x: { handle: string; category: string | null; sbu: string | null; period: number; platform: string; youtube?: string | null; name?: string | null; website?: string | null; watchPages?: WatchPage[] | null }) =>
        ({ handle: x.handle, category: x.category || "Uncategorized", period: x.period, platform: x.platform, sbu: x.sbu || "", youtube: x.youtube || "", name: x.name || "", website: x.website || "", watchPages: x.watchPages || null }));
      // One-time lift: whatever this browser still holds that the server doesn't.
      const local = readLocal();
      const known = new Set(rows.map((t) => t.handle.toLowerCase()));
      const missing = local.filter((t) => !known.has(t.handle.toLowerCase()));
      if (missing.length) {
        await fetch("/api/benchmark/tracked", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, items: missing }),
        }).catch(() => {});
        setTracked([...rows, ...missing]);
        setTrackedReady(true);
        try { localStorage.removeItem(`bm-tracked-${accountId}`); } catch { /* private mode */ }
        return;
      }
      setTracked(rows);
      setTrackedReady(true);
    } catch { setServerTracked(false); setTracked(readLocal()); setTrackedReady(true); }
  }, [accountId, readLocal]);
  useEffect(() => { loadTracked(); }, [loadTracked]);

  const saveTracked = async (next: Tracked[], added?: Tracked[]) => {
    setTracked(next);
    if (!serverTracked) { try { localStorage.setItem(`bm-tracked-${accountId}`, JSON.stringify(next)); } catch { /* private mode */ } return; }
    if (added?.length) {
      await fetch("/api/benchmark/tracked", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, items: added }),
      }).catch(() => {});
    }
  };
  const confirmRemove = async (handle: string) => {
    const t = trackedOf(handle);
    const ok = await confirmDialog({
      title: `Remove ${t?.name || "@" + handle}?`,
      body: <>They disappear from Competitors and the Briefing for the whole team. You can add them again any time.</>,
      action: "Remove", danger: true,
    });
    if (!ok) return;
    if (profile.toLowerCase() === handle.toLowerCase()) setProfile("");
    await removeTracked(handle);
  };
  const editTracked = async (handle: string, patch: TrackedPatch) => {
    const r = await fetch("/api/benchmark/tracked", { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, handle, platform: trackedOf(handle)?.platform || "instagram", ...patch }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    await loadTracked();
  };
  const removeTracked = async (handle: string) => {
    const gone = tracked.find((t) => t.handle.toLowerCase() === handle.toLowerCase());
    setTracked(tracked.filter((t) => t.handle.toLowerCase() !== handle.toLowerCase()));
    if (!serverTracked) { try { localStorage.setItem(`bm-tracked-${accountId}`, JSON.stringify(tracked.filter((t) => t.handle.toLowerCase() !== handle.toLowerCase()))); } catch { /* private mode */ } return; }
    await fetch(`/api/benchmark/tracked?accountId=${encodeURIComponent(accountId)}&handle=${encodeURIComponent(handle)}&platform=${encodeURIComponent(gone?.platform || "instagram")}`,
      { method: "DELETE" }).catch(() => {});
  };
  const trackedOf = (handle: string) => tracked.find((t) => t.handle.toLowerCase() === handle.toLowerCase());
  // Only what the two filters allow. An untagged competitor still shows under "All".
  const visibleTracked = tracked.filter((t) =>
    (filterPlatform === "all" || (t.platform || "instagram") === filterPlatform)
    && (filterSbu === "all" || (t.sbu || "") === filterSbu));
  const trackedSbus = Array.from(new Set(tracked.map((t) => (t.sbu || "").trim()).filter(Boolean))).sort();

  // The saved "Tracked" list (niche = "__tracked__") drives its own fetch; otherwise use the
  // niche or a one-off custom lookup. Cache key includes all of these so switching is instant.
  const qs = new URLSearchParams({ accountId });
  if (niche === "__tracked__") {
    qs.set("handles", visibleTracked.map((t) => t.handle).join(","));
  } else {
    if (niche) qs.set("niche", niche);
    if (customHandles.trim()) qs.set("handles", customHandles);
  }
  const { data, error, isLoading, refresh, mutate } = useApi<BenchmarkData>(`/api/benchmark?${qs.toString()}`);
  const loading = isLoading;

  // Manual refetch trigger that also sets the niche/handles (used by the buttons).
  function load(opts?: { niche?: string; handles?: string }) {
    if (opts?.niche !== undefined) setNiche(opts.niche);
    if (opts?.handles !== undefined) setCustomHandles(opts.handles);
    if (!opts) refresh();
  }

  // Save the typed handle(s) with the chosen category + period, then show the Tracked view.
  const addTracked = () => {
    const adds = customHandles.split(",").map((s) => s.replace(/^@/, "").trim()).filter(Boolean);
    if (!adds.length) return;
    const cat = trackCat.trim() || "Uncategorized";
    const have = new Set(tracked.map((t) => t.handle.toLowerCase()));
    const fresh = adds.filter((h) => !have.has(h.toLowerCase()))
      .map((h) => ({ handle: h, category: cat, period: trackPeriod, platform: trackPlatform, sbu: trackSbu.trim(), youtube: ytId(trackYt) }));
    saveTracked([...tracked, ...fresh], fresh);
    setCustomHandles(""); setTrackCat(""); setTrackSbu(""); setTrackYt("");
    setNiche("__tracked__");
  };

  // Open on YOUR competitors when you have any, and only fall back to the built-in
  // list (competitors.json) when you don't. Adding two competitors and still seeing
  // hellomentor / academically after a reload reads as "my additions did nothing"
  // (Praveen, 28 Sept) — they were there, just behind the Tracked chip.
  //
  // Waits for the tracked list to load first: otherwise whichever fetch landed
  // first decided the view, which is how it ended up on the built-in one.
  useEffect(() => {
    if (!trackedReady || niche) return;
    if (tracked.length) setNiche("__tracked__");
    else if (data?.niche) setNiche(data.niche);
  }, [trackedReady, tracked.length, data?.niche, niche]);
  // Arriving from the Briefing scoreboard: ?profile=<handle> opens that brand.
  // Read straight off the URL once, rather than useSearchParams, which would put
  // a Suspense boundary around the whole page for the sake of one string. The
  // tab strip owns the profile from then on.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const h = q.get("profile");
    if (h) setProfile(h.replace(/^@/, ""));
    // The Briefing's "Manage competitors" link opens the manage panel directly.
    if (q.get("manage") === "1") setManaging(true);
  }, []);
  useEffect(() => { if (data) setFetchedAt(Date.now()); }, [data]);
  void mutate;

  const sorted = data
    ? [...data.competitors].sort((a, b) => {
        if (isError(a) && isError(b)) return 0;
        if (isError(a)) return 1;
        if (isError(b)) return -1;
        return b.followers_count - a.followers_count;
      })
    : [];

  const valid = sorted.filter((c): c is Competitor => !isError(c));
  const erValues = valid.map((c) => c.engagementRatePct).filter((v) => v > 0);
  const medianER = erValues.length
    ? [...erValues].sort((a, b) => a - b)[Math.floor(erValues.length / 2)]
    : 0;

  // Best posts across ALL competitors shown, ranked by engagement — the top strip.
  const topPostsAll = valid
    .flatMap((c) => c.recent.map((m) => ({ m, handle: c.username })))
    .filter(({ m }) => m.thumbnail_url || m.media_url)
    .sort((a, b) => (b.m.like_count + b.m.comments_count) - (a.m.like_count + a.m.comments_count))
    .slice(0, 10);

  // Clicking a competitor opens their full profile + all tracked posts IN the dashboard
  // (covers the whole tab) — never a redirect out to Instagram.
  if (detail) return <CompetitorDetail c={detail} medianER={medianER} onBack={() => setDetail(null)} />;

  return (
    <>
      <div className="flex items-end justify-between mb-5">
        <div>
          <h2 className="text-base font-medium text-[#232D42]">Competitors <span className="text-gray-400 text-base font-normal">· {data?.niche || "—"}</span></h2>
          <p className="text-sm text-gray-500 mt-0.5">Public Instagram accounts tracked via Meta&apos;s public data — followers, posting cadence, engagement rate.</p>
        </div>
        <LiveIndicator fetchedAt={fetchedAt} latencyMs={data?.latencyMs ?? null} onRefresh={refresh} loading={loading} error={error ? error.message : null} />
      </div>

      {/* Filter row */}
      <div className="bg-white rounded-xl p-3 mb-5 border border-gray-100 shadow-sm flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500 uppercase tracking-wide pl-1">Niche:</span>
        {(data?.niches || []).map((n) => (
          <button
            key={n}
            onClick={() => { setCustomHandles(""); load({ niche: n }); }}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${
              n === niche
                ? "bg-brand text-white border-brand"
                : "bg-white text-gray-700 border-gray-200 hover:border-brand"
            }`}
          >
            {n}
          </button>
        ))}
        {tracked.length > 0 && (
          <button
            onClick={() => { setCustomHandles(""); setNiche("__tracked__"); }}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${
              niche === "__tracked__" ? "bg-brand text-white border-brand" : "bg-white text-gray-700 border-gray-200 hover:border-brand"
            }`}
          >
            <IconStar size={13} stroke={1.8} className="inline -mt-0.5 mr-1" />Tracked ({visibleTracked.length}{visibleTracked.length !== tracked.length ? ` of ${tracked.length}` : ""})
          </button>
        )}
        {/* Narrow the tracked list by platform and by Primary Interest (Manya,
            28 Sept). Only shown on the Tracked view — they filter nothing else. */}
        {niche === "__tracked__" && tracked.length > 0 && (
          <>
            <PreviewSelect value={filterPlatform} onChange={setFilterPlatform}
              options={[{ value: "all", label: "All platforms" }, { value: "instagram", label: "Instagram" }, { value: "youtube", label: "YouTube" }]} />
            {trackedSbus.length > 0 && (
              <PreviewSelect value={filterSbu} onChange={setFilterSbu}
                options={[{ value: "all", label: "All interests" }, ...trackedSbus.map((x) => ({ value: x, label: x }))]} />
            )}
          </>
        )}
        <span className="text-gray-300 mx-1">|</span>
        <input
          value={customHandles}
          onChange={(e) => setCustomHandles(e.target.value)}
          placeholder="add @handle to track…"
          className="h-9 text-xs px-3 rounded-full border border-gray-200 focus:outline-none focus:border-brand min-w-[190px]"
          onKeyDown={(e) => { if (e.key === "Enter") addTracked(); }}
        />
        {customHandles.trim() && (
          <>
            <input
              value={trackCat}
              onChange={(e) => setTrackCat(e.target.value)}
              placeholder="category"
              className="text-xs px-3 py-1.5 rounded-full border border-gray-200 focus:outline-none focus:border-brand w-32"
              onKeyDown={(e) => { if (e.key === "Enter") addTracked(); }}
            />
            {/* "add a filter for me to select which Primary Interest when I am adding
                the competitor name. Just add a box I will fill up by myself" (Manya,
                28 Sept) — free text on purpose, so a new interest needs no code change. */}
            {/* Paste the channel URL or the UC… id — ytId() takes either. Optional:
                a competitor with no channel simply has no YouTube panel. */}
            <input
              value={trackYt}
              onChange={(e) => setTrackYt(e.target.value)}
              placeholder="YouTube channel (optional)"
              className="text-xs px-3 py-1.5 rounded-full border border-gray-200 focus:outline-none focus:border-brand w-44"
              onKeyDown={(e) => { if (e.key === "Enter") addTracked(); }}
            />
            <input
              value={trackSbu}
              onChange={(e) => setTrackSbu(e.target.value)}
              placeholder="Primary Interest"
              className="text-xs px-3 py-1.5 rounded-full border border-gray-200 focus:outline-none focus:border-brand w-36"
              onKeyDown={(e) => { if (e.key === "Enter") addTracked(); }}
            />
            <PreviewSelect value={trackPlatform} onChange={setTrackPlatform}
              options={[{ value: "instagram", label: "Instagram" }, { value: "youtube", label: "YouTube" }]} />
            <PreviewSelect value={String(trackPeriod)} onChange={(v) => setTrackPeriod(Number(v))} options={PERIODS.map((p) => ({ value: String(p.value), label: p.label }))} />
            <button onClick={addTracked} className="text-xs px-3 py-1.5 rounded-full bg-brand text-white">+ Track</button>
          </>
        )}
      </div>

      {tracked.length > 0 && (
        <div className="flex justify-end mb-2">
          <button onClick={() => setManaging((v) => !v)} className="h-9 px-3.5 rounded-lg border border-gray-200 bg-white text-[13px] text-[#4A5468] hover:border-brand hover:text-brand inline-flex items-center gap-1.5">
            <IconSettings size={15} /> {managing ? "Close" : "Manage competitors"}
          </button>
        </div>
      )}
      {managing && <ManageCompetitors rows={tracked} onSave={editTracked} onRemove={confirmRemove} />}

      {/* One tab per competitor, their own avatar as the logo. Scrolls sideways
          rather than wrapping once there are more than a handful. */}
      {valid.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl p-2 mb-4 overflow-x-auto">
          <div className="flex items-center gap-1.5 min-w-max">
            <button onClick={() => setProfile("")}
              className={`h-10 px-3.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition ${
                !profile ? "bg-brand text-white" : "text-[#4A5468] hover:bg-[#F6F7FB]"}`}>
              All ({valid.length})
            </button>
            {valid.length > 1 && (
              <button onClick={() => setProfile("__compare__")}
                className={`h-10 px-3.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition ${
                  profile === "__compare__" ? "bg-brand text-white" : "text-[#4A5468] hover:bg-[#F6F7FB]"}`}>
                Compare
              </button>
            )}
            {valid.map((c) => (
              <button key={c.username} onClick={() => setProfile(c.username)}
                className={`h-10 pl-1.5 pr-3 rounded-lg text-[13px] font-medium whitespace-nowrap transition inline-flex items-center gap-2 ${
                  profile === c.username ? "bg-brand text-white" : "text-[#4A5468] hover:bg-[#F6F7FB]"}`}>
                {c.profile_picture_url
                  ? <img src={c.profile_picture_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" loading="lazy" decoding="async" />
                  : <span className="w-7 h-7 rounded-full bg-[#EEEDFE] text-[#3C3489] text-[11px] grid place-items-center flex-shrink-0">{c.username.slice(0, 1).toUpperCase()}</span>}
                <span className="max-w-[160px] truncate" title={c.name || c.username}>{c.name || c.username}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-5 text-sm">
          {error.message}
        </div>
      )}

      {loading && !data && (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-400 border border-gray-100">Querying Meta…</div>
      )}

      {/* Summary strip — across everyone shown, so hidden while one profile is open. */}
      {valid.length > 0 && !profile && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
          <SummaryCard label="Competitors tracked" value={valid.length.toString()} />
          <SummaryCard label="Avg followers" value={fmt(Math.round(valid.reduce((s, c) => s + c.followers_count, 0) / valid.length))} />
          <SummaryCard label="Median engagement rate" value={`${medianER.toFixed(2)}%`} />
          <SummaryCard label="Avg posts / 30d" value={(valid.reduce((s, c) => s + c.postsLast30d, 0) / valid.length).toFixed(1)} />
        </div>
      )}

      {/* Top competitor posts — best across everyone shown, so it is hidden while a
          single profile is open: "across all competitors" next to one brand misleads. */}
      {topPostsAll.length > 0 && !profile && (
        <div className="bg-white rounded-2xl p-4 mb-5 border border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-medium text-[#232D42]"><IconTrophy size={16} stroke={1.8} className="inline -mt-0.5 mr-1 text-amber-500" />Top competitor posts</span>
            <span className="text-xs text-gray-400">across all competitors shown · ranked by engagement</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {topPostsAll.map(({ m, handle }, i) => (
              <a
                key={m.id}
                href={m.permalink || "#"}
                target={m.permalink ? "_blank" : undefined}
                rel="noopener noreferrer"
                className="shrink-0 w-[150px]"
              >
                <div className="relative w-[150px] h-[150px] rounded-xl overflow-hidden border border-gray-100 bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.thumbnail_url || m.media_url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  {i === 0 && (
                    <span className="absolute top-2 left-2 bg-amber-500 text-white text-[10px] font-semibold px-2 h-5 grid place-items-center rounded-full shadow"><IconTrophy size={11} stroke={2} className="inline -mt-0.5 mr-0.5" />Top</span>
                  )}
                </div>
                <div className="mt-1.5 text-[12px] font-medium text-[#232D42] truncate">@{handle}</div>
                <div className="text-[11px] text-gray-500 tabular-nums"><IconHeart size={12} stroke={1.8} className="inline -mt-0.5 mr-0.5" />{fmt(m.like_count)} · <IconMessageCircle size={12} stroke={1.8} className="inline -mt-0.5 mr-0.5" />{fmt(m.comments_count)}</div>
              </a>
            ))}
          </div>
        </div>
      )}


      {/* Everyone on the same metrics, us included. */}
      {profile === "__compare__" ? (
        <CompetitorCompare brands={valid} ourHandle={data?.sourceAccount?.handle} accountId={accountId} />
      ) : (
      <>
      {/* One competitor, in full. */}
      {profile && valid.some((c) => c.username === profile) ? (
        <CompetitorProfile c={valid.find((c) => c.username === profile)!} medianER={medianER}
          yt={trackedOf(profile)?.youtube} onOpenPost={(m) => setOpenMedia(m)}
          onRemove={trackedOf(profile) ? () => confirmRemove(profile) : undefined} />
      ) : (<>
      {/* Competitor grid */}
      {niche === "__tracked__" && tracked.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-400 border border-gray-100">No tracked accounts yet — type a handle above and hit <b className="text-gray-600">+ Track</b>.</div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sorted.map((c) => isError(c) ? (
          <div key={c.username} className="bg-white rounded-2xl p-5 border border-amber-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="font-mono text-sm">@{c.username}</div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">error</span>
                {niche === "__tracked__" && <button onClick={() => removeTracked(c.username)} className="text-gray-300 hover:text-rose-500 text-sm leading-none" title="Untrack">✕</button>}
              </div>
            </div>
            <p className="text-xs text-gray-500">Couldn&apos;t pull this account — it may be private, renamed, or a personal profile.</p>
            <p className="text-[11px] text-gray-400 mt-2">Only public Instagram Business or Creator accounts can be tracked.</p>
          </div>
        ) : (
          <CompetitorCard key={c.username} c={c} medianER={medianER} onOpen={() => setDetail(c)} onRemove={niche === "__tracked__" ? () => removeTracked(c.username) : undefined} periodDays={niche === "__tracked__" ? (trackedOf(c.username)?.period ?? 0) : undefined} category={niche === "__tracked__" ? (trackedOf(c.username)?.category) : undefined} />
        ))}
      </div>
      )}
      </>)}
      </>
      )}
    </>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums text-[#232D42]">{value}</div>
    </div>
  );
}

// One competitor, everything we can actually get about them, on one screen.
//
// Instagram is the substance — followers, cadence, engagement, their posts.
// YouTube appears only when that competitor has a channel saved. There is no
// Facebook panel: reading a Page you do not administer needs Meta's Page Public
// Content Access, which this app does not have, and showing an empty box would
// only imply the data is coming.
// The AI route wants facts, not our view model.
function brandOf(c: Competitor): Record<string, unknown> {
  return {
    name: c.name || c.username,
    handle: c.username,
    followers: c.followers_count,
    postsPer30d: c.postsLast30d,
    avgLikes: c.avgLikesRecent,
    avgComments: c.avgCommentsRecent,
    engagementRatePct: c.engagementRatePct,
    // Their actual captions are the only way the model can say anything useful
    // about CONTENT rather than just numbers.
    topPostCaptions: (c.recent || []).slice(0, 5).map((m) => m.caption || "").filter(Boolean),
  };
}

// Every tracked competitor in one list: fix the name, website (watched for new blogs
// and events) or YouTube channel, or remove them. Saves one row at a time.
function ManageCompetitors({ rows, onSave, onRemove }: {
  rows: Tracked[];
  onSave: (handle: string, patch: TrackedPatch) => Promise<void>;
  onRemove: (handle: string) => void;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-4">
      <div className="text-[16px] font-medium text-[#232D42]">Manage competitors</div>
      <div className="text-[12.5px] text-[#8A92A6] mb-3">Changes apply to the whole team — here and on the Briefing.</div>
      <div className="hidden md:grid grid-cols-[1.1fr_1fr_1.3fr_1.3fr_auto] gap-2 text-[11.5px] font-medium text-[#8A92A6] px-1 pb-1">
        <span>Name</span><span>Instagram</span><span>Website</span><span>YouTube channel</span><span />
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map((t) => <ManageRow key={t.handle} t={t} onSave={onSave} onRemove={onRemove} />)}
      </div>
    </div>
  );
}

function ManageRow({ t, onSave, onRemove }: { t: Tracked; onSave: (h: string, p: TrackedPatch) => Promise<void>; onRemove: (h: string) => void }) {
  const [name, setName] = useState(t.name || "");
  const [website, setWebsite] = useState(t.website || "");
  const [yt, setYt] = useState(t.youtube || "");
  const [state, setState] = useState<"" | "saving" | "saved">("");
  const [err, setErr] = useState<string | null>(null);
  const dirty = name !== (t.name || "") || website !== (t.website || "") || yt !== (t.youtube || "");
  const save = async () => {
    setState("saving"); setErr(null);
    try { await onSave(t.handle, { name, website, youtube: ytId(yt) }); setState("saved"); }
    catch (e) { setErr((e as Error).message); setState(""); }
  };
  const inp = "h-9 px-2.5 rounded-lg border border-gray-200 text-[13px] outline-none focus:border-brand w-full";
  return (
    <div className="py-2.5">
      <div className="grid md:grid-cols-[1.1fr_1fr_1.3fr_1.3fr_auto] gap-2 items-center">
        <input className={inp} value={name} onChange={(e) => { setName(e.target.value); setState(""); }} placeholder="Display name" />
        <span className="text-[13px] text-[#4A5468] truncate px-1">@{t.handle}</span>
        <input className={inp} value={website} onChange={(e) => { setWebsite(e.target.value); setState(""); }} placeholder="their-website.com" />
        <input className={inp} value={yt} onChange={(e) => { setYt(e.target.value); setState(""); }} placeholder="Channel URL or UC… id" />
        <div className="flex items-center gap-1.5">
          <button onClick={save} disabled={!dirty || state === "saving"} className="h-9 px-3 rounded-lg bg-brand text-white text-[12.5px] font-medium disabled:opacity-40">
            {state === "saving" ? "Saving…" : state === "saved" && !dirty ? "Saved" : "Save"}
          </button>
          <button onClick={() => onRemove(t.handle)} title="Remove" className="h-9 w-9 rounded-lg border border-gray-200 text-[#C03221] grid place-items-center hover:border-[#C03221]"><IconTrash size={15} /></button>
        </div>
      </div>
      {err && <div className="text-[12px] text-[#C03221] mt-1">{err}</div>}
      {t.website && <WatchPagesEditor t={t} onSave={onSave} />}
    </div>
  );
}

// The website sections watched separately (one tracker each on the Briefing).
// Saved as soon as one is added or removed. None chosen = the watcher picks the
// site's event and blog pages itself.
function WatchPagesEditor({ t, onSave }: { t: Tracked; onSave: (h: string, p: TrackedPatch) => Promise<void> }) {
  const pages = t.watchPages || [];
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const put = async (next: WatchPage[]) => {
    setBusy(true); setErr(null);
    try { await onSave(t.handle, { watchPages: next }); return true; }
    catch (e) { setErr((e as Error).message); return false; } finally { setBusy(false); }
  };
  const add = async () => {
    if (!url.trim()) return;
    if (await put([...pages, { label: label.trim(), url: url.trim() }])) { setLabel(""); setUrl(""); }
  };
  const inp = "h-8 px-2.5 rounded-lg border border-gray-200 text-[12.5px] outline-none focus:border-brand";
  return (
    <div className="mt-2 pl-1">
      <div className="text-[11.5px] text-[#8A92A6] mb-1.5">Website sections watched separately{pages.length ? "" : " — none chosen, so the watcher picks their event and blog pages"}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {pages.map((p, i) => (
          <span key={p.url + i} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full bg-brand-light text-brand text-[12px]" title={p.url}>
            {p.label}
            <button disabled={busy} onClick={() => put(pages.filter((_, j) => j !== i))} title={`Stop watching ${p.label}`} className="w-5 h-5 grid place-items-center rounded-full hover:bg-white/70"><IconX size={12} /></button>
          </span>
        ))}
        <input className={`${inp} w-[130px]`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Section name" />
        <input className={`${inp} w-[240px]`} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Paste the section's link" />
        <button onClick={add} disabled={busy || !url.trim()} className="h-8 px-3 rounded-lg border border-gray-200 text-[12.5px] text-[#232D42] hover:border-brand hover:text-brand disabled:opacity-40">{busy ? "Saving…" : "Add section"}</button>
      </div>
      {err && <div className="text-[12px] text-[#C03221] mt-1">{err}</div>}
    </div>
  );
}

function CompetitorProfile({ c, medianER, yt, onOpenPost, onRemove }: {
  c: Competitor; medianER: number; yt?: string; onOpenPost: (m: CompetitorMedia) => void; onRemove?: () => void;
}) {
  const vsMedian = medianER ? c.engagementRatePct - medianER : 0;
  return (
    <div className="space-y-4">
      {/* Who they are */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-start gap-4 flex-wrap">
          {c.profile_picture_url
            ? <img src={c.profile_picture_url} alt="" className="w-14 h-14 rounded-2xl object-cover flex-shrink-0" loading="lazy" decoding="async" />
            : <span className="w-14 h-14 rounded-2xl bg-[#EEEDFE] text-[#3C3489] text-lg grid place-items-center flex-shrink-0">{c.username.slice(0, 1).toUpperCase()}</span>}
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="text-[17px] font-medium text-[#232D42] leading-tight flex-1">{c.name || c.username}</div>
              {onRemove && (
                <button onClick={onRemove} className="h-8 px-3 rounded-lg border border-gray-200 text-[12.5px] text-[#C03221] hover:border-[#C03221] inline-flex items-center gap-1 shrink-0">
                  <IconTrash size={14} /> Remove
                </button>
              )}
            </div>
            <a href={`https://instagram.com/${c.username}`} target="_blank" rel="noreferrer" className="text-[13px] text-brand hover:underline">@{c.username}</a>
            {c.biography && <p className="text-[13px] text-[#5A6478] mt-1.5 leading-relaxed max-w-2xl">{c.biography}</p>}
          </div>
        </div>
      </div>

      {/* Instagram */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs uppercase tracking-wider font-semibold text-brand">Instagram</span>
          <span className="text-[12px] text-[#8A92A6]">last 30 days</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          <ProfileStat label="Followers" value={fmt(c.followers_count)} />
          <ProfileStat label="Posts / 30d" value={String(c.postsLast30d)} />
          <ProfileStat label="Avg likes" value={fmt(c.avgLikesRecent)} />
          <ProfileStat label="Avg comments" value={fmt(c.avgCommentsRecent)} />
          <ProfileStat label="Eng. rate" value={`${c.engagementRatePct.toFixed(2)}%`}
            hint={medianER ? `${vsMedian >= 0 ? "+" : ""}${vsMedian.toFixed(2)} vs median` : undefined} />
        </div>
        {c.recent.length > 0 && (
          <div className="mt-5">
            <div className="text-[12px] uppercase tracking-wide text-[#8A92A6] mb-2">Recent posts · click to open</div>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {c.recent.slice(0, 12).map((m) => (
                <button key={m.id} onClick={() => onOpenPost(m)} className="relative block rounded-lg overflow-hidden border border-gray-100 hover:border-brand transition">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.thumbnail_url || m.media_url} alt="" className="w-full aspect-square object-cover" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* What the web says about them — Reddit, Quora, reviews and the rest. */}
      <CompetitorIntel name={searchName(c)} />

      {/* The read: what to actually do about them. */}
      <CompetitorAI brands={[brandOf(c)]} mode="profile" />

      {/* YouTube — only when this competitor has a channel saved. */}
      {yt ? <CompetitorYouTube channelId={yt} /> : (
        <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-4 text-[13px] text-[#8A92A6]">
          No YouTube channel saved for {c.name || c.username}. Add the channel ID when you track them and their uploads show here.
        </div>
      )}
    </div>
  );
}

// Everyone side by side on the metrics that matter, with us in the table when we
// can read our own account. The numbers are free — we already have them — so only
// the verdict costs anything, and that is behind a button.
function CompetitorCompare({ brands, ourHandle, accountId }: { brands: Competitor[]; ourHandle?: string; accountId: string }) {
  const own = (ourHandle || "").replace(/^@/, "");
  // Our own account answers the same public endpoint as any competitor, so it can
  // sit in the same table rather than being a special case.
  const { data: usData } = useApi<BenchmarkData>(own ? `/api/benchmark?accountId=${encodeURIComponent(accountId)}&handles=${encodeURIComponent(own)}` : "");
  const us = (usData?.competitors || []).find((c): c is Competitor => !isError(c));
  // Our own handle is usually in the tracked list too — one row for it, not two.
  const others = brands.filter((c) => c.username.toLowerCase() !== own.toLowerCase());
  const rows = [...(us ? [{ c: us, isUs: true }] : []), ...others.map((c) => ({ c, isUs: false }))];
  const best = (pick: (c: Competitor) => number) => Math.max(...rows.map((r) => pick(r.c)));
  const cols: { label: string; pick: (c: Competitor) => number; fmtv: (n: number) => string }[] = [
    { label: "Followers", pick: (c) => c.followers_count, fmtv: fmt },
    { label: "Posts / 30d", pick: (c) => c.postsLast30d, fmtv: (n) => String(n) },
    { label: "Avg likes", pick: (c) => c.avgLikesRecent, fmtv: fmt },
    { label: "Avg comments", pick: (c) => c.avgCommentsRecent, fmtv: fmt },
    { label: "Eng. rate", pick: (c) => c.engagementRatePct, fmtv: (n) => `${n.toFixed(2)}%` },
  ];
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-100 rounded-2xl p-5 overflow-x-auto">
        <div className="text-xs uppercase tracking-wider font-semibold text-brand mb-4">Side by side · last 30 days</div>
        <table className="w-full text-[13px] min-w-[560px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[#8A92A6]">
              <th className="pb-2 font-medium">Account</th>
              {cols.map((col) => <th key={col.label} className="pb-2 font-medium text-right">{col.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(({ c, isUs }) => (
              <tr key={c.username} className={isUs ? "bg-brand-light/40" : ""}>
                <td className="py-2.5 pr-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {c.profile_picture_url
                      ? <img src={c.profile_picture_url} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0" loading="lazy" decoding="async" />
                      : <span className="w-6 h-6 rounded-full bg-[#EEEDFE] text-[#3C3489] text-[10px] grid place-items-center flex-shrink-0">{c.username.slice(0, 1).toUpperCase()}</span>}
                    <span className="truncate text-[#232D42]">{searchName(c)}</span>
                    {isUs && <span className="text-[10.5px] rounded-full px-2 py-0.5 bg-brand text-white flex-shrink-0">us</span>}
                  </div>
                </td>
                {cols.map((col) => {
                  const v = col.pick(c);
                  const top = v > 0 && v === best(col.pick);
                  return (
                    <td key={col.label} className={`py-2.5 text-right tabular-nums ${top ? "font-semibold text-[#232D42]" : "text-[#5A6478]"}`}>
                      {col.fmtv(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!us && (
          <div className="text-[12px] text-[#8A92A6] mt-3">Our own account isn&rsquo;t in the table — it couldn&rsquo;t be read just now.</div>
        )}
      </div>

      {others.length > 0 && <CompetitorAI mode="compare" brands={others.map(brandOf)} us={us ? brandOf(us) : undefined} />}
    </div>
  );
}

// The model answers in light markdown — ## headings, - bullets, **bold** — and
// printing it raw put literal hashes on the page. Full markdown is more than this
// needs, so handle exactly those three and leave everything else as text.
function AiText({ text }: { text: string }) {
  const bold = (t: string) =>
    t.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i} className="font-medium text-[#232D42]">{part}</b> : part));
  const lines = text.split(/\r?\n/);
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    out.push(
      <ul key={`u${out.length}`} className="list-disc pl-5 space-y-1 mb-3">
        {bullets.map((b, i) => <li key={i} className="text-[13.5px] text-[#5A6478] leading-relaxed">{bold(b)}</li>)}
      </ul>,
    );
    bullets = [];
  };
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) { flush(); continue; }
    const head = t.match(/^#{1,4}\s+(.*)$/);
    if (head) {
      flush();
      out.push(<div key={`h${out.length}`} className="text-[13.5px] font-semibold text-[#232D42] mt-4 mb-1.5">{bold(head[1])}</div>);
      continue;
    }
    const bullet = t.match(/^[-*\u2022]\s+(.*)$/);
    if (bullet) { bullets.push(bullet[1]); continue; }
    flush();
    out.push(<p key={`p${out.length}`} className="text-[13.5px] text-[#5A6478] leading-relaxed mb-3">{bold(t)}</p>);
  }
  flush();
  return <div className="[&>*:first-child]:mt-0">{out}</div>;
}

// The read. Not loaded until asked for: it is a paid model call, and most visits
// to a profile are to look at the numbers, not to ask what to do about them.
function CompetitorAI({ brands, us, mode }: { brands: Record<string, unknown>[]; us?: Record<string, unknown>; mode: "profile" | "compare" }) {
  const [state, setState] = useState<{ loading: boolean; text?: string; error?: string; configured?: boolean }>({ loading: false });
  const ask = async (force = false) => {
    setState({ loading: true });
    try {
      const r = await fetch("/api/benchmark/profile-ai", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ mode, brands, us, force }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setState({ loading: false, text: j.text, configured: j.configured });
    } catch (e) { setState({ loading: false, error: (e as Error).message }); }
  };
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-xs uppercase tracking-wider font-semibold text-brand">The read</span>
        <span className="text-[12px] text-[#8A92A6]">{mode === "compare" ? "where we stand, and what to do" : "what to copy, avoid, or do differently"}</span>
        <button onClick={() => ask(state.text ? true : false)} disabled={state.loading}
          className="ml-auto h-8 px-3 rounded-lg border border-gray-200 text-[12.5px] text-[#4A5468] hover:border-brand hover:text-brand disabled:opacity-50">
          {state.loading ? "Thinking…" : state.text ? "Ask again" : "Get the read"}
        </button>
      </div>
      {state.configured === false && <div className="text-[13px] text-[#8A92A6]">No AI key configured.</div>}
      {state.error && <div className="text-[13px] text-rose-600">{state.error}</div>}
      {state.text
        ? <AiText text={state.text} />
        : !state.loading && !state.error && <div className="text-[13px] text-[#8A92A6]">Press <b className="font-medium text-[#232D42]">Get the read</b> — it looks at their numbers, their recent posts and what people say, then tells you what to do about it.</div>}
    </div>
  );
}

// What the web says about one competitor: mentions grouped by where they are,
// and their Google Maps rating.
//
// One search per competitor, cached for a day — Serper is capped at 200 calls a
// month and this panel is on a page people reopen constantly. Nothing renders
// for a lane with no results rather than a row of empty headings.
type Intel = {
  configured?: boolean; capped?: boolean;
  mentions: { title: string; url: string; snippet: string; source: string; lane: string; sentiment: string }[];
  lanes: { key: string; label: string; count: number }[];
  reviews: { title: string; rating: number | null; ratingCount: number | null; items: { rating?: number; snippet?: string; user?: string }[] } | null;
};
const SENTIMENT_TINT: Record<string, string> = {
  positive: "bg-[#E8F6F0] text-[#1F7256]",
  negative: "bg-[#FDECEA] text-[#C03221]",
  neutral: "bg-[#F1F3F8] text-[#5B6472]",
};
// Instagram display names are marketing straplines — "Hello Mentor | India's #1
// Counselling Platform". Searching that verbatim matches nothing, so cut at the
// first separator and keep the brand. Falls back to the handle when what is left
// is too short to be a name.
function searchName(c: Competitor): string {
  const raw = (c.name || "").split(/[|–—·:]/)[0].trim();
  return raw.length >= 3 ? raw : c.username;
}

function CompetitorIntel({ name }: { name: string }) {
  // Off by default: the forum search is a second paid call per competitor.
  const [forums, setForums] = useState(false);
  const { data, isLoading } = useApi<Intel>(
    `/api/benchmark/profile-intel?name=${encodeURIComponent(name)}${forums ? "&forums=1" : ""}`);
  const [lane, setLane] = useState<string>("all");
  if (isLoading) return <div className="bg-white border border-gray-100 rounded-2xl p-5 text-[13px] text-[#8A92A6]">Reading what the web says…</div>;
  if (!data || data.configured === false) return null;
  if (data.capped) {
    return (
      <div className="bg-white border border-amber-200 rounded-2xl p-4 text-[13px] text-[#8A5B12]">
        This month&rsquo;s web-search budget is used up, so mentions aren&rsquo;t being fetched. They&rsquo;ll resume next month, or raise SERPER_MONTHLY_BUDGET.
      </div>
    );
  }
  const shown = lane === "all" ? data.mentions : data.mentions.filter((m) => m.lane === lane);
  if (!data.mentions.length && !data.reviews) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs uppercase tracking-wider font-semibold text-[#079AA2]">What people say</span>
        <span className="text-[12px] text-[#8A92A6]">about {name}</span>
        <button onClick={() => { setForums(!forums); setLane("all"); }}
          title={forums ? "Back to a general web search" : "Searches Reddit, Quora, MouthShut and ValueMD — costs one web search, then cached for a day"}
          className={`ml-auto h-8 px-3 rounded-lg border text-[12.5px] transition ${
            forums ? "border-brand text-brand bg-brand-light" : "border-gray-200 text-[#4A5468] hover:border-brand"}`}>
          {forums ? "Showing forums" : "Search forums"}
        </button>
      </div>

      {data.reviews && (data.reviews.rating != null) && (
        <div className="flex items-baseline gap-2 mb-4 flex-wrap">
          <span className="text-[19px] font-semibold text-[#232D42] tabular-nums">{data.reviews.rating}★</span>
          <span className="text-[12px] text-[#8A92A6]">on Google{data.reviews.ratingCount != null ? ` · ${fmt(data.reviews.ratingCount)} ratings` : ""}</span>
        </div>
      )}

      {data.lanes.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          <button onClick={() => setLane("all")}
            className={`h-7 px-2.5 rounded-full text-[12px] border transition ${
              lane === "all" ? "border-brand text-brand bg-brand-light" : "border-gray-200 text-[#4A5468] hover:border-gray-300"}`}>
            All ({data.mentions.length})
          </button>
          {data.lanes.map((l) => (
            <button key={l.key} onClick={() => setLane(l.key)}
              className={`h-7 px-2.5 rounded-full text-[12px] border transition ${
                lane === l.key ? "border-brand text-brand bg-brand-light" : "border-gray-200 text-[#4A5468] hover:border-gray-300"}`}>
              {l.label} ({l.count})
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {shown.slice(0, 8).map((m) => (
          <a key={m.url} href={m.url} target="_blank" rel="noreferrer"
            className="block border border-gray-100 rounded-xl p-3 hover:border-brand transition">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[11px] text-[#8A92A6]">{m.source}</span>
              <span className={`text-[10.5px] rounded-full px-2 py-0.5 ${SENTIMENT_TINT[m.sentiment] || SENTIMENT_TINT.neutral}`}>{m.sentiment}</span>
            </div>
            <div className="text-[13.5px] text-[#232D42] leading-snug">{m.title}</div>
            {m.snippet && <div className="text-[12px] text-[#5A6478] mt-1 leading-relaxed line-clamp-2">{m.snippet}</div>}
          </a>
        ))}
        {!shown.length && (
          <div className="text-[13px] text-[#8A92A6]">
            {forums ? `No forum threads found for ${name}.` : `Nothing found there for ${name}.`}
          </div>
        )}
      </div>
    </div>
  );
}

// A competitor's YouTube channel. Public data, so an API key is enough.
// Renders nothing at all when the channel id doesn't resolve — an empty panel
// reads as "loading forever" rather than "that id is wrong".
type YtChannel = {
  found: boolean; reason?: string;
  channel?: { id: string; title: string; thumbnail: string; subscribers: number; subscribersHidden: boolean; views: number; videoCount: number };
  videos?: { id: string; title: string; thumbnail: string; publishedAt: string; views: number; url: string }[];
};
function CompetitorYouTube({ channelId }: { channelId: string }) {
  const { data, isLoading } = useApi<YtChannel>(`/api/benchmark/youtube-channel?channelId=${encodeURIComponent(channelId)}`);
  if (isLoading) return <div className="bg-white border border-gray-100 rounded-2xl p-5 text-[13px] text-[#8A92A6]">Reading their YouTube channel…</div>;
  if (!data?.found || !data.channel) {
    return (
      <div className="bg-white border border-amber-200 rounded-2xl p-4 text-[13px] text-[#8A5B12]">
        {data?.reason || "Couldn't read that YouTube channel."} Check the channel ID (it starts with UC).
      </div>
    );
  }
  const ch = data.channel;
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs uppercase tracking-wider font-semibold text-[#C0392B]">YouTube</span>
        <a href={`https://www.youtube.com/channel/${ch.id}`} target="_blank" rel="noreferrer" className="text-[12px] text-brand hover:underline">{ch.title}</a>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ProfileStat label="Subscribers" value={ch.subscribersHidden ? "hidden" : fmt(ch.subscribers)} />
        <ProfileStat label="Total views" value={fmt(ch.views)} />
        <ProfileStat label="Videos" value={fmt(ch.videoCount)} />
      </div>
      {(data.videos || []).length > 0 && (
        <div className="mt-5">
          <div className="text-[12px] uppercase tracking-wide text-[#8A92A6] mb-2">Recent uploads</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {(data.videos || []).map((v) => (
              <a key={v.id} href={v.url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-gray-100 hover:border-brand transition">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={v.thumbnail} alt="" className="w-full aspect-video object-cover" loading="lazy" decoding="async" />
                <div className="p-2">
                  <div className="text-[12px] text-[#232D42] line-clamp-2 leading-snug">{v.title}</div>
                  <div className="text-[11px] text-[#8A92A6] mt-1">{fmt(v.views)} views</div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-gray-100 rounded-xl p-3">
      <div className="text-[11px] uppercase tracking-wide text-[#8A92A6]">{label}</div>
      <div className="text-[19px] font-semibold text-[#232D42] tabular-nums mt-0.5">{value}</div>
      {hint && <div className="text-[11px] text-[#8A92A6] mt-0.5">{hint}</div>}
    </div>
  );
}

function CompetitorCard({ c, medianER, onOpen, onRemove, periodDays, category }: { c: Competitor; medianER: number; onOpen: () => void; onRemove?: () => void; periodDays?: number; category?: string }) {
  // In the tracked view each competitor has a period → recompute the headline metrics over it.
  const pm = periodDays !== undefined ? periodMetrics(c, periodDays) : null;
  const erShown = pm ? pm.er : c.engagementRatePct;
  const erDelta = erShown - medianER;
  const erBadge = erShown >= medianER
    ? <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">+{erDelta.toFixed(2)}pp</span>
    : <span className="text-xs px-1.5 py-0.5 rounded bg-rose-50 text-rose-700">{erDelta.toFixed(2)}pp</span>;
  const topPosts = [...c.recent].sort((a, b) => (b.like_count + b.comments_count) - (a.like_count + a.comments_count)).slice(0, 5);
  // Whole card opens the in-dashboard drill-down (no Instagram redirect anywhere).
  return (
    <div onClick={onOpen} className="relative bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md hover:border-brand/40 transition cursor-pointer">
      {onRemove && (
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Untrack" className="absolute top-3 right-3 z-10 w-6 h-6 rounded-full bg-white/85 border border-gray-100 text-gray-400 hover:text-rose-500 flex items-center justify-center text-sm leading-none">✕</button>
      )}
      <div className="p-5">
        <div className="flex items-start gap-3">
          {c.profile_picture_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.profile_picture_url} alt={c.username} className="w-12 h-12 rounded-full object-cover border border-gray-100" loading="lazy" decoding="async" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gray-100" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-mono text-sm">@{c.username}</div>
            {c.name && <div className="text-xs text-gray-500 truncate">{c.name}</div>}
            {(category || pm) && (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {category && <span className="text-[10px] font-medium bg-brand-light text-brand px-2 py-0.5 rounded-full">{category}</span>}
                {pm && <span className="text-[10px] font-medium bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{periodLabel(periodDays!)}</span>}
              </div>
            )}
          </div>
        </div>
        {c.biography && <p className="text-[11px] text-gray-500 mt-2 line-clamp-2">{c.biography}</p>}

        <div className="grid grid-cols-3 gap-2 mt-4">
          <ProfileStat label="Followers" value={fmt(c.followers_count)} />
          <Stat label="Posts" value={fmt(c.media_count)} />
          <Stat label={pm && periodDays ? `Posts/${periodDays}d` : "Posts/30d"} value={(pm ? pm.posts : c.postsLast30d).toString()} />
        </div>

        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">Engagement rate{pm && periodDays ? ` · ${periodDays}d` : ""}</div>
            <div className="text-lg font-semibold tabular-nums">{erShown.toFixed(2)}%</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-gray-400">vs niche median</div>
            <div className="mt-1">{erBadge}</div>
          </div>
        </div>

        <div className="mt-3 text-[11px] text-gray-500 flex justify-between">
          <span>Avg likes/post <b className="text-gray-700 tabular-nums">{fmt(pm ? pm.avgLikes : c.avgLikesRecent)}</b></span>
          <span>Avg comments <b className="text-gray-700 tabular-nums">{fmt(pm ? pm.avgComments : c.avgCommentsRecent)}</b></span>
        </div>
      </div>

      {topPosts.length > 0 && (
        <div className="border-t border-gray-100 px-5 py-3 bg-gray-50/50">
          <div className="flex items-center mb-2">
            <div className="text-xs uppercase tracking-wide text-gray-400">Top posts · ranked by engagement</div>
            <span className="ml-auto text-[11px] text-brand font-medium">View all →</span>
          </div>
          <div className="space-y-1.5">
            {topPosts.map((m, i) => {
              const er = c.followers_count > 0 ? ((m.like_count + m.comments_count) / c.followers_count) * 100 : 0;
              return (
                <div key={m.id} className="flex items-center gap-2.5 rounded-lg -mx-1 px-1 py-1">
                  <span className="text-[11px] text-gray-400 w-3 text-center tabular-nums flex-shrink-0">{i + 1}</span>
                  <div className="w-10 h-10 rounded-md overflow-hidden bg-gray-100 flex-shrink-0">
                    {m.thumbnail_url || m.media_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.thumbnail_url || m.media_url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-gray-700 truncate">{m.caption ? m.caption.replace(/\s+/g, " ").trim() : m.media_type}</div>
                    <div className="text-[11px] text-gray-500 flex gap-3 mt-0.5 tabular-nums">
                      <span><IconHeart size={12} stroke={1.8} className="inline -mt-0.5 mr-0.5" />{fmt(m.like_count)}</span>
                      <span><IconMessageCircle size={12} stroke={1.8} className="inline -mt-0.5 mr-0.5" />{fmt(m.comments_count)}</span>
                      <span className="text-gray-400">{er.toFixed(2)}% ER</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Media-type → chip label/colour for the post cards in the drill-down.
function mediaChip(type: string): { label: string; cls: string } {
  if (type === "VIDEO") return { label: "Reel", cls: "bg-rose-50 text-rose-600" };
  if (type === "CAROUSEL_ALBUM") return { label: "Carousel", cls: "bg-brand-light text-brand" };
  return { label: "Image", cls: "bg-gray-100 text-gray-600" };
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold mt-0.5 tabular-nums text-[#232D42]">{value}</div>
    </div>
  );
}

// Full-tab competitor drill-down — profile + every tracked post as a rich card, all
// IN the dashboard (post images/metrics shown here; no redirect out to Instagram).
function CompetitorDetail({ c, medianER, onBack }: { c: Competitor; medianER: number; onBack: () => void }) {
  const posts = [...c.recent].sort((a, b) => (b.like_count + b.comments_count) - (a.like_count + a.comments_count));
  const erDelta = c.engagementRatePct - medianER;
  const [post, setPost] = useState<CompetitorMedia | null>(null);   // clicked post → detail modal
  return (
    <>
      <button onClick={onBack} className="text-sm text-brand mb-4 inline-flex items-center gap-1 hover:underline">← Back to benchmark</button>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-5">
        <div className="flex items-start gap-4">
          {c.profile_picture_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.profile_picture_url} alt={c.username} className="w-16 h-16 rounded-full object-cover border border-gray-100" loading="lazy" decoding="async" />
          ) : <div className="w-16 h-16 rounded-full bg-gray-100" />}
          <div className="min-w-0 flex-1">
            <div className="font-mono text-base text-[#232D42]">@{c.username}</div>
            {c.name && <div className="text-sm text-gray-600">{c.name}</div>}
            {c.biography && <p className="text-xs text-gray-500 mt-1 max-w-2xl">{c.biography}</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-5">
          <DetailStat label="Followers" value={fmt(c.followers_count)} />
          <DetailStat label="Posts" value={fmt(c.media_count)} />
          <DetailStat label="Posts / 30d" value={c.postsLast30d.toString()} />
          <DetailStat label="Engagement rate" value={`${c.engagementRatePct.toFixed(2)}%`} />
          <DetailStat label="vs niche median" value={`${erDelta >= 0 ? "+" : ""}${erDelta.toFixed(2)}pp`} />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-base font-medium text-[#232D42]">Top performing posts</span>
          <span className="ml-auto text-xs text-gray-400">ranked by engagement · {posts.length} tracked</span>
        </div>
        {posts.length === 0 ? (
          <div className="text-sm text-gray-400 py-8 text-center">No public posts available for this account.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            {posts.map((m, i) => {
              const er = c.followers_count > 0 ? ((m.like_count + m.comments_count) / c.followers_count) * 100 : 0;
              const chip = mediaChip(m.media_type);
              return (
                <div key={m.id} onClick={() => setPost(m)} className={`border rounded-xl overflow-hidden bg-white cursor-pointer hover:shadow-md hover:border-brand/40 transition ${i === 0 ? "border-amber-300 ring-1 ring-amber-300" : "border-gray-100"}`}>
                  <div className="relative aspect-[4/5] bg-gray-100">
                    {m.thumbnail_url || m.media_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.thumbnail_url || m.media_url} alt="" className="w-full h-full object-contain" loading="lazy" decoding="async" />
                    ) : null}
                    <span className={`absolute top-2 left-2 rounded-full text-white text-[11px] font-semibold grid place-items-center shadow ${i === 0 ? "px-2 h-6 bg-amber-500" : "w-6 h-6 bg-brand"}`}>{i === 0 ? <><IconTrophy size={11} stroke={2} className="inline -mt-0.5 mr-0.5" />Top</> : i + 1}</span>
                    <span className={`absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${chip.cls}`}>{chip.label}</span>
                  </div>
                  <div className="p-3">
                    <div className="text-[12px] text-gray-700 line-clamp-2 h-[2lh]">{m.caption ? m.caption.replace(/\s+/g, " ").trim() : "(no caption)"}</div>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500 tabular-nums">
                      <span><IconHeart size={12} stroke={1.8} className="inline -mt-0.5 mr-0.5" />{fmt(m.like_count)}</span>
                      <span><IconMessageCircle size={12} stroke={1.8} className="inline -mt-0.5 mr-0.5" />{fmt(m.comments_count)}</span>
                      <span className="ml-auto text-emerald-600 font-semibold">{er.toFixed(2)}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {post && <PostModal m={post} c={c} onClose={() => setPost(null)} />}
    </>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3 text-center border border-gray-100">
      <div className="text-lg font-semibold tabular-nums text-[#232D42]">{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

// Competitor post detail — full image + caption + the public metrics Meta exposes for
// other accounts (likes + comments + engagement). Reach/saves/shares are private for
// competitors, so we say so instead of faking them.
function PostModal({ m, c, onClose }: { m: CompetitorMedia; c: Competitor; onClose: () => void }) {
  const er = c.followers_count > 0 ? ((m.like_count + m.comments_count) / c.followers_count) * 100 : 0;
  const chip = mediaChip(m.media_type);
  const date = fmtDateShort(m.timestamp, "");
  // Carousels come back with `children` (each slide); non-carousels are a single "slide".
  const slides = m.children?.data?.length ? m.children.data : [{ id: m.id, media_type: m.media_type, media_url: m.media_url, thumbnail_url: m.thumbnail_url }];
  const [slide, setSlide] = useState(0);
  const cur = slides[Math.min(slide, slides.length - 1)];
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl overflow-hidden w-full md:w-auto max-w-[95vw] max-h-[90vh] flex flex-col md:flex-row" onClick={(e) => e.stopPropagation()}>
        <div className="bg-gray-900 relative flex-shrink-0 flex items-center justify-center">
          {cur.media_type === "VIDEO" && cur.media_url ? (
            <SoundVideo src={cur.media_url} poster={cur.thumbnail_url} open loop={false} className="block w-full md:w-auto h-auto max-h-[45vh] md:max-h-[85vh] md:max-w-[min(58vw,620px)]" />
          ) : (cur.thumbnail_url || cur.media_url) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cur.thumbnail_url || cur.media_url} alt="" className="block w-full md:w-auto h-auto max-h-[45vh] md:max-h-[85vh] md:max-w-[min(58vw,620px)]" loading="lazy" decoding="async" />
          ) : null}
          <span className={`absolute top-3 left-3 text-[11px] font-semibold px-2.5 py-1 rounded-full ${chip.cls}`}>{chip.label}{slides.length > 1 ? ` · ${slide + 1}/${slides.length}` : ""}</span>
          {slides.length > 1 && (
            <>
              <button onClick={() => setSlide((s) => (s - 1 + slides.length) % slides.length)} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/85 hover:bg-white shadow flex items-center justify-center text-gray-700 text-xl leading-none">‹</button>
              <button onClick={() => setSlide((s) => (s + 1) % slides.length)} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/85 hover:bg-white shadow flex items-center justify-center text-gray-700 text-xl leading-none">›</button>
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {slides.map((_, i) => <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === slide ? "bg-white" : "bg-white/50"}`} />)}
              </div>
            </>
          )}
        </div>
        <div className="md:w-[380px] p-5 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 min-w-0">
              {c.profile_picture_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.profile_picture_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" loading="lazy" decoding="async" />
              ) : <div className="w-8 h-8 rounded-full bg-gray-100 flex-shrink-0" />}
              <div className="font-mono text-sm truncate">@{c.username}</div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none flex-shrink-0">✕</button>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <MetricBox label="Likes" value={fmt(m.like_count)} />
            <MetricBox label="Comments" value={fmt(m.comments_count)} />
            <MetricBox label="Engagement" value={`${er.toFixed(2)}%`} />
          </div>
          <div className="text-xs text-gray-400 mb-3">{chip.label}{date ? ` · ${date}` : ""}</div>
          <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{m.caption || "(no caption)"}</div>
          <p className="text-[11px] text-gray-400 mt-4 border-t border-gray-100 pt-3">Reach, saves &amp; shares aren&apos;t public for other accounts — Instagram only exposes likes &amp; comments for competitors.</p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
