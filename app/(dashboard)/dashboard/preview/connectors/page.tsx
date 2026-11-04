"use client";

import { useEffect, useState } from "react";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { confirmDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";
import {
  IconCopy, IconChevronRight, IconCheck, IconPlus, IconTerminal2, IconDeviceDesktop,
  IconWorld, IconAlertTriangle, IconLock, IconPlugConnected, IconX, IconRefresh, IconPlugX, IconAdjustments,
} from "@tabler/icons-react";

// System → Connectors.
//
// Things outside the dashboard that are allowed to talk to it. Claude is the only one
// today, but it is built as a list because the next one — n8n, Zapier, a phone app —
// should slot in beside it rather than becoming a second page nobody finds.
//
// The setup lived on the Account page and only ever explained the terminal. Nikhil and
// Nandu do not use a terminal; they use the Claude desktop app, and there was nothing
// here telling them how. Hence one card per platform, written for somebody who has
// never set up a connector before.

type Grant = { clientId: string; name: string; createdAt: string; lastUsedAt?: string };
type KeyState = { allowed: boolean; connected: boolean; createdAt?: string; lastUsedAt?: string; grants?: Grant[]; who?: string; isAdmin?: boolean; can?: { create: boolean; edit: boolean; publish: boolean; delete: boolean } };
type Person = { id: string; name: string; key: { createdAt?: string; lastUsedAt?: string } | null; grants: Grant[] };

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "never";

export default function ConnectorsPage() {
  return (
    <PreviewDashboardShell active="connectors" title="Connectors" hideAccountPicker hideRange
      subtitle="Apps that are allowed to talk to this dashboard on your behalf.">
      {() => <Connectors />}
    </PreviewDashboardShell>
  );
}

function Connectors() {
  return (
    <div className="space-y-3">
      {/* Adding one comes first: this page exists to get people connected, and the
          list below it is the record of what already is. */}
      <OtherConnectors>
        {(list) => (
          <div className="pt-1">
            <h2 className="text-[11.5px] font-semibold text-[#8A92A6] uppercase tracking-wider px-1 mb-2">Connected</h2>
            <div className="space-y-3">
              <ClaudeConnector />
              {list}
            </div>
          </div>
        )}
      </OtherConnectors>
      <EveryonesConnections />
    </div>
  );
}

// Admins: every Claude connection on the team, each named after its person and app,
// with a way to end one person's connections. Hidden for everyone else (the API is
// System-section only).
function EveryonesConnections() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const load = () =>
    fetch("/api/admin/connectors", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null)).then((j) => setPeople(j?.people ?? null)).catch(() => setPeople(null));
  useEffect(() => { load(); }, []);
  if (!people) return null;

  const end = async (p: Person) => {
    if (!(await confirmDialog({
      title: `Disconnect ${p.name}?`,
      body: `Every Claude connection and any personal key ${p.name} has stop working immediately. They can connect again with their own login.`,
      action: "Disconnect", danger: true,
    }))) return;
    await fetch(`/api/admin/connectors?user=${encodeURIComponent(p.id)}`, { method: "DELETE", credentials: "same-origin" });
    load();
  };

  return (
    <div className="pt-1">
      <h2 className="text-[11.5px] font-semibold text-[#8A92A6] uppercase tracking-wider px-1 mb-2">Everyone&apos;s connections</h2>
      <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-100">
        {people.length === 0 && <div className="p-4 text-[12.5px] text-[#8A92A6]">Nobody has connected Claude yet.</div>}
        {people.map((p) => (
          <div key={p.id} className="p-4 flex items-start gap-3">
            <span className="grid place-items-center w-9 h-9 rounded-lg bg-brand-light text-brand text-[13px] font-semibold shrink-0">{p.name.slice(0, 1).toUpperCase()}</span>
            <div className="flex-1 min-w-0 space-y-1">
              {p.grants.map((g) => (
                <div key={g.clientId} className="text-[13px] text-[#232D42]">
                  <span className="font-medium">{p.name}&apos;s {g.name}</span>
                  <span className="text-[#8A92A6]"> · connected {when(g.createdAt)} · last used {when(g.lastUsedAt)}</span>
                </div>
              ))}
              {p.key && (
                <div className="text-[13px] text-[#232D42]">
                  <span className="font-medium">{p.name}&apos;s personal key</span>
                  <span className="text-[#8A92A6]"> · made {when(p.key.createdAt)} · last used {when(p.key.lastUsedAt)}</span>
                </div>
              )}
            </div>
            <button onClick={() => end(p)}
              className="text-[12.5px] font-medium border border-gray-200 rounded-lg px-3 py-1.5 text-[#4A5468] hover:border-[#C03221] hover:text-[#C03221] transition shrink-0">
              Disconnect
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClaudeConnector() {
  const [st, setSt] = useState<KeyState | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState<"desktop" | "web" | "terminal">("desktop");

  const load = () =>
    fetch("/api/account/claude-key", { cache: "no-store", credentials: "same-origin" })
      .then((r) => r.json()).then(setSt).catch(() => setSt(null));
  useEffect(() => { load(); }, []);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const create = async () => {
    setBusy(true);
    const r = await fetch("/api/account/claude-key", { method: "POST", credentials: "same-origin" });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { setKey(j.key); load(); }
  };
  const disconnect = async () => {
    if (!(await confirmDialog({
      title: "Disconnect Claude?",
      body: "Every Claude connection and any personal key stop working immediately. You can connect again any time.",
      action: "Disconnect", danger: true,
    }))) return;
    await fetch("/api/account/claude-key", { method: "DELETE", credentials: "same-origin" });
    setKey(null); load();
  };

  if (!st) return <Card><div className="text-[13px] text-[#8A92A6]">Loading…</div></Card>;
  if (!st.allowed) {
    return (
      <Card>
        <Head connected={false} />
        <div className="flex items-start gap-2 mt-1">
          <IconLock size={15} className="text-[#A6ACBE] shrink-0 mt-0.5" />
          <p className="text-[13px] text-[#8A92A6]">
            You don&apos;t have this turned on yet. Ask an admin to switch on
            <b className="font-medium text-[#4A5468]"> Connect Claude</b> for you on the Team page.
          </p>
        </div>
      </Card>
    );
  }

  // The key is shown once, at creation. After that we only know that one exists.
  const baseUrl = `${origin}/api/mcp`;
  const cmd = key
    ? `claude mcp add --transport http --scope user goocampus ${origin}/api/mcp --header "Authorization: Bearer ${key}"`
    : `claude mcp add --transport http --scope user goocampus ${origin}/api/mcp --header "Authorization: Bearer YOUR-KEY"`;

  return (
    <Card>
      <Head connected={st.connected} />

      <p className="text-[13px] text-[#8A92A6] mb-3.5">
        Lets you work in Claude and have it act here. Research a story, write the copy, then say
        <i> &ldquo;put that on the board&rdquo;</i> — Claude creates the task as you, and asks which brand and
        which format if you haven&apos;t said. It can also read the board: <i>&ldquo;what&apos;s Manya
        working on&rdquo;</i>, <i>&ldquo;what&apos;s overdue&rdquo;</i>, <i>&ldquo;move that to Friday&rdquo;</i>.
      </p>

      <Step n={1} title="Set it up in Claude">
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {([
            ["desktop", "Claude app", IconDeviceDesktop],
            ["web", "claude.ai", IconWorld],
            ["terminal", "Claude Code", IconTerminal2],
          ] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setPlatform(k)}
              className={`inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg border transition ${
                platform === k ? "bg-brand text-white border-brand" : "bg-white text-[#4A5468] border-gray-200 hover:border-brand hover:text-brand"}`}>
              <Icon size={14} stroke={1.8} /> {label}
            </button>
          ))}
        </div>

        {platform === "terminal" ? (
          <>
            <Num n="1">Open your terminal and run:</Num>
            <div className="ml-6 mb-2"><CopyBox value={`claude mcp add --transport http --scope user goocampus ${baseUrl}`} mono ready /></div>
            <Num n="2">Restart Claude Code, then type <b className="font-medium text-[#4A5468]">/mcp</b> and pick <i>goocampus</i> to sign in.</Num>
            <Num n="3">Your browser opens on a GooCampus screen. Click <b className="font-medium text-[#4A5468]">Approve</b>.</Num>
          </>
        ) : (
          <>
            <Num n="1">
              {platform === "desktop"
                ? "Open the Claude app and go to Settings → Connectors."
                : "Open claude.ai, click your name at the bottom left, then Settings → Connectors."}
            </Num>
            <Num n="2">Click <b className="font-medium text-[#4A5468]">Add custom connector</b>.</Num>
            <Num n="3">Name it <b className="font-medium text-[#4A5468]">GooCampus</b> and paste this as the URL:</Num>
            <div className="ml-6 mb-2"><CopyBox value={baseUrl} mono ready /></div>
            <Num n="4">Click <b className="font-medium text-[#4A5468]">Add</b>, then <b className="font-medium text-[#4A5468]">Connect</b>.</Num>
            <Num n="5">A GooCampus screen opens. Click <b className="font-medium text-[#4A5468]">Approve</b>. That&apos;s it — you&apos;re connected.</Num>
          </>
        )}

        <p className="text-[12px] text-[#8A92A6] mt-2.5 flex items-start gap-1.5">
          <IconLock size={13} className="shrink-0 mt-0.5 text-[#A6ACBE]" />
          There is no key to copy or keep anywhere. You sign in with the GooCampus login you
          already have, and Claude gets access that expires and renews on its own.
        </p>
      </Step>

      <Step n={2} title="Your connections">
        {/* Named after the person and the app ("Nandu's Claude Code"), so it's clear
            whose connection it is — on this list and in each task's history. */}
        {st.grants?.length || st.connected ? (
          <div className="space-y-1.5 mb-2">
            {(st.grants || []).map((g) => (
              <div key={g.clientId} className="flex items-center gap-2 text-[13px] text-[#3B4457] flex-wrap">
                <IconCheck size={14} stroke={2.2} className="text-[#0F6E3C] shrink-0" />
                <b className="font-medium">{st.who}&apos;s {g.name}</b>
                <span className="text-[#8A92A6]">connected {when(g.createdAt)} · last used {when(g.lastUsedAt)}</span>
              </div>
            ))}
            {st.connected && (
              <div className="flex items-center gap-2 text-[13px] text-[#3B4457] flex-wrap">
                <IconCheck size={14} stroke={2.2} className="text-[#0F6E3C] shrink-0" />
                <b className="font-medium">{st.who}&apos;s personal key</b>
                <span className="text-[#8A92A6]">made {when(st.createdAt)} · last used {when(st.lastUsedAt)}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[12.5px] text-[#8A92A6] mb-2">
            Nothing connected yet. Follow step 1 and it&apos;ll show up here.
          </p>
        )}

        {(st.connected || st.grants?.length) ? (
          <button onClick={disconnect}
            className="text-[12.5px] font-medium border border-gray-200 rounded-lg px-3 py-1.5 text-[#4A5468] hover:border-[#C03221] hover:text-[#C03221] transition">
            Disconnect everything
          </button>
        ) : null}

        {/* The old way, kept for anything that can't do the sign-in dance. Tucked
            away on purpose: handing someone a secret to carry is how a key ended up
            pasted into a chat window on day one. */}
        <details className="mt-3 group">
          <summary className="text-[12px] text-[#8A92A6] cursor-pointer hover:text-brand list-none flex items-center gap-1">
            <IconChevronRight size={12} className="group-open:rotate-90 transition" />
            I need a personal key instead
          </summary>
          <div className="mt-2 pl-4 border-l-2 border-[#F3F5F9]">
            <p className="text-[12px] text-[#8A92A6] mb-2">
              Only for tools that can&apos;t sign in through a browser. A key is a password in plain
              text — don&apos;t paste it into a chat or a screenshot.
            </p>
            {key ? (
              <>
                <CopyBox value={`${baseUrl}/${key}`} mono ready />
                <p className="text-[11.5px] text-[#C03221] mt-1.5">Shown once. Make another if you lose it.</p>
              </>
            ) : (
              <button onClick={create} disabled={busy}
                className="text-[12.5px] font-medium border border-gray-200 rounded-lg px-3 py-1.5 text-[#4A5468] hover:border-brand hover:text-brand disabled:opacity-50">
                {busy ? "Creating…" : st.connected ? "Replace my key" : "Create a key"}
              </button>
            )}
            {st.connected && !key && (
              <p className="text-[11.5px] text-[#A6ACBE] mt-1.5">
                You have one — made {when(st.createdAt)}, last used {when(st.lastUsedAt)}.
              </p>
            )}
          </div>
        </details>
      </Step>

      {/* Step 3 — what it can and can't do, so nobody has to find out */}
      <Step n={3} title="What Claude can and can&apos;t do" last>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {/* Follows this person's switches on Team & access → Connectors (4 Nov 2026). */}
          <Can yes>Read tasks, search them, see what&apos;s due, see the Scheduler queue</Can>
          <Can yes>Read what Content Radar has found, and comment on tasks</Can>
          <Can yes={!!st.can?.create}>Create tasks{st.can?.create ? "" : " — not switched on for you"}</Can>
          <Can yes={!!st.can?.edit}>Edit tasks — status, dates, owner, copy, collaborators{st.can?.edit ? "" : " — not switched on for you"}</Can>
          <Can yes={!!st.can?.publish}>Schedule, reschedule, unschedule, retry or publish posts — to your Scheduler pages{st.can?.publish ? "" : " — not switched on for you"}</Can>
          <Can yes={!!st.can?.delete}>Delete tasks to the recycle bin (with a reason) and restore them{st.can?.delete ? "" : " — not switched on for you"}</Can>
          <Can>Erase anything for good, or move a task to a different Primary Interest</Can>
          <Can>See another person&apos;s key, or act as them</Can>
        </div>
        <p className="text-[12px] text-[#A6ACBE] mt-3">
          Everything Claude does here is recorded against your name in the task&apos;s activity, marked
          as coming from the connector. Your link is as good as your password — don&apos;t paste it in a
          group chat. If it ever leaks, come back here and make a new one; the old one dies instantly.
        </p>
      </Step>
    </Card>
  );
}

/* ------------------------------------------------------- other connectors */

// n8n, another AI tool, a script — anything that can send a key with its request
// (lib/connectors, Praveen 3 Nov 2026). Admins add one, tick what it may do, and get
// its key once. Its changes go under its own name. Non-admins see a note instead.
type Conn = { id: string; name: string; scopes: string[]; keyEnd: string; createdBy: string; createdAt: string; lastUsedAt?: string };
type ScopeDef = { key: string; label: string; desc: string };

function OtherConnectors({ children }: { children: (list: React.ReactNode) => React.ReactNode }) {
  const [data, setData] = useState<{ connectors: Conn[]; scopes: ScopeDef[] } | null | "no">(null);
  const [adding, setAdding] = useState(false);
  const [shownKey, setShownKey] = useState<{ name: string; key: string } | null>(null);
  const [editing, setEditing] = useState<Conn | null>(null);
  const load = () =>
    fetch("/api/connectors", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : "no")).then(setData).catch(() => setData("no"));
  useEffect(() => { load(); }, []);

  const admin = data && data !== "no";
  const scopes = admin ? data.scopes : [];
  const label = (k: string) => scopes.find((x) => x.key === k)?.label || k;

  const rotate = async (c: Conn) => {
    if (!(await confirmDialog({ title: `New key for ${c.name}?`, body: "The current key stops working at once. Paste the new one into the tool straight after.", action: "Make a new key" }))) return;
    const r = await fetch("/api/connectors", { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ id: c.id, op: "rotate" }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setShownKey({ name: c.name, key: j.key });
    load();
  };
  const remove = async (c: Conn) => {
    if (!(await confirmDialog({ title: `Disconnect ${c.name}?`, body: "Its key stops working at once. Anything it already changed stays.", action: "Disconnect", danger: true }))) return;
    await fetch(`/api/connectors?id=${encodeURIComponent(c.id)}`, { method: "DELETE", credentials: "same-origin" });
    load();
  };

  const list = admin ? data.connectors.map((c) => (
    <Card key={c.id}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="grid place-items-center w-10 h-10 rounded-xl bg-brand-light text-brand shrink-0"><IconPlugConnected size={20} stroke={1.8} /></span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-[#232D42]">{c.name}</div>
            <div className="text-[12.5px] text-[#8A92A6]">Changes go under its own name · key ending …{c.keyEnd} · last used {when(c.lastUsedAt)}</div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#0F6E3C] bg-[#E8F6EE] rounded-full px-2.5 py-1"><IconCheck size={13} stroke={2.2} />Connected</span>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {c.scopes.length ? c.scopes.map((s) => <span key={s} className="text-[12px] text-[#4A5468] bg-[#F6F7FB] border border-gray-100 rounded-lg px-2 py-0.5">{label(s)}</span>)
          : <span className="text-[12px] text-[#B76E00]">Allowed to do nothing yet</span>}
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={() => rotate(c)} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium border border-gray-200 rounded-lg px-3 py-1.5 text-[#4A5468] hover:border-brand hover:text-brand"><IconRefresh size={14} />Make a new key</button>
        <button onClick={() => setEditing(c)} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium border border-gray-200 rounded-lg px-3 py-1.5 text-[#4A5468] hover:border-brand hover:text-brand"><IconAdjustments size={14} />Change what it can do</button>
        <button onClick={() => remove(c)} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium border border-gray-200 rounded-lg px-3 py-1.5 text-[#4A5468] hover:border-[#C03221] hover:text-[#C03221]"><IconPlugX size={14} />Disconnect</button>
      </div>
    </Card>
  )) : null;

  return (
    <>
      {admin ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid place-items-center w-9 h-9 rounded-lg bg-brand-light text-brand shrink-0"><IconPlugConnected size={18} stroke={1.8} /></span>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-[#232D42]">Add a connector</div>
              <p className="text-[12.5px] text-[#8A92A6] mt-0.5">Any outside tool — n8n, another AI tool, a script. It gets its own key and only what you tick.</p>
            </div>
          </div>
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 bg-brand hover:bg-[#2138B0] text-white text-[13px] font-medium rounded-lg px-4 py-2"><IconPlus size={15} />Add a connector</button>
        </div>
      ) : data === "no" ? (
        <div className="bg-white border border-dashed border-[#D9DEEA] rounded-2xl p-5 flex items-center gap-3">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-[#F6F7FB] text-[#A6ACBE] shrink-0"><IconPlus size={18} stroke={1.8} /></span>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-[#232D42]">Add another connector</div>
            <p className="text-[12.5px] text-[#8A92A6] mt-0.5">Anything that should read or write this dashboard from outside — n8n, another AI tool — is added by an admin.</p>
          </div>
        </div>
      ) : null}
      {children(list)}
      {adding && admin && <AddConnectorModal scopes={scopes} onClose={() => setAdding(false)} onAdded={(name, key) => { setAdding(false); setShownKey({ name, key }); load(); }} />}
      {editing && admin && <ScopesModal conn={editing} scopes={scopes} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {shownKey && <KeyModal name={shownKey.name} secret={shownKey.key} onClose={() => setShownKey(null)} />}
    </>
  );
}

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-[#232D42]/40 flex items-start justify-center p-4 pt-16 overflow-auto" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl border border-gray-100 w-full max-w-[600px]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="text-[16px] font-semibold text-[#232D42]">{title}</div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#8A92A6] hover:bg-[#F6F7FB]" aria-label="Close"><IconX size={18} /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        <div className="px-5 py-3.5 border-t border-gray-100 flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

function ScopeTicks({ scopes, value, onChange }: { scopes: ScopeDef[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
      {scopes.map((s) => (
        <label key={s.key} className="flex items-start gap-3 px-3.5 py-2.5 cursor-pointer">
          <input type="checkbox" className="mt-1 accent-[#3A57E8]" checked={value.includes(s.key)}
            onChange={(e) => onChange(e.target.checked ? [...value, s.key] : value.filter((x) => x !== s.key))} />
          <span><span className="block text-[13.5px] font-medium text-[#232D42]">{s.label}</span><span className="block text-[12px] text-[#8A92A6]">{s.desc}</span></span>
        </label>
      ))}
      <div className="flex items-start gap-3 px-3.5 py-2.5">
        <IconX size={15} className="mt-0.5 text-[#C03221] shrink-0" />
        <span className="text-[12.5px] text-[#8A92A6]">Never: delete anything, or publish to Instagram, Facebook or LinkedIn.</span>
      </div>
    </div>
  );
}

function AddConnectorModal({ scopes, onClose, onAdded }: { scopes: ScopeDef[]; onClose: () => void; onAdded: (name: string, key: string) => void }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>(["read"]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr("");
    const r = await fetch("/api/connectors", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ name, scopes: picked }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) onAdded(j.connector.name, j.key); else setErr(j.error || "Couldn't add it — try again.");
  };
  return (
    <Modal title="Add a connector" onClose={onClose}
      footer={<>
        <button onClick={onClose} className="text-[13px] font-medium border border-gray-200 rounded-lg px-4 py-2 text-[#4A5468]">Cancel</button>
        <button onClick={save} disabled={busy || !name.trim()} className="text-[13px] font-medium bg-brand hover:bg-[#2138B0] text-white rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "Connecting…" : "Connect"}</button>
      </>}>
      <label className="block text-[12.5px] font-medium text-[#232D42] mb-1.5">Name it</label>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. n8n — Publisher"
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[14px] text-[#232D42] focus:outline-none focus:border-brand" />
      <p className="text-[12px] text-[#8A92A6] mt-1.5 mb-4">This name shows in each task&apos;s history next to what it changed.</p>
      <div className="text-[12.5px] font-medium text-[#232D42] mb-1.5">What may it do?</div>
      <ScopeTicks scopes={scopes} value={picked} onChange={setPicked} />
      {err && <p className="text-[12.5px] text-[#C03221] mt-3">{err}</p>}
    </Modal>
  );
}

function ScopesModal({ conn, scopes, onClose, onSaved }: { conn: Conn; scopes: ScopeDef[]; onClose: () => void; onSaved: () => void }) {
  const [picked, setPicked] = useState<string[]>(conn.scopes);
  const save = async () => {
    await fetch("/api/connectors", { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ id: conn.id, op: "scopes", scopes: picked }) });
    onSaved();
  };
  return (
    <Modal title={`What ${conn.name} can do`} onClose={onClose}
      footer={<>
        <button onClick={onClose} className="text-[13px] font-medium border border-gray-200 rounded-lg px-4 py-2 text-[#4A5468]">Cancel</button>
        <button onClick={save} className="text-[13px] font-medium bg-brand hover:bg-[#2138B0] text-white rounded-lg px-4 py-2">Save</button>
      </>}>
      <ScopeTicks scopes={scopes} value={picked} onChange={setPicked} />
    </Modal>
  );
}

function KeyModal({ name, secret, onClose }: { name: string; secret: string; onClose: () => void }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <Modal title={`${name} is connected`} onClose={onClose}
      footer={<button onClick={onClose} className="text-[13px] font-medium bg-brand hover:bg-[#2138B0] text-white rounded-lg px-4 py-2">Done</button>}>
      <div className="text-[12.5px] font-medium text-[#232D42] mb-1.5">Its key</div>
      <CopyBox value={secret} mono ready />
      <p className="text-[12px] text-[#B76E00] bg-[#FFF4E0] rounded-lg px-3 py-2 mt-2 flex items-start gap-1.5">
        <IconAlertTriangle size={14} className="shrink-0 mt-0.5" />Shown once. Paste it into the tool now — if it&apos;s lost, make a new one here and the old one stops working.
      </p>
      <div className="mt-4 border border-gray-100 rounded-xl p-3.5">
        <div className="text-[13.5px] font-medium text-[#232D42] mb-1.5">Set it up in the tool</div>
        <Num n="1">Server address (MCP, streamable HTTP):</Num>
        <div className="ml-6 mb-2"><CopyBox value={`${origin}/api/mcp`} mono ready /></div>
        <Num n="2">Send the key in a header: <b className="font-medium text-[#4A5468]">x-api-key</b> (or <b className="font-medium text-[#4A5468]">Authorization: Bearer …</b>). Never in the address — addresses end up in logs.</Num>
        <Num n="3">Run one request to test. It shows here as &ldquo;last used&rdquo;.</Num>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- bits */

// Claude's own logomark, in Anthropic's own colour, rather than a generic sparkle —
// a connector should look like the thing it connects to, so it is recognisable at a
// glance in a list. Inline SVG so it needs no network fetch and can't 404.
//
// Any connector added here should bring its official mark the same way: an inline
// path in its brand colour, falling back to a neutral glyph only if there isn't one.
function ClaudeMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#D97757" aria-label="Claude" role="img">
      <path d="M4.709 15.955l4.72-2.647.079-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.415 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.607.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
    </svg>
  );
}


function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white border border-gray-100 rounded-2xl p-5">{children}</div>;
}

function Head({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="grid place-items-center w-9 h-9 rounded-lg bg-[#F5EEE9] shrink-0">
        <ClaudeMark size={19} />
      </span>
      <div>
        <h2 className="text-[14.5px] font-semibold text-[#232D42]">Claude</h2>
        <p className="text-[11.5px] text-[#A6ACBE]">Anthropic · reads and writes the content board</p>
      </div>
      <span className={`ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2.5 py-1 ${
        connected ? "bg-[#E3F5EA] text-[#0F6E3C]" : "bg-[#F3F5F9] text-[#8A92A6]"}`}>
        <IconPlugConnected size={12} stroke={1.9} /> {connected ? "Connected" : "Not connected"}
      </span>
    </div>
  );
}

function Step({ n, title, children, last }: { n: number; title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex gap-3 pt-3.5 ${last ? "" : "pb-3.5 border-b border-[#F3F5F9]"}`}>
      <span className="w-[22px] h-[22px] rounded-full grid place-items-center text-[11.5px] font-bold bg-brand-light text-[#2138B0] shrink-0 mt-0.5">{n}</span>
      <div className="flex-1 min-w-0">
        <h3 className="text-[13.5px] font-semibold text-[#232D42] mb-2">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Num({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <p className="text-[13px] text-[#3B4457] mb-1.5 flex gap-2">
      <span className="text-[#A6ACBE] font-medium shrink-0">{n}.</span>
      <span>{children}</span>
    </p>
  );
}

function Can({ yes, children }: { yes?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 text-[12.5px]">
      {yes
        ? <IconCheck size={14} stroke={2.2} className="text-[#0F6E3C] shrink-0 mt-0.5" />
        : <span className="text-[#C03221] font-bold shrink-0 mt-[-1px] w-[14px] text-center">×</span>}
      <span className={yes ? "text-[#3B4457]" : "text-[#8A92A6]"}>{children}</span>
    </div>
  );
}

function CopyBox({ value, mono, ready }: { value: string; mono?: boolean; ready?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); } catch { /* the text is selectable either way */ }
    setCopied(true); setTimeout(() => setCopied(false), 2200);
  };
  return (
    <div className="flex items-start gap-2">
      <code className={`flex-1 min-w-0 break-all rounded-lg px-3 py-2 text-[12px] text-[#232D42] border ${
        ready ? "bg-brand-light border-[#C7CFF2]" : "bg-[#F6F7FB] border-gray-100"} ${mono ? "font-mono" : ""}`}>
        {value}
      </code>
      <button onClick={copy}
        className={`h-9 px-3 rounded-lg border text-[12.5px] font-medium shrink-0 inline-flex items-center gap-1.5 transition ${
          copied ? "border-[#BFE6CD] bg-[#E3F5EA] text-[#0F6E3C]"
          : ready ? "bg-brand border-brand text-white hover:bg-brand-dark"
          : "border-gray-200 text-[#4A5468] hover:border-brand hover:text-brand"}`}>
        {copied ? <IconCheck size={14} stroke={2} /> : <IconCopy size={14} stroke={1.8} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
