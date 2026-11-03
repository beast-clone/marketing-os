"use client";
import { useEffect, useRef, useState } from "react";
import { IconAlertTriangle, IconArrowDown, IconArrowUp, IconCheck, IconDots, IconPlus, IconSearch, IconTrash, IconUsers } from "@tabler/icons-react";
import { confirmDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";
import { showToast } from "@/app/(dashboard)/dashboard/preview/Toast";
import { Overlay } from "@/app/(dashboard)/dashboard/preview/Overlay";
import { TASK_STATUSES } from "@/lib/statuses";
import { ALL_TYPES, VIDEO_TYPES } from "@/lib/mh-content-types";
import { useContentTypes } from "@/lib/use-content-types";
import { useSbus } from "@/lib/use-sbus";
import { PPL } from "@/components/new-task/parts";
import type { FilterCondition, FilterModel } from "@/lib/filter-model";

// "Who gets the task" on the Rules page (sql/037 rules engine).
//
// Praveen, 27 Oct: the Airtable-style builder (When / conditions / actions) was too
// confusing. A rule is one sentence —
//   If status moves to [status] and type is [types] and Primary Interest is [brands]
//   → assign to [person] · collaborators [people]
// — and the list shows each rule as a line with the person's avatar. Rules keep their
// stored shape (trigger_spec / conditions / actions); this screen reads and writes the
// parts above and leaves any other condition a rule already has untouched (e.g. "only
// if nobody owns it yet"), so editing a rule never quietly changes those.

type Spec = { on: "created" | "status" | "save" | "type"; statuses?: string[]; types?: string[] };
type Action = { type: "owner" | "collaborator" | "keep_previous_owner"; to?: string };
type Rule = { id: string; name: string; active: boolean; position: number; trigger_spec: Spec; conditions: FilterModel | null; actions: Action[]; note: string | null };
type Person = { value: string; label: string; active: boolean };
const POOL = "__pool__";
const CREATED = "__created__";
const HANDED = "__handed__";
const TYPE_CHANGE = "__type__";        // "when the type changes to…" (sql/041)
const REMEMBERED = "__remembered__";   // back to the editor it was taken from, else the pool

// The simple reading of a stored rule.
type Simple = { moment: string; types: string[]; brands: string[]; owner: string; collabs: string[] };

const condsOf = (r: Pick<Rule, "conditions">): FilterCondition[] =>
  (r.conditions?.conditions || []).filter((c): c is FilterCondition => !!c && !("conditions" in (c as object)));
const vals = (c: FilterCondition) => (Array.isArray(c.value) ? c.value.map(String) : c.value == null ? [] : [String(c.value)]);

function toSimple(r: Rule, allBrands: string[]): Simple {
  const cs = condsOf(r);
  const sp = r.trigger_spec || { on: "save" };
  const handed = cs.some((c) => c.field === "owner_changed" && vals(c)[0] === "yes");
  const statusCond = cs.find((c) => c.field === "status" && (c.op === "is" || c.op === "isAnyOf"));
  const moment = sp.on === "created" ? CREATED : sp.on === "type" ? TYPE_CHANGE : handed ? HANDED
    : sp.on === "status" ? (sp.statuses || [])[0] || "Content - Approved"
    : statusCond ? vals(statusCond)[0] : "Content - Approved";
  let types: string[] = sp.on === "type" && sp.types?.length ? [...sp.types] : [];
  if (!types.length) for (const c of cs) {
    if (c.field === "type" && (c.op === "is" || c.op === "isAnyOf")) types = vals(c);
    if (c.field === "kind" && c.op === "is") types = ALL_TYPES.filter((t) => (vals(c)[0] === "video") === VIDEO_TYPES.has(t));
  }
  let brands: string[] = [];
  for (const c of cs) {
    if (c.field !== "sbu") continue;
    if (c.op === "is" || c.op === "isAnyOf") brands = vals(c);
    if (c.op === "isNot" || c.op === "isNoneOf") brands = allBrands.filter((b) => !vals(c).includes(b));
  }
  return {
    moment, types, brands,
    owner: r.actions.find((a) => a.type === "owner")?.to || "",
    collabs: r.actions.filter((a) => a.type === "collaborator" && a.to).map((a) => a.to!),
  };
}

// Back to the stored shape. Conditions this screen doesn't show are kept as they were.
function fromSimple(s: Simple, prev: Rule | null, allBrands: string[]) {
  const shown = new Set(["type", "kind", "sbu", "owner_changed"]);
  // Status checks on "handed over" and "type changes" rules aren't shown in the form; keep them.
  const keep = (prev ? condsOf(prev) : []).filter((c) => !shown.has(c.field) && !(c.field === "status" && s.moment !== HANDED && s.moment !== TYPE_CHANGE));
  const conds: FilterCondition[] = [...keep];
  if (s.moment === HANDED) conds.push({ field: "owner_changed", op: "is", value: "yes" } as FilterCondition);
  const partialTypes = s.types.length && s.types.length < ALL_TYPES.length;
  if (partialTypes && s.moment !== TYPE_CHANGE) conds.push({ field: "type", op: "isAnyOf", value: s.types } as FilterCondition);
  if (s.brands.length && s.brands.length < allBrands.length) conds.push({ field: "sbu", op: "isAnyOf", value: s.brands } as FilterCondition);
  const actions: Action[] = [
    ...(s.owner ? [{ type: "owner" as const, to: s.owner }] : []),
    ...s.collabs.filter((c) => c !== s.owner).map((to) => ({ type: "collaborator" as const, to })),
    ...(prev?.actions.some((a) => a.type === "keep_previous_owner") && s.owner ? [{ type: "keep_previous_owner" as const }] : []),
  ];
  const trigger_spec: Spec = s.moment === CREATED ? { on: "created" } : s.moment === HANDED ? { on: "save" }
    : s.moment === TYPE_CHANGE ? { on: "type", ...(partialTypes ? { types: s.types } : {}) }
    : { on: "status", statuses: [s.moment] };
  return { trigger_spec, conditions: { conjunction: "and", conditions: conds } as FilterModel, actions };
}

const list = (xs: string[], word = "or") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${word} ${xs[xs.length - 1]}`);

export function RuleBuilder() {
  const sbus = useSbus();
  useContentTypes();   // dashboard-added types join ALL_TYPES / VIDEO_TYPES
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [engineOn, setEngineOn] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ rule: Rule | null; s: Simple } | null>(null);

  const load = () => fetch("/api/marketing-hub/rules-engine", { cache: "no-store" }).then((r) => r.json()).then((d) => {
    setRules(d.rules || []); setPeople(d.people || []); setEngineOn(!!d.engineOn); setCanEdit(!!d.canEdit);
  }).catch(() => setRules([]));
  useEffect(() => { load(); }, []);

  const nameOf = (k?: string) => (k === POOL ? "the editors’ claim pool" : k === REMEMBERED ? "the editor who had it before (or the claim pool)" : people.find((p) => p.value === k)?.label || PPL[k || ""]?.name || k || "");
  const call = async (method: string, body?: unknown, qs = "") => {
    setBusy(true);
    try {
      const res = await fetch(`/api/marketing-hub/rules-engine${qs}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { showToast({ who: "Couldn't save", body: j.error || `HTTP ${res.status}`, color: "#C03221", av: "!" }); return null; }
      await load();
      return j;
    } finally { setBusy(false); }
  };
  const flip = async (on: boolean) => {
    const ok = await confirmDialog(on
      ? { title: "Switch to these rules?", body: "From now on, who gets each task and who is added as collaborator come only from the rules on this page. The old fixed behaviour stops. You can switch back any time.", action: "Switch to these rules", cancel: "Cancel" }
      : { title: "Switch back to the old behaviour?", body: "The rules on this page stop applying and the old fixed behaviour takes over again.", action: "Switch back", cancel: "Cancel", danger: true });
    if (ok) await call("PATCH", { engineOn: on });
  };

  // ── How a rule reads in the list ──────────────────────────────────────────────
  const typesShort = (t: string[]) => {
    if (!t.length || t.length >= ALL_TYPES.length) return "Any type";
    const design = ALL_TYPES.filter((x) => !VIDEO_TYPES.has(x)), video = ALL_TYPES.filter((x) => VIDEO_TYPES.has(x));
    if (t.length === design.length && design.every((x) => t.includes(x))) return "All design types";
    if (t.length === video.length && video.every((x) => t.includes(x))) return "All video types";
    return t.length > 3 ? `${t.slice(0, 2).join(", ")} +${t.length - 2} more` : t.join(", ");
  };
  const brandsText = (b: string[]) => {
    if (!b.length || b.length >= sbus.length) return "";
    if (b.length > sbus.length / 2) return `every Primary Interest except ${list(sbus.filter((x) => !b.includes(x)), "and")}`;
    return list(b);
  };
  const momentText = (m: string) => (m === CREATED ? "is created" : m === HANDED ? "is handed to someone else" : `moves to ${m}`);
  const extrasText = (r: Rule) => {
    const cs = condsOf(r);
    const out: string[] = [];
    // A status check the form doesn't show (type-change and hand-over rules) still reads out.
    if (r.trigger_spec?.on !== "status" && cs.some((c) => c.field === "status" && vals(c).includes("Content - Approved"))) out.push("it's already approved");
    if (cs.some((c) => c.field === "owner" && c.op === "isEmpty")) out.push("nobody owns it yet");
    if (cs.some((c) => c.field === "owner_is_creator" && vals(c)[0] === "yes")) out.push("an editor wrote it");
    if (cs.some((c) => c.field === "owner_role" && vals(c)[0] === "designer")) out.push("the designer has it");
    return out.length ? ` and ${out.join(" and ")}` : "";
  };
  const describe = (r: Rule) => {
    const s = toSimple(r, sbus);
    const ts = typesShort(s.types);
    const subj = ts === "Any type" ? "a task" : ts === "All design types" ? "a design task" : ts === "All video types" ? "a video task" : ((t: string) => `${/^[AEIOU]/i.test(t) ? "an" : "a"} ${t}`)(s.types.length <= 3 ? list(s.types) : ts);
    const b = brandsText(s.brands);
    const when = s.moment === TYPE_CHANGE
      ? `When a task${b ? ` for ${b}` : ""} changes type to ${ts === "Any type" ? "anything else" : ts === "All design types" ? "design work" : ts === "All video types" ? "video work" : s.types.length <= 3 ? list(s.types) : ts}${extrasText(r)}`
      : `When ${subj}${b ? ` for ${b}` : ""} ${momentText(s.moment)}${extrasText(r)}`;
    const parts: string[] = [];
    if (s.owner) parts.push(s.owner === POOL ? "it goes to the editors’ claim pool" : `it goes to ${nameOf(s.owner)}`);
    if (s.collabs.length) parts.push(`${list(s.collabs.map(nameOf), "and")} ${s.collabs.length > 1 ? "are" : "is"} added as ${s.collabs.length > 1 ? "collaborators" : "a collaborator"}`);
    const keepPrev = r.actions.some((a) => a.type === "keep_previous_owner") ? " The previous owner stays on as a collaborator." : "";
    return `${when}, ${parts.join(", and ") || "nothing happens"}.${keepPrev}`;
  };
  const titleOf = (r: Rule) => {
    const s = toSimple(r, sbus);
    const b = brandsText(s.brands);
    if (s.owner) return <>{s.moment === TYPE_CHANGE ? `Type changes to ${typesShort(s.types).replace(/^All /, "").replace(/^Any type$/, "anything")}` : typesShort(s.types)}{b ? ` · ${b}` : ""} <span className="text-[#8A92A6] font-normal">→</span> {s.owner === POOL ? "The editors’ claim pool" : s.owner === REMEMBERED ? "The editor who had it" : nameOf(s.owner)}</>;
    const who = list(s.collabs.map(nameOf), "and") || "Nobody";
    return <>{who} {s.collabs.length > 1 ? "follow" : "follows"} {s.moment === HANDED ? "tasks that change hands" : s.moment === CREATED ? (b ? `new tasks for ${b}` : "every new task") : `tasks that ${momentText(s.moment)}${b ? ` for ${b}` : ""}`}</>;
  };
  const avatar = (r: Rule) => {
    const s = toSimple(r, sbus);
    const k = s.owner || s.collabs[0] || "";
    if (k === POOL || k === REMEMBERED || !k) return <span className="w-9 h-9 rounded-full bg-brand-light text-brand flex items-center justify-center flex-shrink-0"><IconUsers size={17} stroke={1.8} /></span>;
    return <span className="w-9 h-9 rounded-full text-white text-[13px] font-medium flex items-center justify-center flex-shrink-0" style={{ background: PPL[k]?.color || "#3A57E8" }}>{nameOf(k).charAt(0).toUpperCase()}</span>;
  };

  if (!rules) return <div className="bg-white border border-gray-100 rounded-xl px-4 py-6 text-[13px] text-[#8A92A6]">Loading the rules…</div>;
  const owners = rules.filter((r) => r.actions.some((a) => a.type === "owner"));
  const followers = rules.filter((r) => !r.actions.some((a) => a.type === "owner"));
  const save = async (s: Simple) => {
    const prev = editing?.rule || null;
    const body = { ...fromSimple(s, prev, sbus), name: "" };
    const fake = { ...(prev || { id: "", active: true, position: 0, note: null }), ...body } as Rule;
    body.name = (() => { const d = describe(fake); return d.length > 118 ? d.slice(0, 117) + "…" : d; })();
    if (await (prev ? call("PATCH", { id: prev.id, ...body }) : call("POST", body))) {
      setEditing(null);
      // Say it worked, and what the rule now does (it was saved silently — Praveen, 27 Oct).
      showToast({ who: prev ? "Rule saved" : "Rule added", body: body.name, color: "#1AA053", av: "✓" });
    }
  };
  const move = (r: Rule, d: number) => {
    const group = r.actions.some((a) => a.type === "owner") ? owners : followers;
    const i = group.findIndex((x) => x.id === r.id), j = i + d;
    if (j < 0 || j >= group.length) return;
    const ids = rules.map((x) => x.id);
    const a = ids.indexOf(group[i].id), b = ids.indexOf(group[j].id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    void call("PATCH", { order: ids }).then((ok) => { if (ok) showToast({ who: "Order changed", body: "Rules are checked from the top.", color: "#3A57E8", av: "✓" }); });
  };

  const Row = ({ r, n, group }: { r: Rule; n: number; group: Rule[] }) => (
    <li className={`flex items-center gap-3.5 px-5 py-3.5 border-t border-gray-100 ${r.active ? "" : "opacity-45"}`}>
      <span className="w-4 text-right text-[12px] text-[#8A92A6] flex-shrink-0">{n}</span>
      {avatar(r)}
      <div className="flex-1 min-w-0">
        <div className="text-[14.5px] font-medium text-[#232D42]">{titleOf(r)}</div>
        <div className="text-[13px] text-[#4A5468] leading-relaxed mt-0.5">{describe(r)}</div>
        {r.note && !r.active && <div className="text-[12px] text-[#8A92A6] mt-0.5">{r.note}</div>}
      </div>
      {canEdit && (
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <button disabled={busy} onClick={() => setEditing({ rule: r, s: toSimple(r, sbus) })} className="text-[13px] font-medium text-brand px-1 disabled:opacity-50">Edit</button>
          <Toggle on={r.active} disabled={busy} onChange={async () => { if (await call("PATCH", { id: r.id, active: !r.active })) showToast({ who: r.active ? "Rule paused" : "Rule switched on", body: describe(r), color: "#3A57E8", av: "✓" }); }} />
          <RowMenu first={n === 1} last={n === group.length} onUp={() => move(r, -1)} onDown={() => move(r, 1)}
            onDelete={async () => { if (await confirmDialog({ title: "Delete this rule?", body: "Tasks already assigned are not changed.", action: "Delete", cancel: "Cancel", danger: true })) { if (await call("DELETE", undefined, `?id=${r.id}`)) showToast({ who: "Rule deleted", body: describe(r), color: "#C03221", av: "×" }); } }} />
        </div>
      )}
    </li>
  );

  return (
    <section className="bg-white border border-gray-100 rounded-2xl">
      <div className="px-5 pt-4 pb-3 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[16px] font-medium text-[#232D42]">Who gets the task</h2>
          <div className="text-[13px] text-[#8A92A6] mt-0.5">What happens to a task on its own, in plain words.</div>
        </div>
        {canEdit && <button disabled={busy} onClick={() => setEditing({ rule: null, s: { moment: "Content - Approved", types: [], brands: [], owner: "", collabs: [] } })}
          className="inline-flex items-center gap-1.5 bg-brand text-white rounded-lg px-3.5 h-9 text-[13px] font-medium hover:bg-brand-dark disabled:opacity-50"><IconPlus size={15} />New rule</button>}
      </div>

      {/* Which system is in charge — the one switch, so going back is one click. */}
      <div className={`mx-5 mb-3 rounded-lg px-3 py-2.5 text-[12.5px] flex items-center gap-2 flex-wrap ${engineOn ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
        {engineOn ? <IconCheck size={15} /> : <IconAlertTriangle size={15} />}
        <span className="flex-1 min-w-0">{engineOn ? "These rules are in charge — every task follows them." : "These rules are ready but not switched on yet — the old fixed behaviour is still deciding who gets each task."}</span>
        {canEdit && <button disabled={busy} onClick={() => flip(!engineOn)} className="rounded-md border border-current px-2.5 py-1 font-medium disabled:opacity-50">{engineOn ? "Switch back to the old behaviour" : "Switch to these rules"}</button>}
      </div>

      <div className="px-5 pb-1.5 text-[12px] text-[#8A92A6]"><span className="font-medium text-[#4A5468]">Owner</span> · who the task is handed to. Checked from the top; the first one that fits wins.</div>
      <ul>{owners.map((r, i) => <Row key={r.id} r={r} n={i + 1} group={owners} />)}</ul>
      <div className="px-5 pt-3.5 pb-1.5 text-[12px] text-[#8A92A6] border-t border-gray-100"><span className="font-medium text-[#4A5468]">Collaborators</span> · who is added to follow the task. All that fit are applied.</div>
      <ul>{followers.map((r, i) => <Row key={r.id} r={r} n={i + 1} group={followers} />)}</ul>
      {!rules.length && <div className="px-5 py-6 text-[13px] text-[#8A92A6] text-center border-t border-gray-100">No rules yet.</div>}

      {editing && (
        <RuleForm initial={editing.s} isNew={!editing.rule} people={people.filter((p) => p.active)} sbus={sbus} busy={busy}
          onCancel={() => setEditing(null)} onSave={(s) => void save(s)} />
      )}
    </section>
  );
}

function Toggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={onChange} title={on ? "On — click to pause" : "Paused — click to turn on"}
      className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-brand" : "bg-[#D7DBE5]"}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

function RowMenu({ first, last, onUp, onDown, onDelete }: { first: boolean; last: boolean; onUp: () => void; onDown: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const item = "w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] text-left hover:bg-[#F6F7FB] disabled:opacity-40";
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} title="Move or delete" className="p-1 rounded-md text-[#B5BBCB] hover:text-[#232D42] hover:bg-[#F6F7FB]"><IconDots size={17} /></button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-40 bg-white border border-gray-100 rounded-xl p-1">
          <button disabled={first} className={item} onClick={() => { setOpen(false); onUp(); }}><IconArrowUp size={14} />Move up</button>
          <button disabled={last} className={item} onClick={() => { setOpen(false); onDown(); }}><IconArrowDown size={14} />Move down</button>
          <button className={`${item} text-[#C03221]`} onClick={() => { setOpen(false); onDelete(); }}><IconTrash size={14} />Delete</button>
        </div>
      )}
    </div>
  );
}

