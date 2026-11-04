"use client";
import { useEffect, useState } from "react";
import {
  IconUsersGroup, IconKey, IconMail, IconCheck, IconUserPlus, IconAlertTriangle,
  IconLayoutGrid, IconClockHour4, IconChecklist, IconCalendarEvent, IconIdBadge2, IconLock, IconSend, IconPlugConnected,
} from "@tabler/icons-react";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { usePublishPages } from "@/lib/use-publish-pages";
import { CAPABILITIES, DATE_APPROVAL_RULE, DATE_REASON_RULE, TABS, TASK_ACTIONS, canConnectClaude, canClaude, hasCapability, needsDateApproval, needsDateReason, canEditCalendar, type Capability } from "@/lib/permissions";

type Member = {
  id: string;
  email: string;
  name: string;
  first: string;
  initials: string;
  role: string;
  isAdmin: boolean;
  active: boolean;
  hasPassword: boolean;
  permissions: Perm;
  sections: Record<string, boolean>;
  photoUrl?: string | null;
  workRole?: WorkRole | null;
  shiftStart?: string;
  editPartner?: string | null;
};
type WorkRole = "writer" | "designer" | "editor" | "manager";
// Role in the workflow decides who gets approved design work, who claims videos, who
// writes and who approves date changes; shift start sets their day and quiet hours.
const WORK_ROLES: { v: WorkRole; label: string }[] = [
  { v: "writer", label: "Writer" }, { v: "designer", label: "Designer" }, { v: "editor", label: "Editor" }, { v: "manager", label: "Manager" },
];
type Perm = Record<string, unknown> & { tabs?: Record<string, boolean>; scheduler_pages?: string[]; task_access?: "full" | "partial"; calendar_edit?: boolean; date_needs_approval?: boolean; date_needs_reason?: boolean; manage_access?: boolean; claude_publish?: boolean; claude_create?: boolean; claude_edit?: boolean; claude_delete?: boolean };
type AccessReq = { id: string; from: string; fromName: string; text: string; at: string };

export default function TeamPage() {
  return (
    <PreviewDashboardShell active="team" title="Team & access" subtitle="Who can open which pages and do which actions. Every setting is a switch — change it any time." hideAccountPicker hideRange>
      {() => <TeamManager />}
    </PreviewDashboardShell>
  );
}

/* ── shared bits ───────────────────────────────────────────────────────────── */

// A card with a labelled header, per the dashboard's section pattern — content
// never sits on a bare background.
function Panel({ icon, title, meta, children }: {
  icon: React.ReactNode; title: string; meta?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <header className="flex items-center gap-2.5 px-5 py-3.5 border-b border-gray-100">
        <span className="text-brand shrink-0">{icon}</span>
        <h2 className="text-[14px] font-medium text-[#232D42]">{title}</h2>
        {meta && <div className="ml-auto flex items-center gap-2">{meta}</div>}
      </header>
      {children}
    </section>
  );
}

