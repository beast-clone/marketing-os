"use client";
import { useEffect, useMemo, useState } from "react";
import { IconArchive, IconChartBar, IconCopy, IconCheck, IconSearch, IconX, IconPaperclip, IconExternalLink } from "@tabler/icons-react";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { Overlay } from "@/app/(dashboard)/dashboard/preview/Overlay";
import { LoadingBlock } from "@/components/LoadingBlock";
import { fmtDateShort } from "@/lib/date";

// Airtable archive (Content → Airtable archive, 3 Nov 2026): Airtable's Content
// Calendar from April 2026, kept read-only so nothing is lost after the move to the
// dashboard. Nothing here is live work. The summary counts content by primary
// interest for whatever is filtered, and "Copy table" puts it on the clipboard as
// rows and columns, ready to paste into a report section or a spreadsheet.

type Row = { airtable_id: string; title: string | null; type: string | null; status: string | null; sbu: string | null; owner: string | null; publishing_date: string | null; created_at: string | null; files: number };
type Full = Omit<Row, "files"> & {
  priority: string | null; collaborators: string[]; created_by: string | null; due_date: string | null; completion_time: string | null;
  platforms: string[]; content: string | null; caption: string | null; additional_info: string | null;
  files: { url: string; name: string; mime: string; size: number }[]; fields: Record<string, unknown>; modified_at: string | null;
};

const PUBLISHED = "Published/Scheduled";
const monthOf = (r: Row) => (r.publishing_date || r.created_at || "").slice(0, 7);
const monthName = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
const yearOf = (r: Row) => monthOf(r).slice(0, 4);

export default function ArchivePage() {
  return (
    <PreviewDashboardShell active="archive" title="Airtable archive" hideAccountPicker hideRange
      subtitle="Airtable's Content Calendar from April 2026 — a read-only backup, for looking things up and yearly counts.">
      {() => <Archive />}
    </PreviewDashboardShell>
  );
}

function Archive() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [f, setF] = useState({ year: "", month: "", sbu: "", type: "", status: "" });
  const [shown, setShown] = useState(100);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/archive", { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then((j) => setRows(j.rows as Row[]))
      .catch((e) => setErr((e as Error).message));
  }, []);

  const opts = (get: (r: Row) => string | null | undefined, sortDesc = false) => {
    const s = [...new Set((rows || []).map(get).filter((v): v is string => !!v))].sort();
    return sortDesc ? s.reverse() : s;
  };
  const list = useMemo(() => {
    const words = q.trim().toLowerCase();
    return (rows || []).filter((r) =>
      (!f.year || yearOf(r) === f.year) && (!f.month || monthOf(r) === f.month) && (!f.sbu || r.sbu === f.sbu) &&
      (!f.type || r.type === f.type) && (!f.status || r.status === f.status) &&
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

  const scope = [f.month ? monthName(f.month) : f.year, f.sbu, f.type, f.status].filter(Boolean).join(" · ") || "Everything in the archive";
  const tsv = (cells: (string | number)[][]) => cells.map((r) => r.map((c) => String(c ?? "").replace(/[\t\n]+/g, " ")).join("\t")).join("\n");

  if (err) return <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-[13px] text-rose-800">{err}</div>;
  if (!rows) return <div className="bg-white border border-gray-100 rounded-2xl"><LoadingBlock label="Loading the archive…" /></div>;

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
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
          <span className="w-8 h-8 rounded-lg bg-brand-light text-brand grid place-items-center flex-shrink-0"><IconArchive size={16} stroke={1.8} /></span>
          <div className="mr-2">
            <div className="text-[14px] font-medium text-[#232D42]">Tasks</div>
            <div className="text-[12px] text-[#8A92A6]">{list.length === rows.length ? `${rows.length} tasks · read-only` : `${list.length} of ${rows.length}`}</div>
          </div>
          <label className="flex items-center gap-2 h-9 px-3 rounded-lg border border-gray-200 bg-white flex-1 min-w-[180px] max-w-[280px]">
            <IconSearch size={15} stroke={1.8} className="text-[#8A92A6]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…" className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-[#232D42] placeholder:text-[#8A92A6]" />
            {q && <button onClick={() => setQ("")} aria-label="Clear search" className="text-[#8A92A6] hover:text-[#232D42]"><IconX size={14} /></button>}
          </label>
          <PreviewSelect value={f.year} onChange={(v) => setF((s) => ({ ...s, year: v, month: "" }))} ariaLabel="Year"
            options={[{ value: "", label: "All years" }, ...opts(yearOf, true).map((y) => ({ value: y, label: y }))]} />
          <PreviewSelect value={f.month} onChange={(v) => setF((s) => ({ ...s, month: v }))} ariaLabel="Month"
            options={[{ value: "", label: "All months" }, ...opts(monthOf, true).filter((m) => !f.year || m.startsWith(f.year)).map((m) => ({ value: m, label: monthName(m) }))]} />
          <PreviewSelect value={f.sbu} onChange={(v) => setF((s) => ({ ...s, sbu: v }))} ariaLabel="Primary interest"
            options={[{ value: "", label: "All primary interests" }, ...opts((r) => r.sbu).map((o) => ({ value: o, label: o }))]} />
          <PreviewSelect value={f.type} onChange={(v) => setF((s) => ({ ...s, type: v }))} ariaLabel="Type"
            options={[{ value: "", label: "All types" }, ...opts((r) => r.type).map((o) => ({ value: o, label: o }))]} />
          <PreviewSelect value={f.status} onChange={(v) => setF((s) => ({ ...s, status: v }))} ariaLabel="Status"
            options={[{ value: "", label: "All statuses" }, ...opts((r) => r.status).map((o) => ({ value: o, label: o }))]} />
          <span className="ml-auto"><CopyButton label="Copy list" text={() => tsv([["Task", "Type", "Status", "Primary interest", "Owner", "Publishing date"],
            ...list.map((r) => [r.title || "(no title)", r.type || "", r.status || "", r.sbu || "", r.owner || "", r.publishing_date || ""])])} /></span>
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
  // Links and anything else Airtable held, as it was.
  const extra = row ? Object.entries(row.fields || {}).filter(([, v]) => v !== null && v !== "" && typeof v !== "object") : [];
  return (
    <Overlay onClose={onClose}>
      <div className="preview-scope bg-white rounded-2xl w-[min(860px,94vw)] max-h-[88vh] overflow-y-auto">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100 bg-brand-light sticky top-0">
          <div className="mr-auto min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-brand font-medium">Airtable archive · read-only</div>
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
              {row.files.length > 0 && (
                <div className="border border-gray-100 rounded-xl p-3.5">
                  <div className="text-[11px] uppercase tracking-wide text-[#8A92A6] mb-2">Files · {row.files.length}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {row.files.map((fl) => (
                      <a key={fl.url} href={fl.url} target="_blank" rel="noreferrer" className="group block border border-gray-100 rounded-lg overflow-hidden hover:border-brand">
                        {fl.mime.startsWith("image/") ? <img src={fl.url} alt="" className="w-full aspect-square object-cover bg-gray-50" />
                          : <div className="w-full aspect-square grid place-items-center bg-[#F6F7FB] text-[#8A92A6]"><IconPaperclip size={20} /></div>}
                        <div className="px-2 py-1.5 text-[11px] text-[#4A5468] truncate">{fl.name}</div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
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
