"use client";
import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconCheck, IconPlus, IconSearch, IconX } from "@tabler/icons-react";

// Themed custom dropdown (no native <select>). Shared by the Scheduler,
// Marketing Hub calendar, and anywhere else that needs the branded picker.
export function PreviewSelect({ value, onChange, options, placeholder, disabled, className, dropUp, addOption, onRemoveOption, defaultOpen, onClose, size, bare, ariaLabel, title }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; img?: string }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Open the menu upwards.
   *
   * The menu is absolutely positioned, so a scrolling ancestor clips it. A picker
   * sitting near the bottom of a scrollable panel (the repeat control in the
   * broadcast composer) would otherwise drop its options behind the footer.
   */
  dropUp?: boolean;
  /**
   * Optional "add your own" row at the foot of the menu. The campaign lead list
   * needs it: its choices are whatever values already exist in the sheet column,
   * so a status nobody has used yet can otherwise never be set a first time.
   */
  addOption?: { label: string; onAdd: (value: string) => void };
  /** Optional per-option remove (an × on hover). Used to prune a sheet's stray statuses. */
  onRemoveOption?: (value: string) => void;
  /** Open as soon as it appears — for click-to-edit cells that swap text for a picker. */
  defaultOpen?: boolean;
  /** Called when the menu is dismissed without a pick (click outside / Escape). */
  onClose?: () => void;
  /** "sm" = table-cell size (28px, 12px text). */
  size?: "sm";
  /** Reads as plain muted text until hovered — for pickers inside a heading line. */
  bare?: boolean;
  ariaLabel?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(!!defaultOpen && !disabled);
  const dismiss = () => { setOpen(false); onClose?.(); };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Open upwards on its own when the menu (max-h-72 = 288px) won't fit below the
  // button but will above — a picker near the bottom of the screen otherwise opens
  // off-screen and looks cut off (Automations › Add a rule). scrollIntoView was
  // tried and scrolled the app shell itself.
  const btnRef = useRef<HTMLButtonElement>(null);
  const [flip, setFlip] = useState(false);
  const up = dropUp || flip;
  const [adding, setAdding] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  // A long list (Primary Interests…) gets a search box. Upper or lower case doesn't
  // matter; options with an empty value ("All …") always stay at the top.
  const [q, setQ] = useState("");
  const searchable = options.length > 8;
  const shown = q.trim() ? options.filter((o) => !o.value || o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;
  const current = options.find((o) => o.value === value);
  // Optional per-option avatar (e.g. real Instagram profile pictures in the
  // account picker). 20px round thumbnail; absent img just renders text-only.
  const Avatar = ({ src }: { src?: string }) =>
    src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" width={20} height={20}
        className="w-5 h-5 rounded-full object-cover flex-shrink-0 border border-gray-200"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
    ) : null;
  // With a placeholder + no selection, show the placeholder (muted); otherwise the
  // selected option (or the first, matching the original behaviour).
  const label = current?.label ?? (placeholder ?? options[0]?.label);
  const isPlaceholder = !current && !!placeholder;
  return (
    <div className="relative">
      <button ref={btnRef} type="button" onClick={() => {
          if (disabled) return;
          const r = btnRef.current?.getBoundingClientRect();
          if (r) setFlip(window.innerHeight - r.bottom < 300 && r.top > window.innerHeight - r.bottom);
          setOpen((o) => !o); setShowAdd(false); setAdding(""); setQ("");
        }} disabled={disabled} aria-label={ariaLabel} title={title}
        className={`flex items-center gap-2 rounded-lg border ${
          bare ? "h-7 px-1.5 -mx-1.5 text-[13px] border-transparent bg-transparent text-[#8A92A6] hover:text-[#232D42] hover:border-gray-200"
          : size === "sm" ? "h-7 px-2 text-[12px] border-[#EEF0F4] bg-white text-[#232D42]"
          : "h-9 px-3 text-[14px] font-medium border-[#EEF0F4] bg-white text-[#232D42]"} ${
          disabled ? "opacity-50 cursor-not-allowed" : bare ? "" : open ? "border-brand" : "hover:border-brand"} ${className || ""}`}>
        <Avatar src={current?.img} />
        <span className={`whitespace-nowrap ${isPlaceholder ? "text-[#8A92A6]" : ""}`}>{label}</span>
        <IconChevronDown size={14} stroke={2} className={`text-[#8A92A6] transition-transform flex-shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); dismiss(); }} />
          {/* Inline boxShadow — .preview-scope strips Tailwind shadow-* to none, so the
              menu would otherwise render flat. Inline styles survive the strip. */}
          <div
            className={`absolute left-0 ${up ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"} z-50 bg-white border border-[#EEF0F4] rounded-xl p-1.5 min-w-[190px] max-h-72 overflow-auto`}>
            {searchable && (
              <label className="sticky -top-1.5 z-10 -mx-1.5 -mt-1.5 mb-1 flex items-center gap-2 bg-white border-b border-[#EEF0F4] px-3 py-2">
                <IconSearch size={14} stroke={1.8} className="text-[#8A92A6] flex-shrink-0" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
                  onKeyDown={(e) => { if (e.key === "Enter") { const first = shown.find((o) => o.value); if (first) { onChange(first.value); setOpen(false); } } }}
                  className="flex-1 min-w-0 bg-transparent outline-none text-xs text-[#232D42] placeholder:text-[#8A92A6]" />
                {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="text-[#8A92A6] hover:text-[#232D42]"><IconX size={12} /></button>}
              </label>
            )}
            {searchable && q.trim() && !shown.some((o) => o.value) && <div className="px-3 py-2 text-xs text-[#8A92A6]">Nothing matches “{q.trim()}”.</div>}
            {shown.map((o) => (
              <div key={o.value} className={`group flex items-center rounded-lg ${o.value === value ? "bg-brand-light" : "hover:bg-[#F6F7FB]"}`}>
                <button type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`flex-1 min-w-0 flex items-center gap-2 text-left px-3 py-1.5 text-xs ${o.value === value ? "font-medium text-brand" : "text-[#232D42]"}`}>
                  <Avatar src={o.img} />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.value === value && <IconCheck size={14} stroke={2.5} className="text-brand flex-shrink-0" />}
                </button>
                {onRemoveOption && (
                  <button type="button" title={`Remove “${o.label}” from this list`}
                    onClick={(e) => { e.stopPropagation(); onRemoveOption(o.value); }}
                    className="shrink-0 mr-1 p-1 rounded-md text-transparent group-hover:text-[#C9CDD8] hover:!text-[#C0392B] hover:bg-[#FDECEA]">
                    <IconX size={12} stroke={2.2} />
                  </button>
                )}
              </div>
            ))}
            {addOption && (
              showAdd ? (
                <form className="flex items-center gap-1 p-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = adding.trim();
                    if (!v) return;
                    addOption.onAdd(v);
                    setAdding(""); setShowAdd(false); setOpen(false);
                  }}>
                  <input autoFocus value={adding} onChange={(e) => setAdding(e.target.value)}
                    placeholder="Type it, then Enter"
                    className="flex-1 min-w-0 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-800 focus:border-brand focus:outline-none" />
                  <button type="submit" disabled={!adding.trim()}
                    className="rounded-lg bg-brand text-white px-2 py-1 text-xs disabled:opacity-40">Add</button>
                </form>
              ) : (
                <button type="button" onClick={() => setShowAdd(true)}
                  className="w-full flex items-center gap-2 text-left rounded-lg px-3 py-1.5 text-xs text-brand hover:bg-brand-light/50 border-t border-gray-100 mt-1 pt-2">
                  <IconPlus size={13} stroke={2} /> {addOption.label}
                </button>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
