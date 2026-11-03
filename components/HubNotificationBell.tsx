"use client";
import { useEffect, useRef, useState } from "react";
import { IconBell, IconX } from "@tabler/icons-react";
import { NotifIcon } from "@/app/(dashboard)/dashboard/preview/NotifIcon";
import { shouldPoll } from "@/lib/quiet-hours";

// Marketing Hub top-bar notification bell.
//
// Surfaces the logged-in user's real notifications (claims, approvals/handoffs,
// send-backs, push-to-schedule, reassignments) from the same event-log endpoint
// My Day uses — so the team sees them from ANY Hub subtab, not only My Day.
// Read-only, polls every 60s; dismissals are local (session-only) so a badge
// clears without needing a per-user read-state table yet.
type Notif = { id: string; kind: string; emoji: string; title: string; sub: string };

export default function HubNotificationBell() {
  const [person, setPerson] = useState<string | null>(null);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Who am I → drives which person's notifications to load.
  useEffect(() => {
    let alive = true;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (alive) setPerson(d?.user?.id || null); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Poll notifications for that person.
  useEffect(() => {
    if (!person) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/my-day/notifications?person=${encodeURIComponent(person)}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (alive) setNotifs(Array.isArray(d?.notifs) ? d.notifs : []);
      } catch { /* transient — keep last */ }
    };
    load();
    // The first load runs whenever the component mounts — someone has opened
    // the page, so they should see the badge. The repeat is the one that has to
    // behave: this hits Supabase, and without the guard it fired 1,440 times a
    // day per forgotten tab, straight through the 00:00–06:00 stop zone. Every
    // other poller in the app already checks this.
    const t = setInterval(() => { if (shouldPoll()) load(); }, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [person]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const visible = notifs.filter((n) => !dismissed.has(n.id));
  const count = visible.length;

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        data-notif-bell
        aria-label="Notifications"
        className="relative w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-brand transition"
      >
        <IconBell size={18} stroke={1.8} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-brand text-white text-[10px] font-semibold flex items-center justify-center">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-100 rounded-xl shadow-sm z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
            <span className="text-[13px] font-medium text-[#232D42]">Notifications</span>
            {count > 0 && (
              <button
                onClick={() => setDismissed(new Set(notifs.map((n) => n.id)))}
                className="text-[11px] text-gray-400 hover:text-brand"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {count === 0 ? (
              <div className="px-4 py-8 text-center text-[12.5px] text-gray-400">You&apos;re all caught up.</div>
            ) : (
              visible.map((n) => (
                <div key={n.id} className="flex items-start gap-2.5 px-4 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50/60 group">
                  {/* Tabler icon for the stored emoji — same as the Notifications tab and My Day */}
                  <NotifIcon emoji={n.emoji} size={16} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium text-[#232D42] truncate">{n.title}</div>
                    <div className="text-[11.5px] text-gray-500 leading-snug">{n.sub}</div>
                  </div>
                  <button
                    onClick={() => setDismissed((d) => new Set(d).add(n.id))}
                    aria-label="Dismiss"
                    className="text-gray-300 hover:text-gray-600 opacity-0 group-hover:opacity-100 mt-0.5"
                  >
                    <IconX size={14} stroke={2} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
