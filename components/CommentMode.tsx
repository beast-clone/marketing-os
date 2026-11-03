"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { confirmDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

// Figma-style comment layer for the whole dashboard.
//
// A small always-visible "Comment" button toggles comment mode. In comment mode
// the page dims to a crosshair, hovering highlights the section under the cursor,
// and clicking drops a numbered pin with a note. Pins are saved to localStorage
// per page (attributed to the signed-in user) so they survive leaving comment
// mode, navigating, and reloads. Leaving comment mode hides every pin; re-entering
// brings them all back. Esc exits.
//
// localStorage-backed (per browser) — deliberately no backend, so it is instant
// and demo-safe. Upgrading to shared/team comments later means swapping load/save
// for an API without touching the UI.

type Comment = {
  id: string;
  path: string; // pathname the pin belongs to
  x: number; // document coordinates (px)
  y: number;
  text: string;
  author: string;
  ts: number;
  resolved?: boolean;
  ctx?: CommentContext;
  editedTs?: number;
};

// Keep a popover (width w, height ~h) fully inside the visible window: open to the
// right of the pin, flip to its left near the right edge, and clamp top/bottom.
function placeBox(x: number, y: number, w: number, h: number): { left: number; top: number } {
  const minX = window.scrollX + 12, maxX = window.scrollX + window.innerWidth - w - 12;
  const minY = window.scrollY + 12, maxY = window.scrollY + window.innerHeight - h - 12;
  let left = x + 18;
  if (left > maxX) left = x - w - 18;
  left = Math.max(minX, Math.min(left, maxX));
  const top = Math.max(minY, Math.min(y - 20, maxY));
  return { left, top };
}

// What the person was pointing at, so whoever picks the comment up (including
// Claude working through the Comments page) knows exactly where to look.
export type CommentContext = {
  target: string;   // the clicked element, e.g. 'button "Start"' or 'text "NZ Ebook - Carousel"'
  section: string;  // the card/section it sits in, by its heading
  url: string;      // full path + query (?tab=…)
  viewport: string; // e.g. "1366×768 @2x"
};

const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

// Describe one element in plain words: its role and its visible label.
function describeEl(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const kind = el.getAttribute("role") || (tag === "a" ? "link" : tag === "button" ? "button" : tag === "input" || tag === "textarea" || tag === "select" ? "field" : tag === "img" ? "image" : tag === "svg" || tag === "path" ? "icon" : /^h[1-6]$/.test(tag) ? "heading" : tag === "td" || tag === "th" ? "table cell" : "text");
  // Visible text first — a tooltip (title) describes the gesture, not the thing.
  const label = el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || (el as HTMLInputElement).value || el.getAttribute("alt") || el.getAttribute("title") || "";
  return label ? `${kind} "${clip(label, 80)}"` : kind;
}

// The element under a point (the comment overlay made click-through for a moment)
// plus the section-like container around it, named by its heading.
function contextAt(overlay: HTMLElement | null, clientX: number, clientY: number): CommentContext {
  const prev = overlay?.style.pointerEvents ?? "";
  if (overlay) overlay.style.pointerEvents = "none";
  let el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  if (overlay) overlay.style.pointerEvents = prev;
  // An icon/path inside a button reads better as the button itself.
  const clickable = el?.closest("button, a, [role=button], input, select, textarea") as HTMLElement | null;
  // A bare text line ("Carousel · 1h") reads better as the item it belongs to — widen
  // to the largest ancestor that is still one short item (a task block, a card row).
  let target = clickable || el;
  if (!clickable) {
    let up = el?.parentElement || null;
    while (up && up !== document.body && (up.innerText || "").trim().length <= 120) { target = up; up = up.parentElement; }
  }
  let section = "";
  let node: HTMLElement | null = el;
  for (let d = 0; node && d < 16 && !section; d++, node = node.parentElement) {
    const cls = typeof node.className === "string" ? node.className : "";
    const tag = node.tagName.toLowerCase();
    if (tag === "section" || tag === "table" || tag === "article" || /rounded-(lg|xl|2xl)|\bcard\b|\bhero\b/.test(cls)) {
      const h = node.querySelector("h1, h2, h3, h4, [role=heading]") as HTMLElement | null;
      section = clip(h?.innerText || node.innerText.split("\n")[0] || "", 70);
    }
  }
  return {
    target: target ? describeEl(target) : "",
    section,
    url: window.location.pathname + window.location.search,
    viewport: `${window.innerWidth}×${window.innerHeight}${window.devicePixelRatio > 1 ? ` @${window.devicePixelRatio}x` : ""}`,
  };
}

