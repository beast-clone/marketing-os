"use client";
import { useEffect, useState } from "react";
import { IconTrash, IconPlus, IconAlertTriangle } from "@tabler/icons-react";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { confirmDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";
import { showToast } from "@/app/(dashboard)/dashboard/preview/Toast";
import { CONTENT_TYPES } from "@/lib/mh-content-types";
import { useSbus, addBrand } from "@/lib/use-sbus";

// The rules that name a person, as rows you can change.
//
// In the table an owner rule and a collaborator rule are separate rows. Here they
// are shown as ONE line per brand + type — "Design for 12thPlus.com → owner
// Praveen, collaborator Nandu" — because two lists with two different "Add a rule"
// buttons left nobody sure which list a rule belonged in. Each half is still its
// own row underneath: the owner half is read by the database trigger at approval,
// the collaborator half by lib/task-create.ts when the task is made.

export type Rule = {
  id: string;
  kind: "owner" | "collaborator";
  sbu: string | null;
  content_kind: string | null;   // "video" | "design" | an exact type | null
  assign_to: string | null;
  priority: number;
  active: boolean;
  note: string | null;
};

type Person = { value: string; label: string; active: boolean };
const POOL = "__pool__";

type Group = { key: string; sbu: string | null; kind: string | null; owner?: Rule; helper?: Rule };

const keyOf = (sbu: string | null, kind: string | null) => `${sbu ?? ""}|${kind ?? ""}`;
const KIND_LABEL: Record<string, string> = { design: "Design work", video: "Video" };
const label = (g: { sbu: string | null; kind: string | null }) =>
  `${g.kind ? KIND_LABEL[g.kind] ?? g.kind : "All work"} for ${g.sbu ?? "any Primary Interest"}`;

// The three broad choices first, then every exact type (sql/026).
const TYPE_OPTIONS = [
  { value: "", label: "All work" },
  { value: "design", label: "Design work (any)" },
  { value: "video", label: "Video (any)" },
  ...CONTENT_TYPES.map((t) => ({ value: t, label: t })),
];

function groupRules(rules: Rule[]): Group[] {
  const m = new Map<string, Group>();
  for (const r of rules) {
    const k = keyOf(r.sbu, r.content_kind);
    const g = m.get(k) ?? { key: k, sbu: r.sbu, kind: r.content_kind };
    if (r.kind === "owner") g.owner = r; else g.helper = r;
    m.set(k, g);
  }
  // "Any Primary Interest" lines first — they are the defaults everything else overrides.
  return [...m.values()].sort((a, b) =>
    Number(!!a.sbu) - Number(!!b.sbu) || (a.sbu ?? "").localeCompare(b.sbu ?? "") ||
    (a.kind ?? "").localeCompare(b.kind ?? ""));
}

export function RuleEditor() {
  const sbus = useSbus();   // live brand list (sql/027)
  const [rules, setRules] = useState<Rule[] | null>(null);
  // From the Team page's roster (via the rules API), so a new teammate appears here
  // on their own. Inactive people come too, only to label rules that still name them.
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newSbu, setNewSbu] = useState("");
  const [newKind, setNewKind] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newHelper, setNewHelper] = useState("");

  const load = () =>
    fetch("/api/marketing-hub/rules", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { setRules(d.rules || []); setPeople(d.people || []); })
      .catch(() => setRules([]));
  useEffect(() => { load(); }, []);

  const call = async (method: string, body?: unknown, query = "") => {
    const r = await fetch(`/api/marketing-hub/rules${query}`, {
      method, headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  };

  // Run a change, reload, and say it landed.
  const run = async (id: string, fn: () => Promise<unknown>, toast = true) => {
    setBusy(id); setErr(null);
    try {
      await fn();
      await load();
      if (toast) showToast({ who: "Rule saved", body: "It applies from the next task onward.", color: "#3A57E8", av: "✓" });
      return true;
    } catch (e) { setErr((e as Error).message); await load(); return false; }
    finally { setBusy(null); }
  };

  /** Set one half of a line. "" removes that half; anything else creates or updates it. */
  const setHalf = (g: Group, half: "owner" | "collaborator", v: string) => {
    const existing = half === "owner" ? g.owner : g.helper;
    const assign = v === POOL ? null : v;
    return run(g.key, async () => {
      if (!v) { if (existing) await call("DELETE", undefined, `?id=${existing.id}`); return; }
      if (existing) await call("PATCH", { id: existing.id, assign_to: assign });
      else await call("POST", { kind: half, sbu: g.sbu, content_kind: g.kind, assign_to: assign });
    });
  };

  const halves = (g: Group) => [g.owner, g.helper].filter(Boolean) as Rule[];
  const isOn = (g: Group) => halves(g).some((r) => r.active);

  const toggle = (g: Group) => {
    const next = !isOn(g);
    return run(g.key, () => Promise.all(halves(g).map((r) => call("PATCH", { id: r.id, active: next }))));
  };

  const remove = async (g: Group) => {
    const ok = await confirmDialog({
      title: "Remove this rule?",
      body: <>&ldquo;{label(g)}&rdquo; will stop applying. Tasks already assigned are not changed.</>,
      action: "Remove",
      danger: true,
    });
    if (!ok) return;
    await run(g.key, () => Promise.all(halves(g).map((r) => call("DELETE", undefined, `?id=${r.id}`))), false);
  };

  if (rules === null) return <div className="text-[13px] text-[#8A92A6] px-4 py-6">Reading the rules…</div>;
  const groups = groupRules(rules);

  const active = people.filter((p) => p.active).map(({ value, label }) => ({ value, label }));
  // An inactive person is offered only in the row that already names them, marked
  // as left — picking someone new is how that row gets fixed.
  const withLeaver = (opts: { value: string; label: string }[], current: string | null | undefined) => {
    const gone = current ? people.find((p) => p.value === current && !p.active) : null;
    return gone ? [...opts, { value: gone.value, label: `${gone.label} (left)` }] : opts;
  };
  const ownerOptions = (cur?: string | null) =>
    [{ value: "", label: "Not set" }, ...withLeaver(active, cur), { value: POOL, label: "Nobody — claim pool" }];
  const helperOptions = (cur?: string | null) => [{ value: "", label: "Not set" }, ...withLeaver(active, cur)];

  // The row read out loud, with the status it happens at (Praveen, 26 Oct: "at what
  // task status? … until content is pending it will be with Manya; once content is
  // approved it will go to Praveen — how will they know this?").
  const nameOf = (k: string | null | undefined) => people.find((p) => p.value === k)?.label || k || "";
  const sentence = (g: Group): string[] => {
    const what = !g.kind ? "a task" : g.kind === "design" ? "design work" : g.kind === "video" ? "video work" : `a ${g.kind}`;
    const scope = `${what} for ${g.sbu ?? "any Primary Interest"}`;
    const out: string[] = [];
    if (g.helper?.assign_to) out.push(`When ${scope} is created (Content - Pending), the writer owns it and ${nameOf(g.helper.assign_to)} is added as collaborator.`);
    if (g.owner) {
      if (!g.owner.assign_to) out.push(`When ${scope} is approved (Content - Approved), nobody owns it — it waits in the editors' pool until someone claims it.`);
      else out.push(`When ${scope} is approved (Content - Approved), it is handed to ${nameOf(g.owner.assign_to)}.`);
    } else if (g.helper?.assign_to) out.push("Who it goes to after approval is decided by the design / video rule.");
    return out;
  };

  const add = async () => {
    const kind = newKind || null;
    const sbu = newSbu || null;
    if (!newOwner && !newHelper) { setErr("Pick an owner, a collaborator, or both."); return; }
    if (groups.some((g) => g.key === keyOf(sbu, kind))) {
      setErr(`There is already a rule for “${label({ sbu, kind })}”. Change it in its row instead.`);
      return;
    }
    const ok = await run("new", async () => {
      if (newOwner) await call("POST", { kind: "owner", sbu, content_kind: kind, assign_to: newOwner === POOL ? null : newOwner });
      if (newHelper) await call("POST", { kind: "collaborator", sbu, content_kind: kind, assign_to: newHelper });
    });
    if (ok) { setAdding(false); setNewSbu(""); setNewKind(""); setNewOwner(""); setNewHelper(""); }
  };

  const fieldLabel = "block text-[12px] text-[#8A92A6] font-semibold mb-1";

  return (
    <div className="flex flex-col gap-4">
      {err && !adding && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-[12.5px] px-3 py-2.5">
          <IconAlertTriangle size={15} className="mt-[1px] shrink-0" /> {err}
        </div>
      )}

      {/* No overflow-hidden: it clipped the pickers' menus. */}
      <section className="bg-white border border-gray-100 rounded-xl">
        <div className="px-4 py-3.5 border-b border-gray-100">
          <h2 className="text-[16px] font-medium text-[#232D42]">Who gets the task — you can change these</h2>
          <div className="text-[12.5px] text-[#8A92A6] mt-0.5 leading-relaxed">
            <b className="font-medium text-[#4A5468]">Handed to</b> — who owns the task once its content is approved.{" "}
            <b className="font-medium text-[#4A5468]">Added as collaborator</b> — who is put on the task when it is created.{" "}
            The most exact rule wins: a named brand first, then an exact type like &ldquo;Carousel&rdquo;, then design/video; &ldquo;Not set&rdquo; means the broader rule applies. Nobody is ever both owner and collaborator.
          </div>
        </div>


        <ul className="divide-y divide-gray-50">
          {groups.map((g) => (
            <li key={g.key} className={`px-4 py-3.5 flex items-start gap-3 flex-wrap ${isOn(g) ? "" : "opacity-60"}`}>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium text-[#232D42]">{label(g)}</div>
                {sentence(g).map((t, i) => <div key={i} className="text-[12.5px] text-[#4A5468] leading-relaxed mt-0.5">{t}</div>)}
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-[205px] whitespace-nowrap text-right text-[11px] text-[#8A92A6]"><b className="font-medium text-[#4A5468]">Content - Pending</b> · collaborator</span>
                  <PreviewSelect className="w-[178px]" value={g.helper?.assign_to ?? ""}
                    onChange={(v) => setHalf(g, "collaborator", v)} options={helperOptions(g.helper?.assign_to)} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-[205px] whitespace-nowrap text-right text-[11px] text-[#8A92A6]"><b className="font-medium text-[#4A5468]">Content - Approved</b> · handed to</span>
                  <PreviewSelect className="w-[178px]" value={g.owner ? (g.owner.assign_to ?? POOL) : ""}
                    onChange={(v) => setHalf(g, "owner", v)} options={ownerOptions(g.owner?.assign_to)} />
                </div>
              </div>
              <button onClick={() => toggle(g)} disabled={busy === g.key}
                title={isOn(g) ? "Switch this rule off" : "Switch it back on"}
                className={`text-[12px] font-medium rounded-lg border px-2.5 py-1.5 ${isOn(g) ? "border-gray-200 text-[#4A5468] hover:border-brand hover:text-brand" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                {isOn(g) ? "On" : "Off"}
              </button>
              <button onClick={() => remove(g)} disabled={busy === g.key}
                className="text-gray-300 hover:text-[#C03221]" title="Remove this rule">
                <IconTrash size={15} stroke={1.8} />
              </button>
            </li>
          ))}
          {!groups.length && <li className="px-4 py-6 text-[13px] text-[#8A92A6] text-center">No rules yet.</li>}
        </ul>

        <div className="px-4 py-3 border-t border-gray-100">
          {adding ? (
            <div className="flex items-end gap-3 flex-wrap">
              <label><span className={fieldLabel}>Primary Interest</span>
                <PreviewSelect className="w-[210px]" value={newSbu} onChange={setNewSbu}
                  options={[{ value: "", label: "Any Primary Interest" }, ...sbus.map((s) => ({ value: s, label: s }))]}
                  addOption={{ label: "Add a Primary Interest", onAdd: (name) => {
                    setErr(null);
                    addBrand(name).then((saved) => {
                      setNewSbu(saved);
                      showToast({ who: "Primary Interest added", body: `${saved} is now in every Primary Interest list.`, color: "#3A57E8", av: "✓" });
                    }).catch((e) => setErr((e as Error).message));
                  } }} /></label>
              <label><span className={fieldLabel}>Type of work</span>
                <PreviewSelect className="w-[190px]" value={newKind} onChange={setNewKind} options={TYPE_OPTIONS} /></label>
              <label><span className={fieldLabel}>Owner</span>
                <PreviewSelect className="w-[178px]" value={newOwner} onChange={setNewOwner} options={ownerOptions()} /></label>
              <label><span className={fieldLabel}>Collaborator</span>
                <PreviewSelect className="w-[160px]" value={newHelper} onChange={setNewHelper} options={helperOptions()} /></label>
              <button onClick={add} disabled={busy === "new"}
                className="rounded-lg bg-brand text-white text-[12.5px] font-medium px-3 py-2 hover:bg-brand-dark disabled:opacity-50">Add</button>
              <button onClick={() => { setAdding(false); setErr(null); }} className="text-[12.5px] text-[#4A5468] px-2 py-2">Cancel</button>
              {/* Right beside the button: shown at the top of the page it was scrolled
                  out of sight, and Add looked like it did nothing. */}
              {err && (
                <div className="basis-full flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-100 text-rose-700 text-[12.5px] px-3 py-2">
                  <IconAlertTriangle size={15} className="mt-[1px] shrink-0" /> {err}
                </div>
              )}
            </div>
          ) : (
            <button onClick={() => setAdding(true)}
              className="text-[12.5px] text-brand hover:underline inline-flex items-center gap-1">
              <IconPlus size={13} stroke={2} /> Add a rule
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
