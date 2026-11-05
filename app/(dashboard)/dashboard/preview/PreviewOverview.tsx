"use client";
import { useEffect, useMemo, useState } from "react";
import { fmtDateShort } from "@/lib/date";
import { LoadingBlock } from "@/components/LoadingBlock";
import {
  IconLayoutGrid, IconChartLine, IconCalendarEvent,
  IconArrowUpRight, IconArrowDownRight, IconBrandInstagram, IconHeart,
  IconMessageCircle, IconEye, IconBrandFacebook, IconBrandLinkedin,
  IconBrandYoutube, IconChartBar, IconTrophy, IconBookmark, IconShare3,
  IconChevronDown, IconCheck, IconClockHour4, IconPower,
} from "@tabler/icons-react";
import { PreviewDatePicker } from "./PreviewDatePicker";
import HubNotificationBell from "@/components/HubNotificationBell";
import { HeaderProfile } from "@/components/HeaderProfile";
import { OverviewExtras } from "@/components/OverviewExtras";
import { PostingCadenceBar } from "@/components/PostingCadenceBar";
import { MonthlyOutputBar } from "@/components/MonthlyOutputBar";
import { PostDetailModal } from "@/components/PostDetailModal";
import { FacebookOverview, LinkedInOverview, YouTubeOverview } from "@/components/PlatformOverviews";
import { LI_PAGE, YT_CHANNEL } from "@/lib/brand-platforms";
import { ACCOUNTS, DEFAULT_ACCOUNT_ID, type IGAccount } from "@/lib/accounts";
import Link from "next/link";

// A future date returns nothing from any analytics source, so the custom range
// can't go past today. `max` greys out the picker; the clamp catches typed input.
function todayLocalISO(): string {
  return new Date().toLocaleDateString("en-CA");
}
function clampToTodayISO(d: string): string {
  const t = todayLocalISO();
  return d && d > t ? t : d;
}

// The wall clock in the Overview header. Asked for on 27 Sep 2026 — plainly the
// current time, NOT login/logout: nothing here is recorded or read back.
//
// Always IST, never the laptop's clock. A browser set to another timezone (or a
// machine with the wrong one, which is how this normally goes wrong) would otherwise
// quietly show a different time to different people, and the whole point is that the
// team is reading the same clock. timeZone pins it to Asia/Kolkata, and the label
// says IST so nobody has to trust that it did.
//
// Ticks every second, because a clock that doesn't tick reads as a stale timestamp.
// It is a leaf component, so the second only re-renders these few spans.
const IST = "Asia/Kolkata";

// Same day control as My Day's header: when you signed in today (mh_attendance,
// via /api/my-day/logins) and an End day button. End day opens My Day's wrap-up
// (?endday=1) so rolled-over tasks still get their reasons before the logout.
function DayControl() {
  const [started, setStarted] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/my-day/logins", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ]).then(([me, l]) => {
      if (!alive) return;
      const min = me?.user?.id ? l?.logins?.[me.user.id] : undefined;
      if (typeof min !== "number") { setStarted(null); return; }
      // The real sign-in time, before 9 AM too (Praveen, 29 Oct: signed in 8:58, saw 9:00).
      const t = 9 * 60 + min, h = Math.floor(t / 60), m = t % 60;
      setStarted(`${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`);
    }).catch(() => alive && setStarted(null));
    return () => { alive = false; };
  }, []);
  if (started === undefined) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span title={started ? "When you signed in today" : "No sign-in recorded today"}
        style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 11px", borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 12.5, fontWeight: 500, color: C.heading, whiteSpace: "nowrap" }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, background: started ? C.success : C.muted }} />
        {started ? `Started ${started}` : "Not signed in yet"}
      </span>
      <Link href="/dashboard/preview/my-day?endday=1"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 12.5, fontWeight: 500, color: C.danger, textDecoration: "none", whiteSpace: "nowrap" }}>
        <IconPower size={15} stroke={1.9} /> End day
      </Link>
    </div>
  );
}

function HeaderClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Empty on the server: the server's clock is UTC and React would flag the
  // mismatch, so the first paint comes from the browser.
  if (!now) return <span style={{ width: 210, height: 36 }} aria-hidden />;

  const t = now.toLocaleTimeString("en-IN", {
    timeZone: IST, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  });
  // en-IN gives "09:17:50 pm" — split the am/pm off so it can sit smaller.
  const [hms, ampm] = t.split(" ");
  const day = now.toLocaleDateString("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short" });
  const full = now.toLocaleDateString("en-IN", { timeZone: IST, weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // 36px tall to sit level with the notification bell beside it, and one line so it
  // stays a strip in the header rather than a panel. Date and time are the same
  // weight and colour — both are meant to be read.
  return (
    <div
      title={`${full} · ${t} India Standard Time`}
      style={{
        display: "flex", alignItems: "center", gap: 7, height: 36, padding: "0 11px",
        background: "#E9ECFB", borderRadius: 8, whiteSpace: "nowrap",
      }}
    >
      <IconClockHour4 size={16} stroke={1.9} style={{ color: C.primary, flexShrink: 0 }} />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: C.primaryDark }}>{day}</span>
      <span style={{ width: 1, height: 14, background: "#C7CFF2" }} />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: C.primaryDark, fontVariantNumeric: "tabular-nums", letterSpacing: "0.3px" }}>
        {hms}
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, color: C.primary, textTransform: "uppercase" }}>{ampm}</span>
      <span style={{ fontSize: 10, fontWeight: 600, color: C.primary, opacity: 0.7 }}>IST</span>
    </div>
  );
}

// The brand's own logo in the switcher, with its initials as the fallback.
//
// Deliberately NOT a platform icon. The Overview shows Instagram, Facebook,
// LinkedIn and YouTube side by side, so badging the brand with any one of their
// marks says something untrue about what you are looking at.
//
// A plain <img>: these are base64 data URIs, so next/image has nothing to optimise
// and would only add a loader in front of bytes that are already here.
function BrandLogo({ src, label, size }: { src?: string; label: string; size: number }) {
  const radius = Math.round(size * 0.27);
  const base = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: "hidden",
  } as const;
  if (src) {
    return (
      <span style={{ ...base, border: `1px solid ${C.line}`, background: C.card }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" width={size} height={size} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </span>
    );
  }
  // Two initials — "GooCampus World" → GW, "12thPlus.com" → 12.
  const initials = label.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).slice(0, 2)
    .map((w) => (/^\d/.test(w) ? w.slice(0, 2) : w[0])).join("").toUpperCase().slice(0, 2);
  return (
    <span style={{ ...base, background: "#E9ECFB", color: C.primaryDark, fontSize: Math.round(size * 0.42), fontWeight: 600 }}>
      {initials}
    </span>
  );
}

// Brands you can switch between on the analytics tabs. Samvaya is a separate
// business but is included on request (comments, 22 Sep) — it carries its own
// `platforms` whitelist in lib/accounts.ts, so only the channels it really has
// are offered.
const SWITCHABLE_ACCOUNTS = ACCOUNTS;

// Exact dashboard theme tokens (pulled from the live theme — primary #3A57E8, Inter).
const C = {
  primary: "#3A57E8", primaryDark: "#2138B0", navy: "#001F4D",
  heading: "#232D42", muted: "#8A92A6", bg: "#F5F6FA", card: "#FFFFFF",
  teal: "#079AA2", success: "#1AA053", danger: "#C03221", line: "#EEF0F4",
  chip: "#F0F2F8", pink: "#E83A8A",
};
const SHADOW = "none"; // dashboard cards are FLAT — no drop shadow (matches the real theme)

type Insights = {
  totals: { followers: number; reach: number; engagement: number; profileVisits: number; newFollowers: number };
  deltas: { followers: number; reach: number; engagement: number | null; profileVisits: number | null };
  series: { date: string; reach: number; engagement: number }[];
  // "measured" once engagement + profile views come from Meta rather than the
  // old reach-derived guess; drives whether the cards still say EST.
  meta?: { engagementBasis?: "measured" | "estimated" };
  // Present only on stored (snapshot) reads — how many days of the requested
  // span we actually hold, so a combined total can state its own coverage.
  stored?: boolean;
  daysStored?: number;
  daysWithProfileVisits?: number;
  daysWithEngagement?: number;
  coverageFrom?: string | null;
  coverageTo?: string | null;
};
type Post = { id: string; caption: string; mediaUrl: string; mediaUrls?: string[]; permalink: string; type: string; timestamp: string; likes: number; comments: number; reach: number; totalInteractions: number; saves?: number; shares?: number };
type Audience = { gender?: { label: string; value: number }[]; countries?: { label: string; value: number }[]; stored?: boolean; month?: string };
type StoryRow = { id?: string; reach?: number; views?: number; replies?: number; timestamp?: string };
type Tip = { metric: "followers" | "reach" | "engagement" | "profileVisits"; detail: string; action: string };

// Null-safe: a missing metric must not crash the whole Overview (the landing page).
const fmt = (n?: number | null) => (n ?? 0).toLocaleString("en-IN");
const kfmt = (n?: number | null) => { const v = n ?? 0; return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "K" : String(v); };
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

// Plain-English definitions shown until the AI tips load. No advice here: a canned
// "growth is holding" line read as analysis whatever the numbers said.
const PLAIN: Record<string, { detail: string; action: string }> = {
  followers:     { detail: "Total accounts following you.",               action: "" },
  reach:         { detail: "Unique people who saw your content.",         action: "" },
  engagement:    { detail: "Likes, comments, saves and shares combined.", action: "" },
  profileVisits: { detail: "People who tapped your handle to see the bio.", action: "" },
  engRate:       { detail: "Of every 100 people who saw your posts, this many reacted.", action: "" },
};

