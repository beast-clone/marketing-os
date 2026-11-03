"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { IconBell } from "@tabler/icons-react";
import { playChatChime } from "@/app/(dashboard)/dashboard/preview/notifChime";
import { shouldPoll } from "@/lib/quiet-hours";

// On-screen notification pop-ups, on EVERY preview page (docs/NOTIFICATIONS_SPEC.md).
// Mounted once in the preview layout, so it survives navigation and never doubles up.
//
//   · ONLY an action-needed notification pops up. Anything that merely informs
//     goes to the bell — it rings and shakes — and to the unread count
//   · whatever is due shows as ONE pop-up — the Bell button with the first item and
//     "+N more", never a card per item. Three stacked cards plus "+40 more" covered
//     the page and looked cheap (Praveen, 21 Oct)
//   · an action item that is still unread comes back every ~90 s; "Later" only
//     closes it, it doesn't dismiss anything
//   · no pop-ups in quiet hours — the server decides that, in IST
//   · the unread count goes into the browser tab title and the sidebar badge
//
// Timing lives server-side (last_popped_at), so a reload or a second open tab
// doesn't reset the clock or pop the same thing twice.

export type NotifItem = {
  id: string; kind: string; category: string; action_needed: boolean;
  emoji: string | null; title: string; sub: string | null; post_id: string | null;
  created_at: string; read_at: string | null; dismissed_at: string | null;
  last_popped_at: string | null; done_at: string | null;
  /** href: where "Open" goes when there is no task (a saved Radar reminder).
   *  owner/statusTo: who holds the task and what it moved to, so a group of them can
   *  link to that person's tasks at that status rather than to one of them. */
  payload?: { href?: string; owner?: string; ownerKey?: string; statusTo?: string } | null;
};

const POLL_MS = 30_000;          // how often to look for new ones
const REPOP_MS = 90_000;         // an ignored action item comes back after this
const SHOW_MS = 15_000;          // the bar stays this long unless hovered

export const NOTIF_REFRESH = "gc-notif-refresh"; // fire after changing state elsewhere
export const NOTIF_COUNT = "gc-notif-count";     // detail: { unread, action }
export const NOTIF_CENTER = "/dashboard/preview/notifications";
// tab=master matters: without it the task modal opens over the Workload view, which is
// a day-capacity planner — so closing the modal leaves you on somebody's timeline
// rather than on the task you just opened.
export const taskHref = (postId: string) => `/dashboard/preview/marketing-hub?tab=master&open=${postId}`;

export async function patchNotifs(body: { op: "read" | "dismiss" | "popped" | "delete"; ids?: string[]; all?: boolean; category?: string }) {
  const r = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
}

// Should this item be on screen right now?
//
// ONLY things that need a decision. An FYI — "your task is approved", "your task
// is published" — used to pop as well, and for whoever creates the tasks that is
// every status change in the company: Maheen had 30 of them, 29 unread, three
// stacked over the page at a time (28 Sep). They are news, not a question, so they
// go to the bell and the count and nowhere else.
function wantsPop(n: NotifItem, now: number): boolean {
  if (n.read_at || n.dismissed_at) return false;
  // One exception: a competitor announcing a webinar or event pops up ONCE — the
  // whole point of watching them is to hear about it straight away (Praveen, 29 Sep).
  // It never re-pops: it's news, not something waiting on you.
  // Same for a Watcher finding a new counselling notice (1 Oct).
  if (n.kind === "competitor_event" || n.kind === "watcher_news") return !n.last_popped_at;
  if (!n.action_needed) return false;
  if (n.done_at) return false;
  return !n.last_popped_at || now - new Date(n.last_popped_at).getTime() >= REPOP_MS;
}

