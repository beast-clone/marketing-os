"use client";
import { ThemeToggle } from "@/components/Theme";
import { InstallApp } from "@/components/InstallApp";
import { canAccessSection, canSeeTab, canManageAccess, TABS, type Permissions, type Section, type Sections } from "@/lib/permissions";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { NOTIF_COUNT } from "./NotificationHost";
import { playChime } from "./notifChime";
import {
  IconSunHigh, IconLayoutGrid, IconChartBar, IconCalendarEvent, IconRadar2, IconSparkles, IconBell, IconPlugConnected, IconBuildingStore, IconKey, IconWriting,
  IconClockHour4, IconCurrencyRupee, IconBrandInstagram, IconBrandLinkedin, IconBrandYoutube, IconBrandFacebook,
  IconUsers, IconUserCheck, IconSpeakerphone, IconTargetArrow, IconChartHistogram, IconUserDollar, IconReportMoney, IconBulb, IconReportAnalytics, IconSettings, IconTools, IconUsersGroup, IconMessageCircle, IconActivityHeartbeat,
  IconCalendarStats, IconChartPie, IconTimeline, IconArrowsExchange, IconIdBadge2,
  IconChevronRight, IconPhoto, IconMovie, IconCircleDashed, IconTable, IconLayoutKanban,
  IconChecklist, IconWorldWww, IconClick, IconChartArcs, IconSearch, IconBrandGoogle, IconTrendingUp,
  IconDeviceMobile, IconArchive, IconTrash, IconMessageChatbot, IconRobot, IconInbox,
  IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconSend, IconBrandWhatsapp, IconRouteAltLeft, IconEye, IconDatabase,
  IconLock, IconCalendarDue, IconFolders, IconReceipt, IconFileDescription, IconRepeat, IconBook,
} from "@tabler/icons-react";
import type { PreviewTab } from "./PreviewShell";

/** Remembered across tabs and reloads once the button has been used. */
const NAV_COLLAPSED_KEY = "gc-nav-collapsed";
import { GlobalSearch, type SearchPage } from "./GlobalSearch";
import { Shortcuts } from "./Shortcuts";
import { shouldPoll } from "@/lib/quiet-hours";

// The ONE shared dashboard sidebar — used by PreviewShell (cloned tabs) AND the
// hand-built PreviewOverview so every V2 page has the identical grouped, expandable
// Links are next/link, not <a>: a plain anchor makes every sidebar click a full
// browser page load — the app unmounts, every bundle re-downloads and the whole
// screen rebuilds. Link keeps the app mounted and swaps only the page.
//
// nav (no V1 sidebar anywhere). Self-contained: it injects its own scoped CSS and
// theme vars, so it renders correctly whether or not a `.preview-root` wraps it.
// Grouping matches V1 components/Sidebar.tsx exactly, hrefs point to preview.
type Leaf = { label: string; href: string; icon: any };
type Folder = { key: string; label: string; icon: any; href?: string; children: Leaf[] };
type Group = { label?: string; sec: Section; items: (Leaf | Folder)[] };
const isFolder = (x: Leaf | Folder): x is Folder => "children" in x;

const HUB = "/dashboard/preview";
const OVERVIEW: Leaf = { label: "Overview", href: HUB, icon: IconLayoutGrid };
// Approvals carries the badge of publish-date changes waiting (22 Oct: its own tab
// in My Workspace, under Team Command).
const APPROVALS_HREF = `${HUB}/approvals`;
// Team & access for people outside the System group: shown locked, so they can
// still open it and send a request (22 Oct).
const TEAM_LOCKED: Leaf = { label: "Team & access", href: `${HUB}/team`, icon: IconLock };
// Everyone's notifications (docs/NOTIFICATIONS_SPEC.md). Deliberately outside the
// section-gated groups: every member gets notifications, whatever pages they can see.
const NOTIFICATIONS: Leaf = { label: "Notifications", href: `${HUB}/notifications`, icon: IconBell };