const LS_KEY = "gc-dash:comments:v1";
const HIDE_ON = ["/login"]; // never show the tool here

function loadAll(): Comment[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]") as Comment[];
  } catch {
    return [];
  }
}
function saveAll(list: Comment[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* private mode / quota — ignore */
  }
}
function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}
function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function CommentMode() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [on, setOn] = useState(false);
  const [all, setAll] = useState<Comment[]>([]);
  const [draft, setDraft] = useState<{ x: number; y: number; ctx?: CommentContext } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [draftText, setDraftText] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [author, setAuthor] = useState("You");
  const [hi, setHi] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
    const local = loadAll();
    setAll(local);
    // Pick up resolves done elsewhere (System → Comments, or by whoever fixed it) — this
    // browser's copy never hears about them, so the badge kept counting fixed comments.
    const open = local.filter((c) => !c.resolved).map((c) => c.id);
    if (!open.length) return;
    fetch(`/api/comments?status=${encodeURIComponent(open.join(","))}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { status?: { id: string; resolved: boolean }[] } | null) => {
        const done = new Set((d?.status || []).filter((s) => s.resolved).map((s) => s.id));
        if (!done.size) return;
        const next = local.map((c) => (done.has(c.id) ? { ...c, resolved: true } : c));
        setAll(next); saveAll(next);
      })
      .catch(() => { /* offline — keep the local copy */ });
  }, []);

  // Who is commenting — for attribution on the pin.
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (d?.user?.first) setAuthor(d.user.first as string);
      })
      .catch(() => {});
  }, []);

  const persist = useCallback((list: Comment[]) => {
    setAll(list);
    saveAll(list);
  }, []);

  // Esc exits comment mode (and clears any open draft/pin).
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDraft(null);
        setOpenId(null);
        setHi(null);
        setOn(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);

  // Leaving comment mode clears transient UI.
  useEffect(() => {
    if (!on) {
      setDraft(null);
      setOpenId(null);
      setHi(null);
    }
  }, [on]);

  if (!mounted) return null;
  if (HIDE_ON.some((p) => pathname?.startsWith(p))) return null;

  const pageComments = all.filter((c) => c.path === pathname);
  const pageCount = pageComments.filter((c) => !c.resolved).length;
  const openComment = pageComments.find((c) => c.id === openId) || null;

  // Find the nearest "section-like" container under the cursor so hovering shows
  // what you're about to comment on. Overlay is briefly made click-through so
  // elementFromPoint sees the real page underneath.
  const sectionRectAt = (clientX: number, clientY: number): DOMRect | null => {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    const prev = overlay.style.pointerEvents;
    overlay.style.pointerEvents = "none";
    let el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    overlay.style.pointerEvents = prev;
    let depth = 0;
    while (el && depth < 14) {
      const tag = el.tagName.toLowerCase();
      const cls = typeof el.className === "string" ? el.className : "";
      if (tag === "section" || tag === "table" || tag === "article" || /rounded-(lg|xl|2xl)/.test(cls)) {
        return el.getBoundingClientRect();
      }
      el = el.parentElement;
      depth++;
    }
    return null;
  };

  const onMove = (e: React.MouseEvent) => {
    if (draft || openComment) return; // freeze highlight while typing/reading
    const cx = e.clientX;
    const cy = e.clientY;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      try {
        const rect = sectionRectAt(cx, cy);
        if (rect && rect.width > 0) {
          setHi({ left: rect.left + window.scrollX, top: rect.top + window.scrollY, width: rect.width, height: rect.height });
        } else {
          setHi(null);
        }
      } catch {
        setHi(null);
      }
    });
  };

  const onCapture = (e: React.MouseEvent) => {
    const x = e.clientX + window.scrollX;
    const y = e.clientY + window.scrollY;
    let ctx: CommentContext | undefined;
    try { ctx = contextAt(overlayRef.current, e.clientX, e.clientY); } catch { /* context is a bonus */ }
    setOpenId(null);
    setDraft({ x, y, ctx });
    setDraftText("");
    setHi(null);
  };

  const saveDraft = () => {
    if (!draft) return;
    const text = draftText.trim();
    if (!text) {
      setDraft(null);
      return;
    }
    const c: Comment = { id: newId(), path: pathname || "/", x: draft.x, y: draft.y, text, author, ts: Date.now(), ctx: draft.ctx };
    persist([...all, c]);
    // Also log it server-side (best-effort) so it lands in the daily digest email.
    fetch("/api/comments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, path: c.path, text: c.text, author: c.author, ts: c.ts, ctx: c.ctx }),
    }).catch(() => {});
    setDraft(null);
    setDraftText("");
  };

  // Edit your own comment: update the pin and re-send it, so the admin Comments page
  // (and whoever picks it up) sees the new text. Re-sending reopens it if resolved.
  const saveEdit = (id: string) => {
    const text = editText.trim();
    const c = all.find((x) => x.id === id);
    if (!c || !text) return;
    const next: Comment = { ...c, text, editedTs: Date.now(), resolved: false };
    persist(all.map((x) => (x.id === id ? next : x)));
    fetch("/api/comments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, path: c.path, text, author: c.author, ts: c.ts, ctx: c.ctx }),
    }).catch(() => {});
    setEditingId(null);
  };

  const removeComment = async (id: string) => {
    if (!(await confirmDialog({ title: "Delete this comment?", action: "Delete", cancel: "Cancel", danger: true }))) return;
    persist(all.filter((c) => c.id !== id));
    setOpenId(null);
  };
  const toggleResolved = (id: string) => {
    persist(all.map((c) => (c.id === id ? { ...c, resolved: !c.resolved } : c)));
  };

  const Z = { overlay: 9990, hi: 9991, pin: 9992, pop: 9995, banner: 9997, btn: 9999 };

  return createPortal(
    <>
      {/* Always-visible toggle */}
      <button
        onClick={() => setOn((v) => !v)}
        style={{ zIndex: Z.btn }}
        className={`fixed bottom-5 right-5 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-medium shadow-lg transition ${
          on ? "bg-gray-900 text-white" : "bg-white text-gray-800 border border-gray-200 hover:border-brand hover:text-brand"
        }`}
        title={on ? "Exit comment mode (Esc)" : "Leave comments on this page"}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {on ? "Exit comments" : "Comment"}
        {!on && pageCount > 0 && (
          <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-white text-[11px] font-semibold tabular-nums">
            {pageCount}
          </span>
        )}
      </button>

      {on && (
        <>
          {/* Top banner */}
          <div
            style={{ zIndex: Z.banner }}
            className="fixed top-0 left-0 right-0 h-9 bg-gray-900 text-white text-[12.5px] font-medium flex items-center justify-center gap-2 shadow"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Comment mode — click anywhere to leave a note · click a pin to read it · <kbd className="px-1.5 py-0.5 rounded bg-white/15">Esc</kbd> to exit
          </div>

          {/* Section highlight */}
          {hi && (
            <div
              style={{ zIndex: Z.hi, position: "absolute", left: hi.left, top: hi.top, width: hi.width, height: hi.height }}
              className="pointer-events-none rounded-lg ring-2 ring-brand/60 bg-brand/5"
            />
          )}

          {/* Click capture — transparent, crosshair. Sits above content so normal
              clicks are intercepted; pins/popovers sit above this. */}
          <div
            ref={overlayRef}
            onClick={onCapture}
            onMouseMove={onMove}
            style={{ zIndex: Z.overlay, cursor: "crosshair" }}
            className="fixed inset-0"
          />

          {/* Existing pins */}
          {pageComments.map((c, i) => (
            <button
              key={c.id}
              onClick={(e) => {
                e.stopPropagation();
                setDraft(null);
                setOpenId((cur) => (cur === c.id ? null : c.id));
              }}
              style={{ zIndex: Z.pin, position: "absolute", left: c.x, top: c.y, transform: "translate(-2px, -30px)" }}
              className={`w-7 h-7 rounded-full rounded-bl-none shadow-md text-white text-[12px] font-semibold flex items-center justify-center border-2 border-white transition hover:scale-110 ${
                c.resolved ? "bg-emerald-500" : "bg-brand"
              }`}
              title={c.resolved ? "Resolved" : c.text}
            >
              {c.resolved ? "✓" : i + 1}
            </button>
          ))}

          {/* Open pin popover */}
          {openComment && (
            <div
              style={{ zIndex: Z.pop, position: "absolute", ...placeBox(openComment.x, openComment.y, 260, editingId === openComment.id ? 230 : 180), width: 260 }}
              className="bg-white rounded-xl shadow-xl border border-gray-200 p-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-brand/10 text-brand text-[11px] font-semibold flex items-center justify-center">
                    {openComment.author.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="leading-tight">
                    <div className="text-[12.5px] font-semibold text-gray-900">{openComment.author}</div>
                    <div className="text-[10.5px] text-gray-400">{relTime(openComment.ts)}</div>
                  </div>
                </div>
                {openComment.resolved && <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide">Resolved</span>}
              </div>
              {editingId === openComment.id ? (
                <>
                  <textarea autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} rows={3}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit(openComment.id); if (e.key === "Escape") { e.stopPropagation(); setEditingId(null); } }}
                    className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 outline-none focus:border-brand resize-none" />
                  <div className="flex items-center justify-end gap-2 mt-2">
                    <button onClick={() => setEditingId(null)} className="text-[12px] font-medium text-gray-500 hover:text-gray-800 px-2 py-1">Cancel</button>
                    <button onClick={() => saveEdit(openComment.id)} disabled={!editText.trim()} className="text-[12px] font-semibold text-white bg-brand rounded-lg px-3 py-1.5 disabled:opacity-40">Save</button>
                  </div>
                </>
              ) : (
                <p className="text-[13px] text-gray-800 leading-relaxed whitespace-pre-wrap break-words">{openComment.text}{openComment.editedTs ? <span className="text-[11px] text-gray-400"> (edited)</span> : null}</p>
              )}
              {editingId !== openComment.id && <div className="flex items-center gap-2 mt-3 pt-2 border-t border-gray-100">
                <button onClick={() => { setEditingId(openComment.id); setEditText(openComment.text); }} className="text-[12px] font-medium text-gray-700 hover:text-brand">
                  Edit
                </button>
                <button onClick={() => toggleResolved(openComment.id)} className="text-[12px] font-medium text-gray-700 hover:text-brand">
                  {openComment.resolved ? "Reopen" : "Resolve"}
                </button>
                <button onClick={() => removeComment(openComment.id)} className="text-[12px] font-medium text-rose-600 hover:text-rose-700 ml-auto">
                  Delete
                </button>
                <button onClick={() => setOpenId(null)} className="text-[12px] font-medium text-gray-400 hover:text-gray-700">
                  Close
                </button>
              </div>}
            </div>
          )}

          {/* Draft (new comment) popover */}
          {draft && (
            <div
              style={{ zIndex: Z.pop, position: "absolute", ...placeBox(draft.x, draft.y, 260, 200), width: 260 }}
              className="bg-white rounded-xl shadow-xl border border-gray-200 p-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-full bg-brand/10 text-brand text-[11px] font-semibold flex items-center justify-center">
                  {author.slice(0, 2).toUpperCase()}
                </span>
                <div className="text-[12.5px] font-semibold text-gray-900">{author}</div>
              </div>
              <textarea
                autoFocus
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveDraft();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setDraft(null);
                  }
                }}
                placeholder="Add a comment…"
                rows={3}
                className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 outline-none focus:border-brand resize-none"
              />
              <div className="flex items-center justify-end gap-2 mt-2">
                <button onClick={() => setDraft(null)} className="text-[12px] font-medium text-gray-500 hover:text-gray-800 px-2 py-1">
                  Cancel
                </button>
                <button
                  onClick={saveDraft}
                  disabled={!draftText.trim()}
                  className="text-[12px] font-semibold text-white bg-brand rounded-lg px-3 py-1.5 disabled:opacity-40"
                >
                  Comment
                </button>
              </div>
              <div className="text-[10px] text-gray-400 mt-1.5">⌘/Ctrl + Enter to post</div>
            </div>
          )}
        </>
      )}
    </>,
    document.body,
  );
}
