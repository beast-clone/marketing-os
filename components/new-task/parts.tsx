"use client";
import { useEffect, useState } from "react";
import { inNumberOrder } from "@/lib/upload-task-file";
import { FilesCard, type FileTile } from "@/components/FilesCard";
import { confirmDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";
import { IconLink, IconSearch } from "@tabler/icons-react";
import { useTeam, NEWCOMER_COLOR } from "@/lib/use-team";

// Presentational pieces the new-task form is built from, lifted out of
// PreviewMyDay so the form can be rendered on more than one screen.
//
// They are unchanged from the My Day originals and still carry the same class
// names (.av, .ui-dd-*, .dp-*), which are styled by MY_DAY_CSS under its `.hmd`
// scope — so whatever renders them has to sit inside a .hmd element. My Day
// already does; NewTaskDialog wraps itself in one.

// dropped in later (from ind_users) with no render changes.
export type Person = { name: string; av: string; color: string; photo?: string };

export const PHOTOS: Record<string, string> = {};
export function Avatar({ p, cls = "av av-sm" }: { p: { name?: string; av: string; color: string; photo?: string }; cls?: string }) {
  const photo = p.photo || PHOTOS[(p.name || "").split(" ")[0].toLowerCase()];
  if (photo) {
    return <span className={cls} title={p.name} style={{ backgroundImage: `url(${photo})`, backgroundSize: "cover", backgroundPosition: "center" }} />;
  }
  return <span className={cls} title={p.name} style={{ background: p.color }}>{p.av}</span>;
}


export function DatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const base = value ? new Date(value + "T00:00:00") : new Date();
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const p2 = (n: number) => String(n).padStart(2, "0");
  const iso = (y: number, m: number, d: number) => `${y}-${p2(m + 1)}-${p2(d)}`;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const sel = value ? new Date(value + "T00:00:00") : null;
  const now = new Date();
  const startDow = (new Date(view.y, view.m, 1).getDay() + 6) % 7;   // weeks start on Monday
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(startDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const label = sel ? sel.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "";
  const shift = (dir: number) => setView((v) => { const m = v.m + dir; if (m < 0) return { y: v.y - 1, m: 11 }; if (m > 11) return { y: v.y + 1, m: 0 }; return { y: v.y, m }; });
  return (
    <div className="dp">
      <button type="button" className="dp-field" onClick={() => setOpen((o) => !o)}>
        <span className={label ? "" : "dp-ph"}>{label || "Pick a date"}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="dp-cal"><rect x="3" y="4.5" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.7" /><path d="M3 9h18M8 3v3M16 3v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <>
          <div className="dp-backdrop" onClick={() => setOpen(false)} />
          <div className="dp-pop">
            <div className="dp-head">
              <span className="dp-title">{MONTHS[view.m]} {view.y}</span>
              <div className="dp-nav"><button type="button" onClick={() => shift(-1)}>‹</button><button type="button" onClick={() => shift(1)}>›</button></div>
            </div>
            <div className="dp-grid dp-dow">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
            <div className="dp-grid">
              {cells.map((d, i) => d === null ? <span key={i} className="dp-empty" /> : (
                <button key={i} type="button"
                  className={`dp-day ${sel && sel.getFullYear() === view.y && sel.getMonth() === view.m && sel.getDate() === d ? "sel" : ""} ${now.getFullYear() === view.y && now.getMonth() === view.m && now.getDate() === d ? "today" : ""}`}
                  onClick={() => { onChange(iso(view.y, view.m, d)); setOpen(false); }}>{d}</button>
              ))}
            </div>
            <div className="dp-foot">
              <button type="button" className="dp-link" onClick={() => { onChange(""); setOpen(false); }}>Clear</button>
              <button type="button" className="dp-link" onClick={() => { onChange(iso(now.getFullYear(), now.getMonth(), now.getDate())); setView({ y: now.getFullYear(), m: now.getMonth() }); setOpen(false); }}>Today</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// The team, by key. Owner / collaborator chips read names and colours from here.
// Today's team is typed for its colours; anyone added on the Team page is added at
// runtime by usePplTeam() — named from the roster, neutral colour.
export const PPL: Record<string, Person> = {
  manya: { name: "Manya", av: "M", color: "#E0791F" },
  praveen: { name: "Praveen", av: "P", color: "#C2410C" },
  nikhil: { name: "Nikhil", av: "N", color: "#3A57E8" },
  nandu: { name: "Nandu", av: "N", color: "#6E48F8" },
  maheen: { name: "Maheen", av: "M", color: "#2F9E6F" },
};

/** Add Team-page newcomers to PPL and re-render once they arrive. Call at the top of
 *  any screen that lists people from PPL (My Day, the New task form). */
export function usePplTeam() {
  const team = useTeam();
  const [, bump] = useState(0);
  useEffect(() => {
    let added = false;
    for (const p of team) {
      if (!p.active || PPL[p.id]) continue;
      PPL[p.id] = { name: p.first, av: (p.first || p.id).charAt(0).toUpperCase(), color: NEWCOMER_COLOR };
      added = true;
    }
    if (added) bump((n) => n + 1);
  }, [team]);
}

export function MenuDropdown({ value, options, onChange, placeholder = "Select…", icon, wide, align = "right" }: {
  value: string | number | "";
  options: { value: string | number; label: string }[];
  onChange: (v: string) => void;
  placeholder?: string; icon?: React.ReactNode; wide?: boolean; align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  // A long list (Primary Interests…) gets a search box; upper or lower case doesn't matter.
  const [q, setQ] = useState("");
  const shown = q.trim() ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;
  const cur = options.find((o) => String(o.value) === String(value));
  return (
    <div className={`ui-dd ${wide ? "wide" : ""}`}>
      <button type="button" className="ui-dd-btn" onClick={() => { setOpen((o) => !o); setQ(""); }}>
        {icon && <span className="ui-dd-ic">{icon}</span>}
        <span className="ui-dd-val">{cur ? cur.label : placeholder}</span>
        <span className="ui-dd-caret" />
      </button>
      {open && (
        <>
          <div className="ui-dd-back" onClick={() => setOpen(false)} />
          <div className="ui-dd-menu" style={wide ? { left: 0, right: 0 } : { [align]: 0 }}>
            {options.length > 8 && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", margin: "0 0 4px", border: "1px solid #E6E9F2", borderRadius: 8, color: "#8A92A6" }}>
                <IconSearch size={14} stroke={1.8} />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
                  style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 13, color: "#232D42" }} />
              </label>
            )}
            {q.trim() && !shown.length && <div style={{ padding: "6px 10px", fontSize: 12.5, color: "#8A92A6" }}>Nothing matches “{q.trim()}”.</div>}
            {shown.map((o) => (
              <button type="button" key={String(o.value)} className={`ui-dd-item ${String(o.value) === String(value) ? "on" : ""}`} onClick={() => { onChange(String(o.value)); setOpen(false); }}>
                <span className="ui-dd-item-lbl">{o.label}</span>
                {String(o.value) === String(value) && <span className="ui-dd-check">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// local preview) + links in memory; the parent uploads them once the task row exists
// (references → mh_attachments kind='reference' + reference_links; output → kind='creative'
// + output_link). `oneLink` caps output at a single final-creative link (the DB column
// output_link is singular). Mirrors the detail-view ReferencesSection UI + classes.
export type PendingFile = { file: File; url: string };
export type PendingAsset = { links: string[]; files: PendingFile[] };
export type NewTaskAssets = { refLinks: string[]; refFiles: File[]; outLink: string; outFiles: File[]; attFiles?: File[]; thumbFiles?: File[] };
export const EMPTY_ASSET: PendingAsset = { links: [], files: [] };

// noLinks = the Attachments box: working files only, no link field (same as the task window).
// oneImage = a reel's Thumbnail box: a single image, no link; a new one replaces it.
export function PendingAssets({ title, drop, oneLink, noLinks, oneImage, value, onChange }: { title: string; drop?: boolean; oneLink?: boolean; noLinks?: boolean; oneImage?: boolean; value: PendingAsset; onChange: (p: PendingAsset) => void }) {
  const addFiles = async (files: FileList | File[]) => {
    if (oneImage) {
      const f = [...files].find((x) => x.type.startsWith("image/"));
      if (!f) return;
      value.files.forEach((x) => URL.revokeObjectURL(x.url));
      onChange({ ...value, files: [{ file: f, url: URL.createObjectURL(f) }] });
      return;
    }
    let list = inNumberOrder(files);
    // Same as an uploaded task: a name that's already here is called out first (22 Oct).
    const stem = (n: string) => n.toLowerCase().replace(/\.[a-z0-9]+$/, "");
    const have = new Set(value.files.map((f) => stem(f.file.name)));
    const dups = list.filter((f) => have.has(stem(f.name)));
    if (dups.length && !(await confirmDialog({
      title: dups.length === 1 ? `${dups[0].name} is already added` : `${dups.length} of these files are already added`,
      body: `${dups.map((f) => f.name).slice(0, 8).join(", ")} — add ${dups.length === 1 ? "it" : "them"} again anyway?`,
      action: "Add anyway", cancel: dups.length === list.length ? "Don't add" : "Skip duplicates",
    }))) list = list.filter((f) => !dups.includes(f));
    // A batch goes in number order, after whatever was already added (22 Oct).
    const added = list.map((f) => ({ file: f, url: URL.createObjectURL(f) }));
    onChange({ ...value, files: [...value.files, ...added] });
  };
  const rmFile = (i: number) => { const f = value.files[i]; if (f) URL.revokeObjectURL(f.url); onChange({ ...value, files: value.files.filter((_, j) => j !== i) }); };
  // The shared files card (components/FilesCard) — the same look as My Day and the task
  // window. Nothing uploads until the task is saved; these are local previews.
  return (
    <FilesCard title={title} drop={drop} numbered={drop} confirmRemove={false}
      count={`${value.files.length} file${value.files.length === 1 ? "" : "s"}${value.links.length ? ` · ${value.links.length} link${value.links.length === 1 ? "" : "s"}` : ""}`}
      accept={oneImage ? "image/*" : noLinks ? "image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv" : "image/*,video/*,.pdf,application/pdf"} onFiles={addFiles}
      {...(oneImage ? { addLabel: value.files.length ? "Replace" : "+ Add thumbnail", addSub: "one image" } : {})}
      tiles={value.files.map((f, i): FileTile => ({ key: f.url, name: f.file.name, url: f.url, preview: f.url,
        kind: f.file.type.startsWith("image/") ? "image" : f.file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(f.file.name) ? "video" : /pdf/i.test(f.file.type) ? "pdf" : "file", onRemove: () => rmFile(i) }))}
      links={noLinks || oneImage ? undefined : value.links} singleLink={oneLink}
      linkPlaceholder={oneLink ? "Paste the final creative link (Drive / Canva)…" : "Paste a reference link…"}
      onAddLink={noLinks || oneImage ? undefined : (href) => onChange({ ...value, links: oneLink ? [href] : [...value.links, href] })}
      onRemoveLink={(l) => onChange({ ...value, links: value.links.filter((x) => x !== l) })} />
  );
}
