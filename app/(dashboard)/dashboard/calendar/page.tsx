"use client";
import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { LiveIndicator } from "@/components/LiveIndicator";

type EffectiveStatus = "scheduled" | "publishing" | "published" | "failed" | "draft" | "unknown";

type ScheduledPost = {
  id: string;
  particulars: string;
  publishToPage: string;
  primaryInterest: string;
  type: string;
  caption: string;
  thumbnailUrl: string | null;
  scheduleTime: string | null;
  status: string;
  effectiveStatus: EffectiveStatus;
  failureReason: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  publishedAt: string | null;
};

// Semantic status track (separate from the account colour track below).
const STATUS_STYLE: Record<EffectiveStatus, { tileBg: string; text: string; dot: string; label: string; ink: string }> = {
  scheduled:  { tileBg: "bg-amber-50",   text: "text-amber-800",   dot: "bg-amber-500",   label: "Scheduled",  ink: "text-amber-900" },
  publishing: { tileBg: "bg-blue-50",    text: "text-blue-800",    dot: "bg-blue-500",    label: "Publishing", ink: "text-blue-900" },
  published:  { tileBg: "bg-emerald-50", text: "text-emerald-800", dot: "bg-emerald-500", label: "Published",  ink: "text-emerald-900" },
  failed:     { tileBg: "bg-rose-50",    text: "text-rose-800",    dot: "bg-rose-500",    label: "Failed",     ink: "text-rose-900" },
  draft:      { tileBg: "bg-gray-50",    text: "text-gray-600",    dot: "bg-gray-400",    label: "Draft",      ink: "text-gray-800" },
  unknown:    { tileBg: "bg-gray-50",    text: "text-gray-500",    dot: "bg-gray-300",    label: "Unknown",    ink: "text-gray-700" },
};

// Account track — brand dimension is orthogonal to status. The tile's LEFT RAIL uses
// account colour; its BACKGROUND uses status colour. Two independent axes.
type AccountKey = "main" | "world" | "india" | "other";
const ACCOUNT_STYLE: Record<AccountKey, { name: string; handle: string; rail: string; dot: string; tag: string }> = {
  main:  { name: "GooCampus Main",      handle: "@goocampus",       rail: "border-l-violet-500", dot: "bg-violet-500", tag: "bg-violet-50 text-violet-700 border-violet-200" },
  world: { name: "GooCampus World",     handle: "@goocampusworld",  rail: "border-l-sky-500",    dot: "bg-sky-500",    tag: "bg-sky-50 text-sky-700 border-sky-200" },
  india: { name: "12Plus / GC India",   handle: "@12thplusdotcom",  rail: "border-l-rose-500",   dot: "bg-rose-500",   tag: "bg-rose-50 text-rose-700 border-rose-200" },
  other: { name: "—",                   handle: "—",                rail: "border-l-gray-300",   dot: "bg-gray-400",   tag: "bg-gray-50 text-gray-600 border-gray-200" },
};

function accountKeyFor(publishToPage: string): AccountKey {
  if (publishToPage === "GooCampus Main") return "main";
  if (publishToPage === "GooCampus World") return "world";
  if (publishToPage === "12Plus / GC India") return "india";
  return "other";
}