const GROUPS: Group[] = [
  { label: "Content", sec: "content", items: [
    { key: "my-workspace", label: "My Workspace", icon: IconSunHigh, href: `${HUB}/briefing`, children: [
      { label: "Briefing",         href: `${HUB}/briefing`,                   icon: IconChartBar },
      { label: "My Day",           href: `${HUB}/my-day`,                     icon: IconSunHigh },
      { label: "Team Command",     href: `${HUB}/team-command`,               icon: IconUsersGroup },
      { label: "Approvals",        href: APPROVALS_HREF,                      icon: IconCalendarDue },
      { label: "Workload",         href: `${HUB}/marketing-hub?tab=team`,     icon: IconUsers },
      { label: "Attendance",       href: `${HUB}/attendance`,                 icon: IconUserCheck },
      { label: "Master sheet",     href: `${HUB}/marketing-hub?tab=master`,   icon: IconTable },
      { label: "Pipeline",         href: `${HUB}/marketing-hub?tab=pipeline`, icon: IconLayoutKanban },
      { label: "Rules",            href: `${HUB}/marketing-hub/automations`, icon: IconRouteAltLeft },
    ] },
    // Airtable Marketing Hub tables brought in (Praveen, 23 Oct) — lib/materials.ts.
    // Named "Marketing Hub" like the Airtable base; Meetings taken out the same day.
    { key: "marketing-materials", label: "Marketing Hub", icon: IconFolders, href: `${HUB}/materials/expenses`, children: [
      { label: "Expenses",           href: `${HUB}/materials/expenses`,      icon: IconReceipt },
      { label: "Essential Photos",   href: `${HUB}/materials/photos`,        icon: IconPhoto },
      { label: "Marketing Material", href: `${HUB}/materials/materials`,     icon: IconFileDescription },
      { label: "Paid Promotions",    href: `${HUB}/materials/promotions`,    icon: IconSpeakerphone },
      { label: "Subscriptions",      href: `${HUB}/materials/subscriptions`, icon: IconRepeat },
      { label: "e-Book Orders",      href: `${HUB}/materials/ebooks`,        icon: IconBook },
    ] },
    // Its own tab rather than buried under My Workspace — "Move content calendar
    // from my workspace and create a separate tab" (Manya, 28 Sept). Same page, the
    // calendar view of the Marketing Hub; only where you reach it from changed.
    { label: "Plan board",          href: `${HUB}/plan-board`,                icon: IconWriting },
    { label: "Content calendar",    href: `${HUB}/marketing-hub?tab=calendar`, icon: IconCalendarEvent },
    // No separate "Mentorship calendar" any more (26 Oct): the Content calendar has a
    // rail of saved views — "Mentorship" is one of them, and anyone can add their own.
    { label: "Content Radar",       href: `${HUB}/radar`,        icon: IconRadar2 },
    { label: "Content Studio",      href: `${HUB}/content-studio`, icon: IconSparkles },
    // Web pages we follow for news — KEA / MCC counselling notices first (1 Oct).
    { label: "Watchers",            href: `${HUB}/watchers`,     icon: IconEye },
    // Read-only backup of Airtable's Content Calendar from April 2026 (3 Nov).
    { label: "Airtable Backup",     href: `${HUB}/archive`,      icon: IconDatabase },
  ] },
  { label: "Social Media", sec: "content", items: [
    { label: "Publishing Calendar", href: `${HUB}/calendar`,        icon: IconCalendarEvent },
    { label: "Content Review",      href: `${HUB}/content-review`,  icon: IconChecklist },
    { key: "scheduler", label: "Scheduler", icon: IconClockHour4, href: `${HUB}/scheduler`, children: [
      { label: "Published",      href: `${HUB}/scheduler?tab=calendar`, icon: IconSend },
      { label: "Top performers", href: `${HUB}/scheduler?tab=top`,      icon: IconTrendingUp },
    ] },
    { label: "Community Broadcast", href: `${HUB}/broadcast`, icon: IconBrandWhatsapp },
  ] },
  { label: "Analytics", sec: "analytics", items: [
    { key: "instagram", label: "Instagram", icon: IconBrandInstagram, children: [
      { label: "Posts",   href: `${HUB}/posts`,   icon: IconPhoto },
      { label: "Reels",   href: `${HUB}/reels`,   icon: IconMovie },
      { label: "Stories", href: `${HUB}/stories`, icon: IconCircleDashed },
    ] },
    { key: "linkedin", label: "LinkedIn", icon: IconBrandLinkedin, href: `${HUB}/linkedin`, children: [
      { label: "Posts", href: `${HUB}/linkedin/posts`, icon: IconPhoto },
    ] },
    { key: "youtube", label: "YouTube", icon: IconBrandYoutube, href: `${HUB}/youtube`, children: [
      { label: "Long-form", href: `${HUB}/youtube/videos#longform`, icon: IconMovie },
      { label: "Shorts",    href: `${HUB}/youtube/videos#shorts`,   icon: IconCircleDashed },
    ] },
    { key: "facebook", label: "Facebook", icon: IconBrandFacebook, href: `${HUB}/facebook`, children: [
      { label: "Posts", href: `${HUB}/facebook/posts`, icon: IconPhoto },
    ] },
    { key: "website", label: "Website", icon: IconWorldWww, href: `${HUB}/website`, children: [
      { label: "Google Analytics", href: `${HUB}/website`,          icon: IconChartArcs },
      { label: "Search Console",   href: `${HUB}/website/google`,   icon: IconBrandGoogle },
      { label: "Clarity",          href: `${HUB}/website/behavior`, icon: IconClick },
      { label: "Bing",             href: `${HUB}/website/search`,   icon: IconSearch },
    ] },
    { label: "SEO", href: `${HUB}/seo`, icon: IconTrendingUp },
    { label: "GEO SEO", href: `${HUB}/geo-seo`, icon: IconRobot },
  ] },
  { label: "Audience", sec: "analytics", items: [{ label: "All platforms", href: `${HUB}/audience`, icon: IconUsers }] },
  { label: "Ads", sec: "ads", items: [
    { label: "Ads",            href: `${HUB}/ads`,         icon: IconSpeakerphone },
    { label: "Competitor Ads", href: `${HUB}/competitors`, icon: IconTargetArrow },
    { label: "Competitors",    href: `${HUB}/benchmark`,   icon: IconChartHistogram },
  ] },
  { label: "Sales", sec: "sales", items: [
    { label: "Marketing Campaigns", href: `${HUB}/campaigns`, icon: IconSpeakerphone },
    { label: "Inbox",         href: `${HUB}/inbox`,          icon: IconInbox },
    { label: "WhatsApp Inbox", href: `${HUB}/wa-inbox`,      icon: IconBrandWhatsapp },
    { label: "Marketing Leads", href: `${HUB}/leads`,          icon: IconUserDollar },
    // Sales Hub is a folder, not a page with tabs inside it: the six views were
    // in-page tabs and read as a second, competing navigation next to the sidebar.
    { key: "sales-hub", label: "Sales Hub", icon: IconReportMoney, href: `${HUB}/sales-ops`, children: [
      { label: "Search leads",  href: `${HUB}/sales-ops/search`,      icon: IconSearch },
      { label: "Per day",       href: `${HUB}/sales-ops/per-day`,     icon: IconCalendarStats },
      { label: "By interest",   href: `${HUB}/sales-ops/interests`,   icon: IconChartPie },
      { label: "Counsellors",   href: `${HUB}/sales-ops/counsellors`, icon: IconUsers },
      { label: "Leads tracker", href: `${HUB}/sales-ops/tracker`,     icon: IconTimeline },
      { label: "Revenue",       href: `${HUB}/sales-ops/revenue`,     icon: IconCurrencyRupee },
      { label: "Unassigned leads", href: `${HUB}/sales-ops/unassigned`, icon: IconInbox },
      { label: "Transfer",      href: `${HUB}/sales-ops/transfer`,    icon: IconArrowsExchange },
      { label: "Roles",         href: `${HUB}/sales-ops/roles`,       icon: IconIdBadge2 },
    ] },
  ] },
  { label: "AI", sec: "ai", items: [
    { label: "Ask GooCampus",   href: `${HUB}/assistant`,   icon: IconMessageChatbot },
    { label: "AI Insights",     href: `${HUB}/ai-insights`, icon: IconBulb },
    { key: "reports", label: "Reports", icon: IconArchive, href: `${HUB}/ai-reports`, children: [
      { label: "Monthly Reports",      href: `${HUB}/ai-reports`,     icon: IconReportAnalytics },
      { label: "Social Media Reports", href: `${HUB}/reports/social`, icon: IconDeviceMobile },
      { label: "Deleted Reports",      href: `${HUB}/reports/trash`,  icon: IconTrash },
    ] },
  ] },
  { label: "System", sec: "system", items: [
    // Everyone sees this one — it exists so the team finds out what changed without
    // being told one by one.
    { label: "What's new",   href: `${HUB}/changelog`,    icon: IconSparkles },
    { label: "Brands",       href: `${HUB}/brands`,       icon: IconBuildingStore },
    { label: "Connectors",   href: `${HUB}/connectors`,   icon: IconPlugConnected },
    { label: "Recycle bin",  href: `${HUB}/recycle-bin`,  icon: IconTrash },
    { label: "Integrations", href: `${HUB}/integrations`, icon: IconSettings },
    { label: "Diagnostics",  href: `${HUB}/diagnostics`,  icon: IconActivityHeartbeat },
    { label: "API keys",     href: `${HUB}/api-keys`,     icon: IconKey },
    // The scheduled jobs the dashboard depends on all live in n8n, so there was no
    // way to see them from in here — the Airtable import sat switched off and the
    // only way to notice was to open n8n. Read-only register of what runs and when.
    { label: "Workflows",    href: `${HUB}/workflows`,    icon: IconRouteAltLeft },
    { label: "Tools",        href: `${HUB}/tools`,        icon: IconTools },
    { label: "Team",         href: `${HUB}/team`,         icon: IconUsersGroup },
    { label: "Comments",     href: `${HUB}/comments`,     icon: IconMessageCircle },
  ] },
];

