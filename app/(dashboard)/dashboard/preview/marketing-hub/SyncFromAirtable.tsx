"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconRefresh, IconAlertTriangle, IconCheck, IconChevronDown, IconSearch } from "@tabler/icons-react";
import { Overlay } from "@/app/(dashboard)/dashboard/preview/Overlay";
import { PreviewDatePicker } from "@/app/(dashboard)/dashboard/preview/PreviewDatePicker";

// Pull a window of Airtable's Content Calendar into the master sheet.
//
// A date range and a button, rather than a background job. The team plans months
// ahead in Airtable; nobody wants all 4,294 rows, they want September.
//
// Check first, then import: the same request runs twice, once counting and once
// writing, so nobody presses a button that writes to 400 rows without being told
// how many and what will happen to them.

type FacetKey = "owner" | "collaborators" | "type" | "status" | "sbu";
type Facets = Record<FacetKey, { value: string; count: number }[]>;
type Result = {
  inRange: number; facets: Facets;
  scanned: number; created: number; updated: number;
  skipped: { reason: string; count: number }[];
  errors: string[];
};

// The Airtable fields the team filters by, in the order they filter.
const FILTERS: { key: FacetKey; label: string; all: string }[] = [
  { key: "owner", label: "Owner", all: "All owners" },
  { key: "collaborators", label: "Collaborators", all: "All collaborators" },
  { key: "type", label: "Type", all: "All types" },
  { key: "status", label: "Status", all: "All statuses" },
  { key: "sbu", label: "Primary Interest / SBU", all: "All interests" },
];

// This modal portals to <body>, outside .preview-scope, where `bg-brand` resolves
// to the old purple — so the dashboard blue is spelled out here.
const BLUE = "#3A57E8";

