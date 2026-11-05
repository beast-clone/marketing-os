"use client";
import { useEffect, useMemo, useState } from "react";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { LoadingBlock } from "@/components/LoadingBlock";
import { useApi } from "@/lib/use-api";
import { alertDialog, confirmDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";
import {
  IconSparkles, IconCopy, IconCheck, IconChevronDown, IconExternalLink, IconBrandInstagram, IconBrandYoutube, IconTrendingUp,
  IconTrophy, IconTargetArrow, IconUsers, IconAlertTriangle, IconPlus, IconX, IconTrash, IconBrandGoogle, IconSearch, IconHelpCircle, IconListSearch, IconPencil, IconInfoCircle, IconChartBar, IconArrowDown,
} from "@tabler/icons-react";

// SEO for Instagram & YouTube — doctors only. Replaces the old website/Google SEO tab.
//   1. Generate: paste a caption or script → keywords, hashtags, tags to copy.
//   2. Trending doctor keywords: what doctor-education accounts actually use, ranked.
//   3. Working for us / gaps: our best keywords, and ones competitors use that we don't.
//   4. Who we compare with.
// All numbers are real (lib/social-keywords.ts) — no invented search volumes.

type Platform = "instagram" | "youtube";
type Row = {
  keyword: string; kind: "hashtag" | "keyword"; platform: Platform; accounts: number; competitors: string[];
  posts: number; avgEngagement: number; oursPosts: number; oursAvgEngagement: number | null;
  oursList: { url: string; snippet: string; engagement: number; date?: string }[]; topic: string;
};
type Post = {
  url?: string; image?: string; caption: string; date?: string; engagement: number; keywords: string[];
  likes?: number; comments?: number; views?: number; reach?: number; saves?: number; shares?: number;
};
type Account = { platform: Platform; account: string; name?: string; followers?: number; analysed: number; error?: string; pic?: string; posts?: Post[]; custom?: boolean; stale?: string };
type Data = { instagram: Row[]; youtube: Row[]; accounts: Account[]; oursAvg: { instagram: number | null; youtube: number | null }; fetchedAt: string; error?: string };
type Gen = { platform: Platform; keywords: string[]; hashtags: string[]; tags?: string[]; titles?: string[]; error?: string };

const fmt = (n: number | null | undefined) => (n == null ? "—" : n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K` : n.toLocaleString("en-IN"));
const engLabel = (p: Platform) => (p === "youtube" ? "views per video" : "likes + comments per post");

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={async () => { if (await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 1500); } }}
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded border border-gray-200 text-[14px] text-[#4A5468] hover:border-brand hover:text-brand flex-shrink-0">
      {done ? <IconCheck size={15} stroke={2} className="text-[#2F9E6F]" /> : <IconCopy size={15} stroke={1.8} />}{done ? "Copied" : label}
    </button>
  );
}

// A keyword chip — click to copy just that one.
function Chip({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={async () => { if (await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 1200); } }} title="Click to copy"
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[14px] transition ${done ? "border-[#2F9E6F] text-[#2F9E6F] bg-[#E8F6F0]" : "border-gray-200 text-[#232D42] bg-white hover:border-brand"}`}>
      {done && <IconCheck size={13} stroke={2} />}{text}
    </button>
  );
}

