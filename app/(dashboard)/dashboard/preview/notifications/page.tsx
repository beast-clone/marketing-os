"use client";
import { useEffect, useMemo, useState } from "react";
import { confirmDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";
import { useRouter } from "next/navigation";
import { IconBell, IconBellOff, IconBellRinging, IconCheck, IconChecks, IconExternalLink, IconTrash, IconPin } from "@tabler/icons-react";
import { NotifIcon } from "@/app/(dashboard)/dashboard/preview/NotifIcon";
import { chimeMuted, setChimeMuted, playChime } from "@/app/(dashboard)/dashboard/preview/notifChime";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { LoadingBlock } from "@/components/LoadingBlock";
import { useApi } from "@/lib/use-api";
import { NOTIF_REFRESH, patchNotifs, taskHref, type NotifItem } from "@/app/(dashboard)/dashboard/preview/NotificationHost";

// The Notifications tab — every notification the signed-in person has received,
// kept until they delete it, grouped by category (docs/NOTIFICATIONS_SPEC.md).
// Open action items are pinned at the top until the action is actually done;
// reading one does not unpin it.

type Cat = "all" | "action" | "assigned" | "pool" | "progress" | "dates" | "reminder" | "competitor" | "watcher" | "whatsapp";
const CATS: { key: Exclude<Cat, "all">; label: string }[] = [
  { key: "action",   label: "Action needed" },
  { key: "assigned", label: "Assigned to you" },
  { key: "pool",     label: "Claims & pool" },
  { key: "progress", label: "Your tasks' progress" },
  { key: "dates",    label: "Dates & schedule" },
  // Reminders dismissed from My Day's strip land here, so dismissing never loses one.
  { key: "reminder", label: "Reminders" },
  // What the competitor watcher spotted (lib/competitor-watch.ts).
  { key: "competitor", label: "Competitors" },
  // New notices on pages a Watcher follows (lib/watchers.ts).
  { key: "watcher", label: "Watchers" },
  // Someone replied on WhatsApp and nobody has opened it (/api/cron/wa-unread).
  { key: "whatsapp", label: "WhatsApp" },
];
const label = (c: string) => CATS.find((x) => x.key === c)?.label || c;
const isOpenAction = (n: NotifItem) => n.action_needed && !n.done_at;

// Always the day AND the time — "21 Sept" alone left people guessing (Praveen, 23 Sep).
const when = (iso: string) => {
  const d = new Date(iso), now = new Date();
  const day = d.toDateString() === now.toDateString()
    ? "Today"
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  return `${day} · ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;
};

export default function NotificationsPage() {
  return (
    <PreviewDashboardShell active="notifications" title="Notifications" subtitle="Everything that's happened to your work — kept until you delete it." hideAccountPicker hideRange>
      {() => <NotificationsList />}
    </PreviewDashboardShell>
  );
}

function NotificationsList() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useApi<{ items: NotifItem[] }>("/api/notifications");
  const [cat, setCat] = useState<Cat>("all");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const items = useMemo(() => data?.items || [], [data]);

  // The pop-up host and this page share state — keep them in step both ways.
  useEffect(() => {
    const on = () => { mutate(); };
    window.addEventListener(NOTIF_REFRESH, on);
    return () => window.removeEventListener(NOTIF_REFRESH, on);
  }, [mutate]);

  const counts = useMemo(() => {
    const c: Record<string, { total: number; unread: number }> = { all: { total: items.length, unread: 0 } };
    for (const k of CATS) c[k.key] = { total: 0, unread: 0 };
    for (const n of items) {
      c[n.category] ??= { total: 0, unread: 0 };
      c[n.category].total++;
      if (!n.read_at) { c[n.category].unread++; c.all.unread++; }
    }
    return c;
  }, [items]);

  const pinned = items.filter(isOpenAction);
  const rest = items.filter((n) => !isOpenAction(n) && (cat === "all" || n.category === cat));
  // "All" reads as sections per category; a single category is one list.
  // Sixteen rows all reading "Your task is approved" is a wall you scroll past, not
  // a list you read (Praveen, 28 Sep). Same title, same category -> one row with a
  // count, carrying the newest one's time and the others' subjects underneath.
  const collapse = (rows: NotifItem[]): { n: NotifItem; also: NotifItem[] }[] => {
    const byTitle = new Map<string, NotifItem[]>();
    for (const n of rows) {
      // Person as well as title: twenty-one approvals spread across four people
      // collapsed into one row that could not honestly link anywhere, because it was
      // about four different people's work (Maheen, 2 Oct).
      const k = `${n.title}\u0000${n.payload?.owner || ""}`;
      byTitle.set(k, [...(byTitle.get(k) || []), n]);
    }
    const out: { n: NotifItem; also: NotifItem[] }[] = [];
    for (const group of byTitle.values()) {
      const [first, ...also] = group;
      out.push({ n: first, also });
    }
    // Newest group first, the way the flat list read.
    return out.sort((a, b) => b.n.created_at.localeCompare(a.n.created_at));
  };
  const sections = cat === "all"
    ? CATS.map((c) => ({ key: c.key, label: c.label, rows: collapse(rest.filter((n) => n.category === c.key)) })).filter((s) => s.rows.length)
    : (rest.length ? [{ key: cat, label: label(cat), rows: collapse(rest) }] : []);
  const showPinned = (cat === "all" || cat === "action") && pinned.length > 0;
  // Read after mount — localStorage is not there during the server render.
  const [muted, setMuted] = useState(false);
  useEffect(() => { setMuted(chimeMuted()); }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setFailed(null);
    try { await fn(); await mutate(); window.dispatchEvent(new Event(NOTIF_REFRESH)); }
    catch (e) { setFailed((e as Error).message); }
    finally { setBusy(false); }
  };
  const open = (n: NotifItem) => run(async () => {
    if (!n.read_at) await patchNotifs({ op: "read", ids: [n.id] });
    if (n.post_id) router.push(taskHref(n.post_id));
    else if (n.payload?.href) router.push(n.payload.href);
  });

  // A whole group: the Master sheet, already filtered to that person at that status,
  // which is the list the row is describing. Opening one of twenty-one answered the
  // wrong question.
  //
  // Deliberately NOT wrapped in run(): that refetches the list after the handler, and
  // the re-render was landing on top of the navigation so the page simply stayed put
  // with the group marked read. Going somewhere should not wait on a write either, so
  // the read is fired off and the push happens immediately.
  const openGroup = (n: NotifItem, also: NotifItem[]) => {
    const owner = n.payload?.ownerKey || n.payload?.owner;   // key, not name: the sheet matches aliases
    const status = n.payload?.statusTo;
    const unread = [n, ...also].filter((x) => !x.read_at).map((x) => x.id);
    if (unread.length) {
      patchNotifs({ op: "read", ids: unread })
        .then(() => window.dispatchEvent(new Event(NOTIF_REFRESH)))
        .catch(() => { /* the navigation matters more than the tick */ });
    }
    if (owner || status) {
      const q = new URLSearchParams({ tab: "master" });
      if (owner) q.set("owner", owner);
      if (status) q.set("status", status);
      router.push(`/dashboard/preview/marketing-hub?${q}`);
      return;
    }
    if (n.post_id) router.push(taskHref(n.post_id));
    else if (n.payload?.href) router.push(n.payload.href);
  };
  const unreadHere = cat === "all" ? counts.all.unread : counts[cat]?.unread || 0;

  return (
    <div className="preview-scope flex flex-col gap-4">
      <div className="bg-white border border-gray-100 rounded-xl">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 flex-wrap">
          <IconBell size={20} stroke={1.8} className="text-brand" />
          <div className="text-[16px] font-medium text-[#232D42]">Your notifications</div>
          {/* The chime is a nicety; someone in an open-plan office has to be able to
              stop it, and the setting belongs where the notifications are. */}
          <button onClick={() => { const next = !muted; setChimeMuted(next); setMuted(next); if (!next) playChime(); }}
            title={muted ? "Sound is off — turn it back on" : "Play a sound when something new arrives"}
            className="ml-auto h-9 w-9 rounded border border-gray-200 text-[#4A5468] inline-flex items-center justify-center hover:border-[#3A57E8] hover:text-brand">
            {muted ? <IconBellOff size={16} stroke={1.8} /> : <IconBellRinging size={16} stroke={1.8} />}
          </button>
          <button disabled={busy || unreadHere === 0}
            onClick={() => run(() => patchNotifs(cat === "all" ? { op: "read", all: true } : { op: "read", category: cat }))}
            className="h-9 px-3 rounded border border-gray-200 text-[14px] text-[#4A5468] inline-flex items-center gap-1.5 hover:border-[#3A57E8] disabled:opacity-40">
            <IconChecks size={16} stroke={1.8} /> Mark {cat === "all" ? "all" : `"${label(cat)}"`} read
          </button>
        </div>
        <div className="flex gap-1.5 px-4 py-3 flex-wrap">
          {([{ key: "all", label: "All" }, ...CATS] as { key: Cat; label: string }[]).map((c) => {
            const on = cat === c.key;
            const u = counts[c.key]?.unread || 0;
            return (
              <button key={c.key} onClick={() => setCat(c.key)}
                className={`h-9 px-3 rounded text-[14px] font-medium transition inline-flex items-center gap-1.5 ${on ? "bg-[#E9ECFB] text-brand" : "text-[#8A92A6] hover:text-[#232D42] hover:bg-[#F6F7FB]"}`}>
                {c.label}
                {u > 0 && <span className={`text-[11px] rounded-full px-1.5 min-w-[18px] text-center ${c.key === "action" ? "bg-[#FFF1E8] text-[#C2410C]" : "bg-white text-brand border border-gray-100"}`}>{u}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {failed && <div className="rounded bg-[#FDECEA] text-[#8a2e28] text-[14px] px-3 py-2">{failed}</div>}

      {error ? (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-10 text-center text-[14px] text-rose-600">Couldn&apos;t load notifications: {error.message}</div>
      ) : isLoading && !data ? (
        <div className="bg-white border border-gray-100 rounded-xl"><LoadingBlock /></div>
      ) : (
        <>
          {showPinned && (
            <Section title="Needs you" sub="Pinned until the action is done — opening it doesn't clear it." icon={<IconPin size={18} stroke={1.8} className="text-[#C2410C]" />} accent>
              {pinned.map((n) => <Row key={n.id} n={n} busy={busy} onOpen={open} onRead={(x) => run(() => patchNotifs({ op: "read", ids: [x.id] }))} onDelete={async (x) => { if (await confirmDialog({ title: "Delete this notification?", action: "Delete", cancel: "Cancel", danger: true })) run(() => patchNotifs({ op: "delete", ids: [x.id] })); }} />)}
            </Section>
          )}
          {sections.map((s) => (
            <Section key={s.key} title={s.label}>
              {s.rows.map(({ n, also }) => <Row key={n.id} n={n} also={also} busy={busy} onOpen={open} onOpenGroup={openGroup}
                onRead={(x) => run(() => patchNotifs({ op: "read", ids: [x.id, ...also.map((a) => a.id)] }))}
                onDelete={async (x) => { if (await confirmDialog({ title: also.length ? `Delete these ${also.length + 1} notifications?` : "Delete this notification?", action: "Delete", cancel: "Cancel", danger: true })) run(() => patchNotifs({ op: "delete", ids: [x.id, ...also.map((a) => a.id)] })); }} />)}
            </Section>
          ))}
          {!showPinned && sections.length === 0 && (
            <div className="bg-white border border-gray-100 rounded-xl px-4 py-10 text-center text-[14px] text-[#8A92A6]">
              {cat === "all" ? "No notifications yet." : `Nothing in "${label(cat)}".`}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, sub, icon, accent, children }: { title: string; sub?: string; icon?: React.ReactNode; accent?: boolean; children: React.ReactNode }) {
  return (
    <div className={`bg-white border rounded-xl ${accent ? "border-[#F3D3BE]" : "border-gray-100"}`}>
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${accent ? "bg-[#FFF8F3] border-[#F3D3BE] rounded-t-xl" : "border-gray-100"}`}>
        {icon}
        <div className="text-[14px] font-medium text-[#232D42]">{title}</div>
        {sub && <div className="text-[12px] text-[#8A92A6]">· {sub}</div>}
      </div>
      <div className="divide-y divide-gray-100">{children}</div>
    </div>
  );
}

