"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApi } from "@/lib/use-api";
import {
  IconBrandInstagram, IconBrandYoutube, IconExternalLink, IconHeart,
  IconMessageCircle, IconLayoutGrid, IconVideo, IconPhoto, IconX, IconChevronLeft, IconChevronRight,
  IconFlame, IconStar,
  IconArrowRight, IconWorld, IconDeviceMobile, IconBrandReddit,
} from "@tabler/icons-react";
import { LoadingBlock } from "@/components/LoadingBlock";

// ── data shapes (mirror lib/instagram.ts CompetitorSnapshot / CompetitorMedia) ──
type Media = {
  id: string; caption?: string; media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string; thumbnail_url?: string; permalink?: string; timestamp: string;
  like_count?: number; comments_count?: number;
  children?: { data: { id: string; media_type: string; media_url?: string; thumbnail_url?: string }[] };
};
type Competitor = {
  username: string; name?: string; biography?: string; profile_picture_url?: string;
  followers_count: number; follows_count?: number; media_count: number;
  recent: Media[]; engagementRatePct: number; postsLast30d: number;
  avgLikesRecent: number; avgCommentsRecent: number;
};
type BenchmarkData = {
  competitors: (Competitor | { error: string; username: string })[];
  sourceAccount?: { id: string; handle: string };
};
// A post flattened with its author so cards/modal know who posted it.
type Post = Media & { author: string; authorPic?: string };
type YtVid = { id: string; title: string; channel: string; thumbnail: string; publishedAt: string; views: number; url: string };

const isComp = (c: BenchmarkData["competitors"][number]): c is Competitor => !("error" in c);
const nfmt = (n: number | undefined) => (n ?? 0) >= 1000 ? `${((n ?? 0) / 1000).toFixed(1)}k` : String(n ?? 0);
const ago = (iso: string) => {
  // Google search results give dates as text ("2 years ago", "Mar 3, 2025"); show
  // those as they are rather than "NaNd ago".
  if (Number.isNaN(new Date(iso).getTime())) return iso;
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const nameOf = (c: Competitor) => c.name || c.username;
const eng = (m: Media) => (m.like_count || 0) + (m.comments_count || 0);

// One competitor at a time (Praveen, 29 Sep — layout approved as "v2"): the tracked
// competitors as tabs under the header, no "All", and below them everything about the
// selected one — website, Instagram, Google reviews, YouTube videos, Shorts, Reddit.
// The list is mh_competitors only; nothing is hard-coded, so a removed competitor
// stays removed. See docs/COMPETITOR_RADAR_SPEC.md.
type Tracked = { handle: string; name?: string | null; website?: string | null; youtube?: string | null; platform: string; watchPages?: { label: string; url: string }[] | null };
type ChannelVid = { id: string; title: string; thumbnail: string; publishedAt: string; views: number; url: string; short: boolean };
type Intel = {
  capped?: boolean;
  mentions: { title: string; url: string; snippet: string; source: string; lane: string; publishedAt: string }[];
  reviews: { title: string; rating: number; ratingCount: number; items: { id: string; rating: number; publishedAt: string | null; relative: string | null; text: string; author: string; link: string | null }[] } | null;
};
// Captions that announce something with a date — worth flagging as an event.
const EVENT_RE = /\b(webinar|live session|go(ing)? live|seminar|workshop|masterclass|register|registration|events?|expo|fair|summit|conference|meet-?up|open house)\b/i;
const within = (iso: string | null | undefined, days: number) => !!iso && Date.now() - new Date(iso).getTime() < days * 86_400_000;
const label = (t: Tracked) => t.name || t.handle;

export function CompetitorBriefing() {
  const { data: trackedResp, isLoading: listLoading, mutate: reloadList } =
    useApi<{ available: boolean; items: Tracked[]; ourHandle?: string }>(`/api/benchmark/tracked?accountId=goocampus`);
  // Competitors only: our own account is tracked too (for Compare), but this page is about them.
  const list = (trackedResp?.items || []).filter((t) => t.platform === "instagram" && t.handle !== trackedResp?.ourHandle);
  const [sel, setSel] = useState<string>("");
  // Remember the last competitor looked at; fall back to the first.
  // A notification links here with ?c=<handle>; that wins over the last one picked.
  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get("c");
    if (fromLink) { setSel(fromLink.toLowerCase()); return; }
    try { const v = localStorage.getItem("brief-competitor"); if (v) setSel(v); } catch { /* private mode */ }
  }, []);
  const current = list.find((t) => t.handle === sel) || list[0];
  const pick = (h: string) => { setSel(h); try { localStorage.setItem("brief-competitor", h); } catch { /* private mode */ } };

  if (listLoading && !trackedResp) return <div className="preview-scope"><LoadingBlock label="Loading competitors…" /></div>;
  if (!current) {
    return (
      <div className="preview-scope bg-white border border-gray-100 rounded-2xl p-8 text-center">
        <div className="text-[16px] font-semibold text-[#232D42]">Add your first competitor</div>
        <div className="text-[13px] text-[#8A92A6] mt-1">Their website, Instagram, YouTube, Reddit and Google reviews will show up here.</div>
        <Link href="/dashboard/preview/benchmark" className="inline-flex items-center gap-1.5 mt-4 h-9 px-4 rounded-lg bg-brand text-white text-[13px] font-medium">Add a competitor <IconArrowRight size={15} /></Link>
      </div>
    );
  }

  return (
    <div className="preview-scope space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {list.map((t) => (
          <button key={t.handle} onClick={() => pick(t.handle)}
            className={`h-9 px-4 rounded-lg text-[13.5px] font-medium border transition ${
              t.handle === current.handle ? "bg-brand text-white border-brand" : "bg-white text-[#4A5468] border-gray-100 hover:border-brand hover:text-brand"}`}>
            {label(t)}
          </button>
        ))}
        <Link href="/dashboard/preview/benchmark?manage=1" className="ml-auto text-[12.5px] text-brand hover:underline">Manage competitors</Link>
      </div>
      <CompetitorDetailBrief key={current.handle} t={current} onSaved={reloadList} />
    </div>
  );
}