// Sample posts for the calendar demo — mirrors the mockup so the tab reads as
// "populated" even when Airtable is nearly empty. Toggle off in the header to see
// only real Airtable data. Every id is prefixed "demo-" so callers can spot them.
function makeSamplePosts(): ScheduledPost[] {
  // Anchor to August of the current cursor year so months without real data still
  // read as designed. If today is after August, roll to next year so demo sits ahead.
  const today = new Date();
  const anchorYear = today.getMonth() > 7 ? today.getFullYear() + 1 : today.getFullYear();
  const iso = (day: number, hour: number, minute = 0) =>
    new Date(anchorYear, 7, day, hour, minute).toISOString();

  const p = (
    id: string, particulars: string, publishToPage: string, primaryInterest: string,
    type: string, day: number, hour: number, minute: number,
    status: EffectiveStatus = "scheduled", caption = "",
  ): ScheduledPost => ({
    id: `demo-${id}`,
    particulars,
    publishToPage,
    primaryInterest,
    type,
    caption: caption || `${particulars} — sample copy for demo.`,
    thumbnailUrl: null,
    scheduleTime: status === "published" ? null : iso(day, hour, minute),
    publishedAt: status === "published" ? iso(day, hour, minute) : null,
    status: status === "scheduled" ? "To Be Scheduled" : status.charAt(0).toUpperCase() + status.slice(1),
    effectiveStatus: status,
    failureReason: status === "failed" ? "Meta API rejected the media — check the source video's aspect ratio, then Retry." : null,
    instagramUrl: null,
    facebookUrl: null,
  });

  const drafts = (id: string, particulars: string, publishToPage: string, primaryInterest: string, type: string): ScheduledPost => ({
    id: `demo-${id}`,
    particulars,
    publishToPage,
    primaryInterest,
    type,
    caption: `${particulars} — draft, waiting for a slot.`,
    thumbnailUrl: null,
    scheduleTime: null,
    publishedAt: null,
    status: "Draft",
    effectiveStatus: "draft",
    failureReason: null,
    instagramUrl: null,
    facebookUrl: null,
  });

  return [
    // published (recent)
    p("cv", "CV that stands out in 2026", "GooCampus Main", "Mentorship Platform", "Post", 2, 18, 59, "published"),
    p("uae", "Exemption pathway UAE", "GooCampus Main", "Mentorship Platform", "Carousel", 3, 19, 26, "published"),
    p("jobs", "Job portals for Gulf-bound doctors", "12Plus / GC India", "Mentorship Platform", "Post", 3, 16, 52, "published"),

    // upcoming — the meat of the demo
    p("nz-teaser", "NZ IMG handbook teaser", "GooCampus World", "Study Abroad", "Reel", 4, 21, 0),
    p("als-1", "5 reasons doctors can't skip ALS", "GooCampus Main", "ALS", "Carousel", 5, 18, 0),
    p("ir-1", "Ireland RCSI deep dive", "GooCampus World", "Study Abroad", "Reel", 5, 20, 30),
    p("neet-1", "NEET PG cutoff projections", "12Plus / GC India", "NEET PG", "Carousel", 6, 14, 0),
    p("amc-anki", "AMC Anki deck walk-through", "GooCampus World", "Australia-PGCP", "Reel", 8, 10, 0),
    p("osce-draft", "OSCE 2026 changes — draft", "GooCampus Main", "Australia-PGCP", "Carousel", 9, 12, 0, "draft"),
    p("osce-1", "OSCE 2026 additions for AMC", "GooCampus Main", "Australia-PGCP", "Carousel", 10, 20, 0),
    p("als-hire", "Why ALS is now a hiring filter", "GooCampus Main", "ALS", "Reel", 11, 19, 0),
    p("mrcs-1", "MRCS pathway update", "12Plus / GC India", "Mentorship Platform", "Carousel", 11, 15, 30),
    p("ireland-full", "Ireland RCSI — full walkthrough", "GooCampus World", "Study Abroad", "Reel", 12, 21, 0),
    p("neet-state", "NEET PG state-wise cutoffs", "12Plus / GC India", "NEET PG", "Carousel", 13, 14, 0),
    p("amc-kit", "AMC August intake prep kit", "GooCampus Main", "Australia-PGCP", "Reel", 15, 10, 0),
    p("neet-trends", "NEET PG cutoff trends 2026", "GooCampus Main", "NEET PG", "Carousel", 16, 20, 0),
    // cross-post: same title on the same day across two accounts
    p("nz-main", "NZ handbook — 8-chapter deep dive", "GooCampus Main", "Study Abroad", "Reel", 17, 21, 0),
    p("nz-world", "NZ handbook — 8-chapter deep dive", "GooCampus World", "Study Abroad", "Reel", 17, 21, 0),
    p("uae-repost", "Exemption pathway UAE — repost", "GooCampus Main", "Mentorship Platform", "Carousel", 18, 15, 0, "publishing"),
    p("jobs-eu", "Job portals part 2 — Europe", "12Plus / GC India", "Mentorship Platform", "Post", 19, 16, 0),
    p("amc-mock", "AMC Part 2 mock schedule", "GooCampus Main", "Australia-PGCP", "Reel", 20, 19, 0),
    p("pgcp-preview", "Australia PGCP FAQ (preview)", "GooCampus World", "Australia-PGCP", "Carousel", 21, 18, 0),
    p("pgcp-fail", "Australia PGCP FAQ", "GooCampus World", "Australia-PGCP", "Carousel", 22, 11, 0, "failed"),
    p("als-world", "ALS — repost to World", "GooCampus World", "ALS", "Reel", 24, 19, 30),
    p("germany", "Germany — services overview", "GooCampus Main", "Study Abroad", "Post", 25, 17, 43),
    p("mrcs-full", "MRCS — full pathway carousel", "12Plus / GC India", "Mentorship Platform", "Carousel", 25, 14, 0),
    p("cv-draft", "Doctor CV — part 2 draft", "GooCampus Main", "Mentorship Platform", "Post", 25, 12, 0, "draft"),
    p("nz-ahpra", "NZ AHPRA registration steps", "GooCampus World", "Study Abroad", "Carousel", 26, 20, 0),
    p("mrcs-vlog", "MRCS — vlog Q&A", "12Plus / GC India", "Mentorship Platform", "Reel", 27, 17, 0),
    p("osce-tips", "OSCE micro-tips series #4", "GooCampus Main", "Australia-PGCP", "Reel", 27, 19, 45),
    p("osce-tips-2", "OSCE micro-tips series #5", "GooCampus Main", "Australia-PGCP", "Reel", 27, 20, 30),
    p("osce-tips-3", "OSCE micro-tips series #6", "GooCampus Main", "Australia-PGCP", "Reel", 27, 21, 15),
    p("amc-check", "AMC exam-week checklist", "GooCampus Main", "Australia-PGCP", "Post", 28, 9, 0),
    p("amc-reflect", "Post-exam reflection template", "GooCampus Main", "Australia-PGCP", "Post", 30, 18, 0),
    p("pgcp-close", "PGCP intake — final call", "GooCampus World", "Australia-PGCP", "Reel", 31, 20, 0),

    // drafts sitting in the dock
    drafts("d-osce", "OSCE additions for AMC Part 1 — 2026 syllabus notes", "GooCampus Main", "Australia-PGCP", "Carousel"),
    drafts("d-ireland", "Ireland RCSI 2026 — the honest cost breakdown", "GooCampus World", "Study Abroad", "Reel"),
    drafts("d-neet", "NEET PG — state-wise expected cutoffs, deemed unis", "12Plus / GC India", "NEET PG", "Carousel"),
    drafts("d-malaysia", "Malaysia MBBS spots — 2026 intake window", "GooCampus World", "Study Abroad", "Post"),
    drafts("d-uk-cv", "5 mistakes Indian IMGs make on the UK CV", "GooCampus Main", "Mentorship Platform", "Carousel"),
    drafts("d-mock", "Mock-test rhythm: how top scorers actually revise", "GooCampus Main", "Australia-PGCP", "Reel"),
  ];
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function CalendarPage() {
  return (
    <DashboardShell title="Publishing Calendar" subtitle="Plan the month across your 3 IG accounts. Left rail filters, click any tile for detail, drag drafts up to book them." hideAccountPicker>
      {() => <Calendar />}
    </DashboardShell>
  );
}

function Calendar() {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  // Jump to August of the demo anchor year on first load so the sample content
  // is visible without hunting for it. Once demo is off, the user navigates freely.
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    const anchorYear = now.getMonth() > 7 ? now.getFullYear() + 1 : now.getFullYear();
    return new Date(anchorYear, 7, 1);
  });
  const [selected, setSelected] = useState<ScheduledPost | null>(null);
  // Show sample content so the calendar reads as populated during setup. Toggle off
  // once real Airtable rows fill the month.
  const [showDemo, setShowDemo] = useState(true);
  const samplePosts = useMemo(() => makeSamplePosts(), []);

  // Left-rail filter state
  const [activeAccounts, setActiveAccounts] = useState<Set<AccountKey>>(new Set(["main", "world", "india"]));
  const [activeInterest, setActiveInterest] = useState<string>("all");
  const [activeType, setActiveType] = useState<string>("all");
  const [activeStatus, setActiveStatus] = useState<EffectiveStatus | "all">("all");

  const load = () => {
    setLoading(true);
    const t0 = Date.now();
    fetch("/api/scheduler/queue")
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: { posts?: ScheduledPost[] }) => {
        setPosts(d.posts || []);
        setFetchedAt(Date.now());
        setLatencyMs(Date.now() - t0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // Merge in demo posts when the toggle is on so the tab reads as populated.
  const allPosts = useMemo(
    () => showDemo ? [...posts, ...samplePosts] : posts,
    [posts, samplePosts, showDemo],
  );

  // Populate filter options from whatever's being displayed.
  const availableInterests = useMemo(
    () => Array.from(new Set(allPosts.map((p) => p.primaryInterest).filter(Boolean))).sort(),
    [allPosts],
  );
  const availableTypes = useMemo(
    () => Array.from(new Set(allPosts.map((p) => p.type).filter(Boolean))).sort(),
    [allPosts],
  );

  // Apply rail filters
  const filtered = useMemo(() => allPosts.filter((p) => {
    if (!activeAccounts.has(accountKeyFor(p.publishToPage))) return false;
    if (activeInterest !== "all" && p.primaryInterest !== activeInterest) return false;
    if (activeType !== "all" && p.type !== activeType) return false;
    if (activeStatus !== "all" && p.effectiveStatus !== activeStatus) return false;
    return true;
  }), [allPosts, activeAccounts, activeInterest, activeType, activeStatus]);

  // Bucket into (a) posts that plot on a calendar day, and (b) drafts / unscheduled that sit in the bottom dock.
  const { postsByDate, draftDock } = useMemo(() => {
    const byDate = new Map<string, ScheduledPost[]>();
    const drafts: ScheduledPost[] = [];
    for (const p of filtered) {
      const ts = p.publishedAt || p.scheduleTime;
      if (!ts) { drafts.push(p); continue; }
      const key = ymd(new Date(ts));
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(p);
    }
    // sort each day newest-first — top of stack is what fires first that day
    for (const [, arr] of byDate) arr.sort((a, b) => new Date(a.scheduleTime || a.publishedAt || 0).getTime() - new Date(b.scheduleTime || b.publishedAt || 0).getTime());
    return { postsByDate: byDate, draftDock: drafts };
  }, [filtered]);

  // Build the calendar grid (always 6 rows × 7 cols starting on the Sunday on/before day 1)
  const grid = useMemo(() => {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(firstOfMonth);
    start.setDate(start.getDate() - firstOfMonth.getDay());
    const cells: { date: Date; inMonth: boolean; isToday: boolean }[] = [];
    const today = ymd(new Date());
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push({ date: d, inMonth: d.getMonth() === cursor.getMonth(), isToday: ymd(d) === today });
    }
    return cells;
  }, [cursor]);

  // Per-account counts across ALL posts (ignoring filters) so the sidebar always shows what's there.
  const acctCounts = useMemo(() => {
    const c: Record<AccountKey, number> = { main: 0, world: 0, india: 0, other: 0 };
    for (const p of allPosts) c[accountKeyFor(p.publishToPage)] += 1;
    return c;
  }, [allPosts]);

  const statusCounts = useMemo(() => {
    const c: Record<EffectiveStatus, number> = { scheduled: 0, publishing: 0, published: 0, failed: 0, draft: 0, unknown: 0 };
    for (const p of filtered) c[p.effectiveStatus] += 1;
    return c;
  }, [filtered]);

  function toggleAccount(k: AccountKey) {
    setActiveAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  const prevMonth = () => { const d = new Date(cursor); d.setMonth(d.getMonth() - 1); setCursor(d); };
  const nextMonth = () => { const d = new Date(cursor); d.setMonth(d.getMonth() + 1); setCursor(d); };
  const jumpToday = () => { const d = new Date(); d.setDate(1); setCursor(d); };

  return (
    <>
      {/* Header — month nav + live indicator */}
      <div className="flex items-baseline gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} aria-label="Previous month" className="w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">‹</button>
          <div className="text-xl font-semibold text-gray-900 min-w-[200px] text-center tabular-nums">
            {MONTH_NAMES[cursor.getMonth()]} <span className="text-gray-400 font-normal italic">{cursor.getFullYear()}</span>
          </div>
          <button onClick={nextMonth} aria-label="Next month" className="w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">›</button>
          <button onClick={jumpToday} className="text-xs font-medium ml-1 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">Today</button>
        </div>
        {/* Demo-data toggle — flip off to see only real Airtable rows */}
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <span className={`w-8 h-4 rounded-full relative transition ${showDemo ? "bg-brand" : "bg-gray-300"}`}>
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition ${showDemo ? "left-4" : "left-0.5"}`} />
          </span>
          <span>Show sample data</span>
          <input type="checkbox" className="sr-only" checked={showDemo} onChange={(e) => setShowDemo(e.target.checked)} />
        </label>
        <div className="ml-auto">
          <LiveIndicator fetchedAt={fetchedAt} latencyMs={latencyMs} loading={loading} onRefresh={load} />
        </div>
      </div>

      {showDemo && (
        <div className="bg-brand-light/40 border border-brand/20 rounded-lg px-3 py-2 mb-4 text-[11.5px] text-brand flex items-center gap-2">
          <span className="font-semibold">Demo mode ·</span>
          <span>Sample August posts are mixed in so the layout reads populated. Toggle off above to see only your live Airtable rows.</span>
        </div>
      )}

      {/* Failed-post banner */}
      {statusCounts.failed > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-semibold text-rose-900">⚠ {statusCounts.failed} post{statusCounts.failed === 1 ? "" : "s"} need attention</div>
            <button onClick={() => setActiveStatus("failed")} className="text-xs text-rose-700 hover:underline">Show only failures →</button>
          </div>
          <div className="text-xs text-rose-700">Stuck posts won&apos;t self-recover. Click a red tile → Retry to bump it back into the publishing queue.</div>
        </div>
      )}

      {/* Two-column layout — left rail + calendar canvas */}
      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-5 items-start mb-5">

        {/* LEFT RAIL — filters */}
        <aside className="lg:sticky lg:top-3 space-y-5">
          <RailSection title="Accounts">
            {(["main", "world", "india"] as AccountKey[]).map((k) => {
              const on = activeAccounts.has(k);
              const st = ACCOUNT_STYLE[k];
              return (
                <label key={k} className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer ${on ? "bg-gray-50" : ""} hover:bg-gray-50`}>
                  <span className={`w-4 h-4 rounded-sm border flex items-center justify-center text-white text-[10px] ${on ? "bg-brand border-brand" : "bg-white border-gray-300"}`}>
                    {on ? "✓" : ""}
                  </span>
                  <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />
                  <span className="text-xs text-gray-800 flex-1 truncate">{st.handle}</span>
                  <span className="text-[10px] text-gray-400 tabular-nums">{acctCounts[k]}</span>
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleAccount(k)} />
                </label>
              );
            })}
          </RailSection>

          <RailSection title="Interest">
            <ChipRow items={["all", ...availableInterests]} value={activeInterest} onChange={setActiveInterest} />
          </RailSection>

          <RailSection title="Status">
            <div className="space-y-1.5">
              {(["all", "scheduled", "publishing", "published", "failed", "draft"] as const).map((s) => {
                const count = s === "all" ? filtered.length : statusCounts[s as EffectiveStatus];
                const style = s === "all" ? null : STATUS_STYLE[s as EffectiveStatus];
                const on = activeStatus === s;
                return (
                  <button
                    key={s}
                    onClick={() => setActiveStatus(s)}
                    className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs ${on ? "bg-brand-light text-brand font-medium" : "text-gray-700 hover:bg-gray-50"}`}
                  >
                    <span className={`w-2 h-2 rounded-sm ${style ? style.dot : "bg-gray-300"}`} />
                    <span className="flex-1 text-left capitalize">{s === "all" ? "All" : style!.label}</span>
                    <span className="text-[10px] text-gray-400 tabular-nums">{count}</span>
                  </button>
                );
              })}
            </div>
          </RailSection>

          {availableTypes.length > 0 && (
            <RailSection title="Type">
              <ChipRow items={["all", ...availableTypes]} value={activeType} onChange={setActiveType} />
            </RailSection>
          )}
        </aside>

        {/* MAIN CANVAS — the month grid */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          {/* Day-of-week header */}
          <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/60">
            {DAY_LABELS.map((d) => (
              <div key={d} className="px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-gray-500 font-semibold border-r border-gray-100 last:border-r-0">{d}</div>
            ))}
          </div>
          {/* Date grid */}
          <div className="grid grid-cols-7" style={{ gridAutoRows: "minmax(120px, 1fr)" }}>
            {grid.map((cell, i) => {
              const key = ymd(cell.date);
              const dayPosts = postsByDate.get(key) || [];
              const cross = new Set(dayPosts.map((p) => p.particulars || p.id));
              const isCrossPostDay = dayPosts.length > cross.size ? false : false; // placeholder — reserved
              return (
                <div
                  key={i}
                  className={`p-1.5 border-r border-b border-gray-100 relative ${!cell.inMonth ? "bg-gray-50/60" : ""} ${cell.isToday ? "bg-brand-light/40" : ""} ${i % 7 === 6 ? "border-r-0" : ""}`}
                >
                  <div className="flex items-center justify-between px-1 pb-1 min-h-[22px]">
                    <div className={cell.isToday
                      ? "inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand text-white font-semibold text-[11px] tabular-nums"
                      : `text-[11px] font-medium tabular-nums ${cell.inMonth ? "text-gray-800" : "text-gray-300"}`
                    }>
                      {cell.date.getDate()}
                    </div>
                    {cell.isToday && (
                      <span className="text-[12px] uppercase tracking-[0.1em] font-semibold text-brand">Today</span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {dayPosts.slice(0, 3).map((p) => (
                      <CalendarTile key={p.id} post={p} onClick={() => setSelected(p)} />
                    ))}
                    {dayPosts.length > 3 && (
                      <button
                        onClick={() => setSelected(dayPosts[3])}
                        className="text-[10px] text-gray-500 hover:text-brand px-1"
                      >
                        + {dayPosts.length - 3} more
                      </button>
                    )}
                  </div>
                  {/* Cross-post badge — appears when the same title lands multiple times on this day (e.g. cross-posted) */}
                  {(() => {
                    const titles = dayPosts.map((p) => p.particulars || p.id);
                    const dupes = new Set(titles.filter((t, idx) => titles.indexOf(t) !== idx));
                    return dupes.size > 0 ? (
                      <span className="absolute right-1.5 bottom-1.5 text-[9px] font-mono bg-white border border-violet-200 text-brand px-1 rounded">
                        ✕{Math.max(...Array.from(dupes).map((t) => titles.filter((x) => x === t).length))}
                      </span>
                    ) : null;
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* DRAFTS DOCK — content with no schedule time yet */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
        <div className="flex items-baseline gap-3 mb-3">
          <h2 className="text-base font-semibold text-gray-900">Waiting to be scheduled</h2>
          <span className="text-xs text-gray-500 italic">
            {draftDock.length === 0 ? "Nothing waiting — every post has a slot." : `${draftDock.length} draft${draftDock.length === 1 ? "" : "s"} sitting without a time.`}
          </span>
        </div>
        {draftDock.length > 0 && (
          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {draftDock.map((p) => (
              <DraftCard key={p.id} post={p} onClick={() => setSelected(p)} />
            ))}
          </div>
        )}
      </section>

      {/* Footnote */}
      <div className="mt-3 text-[11px] text-gray-400">
        Fetched from Post Scheduler Airtable. Posts plot on <strong>Published At</strong> if published, else <strong>Schedule Time</strong>. Rows without either fall into the dock.
      </div>

      {selected && <DetailModal post={selected} onClose={() => setSelected(null)} onRetried={() => { setSelected(null); load(); }} />}
    </>
  );
}

/* -------- small building blocks -------- */

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-gray-400 mb-2 px-1">{title}</div>
      <div>{children}</div>
    </div>
  );
}

function ChipRow({ items, value, onChange }: { items: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it) => {
        const label = it === "all" ? "All" : it;
        const on = value === it;
        return (
          <button
            key={it}
            onClick={() => onChange(it)}
            className={`text-[11px] px-2 py-0.5 rounded-full border ${on ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function CalendarTile({ post, onClick }: { post: ScheduledPost; onClick: () => void }) {
  const acct = ACCOUNT_STYLE[accountKeyFor(post.publishToPage)];
  const st = STATUS_STYLE[post.effectiveStatus];
  const ts = post.publishedAt || post.scheduleTime;
  const time = ts ? new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—";
  const typeIcon = post.type?.toLowerCase().includes("reel") ? "🎬" :
    post.type?.toLowerCase().includes("carousel") ? "🖼️" : "📄";
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded border-l-[3px] ${acct.rail} ${st.tileBg} px-1.5 py-1 flex items-center gap-1.5 hover:ring-1 hover:ring-gray-300 transition`}
      title={`${post.particulars} — ${acct.handle} · ${st.label}`}
    >
      {post.thumbnailUrl ? (
        <img src={post.thumbnailUrl} alt="" className="w-5 h-5 rounded-[2px] object-cover shrink-0" loading="lazy" decoding="async" />
      ) : (
        <span className={`w-5 h-5 rounded-[2px] flex items-center justify-center text-[10px] bg-white/60 shrink-0`}>{typeIcon}</span>
      )}
      <span className={`text-[10.5px] flex-1 truncate ${st.ink}`}>
        {post.particulars || "(no title)"}
      </span>
      <span className="text-[9px] font-mono tabular-nums text-gray-500 shrink-0">{time}</span>
    </button>
  );
}

function DraftCard({ post, onClick }: { post: ScheduledPost; onClick: () => void }) {
  const acct = ACCOUNT_STYLE[accountKeyFor(post.publishToPage)];
  const typeIcon = post.type?.toLowerCase().includes("reel") ? "🎬" :
    post.type?.toLowerCase().includes("carousel") ? "🖼️" : "📄";
  return (
    <button
      onClick={onClick}
      className={`flex-none w-56 text-left border border-dashed border-gray-300 hover:border-brand hover:border-solid bg-white rounded-lg p-2.5 space-y-2 transition`}
    >
      {post.thumbnailUrl ? (
        <img src={post.thumbnailUrl} alt="" className="w-full h-14 object-cover rounded" loading="lazy" decoding="async" />
      ) : (
        <div className="w-full h-14 rounded bg-gray-100 flex items-center justify-center text-xl text-gray-400">
          {typeIcon}
        </div>
      )}
      <div className="text-[12px] font-medium text-gray-900 line-clamp-2 leading-snug">
        {post.particulars || "(no title)"}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
        <span className={`w-2 h-2 rounded-full ${acct.dot}`} />
        <span className="truncate">{acct.handle}</span>
        {post.primaryInterest && (
          <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded-full border ${acct.tag}`}>
            {post.primaryInterest}
          </span>
        )}
      </div>
    </button>
  );
}

function DetailModal({ post, onClose, onRetried }: { post: ScheduledPost; onClose: () => void; onRetried: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const acct = ACCOUNT_STYLE[accountKeyFor(post.publishToPage)];
  const st = STATUS_STYLE[post.effectiveStatus];

  async function retry() {
    setRetrying(true); setError(null);
    try {
      const r = await fetch("/api/scheduler/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: post.id }),
      });
      const d = await r.json();
      if (!r.ok || d.error) setError(d.error || `HTTP ${r.status}`);
      else onRetried();
    } catch (e) { setError((e as Error).message); }
    finally { setRetrying(false); }
  }

  const whenLabel = post.publishedAt
    ? `Published ${new Date(post.publishedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`
    : post.scheduleTime
    ? `Scheduled for ${new Date(post.scheduleTime).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`
    : "No schedule";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className={`px-5 py-4 ${st.tileBg} flex items-center justify-between border-l-[4px] ${acct.rail}`}>
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${st.dot}`} />
            <span className={`text-xs uppercase tracking-wide font-semibold ${st.text}`}>{st.label}</span>
            <span className={`ml-2 text-[10px] px-2 py-0.5 rounded-full border ${acct.tag}`}>{acct.handle}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          {post.thumbnailUrl && (
            <img src={post.thumbnailUrl} alt="" className="w-full max-h-72 object-contain rounded-lg border border-gray-100" loading="lazy" decoding="async" />
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Title</div>
            <div className="text-base font-semibold text-gray-900">{post.particulars || "(no title)"}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Brand</div>
              <div className="text-sm text-gray-700">{post.publishToPage}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Type</div>
              <div className="text-sm text-gray-700">{post.type || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Interest</div>
              <div className="text-sm text-gray-700">{post.primaryInterest || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Time</div>
              <div className="text-sm text-gray-700">{whenLabel}</div>
            </div>
          </div>
          {post.caption && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Caption preview</div>
              <div className="text-xs text-gray-700 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap line-clamp-8">{post.caption}</div>
            </div>
          )}
          {post.effectiveStatus === "failed" && post.failureReason && (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-rose-900 mb-1">Why it failed</div>
              <div className="text-xs text-rose-700">{post.failureReason}</div>
              <button
                onClick={retry}
                disabled={retrying}
                className="mt-3 text-xs font-medium bg-rose-600 text-white px-3 py-1.5 rounded-md hover:bg-rose-700 disabled:opacity-50"
              >
                {retrying ? "Retrying…" : "↻ Retry — bump back into the queue"}
              </button>
              {error && <div className="text-xs text-rose-700 mt-2">{error}</div>}
            </div>
          )}
          {(post.instagramUrl || post.facebookUrl) && (
            <div className="flex gap-3 text-xs pt-2 border-t border-gray-100">
              {post.instagramUrl && <a href={post.instagramUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">View on Instagram ↗</a>}
              {post.facebookUrl && <a href={post.facebookUrl.split("\n")[0]} target="_blank" rel="noreferrer" className="text-brand hover:underline">View on Facebook ↗</a>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