function Row({ n, also = [], busy, onOpen, onOpenGroup, onRead, onDelete }: { n: NotifItem; also?: NotifItem[]; busy: boolean; onOpen: (n: NotifItem) => void; onOpenGroup?: (n: NotifItem, also: NotifItem[]) => void; onRead: (n: NotifItem) => void; onDelete: (n: NotifItem) => void }) {
  const [expanded, setExpanded] = useState(false);
  const unread = !n.read_at || also.some((a) => !a.read_at);
  const pendingAction = isOpenAction(n);
  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${unread ? "" : "bg-[#F6F7FB]/50"}`}>
      <span className="w-2 flex-shrink-0 pt-2">{unread && <span className="block w-2 h-2 rounded-full bg-brand" title="Unread" />}</span>
      <NotifIcon emoji={n.emoji} actionNeeded={pendingAction} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[14px] ${unread ? "font-medium text-[#232D42]" : "text-[#4A5468]"}`}>{n.title}</span>
          {also.length > 0 && (
            <span className="text-[11px] rounded-full px-2 py-0.5 bg-brand-light text-brand-dark font-medium">×{also.length + 1}</span>
          )}
          {n.dismissed_at && !n.read_at && <span className="text-[11px] rounded-full px-2 py-0.5 bg-[#F6F7FB] text-[#8A92A6]">Dismissed</span>}
        </div>
        {n.sub && <div className="text-[13px] text-[#4A5468] mt-0.5 break-words">{n.sub}</div>}
        {/* Expanding showed the other twenty and stopped there — you could read which
            tasks they were and not reach any of them, so the one you actually wanted
            meant going to find it on the board (Maheen, 2 Oct). Each line opens its own
            task now, the same as the row above it, and the dot marks the ones not yet
            read so a long group can be worked through rather than guessed at. */}
        {also.length > 0 && (
          expanded ? (
            <div className="mt-1.5 space-y-0.5 border-l-2 border-gray-100 pl-2.5">
              {also.map((a) => {
                const canOpen = !!(a.post_id || a.payload?.href);
                const dot = !a.read_at
                  ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand mr-1.5 align-middle" title="Unread" />
                  : null;
                return canOpen ? (
                  <button key={a.id} disabled={busy} onClick={() => onOpen(a)}
                    title="Open this task"
                    className="group block w-full text-left text-[12.5px] text-[#4A5468] break-words rounded px-1 -mx-1 py-0.5 hover:bg-[#F6F7FB] hover:text-brand disabled:opacity-40">
                    {dot}{a.sub}
                    <span className="text-[#8A92A6] group-hover:text-brand"> · {when(a.created_at)}</span>
                  </button>
                ) : (
                  <div key={a.id} className="text-[12.5px] text-[#4A5468] break-words px-1 py-0.5">
                    {dot}{a.sub} <span className="text-[#8A92A6]">· {when(a.created_at)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <button onClick={() => setExpanded(true)} className="text-[12px] text-brand hover:underline mt-0.5">
              and {also.length} more like this
            </button>
          )
        )}
        <div className="text-[12px] text-[#6B7385] mt-1">{when(n.created_at)}</div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Beside the buttons, not in the title line, where it crowded the heading (3 Nov). */}
        {n.action_needed && n.done_at && (
          <span className="h-8 px-2.5 rounded inline-flex items-center gap-1 text-[12.5px] font-medium bg-[#E8F6F0] text-[#2F9E6F]"><IconCheck size={14} stroke={2} />Done</span>
        )}
        {also.length > 0 && onOpenGroup && (n.payload?.owner || n.payload?.statusTo) ? (
          <button disabled={busy} onClick={() => onOpenGroup(n, also)}
            title={`See all ${also.length + 1} on the Master sheet${n.payload?.owner ? ` — ${n.payload.owner}'s` : ""}`}
            className="h-8 px-2.5 rounded border border-gray-200 text-[13px] text-[#4A5468] inline-flex items-center gap-1 hover:border-[#3A57E8] hover:text-brand disabled:opacity-40">
            <IconExternalLink size={14} stroke={1.8} /> See all {also.length + 1}
          </button>
        ) : (n.post_id || n.payload?.href) && (
          <button disabled={busy} onClick={() => onOpen(n)} title="Open the task"
            className="h-8 px-2.5 rounded border border-gray-200 text-[13px] text-[#4A5468] inline-flex items-center gap-1 hover:border-[#3A57E8] hover:text-brand disabled:opacity-40">
            <IconExternalLink size={14} stroke={1.8} /> Open
          </button>
        )}
        {unread && (
          <button disabled={busy} onClick={() => onRead(n)} title="Mark read"
            className="h-8 w-8 rounded border border-[#BBE5D3] bg-[#E8F6F0] text-[#2F9E6F] inline-flex items-center justify-center hover:bg-[#D7EFE4] hover:border-[#8FD3B6] disabled:opacity-40">
            <IconCheck size={15} stroke={1.8} />
          </button>
        )}
        <button disabled={busy || pendingAction} onClick={() => onDelete(n)}
          title={pendingAction ? "Can't delete until the action is done — it's your only reminder" : "Delete"}
          className="h-8 w-8 rounded border border-[#F3C9C4] bg-[#FDECEA] text-[#C03221] inline-flex items-center justify-center hover:bg-[#F9DCD8] hover:border-[#E8A9A1] disabled:opacity-30 disabled:bg-[#F6F7FB] disabled:border-gray-200 disabled:text-[#8A92A6]">
          <IconTrash size={15} stroke={1.8} />
        </button>
      </div>
    </div>
  );
}