export function NotificationHost() {
  const router = useRouter();
  const pathname = usePathname();
  const [shown, setShown] = useState<NotifItem[]>([]);
  const shownRef = useRef<NotifItem[]>([]);   // what the bar is counting, readable outside a state updater
  shownRef.current = shown;
  const hovering = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [armed, setArmed] = useState(0);      // bumps when new items arrive, restarting the clock

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setShown([]);
  }, []);

  const load = useCallback(async () => {
    let body: { items?: NotifItem[]; quiet?: boolean };
    try {
      // localStorage "gc-notif-ignore-quiet" = "1" asks the API to skip quiet hours;
      // the API only honours it on a local dev server.
      const ignoreQuiet = typeof localStorage !== "undefined" && localStorage.getItem("gc-notif-ignore-quiet") === "1";
      const r = await fetch(`/api/notifications${ignoreQuiet ? "?ignoreQuiet=1" : ""}`, { cache: "no-store" });
      if (!r.ok) return;
      body = await r.json();
    } catch { return; }
    const items = body.items || [];

    // Unread count → tab title + sidebar badge.
    const unread = items.filter((n) => !n.read_at).length;
    const action = items.filter((n) => n.action_needed && !n.done_at && !n.read_at).length;
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = unread ? `(${unread}) ${base}` : base;
    window.dispatchEvent(new CustomEvent(NOTIF_COUNT, { detail: { unread, action } }));

    if (body.quiet) return;
    const now = Date.now();
    // Keep counting what is already on the bar unless it was handled meanwhile
    // (read or dismissed in the center, or in another tab).
    const live = new Map(items.map((n) => [n.id, n]));
    const still = shownRef.current.filter((x) => { const n = live.get(x.id); return n && !n.read_at && !n.dismissed_at; });
    const onBar = new Set(still.map((x) => x.id));
    const due = items.filter((n) => !onBar.has(n.id) && wantsPop(n, now));
    if (due.length) {
      // Record that they popped so the 90 s clock restarts and another open tab
      // doesn't show them too. Kept out of the state updater: React may run an
      // updater twice, which would send this twice.
      patchNotifs({ op: "popped", ids: due.map((n) => n.id) }).catch(() => {});
      setArmed((a) => a + 1);
    }
    if (due.length || still.length !== shownRef.current.length) setShown([...due, ...still]);
  }, []);

  // The bar hides itself after a while (unless hovered). Hidden ≠ handled: an
  // unread action item simply comes back on a later poll.
  useEffect(() => {
    if (!armed) return;
    const arm = () => {
      timer.current = setTimeout(() => {
        if (hovering.current) { arm(); return; }
        close();
      }, SHOW_MS);
    };
    if (timer.current) clearTimeout(timer.current);
    arm();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [armed, close]);

  // A message in the team chat, heard from ANY tab — the chat panel itself only
  // exists in My Day, so before this you had to be sitting on that page to know
  // someone had written to you (Praveen, 28 Sep).
  //
  // This host is already mounted once in the layout and already polling, so it is
  // the natural place for it. It tracks the newest message id it has seen rather
  // than the unread count: read-state lives in My Day's own storage, and copying
  // that here would be two things to keep in step.
  useEffect(() => {
    const SEEN = "gc-chat-last-seen";
    let alive = true;
    let me = "";
    const tick = async () => {
      try {
        if (!me) {
          const who = await fetch("/api/me", { cache: "no-store" }).then((r) => r.json());
          me = (who?.user?.id || "").toLowerCase();
          if (!me) return;
        }
        const d = await fetch("/api/my-day/chat", { cache: "no-store" }).then((r) => r.json());
        const msgs = (d.messages || []) as { id: string; sender: string }[];
        if (!msgs.length || !alive) return;
        const newest = msgs[msgs.length - 1];
        const seen = localStorage.getItem(SEEN);
        localStorage.setItem(SEEN, newest.id);
        // First run on a device has nothing to compare against — remember where we
        // came in, and stay quiet. Your own messages never ring.
        if (!seen || seen === newest.id) return;
        if ((newest.sender || "").toLowerCase() === me) return;
        playChatChime();
      } catch { /* the chat is a nicety here; never let it break the bell */ }
    };
    tick();
    const id = setInterval(() => { if (shouldPoll()) tick(); }, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (shouldPoll()) load(); }, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener(NOTIF_REFRESH, onFocus);
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus); window.removeEventListener(NOTIF_REFRESH, onFocus); };
  }, [load]);

  // Already looking at them — the pop-up would only cover the list it points to.
  if (!shown.length || pathname?.startsWith(NOTIF_CENTER)) return null;
  // The Bell button (Praveen, 3 Nov — prototype docs/notify-buddy-prototype/v9.html):
  // a bell above the Comment button rings, its red count pops and pulse rings spread,
  // then the first item slides out beside it. One item opens straight on its task;
  // several open the notification center.
  const count = shown.length;
  const first = shown[0];
  const decision = shown.some((n) => n.action_needed);
  const open = () => {
    close();
    if (count === 1 && first.post_id) router.push(taskHref(first.post_id));
    else if (count === 1 && first.payload?.href) router.push(first.payload.href);
    else router.push(NOTIF_CENTER);
  };
  return (
    <div className="gc-nb" key={armed} onMouseEnter={() => { hovering.current = true; }} onMouseLeave={() => { hovering.current = false; }}
      role="status" aria-live="polite">
      <div className="gc-nb-panel">
        <div className="gc-nb-meta">{decision ? "Needs your decision" : "New for you"} · now</div>
        <div className="gc-nb-title">{first.title}</div>
        {first.sub && <div className="gc-nb-sub">{first.sub}</div>}
        {count > 1 && <div className="gc-nb-more">+ {count - 1} more waiting for you</div>}
        <div className="gc-nb-acts">
          <button type="button" className="gc-nb-go" onClick={open}>{count === 1 ? "Review" : `Review all ${count}`}</button>
          <button type="button" className="gc-nb-later" onClick={close}>Later</button>
        </div>
      </div>
      <button type="button" className="gc-nb-fab" onClick={open} aria-label={`${count} notification${count === 1 ? "" : "s"} — review`} title="Review">
        <span className="gc-nb-pulse" /><span className="gc-nb-pulse b" />
        <IconBell size={25} stroke={1.9} className="gc-nb-bell" />
        <span className="gc-nb-count">{count > 99 ? "99+" : count}</span>
      </button>
    </div>
  );
}