// Which tabs each section holds, straight from the menu above — the Team page lists
// these under each "Pages they can open" switch, so a new tab shows up there by
// itself instead of drifting from a hand-written list.
export const SECTION_TABS: Record<Section, string[]> = (() => {
  const out = { overview: ["Overview"], content: [], analytics: [], ads: [], sales: [], ai: [], system: [] } as Record<Section, string[]>;
  for (const g of GROUPS) for (const it of g.items) out[g.sec].push(it.label);
  return out;
})();

// The sidebar is its own scroll container (100vh, overflow-y:auto) and there is no
// shared layout, so every page renders — and therefore REMOUNTS — it. Its scroll
// jumped back to 0 on each navigation: you clicked a Sales Hub sub-page near the
// bottom and landed looking at Overview, with Sales scrolled out of sight.
//
// Remember where it was and put it back before the browser paints, and if there's
// nothing remembered (first load, new tab) bring the active item into view instead.
// `active` is gone: the sidebar lives in the layout now and works out what's
// current from the pathname, which it already did for every leaf.
export function PreviewSidebar() {
  const asideRef = useRef<HTMLElement>(null);

  const pathname = usePathname();

  // Collapse to the icon rail, or open back out. null until the stored preference
  // has been read — writing a class before then makes the sidebar jump on load.
  //
  // Once you have used the button your choice follows you between tabs. Before
  // that, the Scheduler opens collapsed and everywhere else opens wide, which is
  // what Business Suite does: the rail is for the tab you compose in.
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  // Hover-peek: while locked to the rail, hovering floats the full sidebar open
  // over the page (without shoving content); leaving snaps it back to the rail.
  const [peek, setPeek] = useState(false);
  // The lock is the ONLY thing that persists, and it's read once — it no longer
  // re-opens on its own when you switch tabs (it used to auto-collapse on the
  // Scheduler and expand elsewhere, which read as "it opens by itself").
  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(NAV_COLLAPSED_KEY) : null;
    setCollapsed(stored === "1"); // default: locked open
  }, []);
  useEffect(() => {
    if (collapsed === null) return;
    document.body.classList.toggle("nav-collapsed", collapsed);
  }, [collapsed]);
  useEffect(() => () => document.body.classList.remove("nav-collapsed"), []);
  const toggleCollapsed = () => {
    setPeek(false); // clicking the lock is a decision — don't leave a hover-peek half-open
    setCollapsed((c) => {
      const next = !c;
      try { window.localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  };

  // The Team page has always offered per-person tab access, but nothing ever read
  // it: every signed-in person saw the whole sidebar. /api/me has returned
  // `sections` for exactly this purpose since it was written. Until it loads,
  // render nothing rather than flashing tabs the person cannot open.
  const [me, setMe] = useState<{ isAdmin?: boolean; sections?: Sections; permissions?: Permissions } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (alive) setMe(d?.user ?? { }); })
      .catch(() => { if (alive) setMe({}); });
    return () => { alive = false; };
  }, []);
  // Per-tab switches (Team & access, 22 Oct): a sidebar entry shows only if its tab
  // is on for this person. Matched by label — the TABS list mirrors the sidebar.
  const groups = useMemo(() => {
    if (!me) return [];
    const ok = (label: string) => { const t = TABS.find((x) => x.label === label); return !t || canSeeTab(me, t.key); };
    return GROUPS.filter((g) => canAccessSection(me, g.sec)).map((g) => ({
      ...g,
      items: g.items.flatMap((it): (Leaf | Folder)[] => {
        if (!isFolder(it)) return ok(it.label) ? [it] : [];
        if (it.key === "my-workspace" || it.key === "marketing-materials") {
          const children = it.children.filter((c) => ok(c.label));
          return children.length ? [{ ...it, href: children[0].href, children }] : [];
        }
        return ok(it.label) ? [it] : [];
      }),
    })).filter((g) => g.items.length);
  }, [me]);
  const canOverview = !me || canAccessSection(me, "overview");
  // Every page this person can open, for the search box — tabs AND the tabs inside
  // folders, so typing "content calendar" or "eBook" takes you there (28 Oct).
  const searchPages = useMemo(() => {
    const out: SearchPage[] = [];
    if (canOverview) out.push({ label: OVERVIEW.label, where: "", href: OVERVIEW.href });
    out.push({ label: NOTIFICATIONS.label, where: "", href: NOTIFICATIONS.href });
    for (const g of groups) for (const it of g.items) {
      if (isFolder(it)) {
        if (it.href) out.push({ label: it.label, where: g.label || "", href: it.href });
        for (const c of it.children) out.push({ label: c.label, where: [g.label, it.label].filter(Boolean).join(" › "), href: c.href });
      } else out.push({ label: it.label, where: g.label || "", href: it.href });
    }
    return out;
  }, [groups, canOverview]);

  // Live count of publish-date changes waiting for the admin to approve — drives the
  // notification badge on the Approvals tab. Admin-only; polls so a new request shows
  // up without a reload.
  const [apprCount, setApprCount] = useState(0);
  // Unread notifications — pushed by NotificationHost (mounted beside this sidebar in
  // the layout), so the badge costs no extra polling.
  const [notifUnread, setNotifUnread] = useState(0);
  // The bell rings and shakes when the count GOES UP. Not on the first reading —
  // arriving at a page with four unread already is not news — and not when it
  // falls, because reading something is not an event.
  const [ringing, setRinging] = useState(false);
  const lastUnread = useRef<number | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const n = (e as CustomEvent<{ unread: number }>).detail?.unread || 0;
      setNotifUnread(n);
      const was = lastUnread.current;
      lastUnread.current = n;
      if (was === null || n <= was) return;
      playChime();
      setRinging(true);
      setTimeout(() => setRinging(false), 900);
    };
    window.addEventListener(NOTIF_COUNT, on);
    return () => window.removeEventListener(NOTIF_COUNT, on);
  }, []);
  const seesApprovals = !!me && canSeeTab(me, "approvals");
  useEffect(() => {
    if (!seesApprovals) return;
    let alive = true;
    const tick = () => fetch("/api/marketing-hub/date-change", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d) => { if (alive) setApprCount((d.requests || []).length); })
      .catch(() => {});
    tick();
    // Only while the tab is on screen — this used to keep polling in a background
    // tab all night, costing function calls for a badge nobody was looking at.
    const id = setInterval(() => { if (shouldPoll()) tick(); }, 60000);
    return () => { alive = false; clearInterval(id); };
  }, [seesApprovals]);

  // The sidebar lives in the route layout, so it stays mounted across navigation
  // and its scroll position simply never changes — nothing to save or restore.
  //
  // The one case still worth handling is arriving at a page whose nav item is off
  // screen (a deep link, or a jump from a card elsewhere). Then, and only then,
  // bring it into view. Correcting merely-near-an-edge items was making the
  // sidebar shift by a few dozen pixels for no reason.
  useLayoutEffect(() => {
    const current = GROUPS.flatMap((g) => g.items).filter(isFolder).find(folderActive);
    if (current) setOpenKeys((s) => (s[current.key] ? s : { ...s, [current.key]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useLayoutEffect(() => {
    const el = asideRef.current;
    if (!el || el.scrollHeight <= el.clientHeight) return;
    const current = el.querySelector<HTMLElement>(".hnavitem.active");
    if (!current) return;
    const box = current.getBoundingClientRect();
    const frame = el.getBoundingClientRect();
    const offScreen = box.bottom <= frame.top || box.top >= frame.bottom;
    if (offScreen) el.scrollTop += (box.top - frame.top) - el.clientHeight / 2 + box.height / 2;
  }, [pathname]);
  const searchParams = useSearchParams();
  const [hash, setHash] = useState("");
  useEffect(() => {
    const read = () => setHash(window.location.hash.replace("#", ""));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [pathname]);

  const isActive = (href: string): boolean => {
    const [pq, frag] = href.split("#");
    const [path, query] = pq.split("?");
    if (pathname !== path) return false;
    if (query) {
      const tab = new URLSearchParams(query).get("tab");
      // channel tells the Mentorship calendar from the Content calendar (same tab).
      if (tab) {
        const cur = searchParams.get("tab");
        if ((new URLSearchParams(query).get("channel") || "") !== (searchParams.get("channel") || "")) return false;
        return cur === tab || (tab === "team" && !cur);
      }
    }
    if (frag) return hash === frag;
    return true;
  };
  const folderActive = (f: Folder) => (f.href ? isActive(f.href) : false) || f.children.some((c) => isActive(c.href));

  // A folder opens when you navigate into it and STAYS open. It used to fall back
  // to "is this folder active", so leaving Sales Hub collapsed its six children and
  // everything below them snapped up ~150px — then reappeared on the way back.
  // That reflow was the jump; scroll position was never the whole story.
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});

  const LeafRow = ({ leaf, indent, badge, shake }: { leaf: Leaf; indent?: boolean; badge?: number; shake?: boolean }) => {
    const Icon = leaf.icon;
    return (
      <Link href={leaf.href} prefetch title={leaf.label} className={`hnavitem ${indent ? "child" : ""} ${isActive(leaf.href) ? "active" : ""}`}>
        <Icon size={indent ? 15 : 16} stroke={1.8} className={shake ? "gc-bell-ring" : undefined} />
        <span>{leaf.label}</span>
        {badge ? <span className={`hnavbadge ${shake ? "gc-badge-pop" : ""}`}>{badge}</span> : null}
      </Link>
    );
  };
  const FolderRow = ({ f }: { f: Folder }) => {
    const open = openKeys[f.key] ?? folderActive(f);  // first visit: open if it's the one you're in
    const Icon = f.icon;
    const pActive = f.href ? isActive(f.href) : false;
    const semi = !pActive && folderActive(f);
    const toggle = () => setOpenKeys((s) => ({ ...s, [f.key]: !open }));
    return (
      <div>
        <div className="hnavfolder">
          {f.href ? (
            <Link href={f.href} prefetch title={f.label} onClick={() => setOpenKeys((s) => ({ ...s, [f.key]: true }))} className={`hnavitem folderlink ${(pActive || semi) ? "semi" : ""}`}>
              <Icon size={16} stroke={1.8} /> <span>{f.label}</span>
            </Link>
          ) : (
            <button onClick={toggle} className={`hnavitem folderlink ${semi ? "semi" : ""}`}>
              <Icon size={16} stroke={1.8} /> <span>{f.label}</span>
            </button>
          )}
          <button className="hchev" aria-label={`${open ? "Collapse" : "Expand"} ${f.label}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}>
            <IconChevronRight size={14} stroke={2} className={open ? "rot" : ""} />
          </button>
        </div>
        {open && <div className="hnavchildren">{f.children.map((c) => <LeafRow key={c.href} leaf={c} indent badge={c.href === APPROVALS_HREF ? apprCount : undefined} />)}</div>}
      </div>
    );
  };

  return (
    <>
    {/* Holds the rail's 56px in the page flow while the real sidebar floats above
        it (position:fixed) — so a hover-peek overlays the content instead of shoving it. */}
    <div className="hsidebar-spacer" aria-hidden="true" />
    <aside
      className={`hsidebar${collapsed && peek ? " peek" : ""}`}
      ref={asideRef}
      onMouseEnter={() => { if (collapsed) setPeek(true); }}
      onMouseLeave={() => setPeek(false)}
    >
      <style dangerouslySetInnerHTML={{ __html: SIDEBAR_CSS }} />
      <div className="hbrand">
        {/* Logo → Overview (the main page). */}
        <Link href={OVERVIEW.href} aria-label="Go to Overview" className="hlogo-link">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/goocampus-logo.png" alt="GooCampus" className="hlogo-img hlogo-light" />
          {/* White logo for the dark theme (globals.css swaps them). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/goocampus-logo-white.png" alt="GooCampus" className="hlogo-img hlogo-dark" />
        </Link>
        <button type="button" onClick={toggleCollapsed} className="hcollapse"
          aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          title={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}>
          {collapsed
            ? <IconLayoutSidebarLeftExpand size={17} stroke={1.8} />
            : <IconLayoutSidebarLeftCollapse size={17} stroke={1.8} />}
        </button>
      </div>
      <div className="hglobalsearch"><GlobalSearch pages={searchPages} /></div>
      {/* Keyboard shortcuts + the ? card. Here because the sidebar is the one thing
          on every page of the dashboard. */}
      <Shortcuts />
      {canOverview && <LeafRow leaf={OVERVIEW} />}
      {me && <LeafRow leaf={NOTIFICATIONS} badge={notifUnread} shake={ringing} />}
      {me && "sections" in me && !canAccessSection(me, "system") && <LeafRow leaf={TEAM_LOCKED} />}
      {groups.map((g) => (
        <div key={g.label}>
          {g.label && <div className="hnavgroup">{g.label}</div>}
          {g.items.map((it) => (isFolder(it) ? <FolderRow key={it.key} f={it} /> : <LeafRow key={it.href} leaf={it.href === TEAM_LOCKED.href && me && !canManageAccess(me) ? { ...it, icon: IconLock } : it} />))}
        </div>
      ))}
      <InstallApp />
      {/* Light / Dark / System (also on the Account page). */}
      <div className="htheme"><span className="hnavgroup" style={{ padding: 0 }}>Theme</span><ThemeToggle compact /></div>
    </aside>
    </>
  );
}

// Self-contained: declares its own theme vars on .hsidebar so it renders the same
// whether or not an ancestor set them (PreviewOverview uses inline styles, no .preview-root).
const SIDEBAR_CSS = `
.hsidebar{--sb-brand:#3A57E8;--sb-brand-soft:#E9ECFB;--sb-brand-ink:#2138B0;--sb-ink:#232D42;--sb-ink-soft:#4A5468;--sb-faint:#A6ACBE;--sb-line:#EEF0F4;--sb-panel:#FFFFFF;--sb-panel2:#F7F8FC;
  width:236px;flex-shrink:0;position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--sb-panel);border-right:1px solid var(--sb-line);padding:0 11px 16px;font-family:Inter,system-ui,sans-serif}
.hsidebar *{box-sizing:border-box}
.hsidebar .htheme{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:14px 4px 0;padding:12px 6px 0;border-top:1px solid var(--sb-line)}
body.nav-collapsed .hsidebar:not(.peek) .htheme{display:none}
.hsidebar-spacer{display:none;flex:0 0 0}
.hsidebar::-webkit-scrollbar{width:6px}.hsidebar::-webkit-scrollbar-thumb{background:#E3E6EE;border-radius:3px}
@media(max-width:980px){.hsidebar{display:none}}
.hsidebar .hbrand{display:flex;align-items:center;justify-content:center;gap:6px;padding:16px 4px 14px;position:sticky;top:0;background:var(--sb-panel);z-index:2}
.hsidebar .hbrand .hcollapse{position:absolute;right:4px;top:50%;transform:translateY(-50%)}
.hsidebar .hcollapse{flex:0 0 28px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:none;background:none;color:var(--sb-faint);cursor:pointer;border-radius:8px}
.hsidebar .hcollapse:hover{color:var(--sb-ink-soft);background:var(--sb-panel2)}
.hsidebar .hlogo-link{display:inline-block;cursor:pointer;line-height:0}
.hsidebar .hlogo-img{width:92px;max-width:100%;height:auto;object-fit:contain;display:block}
.hsidebar .hbrandname{font-weight:600;font-size:1.05rem;color:var(--sb-ink)}
.hsidebar .hnavgroup{font-family:ui-monospace,Menlo,monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.09em;color:var(--sb-faint);font-weight:700;padding:13px 10px 5px}
.hsidebar .hnavitem{display:flex;align-items:center;gap:10px;padding:8px 11px;border-radius:9px;font-size:.82rem;font-weight:500;color:var(--sb-ink-soft);cursor:pointer;margin-bottom:1px;text-decoration:none;width:100%;border:none;background:none;text-align:left;font-family:inherit}
.hsidebar .hnavitem:hover{background:var(--sb-panel2)}
.hsidebar .hnavitem.active{background:var(--sb-brand);color:#fff;box-shadow:0 6px 14px rgba(58,87,232,.24)}
.hsidebar .hnavitem.active svg{color:#fff}
.hsidebar .hnavitem.semi{color:var(--sb-brand-ink)}
.hsidebar .hnavitem.semi svg{color:var(--sb-brand)}
.hsidebar .hnavitem>span:first-of-type{flex:1}
.hsidebar .hnavbadge{background:#E24B4A;color:#fff;font-size:.6rem;font-weight:700;border-radius:99px;min-width:17px;height:17px;padding:0 5px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.hsidebar .hnavitem.active .hnavbadge{background:#fff;color:var(--sb-brand)}
.hsidebar .hnavitem.child{font-size:.79rem;padding:6px 10px}
.hsidebar .hnavitem.child.active{background:var(--sb-brand-soft);color:var(--sb-brand-ink);box-shadow:none;font-weight:600}
.hsidebar .hnavitem.child.active svg{color:var(--sb-brand)}
.hsidebar .hnavfolder{display:flex;align-items:center;gap:2px}
.hsidebar .hnavfolder .folderlink{flex:1}
.hsidebar .hchev{width:26px;height:30px;flex:0 0 26px;display:flex;align-items:center;justify-content:center;border:none;background:none;color:var(--sb-faint);cursor:pointer;border-radius:8px}
.hsidebar .hchev:hover{color:var(--sb-ink-soft);background:var(--sb-panel2)}
.hsidebar .hchev .rot{transform:rotate(90deg)}
.hsidebar .hchev svg{transition:transform .15s}
.hsidebar .hnavchildren{margin:2px 0 3px 20px;padding-left:8px;border-left:1px solid var(--sb-line);display:flex;flex-direction:column;gap:1px}
`;
