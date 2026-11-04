"use client";

import { useEffect, useState } from "react";
import { IconMail, IconX, IconPlus, IconCheck, IconWorld } from "@tabler/icons-react";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";

// Who gets an email when someone asks to move a publish date (Praveen, 4 Nov 2026).
// Pick teammates from the list or type any address; anything not @goocampus.in is
// marked "Outside GooCampus". Admins change it; everyone else sees who's on it.
type Data = { emails: string[]; saved: boolean; team: { name: string; email: string }[]; canEdit: boolean };
const isOutside = (e: string) => !e.toLowerCase().endsWith("@goocampus.in");
const valid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export function ApprovalEmails() {
  const [data, setData] = useState<Data | null>(null);
  const [list, setList] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const load = () => fetch("/api/approval-emails", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j: Data | null) => { setData(j); setList(j?.emails || []); });
  useEffect(() => { load(); }, []);
  if (!data) return null;

  const nameFor = (e: string) => data.team.find((t) => t.email === e)?.name;
  const dirty = JSON.stringify(list) !== JSON.stringify(data.emails);
  const add = (e: string) => {
    const v = e.trim().toLowerCase();
    if (!v) return;
    if (!valid(v)) { setErr("That doesn't look like an email address."); return; }
    if (list.includes(v)) { setErr("Already on the list."); return; }
    setErr(""); setList([...list, v]); setTyped("");
  };
  const save = async () => {
    setState("saving"); setErr("");
    const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "approvalEmails", value: list }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || "Couldn't save."); setState("idle"); return; }
    await load(); setState("saved"); setTimeout(() => setState("idle"), 3000);
  };
  const options = [{ value: "", label: "Add a teammate…" }, ...data.team.filter((t) => !list.includes(t.email)).map((t) => ({ value: t.email, label: `${t.name} — ${t.email}` }))];

  return (
    <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4 mt-4 mb-4">
      <div className="flex items-center gap-2 text-[14px] font-medium text-[#232D42]"><IconMail size={16} className="text-brand" />Email notifications</div>
      <p className="text-[12.5px] text-[#8A92A6] mt-1 mb-3">When someone asks to move a publish date, these addresses get an email with the task link and the reason. The person who asked is emailed the decision.{!data.saved ? " Not set yet — these are the defaults (Managers on the Team page)." : ""}</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {list.length === 0 && <span className="text-[12.5px] text-[#B76E00]">Nobody — no request emails will go out.</span>}
        {list.map((e) => (
          <span key={e} className="inline-flex items-center gap-1.5 border border-gray-200 rounded-lg pl-2.5 pr-1.5 py-1 text-[12.5px] text-[#232D42]">
            {nameFor(e) ? <b className="font-medium">{nameFor(e)}</b> : null}<span className="text-[#4A5468]">{e}</span>
            {isOutside(e) && <span className="inline-flex items-center gap-1 bg-[#FFF4E0] text-[#B76E00] rounded-md px-1.5 py-0.5 text-[11px] font-medium"><IconWorld size={11} />Outside GooCampus</span>}
            {data.canEdit && <button onClick={() => setList(list.filter((x) => x !== e))} className="p-0.5 rounded text-[#A6ACBE] hover:text-[#C03221]" aria-label={`Remove ${e}`}><IconX size={13} /></button>}
          </span>
        ))}
      </div>
      {data.canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <div style={{ width: 280 }}><PreviewSelect value="" onChange={(v) => v && add(v)} options={options} /></div>
          <span className="text-[12px] text-[#A6ACBE]">or</span>
          <input value={typed} onChange={(e) => { setTyped(e.target.value); setErr(""); }} onKeyDown={(e) => { if (e.key === "Enter") add(typed); }}
            placeholder="Type any email address" className="border border-gray-200 rounded-lg px-3 py-2 text-[13px] w-[240px] focus:outline-none focus:border-brand" />
          <button onClick={() => add(typed)} className="inline-flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-2 text-[12.5px] font-medium text-[#4A5468] hover:border-brand hover:text-brand"><IconPlus size={14} />Add</button>
          {typed && valid(typed.trim()) && isOutside(typed.trim()) && <span className="text-[12px] text-[#B76E00]">This address is outside GooCampus.</span>}
          <span className="ml-auto flex items-center gap-2">
            {state === "saved" && <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#0F6E3C]"><IconCheck size={14} />Saved</span>}
            <button disabled={!dirty || state === "saving"} onClick={save} className="bg-brand hover:bg-[#2138B0] text-white rounded-lg px-4 py-2 text-[13px] font-medium disabled:opacity-40">{state === "saving" ? "Saving…" : "Save"}</button>
          </span>
        </div>
      )}
      {err && <p className="text-[12.5px] text-[#C03221] mt-2">{err}</p>}
    </div>
  );
}
