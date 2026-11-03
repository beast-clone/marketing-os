"use client";
import { useEffect, useState } from "react";
import { IconBuildingStore, IconPlus } from "@tabler/icons-react";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { addBrand } from "@/lib/use-sbus";
import { usePublishPages } from "@/lib/use-publish-pages";
import { showToast } from "../../Toast";

// Brands and the page each one posts to (mh_sbus.page, sql/040). This used to be a
// list in the code (lib/sbu-pages.ts), so a new brand silently went to GooCampus
// Main. Admins change it here; everyone else can read it.

// The GooCampus pages, every brand linked on the Brands page, and "none".
function usePageChoices() {
  const linked = usePublishPages();
  return [
    { value: "GooCampus Main", label: "GooCampus Main" },
    { value: "GooCampus World", label: "GooCampus World" },
    { value: "12Plus / GC India", label: "12th Plus" },
    ...linked.filter((p) => p.linked).map((p) => ({ value: p.value, label: p.label })),
    { value: "none", label: "None of our pages" },
  ];
}

export function BrandPages() {
  const PAGES = usePageChoices();
  const [pages, setPages] = useState<Record<string, string> | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newPage, setNewPage] = useState("GooCampus Main");

  useEffect(() => {
    fetch("/api/sbus", { cache: "no-store" }).then((r) => r.json()).then((d) => setPages(d.pages || {})).catch(() => setPages({}));
    fetch("/api/me").then((r) => r.json()).then((d) => setCanEdit(!!d?.user?.isAdmin)).catch(() => {});
  }, []);

  const change = async (name: string, page: string) => {
    setBusy(name); setErr(null);
    try {
      const r = await fetch("/api/sbus", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, page }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setPages(d.pages);
      showToast({ who: "Page changed", body: `${name} now posts to ${PAGES.find((p) => p.value === page)?.label}.`, color: "#3A57E8", av: "P" });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const add = async () => {
    if (!newName.trim()) return;
    setBusy("new"); setErr(null);
    try {
      const saved = await addBrand(newName, newPage);
      const d = await fetch("/api/sbus", { cache: "no-store" }).then((r) => r.json());
      setPages(d.pages || {}); setNewName("");
      showToast({ who: "Primary Interest added", body: `${saved} is now in every Primary Interest list.`, color: "#3A57E8", av: "B" });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  const names = Object.keys(pages || {}).sort((a, b) => a.localeCompare(b));
  return (
    <section className="bg-white border border-gray-100 rounded-xl">
      <div className="px-4 py-3.5 border-b border-gray-100 flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-lg bg-brand-light text-brand flex items-center justify-center"><IconBuildingStore size={16} stroke={1.8} /></span>
        <div>
          <h2 className="text-[16px] font-medium text-[#232D42]">Primary Interests and their page</h2>
          <div className="text-[12.5px] text-[#8A92A6]">Which page a brand’s posts go out on — the calendar’s channels and the Scheduler’s default page follow this.{canEdit ? "" : " Only an admin can change it."}</div>
        </div>
      </div>
      {pages === null ? (
        <div className="px-4 py-6 text-[13px] text-[#8A92A6]">Loading…</div>
      ) : (
        <ul className="divide-y divide-gray-50">
          {names.map((n) => (
            <li key={n} className="px-4 py-2.5 flex items-center gap-3">
              <span className="flex-1 min-w-0 text-[13.5px] text-[#232D42] truncate">{n}</span>
              {canEdit ? (
                <PreviewSelect className="w-[200px]" value={pages[n]} options={PAGES} disabled={busy === n} ariaLabel={`Page for ${n}`} onChange={(v) => void change(n, v)} />
              ) : (
                <span className="text-[12.5px] text-[#4A5468]">{PAGES.find((p) => p.value === pages[n])?.label || pages[n]}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="px-4 py-3 border-t border-gray-100 flex items-end gap-3 flex-wrap">
          <label className="block"><span className="block text-[11px] text-[#8A92A6] mb-1">New Primary Interest</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Ireland Pathway"
              className="h-9 w-[230px] rounded-lg border border-gray-200 px-3 text-[13px] text-[#232D42] outline-none focus:border-brand" /></label>
          <label className="block"><span className="block text-[11px] text-[#8A92A6] mb-1">Posts to</span>
            <PreviewSelect className="w-[200px]" value={newPage} options={PAGES} onChange={setNewPage} /></label>
          <button onClick={() => void add()} disabled={busy === "new" || !newName.trim()}
            className="h-9 inline-flex items-center gap-1.5 rounded-lg bg-brand text-white text-[13px] font-medium px-3.5 hover:bg-brand-dark disabled:opacity-50"><IconPlus size={15} stroke={2} /> Add Primary Interest</button>
        </div>
      )}
      {err && <div className="mx-4 mb-3 rounded-lg bg-rose-50 border border-rose-100 text-rose-700 text-[12.5px] px-3 py-2">{err}</div>}
    </section>
  );
}
