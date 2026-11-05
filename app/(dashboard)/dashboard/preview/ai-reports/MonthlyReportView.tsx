"use client";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { REPORT_HISTORY as H, historyRow, historyEngagement, HISTORY_LAST } from "@/lib/report-history";
import { type ManualFields, type ManualSection } from "@/lib/report-manual";
import { LoadingBlock } from "@/components/LoadingBlock";

// One month's report in the team's Notion format (see docs/MONTHLY_REPORT_SPEC.md).
// It shows that month only — the list beside it is how you move between months.
//   · this month   → live, 1st to today; saved as you view it and by the daily cron
//   · past months  → the whole month, re-counted live; followers and subscribers come
//                    from what was saved at the time (they can't be counted afterwards)
//   · ≤ May 2026   → the figures imported from the Notion report
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const EMPTY_NOTES: ManualFields = { sections: [], achievements: "", focusedSbus: "", amcEbook: "", newsletter: "", futureProspects: "", actionNotes: "" };

type IG = { available: boolean; followers: number | null; followersAsOf: string | null; reach: number | null; reachFrom: string; contentInteractions: number | null; post: number; reel: number; story: number | null; leads: number };
type YT = { available: boolean; subscribers: number; views: number; video: number; shorts: number; leads: number };
type LI = { available: boolean; followers: number; impressions: number; reactions: number; posts: number; comments: number; postsComplete?: boolean };
type Organic = { month: string; igfb: number; dmBookings: number; ytEnquiries: number; website: number; inboundCall: number; total: number };
type Top = { posts: { permalink: string; thumb: string; type: string; likes: number; comments: number }[] };
type SavedMonth = {
  window?: { to: string }; instagram?: IG | null; youtube?: YT | null; linkedin?: LI | null;
  organic?: { rows?: Organic[] } | null; leadStatus?: LeadStatusResp | null; topPosts?: Top | null;
  pointInTime?: { asOf: string; youtubeSubs: number | null; linkedinFollowers: number | null };
};
type Snapshot = { savedAt: string | null; payload: SavedMonth | null };

