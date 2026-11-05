"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  IconPlus, IconSearch, IconX, IconPaperclip, IconCheck, IconTrash, IconFileText, IconReceipt, IconPhoto,
  IconFileDescription, IconSpeakerphone, IconRepeat, IconBook, IconAlertTriangle, IconCalendar, IconChevronLeft, IconChevronRight, IconFolder, IconUpload, IconPencil, IconList, IconLayoutGrid, IconExternalLink, IconDownload, IconCurrencyRupee, IconListNumbers, IconRefresh,
} from "@tabler/icons-react";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { confirmDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";
import { showToast } from "@/app/(dashboard)/dashboard/preview/Toast";
import { LoadingBlock } from "@/components/LoadingBlock";
import { FilesCard, pastedName, type FileTile } from "@/components/FilesCard";
import { PdfThumb, isPdf } from "@/components/PdfThumb";
import { openRefPreview } from "@/components/RefPreview";
import { uploadMaterialFile } from "@/lib/upload-task-file";
import { type MTab, type MField } from "@/lib/materials";

// One page for all six Marketing Materials tabs (lib/materials.ts): totals at the top
// for the money tabs, search and filters, then a table (or a picture grid for photos
// and brochures). Click a row to edit it in the side window; "Add" opens it empty.

// note / non_usable: a single photo moved into a folder keeps its own description and flag.
type MFile = { url: string; name: string; mime?: string; size?: number; note?: string; non_usable?: boolean };
type Row = Record<string, unknown> & { id: string };

const ICONS = { expenses: IconReceipt, photos: IconPhoto, materials: IconFileDescription, promotions: IconSpeakerphone, subscriptions: IconRepeat, ebooks: IconBook };
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtDate = (d: unknown) => (typeof d === "string" && d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const thisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()).slice(0, 7);
const filesOf = (r: Row | Record<string, unknown>): MFile[] => (Array.isArray(r.files) ? (r.files as MFile[]) : []);
const isImage = (f: MFile) => (f.mime || "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(f.name);
// A small copy of a stored image for tiles (the photos are ~7 MB each); anything not
// in our storage is shown as is.
const thumbUrl = (u: string) => (u.includes("/storage/v1/object/public/") ? `${u.replace("/object/public/", "/render/image/public/")}?width=400&resize=contain&quality=70` : u);
const fileKind = (f: MFile): FileTile["kind"] => (isImage(f) ? "image" : isPdf(f.url, f.mime) ? "pdf" : (f.mime || "").startsWith("video/") ? "video" : "file");

// e-Book Orders: pull e-Book sales from Razorpay (lib/razorpay-ebooks.ts) — the
// automations only log sales from the day they went live. Paste an e-Book's payment
// page link: the page's name fills in the e-Book, then its sales are synced and
// checked against Razorpay's own sold count. "Sync every e-Book" does them all.
type RzpPage = { id: string; title: string; url: string; active: boolean; price: number | null; sold: number; ebook: string };
type SyncResult = { added: number; updated: number; ebookPayments: number; paidNow: number | null; ebook?: string; titles?: string[]; page?: RzpPage | null };
function RazorpaySync({ onDone, titles }: { onDone: (r: SyncResult) => void; titles: string[] }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [page, setPage] = useState<RzpPage | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"find" | "sync" | "all" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<SyncResult | null>(null);
  const reset = () => { setLink(""); setPage(null); setName(""); setErr(null); setDone(null); setBusy(null); };
  const close = () => { setOpen(false); reset(); };
  const post = async (body: object) => {
    const r = await fetch("/api/materials/ebooks/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) throw new Error((j as { error?: string }).error || "Couldn't reach Razorpay");
    return j;
  };
  const find = async () => {
    if (!link.trim()) return;
    setBusy("find"); setErr(null);
    try { const { page: p } = await post({ link }) as { page: RzpPage }; setPage(p); setName(p.ebook); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const sync = async (all?: boolean) => {
    setBusy(all ? "all" : "sync"); setErr(null);
    try {
      const j = await post(all ? {} : { ebook: name, link }) as SyncResult;
      setDone(j); onDone(j);
      if (all) { showToast({ who: j.added ? `${j.added} order${j.added === 1 ? "" : "s"} added from Razorpay` : "Up to date with Razorpay", body: `${j.ebookPayments} e-Book payments checked${j.updated ? ` · ${j.updated} updated` : ""}` }); close(); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const isNew = !!name.trim() && !titles.some((t) => t.toLowerCase() === name.trim().toLowerCase());
  const field = "mt-1 w-full h-10 px-3 rounded-lg border border-gray-200 text-[13px] text-[#232D42] outline-none focus:border-brand placeholder:text-[#8A92A6]";
  const ghost = "h-9 px-3.5 rounded-lg border border-[#EEF0F4] bg-white text-[13px] font-medium text-[#232D42] hover:border-brand hover:text-brand disabled:opacity-60";
  const primary = "h-9 px-4 rounded-lg bg-brand text-white text-[13px] font-medium hover:bg-[#2138B0] disabled:opacity-50";
  return (
    <>
      <button onClick={() => setOpen(true)} title="Paste an e-Book's payment page link to pull its sales from Razorpay"
        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-[#EEF0F4] bg-white text-[13px] font-medium text-[#232D42] hover:border-brand hover:text-brand">
        <IconRefresh size={15} stroke={1.8} />Sync from Razorpay
      </button>
      {open && createPortal(
        <div data-overlay className="preview-scope fixed inset-0 z-[300] bg-[#232D42]/40 flex items-center justify-center p-4" onClick={() => !busy && close()}>
          <div className="bg-white rounded-2xl w-full max-w-[480px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="text-[17px] font-medium text-[#232D42]">Sync from Razorpay</div>
            {done && page ? (<>
              <div className="text-[13px] text-[#8A92A6] mt-1">{done.ebook} is up to date.</div>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="rounded-xl border border-[#EEF0F4] px-4 py-3"><div className="text-[12px] text-[#8A92A6]">Razorpay says sold</div><div className="text-[20px] font-medium text-[#232D42]">{page.sold}</div></div>
                <div className="rounded-xl border border-[#EEF0F4] px-4 py-3"><div className="text-[12px] text-[#8A92A6]">Paid orders here</div><div className="text-[20px] font-medium text-[#232D42]">{done.paidNow ?? "—"}</div></div>
              </div>
              <div className={`mt-3 text-[13px] ${done.paidNow === page.sold ? "text-[#1AA053]" : "text-[#F16A1B]"}`}>
                {done.paidNow === page.sold ? "The numbers match." : "The numbers don't match. Some sales may name a different e-Book in Razorpay's Product field, or were removed here."}
              </div>
              <div className="mt-1 text-[12px] text-[#8A92A6]">{done.added ? `${done.added} new order${done.added === 1 ? "" : "s"} added` : "No new orders"}{done.updated ? ` · ${done.updated} updated` : ""}</div>
              <div className="flex justify-end mt-5"><button onClick={close} className={primary}>Done</button></div>
            </>) : page ? (<>
              <div className="mt-4 rounded-xl border border-[#EEF0F4] px-4 py-3">
                <div className="text-[14px] font-medium text-[#232D42]">{page.title}</div>
                <div className="text-[12px] text-[#8A92A6] mt-0.5">{page.url}{page.price != null ? ` · ₹${page.price.toLocaleString("en-IN")}` : ""} · {page.sold} sold{page.active ? "" : " · page is off"}</div>
              </div>
              <label className="block text-[12px] text-[#8A92A6] mt-4">e-Book
                <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
              </label>
              {isNew && <div className="mt-1.5 text-[12px] text-[#8A92A6]">New e-Book. It will be added to the list.</div>}
              {err && <div className="mt-3 text-[13px] text-[#C03221]">{err}</div>}
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => { setPage(null); setErr(null); }} disabled={!!busy} className={ghost}>Back</button>
                <button onClick={() => void sync()} disabled={!!busy || name.trim().length < 2} className={primary}>{busy === "sync" ? "Syncing…" : "Sync"}</button>
              </div>
            </>) : (<>
              <div className="text-[13px] text-[#8A92A6] mt-1">Paste the e-Book&apos;s payment page link. Its name fills in and its sales come in.</div>
              <label className="block text-[12px] text-[#8A92A6] mt-4">Payment page link
                <input autoFocus value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void find(); }} placeholder="e.g. https://rzp.io/rzp/QatarHandbook" className={field} />
              </label>
              {err && <div className="mt-3 text-[13px] text-[#C03221]">{err}</div>}
              <div className="flex items-center gap-2 mt-5">
                <button onClick={() => void sync(true)} disabled={!!busy} className="text-[13px] text-brand font-medium hover:underline disabled:opacity-50">{busy === "all" ? "Syncing every e-Book…" : "Sync every e-Book"}</button>
                <button onClick={close} disabled={!!busy} className={`ml-auto ${ghost}`}>Cancel</button>
                <button onClick={() => void find()} disabled={!!busy || !link.trim()} className={primary}>{busy === "find" ? "Finding…" : "Find page"}</button>
              </div>
            </>)}
          </div>
        </div>, document.body)}
    </>
  );
}

export function MaterialsView({ tab }: { tab: MTab }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);   // the folder open (folders tabs)
  const upsert = (row: Row) => setRows((rs) => { const all = rs || []; return all.some((r) => r.id === row.id) ? all.map((r) => (r.id === row.id ? row : r)) : [row, ...all]; });
  const openRow = tab.folders && openId ? (rows || []).find((r) => r.id === openId) || null : null;
  // Viewer tabs (Marketing Material): Grid / List, and a click opens the file on the right.
  const [viewId, setViewId] = useState<string | null>(null);
  const [mode, setModeRaw] = useState<"list" | "grid">("list");
  useEffect(() => { try { const m = localStorage.getItem(`mm-view-${tab.key}`); if (m === "grid" || m === "list") setModeRaw(m); } catch {} }, [tab.key]);
  const setMode = (m: "list" | "grid") => { setModeRaw(m); try { localStorage.setItem(`mm-view-${tab.key}`, m); } catch {} };
  const viewRow = tab.viewer && viewId ? (rows || []).find((r) => r.id === viewId) || null : null;
  const page = tab.grid ? 48 : 100;   // picture tiles are heavier than table rows
  const [shown, setShown] = useState(page);

  const load = async () => {
    const r = await fetch(`/api/materials/${tab.key}`).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) { setError((j as { error?: string }).error || "Couldn't load this tab."); setRows([]); return; }
    setError(null); setRows((j as { rows: Row[] }).rows);
  };
  useEffect(() => { void load(); }, [tab.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // e-Book Orders: the e-Book list, including ones added on this page.
  const [titles, setTitles] = useState<string[]>([]);
  useEffect(() => {
    if (tab.key !== "ebooks") return;
    fetch("/api/materials/ebooks/titles").then((r) => r.json()).then((j: { titles?: string[] }) => setTitles(j.titles || [])).catch(() => {});
  }, [tab.key]);

  // Choices for a select / multi field: the configured ones plus every value used.
  const optionsFor = (f: MField): string[] => {
    // e-Books: the saved list (removed ones left out) once it's loaded.
    const seen = new Set(tab.key === "ebooks" && f.key === "ebook" && titles.length ? titles : f.options || []);
    for (const r of rows || []) { const v = r[f.key]; (Array.isArray(v) ? v : [v]).forEach((x) => { if (typeof x === "string" && x.trim()) seen.add(x.trim()); }); }
    return [...seen].sort((a, b) => a.localeCompare(b));
  };
  const filterFields = tab.fields.filter((f) => (f.type === "select" || f.type === "multi") && f.col !== false && f.key !== "attendees" && !(tab.key === "ebooks" && f.key === "ebook")).slice(0, 3);

  // Search + filters; `skip` leaves one filter out (for the counts on the Level tabs).
  const matches = (r: Row, skip?: string) => {
    for (const [k, v] of Object.entries(filters)) {
      if (!v || k === skip) continue;
      const cell = r[k];
      if (Array.isArray(cell) ? !cell.includes(v) : cell !== v) return false;
    }
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return tab.fields.some((f) => {
      const v = r[f.key];
      if (typeof v === "string") return v.toLowerCase().includes(needle);
      if (Array.isArray(v)) return v.some((x) => typeof x === "string" ? x.toLowerCase().includes(needle) : typeof x === "object" && x && String((x as MFile).name || "").toLowerCase().includes(needle));
      return false;
    });
  };
  const list = useMemo(() => (rows || []).filter((r) => matches(r)), [rows, q, filters, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  // Marketing Material (Praveen, 23 Oct, option A): Level as tabs with counts, the
  // other filters as dropdowns beside them.
  const levelField = tab.viewer ? tab.fields.find((f) => f.key === "education_level") : undefined;
  useEffect(() => { setShown(page); }, [q, filters, page]);
  const step = (d: number) => {
    if (!viewRow || !list.length) return;
    const i = list.findIndex((r) => r.id === viewRow.id);
    const next = list[(i + d + list.length) % list.length];
    setViewId(next.id);
    const at = list.indexOf(next);
    if (at >= shown) setShown(at + 1);
  };
  const stepRef = useRef(step); stepRef.current = step;
  // A search or filter that hides the open material moves the viewer to the first match.
  useEffect(() => { if (viewRow && !list.some((r) => r.id === viewRow.id)) setViewId(list[0]?.id ?? null); }, [list, viewRow]);
  useEffect(() => {
    if (!viewRow) return;
    const onKey = (e: KeyboardEvent) => {
      const a = e.target as HTMLElement | null;
      if (editing || document.querySelector("[data-overlay]") || (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)))) return;
      if (e.key === "Escape") setViewId(null);
      else if (e.key === "ArrowDown") { e.preventDefault(); stepRef.current(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); stepRef.current(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewRow, editing]);

  const Icon = ICONS[tab.key];
  return (
    <PreviewDashboardShell active="marketing-materials" title={tab.key === "ebooks" ? `${tab.label} (Organic Sales)` : tab.label} subtitle={tab.intro} hideAccountPicker hideRange>
      {() => (
        <div className="preview-scope space-y-4">
          {rows === null ? <div className="bg-white border border-gray-100 rounded-2xl"><LoadingBlock label={`Loading ${tab.nounPlural}…`} /></div> : <div className={tab.key === "ebooks" ? "flex gap-4 items-start" : ""}>
            {tab.key === "ebooks" && <EbookColumn names={optionsFor(tab.fields.find((f) => f.key === "ebook")!)} rows={rows} value={filters.ebook || ""} onPick={(v) => setFilters((s) => ({ ...s, ebook: v }))} onAdded={(t, name) => { setTitles(t); setFilters((s) => ({ ...s, ebook: name })); }}
              onRemoved={(t, name) => { setTitles(t); setFilters((s) => (s.ebook === name ? { ...s, ebook: "" } : s)); }} />}
            <div className={tab.key === "ebooks" ? "flex-1 min-w-0 space-y-4" : "space-y-4"}>
            <Totals tab={tab} rows={list} all={rows} />
            {openRow ? <FolderView tab={tab} row={openRow} onBack={() => setOpenId(null)} onEdit={() => setEditing(openRow)} onSaved={upsert} /> :
            <div className={viewRow ? "flex gap-4 items-start" : ""}>
            <div className={`bg-white border border-gray-100 rounded-2xl ${viewRow ? "flex-1 min-w-0" : ""}`}>
              {levelField ? (
                <div className="border-b border-gray-100">
                  <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
                    <span className="w-8 h-8 rounded-lg bg-brand-light text-brand grid place-items-center flex-shrink-0"><Icon size={16} stroke={1.8} /></span>
                    <div className="mr-2">
                      <div className="text-[14px] font-medium text-[#232D42]">{tab.label}</div>
                      <div className="text-[12px] text-[#8A92A6]">{list.length === rows.length ? `${rows.length} ${tab.nounPlural}` : `${list.length} of ${rows.length}`}</div>
                    </div>
                    <label className="ml-auto flex items-center gap-2 h-9 px-3 rounded-lg border border-gray-200 bg-white w-[240px] max-w-full">
                      <IconSearch size={15} stroke={1.8} className="text-[#8A92A6]" />
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${tab.nounPlural}…`} className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-[#232D42] placeholder:text-[#8A92A6]" />
                      {q && <button onClick={() => setQ("")} aria-label="Clear search" className="text-[#8A92A6] hover:text-[#232D42]"><IconX size={14} /></button>}
                    </label>
                    <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden" role="group" aria-label="View">
                      {([["list", "List", IconList], ["grid", "Grid", IconLayoutGrid]] as const).map(([m, label, I]) => (
                        <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} title={label}
                          className={`inline-flex items-center justify-center h-[34px] w-[36px] ${mode === m ? "bg-brand-light text-[#2138B0]" : "bg-white text-[#4A5468] hover:text-brand"}`}>
                          <I size={16} stroke={1.8} />
                        </button>
                      ))}
                    </div>
                    {tab.key === "ebooks" && <RazorpaySync onDone={(r) => { void load(); if (r.titles) setTitles(r.titles); if (r.ebook) setFilters((s) => ({ ...s, ebook: r.ebook! })); }} titles={titles} />}
                    {!viewRow && <button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-brand text-white text-[13px] font-medium hover:bg-[#2138B0]"><IconPlus size={15} stroke={2} /> Add {tab.noun}</button>}
                  </div>
                  <div className="flex flex-wrap items-end gap-x-5 gap-y-2 px-4 mt-2">
                    {[["", "All"], ...[...new Set([...(levelField.options || []), ...optionsFor(levelField)])].map((o) => [o, o])].map(([v, label]) => {
                      const on = (filters[levelField.key] || "") === v;
                      const n = (rows || []).filter((r) => matches(r, levelField.key) && (!v || r[levelField.key] === v)).length;
                      return (
                        <button key={v || "all"} type="button" onClick={() => setFilters((s) => ({ ...s, [levelField.key]: v }))}
                          className={`inline-flex items-center gap-1.5 pb-2.5 pt-1 border-b-2 text-[13px] font-medium transition ${on ? "border-brand text-[#2138B0]" : "border-transparent text-[#4A5468] hover:text-brand"}`}>
                          {label}<span className={`text-[11px] rounded-full px-1.5 ${on ? "bg-brand-light text-[#2138B0]" : "bg-[#F0F2F8] text-[#8A92A6]"}`}>{n}</span>
                        </button>
                      );
                    })}
                    <div className="ml-auto flex items-center gap-2 pb-2">
                      {filterFields.filter((f) => f.key !== levelField.key).map((f) => (
                        <PreviewSelect key={f.key} size="sm" value={filters[f.key] || ""} onChange={(v) => setFilters((s) => ({ ...s, [f.key]: v }))}
                          options={[{ value: "", label: `All ${f.label.toLowerCase() === "country" ? "countries" : f.label.toLowerCase() + "s"}` }, ...optionsFor(f).map((o) => ({ value: o, label: `${o} · ${(rows || []).filter((r) => matches(r, f.key) && r[f.key] === o).length}` }))]} ariaLabel={f.label} />
                      ))}
                    </div>
                  </div>
                </div>
              ) :
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
                <span className="w-8 h-8 rounded-lg bg-brand-light text-brand grid place-items-center flex-shrink-0"><Icon size={16} stroke={1.8} /></span>
                <div className="mr-2">
                  <div className="text-[14px] font-medium text-[#232D42]">{tab.label}</div>
                  <div className="text-[12px] text-[#8A92A6]">{list.length === rows.length ? `${rows.length} ${rows.length === 1 ? tab.noun : tab.nounPlural}` : `${list.length} of ${rows.length}`}</div>
                </div>
                <label className="flex items-center gap-2 h-9 px-3 rounded-lg border border-gray-200 bg-white flex-1 min-w-[180px] max-w-[320px]">
                  <IconSearch size={15} stroke={1.8} className="text-[#8A92A6]" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${tab.nounPlural}…`} className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-[#232D42] placeholder:text-[#8A92A6]" />
                  {q && <button onClick={() => setQ("")} aria-label="Clear search" className="text-[#8A92A6] hover:text-[#232D42]"><IconX size={14} /></button>}
                </label>
                {filterFields.map((f) => (
                  <PreviewSelect key={f.key} value={filters[f.key] || ""} onChange={(v) => setFilters((s) => ({ ...s, [f.key]: v }))}
                    options={[{ value: "", label: `All ${f.label.toLowerCase()}` }, ...optionsFor(f).map((o) => ({ value: o, label: o }))]} ariaLabel={f.label} />
                ))}
                {tab.viewer && (
                  <div className="ml-auto inline-flex border border-gray-200 rounded-lg overflow-hidden" role="group" aria-label="View">
                    {([["list", "List", IconList], ["grid", "Grid", IconLayoutGrid]] as const).map(([m, label, I]) => (
                      <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
                        className={`inline-flex items-center gap-1.5 h-[34px] px-3 text-[13px] font-medium ${mode === m ? "bg-brand-light text-[#2138B0]" : "bg-white text-[#4A5468] hover:text-brand"}`}>
                        <I size={15} stroke={1.8} /> {label}
                      </button>
                    ))}
                  </div>
                )}
                {tab.key === "ebooks" && <span className="ml-auto"><RazorpaySync onDone={(r) => { void load(); if (r.titles) setTitles(r.titles); if (r.ebook) setFilters((s) => ({ ...s, ebook: r.ebook! })); }} titles={titles} /></span>}
                {!viewRow && <button onClick={() => setEditing("new")} className={`${tab.viewer || tab.key === "ebooks" ? "" : "ml-auto "}inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-brand text-white text-[13px] font-medium hover:bg-[#2138B0]`}>
                  <IconPlus size={15} stroke={2} /> {tab.folders ? "New folder" : `Add ${tab.noun}`}
                </button>}
              </div>}
              {error && <div className="px-4 py-3 text-[13px] text-[#C03221]">{error}</div>}
              {list.length === 0 ? (
                <div className="px-4 py-14 text-center text-[13px] text-[#8A92A6]">{rows.length ? "Nothing matches — clear the search or filters." : `No ${tab.nounPlural} yet.`}</div>
              ) : tab.viewer && mode === "list" ? (
                <MaterialList rows={list.slice(0, shown)} compact={!!viewRow} selectedId={viewRow?.id} onOpen={(r) => setViewId(r.id)} />
              ) : tab.folders ? (
                <Folders rows={list.slice(0, shown)} onOpen={(r) => setOpenId(r.id)} />
              ) : tab.grid ? (
                <Grid tab={tab} rows={list.slice(0, shown)} selectedId={viewRow?.id} onOpen={tab.viewer ? (r) => setViewId(r.id) : setEditing} />
              ) : (
                <Table tab={tab} rows={list.slice(0, shown)} all={rows} onOpen={setEditing} />
              )}
              {list.length > shown && (
                <div className="px-4 py-3 border-t border-gray-100 text-center">
                  <button onClick={() => setShown((n) => n + page)} className="text-[13px] text-brand font-medium hover:underline">Show more ({list.length - shown} left)</button>
                </div>
              )}
            </div>
            {viewRow && <Viewer tab={tab} row={viewRow} pos={`${list.findIndex((r) => r.id === viewRow.id) + 1} of ${list.length}`}
              onStep={step} onEdit={() => setEditing(viewRow)} onClose={() => setViewId(null)} />}
            </div>}
            </div>
          </div>}
          {editing && <Editor tab={tab} row={editing === "new" ? null : editing} optionsFor={optionsFor}
            onClose={() => setEditing(null)}
            onSaved={(row) => { const isNew = editing === "new"; upsert(row); setEditing(null); if (isNew && tab.folders) setOpenId(row.id); }}
            onRemoved={(row) => {
              setRows((rs) => (rs || []).filter((r) => r.id !== row.id)); setEditing(null); setOpenId(null); setViewId(null);
              showToast({ who: "Removed", body: String(row.title || tab.noun), av: "✓", action: "Undo", onOpen: async () => {
                const r = await fetch(`/api/materials/${tab.key}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, restore: true }) });
                if (r.ok) void load();
              } });
            }} />}
        </div>
      )}
    </PreviewDashboardShell>
  );
}

// e-Book Orders: every e-Book down the left, Scheduler-style; a click shows only its
// orders. The count is paid orders (₹1 tests left out, same as the cards).
function EbookColumn({ names, rows, value, onPick, onAdded, onRemoved }: { names: string[]; rows: Row[]; value: string; onPick: (v: string) => void; onAdded: (titles: string[], name: string) => void; onRemoved: (titles: string[], name: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setErr(null);
    const r = await fetch("/api/materials/ebooks/titles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r || !r.ok) { setErr((j as { error?: string }).error || "Couldn't add the e-Book."); return; }
    onAdded((j as { titles: string[] }).titles, name.replace(/\s+/g, " ").trim());
    showToast({ who: "e-Book added", body: name.trim(), av: "✓" });
    setName(""); setAdding(false);
  };
  // Only an e-Book with no orders at all (paid or failed) can go; Undo brings it back.
  const remove = async (n: string) => {
    if (!(await confirmDialog({ title: `Remove ${n}?`, body: "It has no orders. It leaves this list and the order form; you can undo.", action: "Remove", danger: true }))) return;
    const call = (method: "POST" | "DELETE") => fetch("/api/materials/ebooks/titles", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n }) })
      .then(async (r) => ({ ok: r.ok, j: (await r.json().catch(() => ({}))) as { titles?: string[]; error?: string } })).catch(() => ({ ok: false, j: {} as { titles?: string[]; error?: string } }));
    const { ok, j } = await call("DELETE");
    if (!ok) { showToast({ who: "Couldn't remove", body: j.error || n }); return; }
    onRemoved(j.titles || [], n);
    showToast({ who: "e-Book removed", body: n, av: "✓", action: "Undo", onOpen: async () => {
      const back = await call("POST");
      if (back.ok) onAdded(back.j.titles || [], n);
    } });
  };
  const paid = (name: string) => rows.filter((r) => (!name || r.ebook === name) && r.status === "Paid" && (Number(r.amount) || 0) >= 10).length;
  const item = (v: string, label: string) => {
    const on = value === v; const n = paid(v);
    const removable = !!v && !rows.some((r) => r.ebook === v);
    return (
      <div key={v || "all"} className="group relative">
        <button type="button" onClick={() => onPick(v)} aria-pressed={on}
          className={`w-full flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] text-left ${on ? "bg-brand-light text-[#2138B0] font-medium" : n ? "text-[#232D42] hover:bg-[#F6F7FB]" : "text-[#8A92A6] hover:bg-[#F6F7FB]"}`}>
          <span className="flex-1 truncate">{label}</span>
          <span className={`text-[11px] rounded-full px-1.5 ${removable ? "group-hover:invisible" : ""} ${on ? "bg-white text-[#2138B0]" : "bg-[#F0F2F8] text-[#8A92A6]"}`}>{n}</span>
        </button>
        {removable && (
          <button type="button" onClick={() => void remove(v)} aria-label={`Remove ${v}`} title={`Remove ${v}`}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md grid place-items-center text-[#8A92A6] hover:text-[#C03221] hover:bg-white invisible group-hover:visible focus:visible">
            <IconTrash size={14} stroke={1.8} />
          </button>
        )}
      </div>
    );
  };
  return (
    <aside className="w-[220px] flex-shrink-0 bg-white border border-gray-100 rounded-2xl p-2 sticky top-4">
      <div className="px-3 pt-2 pb-1.5 text-[12px] text-[#8A92A6]">{names.length} e-Books</div>
      {item("", "All e-Books")}
      <div className="my-1.5 border-t border-[#EEF0F4]" />
      {names.map((n) => item(n, n))}
      <div className="my-1.5 border-t border-[#EEF0F4]" />
      {adding ? (
        <div className="px-1 pb-1 space-y-1.5">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e-Book name, e.g. Japan"
            onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") { setAdding(false); setName(""); setErr(null); } }}
            className="w-full h-9 px-3 rounded-lg border border-gray-200 text-[13px] text-[#232D42] outline-none focus:border-brand placeholder:text-[#8A92A6]" />
          {err && <div className="px-1 text-[12px] text-[#C03221]">{err}</div>}
          <div className="flex gap-1.5">
            <button type="button" onClick={() => void save()} disabled={!name.trim() || busy} className="flex-1 h-8 rounded-lg bg-brand text-white text-[13px] font-medium hover:bg-[#2138B0] disabled:opacity-50">{busy ? "Adding…" : "Add"}</button>
            <button type="button" onClick={() => { setAdding(false); setName(""); setErr(null); }} className="h-8 px-3 rounded-lg border border-gray-200 text-[13px] text-[#4A5468] hover:text-brand">Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="w-full flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] font-medium text-brand hover:bg-[#F6F7FB]">
          <IconPlus size={15} stroke={2} /> Add e-Book
        </button>
      )}
    </aside>
  );
}

// Money tabs: total, this month, count. Others: count (and this month when dated).
function Totals({ tab, rows, all }: { tab: MTab; rows: Row[]; all: Row[] }) {
  const month = thisMonth();
  const sum = (rs: Row[]) => rs.reduce((n, r) => n + (Number(r[tab.money!]) || 0), 0);
  const inMonth = tab.date ? rows.filter((r) => String(r[tab.date!] || "").startsWith(month)) : [];
  const cards: { label: string; value: string; icon: typeof IconCalendar; note?: string }[] = [];
  if (tab.key === "subscriptions") {
    const live = rows.filter((r) => r.status === "Still in use");
    cards.push({ label: "Still in use", value: String(live.length), icon: IconCheck, note: `of ${rows.length} tools` });
    cards.push({ label: "Monthly", value: String(live.filter((r) => r.frequency === "Monthly").length), icon: IconRepeat, note: "billed every month" });
    cards.push({ label: "Annual", value: String(live.filter((r) => r.frequency === "Annual").length), icon: IconCalendar, note: "billed once a year" });
  } else if (tab.key === "ebooks") {
    // Only payments that went through count as money in; failed ones are counted apart.
    // ₹1 test payments (the test page) are left out of every total.
    const real = (r: Row) => (Number(r.amount) || 0) >= 10;
    const paid = rows.filter((r) => r.status === "Paid" && real(r));
    const paidMonth = inMonth.filter((r) => r.status === "Paid" && real(r));
    cards.push({ label: "Sales", value: inr(sum(paid)), icon: IconCurrencyRupee, note: rows.length === all.length ? "all time, paid only, ₹1 tests left out" : "matching the filters" });
    cards.push({ label: "This month", value: inr(sum(paidMonth)), icon: IconCalendar, note: `${paidMonth.length} paid ${paidMonth.length === 1 ? tab.noun : tab.nounPlural}` });
    cards.push({ label: "Paid orders", value: String(paid.length), icon: IconListNumbers });
    cards.push({ label: "Failed payments", value: String(rows.filter((r) => r.status === "Failed" && real(r)).length), icon: IconAlertTriangle, note: "retry link sent" });
  } else if (tab.money) {
    cards.push({ label: "Total", value: inr(sum(rows)), icon: IconCurrencyRupee, note: rows.length === all.length ? "all time" : "matching the filters" });
    if (tab.date) cards.push({ label: "This month", value: inr(sum(inMonth)), icon: IconCalendar, note: `${inMonth.length} ${inMonth.length === 1 ? tab.noun : tab.nounPlural}` });
    cards.push({ label: tab.nounPlural[0].toUpperCase() + tab.nounPlural.slice(1), value: String(rows.length), icon: IconListNumbers });
  } else if (tab.date) {
    cards.push({ label: tab.nounPlural[0].toUpperCase() + tab.nounPlural.slice(1), value: String(rows.length), icon: IconListNumbers });
    cards.push({ label: "This month", value: String(inMonth.length), icon: IconCalendar });
  }
  if (!cards.length) return null;
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }}>
      {cards.map((c) => (
        <div key={c.label} className="bg-white border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-brand-light text-brand grid place-items-center flex-shrink-0"><c.icon size={17} stroke={1.8} /></span>
          <div className="min-w-0">
            <div className="text-[12px] text-[#8A92A6]">{c.label}</div>
            <div className="text-[18px] font-medium text-[#232D42] leading-tight">{c.value}</div>
            {c.note && <div className="text-[11.5px] text-[#8A92A6]">{c.note}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

const Chip = ({ children, tone = "brand" }: { children: React.ReactNode; tone?: "brand" | "muted" | "good" }) => (
  <span className={`inline-flex items-center max-w-full px-2 py-0.5 rounded-full text-[11.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis ${
    tone === "good" ? "bg-[#E3F5EA] text-[#1AA053]" : tone === "muted" ? "bg-[#F0F2F8] text-[#4A5468]" : "bg-brand-light text-[#2138B0]"}`}>{children}</span>
);

function Cell({ f, v }: { f: MField; v: unknown }) {
  if (f.type === "money") return <span className="tabular-nums text-[#232D42]">{v == null || v === "" ? "—" : inr(Number(v))}</span>;
  if (f.type === "date") return <span className="text-[#4A5468] whitespace-nowrap">{fmtDate(v)}</span>;
  // null = not known (e-Book orders imported from Razorpay's history, before the automation).
  if (f.type === "bool") return v ? <IconCheck size={16} stroke={2} className="text-[#1AA053]" /> : v === null ? <span className="text-[12px] text-[#8A92A6]" title="Sold before the automation — not recorded whether the folder was shared">Not known</span> : <span className="text-[#C2C8D6]">—</span>;
  if (f.type === "multi") {
    const a = Array.isArray(v) ? (v as string[]) : [];
    if (!a.length) return <span className="text-[#C2C8D6]">—</span>;
    return <span className="flex flex-wrap gap-1">{a.slice(0, 3).map((x) => <Chip key={x}>{x}</Chip>)}{a.length > 3 && <Chip tone="muted">+{a.length - 3}</Chip>}</span>;
  }
  if (f.type === "select") {
    if (!v) return <span className="text-[#C2C8D6]">—</span>;
    return <Chip tone={v === "Still in use" ? "good" : f.key === "status" || f.key === "frequency" || f.key === "billing" || f.key === "owner" ? "muted" : "brand"}>{String(v)}</Chip>;
  }
  if (f.type === "files") {
    const a = Array.isArray(v) ? (v as MFile[]) : [];
    if (!a.length) return <span className="text-[#C2C8D6]">—</span>;
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); openRefPreview(a.map((x) => ({ url: x.url, title: x.name, from: f.label }))); }}
        className="inline-flex items-center gap-1 text-[12.5px] text-brand hover:underline">
        <IconPaperclip size={14} stroke={1.8} /> {a.length === 1 ? "1 file" : `${a.length} files`}
      </button>
    );
  }
  return <span className="text-[#4A5468] line-clamp-2">{v ? String(v) : <span className="text-[#C2C8D6]">—</span>}</span>;
}

function Table({ tab, rows, all, onOpen }: { tab: MTab; rows: Row[]; all: Row[]; onOpen: (r: Row) => void }) {
  const title = tab.fields.find((f) => f.key === "title")!;
  // A column nobody has filled in (Subscriptions' Amount, for now) only adds dashes.
  const filled = (f: MField) => all.some((r) => { const v = r[f.key]; return Array.isArray(v) ? v.length > 0 : v != null && v !== "" && v !== false; });
  const cols = tab.fields.filter((f) => f.col && filled(f));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-[#8A92A6]">
            <th className="font-medium px-4 py-2.5">{title.label}</th>
            {cols.map((f) => <th key={f.key} className={`font-medium px-3 py-2.5 ${f.type === "money" ? "text-right" : ""}`}>{f.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => onOpen(r)} className="border-t border-gray-100 hover:bg-[#F7F8FC] cursor-pointer align-middle">
              <td className="px-4 py-2.5 font-medium text-[#232D42] min-w-[180px]">{String(r.title || "") || <span className="text-[#C2C8D6]">Untitled</span>}</td>
              {cols.map((f) => <td key={f.key} className={`px-3 py-2.5 ${f.type === "money" ? "text-right" : ""}`}><Cell f={f} v={r[f.key]} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Thumb({ file }: { file?: MFile }) {
  if (!file) return <div className="h-full grid place-items-center text-[#C2C8D6]"><IconPhoto size={26} stroke={1.5} /></div>;
  // eslint-disable-next-line @next/next/no-img-element
  if (isImage(file)) return <img src={thumbUrl(file.url)} alt="" loading="lazy" decoding="async" className="w-full h-full object-contain" />;
  if (isPdf(file.url, file.mime)) return <PdfThumb url={file.url} width={240} fallback={<div className="h-full grid place-items-center text-[#8A92A6]"><IconFileText size={26} stroke={1.5} /></div>} />;
  return <div className="h-full grid place-items-center text-[#8A92A6] text-[11px] uppercase gap-1"><IconFileText size={26} stroke={1.5} />{file.name.split(".").pop()}</div>;
}

function Grid({ tab, rows, onOpen, selectedId }: { tab: MTab; rows: Row[]; onOpen: (r: Row) => void; selectedId?: string }) {
  const chips = tab.fields.filter((f) => f.col && f.type === "select");
  return (
    <div className="p-4 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
      {rows.map((r) => {
        const fs = filesOf(r);
        return (
          <button key={r.id} type="button" onClick={() => onOpen(r)} className={`text-left border rounded-xl overflow-hidden bg-white hover:border-brand transition ${r.id === selectedId ? "border-brand" : "border-gray-100"}`}>
            <div className="relative h-[150px] bg-[#F0F2F8] overflow-hidden">
              <Thumb file={fs[0]} />
              {fs.length > 1 && <span className="absolute top-2 right-2 text-[11px] bg-[rgba(35,45,66,.6)] text-white rounded-md px-1.5">{fs.length} files</span>}
              {r.non_usable === true && <span className="absolute top-2 left-2 text-[11px] bg-[#FDECEC] text-[#C03221] rounded-md px-1.5">Not usable</span>}
            </div>
            <div className="px-3 py-2.5">
              <div className="text-[13px] font-medium text-[#232D42] truncate">{String(r.title || "") || fs[0]?.name || "Untitled"}</div>
              {(chips.some((f) => r[f.key]) || r.design_files === true) && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {chips.map((f) => (r[f.key] ? <Chip key={f.key} tone={f.key === "education_level" ? "muted" : "brand"}>{String(r[f.key])}</Chip> : null))}
                  {r.design_files === true && <Chip tone="muted">Design files</Chip>}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

const mb = (n?: number) => (n ? (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`) : "—");
const VersionChip = ({ v }: { v: unknown }) => (v === "Final" ? <Chip tone="good">Final</Chip> : v ? <span className="inline-flex px-2 py-0.5 rounded-full text-[11.5px] font-medium bg-[#FFF4E0] text-[#B5730A] whitespace-nowrap">{String(v)}</span> : <span className="text-[#C2C8D6]">—</span>);

function MiniThumb({ file }: { file?: MFile }) {
  return (
    <div className="w-[40px] h-[52px] rounded-md overflow-hidden bg-[#F0F2F8] border border-gray-100 flex-shrink-0">
      {!file ? null : isImage(file)
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={thumbUrl(file.url)} alt="" loading="lazy" decoding="async" className="w-full h-full object-contain" />
        : isPdf(file.url, file.mime)
          ? <PdfThumb url={file.url} width={40} badge={false} fallback={<div className="h-full grid place-items-center text-[9px] font-medium text-[#8A92A6]">PDF</div>} />
          : <div className="h-full grid place-items-center text-[9px] font-medium text-[#8A92A6] uppercase">{file.name.split(".").pop()}</div>}
    </div>
  );
}

// List view (Marketing Material, option A): one clean line per material — small
// first-page preview, the name, then country · level · files, version, date.
function MaterialList({ rows, selectedId, onOpen }: { rows: Row[]; compact?: boolean; selectedId?: string; onOpen: (r: Row) => void }) {
  return (
    <div>
      {rows.map((r) => {
        const fs = filesOf(r);
        const on = r.id === selectedId;
        const meta = [r.country, r.education_level, `${fs.length} file${fs.length === 1 ? "" : "s"}`].filter(Boolean) as string[];
        return (
          <button key={r.id} type="button" onClick={() => onOpen(r)}
            className={`w-full flex items-center gap-3 px-4 py-2.5 border-t border-gray-100 first:border-t-0 text-left transition ${on ? "bg-brand-light" : "hover:bg-[#F7F8FC]"}`}>
            <MiniThumb file={fs[0]} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-[#232D42] truncate">{String(r.title || "") || fs[0]?.name || "Untitled"}</div>
              <div className="flex items-center gap-1.5 mt-0.5 text-[11.5px] text-[#8A92A6] min-w-0">
                {meta.map((m, i) => <span key={i} className="flex items-center gap-1.5 whitespace-nowrap">{i > 0 && <span className="w-[3px] h-[3px] rounded-full bg-[#C2C8D6]" />}{m}</span>)}
              </div>
            </div>
            {r.version ? <VersionChip v={r.version} /> : null}
            <span className="text-[12px] text-[#4A5468] whitespace-nowrap ml-2">{fmtDate(String(r.updated_at || ""))}</span>
          </button>
        );
      })}
    </div>
  );
}

// The file, large, on the right: every page scrolls and zooms (the browser's own PDF
// viewer), tabs when it has more than one file, ‹ › to the next material, and its
// details underneath — Version and the editable source among them (Praveen, 23 Oct).
function Viewer({ tab, row, pos, onStep, onEdit, onClose }: { tab: MTab; row: Row; pos: string; onStep: (d: number) => void; onEdit: () => void; onClose: () => void }) {
  const files = filesOf(row);
  const [ix, setIx] = useState(0);
  useEffect(() => { setIx(0); }, [row.id]);
  const f = files[Math.min(ix, Math.max(0, files.length - 1))];
  const name = String(row.title || "") || f?.name || "Untitled";
  const src = typeof row.source_url === "string" && row.source_url ? (/^https?:\/\//i.test(row.source_url) ? row.source_url : `https://${row.source_url}`) : "";
  const Icon = ICONS[tab.key];
  const k = (label: string, v: React.ReactNode) => <div className="min-w-0"><div className="text-[11px] text-[#8A92A6]">{label}</div><div className="text-[12.5px] font-medium text-[#232D42] mt-0.5 truncate">{v}</div></div>;
  return (
    <aside className="w-[58%] flex-shrink-0 sticky top-4 h-[calc(100vh-32px)] flex flex-col bg-white border border-gray-100 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <span className="w-8 h-8 rounded-lg bg-brand-light text-brand grid place-items-center flex-shrink-0"><Icon size={16} stroke={1.8} /></span>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-medium text-[#232D42] truncate" title={name}>{name}</div>
          <div className="flex items-center gap-1 mt-0.5">
            {row.country ? <Chip>{String(row.country)}</Chip> : null}
            {row.education_level ? <Chip tone="muted">{String(row.education_level)}</Chip> : null}
            <span className="text-[11.5px] text-[#8A92A6] ml-1">{pos}</span>
          </div>
        </div>
        <button onClick={() => onStep(-1)} title="Previous (↑)" className="w-8 h-8 rounded-lg border border-gray-200 grid place-items-center text-[#4A5468] hover:border-brand hover:text-brand"><IconChevronLeft size={15} /></button>
        <button onClick={() => onStep(1)} title="Next (↓)" className="w-8 h-8 rounded-lg border border-gray-200 grid place-items-center text-[#4A5468] hover:border-brand hover:text-brand"><IconChevronRight size={15} /></button>
        {f && <a href={f.url} target="_blank" rel="noreferrer" data-ref-preview-skip className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-gray-200 text-[12.5px] font-medium text-[#4A5468] hover:border-brand hover:text-brand">Open <IconExternalLink size={13} /></a>}
        {f && <a href={f.url} download data-ref-preview-skip className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-gray-200 text-[12.5px] font-medium text-[#4A5468] hover:border-brand hover:text-brand"><IconDownload size={13} /> Download</a>}
        <button onClick={onClose} title="Close (Esc)" className="w-8 h-8 rounded-lg border border-gray-200 grid place-items-center text-[#4A5468] hover:border-brand hover:text-brand"><IconX size={15} /></button>
      </div>
      {files.length > 1 && (
        <div className="flex gap-1.5 px-4 py-2 border-b border-gray-100 bg-[#FAFBFD] overflow-x-auto">
          {files.map((x, j) => (
            <button key={`${x.url}-${j}`} onClick={() => setIx(j)} className={`h-7 px-2.5 rounded-lg border text-[12px] whitespace-nowrap max-w-[260px] truncate ${j === ix ? "border-brand bg-brand-light text-[#2138B0]" : "border-gray-200 bg-white text-[#4A5468] hover:border-brand"}`}>File {j + 1} · {x.name}</button>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0 bg-[#525659]">
        {!f ? <div className="h-full grid place-items-center text-[13px] text-white/70">No file yet — use Edit details to add one.</div>
          : isPdf(f.url, f.mime) ? <iframe key={f.url} src={`${f.url}#view=FitH`} title={f.name} className="w-full h-full border-0 block" />
          // eslint-disable-next-line @next/next/no-img-element
          : isImage(f) ? <img key={f.url} src={f.url} alt={f.name} className="w-full h-full object-contain" loading="lazy" decoding="async" />
          : (f.mime || "").startsWith("video/") ? <video key={f.url} src={f.url} controls autoPlay playsInline className="w-full h-full" />
          : <div className="h-full grid place-items-center text-center text-[13px] text-white/80"><div>This file can&apos;t be shown here.<br /><a href={f.url} download className="inline-flex mt-3 h-8 px-3 items-center rounded-lg bg-brand text-white font-medium">Download</a></div></div>}
      </div>
      <div className="border-t border-gray-100 px-4 py-3 grid grid-cols-4 gap-x-4 gap-y-2.5">
        {k("Version", <VersionChip v={row.version} />)}
        {k("Editable source", src ? <a href={src} target="_blank" rel="noreferrer" data-ref-preview-skip className="text-brand hover:underline">Open in Canva ↗</a> : <button onClick={onEdit} className="text-brand hover:underline font-medium">+ Add Canva link</button>)}
        {k("Type", String(row.kind || "—"))}
        {k("Size", String(row.dimensions || "—"))}
        {k("File", f?.name || "—")}
        {k("File size", mb(f?.size))}
        {k("Last changed", fmtDate(String(row.updated_at || "")))}
        <div className="flex items-end"><button onClick={onEdit} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 text-[12.5px] font-medium text-[#4A5468] hover:border-brand hover:text-brand"><IconPencil size={14} stroke={1.8} /> Edit details</button></div>
      </div>
    </aside>
  );
}

// Folders tab (Essential Photos): each row as a folder, like on a computer — a folder
// shape with a peek of the first photos inside, its name and how many files it holds.
function Folders({ rows, onOpen }: { rows: Row[]; onOpen: (r: Row) => void }) {
  return (
    <div className="p-4 grid gap-x-4 gap-y-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
      {rows.map((r) => {
        const fs = filesOf(r);
        const peek = fs.filter(isImage).slice(0, 4);
        return (
          <button key={r.id} type="button" onClick={() => onOpen(r)} className="group text-left">
            <div className="relative pt-3">
              <span className="absolute top-0 left-0 w-[42%] h-5 rounded-t-lg bg-brand/20 group-hover:bg-brand/30 transition" />
              <div className="relative h-[132px] rounded-xl rounded-tl-none bg-brand-light border border-brand/10 group-hover:border-brand/50 transition p-2 overflow-hidden">
                {peek.length ? (
                  <div className={`grid gap-1 h-full ${peek.length > 1 ? "grid-cols-2" : ""} ${peek.length > 2 ? "grid-rows-2" : ""}`}>
                    {peek.map((f, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={thumbUrl(f.url)} alt="" loading="lazy" decoding="async"
                        className={`w-full h-full object-cover rounded-md bg-white ${peek.length === 3 && i === 0 ? "row-span-2" : ""}`} />
                    ))}
                  </div>
                ) : (
                  <div className="h-full grid place-items-center text-brand/60"><IconFolder size={40} stroke={1.3} /></div>
                )}
                {r.non_usable === true && <span className="absolute bottom-2 left-2 text-[11px] bg-[#FDECEC] text-[#C03221] rounded-md px-1.5">Not usable</span>}
              </div>
            </div>
            <div className="mt-2 px-0.5 flex items-start gap-1.5">
              <IconFolder size={15} stroke={1.8} className="text-brand flex-shrink-0 mt-[2px]" />
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-[#232D42] truncate">{String(r.title || "") || fs[0]?.name || "Untitled folder"}</div>
                <div className="text-[11.5px] text-[#8A92A6]">{fs.length === 1 ? "1 file" : `${fs.length} files`}{r.design_files === true ? " · design files" : ""}</div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// An open folder: every file in it, big. Drop, paste (Ctrl/Cmd+V) or pick files to add
// them; ✕ takes one out. Each change saves straight away.
function FolderView({ tab, row, onBack, onEdit, onSaved }: { tab: MTab; row: Row; onBack: () => void; onEdit: () => void; onSaved: (r: Row) => void }) {
  const files = filesOf(row);
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const saveFiles = async (next: MFile[]) => {
    const r = await fetch(`/api/materials/${tab.key}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, values: { files: next } }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) { setErr((j as { error?: string }).error || "Couldn't save — try again."); return; }
    onSaved((j as { row: Row }).row);
  };
  const add = async (picked: FileList | File[]) => {
    const list = Array.from(picked);
    if (!list.length) return;
    setErr(null); setBusy(list.length);
    const added: MFile[] = [];
    for (const f of list) {
      const res = await uploadMaterialFile(tab.key, f);
      setBusy((n) => n - 1);
      if (res.ok) added.push(res.file); else setErr(`${f.name}: ${res.error}`);
    }
    if (added.length) await saveFiles([...filesOf(row), ...added]);
  };
  const remove = async (i: number) => {
    if (!(await confirmDialog({ title: "Take this file out of the folder?", body: files[i]?.name, action: "Remove", danger: true }))) return;
    await saveFiles(files.filter((_, j) => j !== i));
  };
  // Paste a copied image or screenshot straight into the open folder.
  const addRef = useRef(add); addRef.current = add;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const fs = Array.from(e.clipboardData?.files || []);
      const a = document.activeElement as HTMLElement | null;
      if (!fs.length || document.querySelector("[data-overlay]") || (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)))) return;
      e.preventDefault();
      void addRef.current(pastedName(fs));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);
  const name = String(row.title || "") || files[0]?.name || "Untitled folder";
  return (
    <div className={`bg-white border rounded-2xl transition ${over ? "border-brand" : "border-gray-100"}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files); }}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
        <button onClick={onBack} className="inline-flex items-center gap-1 h-9 pl-2 pr-3 rounded-lg border border-gray-200 text-[13px] font-medium text-[#4A5468] hover:border-brand hover:text-brand">
          <IconChevronLeft size={15} stroke={2} /> {tab.label}
        </button>
        <span className="w-8 h-8 rounded-lg bg-brand-light text-brand grid place-items-center flex-shrink-0 ml-1"><IconFolder size={16} stroke={1.8} /></span>
        <div className="min-w-0 mr-2">
          <div className="text-[14px] font-medium text-[#232D42] truncate">{name}</div>
          <div className="text-[12px] text-[#8A92A6]">{busy ? `Uploading ${busy} file${busy === 1 ? "" : "s"}…` : `${files.length} file${files.length === 1 ? "" : "s"} · drop or paste photos here to add them`}</div>
        </div>
        <button onClick={onEdit} className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 text-[13px] font-medium text-[#4A5468] hover:border-brand hover:text-brand"><IconPencil size={15} stroke={1.8} /> Rename / details</button>
        <label className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-brand text-white text-[13px] font-medium hover:bg-[#2138B0] cursor-pointer">
          <IconUpload size={15} stroke={2} /> Add photos
          <input type="file" multiple hidden accept="image/*,video/*,.pdf,.docx,.xlsx,.pptx,.csv" onChange={(e) => { if (e.target.files?.length) void add(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      {err && <div className="px-4 py-2 bg-[#FDECEC] text-[12.5px] text-[#C03221]">{err}</div>}
      {typeof row.description === "string" && row.description && <div className="px-4 pt-3 text-[13px] text-[#4A5468] whitespace-pre-wrap">{row.description}</div>}
      {files.length === 0 ? (
        <div className="m-4 py-14 rounded-xl border-2 border-dashed border-[#C8D0F5] bg-[#F7F8FE] text-center text-[13px] text-[#8A92A6]">This folder is empty — drop or paste photos here, or use Add photos.</div>
      ) : (
        <div className="p-4 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
          {files.map((f, i) => (
            <div key={`${f.url}-${i}`} className="group relative border border-gray-100 rounded-xl overflow-hidden bg-white hover:border-brand transition">
              <button type="button" className="block w-full h-[170px] bg-[#F0F2F8]" title={f.name}
                onClick={() => openRefPreview(files.map((x) => ({ url: x.url, title: x.name, from: name })), i)}>
                <Thumb file={f} />
              </button>
              {f.non_usable && <span className="absolute top-2 left-2 text-[11px] bg-[#FDECEC] text-[#C03221] rounded-md px-1.5">Not usable</span>}
              <div className="px-3 py-2">
                <div className="text-[12px] text-[#4A5468] truncate">{f.name}</div>
                {f.note && <div className="text-[11.5px] text-[#8A92A6] mt-0.5 line-clamp-2" title={f.note}>{f.note}</div>}
              </div>
              <button type="button" onClick={() => void remove(i)} title="Take out of the folder"
                className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-[rgba(35,45,66,.6)] text-white grid place-items-center opacity-0 group-hover:opacity-100 transition"><IconX size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// The side window: every field of the tab, saved together.
function Editor({ tab, row, optionsFor, onClose, onSaved, onRemoved }: {
  tab: MTab; row: Row | null; optionsFor: (f: MField) => string[];
  onClose: () => void; onSaved: (r: Row) => void; onRemoved: (r: Row) => void;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() => {
    const d: Record<string, unknown> = {};
    for (const f of tab.fields) d[f.key] = row ? row[f.key] : f.type === "multi" || f.type === "files" ? [] : f.type === "bool" ? false : "";
    return d;
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = !row || tab.fields.some((f) => JSON.stringify(draft[f.key] ?? null) !== JSON.stringify(row[f.key] ?? (f.type === "multi" || f.type === "files" ? [] : null)));

  const close = async () => {
    if (dirty && row && !(await confirmDialog({ title: "Discard your changes?", body: "They haven't been saved.", action: "Discard", danger: true }))) return;
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[data-overlay]")) void close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const save = async () => {
    if (!String(draft.title || "").trim()) { setErr("Give it a name first."); return; }
    setSaving(true); setErr(null);
    const r = await fetch(`/api/materials/${tab.key}`, {
      method: row ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row ? { id: row.id, values: draft } : { values: draft }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setSaving(false);
    if (!r || !r.ok) { setErr((j as { error?: string }).error || "Couldn't save — try again."); return; }
    onSaved((j as { row: Row }).row);
  };
  const remove = async () => {
    if (!row) return;
    if (!(await confirmDialog({ title: `Remove this ${tab.noun}?`, body: `"${String(row.title || "")}" is taken off the list. You can undo it straight after.`, action: "Remove", danger: true }))) return;
    const r = await fetch(`/api/materials/${tab.key}?id=${row.id}`, { method: "DELETE" }).catch(() => null);
    if (!r || !r.ok) { setErr("Couldn't remove it — try again."); return; }
    onRemoved(row);
  };
  const addFiles = async (picked: FileList | File[], key: string) => {
    const list = Array.from(picked);
    setUploading((n) => n + list.length);
    for (const f of list) {
      const res = await uploadMaterialFile(tab.key, f);
      setUploading((n) => n - 1);
      if (!res.ok) { setErr(`${f.name}: ${res.error}`); continue; }
      setDraft((d) => ({ ...d, [key]: [...((d[key] as MFile[]) || []), res.file] }));
    }
  };

  const input = "w-full h-9 px-3 rounded-lg border border-gray-200 bg-white text-[13px] text-[#232D42] outline-none focus:border-brand";
  const field = (f: MField) => {
    const v = draft[f.key];
    if (f.type === "files") {
      const files = (v as MFile[]) || [];
      return (
        <FilesCard title={f.label} count={`${files.length} file${files.length === 1 ? "" : "s"}`} drop={tab.grid}
          accept="image/*,video/*,.pdf,.docx,.xlsx,.pptx,.csv" onFiles={(fl) => void addFiles(fl, f.key)}
          busyText={uploading ? `Uploading ${uploading} file${uploading === 1 ? "" : "s"}…` : undefined}
          tiles={files.map((x, i): FileTile => ({ key: `${x.url}-${i}`, name: x.name, url: x.url, kind: fileKind(x),
            onRemove: () => set(f.key, files.filter((_, j) => j !== i)) }))} />
      );
    }
    if (f.type === "longtext") return <textarea value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} rows={f.key === "minutes" ? 14 : 4} className={`${input} h-auto py-2 leading-relaxed resize-y`} />;
    if (f.type === "bool") return (
      <button type="button" role="switch" aria-checked={!!v} onClick={() => set(f.key, !v)} className={`relative w-10 h-6 rounded-full transition ${v ? "bg-brand" : "bg-gray-200"}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${v ? "left-[18px]" : "left-0.5"}`} />
      </button>
    );
    if (f.type === "select") return (
      <PreviewSelect value={String(v ?? "")} onChange={(x) => set(f.key, x)} placeholder={`Choose ${f.label.toLowerCase()}…`}
        className="w-full font-normal [&>span]:flex-1 [&>span]:text-left"
        options={[...(v ? [{ value: "", label: "Clear" }] : []), ...optionsFor(f).map((o) => ({ value: o, label: o }))]}
        addOption={{ label: `Add a ${f.label.toLowerCase()}`, onAdd: (x) => set(f.key, x.trim()) }} />
    );
    if (f.type === "multi") {
      const sel = (v as string[]) || [];
      const opts = [...new Set([...optionsFor(f), ...sel])];
      return (
        <div className="flex flex-wrap gap-1.5">
          {opts.map((o) => {
            const on = sel.includes(o);
            return <button key={o} type="button" onClick={() => set(f.key, on ? sel.filter((x) => x !== o) : [...sel, o])}
              className={`px-2.5 py-1 rounded-full text-[12px] font-medium border transition ${on ? "bg-brand-light border-brand text-[#2138B0]" : "bg-white border-gray-200 text-[#4A5468] hover:border-brand"}`}>{o}</button>;
          })}
          <AddChip onAdd={(x) => { if (!sel.includes(x)) set(f.key, [...sel, x]); }} />
        </div>
      );
    }
    return <input type={f.type === "date" ? "date" : f.type === "money" ? "number" : "text"} step={f.type === "money" ? "0.01" : undefined}
      value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} className={input} inputMode={f.type === "money" ? "decimal" : undefined} />;
  };

  const Icon = ICONS[tab.key];
  return createPortal(
    <div className="fixed inset-0 z-[300] bg-black/30 flex justify-end" onClick={() => void close()}>
      <div className="preview-scope h-full w-full bg-[#F6F7FB] flex flex-col border-l border-gray-100" style={{ maxWidth: 560, margin: 0 }} onClick={(e) => e.stopPropagation()} data-ref-dock>
        <div className="flex items-center gap-3 px-5 py-4 bg-white border-b border-gray-100">
          <span className="w-8 h-8 rounded-lg bg-brand-light text-brand grid place-items-center"><Icon size={16} stroke={1.8} /></span>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-[#8A92A6]">{tab.label}</div>
            <div className="text-[15px] font-medium text-[#232D42] truncate">{row ? String(row.title || "Untitled") : `New ${tab.noun}`}</div>
          </div>
          {/* Save sits up here: the team's Comment button covers the bottom-right corner. */}
          <button onClick={() => void save()} disabled={saving || uploading > 0 || !dirty} className="h-9 px-4 rounded-lg bg-brand text-white text-[13px] font-medium hover:bg-[#2138B0] disabled:opacity-50">
            {saving ? "Saving…" : row ? "Save changes" : `Add ${tab.noun}`}
          </button>
          <button onClick={() => void close()} aria-label="Close" className="w-9 h-9 rounded-lg border border-gray-200 grid place-items-center text-[#4A5468] hover:border-brand hover:text-brand"><IconX size={15} /></button>
        </div>
        {err && <div className="px-5 py-2 bg-[#FDECEC] text-[12.5px] text-[#C03221]">{err}</div>}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-4">
            {tab.fields.filter((f) => f.type !== "files").map((f) => (
              <label key={f.key} className="block" onClick={(e) => { if (f.type === "bool" || f.type === "multi" || f.type === "select") e.preventDefault(); }}>
                <div className="text-[12px] text-[#8A92A6] mb-1.5">{f.label}{f.key === "title" && <span className="text-[#C03221]"> *</span>}</div>
                {field(f)}
                {f.key === "card_last4" && <div className="text-[11.5px] text-[#8A92A6] mt-1">Only the last 4 digits are kept — never the full card number.</div>}
              </label>
            ))}
          </div>
          {tab.fields.filter((f) => f.type === "files").map((f) => <div key={f.key}>{field(f)}</div>)}
          {row && (
            <div className="flex items-center gap-3 px-1 pb-14">
              <span className="text-[11.5px] text-[#8A92A6]">{row.created_by === "airtable" ? "Copied from Airtable" : "Added in the dashboard"} · last changed {fmtDate(String(row.updated_at || ""))}</span>
              <button onClick={() => void remove()} className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#F3C6CE] text-[#C03221] text-[12.5px] font-medium hover:bg-[#FDECEC]"><IconTrash size={14} stroke={1.8} /> Remove</button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AddChip({ onAdd }: { onAdd: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="px-2.5 py-1 rounded-full text-[12px] font-medium border border-dashed border-gray-300 text-brand hover:border-brand">+ Add</button>;
  const done = () => { if (v.trim()) onAdd(v.trim()); setV(""); setOpen(false); };
  return <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={done} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); done(); } if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}
    className="h-7 w-[140px] px-2.5 rounded-full border border-brand text-[12px] outline-none" placeholder="Type and press Enter" />;
}