// Local calendar date, not toISOString(): that converts to UTC, and midnight on
// the 1st in India is still the previous day in UTC — the default range opened
// as 31 Aug – 29 Sep instead of 1 – 30 Sep, dropping the month's last day.
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function SyncFromAirtable({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const now = new Date();
  // Empty = everything in the Airtable view; the dates only narrow it.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filters, setFilters] = useState<Partial<Record<FacetKey, string[]>>>({});
  const [busy, setBusy] = useState<"check" | "run" | null>(null);
  const [facets, setFacets] = useState<{ inRange: number; facets: Facets; scanned: number } | null>(null);
  const [loadingFacets, setLoadingFacets] = useState(false);
  const [preview, setPreview] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const post = async (extra: Record<string, unknown>) => {
    // If the browser can't reach the dashboard server at all, fetch throws a bare
    // "Failed to fetch"; say what it means instead.
    const r = await fetch("/api/marketing-hub/import", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ from, to, filters, ...extra }),
    }).catch(() => { throw new Error("Lost connection to the dashboard server. Nothing was imported — try again."); });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
    return d as Result;
  };

  // Filter options come from the records actually in the chosen dates, with counts,
  // and the match count updates as filters are picked.
  useEffect(() => {
    if (!open || (from && to && from > to)) return;
    let live = true;
    setLoadingFacets(true);
    post({ facetsOnly: true })
      .then((d) => { if (live) { setFacets(d); setError(null); } })
      .catch((e) => { if (live) setError((e as Error).message); })
      .finally(() => { if (live) setLoadingFacets(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, from, to, JSON.stringify(filters)]);

  const call = async (dryRun: boolean) => {
    setBusy(dryRun ? "check" : "run"); setError(null);
    try {
      const d = await post({ dryRun });
      if (dryRun) { setPreview(d); setDone(null); } else { setDone(d); setPreview(null); onImported(); }
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  };

  const reset = () => { setPreview(null); setDone(null); };
  const toggle = (key: FacetKey, value: string) => {
    setFilters((f) => {
      const cur = f[key] || [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...f, [key]: next };
    });
    reset();
  };
  const activeCount = Object.values(filters).reduce((n, v) => n + (v?.length || 0), 0);

  return (
    <>
      <button onClick={() => { setOpen(true); setPreview(null); setDone(null); setError(null); }}
        title="Copy a date range of Airtable's Content Calendar into this sheet"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-white bg-brand rounded-lg px-3 py-1.5 hover:bg-brand-dark">
        <IconRefresh size={14} stroke={1.9} /> Sync from Airtable
      </button>

      {open && (
        <Overlay onClose={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ boxShadow: "0 24px 60px rgba(35,45,66,.24)" }}
            className="mt-[6vh] w-full max-w-[760px] bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <header className="px-5 py-4 bg-[#E9ECFB] border-b border-gray-100">
              <h3 className="text-[16px] font-medium text-[#232D42]">Sync from Airtable</h3>
              <p className="mt-1 text-[14px] leading-relaxed text-[#4A5468]">
                Imports the tasks in the Airtable view <span className="font-medium text-[#232D42]">Task Dashboard</span> (Content
                Calendar). Change that view&apos;s filters in Airtable to change what comes in; narrow it further
                here if you need to. Nothing is written back to Airtable.
              </p>
            </header>

            <div className="px-5 py-4 space-y-4 max-h-[62vh] overflow-y-auto">
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="w-[160px] text-[12px] font-medium text-[#8A92A6] uppercase tracking-wide">Publishing date</span>
                  <PreviewDatePicker value={from} onChange={(v) => { setFrom(v); reset(); }} size="sm" max={to || undefined} placeholder="Any date" />
                  <span className="text-[12px] text-[#A6ACBE]">to</span>
                  <PreviewDatePicker value={to} onChange={(v) => { setTo(v); reset(); }} size="sm" min={from || undefined} placeholder="Any date" />
                </div>
                {/* Pick the two dates and that is the range. There used to be All dates /
                    This month / Last month / Next month shortcuts next to them, which only
                    raised the question of which one was in force. Leaving a date empty means
                    that end is not bounded, and each picker clears itself. */}
              </div>

              <div className="border-t border-gray-100 pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium text-[#232D42]">Filters</span>
                  <span className="text-[12px] text-[#8A92A6]">
                    {loadingFacets ? "Reading Airtable…" : facets ? `${facets.scanned} of ${facets.inRange} tasks in the view match` : ""}
                  </span>
                  {activeCount > 0 && (
                    <button onClick={() => { setFilters({}); reset(); }} className="ml-auto text-[12px] text-[#8A92A6] hover:text-[#232D42]">Clear filters</button>
                  )}
                </div>
                {FILTERS.map(({ key, label, all }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-[160px] shrink-0 text-[12px] font-medium text-[#8A92A6] uppercase tracking-wide">{label}</span>
                    <MultiDropdown label={label} placeholder={all} options={facets?.facets[key] || []} picked={filters[key] || []} loading={loadingFacets}
                      onToggle={(v) => toggle(key, v)} onClear={() => { setFilters((f) => ({ ...f, [key]: [] })); reset(); }} />
                  </div>
                ))}
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded bg-[#FDECEA] border border-[#F5C6C0] px-3 py-2.5">
                  <IconAlertTriangle size={15} stroke={1.9} className="text-[#C0392B] shrink-0 mt-[1px]" />
                  <span className="text-[14px] text-[#C0392B]">{error}</span>
                </div>
              )}

              {preview && <Summary r={preview} heading={`${preview.scanned} record${preview.scanned === 1 ? "" : "s"} will be imported`} />}
              {done && (
                <div className="rounded bg-[#E8F6F0] border border-[#BFE6D4] px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[14px] font-medium text-[#2F9E6F]">
                    <IconCheck size={15} stroke={2.2} /> Imported
                  </div>
                  <Summary r={done} heading="" bare />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 px-5 py-3.5 border-t border-gray-100">
              <button onClick={() => call(true)} disabled={Boolean(busy)}
                className="h-9 text-[14px] font-medium text-[#4A5468] border border-gray-200 rounded px-4 hover:border-[#3A57E8] hover:text-[#3A57E8] disabled:opacity-40">
                {busy === "check" ? "Checking…" : "Check first"}
              </button>
              <button onClick={() => call(false)} disabled={Boolean(busy) || facets?.scanned === 0}
                style={{ background: BLUE }}
                className="h-9 text-[14px] font-medium text-white rounded px-4 hover:brightness-110 disabled:opacity-40">
                {busy === "run" ? "Importing…" : facets ? `Import ${facets.scanned}` : "Import"}
              </button>
              <button onClick={() => setOpen(false)} className="h-9 text-[14px] text-[#8A92A6] hover:text-[#232D42] px-2">Close</button>
            </div>
          </div>
        </Overlay>
      )}
    </>
  );
}

function Summary({ r, heading, bare }: { r: Result; heading: string; bare?: boolean }) {
  return (
    <div className={bare ? "mt-1" : "rounded border border-gray-200 px-3 py-2.5"}>
      {heading && <div className="text-[14px] font-medium text-[#232D42]">{heading}</div>}
      <div className="text-[14px] text-[#4A5468] mt-1 space-y-0.5">
        <div>{r.created} new · {r.updated} updated</div>
        {r.skipped.map((s) => <div key={s.reason} className="text-[#8A92A6]">{s.count} skipped — {s.reason}</div>)}
        {r.errors.length > 0 && (
          <div className="text-[#C0392B]">
            {r.errors.length} failed: {r.errors[0]}
          </div>
        )}
      </div>
    </div>
  );
}

// Multi-select dropdown (Airtable's "is any of"). The list is position:fixed so the
// modal's scrolling body can't clip it; it closes on outside click, Escape or scroll.
function MultiDropdown({ label, placeholder, options, picked, loading, onToggle, onClear }: {
  label: string; placeholder: string; options: { value: string; count: number }[]; picked: string[]; loading: boolean;
  onToggle: (v: string) => void; onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const maxH = Math.min(320, Math.max(below, above));
    setPos({ left: r.left, width: r.width, maxH, top: below >= 200 || below >= above ? r.bottom + 4 : r.top - 4 - maxH });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "mousedown" && (listRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node))) return;
      if (e.type === "scroll" && listRef.current?.contains(e.target as Node)) return;
      if (e.type === "keydown") e.stopPropagation(); // Escape closes the list, not the modal
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("scroll", close, true);
    window.addEventListener("keydown", close, true);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("scroll", close, true); window.removeEventListener("keydown", close, true); };
  }, [open]);

  // Picked values stay listed even when these dates have none of them.
  const all = [...options, ...picked.filter((p) => !options.some((o) => o.value === p)).map((value) => ({ value, count: 0 }))];
  const shown = all.filter((o) => !q || o.value.toLowerCase().includes(q.toLowerCase()));
  const summary = picked.length === 0 ? placeholder : picked.length === 1 ? picked[0] : `${picked[0]} +${picked.length - 1}`;

  return (
    <>
      <button ref={btnRef} onClick={() => { setOpen((o) => !o); setQ(""); }}
        style={open || picked.length ? { borderColor: BLUE } : undefined}
        className="h-9 w-[340px] max-w-full inline-flex items-center gap-2 rounded border border-gray-200 bg-white px-3 text-[14px] text-left hover:border-[#3A57E8]">
        <span className={`flex-1 truncate ${picked.length ? "text-[#232D42] font-medium" : "text-[#8A92A6]"}`}>{summary}</span>
        {picked.length > 0 && <span className="text-[12px] text-white rounded px-1.5" style={{ background: BLUE }}>{picked.length}</span>}
        <IconChevronDown size={16} stroke={1.8} className={`text-[#8A92A6] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && pos && (
        <div ref={listRef} onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxH, boxShadow: "0 12px 32px rgba(35,45,66,.18)" }}
          className="z-[400] flex flex-col bg-white border border-gray-200 rounded overflow-hidden">
          {all.length > 6 && (
            <div className="relative border-b border-gray-100 p-2">
              <IconSearch size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8A92A6]" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search"
                className="h-9 w-full rounded border border-gray-200 pl-8 pr-2 text-[14px] outline-none focus:border-[#3A57E8]" />
            </div>
          )}
          <div className="overflow-y-auto py-1">
            {shown.length === 0 && <div className="px-3 py-2 text-[14px] text-[#8A92A6]">{loading ? "Reading Airtable…" : "None in the view"}</div>}
            {shown.map((o) => {
              const on = picked.includes(o.value);
              return (
                <button key={o.value} onClick={() => onToggle(o.value)}
                  className="w-full h-9 flex items-center gap-2.5 px-3 text-[14px] text-left text-[#232D42] hover:bg-[#F6F7FB]">
                  <span className="w-4 h-4 shrink-0 rounded border flex items-center justify-center text-white"
                    style={on ? { background: BLUE, borderColor: BLUE } : { borderColor: "#D1D5DB" }}>
                    {on && <IconCheck size={11} stroke={3} />}
                  </span>
                  <span className={`flex-1 truncate ${o.count === 0 && !on ? "text-[#A6ACBE]" : ""}`}>{o.value}</span>
                  <span className="text-[12px] text-[#A6ACBE]">{o.count}</span>
                </button>
              );
            })}
          </div>
          {picked.length > 0 && (
            <div className="border-t border-gray-100 px-3 py-2 flex justify-between items-center">
              <span className="text-[12px] text-[#8A92A6]">{picked.length} selected</span>
              <button onClick={onClear} className="text-[12px] text-[#3A57E8] hover:underline">Clear</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
