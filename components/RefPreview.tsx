"use client";
import { useEffect, useLayoutEffect, useState } from "react";
import { IconX, IconExternalLink, IconChevronLeft, IconChevronRight, IconDownload, IconCopy, IconCheck } from "@tabler/icons-react";
import { SoundVideo } from "@/components/SoundVideo";

// Put a picture on the clipboard so it pastes straight into WhatsApp, Canva, a doc…
// (Praveen, 26 Oct). Browsers only take PNG, so anything else is redrawn as PNG first.
async function copyImage(url: string): Promise<boolean> {
  try {
    const blob = await fetch(url, { mode: "cors" }).then((r) => r.blob());
    let png = blob;
    if (blob.type !== "image/png") {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
      c.getContext("2d")!.drawImage(bmp, 0, 0);
      png = await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("no image"))), "image/png"));
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch { return false; }
}

// One side panel for everything a task points at (Praveen, 23 Oct): a link in the
// brief, a reference link or file, a creative, an attachment. Click it and it opens
// on the right of the screen, next to the task, instead of in a new tab — Instagram
// posts and reels, YouTube, Drive and Canva through their own embeds; images, videos
// and PDFs directly. Anything that can't be shown inside the dashboard (a site that
// blocks it, a .zip) gets an "Open in a new tab" / Download button instead.
//
// Mounted once (RefPreviewHost, in the preview layout). Opened from anywhere with
// openRefPreview(); links inside an element marked data-ref-preview open here too.
// Opened from inside a task box marked data-ref-dock, it sits inside that box (its
// right side) rather than over the whole screen (Praveen, 23 Oct).

export type RefItem = { url: string; title?: string; from?: string };
type State = { items: RefItem[]; index: number; dock?: HTMLElement | null } | null;

let setOpenState: ((s: State) => void) | null = null;
// The element last pressed — its task box is where the panel docks.
let lastDown: Element | null = null;
const dockOf = (el: Element | null) => el?.closest<HTMLElement>("[data-ref-dock]") ?? null;
/** Whether the side panel is on this page (so callers can leave links to it). */
export const refPreviewAvailable = () => !!setOpenState;

/** Open one link/file, or a set (with ‹ › between them) at `index`. */
// `dock` — open inside that box instead of the one last clicked (a task opening
// with its attachments already showing).
export function openRefPreview(items: RefItem | RefItem[], index = 0, dock?: HTMLElement | null): boolean {
  if (!setOpenState) return false;   // no host on this page — the caller opens a tab
  const list = Array.isArray(items) ? items : [items];
  if (!list.length) return false;
  setOpenState({ items: list, index: Math.min(Math.max(0, index), list.length - 1), dock: dock ?? dockOf(lastDown) });
  return true;
}

/** Close the panel — only when it sits in `dock`, if one is given. */
let currentDock: HTMLElement | null = null;
export function closeRefPreview(dock?: HTMLElement | null) {
  if (!setOpenState || (dock && currentDock !== dock)) return;
  setOpenState(null);
}

type View =
  | { kind: "frame"; src: string; narrow?: boolean }
  | { kind: "image" | "video" | "pdf"; src: string }
  | { kind: "download" }
  | { kind: "outside" };