// The edit form IS the sentence: status, type, brand, who, collaborators.
function RuleForm({ initial, isNew, people, sbus, busy, onCancel, onSave }: {
  initial: Simple; isNew: boolean; people: Person[]; sbus: string[]; busy: boolean; onCancel: () => void; onSave: (s: Simple) => void;
}) {
  const [s, setS] = useState<Simple>(initial);
  const set = (p: Partial<Simple>) => setS((x) => ({ ...x, ...p }));
  const design = ALL_TYPES.filter((t) => !VIDEO_TYPES.has(t)), video = ALL_TYPES.filter((t) => VIDEO_TYPES.has(t));
  const momentOptions = [
    { value: CREATED, label: "(a new task is created)", head: "NEW TASK" },
    ...TASK_STATUSES.map((st, i) => ({ value: st, label: st, head: i === 0 ? "STATUS CHANGES TO" : undefined })),
    { value: TYPE_CHANGE, label: "(the type changes — pick the new type below)", head: "TYPE CHANGES" },
    { value: HANDED, label: "(the task is handed to someone else)", head: "OWNER CHANGES" },
  ];
  const ownerOptions = [{ value: "", label: "Nobody — only add collaborators" }, { value: POOL, label: "The editors’ claim pool" }, { value: REMEMBERED, label: "The editor who had it before (else the claim pool)" }, ...people.map((p) => ({ value: p.value, label: p.label }))];
  const line = "grid grid-cols-1 sm:grid-cols-[132px_1fr] items-center gap-1.5 sm:gap-3";
  const kw = "text-[13.5px] text-[#4A5468]";
  const valid = !!s.owner || s.collabs.length > 0;
  return (
    // preview-scope on the overlay (as ConfirmDialog does): the portal sits outside the page, so it needs the brand colours itself.
    <Overlay onClose={onCancel} className="fixed inset-0 bg-black/40 z-[300] flex items-start justify-center p-6 pt-24 overflow-auto preview-scope">
      <div className="w-full max-w-[560px] bg-white rounded-2xl border border-gray-100" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-1"><h2 className="text-[17px] font-medium text-[#232D42]">{isNew ? "New rule" : "Edit rule"}</h2></div>
        <div className="px-5 py-3 flex flex-col gap-2.5">
          <div className={line}><span className={kw}>{s.moment === CREATED || s.moment === HANDED || s.moment === TYPE_CHANGE ? "If" : "If status moves to"}</span>
            <Pick value={s.moment} options={momentOptions} onChange={(v) => set({ moment: v })} /></div>
          <div className={line}><span className={kw}>{s.moment === TYPE_CHANGE ? "new type is" : "and type is"}</span>
            <CheckList value={s.types} groups={[{ name: "DESIGN", items: design }, { name: "VIDEO", items: video }]} empty="Any type" onChange={(v) => set({ types: v })} /></div>
          <div className={line}><span className={kw}>and Primary Interest is</span>
            <CheckList value={s.brands} groups={[{ name: "PRIMARY INTERESTS", items: sbus }]} empty="Any Primary Interest" onChange={(v) => set({ brands: v })} /></div>
          <div className={line}><span className={kw}>assign to</span>
            <Pick value={s.owner} options={ownerOptions} onChange={(v) => set({ owner: v })} /></div>
          <div className={line}><span className={kw}>collaborators</span>
            <CheckList value={s.collabs} groups={[{ name: "PEOPLE", items: people.map((p) => p.value) }]} labelOf={(k) => people.find((p) => p.value === k)?.label || k}
              empty="Nobody else" onChange={(v) => set({ collabs: v })} /></div>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-4 pt-2">
          <button onClick={onCancel} className="h-9 px-4 rounded-lg border border-gray-200 text-[13px] font-medium text-[#232D42] hover:border-brand hover:text-brand">Cancel</button>
          <button disabled={busy || !valid} onClick={() => onSave(s)} className="h-9 px-4 rounded-lg bg-brand text-white text-[13px] font-medium hover:bg-brand-dark disabled:opacity-50">Save rule</button>
        </div>
      </div>
    </Overlay>
  );
}

// Dashboard-style dropdowns (the grey system ones looked out of place).
function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, close]);
  return ref;
}
const boxBtn = "w-full min-h-[40px] border rounded-[10px] pl-3 pr-9 py-1.5 text-left text-[14px] text-[#232D42] bg-white relative flex flex-wrap items-center gap-1";
const chev = <svg className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A92A6]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6l6-6" /></svg>;
const menuCls = "absolute z-40 left-0 right-0 top-full mt-1 bg-white border border-gray-100 rounded-xl p-1.5 max-h-[280px] overflow-auto";

