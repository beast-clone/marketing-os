"use client";
import { useEffect, useMemo, useState } from "react";
import { IconArchive, IconChartBar, IconCopy, IconCheck, IconSearch, IconX, IconPaperclip, IconExternalLink } from "@tabler/icons-react";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { MultiPick, isPickNone } from "@/components/MultiPick";
import { Overlay } from "@/app/(dashboard)/dashboard/preview/Overlay";
import { LoadingBlock } from "@/components/LoadingBlock";
import { fmtDateShort } from "@/lib/date";

// Airtable Backup (Content → Airtable Backup, 3 Nov 2026): Airtable's Content
// Calendar from April 2026, kept read-only so nothing is lost after the move to the
// dashboard. Nothing here is live work. The summary counts content by primary
// interest for whatever is filtered, and "Copy table" puts it on the clipboard as
// rows and columns, ready to paste into a report section or a spreadsheet.

type Row = { airtable_id: string; title: string | null; type: string | null; status: string | null; sbu: string | null; owner: string | null; collaborators: string[]; priority: string | null; platforms: string[]; created_by: string | null; publishing_date: string | null; created_at: string | null; files: number };
type Full = Omit<Row, "files"> & {
  due_date: string | null; completion_time: string | null; content: string | null; caption: string | null; additional_info: string | null;
  files: { url: string; name: string; mime: string; size: number }[]; fields: Record<string, unknown>; modified_at: string | null;
};

const PUBLISHED = "Published/Scheduled";
const monthOf = (r: Row) => (r.publishing_date || r.created_at || "").slice(0, 7);
const monthName = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
const yearOf = (r: Row) => monthOf(r).slice(0, 4);

// The tick-box filters, in Airtable's order. `get` reads a row's value(s); the label
// reads "All <label> (n)" on the button. Years and months run newest first, the rest
// busiest first.
type FKey = "year" | "month" | "sbu" | "type" | "status" | "owner" | "collab" | "priority" | "platform" | "creator";
const FILTERS: { key: FKey; label: string; get: (r: Row) => string | string[] | null; byDate?: boolean }[] = [
  { key: "year", label: "years", get: (r) => yearOf(r) || null, byDate: true },
  { key: "month", label: "months", get: (r) => (monthOf(r) ? monthName(monthOf(r)) : null), byDate: true },
  { key: "sbu", label: "primary interests", get: (r) => r.sbu },
  { key: "type", label: "types", get: (r) => r.type },
  { key: "status", label: "statuses", get: (r) => r.status },
  { key: "owner", label: "owners", get: (r) => r.owner },
  { key: "collab", label: "collaborators", get: (r) => r.collaborators },
  { key: "priority", label: "priorities", get: (r) => r.priority },
  { key: "platform", label: "platforms", get: (r) => r.platforms },
  { key: "creator", label: "creators", get: (r) => r.created_by },
];
const NO_FILTERS = Object.fromEntries(FILTERS.map((x) => [x.key, [] as string[]])) as Record<FKey, string[]>;
const valuesOf = (r: Row, get: (r: Row) => string | string[] | null) => { const v = get(r); return Array.isArray(v) ? v : v ? [v] : []; };
// Nothing ticked = no filter; "Unselect all" = nothing passes; else any of the ticked.
const passes = (sel: string[], vals: string[]) => !sel.length || (!isPickNone(sel) && vals.some((v) => sel.includes(v)));

export default function ArchivePage() {
  return (
    <PreviewDashboardShell active="archive" title="Airtable Backup" hideAccountPicker hideRange
      subtitle="Airtable's Content Calendar from April 2026 — a read-only backup, for looking things up and yearly counts.">
      {() => <Archive />}
    </PreviewDashboardShell>
  );
}