const ext = (u: string) => (u.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();

// Hosts the dashboard's security rules (CSP img-src / media-src / frame-src) let it
// show directly. A file anywhere else would render as a blocked, blank box.
const MEDIA_HOSTS = /(^|\.)(supabase\.co|cdninstagram\.com|fbcdn\.net|googleusercontent\.com|ytimg\.com|licdn\.com|imgur\.com)$/i;

export function viewFor(raw: string): View {
  let u: URL;
  try { u = new URL(raw); } catch { return { kind: "outside" }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { kind: "outside" };   // never javascript:/data: in a frame
  const host = u.hostname.replace(/^www\./, "");
  const e = ext(u.pathname);
  const ours = MEDIA_HOSTS.test(u.hostname);
  if (ours && ["png", "jpg", "jpeg", "webp", "gif", "avif"].includes(e)) return { kind: "image", src: raw };
  if (ours && ["mp4", "mov", "webm", "m4v"].includes(e)) return { kind: "video", src: raw };
  if (e === "pdf" && /(^|\.)supabase\.co$/i.test(u.hostname)) return { kind: "pdf", src: raw };
  if (["zip", "rar", "7z", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "psd", "ai"].includes(e)) return { kind: "download" };
  if (host === "instagram.com") {
    // Also links that carry the account name: instagram.com/<user>/reel/<id>/
    const m = u.pathname.match(/^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/);
    if (m) return { kind: "frame", narrow: true, src: `https://www.instagram.com/${m[1] === "p" ? "p" : "reel"}/${m[2]}/embed/${m[1] === "p" ? "captioned/" : ""}` };
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    const id = host === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v") || u.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/)?.[2];
    if (id) return { kind: "frame", src: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === "drive.google.com") {
    const id = u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] || u.searchParams.get("id");
    if (id) return { kind: "frame", src: `https://drive.google.com/file/d/${id}/preview` };
  }
  if (host === "docs.google.com") {
    const m = u.pathname.match(/^\/(document|presentation|spreadsheets)\/d\/([\w-]+)/);
    if (m) return { kind: "frame", src: `https://docs.google.com/${m[1]}/d/${m[2]}/preview` };
  }
  if (host === "canva.com") {
    // A link-shared design needs its share token: /design/<id>/<token>/view
    const m = u.pathname.match(/\/design\/([\w-]+)(?:\/([\w-]+))?/);
    if (m) return { kind: "frame", src: `https://www.canva.com/design/${m[1]}/${m[2] && !/^(view|edit|watch)$/.test(m[2]) ? `${m[2]}/` : ""}view?embed` };
  }
  return { kind: "outside" };
}

const nameOf = (r: RefItem) => r.title || (() => { try { const u = new URL(r.url); return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, ""); } catch { return r.url; } })();

export function RefPreviewHost() {
  const [st, setSt] = useState<State>(null);
  const [failed, setFailed] = useState<string | null>(null);   // a file that wouldn't load
  const [big, setBig] = useState(false);   // the picture shown full screen (click it)
  const [copied, setCopied] = useState<{ url: string; ok: boolean } | null>(null);   // the last copy, for the button label
  useEffect(() => { if (!st) setBig(false); }, [st]);
  const [box, setBox] = useState<React.CSSProperties | null>(null);   // docked position
  useEffect(() => { setOpenState = setSt; return () => { setOpenState = null; }; }, []);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { lastDown = e.target as Element; };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  // Docked: follow the task box as the page scrolls or resizes, kept on screen. The
  // panel closes if the box goes away (another task opened, window closed).
  const dock = st?.dock ?? null;
  currentDock = dock;
  useLayoutEffect(() => {
    if (!dock) { setBox(null); return; }
    let raf = 0;
    // A box on the page itself (My Day's task panel) is taller than the screen. The
    // panel keeps ONE size and stays inside that box: it rides along on screen while
    // the box is in view and stops at the box's edges. Following the visible slice
    // made it shrink, grow and spill past the task panel on every scroll (Praveen, 26 Oct).
    const place = () => {
      if (!dock.isConnected) { setSt(null); return; }
      // The box's VISIBLE frame — a scrolling parent can clip it (My Day's task
      // panel is taller than the card it sits in), and the panel must not hang out.
      const d = dock.getBoundingClientRect();
      let top0 = d.top, bot0 = d.bottom;
      for (let el = dock.parentElement; el && el !== document.body; el = el.parentElement) {
        if (getComputedStyle(el).overflowY === "visible") continue;
        const c = el.getBoundingClientRect();
        top0 = Math.max(top0, c.top); bot0 = Math.min(bot0, c.bottom);
      }
      const r = { top: top0, bottom: bot0, height: Math.max(bot0 - top0, 0), width: d.width, right: d.right };
      // Share of the box the preview takes: 40% by default (My Day, 60/40). A box can
      // set its own with data-ref-ratio — the task window widens and gives the preview about a fifth (Praveen, 26 Oct).
      const ratio = Number(dock.dataset.refRatio) || 0.4;
      const width = Math.min(r.width, Math.max(220, Math.round(r.width * ratio)));
      const height = Math.min(r.height, window.innerHeight - 16);
      const top = Math.min(Math.max(r.top, 8), r.bottom - height);
      setBox({ top, height, left: r.right - width, width });
      // Make room: the task's own content moves left and rewraps beside the panel,
      // instead of the panel covering half of every line (Praveen, 26 Oct).
      const pad = `${width + 16}px`;
      if (dock.style.paddingRight !== pad) dock.style.paddingRight = pad;
      dock.dataset.refOpen = "1";
    };
    const before = dock.style.paddingRight;
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };
    place();
    window.addEventListener("scroll", later, true);
    window.addEventListener("resize", later);
    const ro = new ResizeObserver(later); ro.observe(dock);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("scroll", later, true); window.removeEventListener("resize", later); ro.disconnect(); dock.style.paddingRight = before; delete dock.dataset.refOpen; };
  }, [dock]);

  // Links inside a task window (marked data-ref-preview) open here, not in a new tab.
  // Ctrl/Cmd-click still opens a tab, as everywhere else.
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const a = (ev.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || !a.closest("[data-ref-preview]") || a.closest("[data-ref-preview-skip]")) return;
      if (!/^https?:/i.test(a.href) || a.origin === window.location.origin) return;
      ev.preventDefault();
      ev.stopPropagation();   // the brief editor opens links itself on click; this replaces that
      setSt({ items: [{ url: a.href, title: a.dataset.refTitle || undefined, from: a.closest<HTMLElement>("[data-ref-from]")?.dataset.refFrom }], index: 0, dock: dockOf(a) });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!st) return;
    const onKey = (e: KeyboardEvent) => {
      // A pop-up (confirm dialog etc.) open above the panel gets the key, not the panel.
      if (document.querySelector("[data-overlay]")) return;
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      if (e.key === "Escape") { e.stopPropagation(); if (big) setBig(false); else setSt(null); }
      else if (typing) return;   // arrows move the cursor while typing, not the preview
      else if (e.key === "ArrowRight" && st.items.length > 1) setSt({ ...st, index: (st.index + 1) % st.items.length });
      else if (e.key === "ArrowLeft" && st.items.length > 1) setSt({ ...st, index: (st.index - 1 + st.items.length) % st.items.length });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [st, big]);

  if (!st) return null;
  const cur = st.items[st.index];
  const v = failed === cur.url ? { kind: "outside" as const } : viewFor(cur.url);
  const many = st.items.length > 1;
  const go = (d: number) => setSt({ ...st, index: (st.index + d + st.items.length) % st.items.length });
  // A box marked data-ref-stack (My Day) lists EVERY file at once, one under another,
  // instead of one with ‹ › (Praveen, 26 Oct). A click opens that one full size.
  const stack = !!box && st.dock?.dataset.refStack === "1" && many;
  const isPdfItem = (u: string) => /\.pdf(\?|#|$)/i.test(u.split("?")[0]) || viewFor(u).kind === "pdf";
  const indexed = st.items.map((it, i) => ({ it, i }));
  const stackSlides = indexed.filter((x) => !isPdfItem(x.it.url));
  const stackPdfs = indexed.filter((x) => isPdfItem(x.it.url));
  const openBig = (i: number) => { setSt({ ...st, index: i }); setBig(true); };
  const copy = async (url: string) => {
    const ok = await copyImage(url);
    setCopied({ url, ok }); setTimeout(() => setCopied(null), 1800);
  };
  const CopyBtn = ({ url, dark }: { url: string; dark?: boolean }) => (
    <button type="button" className={`rfp-copy${dark ? " dark" : ""}`} onClick={(e) => { e.stopPropagation(); copy(url); }} title="Copy the picture — then paste it anywhere">
      {copied?.url === url ? (copied.ok ? <><IconCheck size={13} stroke={2.2} />Copied</> : <>Couldn&apos;t copy</>) : <><IconCopy size={13} stroke={2} />Copy</>}
    </button>
  );

  return (
    <aside className={`rfp${box ? " docked" : ""}`} style={box ?? undefined} role="dialog" aria-label="Preview">
      <style>{CSS}</style>
      {/* The side preview is a glance; click the picture to see it full size
          (Praveen, 26 Oct). ‹ › and Esc work here too. */}
      {big && v.kind === "image" && (
        <div className="rfp-big" onClick={() => setBig(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={v.src} alt={nameOf(cur)} onClick={(e) => e.stopPropagation()} loading="lazy" decoding="async" />
          {many && <>
            <button type="button" className="rfp-big-nav l" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Previous"><IconChevronLeft size={22} stroke={2} /></button>
            <button type="button" className="rfp-big-nav r" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Next"><IconChevronRight size={22} stroke={2} /></button>
          </>}
          <button type="button" className="rfp-big-x" onClick={() => setBig(false)} aria-label="Close full size"><IconX size={20} stroke={2} /></button>
          <div className="rfp-big-copy"><CopyBtn url={cur.url} dark /></div>
          <div className="rfp-big-name">{nameOf(cur)}{many ? ` · ${st.index + 1} of ${st.items.length}` : ""}</div>
        </div>
      )}
      {stack ? (
        <div className="rfp-bar rfp-sbar">
          <div className="rfp-t">
            <div className="rfp-name">{cur.from || "Files"}</div>
            <div className="rfp-from">{stackPdfs.length ? `${stackSlides.length} slide${stackSlides.length === 1 ? "" : "s"} · ${stackPdfs.length} PDF for LinkedIn` : `${st.items.length} files`} · click one for full size</div>
          </div>
          <button type="button" className="rfp-btn ic" onClick={() => setSt(null)} aria-label="Close"><IconX size={15} stroke={2} /></button>
        </div>
      ) : (<>
      <div className="rfp-bar">
        <div className="rfp-t">
          <div className="rfp-name" title={nameOf(cur)}>{nameOf(cur)}</div>
          {(cur.from || many) && <div className="rfp-from">{cur.from}{cur.from && many ? " · " : ""}{many ? `${st.index + 1} of ${st.items.length}` : ""}</div>}
        </div>
        {many && <>
          <button type="button" className="rfp-btn ic" onClick={() => go(-1)} aria-label="Previous"><IconChevronLeft size={15} stroke={2} /></button>
          <button type="button" className="rfp-btn ic" onClick={() => go(1)} aria-label="Next"><IconChevronRight size={15} stroke={2} /></button>
        </>}
        {v.kind === "image" && <CopyBtn url={cur.url} />}
        <a className="rfp-btn" href={cur.url} target="_blank" rel="noreferrer">Open <IconExternalLink size={13} stroke={2} /></a>
        <button type="button" className="rfp-btn ic" onClick={() => setSt(null)} aria-label="Close"><IconX size={15} stroke={2} /></button>
      </div>
      <div className="rfp-body" key={cur.url}>
        {v.kind === "frame" && <iframe className={v.narrow ? "narrow" : ""} src={v.src} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen loading="lazy" title={nameOf(cur)} />}
        {v.kind === "pdf" && <iframe src={v.src} title={nameOf(cur)} />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {v.kind === "image" && <img src={v.src} alt={nameOf(cur)} onError={() => setFailed(cur.url)} onClick={() => setBig(true)} className="rfp-zoomable" title="Click to view full size" loading="lazy" decoding="async" />}
        {v.kind === "video" && <SoundVideo src={v.src} open loop={false} onError={() => setFailed(cur.url)} />}
        {v.kind === "download" && (
          <div className="rfp-msg">This file can&apos;t be previewed here.
            <a className="rfp-btn pri" href={cur.url} target="_blank" rel="noreferrer" download><IconDownload size={14} stroke={2} />Download</a>
          </div>
        )}
        {v.kind === "outside" && (
          <div className="rfp-msg">{failed === cur.url ? "This file couldn't be shown here." : "This website can't be shown inside the dashboard."}
            <a className="rfp-btn pri" href={cur.url} target="_blank" rel="noreferrer">Open in a new tab <IconExternalLink size={13} stroke={2} /></a>
          </div>
        )}
      </div>
      </>)}
      {stack && (
        <div className="rfp-body rfp-stack">
          {/* Slides first, numbered; the LinkedIn PDF after them under its own heading —
              it is the whole carousel as one document, not slide 1 or 11 (27 Oct). */}
          {stackSlides.map(({ it, i }, n) => {
            const iv = viewFor(it.url);
            return (
              <div key={it.url + i} className="rfp-si">
                {iv.kind === "image"
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={iv.src} alt={nameOf(it)} loading="lazy" className="rfp-zoomable" title="Click to view full size" onClick={() => openBig(i)} />
                  : <a className="rfp-sfile" href={it.url} target="_blank" rel="noreferrer">{nameOf(it)} <IconExternalLink size={12} stroke={2} /></a>}
                <div className="rfp-srow">
                  <div className="rfp-sname" title={nameOf(it)}>{n + 1}. {nameOf(it)}</div>
                  {iv.kind === "image" && <CopyBtn url={it.url} />}
                </div>
              </div>
            );
          })}
          {stackPdfs.length > 0 && (
            <div className="rfp-pdfhead"><b>LinkedIn PDF</b><span>For LinkedIn</span></div>
          )}
          {stackPdfs.map(({ it, i }) => (
            <div key={it.url + i} className="rfp-si rfp-pdf">
              <a className="rfp-sfile" href={it.url} target="_blank" rel="noreferrer">{nameOf(it)} <IconExternalLink size={12} stroke={2} /></a>
              <div className="rfp-srow"><div className="rfp-sname">The whole carousel as one document — not a slide.</div></div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

// Fixed to the right edge, above the task window (z above its overlay), so the task —
// brief included — stays readable on the left.
const CSS = `
.rfp{position:fixed;top:0;right:0;bottom:0;width:min(480px,100vw);z-index:310;display:flex;flex-direction:column;background:#F7F8FC;border-left:1px solid #E5E8F0;box-shadow:-12px 0 32px rgba(35,45,66,.12)}
.rfp.docked{bottom:auto;right:auto;box-shadow:none;border:1px solid #E5E8F0;border-radius:12px;overflow:hidden}
.rfp.docked .rfp-bar{flex-wrap:wrap;row-gap:8px}
.rfp.docked .rfp-t{flex-basis:100%}
.rfp.docked .rfp-body{padding:10px}
.rfp-zoomable{cursor:zoom-in}
.rfp-body.rfp-stack{flex-direction:column;justify-content:flex-start;align-items:stretch;gap:12px;overflow-x:hidden}
.rfp.docked .rfp-sbar{flex-wrap:nowrap}
.rfp.docked .rfp-sbar .rfp-t{flex:1;flex-basis:auto}
.rfp-si{min-width:0}
.rfp-pdfhead{display:flex;align-items:center;gap:6px;font-size:12px;color:#232D42;padding-top:8px;border-top:1px solid #EEF0F4}
.rfp-pdfhead b{font-weight:500}
.rfp-pdfhead span{font-size:10.5px;font-weight:500;border-radius:999px;padding:1px 7px;background:#E8F1FB;color:#0A66C2}
.rfp-pdf .rfp-sfile{border-color:#F3C9C3;background:#FDECEA;color:#C0392B}
.rfp-si img{width:100%;max-height:none;display:block;border:1px solid #EEF0F4;background:#fff}
.rfp-srow{display:flex;align-items:center;gap:6px;margin-top:4px}
.rfp-sname{flex:1;min-width:0;font-size:11.5px;color:#8A92A6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rfp-copy{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 9px;border-radius:8px;border:1px solid #E5E8F0;background:#fff;color:#3A57E8;font-size:12px;font-weight:500;cursor:pointer;flex-shrink:0}
.rfp-copy:hover{border-color:#3A57E8}
.rfp-copy.dark{height:34px;padding:0 14px;font-size:13px;border:none;background:#fff}
.rfp-big-copy{position:absolute;top:16px;left:50%;transform:translateX(-50%)}
.rfp-sfile{display:flex;align-items:center;gap:5px;padding:10px;border:1px solid #EEF0F4;border-radius:10px;background:#fff;color:#4A5468;font-size:12.5px;text-decoration:none;word-break:break-all}
[data-ref-open] .mh-prow{flex-direction:column;align-items:stretch}
[data-ref-open] .mh-plabel{width:auto;padding-bottom:6px}
/* The task window widens for the preview, so History keeps its full width. */
.hub-airtable:has([data-ref-open]){max-width:min(1500px,96vw)}
.rfp-big{position:fixed;inset:0;z-index:400;background:rgba(12,14,26,.86);display:flex;align-items:center;justify-content:center;padding:56px 72px;cursor:zoom-out}
.rfp-big img{max-width:100%;max-height:100%;width:auto;height:auto;border-radius:10px;background:#fff;cursor:default}
.rfp-big-nav{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:999px;border:none;background:rgba(255,255,255,.14);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer}
.rfp-big-nav:hover{background:rgba(255,255,255,.26)}
.rfp-big-nav.l{left:16px}.rfp-big-nav.r{right:16px}
.rfp-big-x{position:absolute;top:14px;right:16px;width:40px;height:40px;border-radius:999px;border:none;background:rgba(255,255,255,.14);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer}
.rfp-big-name{position:absolute;bottom:16px;left:0;right:0;text-align:center;color:#fff;font-size:13px;opacity:.85}
.rfp-bar{display:flex;align-items:center;gap:6px;padding:12px 14px;background:#fff;border-bottom:1px solid #EEF0F4}
.rfp-t{flex:1;min-width:0}
.rfp-name{font-size:13.5px;font-weight:500;color:#232D42;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rfp-from{font-size:11.5px;color:#8A92A6;margin-top:1px}
.rfp-btn{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px;border-radius:8px;border:1px solid #E5E8F0;background:#fff;color:#4A5468;font-size:12.5px;font-weight:500;text-decoration:none;cursor:pointer;white-space:nowrap}
.rfp-btn.ic{width:30px;padding:0;justify-content:center}
.rfp-btn:hover{border-color:#3A57E8;color:#3A57E8}
.rfp-btn.pri{background:#3A57E8;border-color:#3A57E8;color:#fff;margin-top:14px}
.rfp-btn.pri:hover{color:#fff;background:#2138B0}
.rfp-body{position:relative;flex:1;min-height:0;overflow:auto;padding:14px;display:flex;justify-content:center;align-items:flex-start}
.rfp-body iframe{width:100%;height:100%;min-height:560px;border:1px solid #EEF0F4;border-radius:12px;background:#fff}
.rfp-body iframe.narrow{max-width:420px}
.rfp-body img,.rfp-body video{max-width:100%;max-height:100%;border-radius:12px;background:#0b1020}
.rfp-msg{margin:auto;display:flex;flex-direction:column;align-items:center;text-align:center;color:#8A92A6;font-size:13.5px;max-width:300px;line-height:1.6}
html[data-theme="dark"] .rfp{background:#151824;border-left-color:#2C3246}
html[data-theme="dark"] .rfp-bar{background:#1F2332;border-bottom-color:#2C3246}
html[data-theme="dark"] .rfp-name{color:#E8EBF3}
html[data-theme="dark"] .rfp-btn{background:#1F2332;border-color:#2C3246;color:#C2C8D6}
html[data-theme="dark"] .rfp-body iframe{border-color:#2C3246}
`;
