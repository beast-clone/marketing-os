"use client";
import { LoadingBlock } from "@/components/LoadingBlock";
import { useEffect, useRef, useState } from "react";
import { IconX, IconCheck, IconSearch, IconAlertTriangle } from "@tabler/icons-react";

// Pick collaborators by confirming them, not by typing and hoping.
//
// The old field was a free-text box: a typo was accepted, stored, and invited
// nobody — and there was no way to tell the difference from a success. Every name
// here has been looked up on Instagram first, so a chip means the account exists.
//
// Confirmation comes from business_discovery, which answers for Business and
// Creator accounts only. That is the right restriction rather than a limitation:
// a personal account cannot be a collaborator on Instagram either.

export type Collaborator = { username: string; name: string | null; profilePictureUrl: string | null };

const MAX = 3;   // Instagram's own limit

export function CollaboratorPicker({ value, onChange, ownAccounts }: {
  value: Collaborator[];
  onChange: (next: Collaborator[]) => void;
  /** Our own handles, offered before anyone types — the common case. */
  ownAccounts: { username: string; label: string }[];
}) {
  const [q, setQ] = useState("");
  const [match, setMatch] = useState<Collaborator | null>(null);
  const [state, setState] = useState<"idle" | "checking" | "none">("idle");
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // Debounced, because a lookup on every keystroke is a Graph API call on every
  // keystroke.
  useEffect(() => {
    const clean = q.replace(/^@+/, "").trim();
    if (clean.length < 3) { setMatch(null); setState("idle"); return; }
    let alive = true;
    setState("checking");
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/scheduler/collaborator?handle=${encodeURIComponent(clean)}`, { credentials: "same-origin" });
        const d = await r.json();
        if (!alive) return;
        if (d.match) { setMatch(d.match); setState("idle"); } else { setMatch(null); setState("none"); }
      } catch { if (alive) { setMatch(null); setState("none"); } }
    }, 500);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const already = (u: string) => value.some((v) => v.username.toLowerCase() === u.toLowerCase());
  const add = (c: Collaborator) => {
    if (value.length >= MAX || already(c.username)) return;
    onChange([...value, c]);
    setQ(""); setMatch(null); setOpen(false);
  };
  const remove = (u: string) => onChange(value.filter((v) => v.username !== u));

  const suggestions = ownAccounts.filter((a) =>
    !already(a.username) && (q.trim() === "" || a.username.toLowerCase().includes(q.replace(/^@+/, "").toLowerCase())));

  return (
    <div ref={wrap} className="relative">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {value.map((c) => (
            <span key={c.username} className="inline-flex items-center gap-1.5 bg-brand-light text-brand rounded-lg pl-1.5 pr-1 py-1 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.profilePictureUrl
                ? <img src={c.profilePictureUrl} alt="" className="w-4 h-4 rounded-full object-cover" loading="lazy" decoding="async" />
                : <IconCheck size={13} stroke={2.4} />}
              <span className="font-medium">@{c.username}</span>
              <button type="button" onClick={() => remove(c.username)} aria-label={`Remove ${c.username}`}
                className="p-0.5 rounded hover:bg-white/60"><IconX size={12} stroke={2.4} /></button>
            </span>
          ))}
        </div>
      )}

      {value.length < MAX ? (
        <div className="relative">
          <IconSearch size={14} stroke={1.9} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Start typing a username — goocampusworld"
            className="w-full pl-8 pr-3 py-2 text-sm text-gray-900 rounded-lg border border-gray-200 focus:border-brand focus:outline-none"
          />
        </div>
      ) : (
        <div className="text-xs text-gray-500">Instagram allows 3 collaborators — remove one to add another.</div>
      )}

      {open && value.length < MAX && (
        <div style={{ boxShadow: "0 12px 32px rgba(35,45,66,.16)" }}
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 bg-white border border-gray-200 rounded-xl overflow-hidden">
          {suggestions.length > 0 && (
            <>
              <div className="px-3 py-1.5 bg-[#FCFCFE] border-b border-gray-100 text-[10.5px] font-semibold uppercase tracking-wider text-[#A6ACBE]">
                Your accounts
              </div>
              {suggestions.map((a) => (
                <button key={a.username} type="button"
                  onClick={() => add({ username: a.username, name: a.label, profilePictureUrl: null })}
                  className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-brand-light">
                  <span className="text-[12.5px] font-medium text-[#232D42]">@{a.username}</span>
                  <span className="text-[11px] text-[#A6ACBE]">{a.label}</span>
                </button>
              ))}
            </>
          )}

          {q.replace(/^@+/, "").trim().length >= 3 && (
            <>
              <div className="px-3 py-1.5 bg-[#FCFCFE] border-y border-gray-100 text-[10.5px] font-semibold uppercase tracking-wider text-[#A6ACBE]">
                On Instagram
              </div>
              {state === "checking" && <LoadingBlock size={18} className="!py-2 !px-3 !flex-row !justify-start !gap-2" label="Checking Instagram…" />}
              {state === "none" && (
                <div className="flex items-start gap-2 px-3 py-2">
                  <IconAlertTriangle size={14} stroke={1.9} className="text-[#B7791F] shrink-0 mt-[2px]" />
                  <span className="text-[11.5px] leading-snug text-[#7A5410]">
                    No Business or Creator account called <b>@{q.replace(/^@+/, "").trim()}</b>. Check the spelling —
                    Instagram can only collaborate with Business and Creator accounts.
                  </span>
                </div>
              )}
              {match && (
                <button type="button" onClick={() => add(match)}
                  className="flex items-center gap-2.5 w-full text-left px-3 py-2 hover:bg-brand-light">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {match.profilePictureUrl && <img src={match.profilePictureUrl} alt="" className="w-7 h-7 rounded-full object-cover" loading="lazy" decoding="async" />}
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium text-[#232D42]">@{match.username}</span>
                    <span className="block text-[11px] text-[#A6ACBE] truncate">{match.name || "Instagram account"}</span>
                  </span>
                  <IconCheck size={15} stroke={2.2} className="ml-auto text-[#2F9E6F] shrink-0" />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