function typeChip(t: string) {
  const s = (t || "").toLowerCase();
  if (s.includes("reel")) return { bg: "#FCE7F0", fg: C.pink, label: "Reel" };
  if (s.includes("carousel")) return { bg: "#E9ECFB", fg: C.primary, label: "Carousel" };
  return { bg: "#E1F4F5", fg: C.teal, label: "Post" };
}

// ISO country codes → readable names (so IN/PK/GB read as India/Pakistan/UK).
const COUNTRY_NAMES: Record<string, string> = {
  IN: "India", PK: "Pakistan", GB: "United Kingdom", US: "United States", AE: "UAE",
  NG: "Nigeria", CA: "Canada", AU: "Australia", BD: "Bangladesh", NP: "Nepal",
  LK: "Sri Lanka", SA: "Saudi Arabia", QA: "Qatar", OM: "Oman", KW: "Kuwait",
  BH: "Bahrain", MY: "Malaysia", SG: "Singapore", DE: "Germany", IE: "Ireland",
  NZ: "New Zealand", ZA: "South Africa", PH: "Philippines", EG: "Egypt",
};
const countryName = (code: string) => COUNTRY_NAMES[(code || "").toUpperCase()] || code;
const GENDER_NAMES: Record<string, string> = { M: "Male", F: "Female", U: "Undisclosed" };
const genderName = (code: string) => GENDER_NAMES[(code || "").toUpperCase()] || code;
// Subtle blue-family gradients for the "Who you reached" bars (light → soft).
const AUD_BARS = [
  "linear-gradient(90deg, #3A57E8, #6C86F2)",
  "linear-gradient(90deg, #5E78ED, #8FA5F7)",
  "linear-gradient(90deg, #8AA0F7, #B4C2FB)",
  "linear-gradient(90deg, #AEBDF9, #D6DEFD)",
];
// Brand-family gender palette (brand blue · violet · light grey — no off-brand pink).
const GENDER_COLORS = ["#3A57E8", "#6E48F8", "#D3DAE6"];
// Post-mix / format palette — all theme tokens (brand · violet · teal · sky), cohesive
// & distinguishable, and matched to OverviewExtras so a format reads the same colour.
const FMT_META: Record<string, { label: string; color: string }> = {
  CAROUSEL_ALBUM: { label: "Carousels", color: "#3A57E8" },
  REEL:           { label: "Reels",     color: "#6E48F8" },
  IMAGE:          { label: "Static",    color: "#079AA2" },
  VIDEO:          { label: "Videos",    color: "#0EA5E9" },
};
const fmtMeta = (t: string) => FMT_META[t] || { label: t || "Other", color: "#8A92A6" };