// Replaces the native checkbox. A switch reads as "this is a live setting that
// takes effect", which is what admin and active actually are — both write
// straight to the server on change.
function Toggle({ checked, disabled, onChange, label }: {
  checked: boolean; disabled?: boolean; onChange: (next: boolean) => void; label: string;
}) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[21px] w-[37px] items-center rounded-full transition-colors disabled:opacity-40 ${
        checked ? "bg-brand" : "bg-gray-200"
      }`}
    >
      <span
        className={`inline-block h-[15px] w-[15px] rounded-full bg-white transition-transform ${
          checked ? "translate-x-[19px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

// Borderless until you touch it. Eight bordered boxes per row made the roster
// read as a spreadsheet; the border now appears on hover/focus, so the page
// looks like a list of people and still edits in place.
const FIELD =
  "w-full min-w-0 px-2.5 py-1.5 rounded-lg bg-transparent text-[13px] text-[#232D42] " +
  "border border-transparent hover:border-gray-200 focus:border-brand focus:bg-white " +
  "focus:outline-none transition-colors placeholder:text-[#A6ACBE]";

function Pill({ tone, children }: { tone: "good" | "mute" | "brand"; children: React.ReactNode }) {
  const map = {
    good: "bg-[#E8F6F0] text-[#2F9E6F]",
    mute: "bg-[#F6F7FB] text-[#8A92A6]",
    brand: "bg-brand-light text-brand",
  };
  return <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${map[tone]}`}>{children}</span>;
}

/* ── page ──────────────────────────────────────────────────────────────────── */

// Approved prototype "Team & access" (22 Oct): people on the left, one person's
// switches on the right. Every setting is a switch — nothing is fixed per person in
// code (Praveen, 22 Oct): Admin, one switch per sidebar tab, Scheduler pages (full or
// selected), task actions (full or partial), calendar editing, date approval.

type Draft = { isAdmin: boolean; sections: Record<string, boolean>; permissions: Perm; name: string; email: string; role: string; active: boolean; workRole: WorkRole | null; shiftStart: string; editPartner: string };

const GROUPS = Array.from(new Set(TABS.map((t) => t.group)));
// List order asked for on 22 Oct; anyone added later goes after, A–Z.
const PEOPLE_ORDER = ["maheen", "nandu", "praveen", "manya", "nikhil"];
const byOrder = (a: Member, b: Member) => {
  const ia = PEOPLE_ORDER.indexOf(a.id), ib = PEOPLE_ORDER.indexOf(b.id);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
};
const SENSITIVE: Record<string, string> = { Sales: "customer names and phone numbers", Ads: "ad spend and budgets" };

/** Is this tab on in the draft? Admin = every tab unless switched off by name. */
function tabOn(d: Draft, key: string): boolean {
  if (d.isAdmin) return d.permissions.tabs?.[key] !== false;
  const t = TABS.find((x) => x.key === key)!;
  if (d.sections[t.sec] !== true) return false;
  const v = d.permissions.tabs?.[key];
  return typeof v === "boolean" ? v : !t.adminDefault;
}
/** Flip one tab and write every tab explicitly, so turning a section on through one
 *  tab doesn't quietly switch on its neighbours. Sections follow their tabs. */
function setTab(d: Draft, key: string, v: boolean): Draft {
  // An admin keeps every page; only the one switched off is written down.
  if (d.isAdmin) return { ...d, permissions: { ...d.permissions, tabs: { ...(d.permissions.tabs || {}), [key]: v } } };
  const tabs: Record<string, boolean> = {};
  for (const t of TABS) tabs[t.key] = t.key === key ? v : tabOn({ ...d, isAdmin: false }, t.key);
  const sections: Record<string, boolean> = { overview: true };
  for (const t of TABS) if (tabs[t.key]) sections[t.sec] = true;
  return { ...d, sections, permissions: { ...d.permissions, tabs } };
}
const capOn = (d: Draft, c: Capability) => d.permissions.task_access === "full" ? TASK_ACTIONS.includes(c) || d.permissions[c] === true : d.permissions.task_access === "partial" ? d.permissions[c] === true : d.isAdmin || d.permissions[c] === true;
const taskMode = (d: Draft): "full" | "partial" => d.permissions.task_access || (d.isAdmin || TASK_ACTIONS.every((c) => d.permissions[c] === true) ? "full" : "partial");

function TeamManager() {
  const [team, setTeam] = useState<Member[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [add, setAdd] = useState({ id: "", name: "", email: "", role: "" });
  const [locked, setLocked] = useState(false);
  const [meId, setMeId] = useState("");
  const [reqs, setReqs] = useState<AccessReq[]>([]);
  const loadReqs = () => fetch("/api/access-requests", { cache: "no-store" }).then((r) => r.json()).then((d) => setReqs(d.isManager ? d.requests || [] : [])).catch(() => {});

  async function load() {
    setError("");
    try {
      const r = await fetch("/api/admin/team");
      const d = await r.json();
      if (r.status === 403 && d?.locked) { setLocked(true); setTeam([]); return; }
      if (!r.ok) throw new Error(d?.error || "Failed to load the team");
      const sorted = [...(d.team as Member[])].sort(byOrder);
      setTeam(sorted);
      setMeId(d.me || "");
      // A request notification links here with ?person= — open that person.
      const want = new URLSearchParams(window.location.search).get("person");
      setSelId((cur) => cur || (want && sorted.some((m) => m.id === want) ? want : null) || sorted[0]?.id || null);
      loadReqs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the team");
      setTeam([]);
    }
  }
  useEffect(() => { load(); }, []);

  function flash(msg: string) { setNotice(msg); setTimeout(() => setNotice(""), 4000); }

  async function call(method: "PATCH" | "POST", body: unknown): Promise<boolean> {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/admin/team", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "That didn't work");
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
      return false;
    } finally { setBusy(false); }
  }

  if (team === null) return <div className="bg-white rounded-2xl border border-gray-100 px-5 py-8 text-[13px] text-[#8A92A6]">Loading the team…</div>;
  if (locked) return <LockedAccess />;
  const sel = team.find((m) => m.id === selId) || null;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-[#FDECEA] border border-[#F5C6C0] px-4 py-2.5 text-[12.5px] text-[#C0392B]">{error}</div>}
      {notice && <div className="flex items-center gap-2 rounded-xl bg-[#E8F6F0] border border-[#CDEBDF] px-4 py-2.5 text-[12.5px] text-[#2F9E6F]"><IconCheck size={15} stroke={2} className="shrink-0" />{notice}</div>}
      {reqs.length > 0 && (
        <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <header className="flex items-center gap-2 px-4 py-3.5 border-b border-gray-100 bg-brand-light">
            <IconKey size={17} stroke={1.8} className="text-brand" />
            <h2 className="text-[14px] font-medium text-[#232D42]">Access requests</h2>
            <span className="text-[12px] text-[#8A92A6]">{reqs.length} waiting</span>
          </header>
          <div className="divide-y divide-gray-100">
            {reqs.map((q) => (
              <div key={q.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-[#232D42]"><span className="font-medium">{q.fromName}</span> · {q.text}</div>
                  <div className="text-[11.5px] text-[#8A92A6] mt-0.5">{new Date(q.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}</div>
                </div>
                {team.some((m) => m.id === q.from) && <button onClick={() => setSelId(q.from)} className="text-[12.5px] font-medium text-brand hover:text-brand-dark">Open {q.fromName.split(" ")[0]}</button>}
                <button onClick={async () => { await fetch("/api/access-requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: q.id }) }); loadReqs(); flash("Marked done."); }}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-[12.5px] font-medium text-[#232D42] hover:border-brand">Mark done</button>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] gap-5 items-start">
        <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <header className="flex items-center gap-2 px-4 py-3.5 border-b border-gray-100">
            <IconUsersGroup size={17} stroke={1.8} className="text-brand" />
            <h2 className="text-[14px] font-medium text-[#232D42]">People</h2>
            <span className="text-[12px] text-[#8A92A6]">{team.filter((m) => m.active).length} can sign in</span>
            <button onClick={() => setShowAdd((v) => !v)} className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-brand text-white text-[12px] font-medium hover:bg-brand-dark"><IconUserPlus size={14} stroke={1.8} />Add</button>
          </header>
          {showAdd && (
            <div className="px-4 py-3 border-b border-gray-100 bg-[#FCFCFE] space-y-2">
              {([["name", "Full name", "Asha Nair"], ["email", "Work email", "asha@goocampus.in"], ["id", "Short id", "asha (lowercase, no spaces)"], ["role", "Job title", "Content Writer"]] as const).map(([key, label, ph]) => (
                <label key={key} className="block"><span className="block text-[11px] font-medium text-[#8A92A6] mb-1">{label}</span>
                  <input value={add[key]} onChange={(e) => setAdd((x) => ({ ...x, [key]: e.target.value }))} placeholder={ph} className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-brand focus:outline-none text-[13px] text-[#232D42] placeholder:text-[#C9CDD8] bg-white" /></label>
              ))}
              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setShowAdd(false)} className="text-[13px] text-[#8A92A6] hover:text-[#232D42]">Cancel</button>
                <button disabled={busy} onClick={async () => {
                  if (await call("POST", { action: "add", ...add })) { const id = add.id.trim().toLowerCase(); setAdd({ id: "", name: "", email: "", role: "" }); setShowAdd(false); setSelId(id || null); flash("Added — choose what they can open and do."); }
                }} className="px-3.5 py-1.5 rounded-lg bg-brand text-white text-[12.5px] font-medium hover:bg-brand-dark disabled:opacity-50">Add</button>
              </div>
            </div>
          )}
          <div className="p-2">
            {team.map((m) => (
              <button key={m.id} type="button" onClick={() => setSelId(m.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left ${m.id === selId ? "bg-brand-light" : "hover:bg-[#F6F7FB]"} ${m.active ? "" : "opacity-60"}`}>
                <span className="w-9 h-9 rounded-full bg-brand-light text-brand text-[12px] font-medium flex items-center justify-center shrink-0 border border-white">{m.initials}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-[#232D42] truncate">{m.name}</span>
                  <span className="block text-[11.5px] text-[#8A92A6] truncate">{m.role || m.email}</span>
                </span>
                {m.isAdmin && <Pill tone="brand">Admin</Pill>}
                {!m.active && <Pill tone="mute">Off</Pill>}
              </button>
            ))}
          </div>
        </section>
        {sel ? (
          <PersonEditor key={sel.id} m={sel} team={team} busy={busy} viewerId={meId}
            onSave={async (d) => {
              const updates: Record<string, unknown> = { is_admin: d.isAdmin, sections: d.sections, permissions: d.permissions, active: d.active };
              if (d.name.trim() && d.name.trim() !== sel.name) updates.name = d.name.trim();
              if (d.email.trim() !== sel.email) updates.email = d.email.trim();
              if (d.role.trim() !== sel.role) updates.role = d.role.trim();
              if (d.workRole && d.workRole !== sel.workRole) updates.workRole = d.workRole;
              if (d.shiftStart && d.shiftStart !== (sel.shiftStart || "09:00")) updates.shiftStart = d.shiftStart;
              if (d.editPartner !== (sel.editPartner || "")) updates.editPartner = d.editPartner;
              if (await call("PATCH", { id: sel.id, updates })) flash(`Saved ${sel.first}'s access — it applies from their next page load.`);
            }}
            onAction={async (body, msg) => { if (await call("POST", body)) flash(msg); }} />
        ) : <div className="bg-white rounded-2xl border border-gray-100 px-5 py-8 text-[13px] text-[#8A92A6]">Pick a person.</div>}
      </div>
    </div>
  );
}