function CompetitorDetailBrief({ t, onSaved }: { t: Tracked; onSaved: () => void }) {
  const { data: ig, isLoading: igLoading } = useApi<BenchmarkData>(`/api/benchmark?accountId=goocampus&handles=${encodeURIComponent(t.handle)}`);
  const comp = (ig?.competitors || []).find(isComp);
  const igError = (ig?.competitors || []).find((c) => !isComp(c)) as { error: string } | undefined;
  const posts: Post[] = useMemo(() => (comp?.recent || []).map((m) => ({ ...m, author: nameOf(comp!), authorPic: comp!.profile_picture_url }))
    .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp)), [comp]);

  const { data: yt, isLoading: ytLoading } = useApi<{ found?: boolean; videos?: ChannelVid[] }>(
    t.youtube ? `/api/benchmark/youtube-channel?channelId=${encodeURIComponent(t.youtube)}` : null);
  const vids = yt?.videos || [];
  const longs = vids.filter((v) => !v.short).slice(0, 4);
  const shorts = vids.filter((v) => v.short).slice(0, 8);

  // Reddit threads + Google reviews: one cached (24h) search per competitor.
  const { data: intel, isLoading: intelLoading } = useApi<Intel>(`/api/benchmark/profile-intel?name=${encodeURIComponent(label(t))}&forums=1`);
  const reddit = (intel?.mentions || []).filter((m) => m.lane === "reddit");

  const [open, setOpen] = useState<Post | null>(null);
  const [openYt, setOpenYt] = useState<YtVid | null>(null);
  const eventPosts = posts.filter((p) => EVENT_RE.test(p.caption || ""));

  return (
    <div className="space-y-4">
      {/* Who, and what's new this week */}
      <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4 flex items-center gap-4 flex-wrap">
        <Avatar url={comp?.profile_picture_url} name={label(t)} size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold text-[#232D42] leading-tight">{label(t)}</div>
          <div className="text-[12px] text-[#8A92A6] flex items-center gap-3 flex-wrap mt-0.5">
            {t.website && <a href={t.website} target="_blank" rel="noreferrer" className="hover:text-brand">{t.website.replace(/^https?:\/\//, "")}</a>}
            <a href={`https://www.instagram.com/${t.handle}/`} target="_blank" rel="noreferrer" className="hover:text-brand">@{t.handle}</a>
            {comp && <span>{nfmt(comp.followers_count)} followers</span>}
          </div>
        </div>
        <div className="flex gap-5 text-[12.5px] text-[#8A92A6]">
          <span><b className="text-[#232D42] font-semibold">{posts.filter((p) => within(p.timestamp, 7)).length}</b> Instagram posts this week</span>
          <span><b className="text-[#232D42] font-semibold">{vids.filter((v) => within(v.publishedAt, 7)).length}</b> YouTube uploads this week</span>
          <span><b className="text-[#232D42] font-semibold">{eventPosts.filter((p) => within(p.timestamp, 14)).length}</b> event posts</span>
        </div>
      </div>

      {/* Website — full width: the most important for "what are they announcing" */}
      <Section title="Website" icon={<IconWorld size={18} />} right={t.website ? "each section of their site, watched separately — change sections in Manage competitors" : "add their website to start watching it"}>
        <WebsiteSlot t={t} onSaved={onSaved} />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Instagram" icon={<IconBrandInstagram size={18} />} accent="#E1306C" right={comp ? `${comp.postsLast30d} posts in 30 days · ${comp.engagementRatePct.toFixed(2)}% engagement` : undefined}>
          {igLoading ? <LoadingBlock className="!py-6" size={28} />
            : igError ? <Empty>Instagram couldn&rsquo;t read @{t.handle}: {igError.error}</Empty>
            : !posts.length ? <Empty>No posts found.</Empty>
            : (
              <div className="grid grid-cols-4 gap-2">
                {posts.slice(0, 8).map((p) => {
                  const src = p.thumbnail_url || p.media_url;
                  const isEvent = EVENT_RE.test(p.caption || "");
                  return (
                    <button key={p.id} onClick={() => setOpen(p)} title={p.caption?.slice(0, 120)} className="relative aspect-[4/5] rounded-lg overflow-hidden bg-gray-100 border border-gray-100 hover:border-brand">
                      {src && <img src={src} alt="" referrerPolicy="no-referrer" className="w-full h-full object-contain" loading="lazy" decoding="async" />}
                      {isEvent && <span className="absolute top-1 left-1 text-[10px] font-medium rounded px-1.5 py-0.5 bg-amber-50 text-amber-800">Event</span>}
                      <span className="absolute bottom-1 left-1 right-1 flex justify-between text-[10px] text-white bg-black/50 rounded px-1">
                        <span className="inline-flex items-center gap-0.5"><IconHeart size={10} />{nfmt(p.like_count)}</span><span>{ago(p.timestamp)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
        </Section>

        <Section title="Google reviews" icon={<IconStar size={18} />} accent="#B7791F">
          {intelLoading ? <LoadingBlock className="!py-6" size={28} />
            : intel?.capped ? <Empty>This month&rsquo;s Google search allowance is used up — reviews come back next month.</Empty>
            : !intel?.reviews ? <Empty>No Google Maps listing found for {label(t)}.</Empty>
            : (
              <div>
                <div className="flex items-baseline gap-2"><span className="text-[26px] font-semibold text-[#232D42]">{intel.reviews.rating?.toFixed(1)}</span><span className="text-[12.5px] text-[#8A92A6]">· {nfmt(intel.reviews.ratingCount)} reviews</span></div>
                <div className="divide-y divide-gray-100 mt-2">
                  {intel.reviews.items.slice(0, 3).map((r) => (
                    <div key={r.id} className="py-2">
                      <div className="text-[12px] text-[#8A92A6]">{"★".repeat(Math.round(r.rating))} · {r.author} · {r.publishedAt ? ago(r.publishedAt) : r.relative}</div>
                      <div className="text-[13px] text-[#4A5468] line-clamp-2">{r.text || "(no text)"}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
        </Section>

        <Section title="YouTube · videos" icon={<IconBrandYoutube size={18} />} accent="#E0245E">
          {!t.youtube ? <Empty>No YouTube channel saved — add it in Manage competitors.</Empty>
            : ytLoading ? <LoadingBlock className="!py-6" size={28} />
            : !longs.length ? <Empty>No recent videos.</Empty>
            : (
              <div className="grid grid-cols-2 gap-3">
                {longs.map((v) => (
                  <button key={v.id} onClick={() => setOpenYt({ ...v, channel: label(t) })} className="text-left group">
                    <div className="aspect-video rounded-lg overflow-hidden bg-gray-100 border border-gray-100 group-hover:border-brand">{v.thumbnail && <img src={v.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />}</div>
                    <div className="text-[12.5px] text-[#232D42] line-clamp-2 mt-1">{v.title}</div>
                    <div className="text-[11px] text-[#8A92A6]">{nfmt(v.views)} views · {ago(v.publishedAt)}</div>
                  </button>
                ))}
              </div>
            )}
        </Section>

        <Section title="YouTube · Shorts" icon={<IconDeviceMobile size={18} />} accent="#E0245E">
          {!t.youtube ? <Empty>No YouTube channel saved.</Empty>
            : ytLoading ? <LoadingBlock className="!py-6" size={28} />
            : !shorts.length ? <Empty>No recent Shorts.</Empty>
            : (
              <div className="grid grid-cols-4 gap-2">
                {shorts.map((v) => (
                  <a key={v.id} href={v.url} target="_blank" rel="noreferrer" title={v.title} className="group">
                    <div className="aspect-[9/16] rounded-lg overflow-hidden bg-gray-100 border border-gray-100 group-hover:border-brand">{v.thumbnail && <img src={v.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />}</div>
                    <div className="text-[11px] text-[#8A92A6] mt-1">{nfmt(v.views)} views</div>
                  </a>
                ))}
              </div>
            )}
        </Section>
      </div>

      <Section title="Reddit · people talking about them" icon={<IconBrandReddit size={18} />} accent="#C2410C">
        {intelLoading ? <LoadingBlock className="!py-6" size={28} />
          : intel?.capped ? <Empty>This month&rsquo;s search allowance is used up.</Empty>
          : !reddit.length ? <Empty>No Reddit threads mention {label(t)} right now.</Empty>
          : (
            <div className="divide-y divide-gray-100">
              {reddit.slice(0, 6).map((m) => (
                <a key={m.url} href={m.url} target="_blank" rel="noreferrer" className="flex items-start gap-3 py-2.5 hover:text-brand">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] text-[#232D42] truncate">{m.title}</span>
                    <span className="block text-[12px] text-[#8A92A6] line-clamp-1">{m.snippet}</span>
                  </span>
                  {m.publishedAt && <span className="text-[11.5px] text-[#8A92A6] shrink-0">{ago(m.publishedAt)}</span>}
                  <IconExternalLink size={14} className="text-[#8A92A6] shrink-0 mt-0.5" />
                </a>
              ))}
            </div>
          )}
      </Section>

      {open && <PostModal p={open} onClose={() => setOpen(null)} />}
      {openYt && <YtModal v={openYt} onClose={() => setOpenYt(null)} />}
    </div>
  );
}

// The website card: what the watcher (lib/competitor-watch.ts) found on their site —
// new blog posts and pages from the sitemap, new webinars / events from their event
// pages — newest first. With no website saved, it asks for one.
type SiteEvent = { id: string; kind: string; title: string | null; url: string; published_at: string | null; detected_at: string; section: string | null };
function WebsiteSlot({ t, onSaved }: { t: Tracked; onSaved: () => void }) {
  const [val, setVal] = useState(t.website || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data, isLoading } = useApi<{ events: SiteEvent[]; watchingSince: string | null }>(
    t.website ? `/api/benchmark/events?accountId=goocampus&handle=${encodeURIComponent(t.handle)}&kinds=blog,event,page` : null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/benchmark/tracked", { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ accountId: "goocampus", handle: t.handle, platform: "instagram", website: val }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  if (!t.website) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="their-website.com" className="h-9 px-3 rounded-lg border border-gray-200 text-[13.5px] w-[280px] outline-none focus:border-brand" />
        <button onClick={save} disabled={busy || !val.trim()} className="h-9 px-4 rounded-lg bg-brand text-white text-[13px] font-medium disabled:opacity-50">{busy ? "Saving…" : "Save website"}</button>
        {err && <span className="text-[12.5px] text-[#C03221]">{err}</span>}
      </div>
    );
  }
  if (isLoading && !data) return <LoadingBlock className="!py-6" size={28} />;
  const all = data?.events || [];
  // One tracker per section, in the order chosen in Manage competitors; anything
  // found outside those sections goes in a last "Elsewhere on the site" tracker.
  const labels = (t.watchPages?.length ? t.watchPages.map((w) => w.label) : [...new Set(all.map((e) => e.section).filter(Boolean) as string[])]);
  const groups = labels.map((label) => ({ label, url: t.watchPages?.find((w) => w.label === label)?.url || null, items: all.filter((e) => e.section === label) }));
  const other = all.filter((e) => !e.section || !labels.includes(e.section));
  if (other.length) groups.push({ label: "Elsewhere on the site", url: null, items: other });
  if (!groups.length) {
    return <Empty>{data?.watchingSince
      ? `Watching ${t.website.replace(/^https?:\/\//, "")} since ${new Date(data.watchingSince).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} — nothing new yet. New blogs, webinars and events will appear here and in your notifications.`
      : `Watching ${t.website.replace(/^https?:\/\//, "")} starts on the next check (every 5 minutes once live).`}</Empty>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {groups.map((g) => <SectionTracker key={g.label} label={g.label} url={g.url} items={g.items} />)}
    </div>
  );
}

// One section of a competitor's site. Events: upcoming ones by date, soonest first;
// past ones drop off. Posts: newest first. "New" = found after the section's first
// read (everything on that first read was already there) and within the last week.
function SectionTracker({ label, url, items }: { label: string; url: string | null; items: SiteEvent[] }) {
  const now = Date.now();
  const when = (e: SiteEvent) => (e.kind === "event" && e.published_at ? Date.parse(e.published_at) : NaN);
  const firstRead = Math.min(...items.map((e) => Date.parse(e.detected_at)));
  const isNew = (e: SiteEvent) => { const d = Date.parse(e.detected_at); return d > firstRead + 15 * 60_000 && d > now - 7 * 86_400_000; };
  const shown = items
    .filter((e) => !(when(e) < now - 3 * 3_600_000))
    .sort((x, y) => {
      const ex = x.kind === "event" ? 0 : 1, ey = y.kind === "event" ? 0 : 1;
      if (ex !== ey) return ex - ey;
      const wx = when(x), wy = when(y);
      if (!Number.isNaN(wx) || !Number.isNaN(wy)) return (Number.isNaN(wx) ? Infinity : wx) - (Number.isNaN(wy) ? Infinity : wy);
      return (Date.parse(y.published_at || "") || Date.parse(y.detected_at)) - (Date.parse(x.published_at || "") || Date.parse(x.detected_at));
    });
  const events = items.some((e) => e.kind === "event");
  const fresh = shown.filter(isNew).length;
  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[14px] font-medium text-[#232D42] truncate">{label}</span>
        {fresh > 0 && <span className="text-[11px] font-medium rounded-full px-2 py-0.5 bg-brand text-white shrink-0">{fresh} new</span>}
        <span className="flex-1" />
        {url && <a href={url} target="_blank" rel="noreferrer" className="text-[11.5px] text-[#8A92A6] hover:text-brand inline-flex items-center gap-1 shrink-0">open page <IconExternalLink size={12} /></a>}
      </div>
      {!shown.length ? (
        <div className="text-[12.5px] text-[#8A92A6] py-2">{events || /webinar|event|seminar|expo/i.test(label) ? "Nothing upcoming right now — watching for new dates." : "Watching — new posts will appear here."}</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {shown.slice(0, 5).map((e) => {
            const w = when(e);
            const d = e.published_at ? Date.parse(e.published_at) : NaN;
            return (
              <a key={e.id} href={e.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 py-2 hover:text-brand">
                {isNew(e) && <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" title="New" />}
                <span className="text-[13px] text-[#232D42] truncate flex-1 min-w-0">{e.title || e.url}</span>
                <span className="text-[11.5px] text-[#8A92A6] shrink-0">
                  {!Number.isNaN(w)
                    ? new Date(w).toLocaleString("en-IN", new Date(w).getUTCHours() === 18 && new Date(w).getUTCMinutes() === 30
                        ? { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }
                        : { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
                    : e.kind === "event" ? "no date given"
                    : !Number.isNaN(d) ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ago(e.detected_at)}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── building blocks ──
// Prominent, colour-coded section header so each block is instantly distinguishable.
function Section({ title, badge, right, icon, children, flat, accent = "#3A57E8" }: { title: string; badge?: string; right?: string; icon?: React.ReactNode; children: React.ReactNode; flat?: boolean; accent?: string }) {
  const inner = (
    <>
      <div className="flex items-center gap-3 mb-4">
        {icon && <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl shrink-0" style={{ background: `${accent}1A`, color: accent }}>{icon}</span>}
        <div className="min-w-0 flex-1">
          <div className="text-[16.5px] font-semibold text-[#232D42] leading-tight">{title}</div>
          {right && <div className="text-[11.5px] text-gray-400 mt-0.5 truncate">{right}</div>}
        </div>
        {badge && <span className="text-[11px] font-medium rounded-full px-2.5 py-1 shrink-0 self-start" style={{ background: `${accent}14`, color: accent }}>{badge}</span>}
      </div>
      {children}
    </>
  );
  return flat
    ? <div className="bg-white border border-gray-100 rounded-2xl p-5">{inner}</div>
    : <div className="bg-white border border-gray-100 rounded-2xl p-5">{inner}</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between text-[11.5px] py-0.5"><span className="text-gray-400">{label}</span><span className="font-semibold text-[#232D42] tabular-nums">{value}</span></div>;
}

function Avatar({ url, name, size = 28 }: { url?: string; name: string; size?: number }) {
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return url
    ? <img src={url} alt={name} referrerPolicy="no-referrer" style={{ width: size, height: size }} className="rounded-full object-cover shrink-0" loading="lazy" decoding="async" />
    : <span style={{ width: size, height: size }} className="rounded-full bg-brand-light text-brand text-[10px] font-semibold flex items-center justify-center shrink-0">{initials}</span>;
}

const TypeIcon = ({ t }: { t: Media["media_type"] }) =>
  t === "CAROUSEL_ALBUM" ? <IconLayoutGrid size={13} /> : t === "VIDEO" ? <IconVideo size={13} /> : <IconPhoto size={13} />;

function PostCard({ p, onOpen }: { p: Post; onOpen: () => void }) {
  const src = p.thumbnail_url || p.media_url;
  return (
    <button onClick={onOpen} className="text-left bg-white border border-gray-100 rounded-xl overflow-hidden hover:border-brand hover:shadow-sm transition group">
      <div className="relative aspect-[4/5] bg-gray-100">
        {src
          ? <img src={src} alt="" referrerPolicy="no-referrer" className="w-full h-full object-contain" loading="lazy" decoding="async" />
          : <div className="w-full h-full flex items-center justify-center text-gray-300"><IconPhoto size={24} /></div>}
        <span className="absolute top-2 right-2 inline-flex items-center gap-1 bg-black/55 text-white text-[10px] rounded-md px-1.5 py-0.5"><TypeIcon t={p.media_type} /> {p.media_type === "CAROUSEL_ALBUM" ? "Carousel" : p.media_type === "VIDEO" ? "Video" : "Image"}</span>
      </div>
      <div className="p-2.5">
        <div className="flex items-center gap-1.5 mb-1"><Avatar url={p.authorPic} name={p.author} /><span className="text-[11.5px] font-medium text-[#232D42] truncate">{p.author}</span><span className="text-[10.5px] text-gray-400 ml-auto shrink-0">{ago(p.timestamp)}</span></div>
        <div className="text-[11.5px] text-gray-600 line-clamp-2 leading-snug min-h-[2lh]">{p.caption?.replace(/\n/g, " ") || "(no caption)"}</div>
        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-0.5"><IconHeart size={12} /> {nfmt(p.like_count)}</span>
          <span className="inline-flex items-center gap-0.5"><IconMessageCircle size={12} /> {nfmt(p.comments_count)}</span>
          <span className="ml-auto text-brand text-[11px] opacity-0 group-hover:opacity-100 transition">Open →</span>
        </div>
      </div>
    </button>
  );
}

// In-dashboard viewer — carousel children slide here; nothing bounces out.
function PostModal({ p, onClose }: { p: Post; onClose: () => void }) {
  const slides = p.media_type === "CAROUSEL_ALBUM" && p.children?.data?.length
    ? p.children.data.map((c) => ({ type: c.media_type, url: c.media_url, thumb: c.thumbnail_url }))
    : [{ type: p.media_type, url: p.media_url, thumb: p.thumbnail_url }];
  const [i, setI] = useState(0);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") setI((v) => Math.min(slides.length - 1, v + 1)); if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1)); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose, slides.length]);
  const s = slides[i];

  return (
    <div className="fixed inset-0 !mt-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl overflow-hidden flex flex-col md:flex-row w-[94vw] md:w-auto max-w-[94vw] max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        {/* Media — shown at its TRUE aspect (a vertical reel stays vertical and fully
            visible, a square post stays square). The panel shrink-wraps the media, so
            there are no letterbox bars and nothing gets cropped. */}
        <div className="relative bg-gray-900 shrink-0 flex items-center justify-center overflow-hidden">
          {s.type === "VIDEO" && s.url
            ? <video src={s.url} poster={s.thumb} controls autoPlay playsInline className="block max-h-[58vh] md:max-h-[86vh] w-auto max-w-full md:max-w-[480px] object-contain" />
            : (s.url || s.thumb)
              ? <img src={s.url || s.thumb} alt="" referrerPolicy="no-referrer" className="block max-h-[58vh] md:max-h-[86vh] w-auto max-w-full md:max-w-[480px] object-contain" loading="lazy" decoding="async" />
              : <div className="flex items-center justify-center min-h-[300px] w-[300px] text-gray-300 text-sm p-10">Media preview unavailable</div>}
          {slides.length > 1 && (
            <>
              <button onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0} className="absolute z-20 left-2 top-1/2 -translate-y-1/2 bg-white/80 rounded-full p-1.5 disabled:opacity-30"><IconChevronLeft size={18} /></button>
              <button onClick={() => setI((v) => Math.min(slides.length - 1, v + 1))} disabled={i === slides.length - 1} className="absolute z-20 right-2 top-1/2 -translate-y-1/2 bg-white/80 rounded-full p-1.5 disabled:opacity-30"><IconChevronRight size={18} /></button>
              <span className="absolute z-20 bottom-2 left-1/2 -translate-x-1/2 bg-black/55 text-white text-[11px] rounded-full px-2 py-0.5">{i + 1} / {slides.length}</span>
            </>
          )}
        </div>
        {/* Meta */}
        <div className="p-5 flex flex-col min-h-0 w-full md:w-[360px]">
          <div className="flex items-center gap-2 mb-3">
            <Avatar url={p.authorPic} name={p.author} />
            <div className="min-w-0"><div className="text-[13px] font-semibold text-[#232D42] truncate">{p.author}</div><div className="text-[11px] text-gray-400">{ago(p.timestamp)} · {p.media_type === "CAROUSEL_ALBUM" ? "Carousel" : p.media_type === "VIDEO" ? "Video" : "Image"}</div></div>
            <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700"><IconX size={18} /></button>
          </div>
          <div className="text-[13px] text-gray-700 whitespace-pre-wrap leading-relaxed overflow-y-auto flex-1 min-h-0">{p.caption || "(no caption)"}</div>
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 text-[12.5px] text-gray-600">
            <span className="inline-flex items-center gap-1"><IconHeart size={14} /> {nfmt(p.like_count)}</span>
            <span className="inline-flex items-center gap-1"><IconMessageCircle size={14} /> {nfmt(p.comments_count)}</span>
            {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" className="ml-auto text-brand hover:underline inline-flex items-center gap-1">Open on Instagram <IconExternalLink size={12} /></a>}
          </div>
        </div>
      </div>
    </div>
  );
}

function YtCard({ v, onOpen }: { v: YtVid; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="text-left bg-white border border-gray-100 rounded-xl overflow-hidden hover:border-brand hover:shadow-sm transition group">
      <div className="relative aspect-video bg-gray-100">
        {v.thumbnail
          ? <img src={v.thumbnail} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          : <div className="w-full h-full flex items-center justify-center text-gray-300"><IconBrandYoutube size={24} /></div>}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-10 h-10 rounded-full bg-black/60 group-hover:bg-red-600 transition flex items-center justify-center text-white"><IconBrandYoutube size={20} /></span>
        </span>
      </div>
      <div className="p-2.5">
        <div className="text-[12px] font-medium text-[#232D42] line-clamp-2 leading-snug min-h-[2lh]">{v.title}</div>
        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-500">
          <span className="truncate">{v.channel}</span>
          <span className="ml-auto shrink-0">{nfmt(v.views)} views</span>
        </div>
      </div>
    </button>
  );
}

function YtModal({ v, onClose }: { v: YtVid; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 !mt-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="aspect-video bg-black">
          <iframe className="w-full h-full" src={`https://www.youtube.com/embed/${v.id}?autoplay=1`} title={v.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
        </div>
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-[#232D42]">{v.title}</div>
              <div className="text-[11.5px] text-gray-400 mt-0.5">{v.channel} · {nfmt(v.views)} views · {ago(v.publishedAt)}</div>
            </div>
            <a href={v.url} target="_blank" rel="noreferrer" className="text-brand text-[12px] inline-flex items-center gap-1 shrink-0">YouTube <IconExternalLink size={12} /></a>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 shrink-0"><IconX size={18} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Rising-search results — the actual Google results shown INSIDE the dashboard (via
// Serper; Google's own page can't be embedded). People-also-ask + related searches are
// clickable to keep browsing without leaving. Only a result / "Open in Google" leaves.
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-8 text-center text-[13px] text-gray-400">{children}</div>;
}
function RowSkeleton() { return <LoadingBlock className="!py-8" size={26} />; }
function CardSkeleton() { return <LoadingBlock className="!py-10" size={26} />; }
