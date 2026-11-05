"use client";
import { useEffect, useState } from "react";
import { IconDownload, IconX } from "@tabler/icons-react";

// "Install Marketing OS" (3 Nov 2026): registers the service worker (public/sw.js) and,
// when Chrome or Edge say the app can be installed, shows a small card with an
// Install button. Nothing shows in Safari (it has no install prompt — Mac users there
// use File → Add to Dock), inside the installed app itself, or after "Not now".
const DISMISSED = "gc-install-dismissed";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export function InstallApp() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISSED) === "1"; } catch { /* private window */ }
    if (standalone || dismissed) return;
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as InstallEvent); };
    const onInstalled = () => setEvt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (!evt) return null;
  const install = async () => { await evt.prompt(); const { outcome } = await evt.userChoice; if (outcome === "accepted") setEvt(null); };
  const notNow = () => { try { localStorage.setItem(DISMISSED, "1"); } catch { /* fine */ } setEvt(null); };

  return (
    <div className="hinstall">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <button className="hinstall-x" onClick={notNow} aria-label="Not now" title="Not now"><IconX size={13} /></button>
      <div className="hinstall-row">
        <img src="/app-icon-192.png" alt="" loading="lazy" decoding="async" />
        <div>
          <b>Install Marketing OS</b>
          <span>Open it like an app — from your Dock or Start menu.</span>
        </div>
      </div>
      <button className="hinstall-go" onClick={install}><IconDownload size={14} stroke={2} />Install</button>
    </div>
  );
}

const CSS = `
.hinstall{position:relative;margin:14px 4px 0;padding:12px;border:1px solid var(--sb-line,#EEF0F4);border-radius:12px;background:var(--sb-brand-soft,#E9ECFB)}
.hinstall-row{display:flex;gap:10px;align-items:flex-start;padding-right:14px}
.hinstall-row img{width:32px;height:32px;border-radius:8px;flex:none;border:1px solid var(--sb-line,#EEF0F4)}
.hinstall-row b{display:block;font-size:.8rem;font-weight:500;color:var(--sb-ink,#232D42)}
.hinstall-row span{display:block;font-size:.72rem;color:var(--sb-ink-soft,#4A5468);line-height:1.35;margin-top:2px}
.hinstall-go{margin-top:10px;width:100%;display:flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:9px;padding:7px 0;background:var(--sb-brand,#3A57E8);color:#fff;font:500 .78rem Inter,system-ui,sans-serif;cursor:pointer}
.hinstall-go:hover{background:var(--sb-brand-ink,#2138B0)}
.hinstall-x{position:absolute;top:8px;right:8px;border:0;background:none;color:var(--sb-faint,#A6ACBE);cursor:pointer;padding:2px;line-height:0}
.hinstall-x:hover{color:var(--sb-ink,#232D42)}
body.nav-collapsed .hsidebar:not(.peek) .hinstall{display:none}
`;
