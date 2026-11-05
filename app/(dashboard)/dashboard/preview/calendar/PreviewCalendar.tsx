"use client";
import { useEffect, useMemo, useState } from "react";
import { IconChevronLeft, IconChevronRight, IconRefresh, IconBrandInstagram, IconBrandFacebook } from "@tabler/icons-react";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { pageInfo } from "@/lib/publish-pages";
import { usePublishPages } from "@/lib/use-publish-pages";
import { useSbus, addBrand } from "@/lib/use-sbus";
import { showToast } from "../Toast";
import { PreviewDatePicker } from "@/app/(dashboard)/dashboard/preview/PreviewDatePicker";
import { fmtDateTime } from "@/lib/date";
import { SoundVideo } from "@/components/SoundVideo";
import { CopyLink, taskLinkPath } from "../CopyLink";

// Themed (Version 2) Publishing Calendar — built to match the the dashboard theme reference
// page 1:1 (special-pages/calender.html): blue hero band → "Calendar" title card
// (pulled up to overlap) → a full-width calendar card with the toolbar (‹ › Today ·
// Month YYYY · Month/Week/Day/List) and colored time-stamped event chips. NO left-rail
// filters / drafts dock (those were the "old V1" bits). Data is still the real
// /api/scheduler/queue posts. V1 page.tsx is untouched.

export type EffectiveStatus = "scheduled" | "publishing" | "published" | "failed" | "draft" | "unknown";

const isVideoUrl = (u?: string | null) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u || "");

export type ScheduledPost = {
  id: string; particulars: string; publishToPage: string; primaryInterest: string;
  type: string; caption: string; thumbnailUrl: string | null; scheduleTime: string | null;
  status: string; effectiveStatus: EffectiveStatus; failureReason: string | null;
  instagramUrl: string | null; facebookUrl: string | null; publishedAt: string | null;
  mediaUrls?: string[]; // all slides / the reel video, in order (from the queue API)
  fullCaption?: string;       // untrimmed, for "see more"
  coverUrl?: string | null;   // reel cover, when one was chosen
  igMediaId?: string | null;  // Instagram media id, recorded at publish — for insights
};

// Event-chip colour. Like the reference, each event is a soft-tinted bar; we drive the
// tint from status so the colours still MEAN something (green=published, etc.).
export const STATUS_STYLE: Record<EffectiveStatus, { bg: string; text: string; dot: string; label: string }> = {
  scheduled:  { bg: "#FEF3E2", text: "#B45309", dot: "#F59E0B", label: "Scheduled" },
  publishing: { bg: "#E4ECFF", text: "#2138B0", dot: "#3A57E8", label: "Publishing" },
  published:  { bg: "#E3F5EA", text: "#157F3C", dot: "#1AA053", label: "Published" },
  failed:     { bg: "#FCE8EC", text: "#BE123C", dot: "#E11D48", label: "Failed" },
  draft:      { bg: "#F1F3F8", text: "#5B6472", dot: "#9AA3B2", label: "Draft" },
  unknown:    { bg: "#F1F3F8", text: "#6B7280", dot: "#C3C9D4", label: "Unknown" },
};

// Content-format lanes for the "By format" view. Every post is bucketed by its
// type into one of these; the order here is also the display order top→bottom.
export const LANE_ORDER = ["story", "post", "reel", "carousel"] as const;
export type LaneKey = (typeof LANE_ORDER)[number];
export const LANE_META: Record<LaneKey, { label: string; color: string; soft: string }> = {
  story:    { label: "Stories",   color: "#E11D48", soft: "#FCE8EC" },
  post:     { label: "Posts",     color: "#3A57E8", soft: "#E9ECFB" },
  reel:     { label: "Reels",     color: "#6E48F8", soft: "#EDE9FE" },
  carousel: { label: "Carousels", color: "#0EA5E9", soft: "#E4F4FD" },
};
export function laneKeyFor(type: string): LaneKey {
  const t = type || "";
  if (/story/i.test(t)) return "story";
  if (/reel/i.test(t)) return "reel";
  if (/carousel/i.test(t)) return "carousel";
  return "post";
}

// An account's name / handle / colour, for any page we post to — the GooCampus pages
// or a brand linked on the Brands page (lib/publish-pages.ts).
const SOFT: Record<string, string> = { "#3A57E8": "#E9ECFB", "#0EA5E9": "#E4F4FD", "#E11D48": "#FCE8EC", "#8B5CF6": "#EFEBFE" };
export function accountStyle(publishToPage: string): { name: string; handle: string; color: string; soft: string } {
  const p = pageInfo(publishToPage);
  if (!p.handle) return { name: "—", handle: "—", color: "#9AA3B2", soft: "#F1F3F8" };
  return { name: p.value, handle: p.handle, color: p.color, soft: SOFT[p.color] || "#F1F3F8" };
}


