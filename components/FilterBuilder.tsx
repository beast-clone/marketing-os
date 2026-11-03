"use client";
import { useState } from "react";
import { IconCheck, IconChevronDown, IconFilter, IconGripVertical, IconPlus, IconSearch, IconTrash, IconX } from "@tabler/icons-react";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import {
  DATE_MODES, EMPTY_FILTER, OPS_BY_TYPE, WITHIN_MODES, countConditions, isGroup,
  type FilterCondition, type FilterFieldDef, type FilterGroup, type FilterItem, type FilterModel, type FilterOp,
} from "@/lib/filter-model";

// Airtable-style filter builder, matched to Airtable's own panel (Praveen, 26 Oct):
// "Where · field · operator · value" rows, an and/or per level, condition groups
// ("All of the following are true…"), Airtable's date choices (today, one week ago,
// number of days from now, is within the past month…), values as chips, drag to
// reorder, and "Copy from another view".
//
// Lifted out of the Marketing Hub so Sales Ops could have the same thing rather
// than a second filter UI that slowly disagrees with the first. The page supplies
// its own fields and its own `optionsFor`, which is the only thing that knew about
// tasks, the team roster or the pipeline stages.

type Opt = { value: string; label: string };
type ColorFor = (fieldKey: string, value: string) => { bg: string; text: string } | null;

function Chip({ label, color, onRemove }: { label: string; color?: { bg: string; text: string } | null; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium max-w-[150px]"
      style={{ background: color?.bg || "#E9ECFB", color: color?.text || "#2138B0" }}>
      <span className="truncate">{label}</span>
      {onRemove && <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="opacity-70 hover:opacity-100"><IconX size={11} stroke={2.4} /></button>}
    </span>
  );
}

