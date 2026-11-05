"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { LiveIndicator } from "@/components/LiveIndicator";
import { NewTaskDialog } from "@/components/new-task/NewTaskDialog";
import { useApi } from "@/lib/use-api";
import { IconPin, IconClipboardList, IconMovie, IconUsers, IconPaperclip, IconCloudUpload, IconCheck, IconTrash, IconMessageCircle, IconCalendar, IconSun, IconCloud, IconCloudRain, IconMoon, IconNote, IconClipboardText, IconClockHour4, IconPlus, IconSend } from "@tabler/icons-react";
import { alertDialog, confirmDialog, promptDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";

// PATCH /api/marketing-hub/update; when the server says the date move needs a reason
// (the person's "Ask why when a date moves" switch), ask and send it again.
async function updateTask(body: Record<string, unknown>): Promise<Response> {
  const send = (reason?: string) => fetch("/api/marketing-hub/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reason ? { ...body, reason } : body) });
  const r = await send();
  if (r.status !== 422) return r;
  const j = await r.clone().json().catch(() => ({}));
  if ((j as { gate?: string }).gate !== "reason") return r;
  const why = await promptDialog({ title: "Why is the date changing?", body: "Add a short reason — it's saved in the task's history.", placeholder: "e.g. Waiting for the speaker's photos", action: "Change date" });
  return why && why.trim() ? send(why.trim()) : r;
}

// The per-person day view — greeting, stat cards, reminders, task list + detail panel.
// Used in TWO places:
//   1. Admin "My Day" page (/dashboard/my-day) — with the "Viewing as" person switcher.
//   2. Each member's own tasks page (/me/tasks) — lockedPersonKey pins it to the
//      signed-in person; the switcher is hidden and localStorage is ignored.
//
// Detail panel has view mode and edit mode. Edit persists via
// PATCH /api/marketing-hub/update.

type Row = {
  id: string;
  particulars: string;
  type: string;
  status: string;
  sbu: string;
  owner: string;
  collaborators: string[];
  platforms: string[];
  publishTo: string;
  publishToPage: string;
  priority: string;
  publishingDate: string;
  dueDate: string;
  completionTime: string;
  createdDate: string;
  lastModified: string;
  needsReview: boolean;
  syncedToScheduler: boolean;
  caption: string;
  content: string;
  additionalInfo: string;
  outputLink: string;
  instagramUrl: string;
  facebookUrl: string;
  link: string;
  slackLink: string;
  attachments: { url: string; filename: string; type?: string }[];
};

type Data = { rows: Row[]; generatedAt: string; latencyMs: number; cached?: boolean };

type Role = "writer" | "designer" | "editor";
type Person = { key: string; label: string; role: Role; aliases: string[]; color: string; greeting: string };

const TEAM: Person[] = [
  { key: "manya",   label: "Manya",   role: "writer",   aliases: ["Manya B M", "Manya"],                              color: "#7A74C9", greeting: "Let's write something great" },
  { key: "praveen", label: "Praveen", role: "designer", aliases: ["Praveen L", "Praveen"],                            color: "#6F9BD1", greeting: "Ready to design" },
  { key: "nikhil",  label: "Nikhil",  role: "editor",   aliases: ["NIKHI Shyamraj", "Nikhil Shyamraj", "Nikhil"],     color: "#D9A05B", greeting: "Time to cut some reels" },
  { key: "nandu",   label: "Nandu",   role: "editor",   aliases: ["Nandu C", "Nandu"],                                color: "#5FB196", greeting: "Time to cut some reels" },
];

const ROLE_LABEL: Record<Role, string> = { writer: "Content writer", designer: "Graphic designer", editor: "Video editor" };
const DONE_STATUSES = ["Ready to Publish", "Published/Scheduled"];
const LS_KEY = "gc-dash:my-day:person";

// The status pill color palette — matches Airtable style.
const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  "Content - Pending":     { bg: "#F1EFE8", text: "#444441" },
  "Content - In Progress": { bg: "#FAEEDA", text: "#633806" },
  "Content - Approved":    { bg: "#EAF3DE", text: "#27500A" },
  "Incorporating Feedback":{ bg: "#FAEEDA", text: "#633806" },
  "Output - Ready":        { bg: "#E6F1FB", text: "#0C447C" },
  "Ready to Publish":      { bg: "#EAF3DE", text: "#27500A" },
  "Published/Scheduled":   { bg: "#E1F5EE", text: "#0F6E56" },
};

// Solid left-edge color per status (muted palette) for the task-list rows.
const STATUS_EDGE: Record<string, string> = {
  "Content - Pending":     "#94A3B8",
  "Content - In Progress": "#D9A05B",
  "Content - Approved":    "#5FB196",
  "Incorporating Feedback":"#D9A05B",
  "Output - Ready":        "#6F9BD1",
  "Ready to Publish":      "#5FB196",
  "Published/Scheduled":   "#7A74C9",
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  Low:    { bg: "#F1EFE8", text: "#444441" },
  Medium: { bg: "#E6F1FB", text: "#0C447C" },
  High:   { bg: "#FAEEDA", text: "#633806" },
  Urgent: { bg: "#FCEBEB", text: "#A32D2D" },
};

// Statuses shown in the Edit form's status dropdown.
const STATUS_OPTIONS = [
  "Content - Pending",
  "Content - In Progress",
  "Content - Approved",
  "Incorporating Feedback",
  "Output - Ready",
  "Ready to Publish",
  "Published/Scheduled",
];

const PRIORITY_OPTIONS = ["Low", "Medium", "High", "Urgent"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ownerMatches(owner: string, p: Person): boolean {
  if (!owner) return false;
  return p.aliases.some((a) => owner.toLowerCase() === a.toLowerCase());
}

function greetingOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// The person keys this view knows how to render (member pages check against this).
export const MY_DAY_TEAM_KEYS = TEAM.map((p) => p.key);

export function MyDayView({ range, lockedPersonKey }: { range: { from: string; to: string }; lockedPersonKey?: string }) {
  // Widen the fetch to cover the week ahead + a bit of context.
  const wideTo = new Date(Math.max(new Date(range.to).getTime(), Date.now() + 21 * 86_400_000)).toISOString().slice(0, 10);
  const wideFrom = new Date(Math.min(new Date(range.from).getTime(), Date.now() - 30 * 86_400_000)).toISOString().slice(0, 10);
  const qs = new URLSearchParams({ from: wideFrom, to: wideTo }).toString();
  const { data, isLoading, refresh } = useApi<Data>(`/api/marketing-hub?${qs}`);

  const [personKey, setPersonKey] = useState<string>(lockedPersonKey || "manya");
  useEffect(() => {
    if (lockedPersonKey) return; // member view — always the signed-in person
    try {
      const saved = window.localStorage.getItem(LS_KEY);
      if (saved && TEAM.some((p) => p.key === saved)) setPersonKey(saved);
    } catch { /* ignore */ }
  }, [lockedPersonKey]);
  const setPerson = (k: string) => {
    setPersonKey(k);
    setSelectedId(null);
    try { window.localStorage.setItem(LS_KEY, k); } catch { /* ignore */ }
  };

  const person = TEAM.find((p) => p.key === personKey) || TEAM[0];
  const todayStr = ymd(new Date());

  const mine = useMemo(() => {
    const rows = data?.rows || [];
    // Designers and editors only get the pipeline once the writer approves.
    // Writers see their whole pipeline from Content Pending onwards.
    const preContentStatuses = new Set(["Content - Pending", "Content - In Progress", "Incorporating Feedback"]);
    const isPostWriterRole = person.role === "designer" || person.role === "editor";
    const isStatic = (t: string) => /post|carousel|thumbnail|youtube.*(post|thumbnail)/i.test(t || "");
    const isVideo = (t: string) => /reel|video|long.*form/i.test(t || "");

    return rows.filter((r) => {
      if (isPostWriterRole && preContentStatuses.has(r.status)) return false;

      if (ownerMatches(r.owner, person)) return true;

      // Designer/editor also sees eligible-to-claim tasks so they can grab them from a task list
      if (person.key === "praveen" && isStatic(r.type)) return true;
      if ((person.key === "nikhil" || person.key === "nandu") && isVideo(r.type)) return true;

      return false;
    });
  }, [data, person]);

  // Bucket for header status line
  const counts = useMemo(() => {
    const today: Row[] = [];
    const week: Row[] = [];
    const waiting: Row[] = [];
    const done: Row[] = [];
    const weekAgo = ymd(new Date(Date.now() - 7 * 86_400_000));
    const weekAhead = ymd(new Date(Date.now() + 7 * 86_400_000));
    for (const r of mine) {
      const pd = r.publishingDate?.slice(0, 10) || "";
      const isDone = DONE_STATUSES.includes(r.status);
      if (isDone && r.completionTime?.slice(0, 10) >= weekAgo) done.push(r);
      if (isDone) continue;
      if (pd === todayStr) today.push(r);
      if (pd && pd >= todayStr && pd <= weekAhead) week.push(r);
      if (r.needsReview) waiting.push(r);
    }
    return { today, week, waiting, done };
  }, [mine, todayStr]);

  // Personal notepad — reminders manually added by the person.
  const [notes, setNotes] = useState<{ id: string; body: string; done: boolean }[]>([]);
  const [newNote, setNewNote] = useState("");
  const [notesBusy, setNotesBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/marketing-hub/notes?person=${personKey}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j.notes) setNotes(j.notes); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [personKey]);

  async function addNote() {
    const body = newNote.trim();
    if (!body || notesBusy) return;
    setNotesBusy(true);
    try {
      const r = await fetch(`/api/marketing-hub/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person: personKey, body }),
      });
      const j = await r.json();
      if (r.ok && j.note) {
        setNotes((prev) => [...prev, j.note]);
        setNewNote("");
      }
    } finally { setNotesBusy(false); }
  }

  async function toggleNote(id: string, done: boolean) {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, done } : n)));
    await fetch(`/api/marketing-hub/notes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, done }),
    });
  }

  async function deleteNote(id: string) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    await fetch(`/api/marketing-hub/notes?id=${id}`, { method: "DELETE" });
  }

  // selectedId → the task open in the My-tasks inline detail panel (right side).
  // planId → the task opened from a planner block (popup).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const selected = selectedId ? mine.find((r) => r.id === selectedId) || null : null;
  const planRow = planId ? mine.find((r) => r.id === planId) || null : null;

  // Team-chat messages live here so the accept flow can post a task card to them.
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>(CHAT_SEED);
  const pushChat = (m: Omit<ChatMsg, "id" | "time">) => setChatMsgs((p) => [...p, { ...m, id: `m${Date.now()}${Math.round(Math.random() * 999)}`, time: "now" }]);
  const sendChat = (text: string) => pushChat({ who: "You", init: "You", color: "#3B404D", bg: "#F1F3F7", text });

  // Clear selections when the person switches.
  useEffect(() => { setSelectedId(null); setPlanId(null); }, [personKey]);

  return (
    <div className="grid grid-cols-[1fr_336px] gap-5 items-start">
      {/* MAIN COLUMN */}
      <div className="space-y-5 min-w-0">
      {/* Compact greeting / weather bar */}
      <GreetingBar
        name={person.label}
        roleLabel={ROLE_LABEL[person.role]}
        todayCount={counts.today.length}
        weekCount={counts.week.length}
        right={
          <div className="flex items-center gap-3">
            {lockedPersonKey ? (
              <div className="text-sm text-gray-500">Your queue</div>
            ) : (
              <div className="inline-flex bg-white/70 border border-gray-200 rounded-lg p-1">
                {TEAM.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setPerson(p.key)}
                    className={`px-3.5 py-1.5 rounded-md text-sm transition ${personKey === p.key ? "bg-white shadow-sm text-gray-900 font-medium" : "text-gray-500 hover:text-gray-700"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <LiveIndicator fetchedAt={null} latencyMs={null} loading={isLoading} onRefresh={() => { refresh(); }} />
          </div>
        }
      />

      {/* Day planner — full width; click a block to open that task */}
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-2">To-do · needs your attention <span className="text-gray-300 normal-case font-normal tracking-normal">· your day, planned — click a block to open it</span></div>
        <TodaysPlan tasks={mine.filter((r) => !DONE_STATUSES.includes(r.status))} onSelect={setPlanId} canCreate={person.key === "manya"} />
      </div>

      {/* Stat cards — writer sees the full pipeline, designer/editor see only their downstream work */}
      {(() => {
        const isWriter = person.role === "writer";
        const pendingToday    = mine.filter((r) => (r.publishingDate?.slice(0, 10) || "") === todayStr && !DONE_STATUSES.includes(r.status)).length;
        const contentPending  = mine.filter((r) => r.status === "Content - Pending").length;
        const inProgress      = mine.filter((r) => r.status === "Content - In Progress").length;
        const feedback        = mine.filter((r) => r.status === "Incorporating Feedback").length;
        const contentApproved = mine.filter((r) => r.status === "Content - Approved").length;
        const outputReady     = mine.filter((r) => r.status === "Output - Ready").length;
        const readyToPublish  = mine.filter((r) => r.status === "Ready to Publish").length;
        const handedOff       = mine.filter((r) => ["Content - Approved", "Output - Ready", "Ready to Publish", "Published/Scheduled"].includes(r.status)).length;
        const completed       = counts.done.length;

        const cards = isWriter ? [
          { label: "Pending today",       value: pendingToday,    hint: "Publish date is today",       color: "#6F9BD1" },
          { label: "Content pending",     value: contentPending,  hint: "Awaiting your write-up",      color: "#94A3B8" },
          { label: "In progress",         value: inProgress,      hint: "Writing right now",           color: "#D9A05B" },
          { label: "Feedback to address", value: feedback,        hint: "Revisions requested",         color: "#C86B6B" },
          { label: "Content approved",    value: contentApproved, hint: "Approved, ready for output",  color: "#5FB196" },
          { label: "Handed off",          value: handedOff,       hint: "Past writer, with the team",  color: "#7A74C9" },
          { label: "Completed",           value: completed,       hint: "Wrapped up this week",        color: "#4E9A82" },
        ] : [
          { label: "Pending today",       value: pendingToday,    hint: "Publish date is today",             color: "#6F9BD1" },
          { label: "Waiting on me",       value: contentApproved, hint: "Content approved · start making",   color: "#D9A05B" },
          { label: "Output ready",        value: outputReady,     hint: "You've uploaded the creative",      color: "#7A74C9" },
          { label: "Ready to publish",    value: readyToPublish,  hint: "Queued for the scheduler",          color: "#5FB196" },
          { label: "Completed",           value: completed,       hint: "Wrapped up this week",              color: "#4E9A82" },
        ];
        const cols = cards.length === 7 ? "grid-cols-7" : "grid-cols-5";
        return (
          <div className={`grid ${cols} gap-3`}>
            {cards.map((c) => (
              <div key={c.label} className="bg-white border border-gray-100 rounded-xl px-4 py-3.5" title={c.hint}>
                <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500 leading-tight">{c.label}</div>
                <div className="mt-1 text-[26px] font-semibold tabular-nums text-gray-900 leading-tight">{c.value}</div>
                <div className="text-[10px] text-gray-400 mt-0.5 leading-tight truncate">{c.hint}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* My tasks — list on the left, detail opens inline on the right */}
      <div className="grid grid-cols-5 gap-4 items-start">
        <div className="col-span-2">
          <div className="bg-white border border-gray-100 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-base font-medium">My tasks <span className="text-xs text-gray-400 font-normal">· {mine.length}</span></div>
              {person.key === "manya" && <V1CreateTaskButton onCreated={refresh} />}
            </div>
            {mine.length === 0 && (
              <div className="text-sm text-gray-400 py-10 text-center">{isLoading ? "Loading…" : "Nothing on your plate right now."}</div>
            )}
            <div className="space-y-1.5 max-h-[560px] overflow-y-auto pr-1">
              {mine.map((r) => {
                const st = STATUS_STYLES[r.status] || STATUS_STYLES["Content - Pending"];
                const isOwner = ownerMatches(r.owner, person);
                const isVideoTask = /reel - |youtube long-form|youtube shorts|story \(video\)|meta ads - video/i.test(r.type || "");
                const isEligibleToClaim = !isOwner && person.role === "editor" && isVideoTask && ["Content - Approved", "Output - Ready"].includes(r.status);
                return (
                  <div key={r.id} className="relative">
                    <button
                      onClick={() => setSelectedId(r.id)}
                      className={`w-full text-left rounded-lg p-2.5 border ${selectedId === r.id ? "border-gray-200 bg-gray-50" : "border-gray-100 hover:border-gray-200"}`}
                    >
                      <div className="text-sm font-medium leading-tight pr-16">{r.particulars || "(untitled)"}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {r.type || "—"}
                        {r.publishingDate && ` · ${new Date(r.publishingDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                        {!isOwner && r.owner && <span className="text-gray-400"> · owned by {r.owner.split(" ")[0]}</span>}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-md" style={{ background: st.bg, color: st.text }}>
                          <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_EDGE[r.status] || "#94A3B8" }} />
                          {r.status || "—"}
                        </span>
                        {r.needsReview && <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">Review</span>}
                      </div>
                    </button>
                    {isEligibleToClaim && <ClaimRowButton postId={r.id} personKey={person.key} onDone={refresh} />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Detail panel — inline, on the right */}
        <div className="col-span-3">
          {selected ? (
            <DetailPanel
              row={selected}
              accent={person.color}
              personKey={person.key}
              onClose={() => setSelectedId(null)}
              onSaved={() => { refresh(); }}
            />
          ) : (
            <div className="bg-white border border-gray-100 rounded-xl p-10 text-center text-sm text-gray-400">
              <div className="flex justify-center mb-4"><IconClipboardList size={40} stroke={1.3} className="text-gray-300" /></div>
              <div className="text-base font-medium text-gray-700 mb-2">Pick a task from the left</div>
              <div>Full details, content, creatives, and timeline will open here.</div>
            </div>
          )}
        </div>
      </div>

      </div>

      {/* RIGHT RAIL — needs-you queue on top, then pin board · standup · reminders · chat */}
      <div className="space-y-4">
        <NeedsYou tasks={mine} person={person} onDone={() => { refresh(); }} onChatPush={pushChat} />
        <BoardCard title="Pin board" hint="anyone, anything" icon={<IconNote size={15} stroke={1.7} className="text-gray-400" />} seed={PIN_SEED} accent={person.color} placeholder="Pin something for the team…" />
        <BoardCard title="Today's standup notes" icon={<IconClipboardText size={15} stroke={1.7} className="text-gray-400" />} seed={STANDUP_SEED} checkable accent={person.color} placeholder="Add a note…" />
        {/* Reminders — real, per-person */}
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-sm font-medium flex items-center gap-2"><IconPin size={15} stroke={1.7} className="text-gray-400" /> Reminders</div>
            <div className="text-[11px] text-gray-400">{notes.filter((n) => !n.done).length} open · {notes.filter((n) => n.done).length} done</div>
          </div>
          <div className="space-y-0.5 mb-3 min-h-[40px]">
            {notes.length === 0 && (<div className="text-[13px] text-gray-400 py-1.5">Nothing here yet.</div>)}
            {notes.map((n) => (
              <div key={n.id} className="group flex items-start gap-2.5 px-1 py-1 rounded hover:bg-gray-50">
                <input type="checkbox" checked={n.done} onChange={(e) => toggleNote(n.id, e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded cursor-pointer flex-shrink-0" style={{ accentColor: person.color }} />
                <span className={`flex-1 text-[13px] ${n.done ? "line-through text-gray-400" : "text-gray-800"}`}>{n.body}</span>
                <button onClick={() => deleteNote(n.id)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-rose-600 transition flex-shrink-0" title="Delete"><IconTrash size={13} stroke={1.7} /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <input type="text" value={newNote} onChange={(e) => setNewNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addNote(); }} placeholder="Add a reminder…" className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-brand/30" />
            <button onClick={addNote} disabled={notesBusy || !newNote.trim()} className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40" style={{ background: person.color }}>Add</button>
          </div>
        </div>
        <ChatBox messages={chatMsgs} onSend={sendChat} />
      </div>

      {/* Task popup — opens when a planner block is clicked */}
      {planRow && (
        <TaskModal
          row={planRow}
          personKey={person.key}
          accent={person.color}
          onClose={() => setPlanId(null)}
          onSaved={() => { refresh(); }}
        />
      )}
    </div>
  );
}

// Rank the workflow statuses so we can render a horizontal progress bar.
// Incorporating Feedback loops back to Approved for display purposes.
const STATUS_RANK: Record<string, number> = {
  "Content - Pending":     0,
  "Content - In Progress": 1,
  "Content - Approved":    2,
  "Incorporating Feedback":2,
  "Output - Ready":        3,
  "Ready to Publish":      4,
  "Published/Scheduled":   5,
};

// The 5 stages shown on the horizontal timeline strip.
const TIMELINE_STAGES = [
  { rank: 0, label: "Draft" },
  { rank: 1, label: "In progress" },
  { rank: 2, label: "Approved" },
  { rank: 3, label: "Output ready" },
  { rank: 5, label: "Published" },
];

type Collaborator = { key: string; name: string; role: string | null; addedAt: string | null };
type Attachment = { id: string; filename: string; storage_path: string; thumb_path?: string | null; mime_type: string | null; size_bytes: number | null; uploaded_by: string | null; uploaded_at: string };
type Comment = { id: string; author_key: string; authorName: string; body: string; resolved: boolean; created_at: string };
type Activity = { id: string; actor_key: string; actorName: string; action: string; from_value: string | null; to_value: string | null; detail: string | null; created_at: string };
type TaskDetail = {
  content: string;
  notes: string;
  collaborators: Collaborator[];
  attachments: Attachment[];
  comments: Comment[];
  activity: Activity[];
  scheduler: { syncedToScheduler: boolean; startAt: string | null };
};

// Internal team chat. Local/in-session for now (seeded); wiring to a shared
// mh_messages table is the follow-up. A message can carry a task card (used when
// the accept flow reschedules a low-priority task and pings the team).
type ChatTaskCard = { title: string; type: string; status: string; link?: string };
type ChatMsg = { id: string; who: string; init: string; color: string; bg: string; time: string; text: string; task?: ChatTaskCard };
const CHAT_SEED: ChatMsg[] = [
  { id: "c1", who: "Manya", init: "M", color: "#3C3489", bg: "#EEEDFE", time: "10:24", text: "Reel script is final — B-roll notes are in the doc." },
  { id: "c2", who: "Maheen", init: "Mn", color: "#633806", bg: "#FAEEDA", time: "09:58", text: "Push the NEET reel first, ads can wait." },
  { id: "c3", who: "Nikhil", init: "N", color: "#7A4E0B", bg: "#FBF0DE", time: "09:50", text: "On it — cutting the intro now." },
];

function ChatBox({ messages, onSend }: { messages: ChatMsg[]; onSend: (text: string) => void }) {
  const [val, setVal] = useState("");
  function send() { const t = val.trim(); if (!t) return; onSend(t); setVal(""); }
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium flex items-center gap-2"><IconMessageCircle size={15} stroke={1.7} className="text-gray-400" /> Team chat</div>
        <div className="text-[11px] text-emerald-600 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> 4 online</div>
      </div>
      <div className="space-y-1 mb-3 max-h-[300px] overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className="flex gap-2.5 px-1 py-1.5 rounded hover:bg-gray-50">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[9.5px] font-semibold flex-shrink-0" style={{ background: m.bg, color: m.color }}>{m.init}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] leading-tight"><span className="font-medium capitalize">{m.who}</span> <span className="text-[10px] text-gray-400">{m.time}</span></div>
              {m.task && (
                <div className="mt-1 border border-gray-200 rounded-lg p-2 bg-gray-50">
                  <div className="text-[12px] font-medium leading-tight truncate">{m.task.title}</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: (STATUS_STYLES[m.task.status] || STATUS_STYLES["Content - Pending"]).bg, color: (STATUS_STYLES[m.task.status] || STATUS_STYLES["Content - Pending"]).text }}>{m.task.status}</span>
                    <span className="text-[10px] text-gray-400">{m.task.type}</span>
                  </div>
                  {m.task.link && <a href={m.task.link} target="_blank" rel="noreferrer" className="text-[10px] text-violet-600 hover:underline inline-block mt-1">Open task ↗</a>}
                </div>
              )}
              <div className="text-[12px] text-gray-600 leading-snug mt-0.5">{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <input type="text" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="Message the team…" className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-brand/30" />
        <button onClick={send} disabled={!val.trim()} className="px-2.5 rounded-lg text-white disabled:opacity-40 inline-flex items-center" style={{ background: "#6D5CE7" }} title="Send"><IconSend size={15} stroke={1.8} /></button>
      </div>
    </div>
  );
}

// Task popup — opens when a planner block or task row is clicked. Wraps the full
// DetailPanel and adds the two wrap-up actions (mark complete / move to next week),
// so the End-of-day review no longer needs its own box.
function TaskModal({ row, personKey, accent, onClose, onSaved }: { row: Row; personKey: string; accent: string; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function patch(fields: Record<string, unknown>) {
    await updateTask({ id: row.id, fields });
  }
  async function markComplete() {
    setBusy("done");
    try { await patch({ status: "Published/Scheduled" }); onSaved(); onClose(); }
    finally { setBusy(null); }
  }
  async function moveNextWeek() {
    setBusy("move");
    try {
      const base = row.publishingDate ? new Date(row.publishingDate) : new Date();
      base.setDate(base.getDate() + 7);
      await patch({ publishing_date: base.toISOString().slice(0, 10) });
      onSaved(); onClose();
    } finally { setBusy(null); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 overflow-y-auto" style={{ background: "rgba(20,21,28,.45)" }} onClick={onClose}>
      <div className="w-full max-w-3xl my-6" onClick={(e) => e.stopPropagation()}>
        <DetailPanel row={row} accent={accent} personKey={personKey} onClose={onClose} onSaved={onSaved} />
        <div className="bg-white border border-gray-100 rounded-xl mt-3 px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[12px] text-gray-400">Didn&apos;t finish? Roll it to next week. Done? Mark it complete.</span>
          <div className="flex items-center gap-2">
            <button onClick={moveNextWeek} disabled={busy !== null} className="text-[13px] font-medium px-3.5 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40">{busy === "move" ? "Moving…" : "Move to next week"}</button>
            <button onClick={markComplete} disabled={busy !== null} className="text-[13px] font-medium px-3.5 py-2 rounded-lg text-white disabled:opacity-40" style={{ background: "#6D5CE7" }}>{busy === "done" ? "Saving…" : "Mark complete"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// "Needs you" — the accept/decline pipeline queue for the rail. Editors see
// approved VIDEO tasks, designers see approved DESIGN tasks they can pick up;
// Accept = takeover, Decline = dismiss.
function NeedsYou({ tasks, person, onDone, onChatPush }: { tasks: Row[]; person: Person; onDone: () => void; onChatPush: (m: Omit<ChatMsg, "id" | "time">) => void }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState<Row | null>(null);
  const isMaker = person.role === "editor" || person.role === "designer";
  const eligible = isMaker
    ? tasks.filter((r) => {
        const t = (r.type || "").toLowerCase();
        const isVideo = /reel - |youtube long-form|youtube shorts|story \(video\)|meta ads - video/i.test(t);
        const isDesign = !isVideo && /carousel|post|thumbnail|static|image|story|meta ads/i.test(t);
        const forMe = person.role === "editor" ? isVideo : isDesign;
        const ownsIt = (r.owner || "").toLowerCase().includes(person.key);
        return forMe && !ownsIt && ["Content - Approved", "Output - Ready"].includes(r.status) && !dismissed.has(r.id);
      })
    : [];
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-2">
        Needs you {eligible.length > 0 && <span className="bg-violet-600 text-white text-[10px] rounded-full px-1.5 py-0.5 leading-none">{eligible.length}</span>}
      </div>
      {eligible.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl p-4 text-[13px] text-gray-400">Nothing waiting — you&apos;re clear.</div>
      ) : (
        <div className="space-y-3">
          {eligible.map((r) => (
            <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="text-[15px] font-semibold leading-tight">{r.particulars || "(untitled)"}</div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md whitespace-nowrap flex-shrink-0" style={{ background: "#EAF3DE", color: "#27500A" }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#5FB196" }} /> Content approved
                </span>
              </div>
              <div className="text-[12px] text-gray-500">{r.type}{r.publishingDate && ` · publishes ${new Date(r.publishingDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}</div>
              <div className="flex items-center gap-2 text-[12px] text-gray-500 mt-2.5">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold" style={{ background: "#EEEDFE", color: "#3C3489" }}>{((r.owner || "?").trim()[0] || "?").toUpperCase()}</span>
                {(r.owner || "Someone").split(" ")[0]} approved this · ready to pick up
              </div>
              <div className="flex gap-2.5 mt-3.5">
                <button onClick={() => setAccepting(r)} className="flex-1 text-[13px] font-semibold text-white rounded-lg px-4 py-2.5 inline-flex items-center justify-center gap-1.5" style={{ background: "#6D5CE7" }}><IconCheck size={15} stroke={2.2} /> Accept</button>
                <button onClick={() => setDismissed((s) => new Set(s).add(r.id))} className="text-[13px] font-medium text-gray-600 border border-gray-200 rounded-lg px-5 py-2.5 hover:bg-gray-50">Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {accepting && (
        <AcceptModal
          row={accepting}
          person={person}
          onChatPush={onChatPush}
          onClose={() => setAccepting(null)}
          onDone={() => { setAccepting(null); onDone(); }}
        />
      )}
    </div>
  );
}

// Accept confirmation. Option 1: just accept. Option 2: accept AND send the writer
// (Manya — the only task creator) a short, generic "running tight" heads-up in Team
// chat. No task names are shown or sent — so it never reads as dumping a specific
// task on her; she decides what to reschedule.
function AcceptModal({ row, person, onChatPush, onClose, onDone }: { row: Row; person: Person; onChatPush: (m: Omit<ChatMsg, "id" | "time">) => void; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const est = estMins(row.type);
  const writer = TEAM.find((p) => p.role === "writer");
  const creatorName = writer?.label || "Manya";
  const [msg, setMsg] = useState(`${creatorName} — running tight today. Mind nudging one of these out by a day? Totally your call on which — whichever's easiest for you.`);

  async function takeover() {
    const res = await fetch("/api/marketing-hub/takeover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId: row.id, newOwnerKey: person.key }) });
    const j = await res.json();
    if (!res.ok || j.error) throw new Error(j.error || res.status);
  }
  async function acceptOnly() {
    setBusy("accept");
    try { await takeover(); onDone(); } catch (e) { alertDialog(`Failed: ${(e as Error).message}`); setBusy(null); }
  }
  async function acceptAndAsk() {
    setBusy("ask");
    try {
      await takeover();
      onChatPush({ who: person.label, init: (person.label[0] || "?").toUpperCase(), color: person.color, bg: person.color + "22", text: msg });
      onDone();
    } catch (e) { alertDialog(`Failed: ${(e as Error).message}`); setBusy(null); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" style={{ background: "rgba(20,21,28,.45)" }} onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl p-5 my-6" onClick={(e) => e.stopPropagation()}>
        <div className="text-[15px] font-semibold">Accept this task?</div>
        <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
          <div className="text-[13px] font-medium">{row.particulars || "(untitled)"}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{row.type} · adds about {fmtDur(est)} to your day</div>
        </div>

        <button onClick={acceptOnly} disabled={busy !== null} className="w-full text-[13px] font-semibold text-white rounded-lg px-4 py-2.5 mt-4 disabled:opacity-40" style={{ background: "#6D5CE7" }}>{busy === "accept" ? "Accepting…" : "Accept & work on it"}</button>

        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="text-[12px] text-gray-500 mb-2">Running tight? Send {creatorName} a quick heads-up:</div>
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={4} className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[12px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-brand/30 resize-none" />
          <div className="text-[10px] text-gray-400 mt-1">Sent to {creatorName} in Team chat. She decides what to move.</div>
          <button onClick={acceptAndAsk} disabled={busy !== null || !msg.trim()} className="w-full text-[13px] font-medium text-gray-700 border border-gray-200 rounded-lg px-4 py-2.5 mt-2.5 hover:bg-gray-50 disabled:opacity-40">{busy === "ask" ? "Sending…" : `Accept & message ${creatorName}`}</button>
        </div>

        <button onClick={onClose} disabled={busy !== null} className="w-full text-[12.5px] text-gray-500 py-1.5 mt-2 hover:text-gray-700 disabled:opacity-40">Cancel</button>
      </div>
    </div>
  );
}

// Team-board mini-lists (pin board, standup notes). Interactive in-session;
// persistence to a shared table is a follow-up. Reminders (3rd card) are real.
type BoardItem = { id: string; body: string; done: boolean };
const PIN_SEED: BoardItem[] = [];
const STANDUP_SEED: BoardItem[] = [
  { id: "su1", body: "Germany carousel → add MTI-closure slide before publishing.", done: false },
  { id: "su2", body: "Re-shoot AMC reel intro — first 3 sec too slow.", done: false },
  { id: "su3", body: "Get Aisha's testimonial clip by Friday.", done: true },
];

function BoardCard({ title, hint, icon, seed, checkable, accent, placeholder }: {
  title: string; hint?: string; icon: ReactNode; seed: BoardItem[]; checkable?: boolean; accent: string; placeholder: string;
}) {
  const [items, setItems] = useState<BoardItem[]>(seed);
  const [val, setVal] = useState("");
  function add() {
    const b = val.trim(); if (!b) return;
    setItems((p) => [...p, { id: `b${Date.now()}`, body: b, done: false }]);
    setVal("");
  }
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 h-full flex flex-col">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-sm font-medium flex items-center gap-2">{icon} {title}</div>
        {hint && <div className="text-[11px] text-gray-400">{hint}</div>}
      </div>
      <div className="space-y-0.5 mb-3 flex-1 min-h-[40px]">
        {items.length === 0 && <div className="text-[13px] text-gray-400 py-1.5">{checkable ? "No notes yet." : "No pins yet — add one."}</div>}
        {items.map((n) => (
          <div key={n.id} className="group flex items-start gap-2.5 px-1 py-1 rounded hover:bg-gray-50">
            {checkable && <input type="checkbox" checked={n.done} onChange={(e) => setItems((p) => p.map((x) => x.id === n.id ? { ...x, done: e.target.checked } : x))} className="mt-0.5 h-3.5 w-3.5 rounded cursor-pointer flex-shrink-0" style={{ accentColor: accent }} />}
            <span className={`flex-1 text-[13px] ${n.done ? "line-through text-gray-400" : "text-gray-800"}`}>{n.body}</span>
            <button onClick={() => setItems((p) => p.filter((x) => x.id !== n.id))} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-rose-600 transition flex-shrink-0" title="Delete"><IconTrash size={13} stroke={1.7} /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <input type="text" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder={placeholder} className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-brand/30" />
        <button onClick={add} disabled={!val.trim()} className="px-2.5 py-1.5 rounded-lg text-[13px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 inline-flex items-center" title="Add"><IconPlus size={14} stroke={2} /></button>
      </div>
    </div>
  );
}

// Today's plan — a time-blocked day planner (Reclaim.ai-style). First pass: fills
// the person's real actionable tasks across working hours (9 AM–6 PM) in order,
// with a lunch break; drag-to-reschedule + true auto-plan are a follow-up.
const PLAN_START = 9, PLAN_END = 18;
const PLAN_MINS = (PLAN_END - PLAN_START) * 60;
function fmtDur(m: number): string { const h = Math.floor(m / 60), mm = m % 60; return h ? `${h}h${mm ? ` ${mm}m` : ""}` : `${mm}m`; }
function estMins(type: string): number {
  const t = (type || "").toLowerCase();
  if (/youtube long/.test(t)) return 120;
  if (/reel/.test(t)) return 90;
  if (/carousel/.test(t)) return 60;
  if (/meta ads/.test(t)) return 45;
  if (/story/.test(t)) return 20;
  if (/post|image|static/.test(t)) return 30;
  return 40;
}
type PlanKind = "carousel" | "reel" | "post" | "shoot" | "meet" | "free";
function taskKind(type: string): PlanKind {
  const t = (type || "").toLowerCase();
  if (/carousel/.test(t)) return "carousel";
  if (/reel|video|story|youtube/.test(t)) return "reel";
  if (/shoot|photo/.test(t)) return "shoot";
  return "post";
}
function kindLabel(k: PlanKind): string {
  return { carousel: "Carousel", reel: "Reel", post: "Post", shoot: "Photoshoot", meet: "Meeting", free: "" }[k];
}
// Exact prototype pastel styling per block kind.
const BLK_STYLE: Record<PlanKind, CSSProperties> = {
  carousel: { background: "linear-gradient(135deg,#F0ECFF,#E4DCFF)", color: "#5142C4", border: "1px solid #DDD4FB" },
  reel:     { background: "linear-gradient(135deg,#FFEAF1,#FFDBE7)", color: "#B23A6A", border: "1px solid #F8CBDA" },
  post:     { background: "linear-gradient(135deg,#E6F1FF,#D6E8FF)", color: "#2B6AB0", border: "1px solid #C6DDF7" },
  shoot:    { background: "linear-gradient(135deg,#FFF2DA,#FFE7C1)", color: "#96620F", border: "1px solid #F5DDAF" },
  meet:     { background: "#F5F6FA", color: "#3B404D", border: "1px solid #EAECF1" },
  free:     { background: "repeating-linear-gradient(45deg,transparent,transparent 7px,#F1F3F7 7px,#F1F3F7 12px)", color: "#9BA1AD", border: "1px dashed #EAECF1" },
};
const SWATCH: Record<string, CSSProperties> = {
  carousel: { background: "linear-gradient(135deg,#EFEBFF,#E2DBFF)" },
  reel:     { background: "linear-gradient(135deg,#FFE8F0,#FFD9E6)" },
  post:     { background: "linear-gradient(135deg,#E3F0FF,#D3E7FF)" },
  shoot:    { background: "linear-gradient(135deg,#FFF1D6,#FFE6BC)" },
  meet:     { background: "#FFFFFF", border: "1px solid #EAECF1" },
};

type PlanBlock = { kind: PlanKind; id?: string; label: string; sub: string; startMin: number; dur: number };

function TodaysPlan({ tasks, onSelect, canCreate }: { tasks: Row[]; onSelect: (id: string) => void; canCreate?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  const [startHour, setStartHour] = useState(9);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);

  const MINS = 9 * 60;
  const isWeekend = now ? (now.getDay() === 0 || now.getDay() === 6) : false;
  const LUNCH_AT = (13 - startHour) * 60;

  const BUFFER = 45; // always leave a 45-minute buffer at the end of the day
  const blocks: PlanBlock[] = [];
  let cursor = 0;
  let lunchDone = false;
  // Lunch drops in at the current cursor (never leaves a gap) once we pass 1 PM.
  const pushLunch = () => { blocks.push({ kind: "free", label: "Lunch", sub: "", startMin: cursor, dur: 45 }); cursor += 45; lunchDone = true; };
  for (const t of tasks) {
    if (cursor >= MINS - BUFFER) break;
    if (!lunchDone && cursor >= LUNCH_AT) pushLunch();
    const k = taskKind(t.type);
    const dur = Math.min(estMins(t.type), (MINS - BUFFER) - cursor);
    if (dur <= 0) break;
    blocks.push({ kind: k, id: t.id, label: t.particulars || "(untitled)", sub: `${kindLabel(k)} · ${fmtDur(dur)}`, startMin: cursor, dur });
    cursor += dur;
  }
  // Everything left at the end of the day is the buffer.
  const bufferMin = MINS - cursor;
  if (bufferMin > 0) blocks.push({ kind: "free", label: "Buffer", sub: "", startMin: cursor, dur: bufferMin });

  const plannedMin = blocks.filter((b) => b.kind !== "free").reduce((s, b) => s + b.dur, 0);
  const morePosts = Math.max(0, Math.floor((bufferMin - BUFFER) / 30));
  const nowMin = now ? (now.getHours() * 60 + now.getMinutes()) - startHour * 60 : -1;
  const showNow = !isWeekend && nowMin >= 0 && nowMin <= MINS;

  const ticks: string[] = [];
  for (let hb = startHour; hb < startHour + 9; hb++) { const hh = hb % 12 === 0 ? 12 : hb % 12; ticks.push(`${hh}${hb < 12 ? " AM" : (hb === 12 ? " PM" : "")}`); }

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      {isWeekend && (
        <div className="rounded-[10px] px-4 py-3 mb-5 text-[12.5px] font-medium" style={{ background: "#F2EFFE", border: "1px solid #E1DAFB", color: "#5645C9" }}>
          It&apos;s the weekend — you&apos;re off. Showing <b>Monday&apos;s</b> plan.
        </div>
      )}

      {/* Capacity + controls */}
      <div className="flex items-center gap-3.5 flex-wrap mb-5">
        <div className="text-[12.5px] text-gray-500">Planned <b className="text-gray-900 font-semibold">{fmtDur(plannedMin)}</b> of 9h · buffer {fmtDur(bufferMin)} · <b className="text-gray-900 font-semibold">~{morePosts} more posts</b> fit today</div>
        <div className="h-[7px] rounded flex-1 min-w-[150px] max-w-[250px] overflow-hidden" style={{ background: "#F1F3F7" }}>
          <div className="h-full" style={{ width: `${Math.min(100, plannedMin / MINS * 100)}%`, background: "#6D5CE7" }} />
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <select value={startHour} onChange={(e) => setStartHour(+e.target.value)} className="border border-gray-200 rounded-[9px] bg-white text-gray-900 text-[12px] font-semibold px-2.5 py-1.5">
            <option value={9}>9 AM – 6 PM</option>
            <option value={10}>10 AM – 7 PM</option>
          </select>
          <button className="text-[12px] font-semibold text-white rounded-lg px-3.5 py-1.5" style={{ background: "#6D5CE7" }}>Auto-plan</button>
          {canCreate && <button className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 inline-flex items-center gap-1"><IconPlus size={13} stroke={2} /> Add task</button>}
        </div>
      </div>

      {/* Explainer */}
      <div className="rounded-[10px] px-4 py-3.5 mb-5 text-[12px] leading-relaxed" style={{ background: "#F5F6FA", border: "1px solid #EAECF1", color: "#3B404D" }}>
        <b>Auto-plan</b> lays your accepted tasks into today&apos;s working hours (Mon–Fri, off Sat/Sun), around meetings &amp; lunch. Each block&apos;s length is that task&apos;s own estimate — set a <b>min–max</b> per task (post ≈ 20–34m, carousel ≈ 45m–1.5h, reel ≈ 1–2h). Scope: this day only. Overflow rolls to the next working day (Fri → Mon).
      </div>

      {/* Format legend */}
      <div className="flex items-center gap-4 flex-wrap mb-[18px] text-[11.5px] text-gray-500">
        <b className="text-[10.5px] uppercase tracking-wide text-gray-600 font-semibold">Format</b>
        {(["carousel", "reel", "post", "shoot", "meet"] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5 font-medium">
            <i className="w-[13px] h-[13px] rounded-[4px] inline-block" style={{ ...SWATCH[k], ...(SWATCH[k].border ? {} : { border: "1px solid rgba(20,21,28,.06)" }) }} />
            {k === "meet" ? "Meeting / break" : k === "shoot" ? "Photoshoot" : kindLabel(k)}
          </span>
        ))}
      </div>

      {/* Timeline */}
      {blocks.length === 0 ? (
        <div className="text-[13px] text-gray-400 py-8 text-center border border-gray-100 rounded-[11px]">Nothing scheduled yet — your active tasks land here.</div>
      ) : (
        <div className="rounded-[11px] overflow-hidden" style={{ border: "1px solid #EAECF1" }}>
          <div className="grid grid-cols-9" style={{ background: "#F5F6FA", borderBottom: "1px solid #F1F3F7" }}>
            {ticks.map((t, i) => (
              <span key={i} className="text-[10px] font-semibold py-[7px] pl-2" style={{ color: "#9BA1AD", borderLeft: i > 0 ? "1px solid #F1F3F7" : "none" }}>{t}</span>
            ))}
          </div>
          <div className="relative" style={{ height: "118px" }}>
            {blocks.map((b, i) => (
              <div
                key={i}
                onClick={() => b.id && onSelect(b.id)}
                title={b.id ? "Open task" : undefined}
                className={`absolute rounded-[9px] px-3 py-2 overflow-hidden flex flex-col justify-center leading-tight transition ${b.id ? "cursor-pointer hover:brightness-[.97] hover:-translate-y-[1px]" : ""}`}
                style={{ top: "12px", height: "94px", left: `${b.startMin / MINS * 100}%`, width: `${b.dur / MINS * 100}%`, fontSize: "11.5px", fontWeight: 600, boxShadow: b.kind === "free" ? "none" : "0 1px 2px rgba(20,21,28,.04)", ...BLK_STYLE[b.kind] }}
              >
                <div className="truncate">{b.label}</div>
                {b.sub && <div className="text-[10px] font-medium opacity-80 truncate mt-0.5">{b.sub}</div>}
              </div>
            ))}
            {showNow && <div className="absolute top-0 bottom-0 z-10" style={{ left: `${nowMin / MINS * 100}%`, width: "2px", background: "#DC2E2E" }}>
              <span className="absolute -top-[3px] -left-[3px] w-2 h-2 rounded-full" style={{ background: "#DC2E2E" }} />
            </div>}
          </div>
        </div>
      )}
      <p className="text-[11.5px] mt-4" style={{ color: "#9BA1AD" }}>Drag a block to reschedule · pull an edge to resize · tap to change its estimate. Overflow past Friday moves to Monday.</p>
    </div>
  );
}

// End-of-day review — open tasks with a progress slider + "Move → Mon". First
// pass keeps progress/move in local state (a wrap-up ritual); persisting the
// rollover to real publish dates is a follow-up.
function EndOfDayReview({ tasks }: { tasks: Row[] }) {
  const open = tasks.filter((r) => !DONE_STATUSES.includes(r.status)).slice(0, 6);
  const [prog, setProg] = useState<Record<string, number>>({});
  const [moved, setMoved] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  if (open.length === 0) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="px-[18px] py-4 text-[13px] font-semibold" style={{ borderBottom: "1px solid #F1F3F7" }}>
        {open.length} task{open.length > 1 ? "s" : ""} still open — a quick review before you log off. <span className="font-normal text-gray-400">Set how far you got, add a reason, move the rest to the next working day.</span>
      </div>
      {open.map((r) => {
        const p = prog[r.id] ?? 0;
        const done = p >= 100;
        const isMoved = moved[r.id];
        return (
          <div key={r.id} className="px-[18px] py-[15px] grid items-center gap-4" style={{ borderBottom: "1px solid #F1F3F7", gridTemplateColumns: "1.3fr 1.2fr 1.5fr" }}>
            <div className="min-w-0"><div className="text-[13px] font-semibold truncate">{r.particulars || "(untitled)"}</div><div className="text-[12px] text-gray-500 truncate">{r.type || "—"}</div></div>
            <div className="flex items-center gap-2.5">
              <input type="range" min={0} max={100} value={p} onChange={(e) => setProg((s) => ({ ...s, [r.id]: +e.target.value }))} className="flex-1" style={{ accentColor: "#6D5CE7" }} />
              <span className="text-[12px] tabular-nums text-gray-600 w-9 text-right">{p}%</span>
            </div>
            {done ? (
              <div className="text-[11px] font-semibold uppercase tracking-wide px-2.5 py-2 rounded-md text-center" style={{ background: "#EAF7EF", color: "#1E7D45" }}>Done — mark complete</div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <input value={reason[r.id] || ""} onChange={(e) => setReason((s) => ({ ...s, [r.id]: e.target.value }))} placeholder="Reason — waiting on copy" className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-brand/30" />
                {isMoved
                  ? <span className="text-[11px] text-gray-400 whitespace-nowrap">Moved → Mon</span>
                  : <button onClick={() => setMoved((s) => ({ ...s, [r.id]: true }))} className="text-[12px] font-semibold text-white rounded-lg px-3 py-1.5 whitespace-nowrap" style={{ background: "#6D5CE7" }}>Move → Mon</button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Compact greeting bar — greeting that follows the selected person, live clock,
// live weather chip (office = Bengaluru), and quick counts. Deliberately a slim
// tinted header, not the full animated sky (My Day stays clean/professional).
function GreetingBar({ name, roleLabel, todayCount, weekCount, right }: {
  name: string; roleLabel: string; todayCount: number; weekCount: number; right: ReactNode;
}) {
  const [now, setNow] = useState<Date | null>(null);
  const [wx, setWx] = useState<{ tempC: number | null; code: number | null } | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    fetch("/api/weather").then((r) => r.json()).then(setWx).catch(() => {});
    return () => clearInterval(t);
  }, []);

  const h = now ? now.getHours() : 18;
  const greeting = h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 17 ? "Good afternoon" : h >= 17 && h < 21 ? "Good evening" : "Working late";
  const isNight = h >= 20 || h < 6;
  const timeStr = now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--";
  const dateStr = now ? now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }) : "";

  const code = wx?.code ?? null;
  let WxIcon = isNight ? IconMoon : IconSun;
  let wxLabel = "Clear";
  if (code != null) {
    if (code === 0) { WxIcon = isNight ? IconMoon : IconSun; wxLabel = "Clear"; }
    else if (code <= 48) { WxIcon = IconCloud; wxLabel = code <= 3 ? "Cloudy" : "Fog"; }
    else if (code <= 67 || (code >= 80 && code <= 82)) { WxIcon = IconCloudRain; wxLabel = "Rain"; }
    else if (code <= 77 || (code >= 85 && code <= 86)) { WxIcon = IconCloud; wxLabel = "Snow"; }
    else { WxIcon = IconCloudRain; wxLabel = "Storm"; }
  }

  return (
    <div className="rounded-xl border border-gray-100 px-5 py-4" style={{ background: "linear-gradient(100deg, #F1EFFE 0%, #FAF9FF 48%, #FFFFFF 100%)" }}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xl font-semibold text-gray-900">{greeting}, {name}</div>
          <div className="mt-1 flex items-center gap-2.5 text-sm text-gray-500 flex-wrap">
            <span className="tabular-nums">{timeStr}</span>
            <span className="text-gray-300">·</span>
            <span>{dateStr}</span>
            {wx?.tempC != null && (
              <>
                <span className="text-gray-300">·</span>
                <span className="inline-flex items-center gap-1"><WxIcon size={15} stroke={1.7} className="text-gray-500" />{wx.tempC}° {wxLabel}</span>
              </>
            )}
            <span className="text-gray-300">·</span>
            <span>Bengaluru</span>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600">{todayCount} due today</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600">{weekCount} this week</span>
            <span className="text-[11px] text-gray-400">· {roleLabel}</span>
          </div>
        </div>
        {right}
      </div>
    </div>
  );
}

function DetailPanel({ row, accent, onClose, onSaved, personKey }: { row: Row; accent: string; onClose: () => void; onSaved: () => void; personKey: string }) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [detailReloadTick, setDetailReloadTick] = useState(0);

  useEffect(() => { setMode("view"); }, [row.id]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/marketing-hub/task-detail?id=${row.id}`)
      .then((r) => r.json())
      .then((j: TaskDetail) => { if (!cancelled) setDetail(j); })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [row.id, detailReloadTick]);

  const currentRank = STATUS_RANK[row.status] ?? 0;
  const refreshDetail = () => setDetailReloadTick((n) => n + 1);

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-6">
      {mode === "view" ? (
        <ViewMode
          row={row}
          accent={accent}
          currentRank={currentRank}
          detail={detail}
          personKey={personKey}
          onClose={onClose}
          onSaved={onSaved}
          onDetailChanged={refreshDetail}
        />
      ) : (
        <EditForm
          row={row}
          accent={accent}
          currentRank={currentRank}
          onClose={onClose}
          onCancel={() => setMode("view")}
          onSaved={() => { onSaved(); setMode("view"); }}
        />
      )}
    </div>
  );
}

function ViewMode({ row, accent, currentRank, detail, personKey, onClose, onSaved, onDetailChanged }: {
  row: Row; accent: string; currentRank: number;
  detail: TaskDetail | null; personKey: string;
  onClose: () => void; onSaved: () => void; onDetailChanged: () => void;
}) {
  const [showActivity, setShowActivity] = useState(false);
  const st = STATUS_STYLES[row.status] || STATUS_STYLES["Content - Pending"];

  const publishLabel = row.publishingDate
    ? new Date(row.publishingDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div>
      {/* Header — straight to the title (like the reference, no "Task detail" label) */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-lg font-medium leading-tight">{row.particulars || "(untitled)"}</div>
          <div className="text-xs text-gray-500 mt-1">
            {[row.type, row.sbu, publishLabel && `Publishes ${publishLabel}`].filter(Boolean).join(" · ")}
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none flex-shrink-0">×</button>
      </div>

      {/* Collaborators strip */}
      {detail && (
        <TeamStrip
          postId={row.id}
          type={row.type}
          ownerName={row.owner}
          viewerKey={personKey}
          collaborators={detail.collaborators}
          onChanged={onDetailChanged}
        />
      )}

      {/* Feedback notes — prominent when status is Incorporating Feedback, otherwise plain */}
      {row.additionalInfo && (
        <div
          className={`mb-4 rounded-lg p-3 border ${row.status === "Incorporating Feedback" ? "" : "border-gray-100 bg-gray-50/60"}`}
          style={row.status === "Incorporating Feedback" ? { borderColor: "#F0C24A", background: "#FFF9E9" } : {}}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
              {row.status === "Incorporating Feedback" ? "Feedback to address" : "Feedback / notes"}
            </span>
          </div>
          <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{row.additionalInfo}</div>
        </div>
      )}

      {/* Meta — Status · Priority · Publish (three columns, like the reference) */}
      <div className="border-t border-gray-100 pt-4 grid grid-cols-3 gap-4">
        <div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Status</div>
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-md" style={{ background: st.bg, color: st.text }}>
            <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_EDGE[row.status] || "#94A3B8" }} />
            {row.status}
          </span>
        </div>
        <div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Priority</div>
          {row.priority
            ? <span className="text-[12px] font-medium px-2.5 py-1 rounded-md" style={{ background: (PRIORITY_STYLES[row.priority] || PRIORITY_STYLES.Medium).bg, color: (PRIORITY_STYLES[row.priority] || PRIORITY_STYLES.Medium).text }}>{row.priority}</span>
            : <span className="text-sm text-gray-400">—</span>}
        </div>
        <div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Publish</div>
          <div className="text-sm text-gray-800">{publishLabel || "—"}</div>
        </div>
      </div>

      {/* Content — the writer's full write-up. Pulled live from the content board
          when the mirror is empty. Always fully expanded, no inner scroll. */}
      {(() => {
        const contentText = (detail?.content || row.content || "").trim();
        if (!contentText) return null;
        return (
          <div className="border-t border-gray-100 mt-4 pt-4">
            <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500 mb-2">Content</div>
            <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
              {contentText}
            </div>
          </div>
        );
      })()}

      {/* Caption draft — expands naturally too */}
      {row.caption && (
        <div className="border-t border-gray-100 mt-4 pt-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500 mb-2">Caption draft</div>
          <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{row.caption}</div>
        </div>
      )}

      {/* Creative files — only the makers (designer/editor) upload creative. The
          writer never sees this; her tasks have nothing to upload. */}
      {detail && (personKey === "praveen" || personKey === "nikhil" || personKey === "nandu") && (
        <div className="border-t border-gray-100 mt-5 pt-4">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
              Creative files{detail.attachments.length > 0 && ` · ${detail.attachments.length}`}
            </div>
            <div className="text-[10px] text-gray-400">References, mood board, final output</div>
          </div>
          <CreativeFiles
            postId={row.id}
            personRow={row}
            attachments={detail.attachments}
            personKey={personKey}
            accent={accent}
            onChanged={onDetailChanged}
            onTaskAdvanced={() => { onDetailChanged(); onSaved(); }}
          />
        </div>
      )}

      {/* Timeline — horizontal steps */}
      <div className="border-t border-gray-100 mt-5 pt-4">
        <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500 mb-3">Timeline</div>
        <HorizontalTimeline currentRank={currentRank} />
      </div>

      {/* Comments thread */}
      {detail && (
        <div className="border-t border-gray-100 mt-5 pt-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-1.5">
            <IconMessageCircle size={13} stroke={1.7} /> Comments {detail.comments.length > 0 && `· ${detail.comments.length}`}
          </div>
          <CommentsThread postId={row.id} comments={detail.comments} personKey={personKey} accent={accent} onAdded={onDetailChanged} />
        </div>
      )}

      {/* Activity log — collapsed by default (kept minimal, like the reference) */}
      {detail && detail.activity.length > 0 && (
        <div className="border-t border-gray-100 mt-5 pt-4">
          <button
            onClick={() => setShowActivity((v) => !v)}
            className="text-[10px] font-medium uppercase tracking-wider text-gray-400 hover:text-gray-600 flex items-center gap-1.5"
          >
            Activity · {detail.activity.length}
            <span className={`transition-transform ${showActivity ? "rotate-90" : ""}`}>›</span>
          </button>
          {showActivity && (
            <div className="space-y-1.5 mt-3">
              {detail.activity.slice(0, 5).map((a) => (
                <div key={a.id} className="text-xs text-gray-600 flex gap-2">
                  <span className="text-gray-400 flex-shrink-0 w-14">{relTime(a.created_at)}</span>
                  <span><span className="text-gray-800 font-medium">{a.actorName}</span> {a.detail || a.action}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Scheduler line */}
      {detail?.scheduler.syncedToScheduler && detail.scheduler.startAt && (
        <div className="border-t border-gray-100 mt-5 pt-4">
          <div className="text-xs text-gray-600 flex items-center gap-2">
            <IconCalendar size={13} stroke={1.7} className="text-gray-400" />
            <span>
              Scheduled to publish{" "}
              <span className="font-medium text-gray-800">
                {new Date(detail.scheduler.startAt).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
              </span>{" "}
              via Post Scheduler
            </span>
          </div>
        </div>
      )}

      {/* Claim action only — shown contextually to an editor for a sibling's video task */}
      <div className="mt-4 flex justify-end empty:mt-0">
        <TakeOverButton row={row} personKey={personKey} onDone={onSaved} />
      </div>
    </div>
  );
}

function ClaimRowButton({ postId, personKey, onDone }: { postId: string; personKey: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function claim(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    try {
      const r = await fetch("/api/marketing-hub/takeover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, newOwnerKey: personKey }),
      });
      const j = await r.json();
      if (!r.ok || j.error) alertDialog(`Failed: ${j.error || r.status}`);
      else onDone();
    } finally { setBusy(false); }
  }
  return (
    <button
      onClick={claim}
      disabled={busy}
      className="absolute top-2 right-2 inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md bg-white border border-gray-200 text-gray-700 shadow-sm hover:border-violet-300 hover:text-violet-700 hover:bg-violet-50 disabled:opacity-50 transition"
      title="Claim this task — you become the owner, current owner joins as collaborator"
    >
      <IconMovie size={12} stroke={1.9} /> {busy ? "Claiming…" : "Claim"}
    </button>
  );
}

function TakeOverButton({ row, personKey, onDone }: { row: Row; personKey: string; onDone: () => void }) {
  const isVideo = /reel|video|long.*form/i.test(row.type || "");
  const isEditor = personKey === "nikhil" || personKey === "nandu";
  const ownerKey = String(row.owner || "").toLowerCase();
  const currentOwnerIsSiblingEditor = (ownerKey.includes("nikhil") || ownerKey.includes("nandu")) && !ownerKey.includes(personKey);
  const showButton = isVideo && isEditor && currentOwnerIsSiblingEditor;
  const [busy, setBusy] = useState(false);
  if (!showButton) return null;

  async function claim() {
    if (!await confirmDialog({ title: `Take over this task from ${row.owner}?`, action: "Take over" })) return;
    setBusy(true);
    try {
      const r = await fetch("/api/marketing-hub/takeover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: row.id, newOwnerKey: personKey }),
      });
      const j = await r.json();
      if (!r.ok || j.error) alertDialog(`Failed: ${j.error || r.status}`);
      else onDone();
    } finally { setBusy(false); }
  }

  return (
    <button
      onClick={claim}
      disabled={busy}
      className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50 font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
      title={`Claim this task — ${row.owner} will step down`}
    >
      <IconMovie size={14} stroke={1.8} className="text-gray-500" />
      {busy ? "Claiming…" : "Take over"}
    </button>
  );
}

function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function CommentsThread({ postId, comments, personKey, accent, onAdded }: {
  postId: string; comments: Comment[]; personKey: string; accent: string; onAdded: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? comments : comments.slice(0, 3);

  async function submit() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/marketing-hub/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, authorKey: personKey, body: draft.trim() }),
      });
      const j = await r.json();
      if (!r.ok || j.error) { alertDialog(`Failed: ${j.error || r.status}`); return; }
      setDraft("");
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {comments.length === 0 && (
        <div className="text-xs text-gray-400 mb-3">No comments yet. Kick off the thread below.</div>
      )}
      <div className="space-y-2 mb-3">
        {shown.map((c) => (
          <div key={c.id} className="text-sm">
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-gray-800">{c.authorName}</span>
              <span className="text-[10px] text-gray-400">{relTime(c.created_at)}</span>
            </div>
            <div className="text-gray-700 whitespace-pre-wrap mt-0.5">{c.body}</div>
          </div>
        ))}
        {!expanded && comments.length > 3 && (
          <button onClick={() => setExpanded(true)} className="text-xs text-gray-500 hover:text-gray-800">
            View all {comments.length} comments →
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Write a comment…"
          className="flex-1 text-sm px-3 py-1.5 border border-gray-200 rounded-full focus:outline-none focus:ring-1 focus:ring-gray-300"
        />
        <button
          onClick={submit}
          disabled={busy || !draft.trim()}
          className="px-4 py-1.5 rounded-full text-sm font-medium text-white disabled:opacity-40"
          style={{ background: accent }}
        >
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

const TIMELINE_ACTIVE = "#6D5CE7"; // one consistent brand colour for the current step
function HorizontalTimeline({ currentRank }: { currentRank: number }) {
  return (
    <div className="relative grid grid-cols-5 gap-0">
      {/* Connector line */}
      <div className="absolute top-2 left-[10%] right-[10%] h-[2px] bg-gray-100" />
      {TIMELINE_STAGES.map((stage) => {
        const done = currentRank > stage.rank;
        const active = currentRank === stage.rank || (stage.rank === 5 && currentRank === 4);
        return (
          <div key={stage.rank} className="relative z-10 text-center">
            {active ? (
              <div
                className="w-5 h-5 rounded-full mx-auto mb-1.5 border-2 border-white"
                style={{ background: TIMELINE_ACTIVE, boxShadow: `0 0 0 2px ${TIMELINE_ACTIVE}` }}
              />
            ) : done ? (
              <div className="w-4 h-4 rounded-full mx-auto mb-1.5 flex items-center justify-center text-white" style={{ background: "#5FB196" }}>
                <IconCheck size={10} stroke={2.5} />
              </div>
            ) : (
              <div className="w-4 h-4 rounded-full mx-auto mb-1.5 border-2 border-gray-200 bg-white" />
            )}
            <div className={`text-[11px] ${active ? "font-medium" : done ? "" : "text-gray-400"}`} style={active ? { color: TIMELINE_ACTIVE } : {}}>
              {stage.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Preset teams — role-aware. What "usual team" means depends on who is looking.
// Maheen (manager) is NEVER auto-added — he doesn't touch content unless he has to.
// Writer viewing → adds downstream owner (designer/editor).
// Designer/editor viewing → adds the writer (Manya), because handoff already made them owner.
function usualTeamFor(type: string, viewerKey: string): { keys: string[]; label: string } {
  const t = type || "";
  const isStatic = /post|carousel|thumbnail|youtube.*(post|thumbnail)/i.test(t);
  const isSpeakingReel = /reel.*(original|edit|video)|long.*form/i.test(t);
  const isReel = /reel/i.test(t);

  // From designer/editor perspective, presets include the writer.
  if (viewerKey === "praveen" && isStatic)                                return { keys: ["manya"],           label: "Writer (Manya)" };
  if (viewerKey === "nikhil" && (isSpeakingReel || isReel))               return { keys: ["nandu", "manya"],  label: "Sibling + Writer (Nandu, Manya)" };
  if (viewerKey === "nandu" && isReel)                                    return { keys: ["nikhil", "manya"], label: "Sibling + Writer (Nikhil, Manya)" };

  // From writer perspective, presets include downstream owner.
  if (isStatic)         return { keys: ["praveen"], label: "Designer (Praveen)" };
  if (isSpeakingReel)   return { keys: ["nikhil"],  label: "Editor (Nikhil)" };
  if (isReel)           return { keys: ["nandu"],   label: "Editor (Nandu)" };
  return                       { keys: ["manya"],   label: "Writer (Manya)" };
}

function TeamStrip({ postId, type, ownerName, viewerKey, collaborators, onChanged }: {
  postId: string; type: string; ownerName: string; viewerKey: string; collaborators: Collaborator[]; onChanged: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const present = new Set(collaborators.map((c) => c.key));
  const availablePeople = [...TEAM, { key: "maheen", label: "Maheen", role: "editor" as Role, color: "#7C6BAF" }].filter((p) => !present.has(p.key));

  // Split collaborators into owner (matches row.owner display name) and helpers.
  const ownerNorm = (ownerName || "").toLowerCase();
  const owner = collaborators.find((c) => ownerNorm.includes(c.key) || c.name.toLowerCase() === ownerNorm);
  const helpers = collaborators.filter((c) => c !== owner);

  async function addOne(key: string) {
    setBusy(true);
    try {
      await fetch("/api/marketing-hub/collaborators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, memberKey: key }),
      });
      onChanged();
      setPicking(false);
    } finally { setBusy(false); }
  }

  async function remove(key: string) {
    setBusy(true);
    try {
      await fetch(`/api/marketing-hub/collaborators?postId=${postId}&memberKey=${key}`, { method: "DELETE" });
      onChanged();
    } finally { setBusy(false); }
  }

  const paletteFor = (k: string) => TEAM.find((p) => p.key === k)?.color || "#7C6BAF";

  return (
    <div className="mb-4 pb-4 border-b border-gray-100">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Team on this task</div>

      <div className="flex items-center gap-2 flex-wrap">
        {/* Owner pill — "Name · owner" */}
        {owner && (
          <span className="inline-flex items-center gap-2 rounded-full pl-1 pr-3 py-1" style={{ background: paletteFor(owner.key) + "14" }}>
            <span className="w-6 h-6 rounded-full text-white flex items-center justify-center text-[10px] font-medium" style={{ background: paletteFor(owner.key) }}>{owner.name.charAt(0).toUpperCase()}</span>
            <span className="text-[13px] text-gray-800"><span className="capitalize">{owner.name}</span> <span className="text-gray-500">· owner</span></span>
          </span>
        )}

        {/* Collaborator pills — "Name · role" */}
        {helpers.map((c) => (
          <span key={c.key} className="group inline-flex items-center gap-2 rounded-full pl-1 pr-2.5 py-1 bg-gray-100">
            <span className="w-6 h-6 rounded-full text-white flex items-center justify-center text-[10px] font-medium" style={{ background: paletteFor(c.key) }}>{c.name.charAt(0).toUpperCase()}</span>
            <span className="text-[13px] text-gray-800"><span className="capitalize">{c.name}</span>{c.role && <span className="text-gray-500"> · {c.role.toLowerCase()}</span>}</span>
            <button
              onClick={() => remove(c.key)}
              disabled={busy}
              className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition text-sm leading-none"
              title="Remove"
            >×</button>
          </span>
        ))}

        {/* + Add */}
        <div className="relative">
          <button
            onClick={() => setPicking((v) => !v)}
            disabled={busy || availablePeople.length === 0}
            className="inline-flex items-center rounded-full px-3 py-1.5 border border-dashed border-gray-300 text-[13px] text-gray-500 hover:border-gray-500 hover:text-gray-800 disabled:opacity-40"
          >
            + Add
          </button>
          {picking && availablePeople.length > 0 && (
            <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 min-w-[180px]">
              {availablePeople.map((p) => (
                <button
                  key={p.key}
                  onClick={() => addOne(p.key)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2"
                >
                  <span className="w-5 h-5 rounded-full text-white text-[10px] font-medium flex items-center justify-center" style={{ background: p.color }}>
                    {p.label.charAt(0)}
                  </span>
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreativeFiles({ postId, personRow, attachments, personKey, accent, onChanged, onTaskAdvanced }: {
  postId: string; personRow: Row; attachments: Attachment[]; personKey: string; accent: string; onChanged: () => void; onTaskAdvanced: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const isDesignerOrEditor = personKey === "praveen" || personKey === "nikhil" || personKey === "nandu";

  async function upload(files: FileList | File[]) {
    setErr(null);
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("postId", postId);
        fd.append("uploadedBy", personKey);
        fd.append("file", file);
        const r = await fetch(`/api/marketing-hub/attach`, { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok || j.error) { setErr(j.error || `HTTP ${r.status}`); break; }
      }

      // Auto-advance status: if a designer / editor uploads while task sits at
      // "Content - Approved", the task is now Output Ready (their work is uploaded).
      if (isDesignerOrEditor && personRow.status === "Content - Approved") {
        const patch = await fetch(`/api/marketing-hub/update`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: postId, fields: { status: "Output - Ready" } }),
        });
        if (patch.ok) {
          setToast("Auto-advanced to Output Ready");
          setTimeout(() => setToast(null), 3500);
          onTaskAdvanced();
        }
      }
      onChanged();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!await confirmDialog({ title: "Delete this file?", action: "Delete", danger: true })) return;
    const r = await fetch(`/api/marketing-hub/attach?id=${id}`, { method: "DELETE" });
    if (r.ok) onChanged();
  }

  return (
    <div>
      {attachments.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-3">
          {attachments.map((a) => {
            const isImg = (a.mime_type || "").startsWith("image/");
            const isVid = (a.mime_type || "").startsWith("video/");
            return (
              <div key={a.id} className="relative group flex-shrink-0 w-28 h-28 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden">
                <a href={a.storage_path} target="_blank" rel="noreferrer" className="block w-full h-full" title={a.filename}>
                  {isImg ? (
                    <img src={a.thumb_path || a.storage_path} alt={a.filename} className="w-full h-full object-contain" loading="lazy" decoding="async" />
                  ) : isVid ? (
                    <video src={a.storage_path} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-2">
                      <IconPaperclip size={20} stroke={1.6} className="text-gray-400" />
                      <div className="text-[9px] text-gray-500 mt-1 truncate w-full text-center">{a.filename}</div>
                    </div>
                  )}
                </a>
                <button
                  onClick={() => remove(a.id)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs opacity-0 group-hover:opacity-100 transition"
                  title="Delete"
                >×</button>
              </div>
            );
          })}
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) upload(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition ${dragOver ? "" : "border-gray-200 hover:border-gray-300"}`}
        style={dragOver ? { borderColor: accent, background: accent + "0A" } : {}}
      >
        {busy ? (
          <div className="text-sm text-gray-700">Uploading…</div>
        ) : (
          <>
            <div className="flex justify-center mb-1"><IconCloudUpload size={24} stroke={1.5} style={{ color: accent }} /></div>
            <div className="text-sm font-medium" style={{ color: accent }}>
              Click to upload {isDesignerOrEditor ? "your creative" : "reference files"}
            </div>
            <div className="text-[11px] text-gray-500 mt-1">
              or drag & drop — up to 25 MB per file{isDesignerOrEditor && personRow.status === "Content - Approved" && " · task auto-moves to Output Ready on upload"}
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }}
        />
      </div>

      {toast && (
        <div className="mt-2 text-xs px-3 py-2 rounded bg-green-50 border border-green-200 text-green-800 flex items-center gap-1.5">
          <IconCheck size={14} stroke={2} /> {toast}
        </div>
      )}
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
    </div>
  );
}

function AutoTextarea({ value, onChange, minRows = 2, placeholder }: {
  value: string; onChange: (v: string) => void; minRows?: number; placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={minRows}
      placeholder={placeholder}
      className="w-full mt-1 text-sm px-3 py-2 border border-gray-200 rounded bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-gray-300 leading-relaxed resize-none overflow-hidden"
    />
  );
}

function EditForm({ row, accent, currentRank, onClose, onCancel, onSaved }: {
  row: Row; accent: string; currentRank: number;
  onClose: () => void; onCancel: () => void; onSaved: () => void;
}) {
  const [particulars, setParticulars] = useState(row.particulars);
  const [status, setStatus] = useState(row.status);
  const [priority, setPriority] = useState(row.priority || "Medium");
  const [publishingDate, setPublishingDate] = useState(row.publishingDate?.slice(0, 10) || "");
  const [dueDate, setDueDate] = useState(row.dueDate?.slice(0, 10) || "");
  const [sbu, setSbu] = useState(row.sbu);
  const [content, setContent] = useState(row.content);
  const [caption, setCaption] = useState(row.caption);
  const [additionalInfo, setAdditionalInfo] = useState(row.additionalInfo);
  const [needsReview, setNeedsReview] = useState(row.needsReview);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Track how many fields differ from the original row for the "N unsaved changes" indicator.
  const dirtyCount = [
    particulars !== row.particulars,
    status !== row.status,
    priority !== (row.priority || "Medium"),
    publishingDate !== (row.publishingDate?.slice(0, 10) || ""),
    dueDate !== (row.dueDate?.slice(0, 10) || ""),
    sbu !== row.sbu,
    content !== row.content,
    caption !== row.caption,
    additionalInfo !== row.additionalInfo,
    needsReview !== row.needsReview,
  ].filter(Boolean).length;

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const r = await updateTask({
          id: row.id,
          fields: {
            particulars,
            status,
            priority,
            publishing_date: publishingDate || null,
            due_date: dueDate || null,
            sbu: sbu || null,
            content: content || null,
            caption: caption || null,
            additional_info: additionalInfo || null,
            needs_review: needsReview,
          },
      });
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || `HTTP ${r.status}`); return; }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* Header — editable title */}
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: accent }}>Editing task</div>
          <input
            type="text"
            value={particulars}
            onChange={(e) => setParticulars(e.target.value)}
            className="w-full text-xl font-medium mt-1 leading-tight bg-transparent border-b border-gray-100 focus:border-gray-300 outline-none py-1"
          />
          <div className="text-xs text-gray-500 mt-1">{row.type || "—"} · {sbu || row.sbu || "—"}</div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none flex-shrink-0">×</button>
      </div>

      {/* Details form */}
      <div className="border-t border-gray-100 pt-4">
        <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500 mb-2">Details</div>

        <label className="block">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">Content brief</span>
          <AutoTextarea value={content} onChange={setContent} minRows={3} />
        </label>

        <label className="block mt-3">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">Caption draft</span>
          <AutoTextarea value={caption} onChange={setCaption} minRows={3} placeholder="Draft the IG caption here…" />
        </label>

        <label className="block mt-3">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">Feedback / notes</span>
          <AutoTextarea value={additionalInfo} onChange={setAdditionalInfo} minRows={2} placeholder="Reviewer feedback, follow-up notes…" />
        </label>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-3">
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase tracking-wide">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full mt-1 text-sm px-2 py-1.5 border border-gray-200 rounded bg-white">
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase tracking-wide">Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full mt-1 text-sm px-2 py-1.5 border border-gray-200 rounded bg-white">
              {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase tracking-wide">SBU</span>
            <input type="text" value={sbu} onChange={(e) => setSbu(e.target.value)} className="w-full mt-1 text-sm px-2 py-1.5 border border-gray-200 rounded" />
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase tracking-wide">Needs review</span>
            <div className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={needsReview} onChange={(e) => setNeedsReview(e.target.checked)} className="h-4 w-4 rounded cursor-pointer" style={{ accentColor: accent }} />
              <span className="text-xs text-gray-600">Flag for Maheen</span>
            </div>
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase tracking-wide">Publish date</span>
            <input type="date" value={publishingDate} onChange={(e) => setPublishingDate(e.target.value)} className="w-full mt-1 text-sm px-2 py-1.5 border border-gray-200 rounded" />
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500 uppercase tracking-wide">Due date</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full mt-1 text-sm px-2 py-1.5 border border-gray-200 rounded" />
          </label>
        </div>
      </div>

      {/* Timeline (read-only) */}
      <div className="border-t border-gray-100 mt-5 pt-4 opacity-70">
        <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500 mb-3">Timeline · read-only</div>
        <HorizontalTimeline currentRank={currentRank} />
      </div>

      {err && <div className="mt-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2">{err}</div>}

      {/* Actions */}
      <div className="border-t border-gray-100 mt-5 pt-4 flex gap-2 items-center">
        <div className="text-xs text-gray-500 mr-auto">
          {dirtyCount > 0 ? `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}` : "No changes yet"}
        </div>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-5 py-2 rounded text-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving || dirtyCount === 0}
          className="px-5 py-2 rounded text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          style={{ background: accent }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

// V1's "Create task" opens the same shared form the V2 My Day panel and the Content
// Calendar use — one form everywhere, so the fields and the routing preview can't
// drift between the old view and the new one.
function V1CreateTaskButton({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-brand text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:opacity-90 transition flex items-center gap-2 shadow-sm"
      >
        <span className="text-lg leading-none">+</span> Create task
      </button>
      {open && <NewTaskDialog onClose={() => setOpen(false)} onCreated={onCreated} />}
    </>
  );
}