export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];   // by getDay()
// Weeks run Monday → Sunday (Manya, 15 Oct) — same as the Content calendar.
const WEEK_HEADER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const mondayOffset = (d: Date) => (d.getDay() + 6) % 7;
export const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// "3:33 PM", not "3:33p". The short form read as a code rather than a time —
// nobody parses a bare "p" as PM at a glance. Minutes always shown, so "5:00 PM"
// and "5:30 PM" line up in a column instead of one reading "5p".
export function timeShort(ts: string): string {
  const d = new Date(ts); let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

type View = "month" | "week" | "day" | "list" | "format";
const VIEW_LABEL: Record<View, string> = { month: "Month", week: "Week", day: "Day", list: "List", format: "By format" };


// A post from /api/posts (real published Instagram media).
type IgPost = { id: string; caption?: string; mediaUrl?: string; mediaUrls?: string[]; permalink?: string; type?: string; timestamp?: string };

// Map a real published IG post → the calendar's ScheduledPost. Status = published, the
// real creative goes in mediaUrls, and the permalink powers the ▶ / open-on-Instagram.
function igToScheduled(m: IgPost, page: string): ScheduledPost {
  const t = (m.type || "").toUpperCase();
  const type = /REEL/.test(t) ? "Reel" : /CAROUSEL/.test(t) ? "Carousel" : "Post";
  const media = m.mediaUrls && m.mediaUrls.length ? m.mediaUrls : (m.mediaUrl ? [m.mediaUrl] : []);
  const caption = m.caption || "";
  const title = caption.split("\n")[0].slice(0, 60) || `${type} post`;
  return {
    id: `ig-${m.id}`,
    particulars: title,
    publishToPage: page,
    primaryInterest: "",
    type,
    caption,
    thumbnailUrl: media[0] || null,
    scheduleTime: null,
    status: "Published",
    effectiveStatus: "published",
    failureReason: null,
    instagramUrl: m.permalink || null,
    facebookUrl: null,
    igMediaId: m.id || null,
    publishedAt: m.timestamp || null,
    mediaUrls: media,
  };
}

export function PreviewCalendar() {
  // Every account we post to — GooCampus's and the brands linked on the Brands page.
  const pages = usePublishPages();
  const sbus = useSbus();
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [view, setView] = useState<View>("month");
  // Open on the current month so real scheduled/published posts are visible on load.
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState<ScheduledPost | null>(null);
  // Real scheduled/published posts only — there are no sample posts.

  const load = () => {
    setLoading(true);
    // 1) the scheduled/publish queue (mh_posts) — future & in-flight posts.
    const queueP = fetch("/api/scheduler/queue")
      .then((r) => (r.ok ? r.json() : { posts: [] }))
      .then((d: { posts?: ScheduledPost[] }) => d.posts || [])
      .catch(() => [] as ScheduledPost[]);
    // 2) REAL published Instagram posts across the three accounts — actual creatives &
    //    permalinks, plotted on their published date (replaces the demo "published" fillers).
    const to = ymd(new Date());
    const from = ymd(new Date(Date.now() - 150 * 86_400_000));
    const publishedP = Promise.all(
      pages.map(({ accountId: id, value: page }) =>
        fetch(`/api/posts?accountId=${id}&from=${from}&to=${to}&limit=60`)
          .then((r) => (r.ok ? r.json() : { posts: [] }))
          .then((d: { posts?: IgPost[] }) => (d.posts || []).map((m) => igToScheduled(m, page)))
          .catch(() => [] as ScheduledPost[]),
      ),
    ).then((arrs) => arrs.flat());

    Promise.all([queueP, publishedP])
      .then(([queue, published]) => { setPosts([...queue, ...published]); setFetchedAt(Date.now()); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [pages]);

  // Narrow by brand and by outcome. "How many 12thPlus posts went out this month"
  // was unanswerable before — every view showed everything.
  const [fSbu, setFSbu] = useState("");
  const [fStatus, setFStatus] = useState<"" | EffectiveStatus>("");
  // A custom window, for questions the month grid can't answer on its own —
  // "everything for this brand between the 1st and the 20th".
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  const unfiltered = posts;
  const allPosts = useMemo(
    () => unfiltered.filter((p) =>
      (!fSbu || (fSbu === "__none" ? !p.primaryInterest : p.primaryInterest === fSbu))
      && (!fStatus || p.effectiveStatus === fStatus)
      && inRange(p, fFrom, fTo)),
    [unfiltered, fSbu, fStatus, fFrom, fTo],
  );
  // Every Primary Interest (the live list) plus any older name a post still carries.
  const sbusPresent = useMemo(
    () => [...new Set([...sbus, ...unfiltered.map((p) => p.primaryInterest).filter(Boolean)])].sort(),
    [sbus, unfiltered],
  );
  // What the filters are showing, for the month on screen.
  const ranged = Boolean(fFrom || fTo);
  const monthCount = useMemo(() => {
    if (ranged) return allPosts.filter((p) => p.publishedAt || p.scheduleTime).length;
    const y = anchor.getFullYear(), m = anchor.getMonth();
    return allPosts.filter((p) => {
      const ts = p.publishedAt || p.scheduleTime;
      if (!ts) return false;
      const d = new Date(ts);
      return d.getFullYear() === y && d.getMonth() === m;
    }).length;
  }, [allPosts, anchor, ranged]);
  const countWhere = ranged
    ? `${fFrom ? niceDay(fFrom) : "the start"} – ${fTo ? niceDay(fTo) : "now"}`
    : anchor.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  // Bucket scheduled/published posts onto their day (drafts with no time are simply
  // not plotted — the reference calendar shows only dated events).
  const postsByDate = useMemo(() => {
    const byDate = new Map<string, ScheduledPost[]>();
    for (const p of allPosts) {
      const ts = p.publishedAt || p.scheduleTime;
      if (!ts) continue;
      const key = ymd(new Date(ts));
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(p);
    }
    for (const [, arr] of byDate) arr.sort((a, b) => new Date(a.scheduleTime || a.publishedAt || 0).getTime() - new Date(b.scheduleTime || b.publishedAt || 0).getTime());
    return byDate;
  }, [allPosts]);

  const monthGrid = useMemo(() => {
    const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = new Date(firstOfMonth);
    start.setDate(start.getDate() - mondayOffset(firstOfMonth));
    const cells: { date: Date; inMonth: boolean; isToday: boolean }[] = [];
    const today = ymd(new Date());
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      cells.push({ date: d, inMonth: d.getMonth() === anchor.getMonth(), isToday: ymd(d) === today });
    }
    return cells;
  }, [anchor]);

  const weekDays = useMemo(() => {
    const start = new Date(anchor); start.setDate(anchor.getDate() - mondayOffset(anchor));
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [anchor]);

  const agenda = useMemo(() => {
    const days: { date: Date; items: ScheduledPost[] }[] = [];
    const y = anchor.getFullYear(), m = anchor.getMonth();
    for (let day = 1; day <= 31; day++) {
      const d = new Date(y, m, day); if (d.getMonth() !== m) break;
      const items = postsByDate.get(ymd(d)) || [];
      if (items.length) days.push({ date: d, items });
    }
    return days;
  }, [anchor, postsByDate]);

  // "By format" lanes for the current month — real scheduled/published posts.
  const formatLanes = useMemo(() => {
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const buckets: Record<LaneKey, ScheduledPost[]> = { story: [], post: [], reel: [], carousel: [] };
    const source = allPosts;
    for (const p of source) {
      const ts = p.publishedAt || p.scheduleTime;
      if (!ts) continue;
      const d = new Date(ts);
      if (d.getFullYear() !== y || d.getMonth() !== m) continue;
      buckets[laneKeyFor(p.type)].push(p);
    }
    for (const k of LANE_ORDER) {
      buckets[k].sort((a, b) => new Date(a.scheduleTime || a.publishedAt || 0).getTime() - new Date(b.scheduleTime || b.publishedAt || 0).getTime());
    }
    return buckets;
  }, [anchor, allPosts]);

  const shift = (dir: number) => setAnchor((cur) => {
    const d = new Date(cur);
    if (view === "week") d.setDate(d.getDate() + dir * 7);
    else if (view === "day") d.setDate(d.getDate() + dir);
    else d.setMonth(d.getMonth() + dir);
    return d;
  });
  const jumpToday = () => setAnchor(new Date());

  const title = useMemo(() => {
    if (view === "day") return `${DAY_FULL[anchor.getDay()]}, ${MONTH_ABBR[anchor.getMonth()]} ${anchor.getDate()}`;
    if (view === "week") {
      const s = weekDays[0], e = weekDays[6];
      const sM = MONTH_ABBR[s.getMonth()], eM = MONTH_ABBR[e.getMonth()];
      return sM === eM ? `${sM} ${s.getDate()} – ${e.getDate()}, ${e.getFullYear()}` : `${sM} ${s.getDate()} – ${eM} ${e.getDate()}, ${e.getFullYear()}`;
    }
    return `${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`;
  }, [view, anchor, weekDays]);

  return (
    <div className="hcal">
      <style dangerouslySetInnerHTML={{ __html: HCAL_CSS }} />

      {/* HERO band (matches the reference's iq-navbar-header) */}
      <div className="hcal-hero">
        <div className="hcal-hero-txt">
          <h1 className="preview-hero-h1">Publishing Calendar</h1>
          <p>Every scheduled &amp; published post across your accounts, month at a glance.</p>
        </div>
      </div>

      {/* Title card, pulled up to overlap the hero (reference's "Calendar" + Back card) */}
      <div className="hcal-titlecard">
        <h4>Calendar</h4>
        <button className="hcal-refresh" onClick={load} disabled={loading}>
          <IconRefresh size={15} stroke={2} className={loading ? "spin" : ""} />
          {loading ? "Syncing…" : fetchedAt ? "Live" : "Refresh"}
        </button>
      </div>

      {/* The calendar card */}
      <div className="hcal-card">
        <div className="hcal-filters">
          <span className="hcal-flabel">Primary Interest / SBU</span>
          <PreviewSelect value={fSbu} onChange={setFSbu} placeholder="All Primary Interests"
            options={[{ value: "", label: "All Primary Interests" },
                      ...sbusPresent.map((b) => ({ value: b, label: b })),
                      { value: "__none", label: "No Primary Interest" }]}
            addOption={{ label: "Add a Primary Interest", onAdd: (name) => {
              addBrand(name).then((saved) => {
                setFSbu(saved);
                showToast({ who: "Primary Interest added", body: `${saved} is now in every Primary Interest list.`, color: "#3A57E8", av: "✓" });
              }).catch((e) => showToast({ who: "Couldn't add it", body: (e as Error).message, color: "#C0392B", av: "!" }));
            } }} />
          <span className="hcal-flabel">Status</span>
          <PreviewSelect value={fStatus} onChange={(v) => setFStatus(v as "" | EffectiveStatus)}
            placeholder="Any status"
            options={[{ value: "", label: "Any status" },
                      ...(["published", "scheduled", "publishing", "failed", "draft"] as EffectiveStatus[])
                        .map((k) => ({ value: k, label: STATUS_STYLE[k].label }))]} />
          <span className="hcal-flabel">Between</span>
          <PreviewDatePicker value={fFrom} onChange={setFFrom} size="sm" placeholder="Any start" max={fTo || undefined} />
          <PreviewDatePicker value={fTo} onChange={setFTo} size="sm" placeholder="Any end" min={fFrom || undefined} />
          {(fSbu || fStatus || fFrom || fTo) && (
            <button className="hcal-fclear" onClick={() => { setFSbu(""); setFStatus(""); setFFrom(""); setFTo(""); }}>Clear</button>
          )}
          <span className="hcal-fcount"><b>{monthCount}</b> {monthCount === 1 ? "post" : "posts"} in {countWhere}</span>
          {/* What the colours mean — they were already doing this, just never said so. */}
          <span className="hcal-legend">
            {(["published", "scheduled", "publishing", "failed"] as EffectiveStatus[]).map((k) => (
              <span key={k} className="hcal-lg"><i style={{ background: STATUS_STYLE[k].dot }} />{STATUS_STYLE[k].label}</span>
            ))}
          </span>
        </div>
        <div className="hcal-toolbar">
          <div className="hcal-nav">
            <button className="hcal-navbtn" onClick={() => shift(-1)} aria-label="Previous"><IconChevronLeft size={17} stroke={2.2} /></button>
            <button className="hcal-navbtn" onClick={() => shift(1)} aria-label="Next"><IconChevronRight size={17} stroke={2.2} /></button>
            <button className="hcal-today" onClick={jumpToday}>Today</button>
          </div>
          <div className="hcal-title">{title}</div>
          <div className="hcal-views">
            {(["month", "week", "day", "list", "format"] as View[]).map((v) => (
              <button key={v} className={`hcal-viewbtn ${view === v ? "on" : ""}`} onClick={() => setView(v)}>
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
        </div>

        {view === "month" && (
          <>
            <div className="hcal-dow">{WEEK_HEADER.map((d) => <span key={d}>{d}</span>)}</div>
            <div className="hcal-grid">
              {monthGrid.map((cell, i) => {
                const dayPosts = postsByDate.get(ymd(cell.date)) || [];
                return (
                  <div key={i} className={`hcal-cell ${!cell.inMonth ? "out" : ""} ${cell.isToday ? "today" : ""}`}>
                    <div className="hcal-daynum">{cell.date.getDate()}</div>
                    <div className="hcal-events">
                      {dayPosts.slice(0, 3).map((p) => <EventChip key={p.id} post={p} onClick={() => setSelected(p)} />)}
                      {dayPosts.length > 3 && (
                        <button className="hcal-more" onClick={() => setSelected(dayPosts[3])}>+ {dayPosts.length - 3} more</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {view === "week" && (
          <div className="hcal-week">
            {weekDays.map((d, i) => {
              const dayPosts = postsByDate.get(ymd(d)) || [];
              const isToday = ymd(d) === ymd(new Date());
              return (
                <div key={i} className={`hcal-weekcol ${isToday ? "today" : ""}`}>
                  <div className="hcal-weekhead">
                    <span className="hcal-weekdow">{DAY_LABELS[d.getDay()]}</span>
                    <span className={`hcal-weeknum ${isToday ? "today" : ""}`}>{d.getDate()}</span>
                  </div>
                  <div className="hcal-weekbody">
                    {dayPosts.length === 0 ? <span className="hcal-empty">—</span>
                      : dayPosts.map((p) => <EventChip key={p.id} post={p} onClick={() => setSelected(p)} block />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view === "day" && (
          <div className="hcal-day">
            {(() => {
              const dayPosts = postsByDate.get(ymd(anchor)) || [];
              if (dayPosts.length === 0) return <div className="hcal-dayempty">No posts scheduled for this day.</div>;
              return dayPosts.map((p) => {
                const ts = p.publishedAt || p.scheduleTime;
                return (
                  <div key={p.id} className="hcal-dayrow" onClick={() => setSelected(p)}>
                    <span className="hcal-daytime">{ts ? new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—"}</span>
                    <EventChip post={p} onClick={() => setSelected(p)} block />
                  </div>
                );
              });
            })()}
          </div>
        )}

        {view === "list" && (
          <div className="hcal-agenda">
            {agenda.length === 0 ? <div className="hcal-dayempty">No posts this month.</div>
              : agenda.map(({ date, items }) => (
                <div key={ymd(date)} className="hcal-agroup">
                  <div className="hcal-adate">
                    <span className="hcal-adow">{DAY_LABELS[date.getDay()]}</span>
                    <span className="hcal-aday">{date.getDate()}</span>
                    <span className="hcal-amon">{MONTH_ABBR[date.getMonth()]}</span>
                  </div>
                  <div className="hcal-aitems">
                    {items.map((p) => {
                      const ts = p.publishedAt || p.scheduleTime;
                      const acct = accountStyle(p.publishToPage);
                      const st = STATUS_STYLE[p.effectiveStatus];
                      return (
                        <button key={p.id} className="hcal-arow" onClick={() => setSelected(p)}>
                          <span className="hcal-atime">{ts ? timeShort(ts) : "—"}</span>
                          <span className="hcal-abar" style={{ background: acct.color }} />
                          <span className="hcal-atitle">{p.particulars || "(no title)"}</span>
                          <span className="hcal-apill" style={{ background: acct.soft, color: acct.color }}>{acct.handle}</span>
                          <span className="hcal-astatus" style={{ background: st.bg, color: st.text }}>{st.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        )}

        {view === "format" && (
          <div className="hcal-fmt">
            {LANE_ORDER.map((k) => {
              const meta = LANE_META[k];
              const items = formatLanes[k];
              return (
                <div key={k} className="hcal-lane">
                  <div className="hcal-lanehead">
                    <span className="hcal-lanedot" style={{ background: meta.color }} />
                    <span className="hcal-lanename">{meta.label}</span>
                    <span className="hcal-lanecount" style={{ background: meta.soft, color: meta.color }}>{items.length}</span>
                  </div>
                  {items.length === 0 ? (
                    <div className="hcal-laneempty">Nothing scheduled this month.</div>
                  ) : (
                    <div className="hcal-laneitems">
                      {items.map((p) => {
                        const ts = p.publishedAt || p.scheduleTime;
                        const acct = accountStyle(p.publishToPage);
                        const st = STATUS_STYLE[p.effectiveStatus];
                        const d = ts ? new Date(ts) : null;
                        return (
                          <button key={p.id} className="hcal-frow" onClick={() => setSelected(p)}>
                            <span className="hcal-fwhen">
                              <span className="hcal-fday">{d ? `${DAY_LABELS[d.getDay()]} ${d.getDate()} ${MONTH_ABBR[d.getMonth()]}` : "—"}</span>
                              <span className="hcal-ftime">{ts ? timeShort(ts) : ""}</span>
                            </span>
                            <span className="hcal-abar" style={{ background: acct.color }} />
                            <span className="hcal-atitle">{p.particulars || "(no title)"}</span>
                            <span className="hcal-apill" style={{ background: acct.soft, color: acct.color }}>{acct.handle}</span>
                            <span className="hcal-astatus" style={{ background: st.bg, color: st.text }}>{st.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected && <DetailModal post={selected} onClose={() => setSelected(null)} onRetried={() => { setSelected(null); load(); }}
        onReschedule={(p) => { setSelected(null); window.location.href = "/dashboard/preview/scheduler"; void p; }} />}
    </div>
  );
}

/* ---------- building blocks ---------- */

/** "YYYY-MM-DD" → "3 Sep". */
function niceDay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Inside the chosen window? An open end stays open. */
function inRange(p: ScheduledPost, from: string, to: string): boolean {
  if (!from && !to) return true;
  const ts = p.publishedAt || p.scheduleTime;
  if (!ts) return false;
  const key = ymd(new Date(ts));
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

function EventChip({ post, onClick, block }: { post: ScheduledPost; onClick: () => void; block?: boolean }) {
  const acct = accountStyle(post.publishToPage);
  const st = STATUS_STYLE[post.effectiveStatus];
  const ts = post.publishedAt || post.scheduleTime;
  return (
    <button
      onClick={onClick}
      className={`hcal-ev ${block ? "block" : ""}`}
      style={{ background: st.bg, borderColor: st.dot }}
      title={`${post.particulars} — ${acct.handle} · ${st.label}`}
    >
      <span className="hcal-evbody">
        <span className="hcal-evtitle" style={{ color: st.text }}>{post.particulars || "(no title)"}</span>
        {post.primaryInterest && <span className="hcal-evsbu" style={{ color: st.text }} title="Primary Interest / SBU">{post.primaryInterest}</span>}
      </span>
      {ts && <span className="hcal-evtime" style={{ color: st.text }}>{timeShort(ts)}</span>}
    </button>
  );
}

// Creative preview: the post's actual media. Image → shown; Carousel → slideshow
// (‹ › + dots); Reel/video → inline <video controls> (real posts) or a poster with
// a ▶ that opens the Instagram permalink (demo / when only a thumbnail exists).
function MediaPreview({ post, pane }: { post: ScheduledPost; pane?: boolean }) {
  const media = (post.mediaUrls && post.mediaUrls.length) ? post.mediaUrls : (post.thumbnailUrl ? [post.thumbnailUrl] : []);
  const [idx, setIdx] = useState(0);
  if (!media.length) return <div className="hcal-media-empty">No creative attached to this post.</div>;
  const cur = media[Math.min(idx, media.length - 1)];
  const isVideo = isVideoUrl(cur);
  const isReel = /reel/i.test(post.type) || isVideo;
  return (
    <div className={`hcal-media ${pane ? "pane" : ""}`}>
      <div className={`hcal-media-stage ${isReel ? "reel" : ""}`}>
        {isVideo
          ? <SoundVideo className="hcal-media-el" src={cur} poster={post.coverUrl || undefined} open />
          : <img className="hcal-media-el" src={cur} alt={post.particulars} loading="lazy" decoding="async" />}
        {isReel && !isVideo && (
          post.instagramUrl
            ? <a className="hcal-media-play" href={post.instagramUrl} target="_blank" rel="noreferrer" title="Play reel on Instagram">▶</a>
            : <span className="hcal-media-play static" title="Reel">▶</span>
        )}
        {media.length > 1 && (
          <>
            <button className="hcal-media-nav prev" onClick={() => setIdx((i) => (i - 1 + media.length) % media.length)} aria-label="Previous slide">‹</button>
            <button className="hcal-media-nav next" onClick={() => setIdx((i) => (i + 1) % media.length)} aria-label="Next slide">›</button>
            <span className="hcal-media-count">{idx + 1}/{media.length}</span>
            <div className="hcal-media-dots">
              {media.map((_, i) => <button key={i} className={`hcal-media-dot ${i === idx ? "on" : ""}`} onClick={() => setIdx(i)} aria-label={`Slide ${i + 1}`} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Several URLs arrive in one column, joined with " , " by the publish worker. */
function splitUrls(v: string | null): string[] {
  return String(v || "").split(/[\s,]*,[\s,]*|\n/).map((x) => x.trim()).filter((x) => /^https?:\/\//i.test(x));
}

/**
 * What the post actually did. Instagram only — Meta gives no per-post insight for a
 * Page reel through this account's permissions, and a panel that shows Instagram's
 * numbers under a "Facebook" heading would be a lie.
 *
 * Needs the media id, which is recorded at publish time; posts published before that
 * was stored simply have no id and say so.
 */
function PostInsights({ post }: { post: ScheduledPost }) {
  const [data, setData] = useState<Record<string, number> | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "none" | "error">("idle");

  useEffect(() => {
    if (!post.igMediaId) { setState("none"); return; }
    let alive = true;
    setState("loading");
    fetch("/api/posts/insights", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ items: [{ id: post.igMediaId, mediaType: "VIDEO", mediaProductType: "REELS" }] }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const row = (d.insights || [])[0];
        if (!row) { setState("none"); return; }
        setData(row); setState("idle");
      })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, [post.igMediaId]);

  if (state === "none") return null;
  const tiles: [string, number | undefined][] = [
    ["Views", data?.views], ["Reach", data?.reach],
    ["Interactions", data?.totalInteractions], ["Saves", data?.saves], ["Shares", data?.shares],
  ];
  return (
    <div>
      <div className="hcal-modal-lbl">Instagram insights</div>
      {state === "loading" ? <div className="hcal-modal-val">Asking Instagram…</div>
        : state === "error" ? <div className="hcal-modal-val">Couldn&apos;t read the insights just now.</div>
        : (
          <div className="hcal-ins">
            {tiles.filter(([, v]) => typeof v === "number").map(([k, v]) => (
              <div key={k} className="hcal-ins-cell">
                <div className="hcal-ins-n">{(v as number).toLocaleString("en-IN")}</div>
                <div className="hcal-ins-k">{k}</div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

/** What kind of post this is, when the content record didn't say. */
function derivedType(media: string[]): string {
  if (media.length > 1) return "Carousel";
  if (isVideoUrl(media[0])) return "Reel";
  if (media.length === 1) return "Image";
  return "Post";
}

/** Captions run long. Show the opening, and the rest on request. */
function Caption({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const LIMIT = 220;
  const long = text.length > LIMIT;
  return (
    <div className="hcal-modal-caption">
      <span style={{ whiteSpace: "pre-wrap" }}>{open || !long ? text : text.slice(0, LIMIT).trimEnd() + "…"}</span>
      {long && (
        <button type="button" className="hcal-more-btn" onClick={() => setOpen((o) => !o)}>
          {open ? "See less" : "See more"}
        </button>
      )}
    </div>
  );
}

function DetailModal({ post, onClose, onRetried, onReschedule }: {
  post: ScheduledPost; onClose: () => void; onRetried: () => void; onReschedule?: (p: ScheduledPost) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const acct = accountStyle(post.publishToPage);
  const st = STATUS_STYLE[post.effectiveStatus];

  // "Publish now instead" moves the time to now (publish-now); "Try again" re-arms a
  // failed post at its time (retry). Both used the retry route, which never changes
  // the time — so "Publish now instead" did nothing (22 Oct review).
  async function retry(now = false) {
    setRetrying(true); setError(null);
    try {
      const r = await fetch(now ? "/api/scheduler/publish-now" : "/api/scheduler/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordId: post.id }) });
      const d = await r.json();
      if (!r.ok || d.error) setError(d.error || `HTTP ${r.status}`); else onRetried();
    } catch (e) { setError((e as Error).message); } finally { setRetrying(false); }
  }

  const whenLabel = post.publishedAt
    ? `Published ${fmtDateTime(post.publishedAt)}`
    : post.scheduleTime
    ? `Scheduled for ${fmtDateTime(post.scheduleTime)}`
    : "No schedule";

  // Reels (portrait) + carousels get a WIDE landscape modal: media in a left
  // column sized to its shape (no letterbox bars) with the details beside it.
  // A single image keeps the compact top-media layout.
  const media = (post.mediaUrls && post.mediaUrls.length) ? post.mediaUrls : (post.thumbnailUrl ? [post.thumbnailUrl] : []);
  // Portrait video = reel, whatever the type column says. It said "—" on the first
  // real reel, so the wide layout never triggered and the post rendered stacked with
  // empty air either side.
  const isReel = /reel/i.test(post.type) || isVideoUrl(media[0]);
  const isCarousel = /carousel/i.test(post.type) || media.length > 1;
  const wide = media.length > 0 && (isReel || isCarousel);
  const paneW = isReel ? 300 : 360;

  const headerEl = (
    <div className="hcal-modal-head" style={{ background: st.bg, borderLeftColor: acct.color }}>
      <div className="hcal-modal-headl">
        <span className="hcal-sdot" style={{ background: st.dot }} />
        <span className="hcal-modal-status" style={{ color: st.text }}>{st.label}</span>
        <span className="hcal-modal-acct" style={{ background: acct.soft, color: acct.color }}>{acct.handle}</span>
      </div>
      <span className="flex items-center gap-2">
        {/* A post read straight from Instagram (id "ig-…") has no task — its link is the post itself. */}
        {post.id.startsWith("ig-") ? (post.instagramUrl && <CopyLink path={post.instagramUrl} iconOnly />) : <CopyLink path={taskLinkPath(post.id)} iconOnly />}
        <button className="hcal-modal-x" onClick={onClose}>×</button>
      </span>
    </div>
  );
  const detailsEl = (
    <>
      <div>
        <div className="hcal-modal-lbl">Title</div>
        <div className="hcal-modal-title">{post.particulars || "(no title)"}</div>
      </div>
      <div className="hcal-modal-grid">
        <div><div className="hcal-modal-lbl">Brand</div><div className="hcal-modal-val">{post.publishToPage}</div></div>
        {/* The editorial type when the content record carries one, otherwise read off
            the creative itself — a dash told nobody anything. */}
        <div><div className="hcal-modal-lbl">Type</div><div className="hcal-modal-val">{post.type || derivedType(media)}</div></div>
        {post.primaryInterest && (
          <div><div className="hcal-modal-lbl">Interest</div><div className="hcal-modal-val">{post.primaryInterest}</div></div>
        )}
        <div><div className="hcal-modal-lbl">Time</div><div className="hcal-modal-val">{whenLabel}</div></div>
      </div>
      {(post.fullCaption || post.caption) && (
        <div>
          <div className="hcal-modal-lbl">Caption</div>
          <Caption text={post.fullCaption || post.caption} />
        </div>
      )}
      {/* Each state says what it means and what to do next. "Failed" with no
          explanation and no button is a dead end someone has to ask about. */}
      {post.effectiveStatus === "failed" && (
        <div className="hcal-modal-fail">
          <div className="hcal-modal-faillbl">What went wrong</div>
          <div className="hcal-modal-failtxt">{post.failureReason || "No reason was recorded."}</div>
          <div className="hcal-state-actions">
            <button onClick={() => retry()} disabled={retrying} className="hcal-act primary">
              {retrying ? "Putting it back…" : "Try again now"}
            </button>
            <button onClick={() => onReschedule?.(post)} className="hcal-act">Pick a new time</button>
          </div>
          <div className="hcal-state-note">Trying again puts it back in the queue; the worker takes it within a minute.</div>
          {error && <div className="hcal-modal-failtxt" style={{ marginTop: ".5rem" }}>{error}</div>}
        </div>
      )}
      {post.effectiveStatus === "scheduled" && (
        <div className="hcal-state">
          <div className="hcal-state-h">Waiting to go out</div>
          <div className="hcal-state-note">
            Nothing is live yet. It publishes {post.scheduleTime ? `on ${fmtDateTime(post.scheduleTime)}` : "when a time is set"} without
            anyone being here.
          </div>
          <div className="hcal-state-actions">
            <button onClick={() => retry(true)} disabled={retrying} className="hcal-act primary">
              {retrying ? "Sending…" : "Publish now instead"}
            </button>
            <button onClick={() => onReschedule?.(post)} className="hcal-act">Pick a new time</button>
          </div>
        </div>
      )}
      {post.effectiveStatus === "publishing" && (
        <div className="hcal-state">
          <div className="hcal-state-h">Going out now</div>
          <div className="hcal-state-note">
            Meta is processing the video. A reel takes a few minutes; the links appear here the moment
            it lands. Leave it — it carries on without this page open.
          </div>
        </div>
      )}
      {post.effectiveStatus === "draft" && (
        <div className="hcal-state">
          <div className="hcal-state-h">Draft</div>
          <div className="hcal-state-note">Saved, not queued. It stays here until someone schedules or publishes it.</div>
        </div>
      )}
      {(post.instagramUrl || post.facebookUrl) && (
        <div>
          <div className="hcal-modal-lbl">Published to</div>
          <div className="hcal-modal-links">
            {post.instagramUrl && (
              <a className="hcal-linkbtn ig" href={post.instagramUrl} target="_blank" rel="noreferrer">
                <IconBrandInstagram size={14} stroke={1.9} /> Instagram
              </a>
            )}
            {/* The worker joins several Facebook Pages with " , " — one link each,
                or the whole string becomes one dead href. */}
            {splitUrls(post.facebookUrl).map((u, i) => (
              <a key={u} className="hcal-linkbtn fb" href={u} target="_blank" rel="noreferrer">
                <IconBrandFacebook size={14} stroke={1.9} />
                Facebook{splitUrls(post.facebookUrl).length > 1 ? ` ${i + 1}` : ""}
              </a>
            ))}
          </div>
        </div>
      )}
      {post.effectiveStatus === "published" && <PostInsights post={post} />}
    </>
  );

  return (
    <div className="hcal-modal-bg" onClick={onClose}>
      {wide ? (
        <div className="hcal-modal hcal-modal-wide" onClick={(e) => e.stopPropagation()}>
          <div className="hcal-modal-mediapane" style={{ flexBasis: paneW }}>
            <MediaPreview post={post} pane />
          </div>
          <div className="hcal-modal-detail">
            {headerEl}
            <div className="hcal-modal-body">{detailsEl}</div>
          </div>
        </div>
      ) : (
        <div className="hcal-modal" onClick={(e) => e.stopPropagation()}>
          {headerEl}
          <div className="hcal-modal-body">
            <MediaPreview post={post} />
            {detailsEl}
          </div>
        </div>
      )}
    </div>
  );
}

const HCAL_CSS = `
/* .preview-scope redefines --brand as bare RGB channels ("58 87 232") for Tailwind's
   rgb(var(--brand) / a). This stylesheet uses --brand as a colour, so inside the scope
   every background:var(--brand) went invalid and fell back to transparent — the nav
   arrows, the active view, today's badge and the primary buttons all turned
   white-on-white. Team Command (.tcmd) and Social Leads (.sl) solve it the same way. */
.hcal{--brand:#3A57E8;--brand-soft:#E9ECFB;--brand-ink:#2138B0;--brand-rgb:58 87 232;--brand-dark-rgb:33 56 176;--brand-light-rgb:233 236 251;color:var(--ink)}
.hcal button{font-family:inherit;cursor:pointer}
/* hero band — mirrors the theme reference navbar-header */
.hcal-hero{position:relative;background:linear-gradient(115deg,#3A57E8 0%,#4A64EA 45%,#6B7CF2 100%);border-radius:16px;padding:1.6rem 1.8rem 3.4rem;color:#fff;overflow:hidden;display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}
.hcal-hero::after{content:"";position:absolute;right:-40px;top:-60px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.16),transparent 62%)}
.hcal-hero::before{content:"";position:absolute;right:120px;bottom:-90px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.10),transparent 62%)}
.hcal-hero-txt{position:relative;z-index:1}
.hcal-hero-tag{display:inline-block;font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.09em;background:rgba(255,255,255,.2);padding:.2rem .55rem;border-radius:20px;margin-bottom:.55rem}
.hcal-hero-txt h1{margin:0;font-size:1.44rem;font-weight:700;letter-spacing:-.01em}
.hcal-hero-txt p{margin:.35rem 0 0;font-size:.9rem;color:rgba(255,255,255,.82)}
.hcal-hero-demo{position:relative;z-index:1;display:flex;align-items:center;gap:.45rem;font-size:.78rem;font-weight:600;color:#fff;background:rgba(255,255,255,.16);padding:.45rem .8rem;border-radius:9px;cursor:pointer;user-select:none;backdrop-filter:blur(2px)}
.hcal-hero-demo input{position:absolute;opacity:0;width:0;height:0}
.hcal-sw{width:32px;height:18px;border-radius:9px;background:rgba(255,255,255,.35);position:relative;transition:.15s;flex:0 0 32px}
.hcal-sw.on{background:#fff}
.hcal-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:.15s}
.hcal-sw.on .hcal-knob{left:16px;background:var(--brand)}
/* title card, pulled up to overlap the hero */
.hcal-titlecard{position:relative;z-index:2;margin:-2.3rem 4px 0;background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:.9rem 1.3rem;display:flex;align-items:center;justify-content:space-between}
.hcal-titlecard h4{margin:0;font-size:1.15rem;font-weight:700;color:var(--ink)}
.hcal-refresh{display:flex;align-items:center;gap:.35rem;font-size:14px;font-weight:500;height:36px;color:#fff;background:var(--brand);border:none;border-radius:4px;padding:0 16px;box-shadow:0 4px 10px rgba(58,87,232,.24)}
.hcal-refresh:hover{background:#2f49c9}
.hcal-refresh:disabled{opacity:.7}
.hcal-refresh .spin{animation:hcalspin 1s linear infinite}
@keyframes hcalspin{to{transform:rotate(360deg)}}
/* calendar card */
.hcal-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);overflow:hidden;margin-top:1.1rem}
.hcal-filters{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem .7rem;padding:.7rem 1rem;border-bottom:1px solid var(--line)}
.hcal-flabel{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700}
.hcal-fsel{font:inherit;font-size:.78rem;padding:.35rem .6rem;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);max-width:230px}
.hcal-fclear{font-size:.74rem;font-weight:600;color:var(--brand);background:none;border:none;padding:.2rem .3rem}
.hcal-fcount{font-size:.78rem;color:var(--muted)}
.hcal-fcount b{color:var(--ink)}
.hcal-legend{margin-left:auto;display:flex;gap:.7rem;flex-wrap:wrap}
.hcal-lg{display:inline-flex;align-items:center;gap:.3rem;font-size:.7rem;color:var(--muted)}
.hcal-lg i{width:8px;height:8px;border-radius:50%;display:inline-block}
.hcal-toolbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.1rem;flex-wrap:wrap}
.hcal-nav{display:flex;align-items:center;gap:.4rem}
.hcal-navbtn{width:40px;height:36px;border-radius:4px;border:none;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(58,87,232,.22)}
.hcal-navbtn:hover{background:#2f49c9}
.hcal-today{border:none;background:var(--brand-soft);color:var(--brand-ink);font-weight:500;font-size:14px;height:36px;padding:0 12px;border-radius:4px;margin-left:.2rem}
.hcal-today:hover{background:#dfe3fa}
.hcal-title{font-size:1.35rem;font-weight:700;color:var(--ink);text-align:center;flex:1;min-width:180px}
.hcal-views{display:flex;align-items:stretch;height:36px;background:var(--panel-2);border:1px solid var(--line);border-radius:4px;padding:0;gap:0;overflow:hidden}
.hcal-viewbtn{border:none;background:none;font-size:12px;font-weight:500;color:var(--ink-soft);padding:0 14px;border-radius:0}
.hcal-viewbtn:hover{color:var(--ink)}
.hcal-viewbtn.on{background:var(--brand);color:#fff;box-shadow:0 3px 8px rgba(58,87,232,.24)}
/* month grid */
.hcal-dow{display:grid;grid-template-columns:repeat(7,1fr);border-top:1px solid var(--line);background:var(--panel-2)}
.hcal-dow span{padding:.55rem .6rem;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);border-right:1px solid var(--line)}
.hcal-dow span:last-child{border-right:none}
.hcal-grid{display:grid;grid-template-columns:repeat(7,1fr);grid-auto-rows:minmax(120px,1fr)}
.hcal-cell{border-right:1px solid var(--line);border-top:1px solid var(--line);padding:.35rem;position:relative;min-width:0}
.hcal-cell:nth-child(7n){border-right:none}
.hcal-cell.out{background:var(--panel-2)}
.hcal-cell.today{background:rgba(58,87,232,.05)}
.hcal-daynum{text-align:right;font-size:12px;font-weight:600;color:var(--ink-soft);padding:.05rem .25rem .2rem;font-variant-numeric:tabular-nums}
.hcal-cell.out .hcal-daynum{color:var(--faint)}
.hcal-cell.today .hcal-daynum{display:inline-flex;float:right;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:var(--brand);color:#fff}
.hcal-events{display:flex;flex-direction:column;gap:3px;clear:both}
.hcal-ev{display:flex;flex-direction:row;align-items:flex-start;gap:6px;width:100%;text-align:left;border:1px solid;border-radius:4px;padding:4px 6px;overflow:hidden}
.hcal-ev:hover{filter:brightness(.97)}
.hcal-evtime{font-weight:700;font-size:12px;line-height:16px;flex:0 0 auto}
.hcal-evbody{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.hcal-evsbu{font-size:12px;line-height:16px;font-weight:600;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hcal-evtitle{font-size:12px;line-height:16px;font-weight:500;min-width:0;overflow:hidden;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.hcal-ev.block .hcal-evtitle{white-space:normal}
.hcal-more{border:none;background:none;font-size:12px;font-weight:600;color:var(--muted);text-align:left;padding:2px 6px}
.hcal-more:hover{color:var(--brand)}
/* week */
.hcal-week{display:grid;grid-template-columns:repeat(7,1fr);border-top:1px solid var(--line)}
.hcal-weekcol{border-right:1px solid var(--line);min-height:360px}
.hcal-weekcol:last-child{border-right:none}
.hcal-weekcol.today{background:rgba(58,87,232,.04)}
.hcal-weekhead{display:flex;flex-direction:column;align-items:center;gap:2px;padding:.5rem;border-bottom:1px solid var(--line)}
.hcal-weekdow{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.hcal-weeknum{font-size:1rem;font-weight:700;color:var(--ink)}
.hcal-weeknum.today{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--brand);color:#fff}
.hcal-weekbody{display:flex;flex-direction:column;gap:4px;padding:.45rem}
.hcal-empty{color:var(--faint);font-size:.78rem;text-align:center;padding-top:.6rem}
/* day */
.hcal-day{border-top:1px solid var(--line);padding:.7rem 1rem 1rem}
.hcal-dayrow{display:flex;align-items:center;gap:.8rem;width:100%;text-align:left;border-bottom:1px solid var(--line-2);padding:.55rem .2rem;cursor:pointer}
.hcal-daytime{font-family:var(--mono);font-size:.72rem;font-weight:600;color:var(--muted);flex:0 0 62px}
.hcal-dayrow .hcal-ev{pointer-events:none}
.hcal-dayempty{padding:2.5rem 1rem;text-align:center;color:var(--muted);font-size:.85rem}
/* list / agenda */
.hcal-agenda{border-top:1px solid var(--line);padding:.4rem 0}
.hcal-agroup{display:flex;gap:1rem;padding:.7rem 1.1rem;border-bottom:1px solid var(--line-2)}
.hcal-adate{display:flex;flex-direction:column;align-items:center;flex:0 0 46px;padding-top:.2rem}
.hcal-adow{font-size:.6rem;font-weight:700;text-transform:uppercase;color:var(--muted)}
.hcal-aday{font-size:1.25rem;font-weight:800;color:var(--ink);line-height:1.1}
.hcal-amon{font-size:.6rem;color:var(--faint);text-transform:uppercase}
.hcal-aitems{flex:1;display:flex;flex-direction:column;gap:.35rem}
.hcal-arow{display:flex;align-items:center;gap:.6rem;width:100%;text-align:left;background:none;border:none;padding:.3rem .1rem;border-radius:8px}
.hcal-arow:hover{background:var(--panel-2)}
.hcal-atime{font-family:var(--mono);font-size:.68rem;font-weight:700;color:var(--ink-soft);flex:0 0 46px}
.hcal-abar{width:4px;height:26px;border-radius:2px;flex:0 0 4px}
.hcal-atitle{font-size:.82rem;font-weight:600;color:var(--ink);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hcal-apill{font-size:.62rem;font-weight:600;padding:.1rem .45rem;border-radius:20px}
.hcal-astatus{font-size:.62rem;font-weight:600;padding:.1rem .45rem;border-radius:20px}
@media(max-width:640px){.hcal-apill,.hcal-astatus{display:none}}
/* by-format lanes */
.hcal-fmt{border-top:1px solid var(--line);padding:.7rem 1.1rem 1.1rem;display:flex;flex-direction:column;gap:.9rem}
.hcal-lane{border:1px solid var(--line);border-radius:12px;overflow:hidden}
.hcal-lanehead{display:flex;align-items:center;gap:.5rem;padding:.55rem .9rem;background:var(--panel-2);border-bottom:1px solid var(--line)}
.hcal-lanedot{width:9px;height:9px;border-radius:3px;flex:0 0 9px}
.hcal-lanename{font-size:.84rem;font-weight:700;color:var(--ink)}
.hcal-lanecount{font-size:.66rem;font-weight:700;padding:.05rem .5rem;border-radius:20px;min-width:20px;text-align:center}
.hcal-laneitems{display:flex;flex-direction:column;padding:.2rem .55rem}
.hcal-laneempty{padding:.7rem .9rem;font-size:.76rem;color:var(--faint)}
.hcal-frow{display:flex;align-items:center;gap:.7rem;width:100%;text-align:left;background:none;border:none;padding:.45rem .45rem;border-radius:8px;border-bottom:1px solid var(--line-2)}
.hcal-laneitems .hcal-frow:last-child{border-bottom:none}
.hcal-frow:hover{background:var(--panel-2)}
.hcal-fwhen{display:flex;flex-direction:column;flex:0 0 88px}
.hcal-fday{font-size:.68rem;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
.hcal-ftime{font-size:.62rem;color:var(--muted)}
@media(max-width:640px){.hcal-fwhen{flex:0 0 70px}}
/* modal */
.hcal-modal-bg{position:fixed;inset:0;z-index:60;background:rgba(15,18,35,.42);display:flex;align-items:center;justify-content:center;padding:1rem}
.hcal-modal{background:var(--panel);border-radius:16px;box-shadow:0 24px 60px rgba(15,18,40,.28);width:100%;max-width:520px;max-height:86vh;overflow-y:auto}
.hcal-modal-head{display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.2rem;border-left:4px solid}
.hcal-modal-headl{display:flex;align-items:center;gap:.5rem}
.hcal-modal-status{font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;font-weight:700}
.hcal-modal-acct{font-size:.64rem;font-weight:600;padding:.12rem .5rem;border-radius:20px}
.hcal-sdot{width:8px;height:8px;border-radius:3px;flex:0 0 8px}
.hcal-modal-x{border:none;background:none;font-size:1.4rem;color:var(--muted);line-height:1}
.hcal-modal-x:hover{color:var(--ink)}
.hcal-modal-body{padding:1.2rem;display:flex;flex-direction:column;gap:1rem}
.hcal-modal-lbl{font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);margin-bottom:.25rem}
.hcal-modal-title{font-size:1.05rem;font-weight:700;color:var(--ink)}
.hcal-modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}
.hcal-modal-val{font-size:.82rem;color:var(--ink-soft)}
.hcal-modal-caption{font-size:.76rem;color:var(--ink-soft);background:var(--panel-2);border-radius:10px;padding:.7rem;white-space:pre-wrap;max-height:180px;overflow:auto}
.hcal-modal-fail{background:var(--rose-soft);border:1px solid #F6C9D3;border-radius:12px;padding:.8rem}
.hcal-modal-faillbl{font-size:.74rem;font-weight:700;color:#9F1239;margin-bottom:.25rem}
.hcal-modal-failtxt{font-size:.74rem;color:#BE123C}
.hcal-modal-retry{margin-top:.7rem;font-size:.74rem;font-weight:600;background:#E11D48;color:#fff;border:none;padding:.45rem .8rem;border-radius:8px}
.hcal-modal-retry:disabled{opacity:.6}
.hcal-ins{display:grid;grid-template-columns:repeat(auto-fit,minmax(74px,1fr));gap:.5rem;margin-top:.4rem}
.hcal-ins-cell{background:#F6F7FB;border:1px solid var(--line);border-radius:10px;padding:.5rem .6rem;text-align:center}
.hcal-ins-n{font-size:1rem;font-weight:700;color:var(--ink);line-height:1.1}
.hcal-ins-k{font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-top:.15rem}
.hcal-state{padding:.7rem .85rem;border:1px solid var(--line);border-radius:11px;background:#FBFCFE}
.hcal-state-h{font-size:.82rem;font-weight:700;color:var(--ink)}
.hcal-state-note{font-size:.74rem;color:var(--muted);margin-top:.25rem;line-height:1.45}
.hcal-state-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.6rem}
.hcal-act{font-size:.76rem;font-weight:600;padding:.4rem .75rem;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:var(--ink)}
.hcal-act:hover{border-color:var(--brand);color:var(--brand)}
.hcal-act.primary{background:var(--brand);border-color:var(--brand);color:#fff}
.hcal-act.primary:hover{background:#2f49c9;color:#fff}
.hcal-act:disabled{opacity:.6}
.hcal-modal-links{display:flex;flex-wrap:wrap;gap:.5rem;padding-top:.5rem}
.hcal-linkbtn{display:inline-flex;align-items:center;gap:.35rem;font-size:.76rem;font-weight:600;padding:.4rem .7rem;border-radius:9px;border:1px solid var(--line);text-decoration:none;color:var(--ink);background:var(--panel)}
.hcal-linkbtn:hover{border-color:var(--brand);color:var(--brand)}
.hcal-linkbtn.ig:hover{border-color:#C13584;color:#C13584}
.hcal-linkbtn.fb:hover{border-color:#1877F2;color:#1877F2}
.hcal-more-btn{display:block;margin-top:.35rem;background:none;border:none;padding:0;font-size:.74rem;font-weight:600;color:var(--brand)}
.hcal-modal-links a{color:var(--brand);text-decoration:none}
.hcal-modal-links a:hover{text-decoration:underline}
/* creative preview */
.hcal-media{position:relative}
.hcal-media.pane,.hcal-media.pane .hcal-media-stage{height:100%;width:100%}
.hcal-media-stage{position:relative;background:#0F1222;border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:center;max-height:340px;width:fit-content;max-width:100%;margin:0 auto}
.hcal-media-stage.reel{max-height:430px}
.hcal-media.pane .hcal-media-stage{border-radius:0;max-height:90vh}
.hcal-media-el{width:auto;max-width:100%;max-height:340px;object-fit:contain;display:block}
.hcal-media-stage.reel .hcal-media-el{max-height:430px}
.hcal-media.pane .hcal-media-el{max-height:90vh;height:auto}
.hcal-media-play{position:absolute;inset:0;margin:auto;width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,.94);color:var(--brand);display:flex;align-items:center;justify-content:center;font-size:1.15rem;text-decoration:none;box-shadow:0 6px 20px rgba(0,0,0,.34);padding-left:3px}
.hcal-media-play.static{cursor:default}
.hcal-media-nav{position:absolute;top:50%;transform:translateY(-50%);width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,.42);color:#fff;border:none;font-size:1.15rem;display:flex;align-items:center;justify-content:center;line-height:1}
.hcal-media-nav.prev{left:8px}.hcal-media-nav.next{right:8px}
.hcal-media-nav:hover{background:rgba(0,0,0,.64)}
.hcal-media-count{position:absolute;top:8px;right:8px;background:rgba(0,0,0,.5);color:#fff;font-size:.62rem;font-weight:600;padding:.12rem .48rem;border-radius:20px}
.hcal-media-dots{position:absolute;bottom:8px;left:0;right:0;display:flex;gap:5px;justify-content:center}
.hcal-media-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.5);border:none;padding:0;transition:.15s}
.hcal-media-dot.on{background:#fff;width:16px;border-radius:3px}
.hcal-media-empty{padding:1.4rem;text-align:center;color:var(--muted);font-size:.78rem;background:var(--panel-2);border-radius:12px}
/* wide (landscape) modal for reels + carousels: media pane | details pane */
.hcal-modal-wide{max-width:760px;display:flex;align-items:stretch;overflow:hidden}
.hcal-modal-mediapane{flex-grow:0;flex-shrink:0;background:#0F1222;display:flex;align-items:center;justify-content:center;max-height:90vh;overflow:hidden}
.hcal-modal-detail{flex:1;min-width:0;display:flex;flex-direction:column;max-height:90vh;overflow-y:auto}
@media(max-width:640px){.hcal-modal-wide{flex-direction:column;max-width:420px}.hcal-modal-mediapane{flex-basis:auto!important;max-height:46vh;width:100%}}
`;