function Section({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="px-6 py-5 border-t border-gray-100 first:border-t-0">
      <div className="flex items-center gap-2"><span className="text-brand">{icon}</span><h3 className="text-[14px] font-medium text-[#232D42]">{title}</h3></div>
      {hint && <p className="text-[12px] text-[#8A92A6] mt-1 mb-3">{hint}</p>}
      {children}
    </div>
  );
}
function Choice({ options, value, onChange, disabled }: { options: { v: string; label: string }[]; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex gap-1.5 mb-3">
      {options.map((o) => (
        <button key={o.v} type="button" disabled={disabled} onClick={() => onChange(o.v)}
          className={`px-3.5 py-1.5 rounded-lg text-[12.5px] font-medium border transition-colors disabled:opacity-50 ${value === o.v ? "bg-brand border-brand text-white" : "bg-white border-gray-200 text-[#4A5468] hover:border-brand"}`}>{o.label}</button>
      ))}
    </div>
  );
}
function Tick({ checked, label, onChange, disabled }: { checked: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`inline-flex items-center gap-2 border rounded-lg px-3 py-2 text-[13px] cursor-pointer ${checked ? "border-brand bg-brand-light text-[#2138B0]" : "border-gray-200 text-[#4A5468]"} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
      <input type="checkbox" className="accent-[#3A57E8]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />{label}
    </label>
  );
}

function PersonEditor({ m, team, busy, viewerId, onSave, onAction }: { m: Member; team: Member[]; busy: boolean; viewerId: string; onSave: (d: Draft) => void; onAction: (body: unknown, msg: string) => void }) {
  // The pages they can be allowed to post to: GooCampus's and every linked brand's.
  const brandPages = usePublishPages().map((p) => ({ value: p.value, label: p.label }));
  const fresh = (): Draft => ({ isAdmin: m.isAdmin, sections: { ...(m.sections || {}) }, permissions: { ...(m.permissions || {}) }, name: m.name, email: m.email, role: m.role, active: m.active, workRole: m.workRole ?? null, shiftStart: m.shiftStart || "09:00", editPartner: m.editPartner || "" });
  const [d, setD] = useState<Draft>(fresh);
  const [pw, setPw] = useState<string | null>(null);
  const dirty = JSON.stringify(d) !== JSON.stringify(fresh());
  const setPerm = (patch: Partial<Perm>) => setD((x) => ({ ...x, permissions: { ...x.permissions, ...patch } }));
  const mode = taskMode(d);
  const schedOn = tabOn(d, "scheduler");
  const pages = Array.isArray(d.permissions.scheduler_pages) ? d.permissions.scheduler_pages : null;

  return (
    <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      {/* Who + Admin */}
      <div className="px-6 py-5 flex items-center gap-3">
        <span className="w-9 h-9 rounded-full bg-brand-light text-brand text-[12px] font-medium flex items-center justify-center shrink-0">{m.initials}</span>
        <div className="min-w-0 flex-1"><div className="text-[15px] font-medium text-[#232D42]">{m.name}</div><div className="text-[12.5px] text-[#8A92A6]">{d.role || m.email}</div></div>
        <span className="text-[13px] font-medium text-[#232D42]">Admin</span>
        <Toggle checked={d.isAdmin} disabled={busy} label="Admin" onChange={(v) => setD((x) => ({ ...x, isAdmin: v }))} />
      </div>
      <p className="px-6 -mt-2 pb-4 text-[12px] text-[#8A92A6]">Admin opens every page (except any switched off below). Task actions below still follow their own switches.</p>
      <div className="mx-6 mb-4 flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2.5">
        <IconKey size={16} stroke={1.8} className="text-brand shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[#232D42]">Can change access</div>
          <div className="text-[12px] text-[#8A92A6]">{m.id === viewerId && d.permissions.manage_access === true ? "You can't turn this off for yourself." : "Only people with this on can change anyone's access. Everyone else sees this page locked and sends a request."}</div>
        </div>
        <Toggle checked={d.permissions.manage_access === true} disabled={busy || (m.id === viewerId && m.permissions?.manage_access === true)} label="Can change access" onChange={(v) => setPerm({ manage_access: v })} />
      </div>
      {m.isAdmin && !d.isAdmin && (
        <div className="mx-6 mb-4 flex gap-2 rounded-lg bg-[#FDF6E7] px-3 py-2 text-[12px] leading-relaxed text-[#8A5A00]">
          <IconAlertTriangle size={15} stroke={1.8} className="shrink-0 mt-[2px]" />
          <span><span className="font-medium">Taking away Admin.</span> {m.first} will see only the pages switched on below, and lose Team &amp; access and the System pages.</span>
        </div>
      )}

      <Section icon={<IconLayoutGrid size={16} stroke={1.8} />} title="Pages" hint="One switch per tab. Off = hidden from their sidebar, and the page won't open.">
        {d.isAdmin && <div className="mb-3 rounded-lg bg-brand-light text-[#2138B0] px-3 py-2 text-[12.5px]">Admin is on, so every page is open. Switch a page off here to hide it for them (for example My Day for someone with no tasks of their own).</div>}
        <div className="space-y-4">
          {GROUPS.map((g) => (
            <div key={g}>
              <div className="text-[10.5px] uppercase tracking-[.07em] text-[#A6ACBE] font-medium mb-1">{g}{SENSITIVE[g] && <span className="normal-case tracking-normal text-[#B7791F] ml-2">shows {SENSITIVE[g]}</span>}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-8">
                {TABS.filter((t) => t.group === g).map((t) => (
                  <div key={t.key} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-[13px] text-[#232D42]">{t.label}</span>
                    <Toggle checked={tabOn(d, t.key)} disabled={busy} label={t.label} onChange={(v) => setD((x) => setTab(x, t.key, v))} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section icon={<IconClockHour4 size={16} stroke={1.8} />} title="Scheduler" hint="Which brand pages they can schedule and publish to.">
        {schedOn ? (
          <>
            <Choice disabled={busy} value={pages ? "partial" : "full"} options={[{ v: "full", label: "Full access" }, { v: "partial", label: "Selected pages" }]}
              onChange={(v) => setPerm({ scheduler_pages: v === "full" ? undefined : (pages || []) })} />
            {pages ? (
              <div className="flex flex-wrap gap-2">
                {brandPages.map((b) => <Tick key={b.value} label={b.label} disabled={busy} checked={pages.includes(b.value)}
                  onChange={(on) => setPerm({ scheduler_pages: on ? [...pages, b.value] : pages.filter((x) => x !== b.value) })} />)}
                {!pages.length && <span className="text-[12px] text-[#C0392B] self-center">Tick at least one page, or they can&apos;t schedule anything.</span>}
              </div>
            ) : <div className="text-[12.5px] text-[#8A92A6]">All pages: GooCampus, GooCampus World, 12thPlus.com</div>}
          </>
        ) : <div className="text-[12.5px] text-[#8A92A6]">The Scheduler page is off for {m.first}. Switch it on under Pages to choose brand pages.</div>}
      </Section>

      <Section icon={<IconChecklist size={16} stroke={1.8} />} title="Task actions" hint="What they can do to tasks.">
        <Choice disabled={busy} value={mode} options={[{ v: "full", label: "Full access" }, { v: "partial", label: "Partial access" }]}
          onChange={(v) => setPerm(v === "full" ? { task_access: "full" } : { task_access: "partial", ...Object.fromEntries(TASK_ACTIONS.map((c) => [c, capOn(d, c)])) })} />
        {mode === "partial" ? (
          <div className="flex flex-wrap gap-2">
            {CAPABILITIES.filter((c) => TASK_ACTIONS.includes(c.key)).map((c) => (
              <Tick key={c.key} label={c.label} disabled={busy} checked={d.permissions[c.key] === true} onChange={(on) => setPerm({ task_access: "partial", [c.key]: on })} />
            ))}
          </div>
        ) : <div className="text-[12.5px] text-[#8A92A6]">{CAPABILITIES.filter((c) => TASK_ACTIONS.includes(c.key)).map((c) => c.label).join(" · ")}</div>}
      </Section>

      {/* Everything Claude may do for this person, in one place (Praveen, 4 Nov 2026).
          Each switch also needs the matching permission above. */}
      <Section icon={<IconPlugConnected size={16} stroke={1.8} />} title="Connectors" hint="What Claude (Claude app, claude.ai, Claude Code) may do for them. Each also needs the matching task permission above.">
        {(() => {
          const u = { isAdmin: d.isAdmin, permissions: d.permissions as never };
          const on = canConnectClaude(u);
          const rows: { key: string; label: string; desc: string; checked: boolean; needs?: string }[] = [
            { key: "claude_create", label: "Create tasks", desc: "Make new tasks on the board.", checked: canClaude(u, "create"), needs: hasCapability(u, "create_tasks") ? undefined : "Needs Create tasks." },
            { key: "claude_edit", label: "Edit tasks", desc: "Status, dates, owner, caption, content, collaborators. Date moves follow the approval rules.", checked: canClaude(u, "edit"), needs: hasCapability(u, "edit_tasks") ? undefined : "Needs Edit tasks." },
            { key: "claude_publish", label: "Schedule & publish", desc: "Schedule, reschedule, unschedule, retry or publish now — only to their Scheduler pages.", checked: canClaude(u, "publish") },
            { key: "claude_delete", label: "Delete tasks", desc: "To the recycle bin only, one or many, and only with a reason. Can restore from the bin.", checked: canClaude(u, "delete"), needs: hasCapability(u, "delete_tasks") ? undefined : "Needs Delete tasks." },
          ];
          return (
            <div className="divide-y divide-gray-50">
              <div className="flex items-center justify-between gap-3 py-2">
                <div><div className="text-[13px] text-[#232D42]">Connect Claude</div><div className="text-[12px] text-[#8A92A6]">They can connect Claude to the dashboard (System → Connectors).</div></div>
                <Toggle checked={on} disabled={busy} label="Connect Claude" onChange={(v) => setPerm({ claude_connector: v })} />
              </div>
              {rows.map((r) => (
                <div key={r.key} className="flex items-center justify-between gap-3 py-2 pl-4">
                  <div><div className="text-[13px] text-[#232D42]">{r.label}</div><div className="text-[12px] text-[#8A92A6]">{!on ? "Needs Connect Claude to be on first." : r.needs || r.desc}</div></div>
                  <Toggle checked={r.checked} disabled={busy || !on || !!r.needs} label={r.label} onChange={(v) => setPerm({ [r.key]: v })} />
                </div>
              ))}
            </div>
          );
        })()}
      </Section>

      <Section icon={<IconCalendarEvent size={16} stroke={1.8} />} title="Calendar & dates">
        <div className="flex items-center justify-between gap-3 py-2">
          <div><div className="text-[13px] text-[#232D42]">Edit calendar</div><div className="text-[12px] text-[#8A92A6]">{hasCapability({ isAdmin: d.isAdmin, permissions: d.permissions as never }, "reschedule") ? "Drag tasks and change dates in the Content and Mentorship calendars and the Post Planner. Off = view only." : "Needs Change dates (Task actions) to be on first."}</div></div>
          <Toggle checked={canEditCalendar({ isAdmin: d.isAdmin, permissions: d.permissions as never })} disabled={busy || !hasCapability({ isAdmin: d.isAdmin, permissions: d.permissions as never }, "reschedule")} label="Edit calendar" onChange={(v) => setPerm({ calendar_edit: v })} />
        </div>
        <div className="flex items-center justify-between gap-3 py-2">
          <div><div className="text-[13px] text-[#232D42]">{DATE_APPROVAL_RULE.label}</div><div className="text-[12px] text-[#8A92A6]">{DATE_APPROVAL_RULE.desc}</div></div>
          <Toggle checked={needsDateApproval({ id: m.id, permissions: d.permissions as never })} disabled={busy} label={DATE_APPROVAL_RULE.label} onChange={(v) => setPerm({ date_needs_approval: v })} />
        </div>
        <div className="flex items-center justify-between gap-3 py-2">
          <div><div className="text-[13px] text-[#232D42]">{DATE_REASON_RULE.label}</div><div className="text-[12px] text-[#8A92A6]">{DATE_REASON_RULE.desc}</div></div>
          <Toggle checked={needsDateReason({ permissions: d.permissions as never })} disabled={busy} label={DATE_REASON_RULE.label} onChange={(v) => setPerm({ date_needs_reason: v })} />
        </div>
      </Section>

      <Section icon={<IconClockHour4 size={16} stroke={1.8} />} title="Role in the workflow" hint="Who gets which work, and when their day starts. Design goes to the Designer, videos to the Editors, the Writer writes, the Manager approves date changes. The edit partner is the on-camera pair.">
        <div className="flex items-end gap-6 flex-wrap">
          <div><span className="block text-[11px] text-[#8A92A6] mb-1">Role</span>
            <Choice options={WORK_ROLES} value={d.workRole || ""} disabled={busy} onChange={(v) => setD((x) => ({ ...x, workRole: v as WorkRole }))} /></div>
          <label className="block mb-3"><span className="block text-[11px] text-[#8A92A6] mb-1">Shift starts</span>
            <input type="time" value={d.shiftStart} disabled={busy} onChange={(e) => setD((x) => ({ ...x, shiftStart: e.target.value }))} className={`${FIELD} border-gray-200 w-[130px]`} /></label>
          {/* The on-camera pair: when this person presents a pool video, the edit goes
              straight to their partner; when the partner edits one, this person presents. */}
          <div className="mb-3 w-[220px]"><span className="block text-[11px] text-[#8A92A6] mb-1">When they present, editing goes to</span>
            <PreviewSelect value={d.editPartner} disabled={busy} ariaLabel="Edit partner" onChange={(v) => setD((x) => ({ ...x, editPartner: v }))}
              options={[{ value: "", label: "No one — stays in the pool" }, ...team.filter((t) => t.id !== m.id && t.active).map((t) => ({ value: t.id, label: t.first || t.name }))]} /></div>
        </div>
      </Section>

      <Section icon={<IconIdBadge2 size={16} stroke={1.8} />} title="Profile & sign-in">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
          <label className="block"><span className="block text-[11px] text-[#8A92A6] mb-1">Full name</span><input value={d.name} onChange={(e) => setD((x) => ({ ...x, name: e.target.value }))} className={`${FIELD} border-gray-200`} /></label>
          <label className="block"><span className="block text-[11px] text-[#8A92A6] mb-1">Work email</span><input value={d.email} onChange={(e) => setD((x) => ({ ...x, email: e.target.value }))} className={`${FIELD} border-gray-200`} /></label>
          <label className="block"><span className="block text-[11px] text-[#8A92A6] mb-1">Job title</span><input value={d.role} onChange={(e) => setD((x) => ({ ...x, role: e.target.value }))} className={`${FIELD} border-gray-200`} /></label>
          <label className="flex items-center gap-2 pb-1.5 text-[12.5px] text-[#232D42]"><Toggle checked={d.active} disabled={busy} label="Can sign in" onChange={(v) => setD((x) => ({ ...x, active: v }))} /> Can sign in</label>
        </div>
        <div className="mt-3 flex items-center gap-3 flex-wrap text-[12px]">
          <Pill tone={m.hasPassword ? "good" : "mute"}>{m.hasPassword ? "Own password" : "Shared team password"}</Pill>
          <button disabled={busy || !m.email} onClick={() => onAction({ action: "invite", id: m.id }, `Invite emailed to ${m.first} — they'll set their own password.`)} className="inline-flex items-center gap-1 text-brand hover:underline disabled:text-[#C9CDD8]"><IconMail size={14} stroke={1.8} />{m.hasPassword ? "Re-send invite" : "Send invite"}</button>
          {pw === null ? (
            <button onClick={() => setPw("")} className="inline-flex items-center gap-1 text-[#8A92A6] hover:text-[#232D42]"><IconKey size={14} stroke={1.8} />{m.hasPassword ? "Change password" : "Set password"}</button>
          ) : (
            <span className="inline-flex items-center gap-2">
              <input autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (8+ characters)" className="w-52 px-2.5 py-1.5 rounded-lg border border-gray-200 focus:border-brand focus:outline-none text-[12.5px] text-[#232D42]" />
              <button disabled={busy || pw.length < 8} onClick={() => { onAction({ action: "set_password", id: m.id, password: pw }, `${m.first}'s password is set — share it with them privately.`); setPw(null); }} className="px-2.5 py-1.5 rounded-lg bg-brand text-white text-[11.5px] font-medium disabled:opacity-50">Set</button>
              <button onClick={() => setPw(null)} className="text-[#8A92A6]">Cancel</button>
            </span>
          )}
          {m.hasPassword && <button disabled={busy} onClick={() => onAction({ action: "clear_password", id: m.id }, `${m.first} is back on the shared password.`)} className="text-[#A6ACBE] hover:text-[#C0392B]">Back to shared password</button>}
        </div>
      </Section>

      <div className="flex items-center justify-between gap-3 px-6 py-3.5 border-t border-gray-100 bg-[#FBFBFD]">
        <span className="text-[12.5px] text-[#8A92A6]">{dirty ? "You have unsaved changes." : "Changes are not saved until you click Save."}</span>
        <div className="flex gap-2">
          <button disabled={!dirty || busy} onClick={() => setD(fresh())} className="h-9 px-4 rounded-lg border border-gray-200 text-[13px] text-[#232D42] hover:border-brand hover:text-brand disabled:opacity-40">Discard</button>
          <button disabled={!dirty || busy} onClick={() => onSave(d)} className="h-9 px-4 rounded-lg bg-brand text-white text-[13px] font-medium hover:bg-brand-dark disabled:opacity-40">{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </section>
  );
}

/** What everyone without "Can change access" sees: the page locked, and a way to ask. */
function LockedAccess() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [mine, setMine] = useState<AccessReq[]>([]);
  const loadMine = () => fetch("/api/access-requests", { cache: "no-store" }).then((r) => r.json()).then((d) => setMine(d.requests || [])).catch(() => {});
  useEffect(() => { loadMine(); }, []);
  const send = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/access-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "That didn't send");
      setText(""); setMsg(`Sent to ${(d.sentTo || []).join(" and ")}.`); loadMine();
    } catch (e) { setMsg(e instanceof Error ? e.message : "That didn't send"); } finally { setBusy(false); }
  };
  return (
    <section className="max-w-[560px] mx-auto bg-white rounded-2xl border border-gray-100 px-7 py-7">
      <div className="w-11 h-11 rounded-xl bg-brand-light text-brand flex items-center justify-center mb-3"><IconLock size={20} stroke={1.8} /></div>
      <h2 className="text-[16px] font-medium text-[#232D42]">Access is locked</h2>
      <p className="text-[13px] text-[#8A92A6] mt-1 leading-relaxed">Only the people who manage access can change who sees which page or does which action. If you need something changed, ask here — they&apos;ll get a notification.</p>
      <label className="block mt-5"><span className="block text-[11px] font-medium text-[#8A92A6] mb-1">What do you need?</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="e.g. I need the Scheduler for GooCampus World"
          className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-brand focus:outline-none text-[13px] text-[#232D42] placeholder:text-[#C9CDD8] bg-white resize-y" /></label>
      <div className="flex items-center justify-end gap-3 mt-3">
        {msg && <span className="text-[12.5px] text-[#8A92A6] mr-auto">{msg}</span>}
        <button disabled={busy || !text.trim()} onClick={send} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand text-white text-[12.5px] font-medium hover:bg-brand-dark disabled:opacity-50"><IconSend size={14} stroke={1.8} />{busy ? "Sending…" : "Request a change"}</button>
      </div>
      {mine.length > 0 && (
        <div className="mt-5 pt-4 border-t border-gray-100">
          <div className="text-[11px] font-medium text-[#8A92A6] mb-2">Waiting</div>
          {mine.map((q) => <div key={q.id} className="text-[12.5px] text-[#232D42] py-1">{q.text}</div>)}
        </div>
      )}
    </section>
  );
}