function Pick({ value, options, onChange }: { value: string; options: { value: string; label: string; head?: string }[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} className={`${boxBtn} ${open ? "border-brand" : "border-[#E3E6EE] hover:border-brand"}`}>
        {options.find((o) => o.value === value)?.label || "Pick one"}{chev}
      </button>
      {open && (
        <div className={menuCls}>
          {options.map((o) => (
            <div key={o.value}>
              {o.head && <div className="text-[11px] tracking-wide text-[#8A92A6] px-2.5 pt-2 pb-1">{o.head}</div>}
              <button type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[13.5px] hover:bg-[#F6F7FB] ${o.value === value ? "text-[#2138B0] font-medium" : "text-[#232D42]"}`}>{o.label}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CheckList({ value, groups, empty, labelOf = (k) => k, onChange }: {
  value: string[]; groups: { name: string; items: string[] }[]; empty: string; labelOf?: (k: string) => string; onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  // A long list (Primary Interests) gets a search box; upper or lower case doesn't matter.
  const [q, setQ] = useState("");
  const long = groups.reduce((n, g) => n + g.items.length, 0) > 8;
  const match = (k: string) => !q.trim() || labelOf(k).toLowerCase().includes(q.trim().toLowerCase());
  const tag = (k: string) => <span key={k} className="bg-brand-light text-[#2138B0] rounded-md px-1.5 py-px text-[12.5px] font-medium">{labelOf(k)}</span>;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => { setOpen(!open); setQ(""); }} className={`${boxBtn} ${open ? "border-brand" : "border-[#E3E6EE] hover:border-brand"}`}>
        {value.length ? (value.length > 4 ? <>{value.slice(0, 3).map(tag)}<span className="bg-brand-light text-[#2138B0] rounded-md px-1.5 py-px text-[12.5px] font-medium">+{value.length - 3}</span></> : value.map(tag)) : <span className="text-[#8A92A6]">{empty}</span>}
        {chev}
      </button>
      {open && (
        <div className={menuCls}>
          {long && (
            <label className="flex items-center gap-2 mx-1 mt-1 mb-1 px-2.5 py-1.5 border border-[#E6E9F2] rounded-lg text-[#8A92A6] focus-within:border-brand">
              <IconSearch size={14} stroke={1.8} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-[#232D42]" />
            </label>
          )}
          {groups.map((g) => {
            const all = g.items.length > 0 && g.items.every((x) => value.includes(x));
            return (
              <div key={g.name}>
                <div className="flex items-center justify-between px-2.5 pt-2 pb-1 text-[11px] tracking-wide text-[#8A92A6]">
                  <span>{g.name}</span>
                  <button type="button" className="text-brand font-medium text-[11.5px] tracking-normal" onClick={() => onChange(all ? value.filter((x) => !g.items.includes(x)) : Array.from(new Set([...value, ...g.items])))}>{all ? "Clear" : "Select all"}</button>
                </div>
                {g.items.filter(match).map((k) => {
                  const on = value.includes(k);
                  return (
                    <button type="button" key={k} onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-[13.5px] hover:bg-[#F6F7FB] ${on ? "text-[#2138B0] font-medium" : "text-[#232D42]"}`}>
                      <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${on ? "bg-brand border-brand text-white" : "border-[#C9CDD8]"}`}>{on && <IconCheck size={11} stroke={3} />}</span>
                      {labelOf(k)}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
