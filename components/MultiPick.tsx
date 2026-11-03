"use client";
import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconSearch, IconX } from "@tabler/icons-react";

// A tick-box dropdown: "All SBUs (164)" / "21 of 24 SBUs (164)". Started life inside
// the Content calendar; moved here so Content Review gets the same filter — "add a
// filter here as well to choose the SBUs like you have added in content calendar"
// (Manya, 10 Oct). Styles are its own (global tokens), not the calendar's --cal-* ones.

export type MultiPickOption = { value: string; count: number; swatch?: string };

const fmt = (n: number) => n.toLocaleString("en-IN");

/** "Unselect all" (Praveen, 28 Oct): nothing ticked, so you can tick just the few you
 *  want. Empty already means "all", so none is this one marker value — it matches no
 *  row wherever the list is used as an includes() filter. */
export const PICK_NONE = "\u0000none";
export const isPickNone = (sel: string[]) => sel.length === 1 && sel[0] === PICK_NONE;

export function MultiPick({ label, options, selected, onChange, total }: {
  label: string;
  options: MultiPickOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Rows in view when nothing is picked. Needed because the options don't always
   *  add up to it — a row with a blank or retired SBU belongs to no option, and a
   *  button reading "All SBUs (215)" next to a count of 220 just looks wrong. */
  total?: number;
}) {
  const [open, setOpen] = useState(false);
  // A long list gets a search box (upper or lower case doesn't matter).
  const [q, setQ] = useState("");
  useEffect(() => { if (!open) setQ(""); }, [open]);
  const visible = q.trim() ? options.filter((o) => o.value.toLowerCase().includes(q.trim().toLowerCase())) : options;
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const all = total ?? options.reduce((n, o) => n + o.count, 0);
  const none = isPickNone(selected);
  const shown = none ? 0 : selected.length ? options.filter((o) => selected.includes(o.value)).reduce((n, o) => n + o.count, 0) : all;
  // Unticking has to subtract from what is ON SCREEN, not from the stored list.
  // Empty means "all", so every box renders ticked while the list is empty — and a
  // naive toggle then ADDED the box you just unticked, leaving you looking at only
  // that one instead of everything except it.
  const toggle = (v: string) => {
    const base = none ? [] : selected.length ? selected : options.map((o) => o.value);
    const next = base.includes(v) ? base.filter((x) => x !== v) : [...base, v];
    // All ticked is the same as no filter; unticking the last one leaves none.
    onChange(next.length === options.length ? [] : next.length === 0 ? [PICK_NONE] : next);
  };
  return (
    <div className="gc-mp" ref={box}>
      <style dangerouslySetInnerHTML={{ __html: MP_CSS }} />
      <button type="button" className={`gc-mp-btn ${selected.length ? "on" : ""}`} onClick={() => setOpen((o) => !o)}>
        <span>{none ? `No ${label} (0)` : selected.length === 0 ? `All ${label} (${fmt(all)})` : `${selected.length} of ${options.length} ${label} (${fmt(shown)})`}</span>
        <IconChevronDown size={14} stroke={1.8} className="gc-mp-car" />
      </button>
      {open && (
        <div className="gc-mp-pop">
          <div className="gc-mp-acts">
            <button type="button" onClick={() => onChange([])}>Show all</button>
            <button type="button" onClick={() => onChange(options.map((o) => o.value))}>Select all</button>
            <button type="button" onClick={() => onChange([PICK_NONE])}>Unselect all</button>
          </div>
          {options.length > 8 && (
            <label className="gc-mp-search">
              <IconSearch size={13} stroke={1.8} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
              {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search"><IconX size={12} /></button>}
            </label>
          )}
          {q.trim() && !visible.length && <div className="gc-mp-none">Nothing matches “{q.trim()}”.</div>}
          {visible.map((o) => (
            <label key={o.value} className="gc-mp-row">
              <input type="checkbox" checked={!none && (selected.length === 0 || selected.includes(o.value))} onChange={() => toggle(o.value)} />
              {o.swatch && <span className="gc-mp-sw" style={{ background: o.swatch }} />}
              <span>{o.value}</span>
              <span className="gc-mp-n">{fmt(o.count)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const MP_CSS = `
.gc-mp{position:relative}
.gc-mp-btn{width:100%;display:flex;align-items:center;justify-content:space-between;gap:.5rem;background:#fff;border:1px solid #E6E9F2;border-radius:9px;padding:.46rem .7rem;font-size:.8rem;font-weight:500;color:#232D42;text-align:left;cursor:pointer}
.gc-mp-btn:hover{border-color:#3A57E8}
.gc-mp-btn.on{border-color:#3A57E8;background:#EEF1FD}
.gc-mp-car{color:#8A92A6;flex-shrink:0}
.gc-mp-pop{position:absolute;z-index:40;top:calc(100% + 5px);left:0;min-width:100%;max-height:330px;overflow:auto;background:#fff;border:1px solid #E6E9F2;border-radius:11px;padding:.4rem}
.gc-mp-acts{display:flex;gap:.4rem;padding:.2rem .35rem .45rem;border-bottom:1px solid #F1F3F8;margin-bottom:.3rem}
.gc-mp-acts button{background:none;border:none;color:#3A57E8;font-size:.72rem;font-weight:500;padding:.1rem .2rem;cursor:pointer}
.gc-mp-row{display:flex;align-items:center;gap:.5rem;padding:.32rem .45rem;border-radius:7px;font-size:.78rem;color:#232D42;cursor:pointer;white-space:nowrap}
.gc-mp-row:hover{background:#F6F7FB}
.gc-mp-row input{accent-color:#3A57E8;margin:0}
.gc-mp-search{display:flex;align-items:center;gap:.45rem;margin:0 .1rem .3rem;padding:.35rem .55rem;border:1px solid #E6E9F2;border-radius:8px;color:#8A92A6}
.gc-mp-search:focus-within{border-color:#3A57E8}
.gc-mp-search input{flex:1;min-width:0;border:none;outline:none;background:transparent;font-size:.78rem;color:#232D42}
.gc-mp-search button{background:none;border:none;color:#8A92A6;cursor:pointer;padding:0;line-height:0}
.gc-mp-none{padding:.4rem .5rem;font-size:.75rem;color:#8A92A6}
.gc-mp-n{margin-left:auto;color:#8A92A6;font-size:.72rem;font-weight:500}
.gc-mp-sw{width:10px;height:10px;border-radius:3px;flex:0 0 auto}
html[data-theme="dark"] .gc-mp-btn,html[data-theme="dark"] .gc-mp-pop{background:var(--d-card);border-color:var(--d-line);color:var(--d-ink)}
html[data-theme="dark"] .gc-mp-btn.on{background:var(--d-raised)}
html[data-theme="dark"] .gc-mp-row{color:var(--d-ink)}
html[data-theme="dark"] .gc-mp-row:hover{background:var(--d-raised)}
html[data-theme="dark"] .gc-mp-acts{border-color:var(--d-line)}
html[data-theme="dark"] .gc-mp-search{border-color:var(--d-line)}
html[data-theme="dark"] .gc-mp-search input{color:var(--d-ink)}
`;