function Archive() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [f, setF] = useState<Record<FKey, string[]>>(NO_FILTERS);
  const [shown, setShown] = useState(100);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/archive", { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then((j) => setRows(j.rows as Row[]))
      .catch((e) => setErr((e as Error).message));
  }, []);

  // Each filter's options with how many tasks have them (over the whole backup).
  const options = useMemo(() => Object.fromEntries(FILTERS.map((x) => {
    const n = new Map<string, number>(); const at = new Map<string, string>();
    for (const r of rows || []) for (const v of valuesOf(r, x.get)) { n.set(v, (n.get(v) || 0) + 1); if (x.byDate) at.set(v, monthOf(r)); }
    const list = [...n.entries()].map(([value, count]) => ({ value, count }));
    list.sort((p, q) => (x.byDate ? (x.key === "year" ? q.value.localeCompare(p.value) : (at.get(q.value) || "").localeCompare(at.get(p.value) || "")) : q.count - p.count));
    return [x.key, list];
  })) as Record<FKey, { value: string; count: number }[]>, [rows]);
  const list = useMemo(() => {
    const words = q.trim().toLowerCase();
    return (rows || []).filter((r) => FILTERS.every((x) => passes(f[x.key], valuesOf(r, x.get))) &&
      (!words || (r.title || "").toLowerCase().includes(words)));
  }, [rows, q, f]);
  useEffect(() => { setShown(100); }, [q, f]);

  // By primary interest: tasks, published, and the four biggest formats as columns.
  const summary = useMemo(() => {
    const typeCount = new Map<string, number>();
    for (const r of list) if (r.type) typeCount.set(r.type, (typeCount.get(r.type) || 0) + 1);
    const types = [...typeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
    const by = new Map<string, { tasks: number; published: number; types: Record<string, number> }>();
    for (const r of list) {
      const k = r.sbu || "No primary interest";
      const o = by.get(k) || { tasks: 0, published: 0, types: {} };
      o.tasks++; if (r.status === PUBLISHED) o.published++;
      if (r.type && types.includes(r.type)) o.types[r.type] = (o.types[r.type] || 0) + 1;
      by.set(k, o);
    }
    const lines = [...by.entries()].sort((a, b) => b[1].tasks - a[1].tasks);
    const header = ["Primary interest", "Tasks", "Published", ...types];
    const body = lines.map(([k, o]) => [k, o.tasks, o.published, ...types.map((t) => o.types[t] || 0)]);
    const total = ["Total", list.length, list.filter((r) => r.status === PUBLISHED).length, ...types.map((t) => typeCount.get(t) || 0)];
    return { header, body, total };
  }, [list]);

  const scope = FILTERS.filter((x) => f[x.key].length && !isPickNone(f[x.key]))
    .map((x) => (f[x.key].length > 2 ? `${f[x.key].length} ${x.label}` : f[x.key].join(", "))).join(" · ") || "Everything in the backup";
  const filtered = FILTERS.some((x) => f[x.key].length) || q;
  const tsv = (cells: (string | number)[][]) => cells.map((r) => r.map((c) => String(c ?? "").replace(/[\t\n]+/g, " ")).join("\t")).join("\n");

  if (err) return <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-[13px] text-rose-800">{err}</div>;
  if (!rows) return <div className="bg-white border border-gray-100 rounded-2xl"><LoadingBlock label="Loading the backup…" /></div>;

  return (
    <div className="space-y-4">
      {/* Summary — the part reports need */}
      <section className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100 bg-brand-light">
          <span className="w-8 h-8 rounded-lg bg-white text-brand grid place-items-center"><IconChartBar size={16} stroke={1.8} /></span>
          <div className="mr-auto">
            <div className="text-[14px] font-medium text-[#232D42]">By primary interest</div>
            <div className="text-[12px] text-[#4A5468]">{scope} · {list.length} tasks</div>
          </div>
          <CopyButton label="Copy table" text={() => tsv([summary.header, ...summary.body, summary.total])} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] whitespace-nowrap">
            <thead className="text-[11px] uppercase tracking-wide text-[#8A92A6]">
              <tr>{summary.header.map((h, i) => <th key={h} className={`px-4 py-2.5 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {summary.body.map((r) => (
                <tr key={String(r[0])} className="border-t border-gray-100">
                  {r.map((c, i) => <td key={i} className={`px-4 py-2 tabular-nums ${i ? "text-right text-[#4A5468]" : "text-[#232D42]"}`}>{c}</td>)}
                </tr>
              ))}
              <tr className="border-t border-gray-200 font-medium text-[#232D42]">
                {summary.total.map((c, i) => <td key={i} className={`px-4 py-2.5 tabular-nums ${i ? "text-right" : ""}`}>{c}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Tasks */}
      <section className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        {/* Line 1: what this is, search, copy. Line 2: the ten tick-box filters. */}
        <div className="px-4 py-3 border-b border-gray-100 space-y-3">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-brand-light text-brand grid place-items-center flex-shrink-0"><IconArchive size={16} stroke={1.8} /></span>
            <div className="min-w-[120px]">
              <div className="text-[14px] font-medium text-[#232D42]">Tasks</div>
              <div className="text-[12px] text-[#8A92A6]">{list.length === rows.length ? `${rows.length} tasks · read-only` : `${list.length} of ${rows.length}`}</div>
            </div>
            <label className="flex items-center gap-2 h-9 px-3 rounded-lg border border-gray-200 bg-white flex-1">
              <IconSearch size={15} stroke={1.8} className="text-[#8A92A6]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…" className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-[#232D42] placeholder:text-[#8A92A6]" />
              {q && <button onClick={() => setQ("")} aria-label="Clear search" className="text-[#8A92A6] hover:text-[#232D42]"><IconX size={14} /></button>}
            </label>
            {filtered && <button onClick={() => { setF(NO_FILTERS); setQ(""); }} className="h-9 px-3 rounded-lg text-[13px] font-medium text-[#4A5468] hover:text-brand whitespace-nowrap">Clear all</button>}
            <CopyButton label="Copy list" text={() => tsv([["Task", "Type", "Status", "Primary interest", "Owner", "Publishing date"],
              ...list.map((r) => [r.title || "(no title)", r.type || "", r.status || "", r.sbu || "", r.owner || "", r.publishing_date || ""])])} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {FILTERS.map((x) => (
              <MultiPick key={x.key} label={x.label} options={options[x.key]} selected={f[x.key]} total={rows.length}
                onChange={(next) => setF((s) => ({ ...s, [x.key]: next }))} />
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-[#8A92A6]">
              <tr>{["Task", "Type", "Status", "Primary interest", "Owner", "Publishing date", ""].map((h) => <th key={h} className="px-4 py-2.5 font-medium text-left whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {list.slice(0, shown).map((r) => (
                <tr key={r.airtable_id} onClick={() => setOpen(r.airtable_id)} className="border-t border-gray-100 hover:bg-[#F6F7FB] cursor-pointer">
                  <td className="px-4 py-2.5 text-[#232D42] max-w-[360px] truncate">{r.title || <span className="text-[#8A92A6]">(no title)</span>}</td>
                  <td className="px-4 py-2.5 text-[#4A5468] whitespace-nowrap">{r.type || "—"}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap"><StatusChip s={r.status} /></td>
                  <td className="px-4 py-2.5 text-[#4A5468] whitespace-nowrap">{r.sbu || "—"}</td>
                  <td className="px-4 py-2.5 text-[#4A5468] whitespace-nowrap">{r.owner || "—"}</td>
                  <td className="px-4 py-2.5 text-[#4A5468] whitespace-nowrap">{r.publishing_date ? fmtDateShort(r.publishing_date) : "—"}</td>
                  <td className="px-4 py-2.5 text-[#8A92A6] whitespace-nowrap">{r.files ? <span className="inline-flex items-center gap-1"><IconPaperclip size={13} />{r.files}</span> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-[#8A92A6]">Nothing matches.</div>}
          {list.length > shown && (
            <div className="px-4 py-3 border-t border-gray-100 text-center">
              <button onClick={() => setShown((n) => n + 200)} className="text-[13px] font-medium text-brand hover:text-[#2138B0]">Show more · {list.length - shown} left</button>
            </div>
          )}
        </div>
      </section>

      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CopyButton({ label, text }: { label: string; text: () => string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={async () => { await navigator.clipboard.writeText(text()); setDone(true); setTimeout(() => setDone(false), 1800); }}
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 bg-white text-[13px] font-medium text-[#4A5468] hover:border-brand hover:text-brand">
      {done ? <IconCheck size={15} stroke={2} className="text-emerald-600" /> : <IconCopy size={15} stroke={1.8} />}{done ? "Copied" : label}
    </button>
  );
}

function StatusChip({ s }: { s: string | null }) {
  const cls = s === PUBLISHED ? "bg-[#E8F6EE] text-[#126B39]" : s === "Rejected/Not Published" || s === "Failed" ? "bg-rose-50 text-rose-700" : "bg-[#F0F2F8] text-[#4A5468]";
  return <span className={`text-[11.5px] px-2 py-0.5 rounded-md ${cls}`}>{s || "No status"}</span>;
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const [row, setRow] = useState<Full | null>(null);
  useEffect(() => {
    fetch(`/api/archive?id=${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => r.json()).then((j) => setRow(j.row as Full)).catch(() => {});
  }, [id]);
  const facts: [string, string | null | undefined][] = row ? [
    ["Type", row.type], ["Status", row.status], ["Primary interest", row.sbu], ["Priority", row.priority],
    ["Owner", row.owner], ["Collaborators", row.collaborators?.join(", ")], ["Created by", row.created_by],
    ["Publishing date", row.publishing_date && fmtDateShort(row.publishing_date)], ["Due date", row.due_date && fmtDateShort(row.due_date)],
    ["Platforms", row.platforms?.join(", ")], ["Created in Airtable", row.created_at && fmtDateShort(row.created_at)],
  ] : [];
  // Links and anything else Airtable held, as it was (Slack Cache shows with the files).
  const extra = row ? Object.entries(row.fields || {}).filter(([, v]) => v !== null && v !== "" && typeof v !== "object") : [];
  return (
    <Overlay onClose={onClose}>
      <div className="preview-scope bg-white rounded-2xl w-[min(860px,94vw)] max-h-[88vh] overflow-y-auto">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100 bg-brand-light sticky top-0">
          <div className="mr-auto min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-brand font-medium">Airtable Backup · read-only</div>
            <div className="text-[16px] font-medium text-[#232D42] mt-0.5">{row ? row.title || "(no title)" : "Loading…"}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg bg-white grid place-items-center text-[#4A5468] hover:text-[#232D42]"><IconX size={16} /></button>
        </div>
        {!row ? <LoadingBlock /> : (
          <div className="p-5 grid md:grid-cols-[1fr_240px] gap-5">
            <div className="space-y-4 min-w-0">
              {[["Content", row.content], ["Caption", row.caption], ["Additional info", row.additional_info]].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="border border-gray-100 rounded-xl p-3.5">
                  <div className="text-[11px] uppercase tracking-wide text-[#8A92A6] mb-1.5">{k}</div>
                  <div className="text-[13px] text-[#232D42] whitespace-pre-wrap leading-relaxed">{v}</div>
                </div>
              ))}
              {[["Files", row.files], ["Slack cache", (row.fields?.["Slack Cache"] as Full["files"] | undefined) || []]].filter(([, l]) => (l as Full["files"]).length).map(([label, l]) => (
                <FileGrid key={label as string} label={label as string} files={l as Full["files"]} />
              ))}
            </div>
            <aside className="space-y-2.5 text-[12.5px]">
              {facts.filter(([, v]) => v).map(([k, v]) => (
                <div key={k}><div className="text-[11px] text-[#8A92A6]">{k}</div><div className="text-[#232D42]">{v}</div></div>
              ))}
              {extra.map(([k, v]) => (
                <div key={k} className="min-w-0"><div className="text-[11px] text-[#8A92A6]">{k}</div>
                  {typeof v === "string" && /^https?:\/\//.test(v)
                    ? <a href={v} target="_blank" rel="noreferrer" className="text-brand inline-flex items-center gap-1 break-all">{v.replace(/^https?:\/\//, "").slice(0, 40)}<IconExternalLink size={12} /></a>
                    : <div className="text-[#232D42] break-words">{String(v)}</div>}
                </div>
              ))}
            </aside>
          </div>
        )}
      </div>
    </Overlay>
  );
}

function FileGrid({ label, files }: { label: string; files: Full["files"] }) {
  return (
    <div className="border border-gray-100 rounded-xl p-3.5">
      <div className="text-[11px] uppercase tracking-wide text-[#8A92A6] mb-2">{label} · {files.length}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {files.map((fl) => (
          <a key={fl.url} href={fl.url} target="_blank" rel="noreferrer" className="group block border border-gray-100 rounded-lg overflow-hidden hover:border-brand">
            {fl.mime.startsWith("image/") ? <img src={fl.url} alt="" className="w-full aspect-square object-cover bg-gray-50" />
              : <div className="w-full aspect-square grid place-items-center bg-[#F6F7FB] text-[#8A92A6]"><IconPaperclip size={20} /></div>}
            <div className="px-2 py-1.5 text-[11px] text-[#4A5468] truncate">{fl.name}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