// Month-by-month helpers. Long ranges (60d / 1y / long custom) become a set of
// calendar-month reports; the current month is shown as "so far" (month-to-date),
// anchored to today. Each month is ≤31 days, so its numbers come back real.
type MonthOpt = { key: string; label: string; full: string; from: string; to: string; isCurrent: boolean };
const pad2 = (n: number) => String(n).padStart(2, "0");
const ymdLocal = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
// Human-friendly date: "2026-07-01" → "1 July 2026" (no ISO dashes for readers).
const fmtNice = (iso: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
function buildMonths(sy: number, sm: number, ey: number, em: number, now: Date): MonthOpt[] {
  const ny = now.getFullYear(), nm = now.getMonth(), nd = now.getDate();
  const out: MonthOpt[] = [];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    const future = y > ny || (y === ny && m > nm);
    if (!future) {
      const isCurrent = y === ny && m === nm;
      const lastDay = new Date(y, m + 1, 0).getDate();
      const from = `${y}-${pad2(m + 1)}-01`;
      const to = isCurrent ? `${ny}-${pad2(nm + 1)}-${pad2(nd)}` : `${y}-${pad2(m + 1)}-${pad2(lastDay)}`;
      const short = new Date(y, m, 1).toLocaleString("en-US", { month: "short" });
      const long = new Date(y, m, 1).toLocaleString("en-US", { month: "long" });
      out.push({ key: `${y}-${pad2(m + 1)}`, label: `${short} '${String(y).slice(2)}`, full: `${long} ${y}`, from, to, isCurrent });
    }
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}

const PLATFORMS = [
  { key: "instagram", label: "Instagram", icon: IconBrandInstagram },
  { key: "facebook", label: "Facebook", icon: IconBrandFacebook },
  { key: "linkedin", label: "LinkedIn", icon: IconBrandLinkedin },
  { key: "youtube", label: "YouTube", icon: IconBrandYoutube },
] as const;
type PlatformKey = (typeof PLATFORMS)[number]["key"];
type RangeKey = "7d" | "30d" | "60d" | "90d" | "1y" | "custom";

export function PreviewOverview({ person = "" }: { person?: string }) {
  const [accountId, setAccountIdRaw] = useState<string>(DEFAULT_ACCOUNT_ID);
  // The brand is remembered the same way every other tab remembers it
  // (PreviewDashboardShell, "gc-dash:accountId"), so a pick here carries over and back.
  const setAccountId = (id: string) => {
    setAccountIdRaw(id);
    try { localStorage.setItem("gc-dash:accountId", id); } catch { /* private mode */ }
  };
  const [brandOpen, setBrandOpen] = useState(false);
  // Each brand's own profile picture for the switcher. The picker covers all four
  // platforms, so an Instagram glyph on it was simply the wrong badge — GooCampus
  // World is not "an Instagram account", it is a brand with four channels. The
  // pictures come from Instagram because that is the one place all four brands have
  // a maintained logo; /api/account-avatars already inlines them as data URIs and
  // caches them for a day, so this costs nothing per page load.
  const [brandLogos, setBrandLogos] = useState<Record<string, string>>({});
  // Brands added on the Brands page (Instagram + Facebook connected) follow the built-in ones.
  const [addedBrands, setAddedBrands] = useState<IGAccount[]>([]);
  const switchable = useMemo(() => [...SWITCHABLE_ACCOUNTS, ...addedBrands], [addedBrands]);
  useEffect(() => {
    let alive = true;
    fetch("/api/account-avatars")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        if (j?.avatars) setBrandLogos(j.avatars as Record<string, string>);
        if (Array.isArray(j?.brands)) setAddedBrands(j.brands as IGAccount[]);
        // Restore the remembered brand once we know every brand that exists.
        try {
          const saved = localStorage.getItem("gc-dash:accountId");
          if (saved && [...SWITCHABLE_ACCOUNTS, ...((j?.brands as IGAccount[]) || [])].some((a) => a.id === saved)) setAccountIdRaw(saved);
        } catch { /* private mode */ }
      })
      .catch(() => { /* initials instead — the picker still works */ });
    return () => { alive = false; };
  }, []);
  const currentAccount = switchable.find((a) => a.id === accountId) ?? switchable[0];
  // Only offer the platforms this brand actually has. No `platforms` list = all
  // four, which is how every GooCampus brand behaves.
  const availablePlatforms = useMemo(
    () => (currentAccount?.platforms ? PLATFORMS.filter((p) => currentAccount.platforms!.includes(p.key)) : PLATFORMS.slice()),
    [currentAccount],
  );
  const [rangeKey, setRangeKeyRaw] = useState<RangeKey>("30d");
  // Overview has its own picker; it shares the range the other pages remember
  // (PreviewDashboardShell, "gc-dash:range"), so 90 days here is 90 days on Posts.
  const KEY_DAYS: Partial<Record<RangeKey, number>> = { "7d": 7, "30d": 30, "60d": 60, "90d": 90, "1y": 365 };
  const setRangeKey = (k: RangeKey) => {
    setRangeKeyRaw(k);
    const days = KEY_DAYS[k];
    if (days) try { localStorage.setItem("gc-dash:range", JSON.stringify({ days })); } catch { /* private mode */ }
  };
  useEffect(() => {
    try {
      const days = JSON.parse(localStorage.getItem("gc-dash:range") || "null")?.days;
      const k = (Object.keys(KEY_DAYS) as RangeKey[]).find((x) => KEY_DAYS[x] === days);
      if (k) setRangeKeyRaw(k);
    } catch { /* private mode */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [selMonthKey, setSelMonthKey] = useState<string | null>(null);
  const [platform, setPlatform] = useState<PlatformKey>("instagram");
  // Switching to a brand that doesn't have the current platform (e.g. YouTube →
  // Samvaya) must not leave a dead tab selected showing another brand's shape.
  useEffect(() => {
    if (!availablePlatforms.some((p) => p.key === platform)) setPlatform(availablePlatforms[0]?.key ?? "instagram");
  }, [availablePlatforms, platform]);
  const now = useMemo(() => new Date(), []);
  const todayStr = ymdLocal(now);
  // Instagram's account insights (follower_count) refuse the current day, so the
  // insights window must end at yesterday. Posts can still include today.
  const yesterdayStr = ymdLocal(new Date(now.getTime() - 86_400_000));

  // Month-by-month mode is ONLY for Instagram: Meta caps its account insights at
  // ~30 days, so a long range must be walked one calendar month at a time (each
  // ≤31 days → real & native). Facebook / LinkedIn / YouTube keep full history,
  // so their long ranges query the whole span at once — no switcher, no toggle.
  const customSpanDays = custom.from && custom.to ? Math.round((new Date(custom.to).getTime() - new Date(custom.from).getTime()) / 86_400_000) : 0;
  const spanIsLong = rangeKey === "60d" || rangeKey === "90d" || rangeKey === "1y" || (rangeKey === "custom" && customSpanDays > 31);
  // 60 and 90 days are deliberately SINGLE combined periods — one set of totals for
  // the two or three months, never split month-by-month (team request, 22 Sep).
  // Month-by-month survives only where a combined total would be meaningless:
  // 1 year, and custom ranges longer than a month.
  const isMonthly = platform === "instagram" && spanIsLong && rangeKey !== "60d" && rangeKey !== "90d";
  const months = useMemo(() => {
    if (!isMonthly) return [] as MonthOpt[];
    const ny = now.getFullYear(), nm = now.getMonth();

    if (rangeKey === "1y") { const s = new Date(ny, nm - 11, 1); return buildMonths(s.getFullYear(), s.getMonth(), ny, nm, now); }
    const [fy, fm] = custom.from.split("-").map(Number);
    const [ty, tm] = custom.to.split("-").map(Number);
    return buildMonths(fy, fm - 1, ty, tm - 1, now);
  }, [isMonthly, rangeKey, custom.from, custom.to, now]);
  const selectedMonth = months.length ? (months.find((m) => m.key === selMonthKey) || [...months].reverse().find((m) => !m.isCurrent) || months[months.length - 1]) : null;
  const selFrom = selectedMonth?.from, selTo = selectedMonth?.to;

  const range = useMemo(() => {
    if (isMonthly && selFrom && selTo) return { from: selFrom, to: selTo };
    if (rangeKey === "custom" && custom.from && custom.to) return { from: custom.from, to: custom.to };
    // Rolling window. For FB/LI/YT (non-monthly) 60d and 1y resolve to the whole
    // span at once; Instagram never reaches here for those (it's monthly).
    const days = rangeKey === "7d" ? 7 : rangeKey === "60d" ? 60 : rangeKey === "90d" ? 90 : rangeKey === "1y" ? 365 : 30;
    return { from: ymdLocal(new Date(now.getTime() - days * 86_400_000)), to: todayStr };
  }, [isMonthly, selFrom, selTo, rangeKey, custom, now, todayStr]);
  const rangeLabel = isMonthly && selectedMonth
    ? `${selectedMonth.full}${selectedMonth.isCurrent ? " (so far)" : ""}`
    : rangeKey === "custom" ? (custom.from && custom.to ? `${custom.from} → ${custom.to}` : "custom range")
    : rangeKey === "1y" ? "last 12 months"
    : rangeKey === "60d" ? "last 60 days"
    : rangeKey === "90d" ? "last 90 days"
    : `last ${rangeKey.replace("d", "")} days`;

  // How many whole calendar months the Monthly output section should show. The
  // preset ranges are rolling windows, so "30 days" would otherwise straddle two
  // part-months. A custom range passes undefined and keeps its exact dates.
  const monthlyMonths = rangeKey === "custom" ? undefined
    : rangeKey === "7d" || rangeKey === "30d" ? 1
    : rangeKey === "60d" ? 2
    : rangeKey === "90d" ? 3
    : 12;
  // Clicking a card in "Top performing posts" or "Latest posts" opens the same
  // detail modal the Posts tab uses, rather than leaving the dashboard.
  const [openPost, setOpenPost] = useState<Post | null>(null);
  const [chartMetric, setChartMetric] = useState<"reach" | "engagement">("reach");
  const [ins, setIns] = useState<Insights | null>(null);
  const [insErr, setInsErr] = useState<string | null>(null);  // shown instead of a stuck "Loading…"
  const [insStored, setInsStored] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [aud, setAud] = useState<Audience | null>(null);
  const [tips, setTips] = useState<Tip[]>([]);
  const [stories, setStories] = useState<StoryRow[] | null>(null);
  const [dmCount, setDmCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { from, to } = range;
    const insTo = to > yesterdayStr ? yesterdayStr : to; // account insights can't include today
    // If the window starts before Meta's ~30-day live cutoff, Meta refuses it —
    // read the KPIs from our stored Supabase snapshots instead of showing stale data.
    const liveCutoff = ymdLocal(new Date(now.getTime() - 30 * 86_400_000));
    const useStored = from < liveCutoff;
    let alive = true;
    setLoading(true);
    // Fire each fetch INDEPENDENTLY — the fast KPIs/reach/banner update the moment
    // insights returns, instead of waiting behind the slow posts fetch.
    const insUrl = useStored
      ? `/api/insights-stored?accountId=${accountId}&from=${from}&to=${to}`
      : `/api/insights?accountId=${accountId}&from=${from}&to=${insTo}`;
    setInsErr(null);
    fetch(insUrl).then(async (r) => { if (r.ok) return r.json(); const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); })
      .then((i) => { if (alive && i) { setIns(i as Insights); setInsStored(!!i.stored); } })
      .catch((e) => { if (alive) { setIns(null); setInsErr((e as Error).message); } }).finally(() => { if (alive) setLoading(false); });
    fetch(`/api/posts?accountId=${accountId}&from=${from}&to=${to}&limit=10&insights=true`).then((r) => r.ok ? r.json() : { posts: [] }).then((p) => { if (alive) setPosts((p?.posts || []) as Post[]); }).catch(() => {});
    fetch(`/api/audience?accountId=${accountId}&from=${from}&to=${to}`).then((r) => r.ok ? r.json() : null).then((a) => { if (alive && a) setAud(a as Audience); }).catch(() => {});
    fetch(`/api/overview-tips?accountId=${accountId}&from=${from}&to=${insTo}`).then((r) => r.ok ? r.json() : null).then((tp) => { if (alive) setTips((tp?.tips || []) as Tip[]); }).catch(() => {});
    // Stories: Meta drops them after 24h, so read our snapshots for the range.
    setStories(null);
    fetch(`/api/stories/historical?accountId=${accountId}&from=${from}&to=${to}&limit=500`).then((r) => r.ok ? r.json() : { stories: [] }).then((s) => { if (alive) setStories((s?.stories || []) as StoryRow[]); }).catch(() => { if (alive) setStories([]); });
    // Inbound DMs in range (from the mirror). Real numbers once the DM pipe is live.
    setDmCount(null);
    fetch(`/api/dm/count?account=${accountId}&from=${from}&to=${to}`).then((r) => r.ok ? r.json() : null).then((d) => { if (alive) setDmCount(typeof d?.count === "number" ? d.count : 0); }).catch(() => { if (alive) setDmCount(0); });
    return () => { alive = false; };
  }, [range, accountId]);
  const storyStats = useMemo(() => {
    const src = stories || [];
    return { count: src.length, reach: src.reduce((s, x) => s + (x.reach || 0), 0), replies: src.reduce((s, x) => s + (x.replies || 0), 0) };
  }, [stories]);

  const t = ins?.totals, d = ins?.deltas;
  const tipBy = useMemo(() => {
    const m: Record<string, Tip> = {};
    tips.forEach((x) => { m[x.metric] = x; });
    return m;
  }, [tips]);


  // Full-range posts (limit 200) → custom Post-mix + Which-format-wins
  // (same source/logic as the real Overview's OverviewExtras).
  const [rangePosts, setRangePosts] = useState<Post[] | null>(null);
  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({ accountId, from: range.from, to: range.to, limit: "200", insights: "true" }).toString();
    setRangePosts(null);
    fetch(`/api/posts?${qs}`).then((r) => r.ok ? r.json() : { posts: [] }).then((d) => { if (alive) setRangePosts((d.posts || []) as Post[]); }).catch(() => { if (alive) setRangePosts([]); });
    return () => { alive = false; };
  }, [range, accountId]);
  const postMix = useMemo(() => {
    const src = rangePosts || [];
    if (!src.length) return { total: 0, entries: [] as { type: string; count: number; pct: number }[] };
    const counts: Record<string, number> = {};
    for (const p of src) counts[p.type] = (counts[p.type] || 0) + 1;
    const total = src.length;
    return { total, entries: Object.entries(counts).map(([type, count]) => ({ type, count, pct: (count / total) * 100 })).sort((a, b) => b.count - a.count) };
  }, [rangePosts]);
  const formatRows = useMemo(() => {
    const src = rangePosts || [];
    if (!src.length) return [] as { type: string; count: number; avgReach: number; avgEng: number; erPct: number }[];
    const agg: Record<string, { count: number; reach: number; eng: number }> = {};
    for (const p of src) {
      const eng = p.totalInteractions || ((p.likes || 0) + (p.comments || 0));
      agg[p.type] ??= { count: 0, reach: 0, eng: 0 };
      agg[p.type].count += 1; agg[p.type].reach += p.reach || 0; agg[p.type].eng += eng;
    }
    return Object.entries(agg).map(([type, v]) => {
      const avgReach = Math.round(v.reach / v.count);
      const avgEng = Math.round(v.eng / v.count);
      return { type, count: v.count, avgReach, avgEng, erPct: avgReach > 0 ? (avgEng / avgReach) * 100 : 0 };
    }).sort((a, b) => b.avgReach - a.avgReach);
  }, [rangePosts]);

  // Top performing + latest rank across ALL posts in the range (limit-200 set),
  // not just the newest 10, so "top by reach" is the true top for the period.
  const postSrc = (rangePosts && rangePosts.length) ? rangePosts : posts;
  const topPosts = [...postSrc].sort((a, b) => (b.reach || 0) - (a.reach || 0)).slice(0, 5);
  const latest = [...postSrc].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 5);

  // KPI tiles. Live months = native account data. Historical months (insStored)
  // come from stored snapshots: reach + follower growth are real; engagement is
  // summed from that month's posts; profile visits weren't recorded before today.
  const postEngagement = useMemo(() => (rangePosts || []).reduce((s, p) => s + (p.totalInteractions || ((p.likes || 0) + (p.comments || 0))), 0), [rangePosts]);
  // Likes / comments / saves / shares split for the range (Instagram only) —
  // summed from the per-post insights we already fetched.
  const engBreakdown = useMemo(() => (rangePosts || []).reduce(
    (a, p) => ({ likes: a.likes + (p.likes || 0), comments: a.comments + (p.comments || 0), saves: a.saves + (p.saves || 0), shares: a.shares + (p.shares || 0) }),
    { likes: 0, comments: 0, saves: 0, shares: 0 },
  ), [rangePosts]);
  // Snapshot coverage for a combined (non-monthly) stored period. Daily snapshots
  // have gaps, so a 90-day total can silently under-report — say what it is built
  // from rather than presenting a short number as complete.
  const spanDays = Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86_400_000) + 1;
  const daysHeld = ins?.daysStored ?? 0;
  const coverageShort = insStored && !isMonthly && daysHeld > 0 && daysHeld < spanDays - 1;
  // Profile visits and engagement were only recorded from 22 Sep 2026, so on a
  // long stored range they cover fewer days than reach. Label the tile with the
  // days it actually covers rather than letting a part-period sum pass as a total.
  const pvDays = ins?.daysWithProfileVisits ?? 0;
  const engDays = ins?.daysWithEngagement ?? 0;
  const pvPartial = insStored && pvDays > 0 && pvDays < daysHeld;
  const engPartial = insStored && engDays > 0 && engDays < daysHeld;
  // Stored ranges: prefer the snapshot's own total_interactions. It is instant and
  // covers the whole span. Snapshots written before the collector was fixed
  // (22 Sep 2026) carry 0 there, so those fall back to summing the period's posts.
  const storedEng = t?.engagement ?? 0;
  // Only trust the snapshot sum when it covers the whole stored range. Where it
  // is partial (the collector started recording interactions on 22 Sep 2026) the
  // slower per-post sum is the more complete number, so that wins.
  const engVal = insStored ? (storedEng > 0 && !engPartial ? storedEng : postEngagement) : storedEng;
  // On stored ranges engagement is summed from the period's posts, and that fetch
  // is slow over a long span. Until it lands, show a dash — a confident "0" reads
  // as "no engagement" rather than "still counting".
  const engPending = insStored && (storedEng === 0 || engPartial) && rangePosts === null;
  const engRate = t && t.reach > 0 ? Math.round((engVal / t.reach) * 1000) / 10 : 0;
  // Engagement + profile views are real now (Meta's total_interactions and
  // profile_views), so drop the EST badge — unless that call fell back to the
  // old reach-derived estimate.
  const engEst = !insStored && ins?.meta?.engagementBasis !== "measured";
  // Past (stored) ranges are a specific month — label the post sections with it so
  // "Latest" reads as that month's, not the current one.
  const pastMonthLabel = insStored
    ? (isMonthly ? new Date(range.from + "T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : rangeLabel)
    : null;
  const stats: { key: string; label: string; value: string; delta: number | null; flat?: boolean; badge?: string; est?: boolean }[] = t ? [
    { key: "followers", label: "Followers", value: fmt(t.followers), delta: insStored ? null : (d?.followers ?? 0), badge: insStored ? "saved" : undefined },
    { key: "reach", label: "Reach", value: fmt(t.reach), delta: insStored ? null : (d?.reach ?? 0), badge: insStored ? "saved" : undefined },
    // Live-window engagement & profile visits come straight from Meta
    // (total_interactions / profile_views). `engEst` only turns back on if that
    // call failed and we're showing the old reach-derived estimate.
    { key: "engagement", label: "Engagement", value: engPending ? "…" : fmt(engVal), delta: insStored ? null : (d?.engagement ?? null), badge: insStored ? (engPending ? "counting…" : storedEng > 0 && !engPartial ? "saved" : "from posts") : undefined, est: engEst },
    { key: "profileVisits", label: "Profile Visits", value: insStored && !t.profileVisits ? "—" : fmt(t.profileVisits), delta: insStored ? null : (d?.profileVisits ?? null), badge: insStored ? (!t.profileVisits ? "not recorded" : pvPartial ? `${pvDays} of ${daysHeld} days` : "saved") : undefined, est: engEst },
    { key: "engRate", label: "Eng. Rate", value: engPending ? "…" : `${engRate}%`, delta: null, flat: true, est: engEst },
  ] : [];

  return (
    // The flex shell and the sidebar come from the route layout; this page owns
    // only its main column, which is full-bleed with its own sticky header.
    <main className="preview-scope" style={{ flex: 1, minWidth: 0, color: C.heading }}>
        <header style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 28px", background: C.card, borderBottom: `1px solid ${C.line}`, position: "sticky", top: 0, zIndex: 5 }}>
          {/* Brand / account switcher — which page's data the whole Overview shows */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setBrandOpen((o) => !o)}
              style={{ display: "inline-flex", alignItems: "center", gap: 10, background: C.card, border: `1px solid ${brandOpen ? C.primary : C.line}`, borderRadius: 10, padding: "7px 12px", cursor: "pointer", boxShadow: brandOpen ? `0 0 0 3px ${C.primary}22` : "none", transition: "all .15s" }}
            >
              <BrandLogo src={brandLogos[currentAccount.id]} label={currentAccount.label} size={26} />
              {/* Fixed width so the button is the same size for every brand — it used to
                  grow and shrink as you switched, nudging the whole header around.
                  Measured against the longest label we carry, "Samvaya Matrimony", which
                  needs ~145px at this size — anything tighter truncates it. */}
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2, width: 152, minWidth: 0, textAlign: "left" }}>
                {/* "BRAND" is the caption, not the point — the brand name is. It was the
                    heavier of the two, which read backwards. */}
                <span style={{ fontSize: 9.5, fontWeight: 500, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Brand</span>
                {/* textAlign is set on the column: this span is the full 152px while the
                    caption above shrinks to its text, so a <button>'s inherited
                    text-align:center pushed the name right and the two stopped
                    lining up. */}
                <span style={{ fontSize: 14.5, fontWeight: 600, color: C.heading, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {currentAccount.label}
                </span>
              </span>
              <IconChevronDown size={16} stroke={2} style={{ color: C.muted, transform: brandOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
            </button>
            {brandOpen && (
              <>
                <div onClick={() => setBrandOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, minWidth: 260, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, boxShadow: "0 16px 40px rgba(15,18,40,0.16)", padding: 6, zIndex: 41 }}>
                  {switchable.map((a) => {
                    const on = a.id === accountId;
                    return (
                      <button
                        key={a.id}
                        onClick={() => { setAccountId(a.id); setBrandOpen(false); }}
                        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "9px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: on ? C.bg : "transparent", transition: "background .12s" }}
                        onMouseEnter={(e) => { if (!on) (e.currentTarget.style.background = C.bg); }}
                        onMouseLeave={(e) => { if (!on) (e.currentTarget.style.background = "transparent"); }}
                      >
                        <BrandLogo src={brandLogos[a.id]} label={a.label} size={30} />
                        <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: C.heading }}>{a.label}</span>
                          <span style={{ fontSize: 12, color: C.muted }}>{a.handle}</span>
                        </span>
                        {on && <IconCheck size={17} stroke={2.4} style={{ color: C.primary, flexShrink: 0 }} />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 18, color: C.muted }}>
            <DayControl />
            <HeaderClock />
            <HubNotificationBell />
            <HeaderProfile />
          </div>
        </header>

        <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 22, margin: "0 auto" }}>
          {/* Platform toggle + date-range filter — the filter drives every tab */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div style={{ background: C.card, borderRadius: 12, boxShadow: SHADOW, padding: 6, display: "inline-flex", gap: 4 }}>
              {availablePlatforms.map((p) => {
                const on = platform === p.key;
                return (
                  <button key={p.key} onClick={() => setPlatform(p.key)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, background: on ? C.primary : "transparent", color: on ? "#fff" : C.muted, boxShadow: on ? "0 8px 18px rgba(58,87,232,0.28)" : "none", transition: "all .15s" }}>
                    <p.icon size={16} stroke={1.9} /> {p.label}
                  </button>
                );
              })}
            </div>
            <RangeFilter rangeKey={rangeKey} setRangeKey={setRangeKey} custom={custom} setCustom={setCustom} />
          </div>

          {/* Month switcher — on long ranges the whole Overview is a per-month report */}
          {isMonthly && months.length > 0 && (
            <div style={{ background: C.card, borderRadius: 12, boxShadow: SHADOW, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 4 }}><IconCalendarEvent size={15} /> Month</span>
                {months.map((m) => {
                  const on = selectedMonth?.key === m.key;
                  return (
                    <button key={m.key} onClick={() => setSelMonthKey(m.key)}
                      style={{ padding: "7px 13px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: on ? C.primary : C.bg, color: on ? "#fff" : C.muted, boxShadow: on ? "0 6px 14px rgba(58,87,232,0.28)" : "none", transition: "all .15s" }}>
                      {m.label}{m.isCurrent ? " · so far" : ""}
                    </button>
                  );
                })}
              </div>
              {selectedMonth && (
                <div style={{ marginTop: 11, paddingTop: 11, borderTop: `1px solid ${C.line}`, fontSize: 12, color: C.muted }}>
                  Showing <b style={{ color: C.heading, fontWeight: 600 }}>{selectedMonth.full}{selectedMonth.isCurrent ? " (so far)" : ""}</b> · {fmtNice(selectedMonth.from)} → {fmtNice(selectedMonth.to)}
                </div>
              )}
            </div>
          )}

          {/* Friendly range caption for every non-switcher case (IG 7d/30d + all of FB/LI/YT) */}
          {!isMonthly && (
            <div style={{ background: C.card, borderRadius: 12, boxShadow: SHADOW, padding: "10px 14px", fontSize: 12, color: C.muted }}>
              Showing <b style={{ color: C.heading, fontWeight: 600 }}>{rangeKey === "custom" ? "your custom range" : rangeLabel}</b> · {fmtNice(range.from)} → {fmtNice(range.to)}
            </div>
          )}

          {platform !== "instagram" ? (
            <>
              <PlatformHero platform={platform} accountId={accountId} range={range} rangeLabel={rangeLabel} brandLabel={currentAccount?.label ?? "GooCampus"} person={person} />
              <div className="preview-scope">
                <Card>
                  <div style={{ fontSize: 14, color: C.muted, marginBottom: 10 }}>{PLATFORMS.find((p) => p.key === platform)?.label} overview</div>
                  {platform === "facebook" && <FacebookOverview accountId={accountId} range={range} />}
                  {platform === "linkedin" && <LinkedInOverview accountId={accountId} range={range} />}
                  {platform === "youtube" && <YouTubeOverview accountId={accountId} range={range} enhanced />}
                </Card>
              </div>
            </>
          ) : (
            <>
              {/* Hero — narrative fold */}
              <HeroBanner eyebrow={`${currentAccount.handle} · ${rangeLabel}`} person={person}>
                {t ? (insStored
                  ? <>You gained <b>{fmt(t.newFollowers)}</b> new followers this period, reaching <b>{fmt(t.reach)}</b> — from your saved history.</>
                  : <>You gained <b>{fmt(t.newFollowers)}</b> new followers this period{d ? <> — reach is <b>{d.reach >= 0 ? "up" : "down"} {Math.abs(d.reach).toFixed(1)}%</b>{d.engagement != null && <> and engagement <b>{d.engagement >= 0 ? "up" : "down"} {Math.abs(d.engagement).toFixed(1)}%</b></>}.</> : "."}</>
                ) : insErr ? `Couldn't load Instagram right now — ${insErr}` : "Loading your latest performance…"}
              </HeroBanner>
              {insStored && (
                <div style={{ fontSize: 12, background: "#EEF1FB", border: "1px solid #DCE3FB", color: "#2138B0", borderRadius: 10, padding: "9px 13px", marginTop: -8 }}>
                  {isMonthly
                    ? <>This month is older than Instagram&rsquo;s 30-day window, so its KPIs are read from your <b>saved snapshots</b>. Reach &amp; follower growth are real; engagement is summed from this month&rsquo;s posts; profile visits weren&rsquo;t recorded before today.</>
                    : <><b>{rangeLabel}</b>, combined into one period. Instagram only serves the last 30 days live, so these totals are added up from your <b>saved daily snapshots</b> ({daysHeld} of {spanDays} days recorded{ins?.coverageFrom ? <> · {fmtNice(ins.coverageFrom)} → {fmtNice(ins.coverageTo || range.to)}</> : null}). Reach &amp; follower growth are real. Engagement and profile visits only began recording on 22 Sep 2026, so on a longer window they cover fewer days than reach — each tile says how many.{coverageShort ? <> <b>Days with no snapshot are missing from these totals</b>, so the real figures are higher.</> : null}</>}
                </div>
              )}

              {/* Stat cards — now with description + AI action, matching the real Overview */}
              <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: 18 }}>
                {loading && !ins ? <div style={{ gridColumn: "1 / -1", height: 168, background: C.card, borderRadius: 14, boxShadow: SHADOW, display: "flex", alignItems: "center", justifyContent: "center" }}><LoadingBlock label="Loading your numbers…" /></div>
                  : stats.map(({ key, ...rest }) => (
                    <StatCard key={key} {...rest}
                      detail={tipBy[key]?.detail || PLAIN[key]?.detail || ""}
                      action={tipBy[key]?.action || PLAIN[key]?.action || ""} />
                  ))}
              </section>

              {/* Reach chart + Audience */}
              <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 18 }}>
                <Card>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.4px" }}>{t ? fmt(chartMetric === "reach" ? t.reach : t.engagement) : "—"}</div>
                      <div style={{ fontSize: 14, color: C.muted }}>{chartMetric === "reach" ? "Reach" : "Engagement"} this period</div>
                    </div>
                    {/* Reach / Engagement toggle — switches the number + graph below */}
                    <div style={{ background: C.bg, borderRadius: 10, padding: 4, display: "inline-flex", gap: 3 }}>
                      {(["reach", "engagement"] as const).map((m) => {
                        const on = chartMetric === m;
                        const col = m === "reach" ? C.primary : C.teal;
                        return (
                          <button key={m} onClick={() => setChartMetric(m)}
                            style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: on ? "#fff" : "transparent", color: on ? C.heading : C.muted, boxShadow: on ? "0 1px 3px rgba(35,45,66,0.14)" : "none", transition: "all .15s" }}>
                            <span style={{ width: 8, height: 8, borderRadius: 99, background: col }} /> {m === "reach" ? "Reach" : "Engagement"}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {ins ? <AreaChart series={ins.series} metric={chartMetric} /> : loading ? <LoadingBlock label="Loading the chart…" /> : null}
                </Card>

                <Card>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Who you reached</div>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
                    {aud?.stored
                      ? <>Audience captured for {aud.month ? new Date(aud.month + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "this month"}</>
                      : "Audience split · current"}
                  </div>
                  {!aud && (loading || !ins) ? <LoadingBlock label="Loading your audience…" /> : <GenderDonut gender={aud?.gender || []} />}
                  <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 9 }}>
                    {(aud?.countries || []).slice(0, 4).map((c, i) => {
                      const max = Math.max(1, ...(aud?.countries || []).slice(0, 4).map((x) => x.value));
                      return (
                        <div key={c.label} style={{ display: "grid", gridTemplateColumns: "116px 1fr 40px", alignItems: "center", gap: 8, fontSize: 12 }}>
                          <span style={{ color: C.heading, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={countryName(c.label)}>{countryName(c.label)}</span>
                          <span style={{ height: 8, background: "#EEF1FB", borderRadius: 99, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${(c.value / max) * 100}%`, background: AUD_BARS[i % AUD_BARS.length], borderRadius: 99 }} /></span>
                          <span style={{ color: C.muted, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{kfmt(c.value)}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </section>

              {/* Top performing posts — card grid, moved ABOVE Latest posts */}
              <Card>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <IconTrophy size={18} color={C.primary} />
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{pastMonthLabel ? `${pastMonthLabel} · top performing posts` : "Top performing posts"}</div>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: C.muted }}>ranked by reach</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
                  {(loading && !posts.length ? Array.from({ length: 5 }) : topPosts).map((p, i) => {
                    const post = p as Post | undefined;
                    if (!post) return <div key={i} style={{ height: 250, background: C.bg, borderRadius: 12 }} />;
                    const chip = typeChip(post.type);
                    const er = post.reach > 0 ? ((post.totalInteractions || (post.likes + post.comments)) / post.reach * 100).toFixed(1) : "0";
                    return (
                      <div key={post.id} onClick={() => setOpenPost(post)} role="button" tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenPost(post); } }}
                        style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden", background: C.card, cursor: "pointer" }}>
                        <div style={{ position: "relative", aspectRatio: "4/5", background: C.bg }}>
                          {post.mediaUrl ? <img src={post.mediaUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : null}
                          <span style={{ position: "absolute", top: 8, left: 8, width: 24, height: 24, borderRadius: 99, background: C.primary, color: "#fff", fontSize: 12, fontWeight: 600, display: "grid", placeItems: "center", boxShadow: "0 4px 10px rgba(58,87,232,0.4)" }}>{i + 1}</span>
                          <span style={{ position: "absolute", top: 8, right: 8, fontSize: 12, fontWeight: 600, padding: "3px 8px", borderRadius: 99, background: chip.bg, color: chip.fg }}>{chip.label}</span>
                        </div>
                        <div style={{ padding: "10px 11px" }}>
                          <div style={{ fontSize: 12, color: C.heading, lineHeight: 1.35, height: "2.7em", overflow: "hidden" }}>{(post.caption || "").split("\n")[0].slice(0, 60) || "(no caption)"}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, color: C.muted, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconEye size={13} /> {kfmt(post.reach || 0)}</span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconHeart size={13} /> {kfmt(post.likes || 0)}</span>
                            <span style={{ marginLeft: "auto", color: C.success, fontWeight: 600 }}>{er}% ER</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>


              {/* Latest posts — now below Top performing */}
              <Card>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{pastMonthLabel ? `${pastMonthLabel} posts` : "Latest posts"}</div>
                  <Link href="/dashboard/preview/posts" style={{ fontSize: 12, color: C.primary, fontWeight: 600, textDecoration: "none" }}>View all →</Link>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
                  {(loading && !posts.length ? Array.from({ length: 5 }) : latest).map((p, i) => {
                    const post = p as Post | undefined;
                    if (!post) return <div key={i} style={{ height: 210, background: C.bg, borderRadius: 12 }} />;
                    const chip = typeChip(post.type);
                    return (
                      <div key={post.id} onClick={() => setOpenPost(post)} role="button" tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenPost(post); } }}
                        style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden", background: C.card, cursor: "pointer" }}>
                        <div style={{ position: "relative", aspectRatio: "4/5", background: C.bg }}>
                          {post.mediaUrl ? <img src={post.mediaUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : null}
                          <span style={{ position: "absolute", top: 8, left: 8, fontSize: 12, fontWeight: 600, padding: "3px 8px", borderRadius: 99, background: chip.bg, color: chip.fg }}>{chip.label}</span>
                        </div>
                        <div style={{ padding: "10px 11px" }}>
                          <div style={{ fontSize: 12, color: C.heading, lineHeight: 1.35, height: "2.7em", overflow: "hidden" }}>{(post.caption || "").split("\n")[0].slice(0, 60) || "(no caption)"}</div>
                          <div style={{ display: "flex", gap: 12, marginTop: 8, color: C.muted, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconEye size={13} /> {kfmt(post.reach || 0)}</span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconHeart size={13} /> {kfmt(post.likes || 0)}</span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconMessageCircle size={13} /> {kfmt(post.comments || 0)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {openPost && <PostDetailModal post={openPost} onClose={() => setOpenPost(null)} />}

              {/* ══ Sections carried over from the real Overview so NOTHING is removed ══ */}

              {/* Engagement breakdown — likes / comments / saves / shares (Instagram) */}
              <SectionHeader icon={IconHeart} title="Engagement breakdown" sub="Likes, comments, saves & shares in this range" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
                {[
                  { label: "Likes", value: engBreakdown.likes, icon: IconHeart, color: "#EC4899" },
                  { label: "Comments", value: engBreakdown.comments, icon: IconMessageCircle, color: C.primary },
                  { label: "Saves", value: engBreakdown.saves, icon: IconBookmark, color: C.teal },
                  { label: "Shares", value: engBreakdown.shares, icon: IconShare3, color: "#6E48F8" },
                ].map((m) => (
                  <Card key={m.label}>
                    <span style={{ width: 38, height: 38, borderRadius: 10, background: `${m.color}18`, color: m.color, display: "grid", placeItems: "center", marginBottom: 10 }}><m.icon size={20} stroke={1.9} /></span>
                    <div style={{ fontSize: 26, fontWeight: 600, color: C.heading, fontVariantNumeric: "tabular-nums" }}>{rangePosts === null ? "—" : fmt(m.value)}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{m.label}</div>
                  </Card>
                ))}
              </div>

              {/* Stories — from our snapshots (Meta drops live stories after 24h) */}
              <SectionHeader icon={IconEye} title="Stories" sub="Stories posted in this range, and how they did" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
                {[
                  { label: "Stories posted", value: storyStats.count, icon: IconBrandInstagram, color: C.primary },
                  { label: "Total reach", value: storyStats.reach, icon: IconEye, color: C.teal },
                  { label: "Replies", value: storyStats.replies, icon: IconMessageCircle, color: "#EC4899" },
                ].map((m) => (
                  <Card key={m.label}>
                    <span style={{ width: 38, height: 38, borderRadius: 10, background: `${m.color}18`, color: m.color, display: "grid", placeItems: "center", marginBottom: 10 }}><m.icon size={20} stroke={1.9} /></span>
                    <div style={{ fontSize: 26, fontWeight: 600, color: C.heading, fontVariantNumeric: "tabular-nums" }}>{stories === null ? "—" : fmt(m.value)}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{m.label}</div>
                  </Card>
                ))}
              </div>
              {stories !== null && storyStats.count === 0 && (
                <div style={{ fontSize: 12, color: C.muted, marginTop: -6 }}>No story snapshots for this range yet.</div>
              )}

              {/* Direct messages — inbound DMs mirrored into the dashboard */}
              <SectionHeader icon={IconMessageCircle} title="Direct messages" sub="Inbound DMs recorded in this range" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
                <Card>
                  <span style={{ width: 38, height: 38, borderRadius: 10, background: "#3A57E818", color: C.primary, display: "grid", placeItems: "center", marginBottom: 10 }}><IconMessageCircle size={20} stroke={1.9} /></span>
                  <div style={{ fontSize: 26, fontWeight: 600, color: C.heading, fontVariantNumeric: "tabular-nums" }}>{dmCount === null ? "—" : fmt(dmCount)}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>DMs received</div>
                </Card>
              </div>
              {dmCount !== null && dmCount === 0 && (
                <div style={{ fontSize: 12, color: C.muted, marginTop: -6 }}>DM mirroring isn&apos;t live yet — this fills in once inbound DMs are forwarded to the dashboard (past months can&apos;t be backfilled).</div>
              )}

              {/* Performance — post mix / engagement rate / hashtags / format / reposts */}
              <SectionHeader icon={IconChartBar} title="Performance" sub="Post mix, formats & hashtags" />
              {/* Left column stacks Post mix + Hashtags (fills the space under Post mix);
                  Which format wins owns the taller right column. 40/60 split, top-aligned. */}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 3fr", gap: 16, alignItems: "start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
                  <PostMix mix={postMix} loading={rangePosts === null} cardStyle={{ minWidth: 0 }} />
                  {/* Hashtags reused from the shared component (post mix, format card &
                      reposts hidden here — drawn Themed / on the right instead). */}
                  <div className="preview-scope">
                    <OverviewExtras accountId={accountId} range={range} hideReposts hidePostMix hideFormat />
                  </div>
                </div>
                {/* Right column: Which format wins, with the "Your read" takeaway tucked
                    inside the card at the bottom (levels the two columns). */}
                <FormatWins rows={formatRows} cardStyle={{ minWidth: 0 }} footer={<YourRead mix={postMix} />} />
              </div>

              {/* Output — monthly totals first, then the weekly rhythm */}
              <SectionHeader icon={IconCalendarEvent} title="What you published" sub="Monthly totals, then the weekly rhythm" />
              <div className="preview-scope" style={{ background: C.card, borderRadius: 16, boxShadow: SHADOW, padding: "8px 12px" }}>
                <MonthlyOutputBar accountId={accountId} range={range} months={monthlyMonths} />
                <PostingCadenceBar accountId={accountId} range={range} smartCadence />
              </div>

            </>
          )}
        </div>
      </main>
  );
}

/* ---------- pieces ---------- */
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: C.card, borderRadius: 4, boxShadow: SHADOW, padding: 16, ...style }}>{children}</div>;
}

// The blue gradient greeting banner — shared by every platform tab.
// `person` is the signed-in teammate's full name (e.g. "Maheen Ejaz"); we greet
// them by name, falling back to the brand only if no name is available.
function HeroBanner({ eyebrow, person = "", children }: { eyebrow: string; person?: string; children: React.ReactNode }) {
  // The greeting has to be worked out where the PERSON is, not where the server is.
  //
  // This page renders on Netlify, which runs on UTC, so the first paint said "Good
  // morning" to everyone in India until half past five in the afternoon. The old
  // note here said it "self-corrects on the first client re-render" — it does not:
  // suppressHydrationWarning tells React to KEEP the server's text, and on a page
  // that never re-renders, nothing ever corrects it. "Only good morning is showing,
  // it should change according to time" (Nikhil, 8 Oct, at 4:16pm).
  //
  // So: render the server's guess, then set it again from the browser's clock once
  // mounted. Starting it empty instead would flash the name with no greeting.
  const [greet, setGreet] = useState(greeting());
  useEffect(() => { setGreet(greeting()); }, []);
  return (
    <section style={{ position: "relative", overflow: "hidden", borderRadius: 16, padding: "30px 34px", background: `linear-gradient(120deg, ${C.primary} 0%, ${C.primaryDark} 55%, ${C.navy} 100%)`, color: "#fff", boxShadow: "0 18px 40px rgba(58,87,232,0.28)" }}>
      <div style={{ position: "absolute", right: -40, top: -60, width: 260, height: 260, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
      <div style={{ position: "absolute", right: 90, bottom: -90, width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />
      <div style={{ position: "relative" }}>
        <div style={{ fontSize: 14, opacity: 0.85, fontWeight: 500 }}>{eyebrow}</div>
        {/* suppressHydrationWarning: the server renders its own UTC guess at the
            greeting and the browser replaces it on mount, so the two deliberately
            differ. The name is the same on both sides. */}
        <h1 suppressHydrationWarning className="preview-hero-h1" style={{ fontSize: 32, margin: "8px 0 6px", letterSpacing: "-0.3px" }}>{greet}, {person || "GooCampus"}</h1>
        <p style={{ fontSize: 16, opacity: 0.92, maxWidth: 560, lineHeight: 1.55, margin: 0 }}>{children}</p>
      </div>
    </section>
  );
}

// Same banner for Facebook / LinkedIn / YouTube, with that platform's real
// headline metrics (fetched the same way the panel below it fetches).
function PlatformHero({ platform, accountId, range, rangeLabel, brandLabel, person = "" }: { platform: PlatformKey; accountId: string; range: { from: string; to: string }; rangeLabel: string; brandLabel: string; person?: string }) {
  const label = platform === "facebook" ? "Facebook" : platform === "linkedin" ? "LinkedIn" : "YouTube";
  const connected = platform === "facebook" ? true : platform === "linkedin" ? !!LI_PAGE[accountId] : !!YT_CHANNEL[accountId];
  const url = useMemo(() => {
    if (!connected) return null;
    const p = new URLSearchParams({ from: range.from, to: range.to });
    if (platform === "facebook") { p.set("account", accountId); return `/api/facebook?${p.toString()}`; }
    if (platform === "linkedin") { p.set("page", LI_PAGE[accountId] || ""); return `/api/linkedin?${p.toString()}`; }
    p.set("channel", YT_CHANNEL[accountId] || ""); return `/api/youtube?${p.toString()}`;
  }, [platform, accountId, range, connected]);

  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    setData(null);
    if (!url) return;
    let ok = true;
    fetch(url).then((r) => r.json()).then((d) => { if (ok) setData(d); }).catch(() => {});
    return () => { ok = false; };
  }, [url]);

  let sub: React.ReactNode;
  if (!connected) {
    sub = <>{label} isn&apos;t connected for this brand.</>;
  } else if (!data) {
    sub = <>Loading your {label} performance…</>;
  } else if (data.error) {
    sub = <>Couldn&apos;t load {label} right now — {String(data.error)}</>;
  } else if (platform === "facebook") {
    const i = (data.insights || {}) as { engagement?: number; pageViews?: number; follows?: number };
    sub = <>Your Facebook page drove <b>{fmt(i.engagement || 0)}</b> engagements and <b>{fmt(i.pageViews || 0)}</b> page views this period{i.follows ? <>, plus <b>{fmt(i.follows)}</b> new follows</> : null}.</>;
  } else if (platform === "youtube") {
    const s = (data.summary || {}) as { subscriberGain?: number; views?: number; watchHours?: number };
    sub = <>You gained <b>{fmt(s.subscriberGain || 0)}</b> subscribers this period — <b>{fmt(s.views || 0)}</b> views and <b>{fmt(s.watchHours || 0)}</b> watch hours.</>;
  } else {
    const s = (data.summary || {}) as { followers?: number; followerGain?: number; engagementRate?: number; posts?: number };
    sub = <>You have <b>{fmt(s.followers || 0)}</b> followers (<b>+{s.followerGain || 0}</b> this period) with a <b>{s.engagementRate || 0}%</b> engagement rate across <b>{s.posts || 0}</b> posts.</>;
  }

  return <HeroBanner eyebrow={`${brandLabel} on ${label} · ${rangeLabel}`} person={person}>{sub}</HeroBanner>;
}


// Post mix — Themed donut with the new palette + a plain-English read.
// `loading` is true while the range posts are still in flight (rangePosts === null);
// we show a neutral skeleton instead of a hard "0 Posts", which reads as broken data.
function PostMix({ mix, loading, cardStyle }: { mix: { total: number; entries: { type: string; count: number; pct: number }[] }; loading?: boolean; cardStyle?: React.CSSProperties }) {
  const stops: string[] = []; let from = 0;
  for (const e of mix.entries) { const c = fmtMeta(e.type).color; const to = from + (e.pct / 100) * 360; stops.push(`${c} ${from.toFixed(1)}deg ${to.toFixed(1)}deg`); from = to; }
  const gradient = loading || !stops.length ? `conic-gradient(${C.line} 0deg 360deg)` : `conic-gradient(${stops.join(", ")})`;
  return (
    <Card style={cardStyle}>
      <div style={{ fontSize: 16, fontWeight: 600, color: C.heading }}>Post mix</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>What formats you posted, and what the split means.</div>
      <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: 132, height: 132, flexShrink: 0 }}>
          <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: gradient }} />
          <div style={{ position: "absolute", inset: 15, borderRadius: "50%", background: C.card, display: "grid", placeItems: "center", textAlign: "center" }}>
            <div><div style={{ fontSize: 25, fontWeight: 600, color: loading ? C.muted : C.heading }}>{loading ? "…" : mix.total}</div><div style={{ fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Posts</div></div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 13 }}>
          {loading ? [0, 1, 2].map((i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "16px 1fr 40px", alignItems: "center", gap: 10 }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: "#EEF1FB" }} />
              <div style={{ height: 6, background: "#EEF1FB", borderRadius: 99 }} />
              <span />
            </div>
          )) : mix.entries.map((e) => { const m = fmtMeta(e.type); return (
            <div key={e.type} style={{ display: "grid", gridTemplateColumns: "16px 1fr 40px", alignItems: "center", gap: 10 }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: m.color }} />
              <div>
                <div><span style={{ fontSize: 14, fontWeight: 600, color: C.heading }}>{m.label}</span> <span style={{ fontSize: 12, color: C.muted }}>· {e.count} posts</span></div>
                <div style={{ height: 6, background: "#EEF1FB", borderRadius: 99, marginTop: 4, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${e.pct}%`, background: m.color, borderRadius: 99 }} /></div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.heading, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Math.round(e.pct)}%</span>
            </div>
          ); })}
        </div>
      </div>
    </Card>
  );
}

// Your read — the plain-English post-mix takeaway. Lives under "Which format wins"
// (right column) so the left column ends level with it — no dead space.
function YourRead({ mix }: { mix: { total: number; entries: { type: string; count: number; pct: number }[] } }) {
  const dominant = mix.entries[0];
  if (!dominant) return null;
  const reelPct = mix.entries.find((e) => e.type === "REEL")?.pct || 0;
  const carouselPct = mix.entries.find((e) => e.type === "CAROUSEL_ALBUM")?.pct || 0;
  return (
    <div style={{ background: "#F4F6FF", border: "1px solid #E1E7FE", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.primary, textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 5 }}>Your read</div>
      <div style={{ fontSize: 12, color: C.heading, lineHeight: 1.55 }}>
        {carouselPct >= 50
          ? <>You&rsquo;re <b>Carousel-heavy</b> — great for the followers you already have, but <b>Reels</b> are the format IG shows to NEW people. Bumping Reels from <b>{Math.round(reelPct)}%</b> toward <b>~40%</b> could grow your audience faster.</>
          : reelPct >= 40
            ? <>Nice Reel-forward mix — that&rsquo;s the format IG pushes to new people. Keep <b>Carousels</b> for depth.</>
            : <>Fairly balanced. For education content, aim for <b>~40% Reels · ~40% Carousels · ~20% Static</b>.</>}
      </div>
    </div>
  );
}

// Which format wins — visual comparison with an avg-reach bar per format + winner.
function FormatWins({ rows, cardStyle, footer }: { rows: { type: string; count: number; avgReach: number; avgEng: number; erPct: number }[]; cardStyle?: React.CSSProperties; footer?: React.ReactNode }) {
  if (!rows.length) return null;
  const winner = rows[0];
  const wm = fmtMeta(winner.type);
  const maxReach = Math.max(1, ...rows.map((r) => r.avgReach));
  return (
    <Card style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.heading }}>Which format wins</div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "#fff", background: wm.color, padding: "4px 11px", borderRadius: 99 }}><IconTrophy size={13} /> {wm.label} — top reach</span>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>Average performance per format, so you can see what to make more of.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {rows.map((r) => { const m = fmtMeta(r.type); const isWin = r.type === winner.type; return (
          <div key={r.type} style={{ border: `1px solid ${isWin ? m.color + "55" : C.line}`, background: isWin ? `linear-gradient(135deg, ${m.color}0F, #fff)` : "#fff", borderRadius: 14, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: m.color }} /><span style={{ fontSize: 14, fontWeight: 600, color: C.heading }}>{m.label}</span><span style={{ fontSize: 12, color: C.muted }}>· {r.count} posts</span></div>
              {isWin && <span style={{ fontSize: 12, fontWeight: 600, color: m.color, textTransform: "uppercase", letterSpacing: "0.08em" }}>Top reach</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
              <span style={{ flex: 1, height: 10, background: "#EEF1FB", borderRadius: 99, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${(r.avgReach / maxReach) * 100}%`, background: m.color, borderRadius: 99 }} /></span>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.heading, minWidth: 66, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(r.avgReach)}</span>
            </div>
            <div style={{ display: "flex", gap: 22, fontSize: 12 }}>
              <span style={{ color: C.muted }}>Avg reach per post</span>
              <span style={{ color: C.muted, marginLeft: "auto" }}>Avg reactions <b style={{ color: C.heading }}>{fmt(r.avgEng)}</b></span>
              <span style={{ color: C.muted }}>Engagement <b style={{ color: r.erPct >= 5 ? C.success : C.heading }}>{r.erPct.toFixed(1)}%</b></span>
            </div>
          </div>
        ); })}
      </div>
      {footer && <div style={{ marginTop: 12 }}>{footer}</div>}
    </Card>
  );
}

// Date-range filter shown on every tab: 7d / 30d / 60d / 90d / 1y / Custom.
function RangeFilter({ rangeKey, setRangeKey, custom, setCustom }: {
  rangeKey: RangeKey; setRangeKey: (k: RangeKey) => void;
  custom: { from: string; to: string }; setCustom: (c: { from: string; to: string }) => void;
}) {
  const OPTS: [RangeKey, string][] = [["7d", "7 days"], ["30d", "30 days"], ["60d", "60 days"], ["90d", "90 days"], ["1y", "1 year"], ["custom", "Custom"]];
  const inputStyle: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 8px", fontSize: 12, color: C.heading, outline: "none", fontFamily: "inherit" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div style={{ background: C.card, borderRadius: 12, boxShadow: SHADOW, padding: 6, display: "inline-flex", gap: 4 }}>
        {OPTS.map(([k, label]) => {
          const on = rangeKey === k;
          return (
            <button key={k} onClick={() => setRangeKey(k)}
              style={{ padding: "8px 14px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, background: on ? C.primary : "transparent", color: on ? "#fff" : C.muted, boxShadow: on ? "0 8px 18px rgba(58,87,232,0.28)" : "none", transition: "all .15s" }}>
              {label}
            </button>
          );
        })}
      </div>
      {rangeKey === "custom" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.card, borderRadius: 12, boxShadow: SHADOW, padding: "6px 10px" }}>
          {/* Capped at today — analytics can't report on a date that hasn't happened. */}
          <PreviewDatePicker size="sm" allowClear={false} value={custom.from}
            max={custom.to && custom.to < todayLocalISO() ? custom.to : todayLocalISO()}
            onChange={(v) => setCustom({ ...custom, from: clampToTodayISO(v) })} />
          <span style={{ color: C.muted, fontSize: 14 }}>→</span>
          <PreviewDatePicker size="sm" allowClear={false} value={custom.to}
            min={custom.from || undefined} max={todayLocalISO()}
            onChange={(v) => setCustom({ ...custom, to: clampToTodayISO(v) })} />
        </div>
      )}
    </div>
  );
}
function SectionHeader({ icon: Icon, title, sub }: { icon: typeof IconLayoutGrid; title: string; sub: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6, marginBottom: -8 }}>
      <span style={{ width: 38, height: 38, borderRadius: 10, background: C.chip, color: C.primary, display: "grid", placeItems: "center", flexShrink: 0 }}><Icon size={20} stroke={1.8} /></span>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.heading, letterSpacing: "-0.2px" }}>{title}</div>
        <div style={{ fontSize: 12, color: C.muted }}>{sub}</div>
      </div>
    </div>
  );
}
function StatCard({ label, value, delta, flat, detail, action, badge, est }: { label: string; value: string; delta: number | null; flat?: boolean; detail: string; action: string; badge?: string; est?: boolean }) {
  const hasDelta = !flat && typeof delta === "number";
  const dv = delta ?? 0;
  const up = dv >= 0;
  const pct = Math.min(100, Math.abs(dv) * 4 + 12);
  const R = 24, CIRC = 2 * Math.PI * R;
  const col = hasDelta ? (up ? C.success : C.danger) : C.primary;
  return (
    <div style={{ background: C.card, borderRadius: 14, boxShadow: SHADOW, padding: "18px", display: "flex", flexDirection: "column", gap: 12, minHeight: 168 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ position: "relative", width: 58, height: 58, flexShrink: 0 }}>
          <svg width="58" height="58" viewBox="0 0 58 58">
            <circle cx="29" cy="29" r={R} fill="none" stroke={C.line} strokeWidth="5" />
            <circle cx="29" cy="29" r={R} fill="none" stroke={col} strokeWidth="5" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - (hasDelta ? pct : 55) / 100)} transform="rotate(-90 29 29)" />
          </svg>
          <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: col }}>{hasDelta ? (up ? <IconArrowUpRight size={19} /> : <IconArrowDownRight size={19} />) : <IconChartLine size={18} />}</span>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
            {label}
            {est && <span title="Estimated from reach — Instagram doesn't expose this metric directly" style={{ fontSize: 12, fontWeight: 600, color: C.muted, background: C.bg, border: `1px solid ${C.line}`, padding: "1px 5px", borderRadius: 5, textTransform: "uppercase", letterSpacing: "0.04em", cursor: "help" }}>est</span>}
          </div>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.5px", lineHeight: 1.15 }}>{value}</div>
          {hasDelta
            ? <div style={{ fontSize: 12, fontWeight: 600, color: col }}>{up ? "▲" : "▼"} {Math.abs(dv).toFixed(1)}%</div>
            : badge ? <div style={{ display: "inline-block", marginTop: 3, fontSize: 12, fontWeight: 600, color: C.primary, background: "#EEF1FB", padding: "2px 8px", borderRadius: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>{badge}</div> : null}
        </div>
      </div>
      {detail && <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.4 }}>{detail}</div>}
      {action && <div style={{ marginTop: "auto", paddingTop: 10, borderTop: `1px dashed ${C.line}`, fontSize: 12, color: C.primary, lineHeight: 1.4 }}>{action}</div>}
    </div>
  );
}
function GenderDonut({ gender }: { gender: { label: string; value: number }[] }) {
  const total = Math.max(1, gender.reduce((s, g) => s + g.value, 0));
  const colors = GENDER_COLORS;
  let acc = 0;
  const R = 52, CIRC = 2 * Math.PI * R;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div style={{ position: "relative", width: 120, height: 120 }}>
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={R} fill="none" stroke={C.line} strokeWidth="14" />
          {gender.map((g, i) => {
            const frac = g.value / total; const dash = frac * CIRC; const off = -acc * CIRC; acc += frac;
            return <circle key={g.label} cx="60" cy="60" r={R} fill="none" stroke={colors[i % colors.length]} strokeWidth="14" strokeDasharray={`${dash} ${CIRC - dash}`} strokeDashoffset={off} transform="rotate(-90 60 60)" />;
          })}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
          <div><div style={{ fontSize: 19, fontWeight: 600 }}>{kfmt(total)}</div><div style={{ fontSize: 12, color: C.muted }}>reached</div></div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {gender.map((g, i) => (
          <div key={g.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: 99, background: colors[i % colors.length] }} />
            <span style={{ color: C.heading }}>{genderName(g.label)}</span>
            <span style={{ color: C.muted }}>{Math.round((g.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function AreaChart({ series, metric }: { series: Insights["series"]; metric: "reach" | "engagement" }) {
  const W = 1120, H = 220, PB = 26, PT = 12, PL = 8, PR = 8;
  const pts = (series || []).filter((s) => typeof s[metric] === "number");
  const color = metric === "reach" ? C.primary : C.teal;
  const label = metric === "reach" ? "Reach" : "Engagement";
  const [hover, setHover] = useState<number | null>(null);
  const { path, max } = useMemo(() => {
    if (pts.length < 2) return { path: { area: "", line: "" }, max: 1 };
    const max = Math.max(1, ...pts.map((p) => p[metric] || 0));
    const x = (i: number) => PL + (i / (pts.length - 1)) * (W - PL - PR);
    const y = (v: number) => PT + (1 - v / max) * (H - PT - PB);
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[metric] || 0).toFixed(1)}`).join(" ");
    const area = `${line} L${x(pts.length - 1).toFixed(1)},${H - PB} L${x(0).toFixed(1)},${H - PB} Z`;
    return { path: { area, line }, max };
  }, [pts, metric]);

  // Gridlines double as the y-scale, so include the top one (= max) and label
  // all five. Without numbers the line's height meant nothing absolute.
  const GRIDS = [0, 0.25, 0.5, 0.75, 1];
  const yPct = (g: number) => ((PT + g * (H - PT - PB)) / H) * 100;
  // Same mapping the line uses, so ticks and crosshair sit on the real points
  // rather than a plain 0–100% approximation that ignores the side padding.
  const xPct = (i: number) => (pts.length < 2 ? 50 : ((PL + (i / (pts.length - 1)) * (W - PL - PR)) / W) * 100);

  // ~6 dates across the axis. Short ranges (a week) label every day instead.
  const tickIdx = useMemo(() => {
    const n = pts.length;
    if (n === 0) return [];
    if (n <= 8) return pts.map((_, i) => i);
    const step = Math.ceil(n / 6);
    const out: number[] = [];
    for (let i = 0; i < n; i += step) out.push(i);
    if (out[out.length - 1] !== n - 1) out.push(n - 1);
    // Drop the penultimate tick when the forced last one would crowd it.
    if (out.length > 2 && n - 1 - out[out.length - 2] < step / 2) out.splice(out.length - 2, 1);
    return out;
  }, [pts]);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - r.left) / r.width;
    setHover(Math.max(0, Math.min(pts.length - 1, Math.round(frac * (pts.length - 1)))));
  };
  const hx = hover != null ? xPct(hover) : 0;
  // pts[hover] can be undefined for a beat when the data reloads (range/metric
  // switch) before setHover(null) fires — guard it, same as the crosshair below.
  const hy = hover != null && pts[hover] ? ((PT + (1 - (pts[hover][metric] || 0) / max) * (H - PT - PB)) / H) * 100 : 0;

  const AXIS_W = 46;

  return (
    <div>
      <div style={{ position: "relative", display: "flex" }}>
        {/* y-axis gutter — the labels are absolutely positioned over it so they
            line up with the gridlines drawn inside the SVG. */}
        <div style={{ width: AXIS_W, flex: "0 0 auto" }} />
        {GRIDS.map((g) => (
          <div key={g} style={{ position: "absolute", left: 0, top: `${yPct(g)}%`, width: AXIS_W - 8, textAlign: "right", transform: "translateY(-50%)", fontSize: 12, color: C.muted, fontVariantNumeric: "tabular-nums", pointerEvents: "none" }}>
            {kfmt(Math.round(max * (1 - g)))}
          </div>
        ))}

        <div style={{ position: "relative", flex: 1, minWidth: 0, cursor: "crosshair" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} preserveAspectRatio="none">
            <defs><linearGradient id="hpFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.28" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
            {GRIDS.map((g) => <line key={g} x1={PL} x2={W - PR} y1={PT + g * (H - PT - PB)} y2={PT + g * (H - PT - PB)} stroke={C.line} strokeWidth="1" />)}
            {path.area && <path d={path.area} fill="url(#hpFill)" />}
            {path.line && <path d={path.line} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
          </svg>
          {hover != null && pts[hover] && (
            <>
              <div style={{ position: "absolute", left: `${hx}%`, top: 0, bottom: 0, width: 1, background: "rgba(35,45,66,0.18)", transform: "translateX(-0.5px)", pointerEvents: "none" }} />
              <div style={{ position: "absolute", left: `${hx}%`, top: `${hy}%`, width: 11, height: 11, borderRadius: 99, background: color, border: "2.5px solid #fff", transform: "translate(-50%, -50%)", boxShadow: "0 2px 6px rgba(35,45,66,0.25)", pointerEvents: "none" }} />
              <div style={{ position: "absolute", left: `${hx}%`, top: 6, transform: hx > 62 ? "translateX(calc(-100% - 10px))" : "translateX(10px)", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: SHADOW, padding: "8px 11px", fontSize: 12, pointerEvents: "none", whiteSpace: "nowrap", zIndex: 2 }}>
                <div style={{ fontWeight: 600, color: C.heading, marginBottom: 3 }}>{pts[hover].date}</div>
                <div style={{ color: C.muted, display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: color }} /> {label} <b style={{ color: C.heading, marginLeft: 2 }}>{fmt(pts[hover][metric] || 0)}</b></div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* x-axis — placed at each point's true position, with the end labels
          pulled inside so they don't overhang the card. */}
      <div style={{ position: "relative", height: 16, marginLeft: AXIS_W }}>
        {tickIdx.map((i) => (
          <div key={i} style={{ position: "absolute", left: `${xPct(i)}%`, top: 0, fontSize: 12, color: C.muted, whiteSpace: "nowrap", transform: i === 0 ? "translateX(0)" : i === pts.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>
            {pts[i].date}
          </div>
        ))}
      </div>

      {/* The headline above is the period total; this line is per-day. Say so —
          otherwise a 5-lakh total over a chart peaking at 66K reads as a bug. */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 4, fontSize: 12, color: C.muted }}>
        {/* The engagement TOTAL is real, but Meta only gives it per window, so
            the daily line is that total spread across days by reach share. Say
            so rather than let it pass as measured per-day data. */}
        <span>{metric === "reach" ? "Daily reach" : "Daily engagement · total is exact, split across days by reach"}</span>
        <span>Hover any point for that day&rsquo;s figure</span>
      </div>
    </div>
  );
}