function FilterMultiSelect({ options, value, onChange, colorFor }: {
  options: Opt[]; value: string[]; onChange: (v: string[]) => void; colorFor?: (v: string) => { bg: string; text: string } | null;
}) {
  const [open, setOpen] = useState(false);
  // A long list (primary interests…) gets a search box; upper or lower case doesn't matter.
  const [q, setQ] = useState("");
  const shown = q.trim() ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const label = (v: string) => options.find((o) => o.value === v)?.label || v;
  return (
    <div className="relative">
      <button onClick={() => { setOpen((o) => !o); setQ(""); }} className="w-full min-h-[32px] flex items-center justify-between gap-1 border border-gray-200 rounded-lg px-1.5 py-1 text-left bg-white">
        <span className="flex flex-wrap gap-1 min-w-0">
          {value.length ? value.map((v) => <Chip key={v} label={label(v)} color={colorFor?.(v)} onRemove={() => toggle(v)} />)
            : <span className="text-[12px] text-gray-400 px-1">Select…</span>}
        </span>
        <IconChevronDown size={13} className="text-gray-400 flex-shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-[calc(100%+4px)] z-[56] bg-white border border-gray-200 rounded-lg shadow-lg p-1 min-w-[190px] max-h-56 overflow-auto">
            {options.length === 0 && <div className="px-2 py-1.5 text-[12px] text-gray-400">No options</div>}
            {options.length > 8 && (
              <label className="flex items-center gap-1.5 m-0.5 mb-1 px-2 py-1 border border-gray-200 rounded-md text-gray-400 focus-within:border-brand">
                <IconSearch size={12} stroke={1.8} />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-[#232D42]" />
              </label>
            )}
            {q.trim() && !shown.length && <div className="px-2 py-1.5 text-[12px] text-gray-400">Nothing matches “{q.trim()}”.</div>}
            {shown.map((o) => (
              <button key={o.value} onClick={() => toggle(o.value)} className="w-full flex items-center gap-2 px-2 py-1.5 text-[12px] rounded hover:bg-gray-50 text-left">
                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${value.includes(o.value) ? "bg-brand border-brand text-white" : "border-gray-300"}`}>{value.includes(o.value) && <IconCheck size={10} stroke={3} />}</span>
                <Chip label={o.label} color={colorFor?.(o.value)} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// A blank condition on a field — the operator and value reset to that field's first.
function blank<T>(def: FilterFieldDef<T>): FilterCondition {
  const op = OPS_BY_TYPE[def.type][0];
  return { field: def.key, op: op.op, value: op.arity === "many" ? [] : op.arity === "none" ? undefined : "", ...(def.type === "date" ? { mode: "exact" as const } : {}) };
}

// Move item `from` to sit at `to` in a list (drag to reorder).
const move = <X,>(list: X[], from: number, to: number) => { const a = [...list]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; };

export function FilterBuilder<T>({ filter, fields, optionsFor, onChange, colorFor, copyFrom, title = "In this view, show records", emptyNote = "No conditions — showing everything. Add one below." }: {
  filter: FilterModel;
  fields: FilterFieldDef<T>[];
  /** The choices for a select/owner field, in the page's own vocabulary. */
  optionsFor: (fieldKey: string) => Opt[];
  onChange: (f: FilterModel) => void;
  /** Chip colours for a field's values (status pills, SBU colours…). */
  colorFor?: ColorFor;
  /** Other views whose filter can be copied in ("Copy from another view"). */
  copyFrom?: { name: string; filter: FilterModel }[];
  title?: string;
  emptyNote?: string;
}) {
  const [drag, setDrag] = useState<{ g: number | null; i: number } | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);

  const setItems = (conditions: FilterItem[]) => onChange({ ...filter, conditions });
  const setGroup = (gi: number, g: FilterGroup) => setItems(filter.conditions.map((c, i) => (i === gi ? g : c)));
  const add = () => { const f = fields[0]; if (f) setItems([...filter.conditions, blank(f)]); };
  const addGroup = () => { const f = fields[0]; if (f) setItems([...filter.conditions, { conjunction: "and", conditions: [blank(f)] }]); };

  // Plain functions, not components: a component made inside render remounts on every
  // keystroke, and the text box being typed in would lose the cursor.
  const conjCell = (i: number, conj: "and" | "or", set: (c: "and" | "or") => void) => (
    <div className="w-[62px] flex-shrink-0 text-[12px]">
      {i === 0 ? <span className="text-gray-500 pl-1">Where</span>
        : i === 1 ? <PreviewSelect value={conj} onChange={(v) => set(v as "and" | "or")} options={[{ value: "and", label: "and" }, { value: "or", label: "or" }]} />
        : <span className="text-gray-500 pl-1">{conj}</span>}
    </div>
  );

  // One condition row. `put` writes it back, `drop` removes it.
  const row = (c: FilterCondition, put: (c: FilterCondition) => void, drop: () => void) => {
    const def = fields.find((f) => f.key === c.field);
    const ops = OPS_BY_TYPE[def?.type || "text"];
    const opDef = ops.find((o) => o.op === c.op) || ops[0];
    const isDate = def?.type === "date";
    const within = c.op === "isWithin";
    const modes = within ? WITHIN_MODES : DATE_MODES;
    const mode = (c.mode as string) || (within ? "pastWeek" : "exact");
    const needsN = /Days$|^days/.test(mode);
    return (
      <>
        <div className="w-[128px] flex-shrink-0">
          <PreviewSelect value={c.field} onChange={(v) => { const nd = fields.find((f) => f.key === v); if (nd) put(blank(nd)); }} options={fields.map((f) => ({ value: f.key, label: f.label }))} />
        </div>
        <div className="w-[128px] flex-shrink-0">
          <PreviewSelect value={c.op} onChange={(v) => {
            const a = ops.find((o) => o.op === v)!.arity;
            if (isDate) put({ ...c, op: v as FilterOp, mode: v === "isWithin" ? "pastWeek" : (c.mode && c.op !== "isWithin" ? c.mode : "exact"), value: v === "isWithin" ? undefined : c.value });
            else put({ ...c, op: v as FilterOp, value: a === "many" ? [] : a === "none" ? undefined : (Array.isArray(c.value) ? "" : c.value || "") });
          }} options={ops.map((o) => ({ value: o.op, label: o.label }))} />
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          {opDef.arity === "none" ? <span className="text-[12px] text-gray-300 pl-1">—</span>
            : isDate ? (<>
              <div className="flex-1 min-w-0 max-w-[190px] overflow-hidden">
                <PreviewSelect value={mode} onChange={(v) => put({ ...c, mode: v as FilterCondition["mode"] })} options={modes.map((m) => ({ value: m.value, label: m.label }))} />
              </div>
              {mode === "exact" && !within && <input type="date" value={String(c.value || "")} onChange={(e) => put({ ...c, value: e.target.value })} className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-brand" />}
              {needsN && <input type="number" min={0} value={c.n ?? ""} placeholder="days" onChange={(e) => put({ ...c, n: e.target.value === "" ? undefined : Number(e.target.value) })} className="w-[64px] flex-shrink-0 border border-gray-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-brand" />}
            </>)
            : def?.type === "text" ? <input value={String(c.value || "")} onChange={(e) => put({ ...c, value: e.target.value })} placeholder="Enter a value" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-brand" />
            : opDef.arity === "many" ? <div className="w-full"><FilterMultiSelect options={optionsFor(c.field)} value={Array.isArray(c.value) ? c.value : []} onChange={(vals) => put({ ...c, value: vals })} colorFor={colorFor ? (v) => colorFor(c.field, v) : undefined} /></div>
            : <div className="w-full"><PreviewSelect value={String(c.value || "")} onChange={(v) => put({ ...c, value: v })} placeholder="Select…" options={[{ value: "", label: "Select…" }, ...optionsFor(c.field)]} /></div>}
        </div>
        <button onClick={drop} title="Remove" className="text-gray-400 hover:text-rose-500 flex-shrink-0"><IconTrash size={14} /></button>
      </>
    );
  };

  // Drop target for a row in list `g` (null = top level) at `i`; only the grip drags,
  // so selecting text in a value box never starts a drag.
  const dropProps = (g: number | null, i: number, list: unknown[], commit: (next: never[]) => void) => ({
    onDragOver: (e: React.DragEvent) => { if (drag && drag.g === g) e.preventDefault(); },
    onDrop: (e: React.DragEvent) => { e.stopPropagation(); if (drag && drag.g === g && drag.i !== i) commit(move(list, drag.i, i) as never[]); setDrag(null); },
  });
  const grip = (g: number | null, i: number) => (
    <span draggable onDragStart={(e) => { e.stopPropagation(); setDrag({ g, i }); }} onDragEnd={() => setDrag(null)}
      className="text-gray-300 hover:text-gray-500 cursor-grab flex-shrink-0" title="Drag to reorder"><IconGripVertical size={14} /></span>
  );

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3.5 w-[800px] max-w-[94vw]">
      <div className="text-[12.5px] text-[#4A5468] mb-2.5">{title}</div>
      {filter.conditions.length === 0 && <div className="text-[12px] text-gray-400 px-1 pb-2">{emptyNote}</div>}
      <div className="space-y-2">
        {filter.conditions.map((item, i) => (
          <div key={i} className={`flex items-start gap-2 ${drag && drag.g === null && drag.i === i ? "opacity-40" : ""}`}
            {...dropProps(null, i, filter.conditions, (next) => setItems(next))}>
            <div className="pt-1.5">{conjCell(i, filter.conjunction, (c) => onChange({ ...filter, conjunction: c }))}</div>
            {isGroup(item) ? (
              // A condition group — its own and/or, like Airtable's grey box.
              <div className="flex-1 min-w-0 bg-[#F6F7FB] border border-gray-100 rounded-lg p-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-[64px]">
                    <PreviewSelect value={item.conjunction} onChange={(v) => setGroup(i, { ...item, conjunction: v as "and" | "or" })} options={[{ value: "and", label: "All" }, { value: "or", label: "Any" }]} />
                  </div>
                  <span className="text-[12px] text-[#4A5468] flex-1">of the following are true…</span>
                  <button onClick={() => { const f = fields[0]; if (f) setGroup(i, { ...item, conditions: [...item.conditions, blank(f)] }); }} title="Add a condition to this group" className="text-gray-500 hover:text-brand"><IconPlus size={15} /></button>
                  <button onClick={() => setItems(filter.conditions.filter((_, k) => k !== i))} title="Delete the group" className="text-gray-400 hover:text-rose-500"><IconTrash size={14} /></button>
                  {grip(null, i)}
                </div>
                <div className="space-y-2">
                  {item.conditions.map((c, j) => (
                    <div key={j} className={`flex items-center gap-2 ${drag && drag.g === i && drag.i === j ? "opacity-40" : ""}`}
                      {...dropProps(i, j, item.conditions, (next) => setGroup(i, { ...item, conditions: next }))}>
                      {conjCell(j, item.conjunction, (cj) => setGroup(i, { ...item, conjunction: cj }))}
                      {row(c, (nc) => setGroup(i, { ...item, conditions: item.conditions.map((x, k) => (k === j ? nc : x)) }),
                        () => { const rest = item.conditions.filter((_, k) => k !== j); setItems(rest.length ? filter.conditions.map((x, k) => (k === i ? { ...item, conditions: rest } : x)) : filter.conditions.filter((_, k) => k !== i)); })}
                      {grip(i, j)}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex-1 min-w-0 flex items-center gap-2">
                {row(item, (nc) => setItems(filter.conditions.map((x, k) => (k === i ? nc : x))), () => setItems(filter.conditions.filter((_, k) => k !== i)))}
                {grip(null, i)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4">
        <button onClick={add} className="flex items-center gap-1.5 text-[12.5px] font-medium text-brand"><IconPlus size={14} />Add condition</button>
        <button onClick={addGroup} className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#4A5468] hover:text-brand"><IconPlus size={14} />Add condition group</button>
        {copyFrom && copyFrom.length > 0 && (
          <div className="relative ml-auto">
            <button onClick={() => setCopyOpen((o) => !o)} className="text-[12.5px] text-[#4A5468] hover:text-brand">Copy from another view</button>
            {copyOpen && (
              <>
                <div className="fixed inset-0 z-[55]" onClick={() => setCopyOpen(false)} />
                <div className="absolute right-0 bottom-[calc(100%+4px)] z-[56] bg-white border border-gray-200 rounded-lg shadow-lg p-1 w-[220px] max-h-60 overflow-auto">
                  {copyFrom.map((v) => (
                    <button key={v.name} onClick={() => { setCopyOpen(false); onChange(JSON.parse(JSON.stringify(v.filter))); }}
                      className="w-full text-left px-2.5 py-1.5 text-[12.5px] rounded hover:bg-gray-50 truncate">{v.name}
                      <span className="text-[11px] text-gray-400"> · {countConditions(v.filter)} condition{countConditions(v.filter) === 1 ? "" : "s"}</span></button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The builder behind a toolbar button, with the active-condition count on it.
 *
 * The Marketing Hub has its own toolbar shell; this is the drop-in for pages that
 * just want the control without building one.
 */
export function FilterPopover<T>({ filter, fields, optionsFor, onChange, emptyNote, align = "left" }: {
  filter: FilterModel;
  fields: FilterFieldDef<T>[];
  optionsFor: (fieldKey: string) => Opt[];
  onChange: (f: FilterModel) => void;
  emptyNote?: string;
  /** The panel is 800px wide — anchor it right when the button sits near the edge. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const n = countConditions(filter);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[13px] ${
          n ? "border-brand text-brand bg-brand-light" : "border-gray-200 text-[#4A5468] hover:border-gray-300"}`}>
        <IconFilter size={15} stroke={1.8} />{n ? `Filtered · ${n}` : "Filter"}
      </button>
      {n > 0 && (
        <button onClick={() => onChange(EMPTY_FILTER)} className="ml-2 text-[12.5px] text-[#8A92A6] hover:text-[#232D42]">Clear</button>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-[57]" onClick={() => setOpen(false)} />
          <div className={`absolute top-[calc(100%+6px)] z-[58] ${align === "right" ? "right-0" : "left-0"}`}>
            <FilterBuilder filter={filter} fields={fields} optionsFor={optionsFor} onChange={onChange} emptyNote={emptyNote} />
          </div>
        </>
      )}
    </div>
  );
}