export function MonthlyReportView({ month }: { month: string }) {
  const now = new Date();
  const thisMonth = ymd(now).slice(0, 7);
  const isCurrent = month === thisMonth;
  const imported = month <= HISTORY_LAST;
  const from = `${month}-01`;
  const monthEnd = ymd(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  const to = isCurrent ? ymd(now) : monthEnd;
  const label = new Date(from + "T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const short = new Date(from + "T00:00:00").toLocaleDateString("en-US", { month: "short" });
  const range = `${Number(from.slice(8))}–${Number(to.slice(8))} ${short}`;

  const [manual, setManual] = useState<ManualFields | null>(null);
  const manualRef = useRef<ManualFields | null>(null);
  const [notesSave, setNotesSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => { manualRef.current = manual; }, [manual]);
  useEffect(() => {
    setManual(null);
    fetch(`/api/reports/manual?month=${month}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((j) => setManual(j.fields as ManualFields))
      .catch(() => setManual({ ...EMPTY_NOTES }));
  }, [month]);
  const updateField = (field: keyof ManualFields, value: string) => setManual((m) => ({ ...(m ?? EMPTY_NOTES), [field]: value }));
  // Save the WHOLE current notes object, and serialise saves in a promise chain so
  // two quick blurs can't race a read-modify-write and drop a field.
  const saveNotes = () => persist(manualRef.current);
  // Added sections save straight away (add / remove), with the list they just made.
  const setSections = (next: ManualSection[], saveNow = false) => {
    const fields = { ...(manualRef.current ?? EMPTY_NOTES), sections: next };
    manualRef.current = fields;
    setManual(fields);
    if (saveNow) persist(fields);
  };
  const persist = (fields: ManualFields | null) => {
    setNotesSave("saving");
    saveChain.current = saveChain.current
      .catch(() => {})
      .then(async () => {
        const r = await fetch("/api/reports/manual", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ month, patch: fields ?? {} }),
        });
        setNotesSave(r.ok ? "saved" : "error");
      })
      .catch(() => setNotesSave("error"));
  };

  // Live numbers for the month (not for imported months — those are fixed).
  const [ig, setIg] = useState<IG | null>(null);
  const [yt, setYt] = useState<YT | null>(null);
  const [li, setLi] = useState<LI | null>(null);
  const [organic, setOrganic] = useState<Organic | null | undefined>(undefined);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  // A month that has ended opens from its saved full-month copy — one quick read,
  // instead of re-counting every platform (YouTube alone took ~10s). undefined while
  // deciding, the copy when there is a full one, null when counting live.
  const [copy, setCopy] = useState<SavedMonth | null | undefined>(undefined);
  useEffect(() => {
    setIg(null); setYt(null); setLi(null); setOrganic(undefined); setSnap(null); setCopy(undefined);
    if (imported) return;
    const q = `from=${from}&to=${to}`;
    const j = (u: string) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const live = () => {
      setCopy(null);
      j(`/api/reports/instagram-month?${q}`).then(setIg);
      j(`/api/reports/platform-month?platform=youtube&${q}`).then(setYt);
      j(`/api/reports/platform-month?platform=linkedin&${q}`).then(setLi);
      j(`/api/reports/organic-leads?${q}`).then((r) => setOrganic((r?.rows as Organic[] | undefined)?.find((x) => x.month === month) ?? null));
    };
    if (isCurrent) live();
    j(`/api/reports/snapshot?month=${month}`).then((r) => {
      const p = (r?.payload ?? null) as SavedMonth | null;
      setSnap({ savedAt: r?.savedAt ?? null, payload: p });
      if (isCurrent) return;
      if (p?.window?.to !== monthEnd || !p.instagram) return live();
      const off = { available: false } as never;
      setCopy(p); setIg(p.instagram); setYt(p.youtube ?? off); setLi(p.linkedin ?? off);
      setOrganic(p.organic?.rows?.find((x) => x.month === month) ?? null);
    });
  }, [month, from, to, imported, isCurrent, monthEnd]);

  // This month: save a copy a few seconds after it settles (the daily cron does too).
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveMonth = async () => {
    setSaveState("saving");
    try {
      const q = `from=${from}&to=${to}`;
      const j = (u: string) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const [leadStatus, organicR, instagram, youtube, linkedin, topPosts, man] = await Promise.all([
        j(`/api/reports/lead-status?${q}`), j(`/api/reports/organic-leads?${q}`), j(`/api/reports/instagram-month?${q}`),
        j(`/api/reports/platform-month?platform=youtube&${q}`), j(`/api/reports/platform-month?platform=linkedin&${q}`),
        j(`/api/reports/instagram-top?${q}`), j(`/api/reports/manual?month=${month}`),
      ]);
      const payload = { label, window: { from, to }, leadStatus, organic: organicR, instagram, youtube, linkedin, topPosts, manual: (man as { fields?: unknown } | null)?.fields ?? null };
      const r = await fetch("/api/reports/snapshot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, payload }) });
      if (r.ok) { const res = await r.json(); setSnap((s) => ({ savedAt: res.savedAt, payload: s?.payload ?? null })); setSaveState("saved"); } else setSaveState("error");
    } catch { setSaveState("error"); }
  };
  useEffect(() => {
    if (!isCurrent) return;
    const t = setTimeout(() => { saveMonth(); }, 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // Subscribers / LinkedIn followers for a past month: the saved copy's figure.
  const saved = snap?.payload;
  const savedTo = saved?.window?.to;
  // Which day the copy's subscriber / follower counts are from. Within a week of the
  // month's end they stand for the month; further off they'd mislead, so "—".
  const pit = saved?.pointInTime ?? (saved && savedTo ? { asOf: savedTo, youtubeSubs: saved.youtube?.subscribers ?? null, linkedinFollowers: saved.linkedin?.followers ?? null } : null);
  const daysOff = pit ? Math.abs(Date.parse(pit.asOf) - Date.parse(monthEnd)) / 86_400_000 : Infinity;
  const asOf = (d: string | null | undefined) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null;
  const pinNote = (d: string | null | undefined) => (isCurrent ? undefined : !d ? "not saved for this month" : d < monthEnd ? `as of ${asOf(d)}` : undefined);
  const pitNote = isCurrent ? undefined : daysOff > 7 ? "not saved for this month" : daysOff > 1 ? `as of ${asOf(pit!.asOf)}` : undefined;
  const ytSubs = isCurrent ? yt?.subscribers ?? null : daysOff > 7 ? null : pit!.youtubeSubs;
  const liFollowers = isCurrent ? li?.followers ?? null : daysOff > 7 ? null : pit!.linkedinFollowers;

  const status = imported
    ? { cls: "bg-[#F3F4F7] border-gray-200 text-[#4A5468]", text: "From the Notion report — imported before the dashboard kept reports." }
    : isCurrent
      ? { cls: "bg-brand-light border-[#D5DBF8] text-[#2138B0]", text: `Live — ${range}. Numbers update each time you open it, and the whole month is saved on its own when it ends.` }
      : { cls: "bg-[#E8F6EE] border-[#CBEBD8] text-[#126B39]", text: `Full month — ${range}.${copy && snap?.savedAt ? ` From the copy saved ${new Date(snap.savedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}.` : ""}` };

  // Imported rows, by column.
  const hIg = imported ? historyRow(H.instagram, month) : null;
  const hYt = imported ? historyRow(H.youtube, month) : null;
  const hLi = imported ? historyRow(H.linkedin, month) : null;
  const hFb = imported ? historyRow(H.facebook, month) : null;
  const hOrg = imported ? historyRow(H.organicLeads, month) : null;
  const hEng = imported ? historyEngagement(month) : null;
  const loading = !imported && ig === null;

  return (
    <article className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 md:p-8 space-y-9">
      <header className="border-b border-gray-100 pb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-brand font-semibold mb-1">Monthly performance</div>
          <h1 className="text-xl font-semibold text-[#232D42] tracking-tight">{label} Monthly Report</h1>
          <div className="text-[12.5px] text-gray-500 mt-1">GooCampus · all channels · {imported ? "imported" : isCurrent ? "this month to date" : "full month"}</div>
        </div>
        <div className="flex items-center gap-2.5">
          {snap?.savedAt && <span className="text-[11px] text-gray-400">saved {new Date(snap.savedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>}
          {isCurrent && (
            <button onClick={saveMonth} disabled={saveState === "saving"} title="Save a copy of this month's numbers now"
              className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-brand/40 text-brand bg-brand-light hover:bg-brand hover:text-white transition disabled:opacity-50">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "✓ Saved" : saveState === "error" ? "Retry save" : "Save this month"}
            </button>
          )}
        </div>
      </header>

      <div className={`rounded-xl border px-4 py-2.5 text-[12.5px] ${status.cls}`}>{status.text}</div>

      <ManualEditable title="Achievements" hint="Leads converted this month + all-time highs + strategy notes." value={manual?.achievements ?? ""} onChange={(v) => updateField("achievements", v)} onBlur={saveNotes} loaded={manual != null} state={notesSave} />
      <ManualEditable title="Focused SBUs" hint="Focused SBUs + webinar / live-session write-ups (registrations, attendees)." value={manual?.focusedSbus ?? ""} onChange={(v) => updateField("focusedSbus", v)} onBlur={saveNotes} loaded={manual != null} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ManualEditable title="AMC E-Book" hint="Total sales so far + note." value={manual?.amcEbook ?? ""} onChange={(v) => updateField("amcEbook", v)} onBlur={saveNotes} loaded={manual != null} />
        <ManualEditable title="Newsletter" hint="Total subscribers + note." value={manual?.newsletter ?? ""} onChange={(v) => updateField("newsletter", v)} onBlur={saveNotes} loaded={manual != null} />
      </div>

      <AddedSections sections={manual?.sections ?? []} loaded={manual != null} onChange={setSections} onBlur={saveNotes} />

      <Section title="Total Organic Leads" note={imported ? "Organic leads by source (paid ads excluded)." : "Organic leads by source (paid ads excluded) — a CRM estimate from Lead Source."}>
        {imported ? (
          hOrg ? <Stats items={[["IG / Fb", hOrg[0]], ["DM bookings", hOrg[1]], ["YT enquiries", hOrg[2]], ["Website", hOrg[3]], ["Inbound call", hOrg[4]], ["Total", hOrg[5]]]} />
            : <Missing what="organic leads" />
        ) : organic === undefined ? <Loading /> : (
          <Stats items={[["IG / Fb", organic?.igfb], ["DM bookings", organic?.dmBookings], ["YT enquiries", organic?.ytEnquiries], ["Website", organic?.website], ["Inbound call", organic?.inboundCall], ["Total", organic?.total ?? 0]]} />
        )}
      </Section>

      {!imported && (copy === undefined ? <Loading /> : <LeadGrids from={from} to={to} saved={copy ? copy.leadStatus ?? null : undefined} />)}

      <PlatformHeader name="Instagram" />
      <Section title="Instagram" note={imported ? undefined : `Followers · reach · content interactions · posts · reels · stories · leads (CRM IG/Fb estimate).${ig && ig.reachFrom !== from ? ` Reach covers ${asOf(ig.reachFrom)}–${asOf(to)} — Meta allows 30 days at a time.` : ""}`}>
        {imported ? (
          hIg ? <Stats items={[["Followers", hIg[0]], ["Reach", hIg[1]], ["Content interactions", hIg[2]], ["DMs", hIg[3]], ["Leads", hIg[4]], ["Posts", hIg[5]], ["Reels", hIg[6]], ["Stories", hIg[7]]]} />
            : <Missing what="Instagram" />
        ) : loading ? <Loading /> : !ig?.available ? <Missing what="Instagram" live /> : (
          <Stats items={[
            ["Followers", ig.followers, pinNote(ig.followersAsOf)], ["Reach", compact(ig.reach)], ["Content interactions", compact(ig.contentInteractions)],
            ["Leads", ig.leads], ["Posts", ig.post], ["Reels", ig.reel], ["Stories", ig.story, ig.story == null ? "not kept before Jul 2026" : undefined],
          ]} />
        )}
      </Section>
      {imported && hEng && (
        <Section title="Likes · Comments · Saves · Shares">
          <Stats items={[["Likes", hEng.Likes], ["Comments", hEng.Comments], ["Saves", hEng.Saves], ["Shares", hEng.Shares]]} />
        </Section>
      )}
      {!imported && (copy === undefined ? <Loading /> : <InstagramTopContent from={from} to={to} saved={copy ? copy.topPosts ?? { posts: [] } : undefined} />)}

      <PlatformHeader name="YouTube" />
      <Section title="YouTube" note={imported ? undefined : "Subscribers · views · videos · shorts · leads (CRM estimate). Views reach YouTube 2–3 days late."}>
        {imported ? (
          hYt ? <Stats items={[["Subscribers", hYt[0]], ["Views", hYt[1]], ["Videos", hYt[2]], ["Shorts", hYt[3]], ["Leads", hYt[4]]]} /> : <Missing what="YouTube" />
        ) : yt === null ? <Loading /> : !yt.available ? <Missing what="YouTube" live /> : (
          <Stats items={[["Subscribers", ytSubs, pitNote], ["Views", compact(yt.views)], ["Videos", yt.video], ["Shorts", yt.shorts], ["Leads", yt.leads]]} />
        )}
      </Section>

      <PlatformHeader name="Facebook" />
      <Section title="Facebook">
        {imported && hFb ? <Stats items={[["Views", hFb[0]], ["Posts", hFb[1]], ["Reels", hFb[2]], ["Content interactions", hFb[3]], ["Followers", hFb[4]]]} />
          : <div className="text-[12px] text-gray-400">No Facebook numbers for this month — the stored Facebook token lacks <b>read_insights</b>, so Page metrics can&rsquo;t be read. Re-scope the token to enable it.</div>}
      </Section>

      <PlatformHeader name="LinkedIn" />
      <Section title="LinkedIn" note={imported ? undefined : "Followers · impressions · reactions · posts · comments."}>
        {imported ? (
          hLi ? <Stats items={[["Followers", hLi[0]], ["Impressions", hLi[1]], ["Reactions", hLi[2]], ["Posts", hLi[3]], ["Comments", hLi[4]]]} /> : <Missing what="LinkedIn" />
        ) : li === null ? <Loading /> : !li.available ? <Missing what="LinkedIn" live /> : (
          <Stats items={[
            ["Followers", liFollowers, pitNote], ["Impressions", li.impressions],
            // Too far back for LinkedIn's latest-25 posts: unknown, not 0.
            ...(li.postsComplete === false
              ? [["Posts", null, "too far back for LinkedIn"], ["Reactions", null], ["Comments", null]] as [string, null, string?][]
              : [["Posts", li.posts], ["Reactions", li.reactions], ["Comments", li.comments]] as [string, number][]),
          ]} />
        )}
      </Section>

      <ManualEditable title="Future Prospects" hint="Strategy bullets for the coming month." value={manual?.futureProspects ?? ""} onChange={(v) => updateField("futureProspects", v)} onBlur={saveNotes} loaded={manual != null} />
      <ManualEditable title="Post-Meeting Action Notes" hint="Actions agreed in the review meeting." value={manual?.actionNotes ?? ""} onChange={(v) => updateField("actionNotes", v)} onBlur={saveNotes} loaded={manual != null} />
    </article>
  );
}

const fmtNum = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-IN"));

// L/K compact notation to match the imported Notion values (e.g. "9.91L", "40.1K").
function compact(n: number | null): string {
  if (n == null) return "—";
  if (n >= 100_000) return `${(n / 100_000).toFixed(2).replace(/\.?0+$/, "")}L`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

// A row of headline tiles. Values are numbers (formatted here) or ready strings.
export function Stats({ items }: { items: [string, number | string | null | undefined, string?][] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map(([label, v, sub]) => (
        <div key={label} className="border border-gray-200 rounded-xl p-3">
          <div className="text-[22px] font-semibold tabular-nums text-[#232D42] leading-none">{typeof v === "string" ? v || "—" : fmtNum(v)}</div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mt-1">{label}</div>
          {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function Loading() {
  return <div className="border border-gray-200 rounded-xl"><LoadingBlock className="!py-8" size={24} /></div>;
}

function Missing({ what, live }: { what: string; live?: boolean }) {
  return <div className="text-[12px] text-gray-400">{live ? `Couldn't reach ${what} just now — try again in a minute.` : `The Notion report has no ${what} figures for this month.`}</div>;
}

// Best-performing Instagram content in the month — thumbnails ranked by engagement.
function InstagramTopContent({ from, to, saved }: { from: string; to: string; saved?: Top }) {
  const [d, setD] = useState<Top | null>(saved ?? null);
  useEffect(() => {
    if (saved) { setD(saved); return; }
    setD(null);
    fetch(`/api/reports/instagram-top?from=${from}&to=${to}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((j) => setD(j))
      .catch(() => setD({ posts: [] }));
  }, [from, to, saved]);
  return (
    <Section title="Best-performing content · Instagram" note="The month's top posts, ranked by likes + comments.">
      {!d ? <Loading />
        : d.posts.length === 0 ? <div className="text-sm text-gray-400">No Instagram posts in this month.</div>
        : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {d.posts.map((p, i) => (
              <a key={i} href={p.permalink} target="_blank" rel="noreferrer" className="group block">
                <div className="aspect-[4/5] rounded-lg bg-gray-100 overflow-hidden border border-gray-100">
                  {p.thumb ? <img src={p.thumb} alt="" className="w-full h-full object-contain transition group-hover:scale-105" loading="lazy" decoding="async" /> : <div className="w-full h-full grid place-items-center text-2xl text-gray-300">▢</div>}
                </div>
                <div className="text-[10.5px] text-gray-500 mt-1 flex items-center justify-between"><span>{p.type}</span><span className="tabular-nums">♥{fmtNum(p.likes)} · {fmtNum(p.comments)}</span></div>
              </a>
            ))}
          </div>
        )}
    </Section>
  );
}

type LeadStatusResp = {
  window: { from: string; to: string };
  total: number;
  byStatus: { status: string; count: number }[];
  statuses: string[];
  bySbu: { sbu: string; total: number; counts: Record<string, number> }[];
};

// Lead Status + Total Lead Status (SBU) — live from the CRM for the report window.
function LeadGrids({ from, to, saved }: { from: string; to: string; saved?: LeadStatusResp | null }) {
  const [d, setD] = useState<LeadStatusResp | null>(saved ?? null);
  const [err, setErr] = useState<string | null>(saved === null ? "not in the saved copy" : null);
  useEffect(() => {
    if (saved !== undefined) return;
    setD(null); setErr(null);
    fetch(`/api/reports/lead-status?from=${from}&to=${to}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => setD(j as LeadStatusResp))
      .catch((e) => setErr(e instanceof Error ? e.message : "failed"));
  }, [from, to, saved]);

  if (err) return <Placeholder title="Lead Status" note={`Couldn't load — ${err}`} />;
  if (!d) return <div className="border border-gray-200 rounded-xl"><LoadingBlock className="!py-8" size={24} label="Loading lead status…" /></div>;

  const maxStatus = Math.max(1, ...d.byStatus.map((s) => s.count));
  // Keep the SBU matrix readable: the top 7 statuses as columns, rest folded into "Other".
  const cols = d.statuses.slice(0, 7);
  const otherCols = d.statuses.slice(7);
  const otherOf = (counts: Record<string, number>) => otherCols.reduce((n, s) => n + (counts[s] || 0), 0);

  return (
    <div className="space-y-6">
      <Section title="Lead Status" note={`Leads created ${d.window.from} → ${d.window.to}, by status · ${d.total} total.`}>
        <div className="border border-gray-200 rounded-xl p-4 space-y-2.5">
          {d.byStatus.map((s) => {
            const pct = d.total ? Math.round((s.count / d.total) * 100) : 0;
            return (
              <div key={s.status} className="grid grid-cols-[170px_1fr_64px] items-center gap-3 text-[12.5px]">
                <span className="text-[#3B4457] truncate" title={s.status}>{s.status}</span>
                <span className="h-2.5 rounded-full bg-[#F3F5FA] overflow-hidden"><span className="block h-full rounded-full bg-brand" style={{ width: `${(s.count / maxStatus) * 100}%` }} /></span>
                <span className="text-right tabular-nums"><b className="font-medium text-[#232D42]">{s.count}</b> <span className="text-gray-400">{pct}%</span></span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Total Lead Status (SBU)" note="Leads by SBU (rows) × status (columns).">
        <div className="border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-[12px] whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-[11px] uppercase tracking-wide sticky left-0 bg-gray-50">SBU</th>
                {cols.map((s) => <th key={s} className="px-3 py-2 text-right font-semibold text-[11px] uppercase tracking-wide">{s}</th>)}
                {otherCols.length > 0 && <th className="px-3 py-2 text-right font-semibold text-[11px] uppercase tracking-wide">Other</th>}
                <th className="px-3 py-2 text-right font-semibold text-[11px] uppercase tracking-wide">Total</th>
              </tr>
            </thead>
            <tbody>
              {d.bySbu.map((r) => (
                <tr key={r.sbu} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-left font-medium text-[#232D42] sticky left-0 bg-white">{r.sbu}</td>
                  {cols.map((s) => <td key={s} className="px-3 py-2 text-right tabular-nums text-gray-600">{r.counts[s] || 0}</td>)}
                  {otherCols.length > 0 && <td className="px-3 py-2 text-right tabular-nums text-gray-600">{otherOf(r.counts)}</td>}
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#232D42]">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

export function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold">{title}</div>
      {note && <div className="text-[12px] text-gray-400 mt-0.5 mb-3">{note}</div>}
      {!note && <div className="mb-3" />}
      {children}
    </section>
  );
}

function PlatformHeader({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className="h-px flex-1 bg-gray-100" />
      <div className="text-[13px] font-semibold text-brand uppercase tracking-widest">{name}</div>
      <div className="h-px flex-1 bg-gray-100" />
    </div>
  );
}

// Sections added to this month's report: a title and text. Text pasted from a
// table (tab-separated lines — the Airtable Backup's "Copy table", or cells copied
// from a spreadsheet) shows as a table; "Edit" brings the text back.
function asTable(body: string): string[][] | null {
  const lines = body.trim().split(/\r?\n/).filter((l) => l.trim());
  return lines.length >= 2 && lines.every((l) => l.includes("\t")) ? lines.map((l) => l.split("\t")) : null;
}

export function AddedSections({ sections, loaded, onChange, onBlur }: {
  sections: ManualSection[]; loaded: boolean; onBlur: () => void;
  onChange: (next: ManualSection[], saveNow?: boolean) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const edit = (id: string, patch: Partial<ManualSection>) => onChange(sections.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const add = () => {
    const id = Math.random().toString(36).slice(2, 10);
    onChange([...sections, { id, title: "", body: "" }], true);
    setEditing(id);
  };
  return (
    <div className="space-y-4">
      {sections.map((x) => {
        const table = asTable(x.body);
        const showText = !table || editing === x.id;
        return (
          <section key={x.id} className="rounded-xl border border-gray-200 bg-white px-4 py-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <IconPencil size={12} stroke={1.8} className="text-gray-500 flex-shrink-0" />
              <input value={x.title} disabled={!loaded} onChange={(e) => edit(x.id, { title: e.target.value })} onBlur={onBlur} placeholder="Section title"
                className="flex-1 min-w-0 text-[11px] font-semibold uppercase tracking-widest text-gray-500 placeholder:text-gray-300 bg-transparent outline-none" />
              {table && <button onClick={() => setEditing(editing === x.id ? null : x.id)} className="text-[11px] font-medium text-brand hover:text-[#2138B0]">{editing === x.id ? "Done" : "Edit"}</button>}
              <button onClick={() => onChange(sections.filter((s) => s.id !== x.id), true)} aria-label="Remove section" title="Remove section" className="text-gray-400 hover:text-rose-600"><IconTrash size={14} stroke={1.8} /></button>
            </div>
            {showText && (
              <textarea value={x.body} disabled={!loaded} onChange={(e) => edit(x.id, { body: e.target.value })}
                onBlur={() => { onBlur(); if (asTable(x.body)) setEditing(null); }}
                rows={Math.min(12, Math.max(3, x.body.split("\n").length + 1))} placeholder="Write here, or paste a table — copied cells come out as a table."
                className="w-full text-[13px] text-[#232D42] border border-gray-200 rounded-lg px-3 py-2 leading-relaxed resize-y focus:outline-none focus:border-brand" />
            )}
            {table && (
              <div className={`border border-gray-200 rounded-xl overflow-x-auto ${showText ? "mt-3" : ""}`}>
                <table className="w-full text-[12.5px] whitespace-nowrap">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>{table[0].map((h, i) => <th key={i} className={`px-3 py-2 font-semibold text-[11px] uppercase tracking-wide ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {table.slice(1).map((r, ri) => (
                      <tr key={ri} className="border-t border-gray-100">
                        {r.map((c, ci) => <td key={ci} className={`px-3 py-2 tabular-nums ${ci ? "text-right text-gray-600" : "text-left text-[#232D42]"}`}>{c}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      <button onClick={add} disabled={!loaded}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 py-2.5 text-[12.5px] font-medium text-gray-500 hover:border-brand hover:text-brand disabled:opacity-50">
        <IconPlus size={14} stroke={2} />Add a section
      </button>
    </div>
  );
}

// Editable narrative section — fully controlled by the parent, which owns all six
// fields and saves the whole object on blur (serialised), so overlapping saves can't
// drop a field. Disabled until the saved values have loaded.
function ManualEditable({ title, hint, value, onChange, onBlur, loaded, state }: {
  title: string; hint: string; value: string; onChange: (v: string) => void; onBlur: () => void; loaded: boolean;
  state?: "idle" | "saving" | "saved" | "error";
}) {
  const rows = Math.min(12, Math.max(3, (value || "").split("\n").length + 1));
  return (
    <section className="rounded-xl border border-gray-200 bg-white px-4 py-3.5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500"><IconPencil size={12} stroke={1.8} className="inline -mt-0.5 mr-1" />{title}</span>
        {state === "saving" && <span className="text-[10px] text-gray-400">saving…</span>}
        {state === "saved" && <span className="text-[10px] text-emerald-600">✓ notes saved</span>}
        {state === "error" && <span className="text-[10px] text-rose-600">save failed — retry</span>}
      </div>
      <textarea
        value={value}
        disabled={!loaded}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        rows={rows}
        placeholder={loaded ? hint : "Loading…"}
        className="w-full text-[13px] text-[#232D42] border border-gray-200 rounded-lg px-3 py-2 leading-relaxed resize-y focus:outline-none focus:border-brand disabled:bg-gray-50 disabled:text-gray-400"
      />
    </section>
  );
}

// Live/chart section not wired up yet — shown so the report's shape is complete.
function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">{title}</span>
        <span className="text-[10px] font-medium text-brand bg-brand-light rounded-full px-2 py-0.5">auto · wiring up</span>
      </div>
      <div className="text-[12px] text-gray-400 mt-1.5">{note}</div>
    </section>
  );
}