function Card({ icon, title, sub, right, children }: { icon: React.ReactNode; title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-100 rounded-xl">
      <div className="flex items-start gap-3 px-4 py-3 border-b border-gray-100">
        <span className="w-8 h-8 rounded-lg bg-brand-light text-brand grid place-items-center flex-shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-medium text-[#232D42]">{title}</div>
          {sub && <div className="text-[12px] text-[#8A92A6] mt-0.5">{sub}</div>}
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function PlatformToggle({ value, onChange }: { value: Platform; onChange: (p: Platform) => void }) {
  return (
    <div className="inline-flex bg-[#F6F7FB] border border-gray-100 rounded p-0.5 gap-0.5">
      {(["instagram", "youtube"] as Platform[]).map((p) => (
        <button key={p} onClick={() => onChange(p)}
          className={`h-9 px-3 rounded text-[14px] font-medium inline-flex items-center gap-1.5 ${value === p ? "bg-white text-brand border border-gray-100" : "text-[#8A92A6] hover:text-[#232D42]"}`}>
          {p === "instagram" ? <IconBrandInstagram size={16} stroke={1.8} /> : <IconBrandYoutube size={16} stroke={1.8} />}
          {p === "instagram" ? "Instagram" : "YouTube"}
        </button>
      ))}
    </div>
  );
}

export default function SeoPage() {
  return (
    <PreviewDashboardShell active="seo" title="SEO" hideAccountPicker hideRange
      subtitle="Keywords and hashtags for Instagram and YouTube — for doctors, from our posts and our competitors'.">
      {() => <Inner />}
    </PreviewDashboardShell>
  );
}

function Inner() {
  const [key, setKey] = useState("/api/seo/social");
  const { data, error, isLoading } = useApi<Data>(key);
  const [platform, setPlatform] = useState<Platform>("instagram"); // ONE switch for the whole page
  const [tab, setTab] = useState<"keywords" | "ranking" | "google">("keywords");
  return (
    <div className="preview-scope space-y-4">
      {/* Tabs on the left; ONE Instagram/YouTube switch for everything below. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex bg-white border border-gray-100 rounded-xl p-1 gap-1">
          {([["keywords", "Keywords", <IconSparkles key="k" size={16} stroke={1.8} />], ["ranking", "Ranking", <IconChartBar key="r" size={16} stroke={1.8} />], ["google", "Google research", <IconBrandGoogle key="g" size={16} stroke={1.8} />]] as const).map(([k, label, icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`h-9 px-4 rounded-lg text-[14px] font-medium inline-flex items-center gap-1.5 ${tab === k ? "bg-brand-light text-brand" : "text-[#8A92A6] hover:text-[#232D42]"}`}>{icon}{label}</button>
          ))}
        </div>
        {tab !== "google" && <PlatformToggle value={platform} onChange={setPlatform} />}
      </div>
      {tab === "google" && <GoogleResearch />}
      {tab === "keywords" && <Generator platform={platform} />}
      {tab === "google" ? null : error ? (
        <div className="bg-white border border-gray-100 rounded-xl p-6 text-[14px] text-rose-600">Couldn&apos;t load keyword data: {error.message}</div>
      ) : !data ? (
        <div className="bg-white border border-gray-100 rounded-xl p-6"><LoadingBlock label={isLoading ? "Reading our posts and 9 competitors' — this takes a moment the first time…" : undefined} /></div>
      ) : tab === "ranking" ? <Ranking data={data} platform={platform} /> : (
        <>
          <Competitors data={data} platform={platform} updating={isLoading} onRefresh={() => setKey(`/api/seo/social?fresh=1&t=${Date.now()}`)} />
          {/* Topics on the left; what works for us + gaps beside them, so nothing sits far below. */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
            <Trending data={data} platform={platform} />
            <OursAndGaps data={data} platform={platform} />
          </div>
        </>
      )}
    </div>
  );
}

// ── 1. Generate ────────────────────────────────────────────────────────────
function Generator({ platform }: { platform: Platform }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Gen | null>(null);
  useEffect(() => { setOut(null); }, [platform]);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null); setOut(null);
    try {
      const r = await fetch("/api/seo/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform, text }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || "Couldn't generate keywords."); return; }
      setOut(j);
    } catch { setErr("Lost connection — try again."); } finally { setBusy(false); }
  };
  const groups: { label: string; items: string[]; join: string }[] = out ? [
    ...(out.titles?.length ? [{ label: "Title ideas", items: out.titles, join: "\n" }] : []),
    { label: platform === "youtube" ? "Search keywords" : "Keywords to use in the caption", items: out.keywords, join: ", " },
    ...(out.tags?.length ? [{ label: "YouTube tags", items: out.tags, join: ", " }] : []),
    { label: "Hashtags", items: out.hashtags, join: " " },
  ].filter((g) => g.items.length) : [];
  return (
    <Card icon={<IconSparkles size={17} stroke={1.8} />} title="Generate keywords"
      sub="Paste an Instagram caption or a YouTube script — get keywords and hashtags to copy into the post.">
      <Explainer>
        <b className="font-medium">AI suggestions for one post.</b> Paste the caption or script you&apos;re writing and get keywords and hashtags for it
        {" "}(about half a cent each). For the keywords doctor accounts <i>actually use</i>, see <b className="font-medium">Keywords by topic</b> below.
      </Explainer>
      {/* Caption on the left, results on the right. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="flex flex-col">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12}
            placeholder={platform === "youtube" ? "Paste the video script or description…" : "Paste the post caption…"}
            className="w-full flex-1 min-h-[260px] rounded border border-gray-200 px-3 py-2 text-[14px] outline-none focus:border-brand resize-y" />
          <div className="flex items-center gap-3 mt-3">
            <button onClick={run} disabled={busy || text.trim().length < 20}
              className="h-9 px-4 rounded bg-brand text-white text-[14px] font-medium inline-flex items-center gap-1.5 hover:brightness-110 disabled:opacity-40 flex-shrink-0">
              <IconSparkles size={16} stroke={1.8} />{busy ? "Generating…" : "Generate keywords"}
            </button>
            <span className="text-[12px] text-[#8A92A6]">Uses what&apos;s working on doctor-education {platform === "youtube" ? "YouTube" : "Instagram"} today.</span>
          </div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-[#F6F7FB] p-4 min-h-[260px]">
          {err ? <div className="rounded bg-[#FDECEA] text-[#8a2e28] text-[14px] px-3 py-2">{err}</div>
            : busy ? <div className="h-full grid place-items-center text-[14px] text-[#8A92A6]">Generating keywords…</div>
            : groups.length === 0 ? (
              <div className="h-full grid place-items-center text-center text-[14px] text-[#8A92A6] px-6">
                <div><IconSparkles size={22} stroke={1.6} className="mx-auto mb-2 text-brand" />Paste a {platform === "youtube" ? "script" : "caption"} on the left and press Generate — keywords{platform === "youtube" ? ", tags and title ideas" : " and hashtags"} show up here.</div>
              </div>
            ) : (
              <div className="space-y-4">
                {groups.map((g) => (
                  <div key={g.label}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[12px] font-medium text-[#8A92A6] uppercase tracking-wide">{g.label}</div>
                      <CopyButton text={g.items.join(g.join)} label="Copy all" />
                    </div>
                    <div className="flex flex-wrap gap-2">{g.items.map((x) => <Chip key={x} text={x} />)}</div>
                  </div>
                ))}
                <div className="text-[12px] text-[#8A92A6]">Click any chip to copy just that one.</div>
              </div>
            )}
        </div>
      </div>
    </Card>
  );
}

// ── 2. Doctor keywords by topic ────────────────────────────────────────────
// Grouped so a whole topic can be copied in one go; tap chips to build your own set.
// Hashtags copy space-separated (ready for a caption), keywords comma-separated.
const joinForPost = (ks: string[]) => {
  const tags = ks.filter((k) => k.startsWith("#")), words = ks.filter((k) => !k.startsWith("#"));
  return [words.join(", "), tags.join(" ")].filter(Boolean).join("\n\n");
};
const TOPIC_ORDER = ["NEET PG & INI-CET", "FMGE & NExT", "UK — PLAB, GMC, NHS", "Australia — AMC, AHPRA", "USA — USMLE", "Gulf — DHA, HAAD, Prometric", "English tests — OET, IELTS", "Working abroad", "General medical"];

// A short "what is this / how is it different" line at the top of a section.
function Explainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-brand-light px-3 py-2 mb-4 text-[13px] text-[#232D42]">
      <IconInfoCircle size={16} stroke={1.8} className="text-brand flex-shrink-0 mt-px" /><div>{children}</div>
    </div>
  );
}

type Topic = { id: string; name: string; words: string[]; suggestions?: { instagram?: string[]; youtube?: string[] } };
const matchesTopic = (keyword: string, t: Topic) => { const k = keyword.toLowerCase().replace(/^#/, ""); return t.words.some((w) => k.includes(w)); };

// Add / edit a custom topic: a name + the words that identify it.
function TopicForm({ initial, onDone }: { initial?: Topic; onDone: (saved: boolean) => void }) {
  const [name, setName] = useState(initial?.name || "");
  const [words, setWords] = useState(initial?.words.join(", ") || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    const r = await fetch("/api/seo/topics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: initial?.id, name, words }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!r.ok) { setErr(j.error || "Couldn't save it."); return; }
    onDone(true);
  };
  return (
    <div className="rounded-lg border border-brand p-3 flex flex-col gap-2.5">
      <div className="text-[14px] font-medium text-[#232D42]">{initial ? "Edit topic" : "New topic"}</div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr] gap-2.5">
        <label className="flex flex-col gap-1 text-[12px] text-[#8A92A6]">Topic name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ireland — IMC" className="h-9 px-2.5 rounded border border-gray-200 text-[14px] text-[#232D42] outline-none focus:border-brand" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[#8A92A6]">Words that identify it (comma-separated)
          <input value={words} onChange={(e) => setWords(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} placeholder="e.g. ireland, irish, imc" className="h-9 px-2.5 rounded border border-gray-200 text-[14px] text-[#232D42] outline-none focus:border-brand" />
        </label>
      </div>
      <div className="text-[12px] text-[#8A92A6]">Any tracked keyword or hashtag containing one of these words goes in this group — e.g. &ldquo;ireland&rdquo; picks up #irelanddoctors.</div>
      {err && <div className="text-[12px] text-rose-600">{err}</div>}
      <div className="flex items-center gap-2 justify-end">
        <button onClick={() => onDone(false)} className="h-8 px-3 rounded text-[13px] text-[#8A92A6] hover:text-[#232D42]">Cancel</button>
        <button onClick={save} disabled={busy || !name.trim() || !words.trim()} className="h-8 px-3 rounded bg-brand text-white text-[13px] disabled:opacity-50">{busy ? "Saving…" : "Save topic"}</button>
      </div>
    </div>
  );
}

function Trending({ data, platform }: { data: Data; platform: Platform }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]); // groups showing all keywords, not just the top 8
  useEffect(() => { setPicked([]); setOpen(null); setExpanded([]); }, [platform]);
  const tracked = data.accounts.filter((a) => a.platform === platform && a.analysed > 0).length;
  const topicsApi = useApi<{ topics: Topic[] }>("/api/seo/topics");
  const custom = useMemo(() => topicsApi.data?.topics || [], [topicsApi.data]);
  const [editing, setEditing] = useState<Topic | "new" | null>(null);
  const [suggesting, setSuggesting] = useState("");
  const [topicErr, setTopicErr] = useState("");
  // The team's own topics first, then the built-in ones.
  const groups = useMemo(() => {
    const g = new Map<string, Row[]>();
    for (const r of data[platform]) g.set(r.topic, [...(g.get(r.topic) || []), r]);
    return [
      ...custom.map((t) => ({ topic: t.name, rows: data[platform].filter((r) => matchesTopic(r.keyword, t)).slice(0, 20), custom: t as Topic | undefined })),
      ...TOPIC_ORDER.filter((t) => g.has(t)).map((t) => ({ topic: t, rows: g.get(t)!.slice(0, 20), custom: undefined as Topic | undefined })),
    ];
  }, [data, platform, custom]);
  const removeTopic = async (t: Topic) => {
    if (!(await confirmDialog({ title: `Delete the topic "${t.name}"?`, body: "Its group and any AI suggestions saved on it are removed for everyone. The keywords themselves stay in the other groups.", action: "Delete topic", danger: true }))) return;
    await fetch("/api/seo/topics", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id }) });
    topicsApi.refresh();
  };
  const suggest = async (t: Topic) => {
    setSuggesting(t.id); setTopicErr("");
    const r = await fetch("/api/seo/topics/suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, platform }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    setSuggesting("");
    if (!r.ok) setTopicErr(j.error || "Couldn't get suggestions.");
    topicsApi.refresh();
  };
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  return (
    <Card icon={<IconTrendingUp size={17} stroke={1.8} />} title="Keywords by topic"
      sub="Grouped by topic, best first (more accounts using it, better-performing posts). Copy a whole group, or tap keywords to build your own set.">
      {/* Selection bar — stays visible while picking across groups */}
      <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-4 px-4 py-2 bg-white border-b border-gray-100 flex items-center gap-3 flex-wrap">
        <span className="text-[14px] text-[#232D42]">{picked.length ? <><b className="font-medium">{picked.length}</b> selected</> : <span className="text-[#8A92A6]">Tap keywords below to select them</span>}</span>
        {picked.length > 0 && <button onClick={() => setPicked([])} className="text-[12px] text-[#8A92A6] hover:text-[#232D42]">Clear</button>}
        <span className="ml-auto">{picked.length > 0 && <CopyButton text={joinForPost(picked)} label={`Copy selected (${picked.length})`} />}</span>
      </div>
      <Explainer>
        <b className="font-medium">Real keywords, no AI.</b> Counted from the latest posts of the {tracked} accounts we track and updated daily — best first.
        {" "}Different from <b className="font-medium">Generate keywords</b> above, which uses AI to suggest keywords for one caption you paste.
        {" "}Add your own topic to group the keywords you care about.
      </Explainer>
      <div className="space-y-4">
        {editing === "new" ? <TopicForm onDone={(ok) => { setEditing(null); if (ok) topicsApi.refresh(); }} /> : (
          <button onClick={() => setEditing("new")} className="w-full flex items-center justify-center gap-1.5 h-10 rounded-lg border border-dashed border-gray-300 text-[14px] text-[#4A5468] hover:border-brand hover:text-brand">
            <IconPlus size={15} stroke={2} />Add topic
          </button>
        )}
        {topicErr && <div className="rounded bg-[#FDECEA] text-[#8a2e28] text-[14px] px-3 py-2">{topicErr}</div>}
        {groups.map(({ topic, rows, custom: ct }) => ct && editing !== "new" && editing?.id === ct.id
          ? <TopicForm key={ct.id} initial={ct} onDone={(ok) => { setEditing(null); if (ok) topicsApi.refresh(); }} />
          : (
          <div key={ct ? `c:${ct.id}` : topic} className={`rounded-lg border ${ct ? "border-brand/40" : "border-gray-100"}`}>
            <div className="flex items-center gap-3 px-3 py-2 bg-[#F6F7FB] border-b border-gray-100 rounded-t-lg">
              <span className="text-[14px] font-medium text-[#232D42]">{topic}</span>
              <span className="text-[12px] text-[#8A92A6]">{rows.length}</span>
              {ct && <span className="px-1.5 py-px rounded bg-brand-light text-brand text-[11px]">Custom · {ct.words.join(", ")}</span>}
              {ct && (
                <span className="flex items-center gap-0.5">
                  <button title="Edit topic" onClick={() => setEditing(ct)} className="w-7 h-7 grid place-items-center rounded text-[#8A92A6] hover:text-brand hover:bg-white"><IconPencil size={14} stroke={1.8} /></button>
                  <button title="Delete topic" onClick={() => removeTopic(ct)} className="w-7 h-7 grid place-items-center rounded text-[#8A92A6] hover:text-rose-600 hover:bg-white"><IconTrash size={14} stroke={1.8} /></button>
                </span>
              )}
              {rows.length > 0 ? <>
                <button onClick={() => setOpen(open === topic ? null : topic)} className="ml-auto text-[12px] text-brand inline-flex items-center gap-1 hover:underline">
                  {open === topic ? "Hide details" : "Show details"}<IconChevronDown size={14} className={open === topic ? "rotate-180" : ""} />
                </button>
                <CopyButton text={joinForPost(rows.map((r) => r.keyword))} label="Copy all" />
              </> : <span className="ml-auto" />}
            </div>
            {rows.length === 0 && <div className="px-3 pt-3 text-[13px] text-[#8A92A6]">None of the accounts we track use these words on {platform === "youtube" ? "YouTube" : "Instagram"} yet — ask AI for suggestions below.</div>}
            <div className="p-3 flex flex-wrap gap-2">
              {(expanded.includes(topic) || open === topic ? rows : rows.slice(0, 8)).map((r) => {
                const on = picked.includes(r.keyword);
                return (
                  <button key={r.keyword} onClick={() => toggle(r.keyword)}
                    title={`${r.accounts} account${r.accounts === 1 ? "" : "s"} · avg ${fmt(r.avgEngagement)} ${engLabel(platform)}${r.oursPosts ? ` · we used it in ${r.oursPosts}` : " · we haven't used it"}`}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[14px] transition ${on ? "border-brand bg-brand-light text-brand" : "border-gray-200 bg-white text-[#232D42] hover:border-brand"}`}>
                    {on && <IconCheck size={13} stroke={2.2} />}{r.keyword}
                    {!r.oursPosts && <span className="w-1.5 h-1.5 rounded-full bg-[#B7791F]" title="We haven't used this yet" />}
                  </button>
                );
              })}
              {rows.length > 8 && open !== topic && (
                <button onClick={() => setExpanded((e) => (e.includes(topic) ? e.filter((t) => t !== topic) : [...e, topic]))}
                  className="px-2.5 py-1 rounded text-[13px] text-brand hover:underline">
                  {expanded.includes(topic) ? "Show less" : `Show all ${rows.length}`}
                </button>
              )}
            </div>
            {/* Custom topics: AI suggestions, kept on the topic once asked for. */}
            {ct && (() => {
              const sugg = ct.suggestions?.[platform];
              return (
                <div className="mx-3 mb-3 rounded-lg bg-[#F6F7FB] px-3 py-2.5">
                  {sugg?.length ? (
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        <IconSparkles size={14} stroke={1.8} className="text-brand" />
                        <span className="text-[12px] font-medium text-[#8A92A6] uppercase tracking-wide">Suggested by AI</span>
                        <span className="text-[12px] text-[#8A92A6]">— not from real posts</span>
                        <span className="ml-auto flex items-center gap-2">
                          <button onClick={() => suggest(ct)} disabled={suggesting === ct.id} className="text-[12px] text-brand hover:underline disabled:opacity-50">{suggesting === ct.id ? "Suggesting…" : "Suggest again"}</button>
                          <CopyButton text={joinForPost(sugg)} label="Copy all" />
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">{sugg.map((x) => <Chip key={x} text={x} />)}</div>
                    </>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] text-[#8A92A6]">Want more for this topic?</span>
                      <button onClick={() => suggest(ct)} disabled={suggesting === ct.id}
                        className="ml-auto h-8 px-3 rounded bg-brand text-white text-[13px] inline-flex items-center gap-1.5 disabled:opacity-50">
                        <IconSparkles size={14} stroke={1.8} />{suggesting === ct.id ? "Suggesting…" : "Suggest keywords with AI"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
            {open === topic && (
              <div className="border-t border-gray-100 overflow-x-auto">
                <table className="w-full text-[14px]">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-[#8A92A6]">
                      <th className="px-3 py-2 font-normal">Keyword</th>
                      <th className="px-3 py-2 font-normal">Which accounts use it</th>
                      <th className="px-3 py-2 font-normal text-right">Avg {platform === "youtube" ? "views" : "engagement"}</th>
                      <th className="px-3 py-2 font-normal">Our posts using it <span className="text-[12px]">(hover for the caption, click to open)</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.keyword} className="border-t border-gray-50 align-top">
                        <td className="px-3 py-2 text-[#232D42] font-medium whitespace-nowrap">{r.keyword}</td>
                        <td className="px-3 py-2">
                          {r.competitors.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {r.competitors.map((c) => (
                                <a key={c} href={platform === "youtube" ? `https://www.youtube.com/@${c}` : `https://www.instagram.com/${c}/`} target="_blank" rel="noreferrer"
                                  className="px-2 py-0.5 rounded-full bg-[#F6F7FB] border border-gray-100 text-[12px] text-[#4A5468] hover:border-brand hover:text-brand">@{c}</a>
                              ))}
                            </div>
                          ) : <span className="text-[12px] text-[#8A92A6]">Only us</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.avgEngagement)}</td>
                        <td className="px-3 py-2">
                          {r.oursList.length === 0 ? <span className="text-[12px] px-2 py-0.5 rounded bg-[#FDF6E7] text-[#B7791F]">Not used yet</span> : (
                            // One button per post: date + engagement, opens the post; the
                            // caption's opening line is the tooltip, not row clutter.
                            <div className="flex flex-wrap gap-1.5">
                              {r.oursList.slice(0, 4).map((p) => (
                                <a key={p.url} href={p.url} target="_blank" rel="noreferrer" title={`${p.snippet}…`}
                                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded border border-gray-200 bg-white text-[12px] text-[#232D42] hover:border-brand hover:text-brand">
                                  {p.date ? new Date(p.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "Post"}
                                  <span className="text-[#8A92A6]">· {fmt(p.engagement)} {platform === "youtube" ? "views" : "eng."}</span>
                                  <IconExternalLink size={12} stroke={1.8} className="text-[#8A92A6]" />
                                </a>
                              ))}
                              {r.oursPosts > 4 && <span className="inline-flex items-center h-7 px-2.5 rounded bg-[#F6F7FB] text-[12px] text-[#8A92A6]">+{r.oursPosts - 4} more</span>}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="text-[12px] text-[#8A92A6] mt-3 inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#B7791F]" />= we haven&apos;t used it yet. Hover a keyword for its numbers.</div>
    </Card>
  );
}

// ── 3. Working for us + gaps ───────────────────────────────────────────────
function OursAndGaps({ data, platform }: { data: Data; platform: Platform }) {
  const rows = data[platform];
  const ourAvg = data.oursAvg[platform];
  const best = useMemo(() => rows.filter((r) => r.oursPosts >= 2 && r.oursAvgEngagement != null)
    .sort((a, b) => (b.oursAvgEngagement || 0) - (a.oursAvgEngagement || 0)).slice(0, 8), [rows]);
  const gaps = useMemo(() => rows.filter((r) => r.oursPosts === 0 && r.competitors.length >= 3).slice(0, 12), [rows]);
  return (
    <div className="flex flex-col gap-4">
      <Card icon={<IconTrophy size={17} stroke={1.8} />} title="What works for us"
        sub={`${platform === "youtube" ? "YouTube" : "Instagram"}: our keywords by how our posts using them perform. Our average: ${fmt(ourAvg)} ${engLabel(platform)}.`}>
        {best.length === 0 ? <div className="text-[14px] text-[#8A92A6]">Not enough of our posts share a keyword yet.</div> : (
          <ul className="space-y-2">
            {best.map((r) => {
              const above = ourAvg != null && (r.oursAvgEngagement || 0) > ourAvg;
              return (
                <li key={r.keyword} className="flex items-center gap-3">
                  <span className="flex-1 min-w-0 truncate text-[14px] text-[#232D42]">{r.keyword}</span>
                  <span className="text-[12px] text-[#8A92A6]">{r.oursPosts} posts</span>
                  <span className={`text-[14px] tabular-nums ${above ? "text-[#2F9E6F]" : "text-[#8A92A6]"}`}>{fmt(r.oursAvgEngagement)}</span>
                  <CopyButton text={r.keyword} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card icon={<IconTargetArrow size={17} stroke={1.8} />} title="Gaps to try"
        sub="Used by 3+ competitors, never by us. Worth adding where they fit the post.">
        {gaps.length === 0 ? <div className="text-[14px] text-[#8A92A6]">No gaps right now — we use everything competitors do.</div> : (
          <>
            <div className="flex flex-wrap gap-2">{gaps.map((r) => <Chip key={r.keyword} text={r.keyword} />)}</div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-[12px] text-[#8A92A6]">Click a chip to copy one.</span>
              <CopyButton text={gaps.map((r) => r.keyword).join(" ")} label="Copy all" />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// ── 4. Who we compare with ─────────────────────────────────────────────────
// Left: the accounts. Right: the picked one's profile, every keyword it used (copy
// one or all; click to show only the posts using it) and its posts in a grid.
// Instagram caps how often other accounts can be read per hour; say so plainly.
const limitHit = (m?: string) => !!m && /request limit|\(#4\)/i.test(m);
const readError = (m: string) => (limitHit(m) ? "Instagram's hourly limit for reading other accounts is used up. It resets within an hour — try again then." : m);
const handleOf = (a: Account) => a.account.replace(/^@/, "");
const profileUrl = (a: Account) => (a.platform === "youtube" ? `https://www.youtube.com/@${handleOf(a)}` : `https://www.instagram.com/${handleOf(a)}/`);
const PlatformIcon = ({ p, size = 18 }: { p: Platform; size?: number }) =>
  p === "instagram" ? <IconBrandInstagram size={size} stroke={1.8} className="text-[#8A92A6] flex-shrink-0" /> : <IconBrandYoutube size={size} stroke={1.8} className="text-[#8A92A6] flex-shrink-0" />;

function Competitors({ data, platform, updating, onRefresh }: { data: Data; platform: Platform; updating: boolean; onRefresh: () => void }) {
  const when = new Date(data.fetchedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const list = data.accounts.filter((a) => a.platform === platform);
  const isOurs = (a: Account) => handleOf(a).toLowerCase() === "goocampus";
  const ourAcc = list.find(isOurs), others = list.filter((a) => !isOurs(a));
  const ourKws = useMemo(() => new Set((ourAcc?.posts || []).flatMap((p) => p.keywords.map((k) => k.toLowerCase()))), [ourAcc]);
  const [sel, setSel] = useState("");
  const picked = list.find((a) => `${a.platform}:${a.account}` === sel) || list[0];
  const remove = async (a: Account) => {
    if (!(await confirmDialog({ title: `Stop tracking @${handleOf(a)}?`, body: "Its posts drop out of the keyword counts for everyone. You can add it back any time.", action: "Remove", danger: true }))) return;
    const r = await fetch("/api/seo/accounts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: a.platform, handle: a.account }) });
    if (r.ok) onRefresh();
    else alertDialog("Couldn't remove it", ((await r.json().catch(() => ({}))) as { error?: string }).error || "Try again.");
  };
  return (
    <Card icon={<IconUsers size={17} stroke={1.8} />} title="Accounts we compare with"
      sub={`Our account and the doctor-education accounts we compare with — latest 40 posts each. Click one to see its keywords and posts. Updated ${when}; refreshes by itself daily.`}>
      {/* Re-reading every account takes ~a minute; the old list stays up meanwhile. */}
      {updating && (
        <div className="mb-3 flex items-center gap-2 rounded bg-brand-light px-3 py-2 text-[13px] text-brand">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-brand border-t-transparent animate-spin" />
          Reading the accounts again — this takes about a minute. Changes appear here when it&apos;s done.
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        <div className="flex flex-col gap-1.5 lg:max-h-[860px] lg:overflow-y-auto lg:pr-1">
          <div className="text-[12px] font-medium text-[#8A92A6] uppercase tracking-wide px-1">Our account</div>
          {[ourAcc, "divider" as const, ...others].map((a) => {
            if (a === "divider") return (
              <div key="divider" className="flex flex-col gap-1.5 mt-3">
                <div className="text-[12px] font-medium text-[#8A92A6] uppercase tracking-wide px-1">Compared with ({others.length})</div>
                <AddAccount platform={platform} onAdded={(h) => { setSel(`${platform}:${h}`); onRefresh(); }} />
              </div>
            );
            if (!a) return null;
            const key = `${a.platform}:${a.account}`, on = picked && key === `${picked.platform}:${picked.account}`;
            const ours = isOurs(a);
            return (
              <div key={key} role="button" tabIndex={0} onClick={() => setSel(key)} onKeyDown={(e) => { if (e.key === "Enter") setSel(key); }}
                className={`group flex items-center gap-3 rounded border px-3 py-2 text-left transition cursor-pointer ${on ? "border-brand bg-brand-light" : "border-gray-100 hover:border-gray-300"}`}>
                {a.pic ? <img src={a.pic} alt="" referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover bg-[#F6F7FB] flex-shrink-0" loading="lazy" decoding="async" /> : <span className="w-8 h-8 rounded-full bg-[#F6F7FB] grid place-items-center flex-shrink-0"><PlatformIcon p={a.platform} size={16} /></span>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[14px] text-[#232D42] truncate">{a.name || handleOf(a)}</span>
                    {ours && <span className="px-1.5 py-px rounded bg-brand text-white text-[11px] flex-shrink-0">Us</span>}
                    {a.custom && <span className="px-1.5 py-px rounded bg-[#F6F7FB] border border-gray-200 text-[#8A92A6] text-[11px] flex-shrink-0">Added</span>}
                  </div>
                  <div className="text-[12px] text-[#8A92A6] truncate">{a.followers != null ? `${fmt(a.followers)} ${a.platform === "youtube" ? "subs" : "followers"} · ` : ""}{a.analysed} posts</div>
                </div>
                {a.error
                  ? <span className="text-[12px] text-rose-600 inline-flex items-center gap-1" title={a.error}><IconAlertTriangle size={14} stroke={1.8} />{limitHit(a.error) ? "Try later" : "Couldn\u2019t read"}</span>
                  : null}
                {!ours && (
                  <button title="Stop tracking this account" onClick={(e) => { e.stopPropagation(); remove(a); }}
                    className="w-6 h-6 -mr-1 grid place-items-center rounded text-[#8A92A6] hover:text-rose-600 hover:bg-rose-50 flex-shrink-0"><IconX size={14} stroke={2} /></button>
                )}
              </div>
            );
          })}
        </div>
        {picked && <AccountDetail key={`${picked.platform}:${picked.account}`} a={picked} ours={isOurs(picked)} ourKws={ourKws}
          onRemove={isOurs(picked) ? undefined : () => remove(picked)} />}
      </div>
    </Card>
  );
}

// "+ Add account": type a handle (or name, on YouTube) → pick the matching account
// from the dropdown to confirm it's the right one → it's saved and read.
type Match = { handle: string; name: string; pic?: string; followers?: number; posts?: number };
function AddAccount({ platform, onAdded }: { platform: Platform; onAdded: (handle: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null); // null = not searched yet
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const yt = platform === "youtube";
  const term = q.trim().replace(/^@/, "");
  const lookup = async (t: string) => {
    setSearching(true);
    const r = await fetch(`/api/seo/accounts?platform=${platform}&q=${encodeURIComponent(t)}`);
    const j = (await r.json().catch(() => ({}))) as { matches?: Match[]; error?: string };
    setMatches(j.matches || []); setErr(j.error ? readError(j.error) : ""); setSearching(false);
  };
  // YouTube searches as they type. Instagram only on Enter / "Look up": every
  // Instagram lookup counts against its tight hourly limit, so no half-typed names.
  useEffect(() => {
    setMatches(null); setErr("");
    if (!yt || term.length < 3) return;
    const t = setTimeout(() => lookup(term), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, yt]);
  const add = async (m: Match) => {
    setBusy(m.handle); setErr("");
    const r = await fetch("/api/seo/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform, handle: m.handle }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    setBusy("");
    if (!r.ok) { setErr(j.error || "Couldn't add it."); return; }
    setQ(""); setMatches(null); setOpen(false); onAdded(m.handle);
  };
  const close = () => { setOpen(false); setQ(""); setMatches(null); setErr(""); };
  if (!open) return (
    <button onClick={() => setOpen(true)} className="flex items-center justify-center gap-1.5 h-10 rounded border border-dashed border-gray-300 text-[14px] text-[#4A5468] hover:border-brand hover:text-brand">
      <IconPlus size={15} stroke={2} />Add {yt ? "YouTube channel" : "Instagram account"}
    </button>
  );
  return (
    <div className="rounded border border-brand p-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <PlatformIcon p={platform} size={16} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") close(); if (e.key === "Enter") { if (matches?.length === 1) add(matches[0]); else if (!yt && term.length >= 3) lookup(term); } }}
          placeholder={yt ? "Channel name or @handle" : "Exact username, e.g. academically.global"} className="flex-1 min-w-0 h-9 px-2.5 rounded border border-gray-200 text-[14px] outline-none focus:border-brand" />
        {!yt && <button onClick={() => lookup(term)} disabled={term.length < 3 || searching} className="h-9 px-3 rounded bg-brand text-white text-[13px] disabled:opacity-50 flex-shrink-0">Look up</button>}
        <button onClick={close} title="Cancel" className="w-7 h-7 grid place-items-center rounded text-[#8A92A6] hover:text-[#232D42]"><IconX size={15} stroke={2} /></button>
      </div>
      {(searching || matches !== null || err) && (
        <div className="rounded border border-gray-100 bg-white divide-y divide-gray-50 max-h-[260px] overflow-y-auto">
          {searching ? <div className="px-3 py-2 text-[13px] text-[#8A92A6]">Looking up…</div>
            : err ? <div className="px-3 py-2 text-[12px] text-rose-600">{err}</div>
            : !matches?.length ? <div className="px-3 py-2 text-[12px] text-[#8A92A6]">{yt ? "No channels found." : `No business or creator account called @${q.trim().replace(/^@/, "")}. Instagram needs the exact username, and personal accounts can't be read.`}</div>
            : matches.map((m) => (
              <button key={m.handle} onClick={() => add(m)} disabled={!!busy} className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left hover:bg-brand-light disabled:opacity-60">
                {m.pic ? <img src={m.pic} alt="" referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover bg-[#F6F7FB] flex-shrink-0" loading="lazy" decoding="async" /> : <span className="w-8 h-8 rounded-full bg-[#F6F7FB] flex-shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] text-[#232D42] truncate">{m.name}</span>
                  <span className="block text-[12px] text-[#8A92A6] truncate">@{m.handle}{m.followers != null ? ` · ${fmt(m.followers)} ${yt ? "subs" : "followers"}` : ""}{m.posts != null ? ` · ${fmt(m.posts)} ${yt ? "videos" : "posts"}` : ""}</span>
                </span>
                <span className="text-[12px] text-brand flex-shrink-0">{busy === m.handle ? "Adding…" : "Add"}</span>
              </button>
            ))}
        </div>
      )}
      {!yt && matches === null && !searching && !err && <div className="text-[12px] text-[#8A92A6]">Type the exact username and press Look up — Instagram only finds business or creator accounts.</div>}
    </div>
  );
}

function AccountDetail({ a, ours, ourKws, onRemove }: { a: Account; ours: boolean; ourKws: Set<string>; onRemove?: () => void }) {
  const posts = useMemo(() => a.posts || [], [a]);
  const [only, setOnly] = useState<string | null>(null);
  const [showPosts, setShowPosts] = useState(true);
  // Every keyword this account used, most-used first.
  const kws = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of posts) for (const k of p.keywords) m.set(k, (m.get(k) || 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  }, [posts]);
  const notOurs = ours ? [] : kws.filter(([k]) => !ourKws.has(k.toLowerCase())).map(([k]) => k);
  const shown = only ? posts.filter((p) => p.keywords.includes(only)) : posts;
  const unit = a.platform === "youtube" ? "views" : "eng.";
  return (
    <div className="min-w-0 flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-xl bg-brand-light px-4 py-3">
        {a.pic ? <img src={a.pic} alt="" referrerPolicy="no-referrer" className="w-12 h-12 rounded-full object-cover bg-white flex-shrink-0" loading="lazy" decoding="async" /> : <span className="w-12 h-12 rounded-full bg-white grid place-items-center flex-shrink-0"><PlatformIcon p={a.platform} size={22} /></span>}
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-medium text-[#232D42] truncate">{a.name || handleOf(a)}</div>
          <div className="text-[13px] text-[#4A5468] truncate">
            @{handleOf(a)} · {a.platform === "youtube" ? "YouTube" : "Instagram"}
            {a.followers != null ? ` · ${fmt(a.followers)} ${a.platform === "youtube" ? "subscribers" : "followers"}` : ""} · {posts.length} {a.platform === "youtube" ? "videos" : "posts"} read
          </div>
        </div>
        <a href={profileUrl(a)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-9 px-3 rounded border border-gray-200 bg-white text-[14px] text-[#4A5468] hover:border-brand hover:text-brand flex-shrink-0">
          Open profile<IconExternalLink size={14} stroke={1.8} />
        </a>
        {onRemove && (
          <button onClick={onRemove} className="inline-flex items-center gap-1.5 h-9 px-3 rounded border border-gray-200 bg-white text-[14px] text-[#4A5468] hover:border-rose-300 hover:text-rose-600 flex-shrink-0">
            <IconTrash size={14} stroke={1.8} />Remove
          </button>
        )}
      </div>

      {a.stale && <div className="text-[12px] text-[#B7791F] bg-[#FDF6E7] rounded px-3 py-1.5">Couldn&apos;t refresh just now — showing the last read. {limitHit(a.stale) ? "Instagram's hourly limit is used up; it resets within an hour." : a.stale}</div>}
      {a.error ? <div className="text-[14px] text-[#B7791F] bg-[#FDF6E7] rounded px-3 py-2">Couldn&apos;t read this account. {readError(a.error)}</div> : (
        <>
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="text-[14px] font-medium text-[#232D42]">Keywords used <span className="text-[#8A92A6] font-normal">({kws.length})</span></div>
              <span className="text-[12px] text-[#8A92A6]">Click one to show only its posts · the number is how many posts use it
                {!ours && <> · <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#B7791F] align-middle" /> = we don&apos;t use it</>}</span>
              <span className="ml-auto flex items-center gap-2">
                {notOurs.length > 0 && <CopyButton text={joinForPost(notOurs)} label={`Copy ones we don't use (${notOurs.length})`} />}
                {kws.length > 0 && <CopyButton text={joinForPost(kws.map(([k]) => k))} label="Copy all" />}
              </span>
            </div>
            {kws.length === 0 ? <div className="text-[14px] text-[#8A92A6]">No hashtags or doctor keywords in these posts.</div> : (
              <div className="flex flex-wrap gap-1.5 max-h-[168px] overflow-y-auto">
                {kws.map(([k, n]) => (
                  <span key={k} className={`inline-flex items-center rounded border text-[13px] ${only === k ? "border-brand bg-brand-light" : "border-gray-200 bg-white"}`}>
                    <button onClick={() => setOnly(only === k ? null : k)} className="pl-2.5 pr-1.5 py-1 text-[#232D42] hover:text-brand">
                      {k} <span className="text-[#8A92A6]">{n}</span>
                      {!ours && !ourKws.has(k.toLowerCase()) && <span className="inline-block ml-1 w-1.5 h-1.5 rounded-full bg-[#B7791F] align-middle" title="We don't use this" />}
                    </button>
                    <MiniCopy text={k} />
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2 text-[14px] font-medium text-[#232D42]">
              <button onClick={() => setShowPosts((v) => !v)} title={showPosts ? "Hide posts" : "Show posts"}
                className="w-6 h-6 -ml-1 grid place-items-center rounded text-[#8A92A6] hover:text-brand hover:bg-brand-light">
                <IconChevronDown size={16} stroke={2} className={`transition ${showPosts ? "" : "-rotate-90"}`} />
              </button>
              {only ? <>Posts using <span className="text-brand">{only}</span> <span className="text-[#8A92A6] font-normal">({shown.length})</span>
                <button onClick={() => setOnly(null)} className="ml-1 text-[12px] font-normal text-[#8A92A6] hover:text-brand underline">show all</button></>
                : <>All posts <span className="text-[#8A92A6] font-normal">({posts.length})</span></>}
            </div>
            {showPosts && <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2">
              {shown.map((p, i) => (
                <a key={p.url || i} href={p.url} target="_blank" rel="noreferrer"
                  className="group relative aspect-square rounded-lg overflow-hidden border border-gray-100 bg-[#F6F7FB]">
                  {p.image
                    ? <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-cover" />
                    : <div className="absolute inset-0 p-2.5 text-[12px] leading-snug text-[#4A5468] overflow-hidden">{p.caption || "No caption"}</div>}
                  {/* Hover: caption + keywords found in it. */}
                  <div className="absolute inset-0 bg-[#232D42]/90 text-white p-2.5 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition overflow-hidden">
                    <div className="text-[12px] leading-snug line-clamp-4">{p.caption || "No caption"}</div>
                    {p.keywords.length > 0 && <div className="text-[11px] leading-snug text-[#C9D2FF] line-clamp-4">{p.keywords.join(" ")}</div>}
                  </div>
                  <div className="absolute bottom-0 inset-x-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent text-white text-[11px] flex items-center gap-1 group-hover:opacity-0 transition">
                    {p.date && <span>{new Date(p.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>}
                    <span className="ml-auto">{fmt(p.engagement)} {unit}</span>
                  </div>
                </a>
              ))}
            </div>}
          </div>
        </>
      )}
    </div>
  );
}

// Small copy icon beside a keyword.
function MiniCopy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button title="Copy" onClick={async () => { if (await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 1200); } }}
      className="pr-2 pl-1 py-1 border-l border-gray-100 text-[#8A92A6] hover:text-brand">
      {done ? <IconCheck size={13} stroke={2} className="text-[#2F9E6F]" /> : <IconCopy size={13} stroke={1.8} />}
    </button>
  );
}

// ── Ranking tab ────────────────────────────────────────────────────────────
// 1. Our keywords ranked by what our posts using them got (reach, views, saves…).
// 2. Keywords across every account, by engagement per 1,000 followers so big
//    accounts don't win just by being big. Other accounts only share likes +
//    comments (Instagram) or views (YouTube), so that's all section 2 can use.
type Col<T> = { key: keyof T & string; label: string; rate?: boolean };
const avgOf = (xs: (number | undefined)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);

function SortTable<T extends { keyword: string }>({ rows, cols, initial, baseline, extra }: {
  rows: T[]; cols: Col<T>[]; initial: keyof T & string; baseline?: Partial<T>; extra?: (r: T) => React.ReactNode;
}) {
  const [sort, setSort] = useState<keyof T & string>(initial);
  const sorted = [...rows].sort((a, b) => ((b[sort] as number | null) ?? -1) - ((a[sort] as number | null) ?? -1));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead className="bg-gray-50">
          <tr className="text-left text-[#8A92A6]">
            <th className="px-3 py-2 font-normal w-8">#</th>
            <th className="px-3 py-2 font-normal">Keyword</th>
            {cols.map((c) => (
              <th key={c.key} className="px-3 py-2 font-normal text-right whitespace-nowrap">
                <button onClick={() => setSort(c.key)} className={`inline-flex items-center gap-1 hover:text-brand ${sort === c.key ? "text-brand font-medium" : ""}`}>
                  {c.label}{sort === c.key && <IconArrowDown size={13} stroke={2} />}
                </button>
              </th>
            ))}
            {extra && <th className="px-3 py-2 font-normal" />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.keyword} className="border-t border-gray-50">
              <td className="px-3 py-2 text-[#8A92A6] tabular-nums">{i + 1}</td>
              <td className="px-3 py-2 text-[#232D42] font-medium whitespace-nowrap">
                <span className="inline-flex items-center rounded border border-gray-200 bg-white"><span className="pl-2 pr-1 py-0.5">{r.keyword}</span><MiniCopy text={r.keyword} /></span>
              </td>
              {cols.map((c) => {
                const v = r[c.key] as number | null, b = baseline?.[c.key] as number | null | undefined;
                const tone = b == null || v == null || c.key === "posts" || c.key === "accounts" ? "text-[#232D42]" : v > b ? "text-[#2F9E6F]" : "text-[#8A92A6]";
                return <td key={c.key} className={`px-3 py-2 text-right tabular-nums ${sort === c.key ? "font-medium" : ""} ${tone}`}>{c.rate ? pct(v) : fmt(v == null ? null : Math.round(v))}</td>;
              })}
              {extra && <td className="px-3 py-2">{extra(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type OurRow = { keyword: string; posts: number; reach: number | null; views: number | null; engagement: number | null; likes: number | null; comments: number | null; saves: number | null; shares: number | null; rate: number | null };
type AllRow = { keyword: string; per1k: number | null; accounts: number; posts: number; oursPosts: number };

function Ranking({ data, platform }: { data: Data; platform: Platform }) {
  const [showOnes, setShowOnes] = useState(false);
  const yt = platform === "youtube";
  const accs = data.accounts.filter((a) => a.platform === platform && (a.posts || []).length);
  const ours = accs.find((a) => handleOf(a).toLowerCase() === "goocampus");

  // 1. Our keywords.
  const { ourRows, ourBase } = useMemo(() => {
    const posts = ours?.posts || [];
    const eng = (p: Post) => (p.likes ?? 0) + (p.comments ?? 0) + (yt ? 0 : (p.saves ?? 0) + (p.shares ?? 0));
    // Engagement rate: interactions ÷ reach (Instagram) or ÷ views (YouTube).
    const rateOf = (ps: Post[]) => {
      const den = ps.reduce((s, p) => s + ((yt ? p.views : p.reach) ?? 0), 0);
      return den ? (ps.reduce((s, p) => s + eng(p), 0) / den) * 100 : null;
    };
    const row = (keyword: string, ps: Post[]): OurRow => ({
      keyword, posts: ps.length, reach: avgOf(ps.map((p) => p.reach)), views: avgOf(ps.map((p) => p.views)),
      engagement: avgOf(ps.map((p) => (p.likes ?? 0) + (p.comments ?? 0))), likes: avgOf(ps.map((p) => p.likes)), comments: avgOf(ps.map((p) => p.comments)),
      saves: avgOf(ps.map((p) => p.saves)), shares: avgOf(ps.map((p) => p.shares)), rate: rateOf(ps),
    });
    const by = new Map<string, Post[]>();
    for (const p of posts) for (const k of p.keywords) by.set(k, [...(by.get(k) || []), p]);
    return { ourRows: [...by.entries()].map(([k, ps]) => row(k, ps)), ourBase: row("all", posts) };
  }, [ours, yt]);

  // 2. Across every account, per 1,000 followers.
  const allRows = useMemo(() => {
    const by = new Map<string, { vals: number[]; accounts: Set<string>; ours: number }>();
    for (const a of accs) {
      if (!a.followers) continue;
      const us = handleOf(a).toLowerCase() === "goocampus";
      for (const p of a.posts || []) {
        const v = (p.engagement / a.followers) * 1000;
        for (const k of p.keywords) {
          const e = by.get(k) || { vals: [], accounts: new Set<string>(), ours: 0 };
          e.vals.push(v); e.accounts.add(a.account); if (us) e.ours += 1;
          by.set(k, e);
        }
      }
    }
    return [...by.entries()].map(([keyword, e]): AllRow => ({ keyword, per1k: avgOf(e.vals), accounts: e.accounts.size, posts: e.vals.length, oursPosts: e.ours }));
  }, [accs]);

  const ourShown = ourRows.filter((r) => showOnes || r.posts >= 2);
  const allShown = allRows.filter((r) => showOnes || (r.posts >= 3 && r.accounts >= 2));
  const topOurs = [...ourShown].sort((a, b) => ((yt ? b.views : b.reach) ?? 0) - ((yt ? a.views : a.reach) ?? 0)).slice(0, 10).map((r) => r.keyword);
  const topAll = [...allShown].sort((a, b) => (b.per1k ?? 0) - (a.per1k ?? 0)).slice(0, 10).map((r) => r.keyword);

  const ourCols: Col<OurRow>[] = yt
    ? [{ key: "posts", label: "Videos" }, { key: "views", label: "Avg views" }, { key: "likes", label: "Avg likes" }, { key: "comments", label: "Avg comments" }, { key: "rate", label: "Eng. rate", rate: true }]
    : [{ key: "posts", label: "Posts" }, { key: "reach", label: "Avg reach" }, { key: "views", label: "Avg views" }, { key: "engagement", label: "Avg likes + comments" }, { key: "saves", label: "Avg saves" }, { key: "shares", label: "Avg shares" }, { key: "rate", label: "Eng. rate", rate: true }];
  const unused = (r: AllRow) => (r.oursPosts ? <span className="text-[12px] text-[#8A92A6]">We use it ({r.oursPosts})</span> : <span className="text-[12px] px-2 py-0.5 rounded bg-[#FDF6E7] text-[#B7791F] whitespace-nowrap">Not used yet</span>);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="inline-flex items-center gap-2 text-[14px] text-[#4A5468] cursor-pointer">
          <input type="checkbox" checked={showOnes} onChange={(e) => setShowOnes(e.target.checked)} className="accent-[#3A57E8]" />
          Include keywords from just one post {showOnes ? "" : "(hidden — one post proves little)"}
        </label>
      </div>

      <Card icon={<IconTrophy size={17} stroke={1.8} />} title="Our keywords, ranked"
        sub={`Average per ${yt ? "video" : "post"} for our ${yt ? "YouTube videos" : "Instagram posts"} using each keyword (last ${ours?.posts?.length ?? 0}). Green = beats our average ${yt ? "video" : "post"}. Click a column to sort. Eng. rate = ${yt ? "likes + comments ÷ views" : "likes, comments, saves and shares ÷ reach"}.`}
        right={topOurs.length > 0 && <CopyButton text={joinForPost(topOurs)} label={`Copy top ${topOurs.length}`} />}>
        {ourShown.length === 0 ? <div className="text-[14px] text-[#8A92A6]">{ours ? "No keyword appears in two or more of our posts yet." : "Couldn't read our account."}</div> : (
          <>
            <div className="text-[12px] text-[#8A92A6] mb-2">
              Our average {yt ? "video" : "post"}: {yt ? `${fmt(ourBase.views == null ? null : Math.round(ourBase.views))} views` : `${fmt(ourBase.reach == null ? null : Math.round(ourBase.reach))} reach · ${fmt(ourBase.views == null ? null : Math.round(ourBase.views))} views · ${fmt(ourBase.saves == null ? null : Math.round(ourBase.saves))} saves`} · {pct(ourBase.rate)} eng. rate
            </div>
            {(() => {
              const total = ours?.posts?.length || 0, same = ourShown.filter((r) => total && r.posts >= total * 0.8).map((r) => r.keyword);
              return same.length > 0 && (
                <div className="text-[12px] text-[#B7791F] bg-[#FDF6E7] rounded px-3 py-1.5 mb-2">
                  {same.join(", ")} {same.length === 1 ? "is" : "are"} on almost every one of our {yt ? "videos" : "posts"} (usually boilerplate tags), so {same.length === 1 ? "its" : "their"} numbers are just our average. Use tags that match each {yt ? "video" : "post"} to see what really works.
                </div>
              );
            })()}
            <SortTable key={`ours-${platform}`} rows={ourShown} cols={ourCols} initial={yt ? "views" : "reach"} baseline={ourBase} />
          </>
        )}
      </Card>

      <Card icon={<IconTrendingUp size={17} stroke={1.8} />} title="Across all accounts"
        sub={`How each keyword does on every account we track, as ${yt ? "views" : "likes + comments"} per 1,000 ${yt ? "subscribers" : "followers"} — so a big account doesn't win just by being big. ${showOnes ? "" : "Showing keywords used in 3+ posts by 2+ accounts. "}Other accounts don't share reach, so this is the fairest comparison possible.`}
        right={topAll.length > 0 && <CopyButton text={joinForPost(topAll)} label={`Copy top ${topAll.length}`} />}>
        {allShown.length === 0 ? <div className="text-[14px] text-[#8A92A6]">Not enough shared keywords yet{accs.length < 3 ? " — some accounts couldn't be read right now" : ""}.</div> : (
          <SortTable key={`all-${platform}`} rows={allShown} initial="per1k" extra={unused}
            cols={[{ key: "per1k", label: `Avg per 1K ${yt ? "subs" : "followers"}` }, { key: "accounts", label: "Accounts" }, { key: "posts", label: yt ? "Videos" : "Posts" }]} />
        )}
      </Card>
    </div>
  );
}

// ── Google research tab ────────────────────────────────────────────────────
// Website/Google keyword research (Nandu, with Ahrefs' keyword tutorial). Free data
// only: Google India suggestions, questions, the top 10 + where we rank (Serper), and
// our real searches from Search Console. No search volume / difficulty (paid sources).
type Research = {
  seed: string; error?: string;
  ideas: { keyword: string; from: "autocomplete" | "related" }[];
  questions: string[];
  serp: { organic: { position: number; title: string; link: string; domain: string; ours: boolean }[]; bestPosition: number | null; error?: string };
  ours: { rows: { query: string; clicks: number; impressions: number; ctr: number; position: number }[]; from: string; to: string; error?: string };
};

function GoogleResearch() {
  const [q, setQ] = useState("");
  const [seed, setSeed] = useState("");
  const { data, error, isLoading } = useApi<Research>(seed ? `/api/seo/research?q=${encodeURIComponent(seed)}` : null);
  const run = (k: string) => { const t = k.trim(); if (t.length >= 2) { setQ(t); setSeed(t); } };
  const r = data && !data.error ? data : null;
  return (
    <div className="space-y-4">
      <Card icon={<IconBrandGoogle size={17} stroke={1.8} />} title="Google keyword research"
        sub="Type a topic — get the searches Google suggests, the questions people ask, who ranks for it and where GooCampus stands. Click any idea to research it next.">
        <Explainer>
          <b className="font-medium">Free data from Google (India) and our Search Console.</b> Search volume and keyword difficulty aren&apos;t included
          {" "}— those need a paid tool (Ahrefs / Semrush / DataForSEO). Use our Search Console impressions as the demand signal we do have.
        </Explainer>
        <form onSubmit={(e) => { e.preventDefault(); run(q); }} className="flex items-center gap-2">
          <div className="relative flex-1">
            <IconSearch size={16} stroke={1.8} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A92A6]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. AMC exam, PLAB 2, NEET PG counselling"
              className="w-full h-10 pl-9 pr-3 rounded border border-gray-200 text-[14px] outline-none focus:border-brand" />
          </div>
          <button type="submit" disabled={q.trim().length < 2 || isLoading} className="h-10 px-4 rounded bg-brand text-white text-[14px] font-medium disabled:opacity-40">
            {isLoading ? "Researching…" : "Research"}
          </button>
        </form>
      </Card>

      {seed && (error || data?.error) && <div className="bg-white border border-gray-100 rounded-xl p-6 text-[14px] text-rose-600">{error?.message || data?.error}</div>}
      {seed && isLoading && !data && <div className="bg-white border border-gray-100 rounded-xl p-6"><LoadingBlock label="Asking Google…" /></div>}

      {r && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            <Card icon={<IconListSearch size={17} stroke={1.8} />} title={`Keyword ideas (${r.ideas.length})`}
              sub="What Google suggests and relates to your topic — real searches people make. Click one to research it."
              right={r.ideas.length > 0 && <CopyButton text={r.ideas.map((i) => i.keyword).join(", ")} label="Copy all" />}>
              {r.ideas.length === 0 ? <div className="text-[14px] text-[#8A92A6]">No suggestions from Google for this one.</div> : (
                <div className="flex flex-wrap gap-2">
                  {r.ideas.map((i) => (
                    <span key={i.keyword} className="inline-flex items-center rounded border border-gray-200 bg-white text-[13px]">
                      <button onClick={() => run(i.keyword)} className="pl-2.5 pr-1.5 py-1 text-[#232D42] hover:text-brand" title={i.from === "autocomplete" ? "Google autocomplete" : "Google related search"}>{i.keyword}</button>
                      <MiniCopy text={i.keyword} />
                    </span>
                  ))}
                </div>
              )}
            </Card>
            <Card icon={<IconHelpCircle size={17} stroke={1.8} />} title="Questions people ask"
              sub="What Google completes when people start a question about it — good headings for a blog post or an FAQ section.">
              {r.questions.length === 0 ? <div className="text-[14px] text-[#8A92A6]">Google suggested no questions for this topic.</div> : (
                <ul className="space-y-2">
                  {r.questions.map((x) => (
                    <li key={x} className="flex items-center gap-2 text-[14px] text-[#232D42]"><span className="flex-1">{x}</span><MiniCopy text={x} /></li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card icon={<IconTrophy size={17} stroke={1.8} />} title={`Who ranks for “${r.seed}” on Google (India)`}
            sub={r.serp.bestPosition ? `GooCampus is #${r.serp.bestPosition}.` : "GooCampus isn't in the top 10 for this search."}>
            {r.serp.error ? <div className="text-[14px] text-rose-600">{r.serp.error}</div> : (
              <ol className="space-y-2">
                {r.serp.organic.map((o) => (
                  <li key={o.position + o.link} className={`flex items-start gap-3 rounded-lg px-3 py-2 ${o.ours ? "bg-brand-light" : ""}`}>
                    <span className="w-6 text-right text-[13px] text-[#8A92A6] tabular-nums">{o.position}</span>
                    <div className="min-w-0 flex-1">
                      <a href={o.link} target="_blank" rel="noreferrer" className="text-[14px] text-[#232D42] hover:text-brand line-clamp-1">{o.title}</a>
                      <div className="text-[12px] text-[#8A92A6]">{o.domain}{o.ours && <span className="ml-1.5 px-1.5 py-px rounded bg-brand text-white text-[11px]">Us</span>}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card icon={<IconChartBar size={17} stroke={1.8} />} title="Our searches from Search Console"
            sub={`What people actually typed when our pages showed up on Google, containing “${r.seed}” — ${r.ours.from} to ${r.ours.to}. Impressions = how often we were shown.`}>
            {r.ours.error ? <div className="text-[14px] text-[#8A92A6]">{r.ours.error}</div>
              : r.ours.rows.length === 0 ? <div className="text-[14px] text-[#8A92A6]">No searches containing “{r.seed}” brought up our pages in the last 90 days — a gap worth writing for.</div> : (
                <div className="overflow-x-auto -mx-4 -mb-4">
                  <table className="w-full text-[13px]">
                    <thead><tr className="text-left"><th className="px-4 py-2 font-normal">Search</th><th className="px-4 py-2 font-normal text-right">Impressions</th><th className="px-4 py-2 font-normal text-right">Clicks</th><th className="px-4 py-2 font-normal text-right">CTR</th><th className="px-4 py-2 font-normal text-right">Avg position</th></tr></thead>
                    <tbody>
                      {r.ours.rows.map((x) => (
                        <tr key={x.query}>
                          <td className="px-4 py-2 text-[#232D42]">{x.query}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{x.impressions.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{x.clicks.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{x.ctr}%</td>
                          <td className="px-4 py-2 text-right tabular-nums">{x.position}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </Card>
        </>
      )}
    </div>
  );
}
