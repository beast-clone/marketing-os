// Pop-up styles for NotificationHost. Kept in a plain module, NOT the "use client"
// component file: the preview layout that injects them is a server component, and
// a value exported from a client module reaches a server component as a client
// reference rather than the actual string — the CSS silently never applied.
export const NOTIF_CSS = `
.gc-nb{position:fixed;right:22px;bottom:76px;z-index:60;display:flex;align-items:flex-end;gap:14px;pointer-events:none}
.gc-nb>*{pointer-events:auto}
.gc-nb-fab{position:relative;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;color:#fff;display:grid;place-items:center;flex:none;
  background:linear-gradient(145deg,#4F6BEE,#2B45C9);box-shadow:0 10px 24px -8px rgba(58,87,232,.65);transform:scale(0);animation:gcNbPop .45s cubic-bezier(.2,1.4,.4,1) .1s forwards}
.gc-nb-bell{transform-origin:50% 4px;animation:gcNbRing 1.2s cubic-bezier(.36,.07,.19,.97) .55s 2}
.gc-nb-count{position:absolute;top:-4px;right:-4px;min-width:21px;height:21px;border-radius:11px;background:#E5484D;color:#fff;font-size:11px;font-weight:600;line-height:17px;text-align:center;padding:0 5px;border:2px solid #fff;transform:scale(0);animation:gcNbPop .4s cubic-bezier(.2,1.6,.4,1) .7s forwards}
.gc-nb-pulse{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(58,87,232,.45);opacity:0;animation:gcNbPulse 1.8s ease-out .6s 3}
.gc-nb-pulse.b{animation-delay:1.2s}
.gc-nb-panel{width:340px;max-width:calc(100vw - 110px);background:#fff;border:1px solid #E6E9F2;border-radius:16px;padding:15px 16px 16px;margin-bottom:2px;
  box-shadow:0 24px 48px -20px rgba(35,45,66,.35);opacity:0;transform:translateX(14px) scale(.97);transform-origin:right bottom;animation:gcNbSlide .45s cubic-bezier(.2,1.2,.35,1) 1.05s forwards}
.gc-nb-meta{font-size:12px;color:#8A92A6}
.gc-nb-title{font-size:14px;font-weight:600;color:#232D42;margin-top:2px}
.gc-nb-sub{font-size:13px;color:#4A5468;margin-top:2px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.gc-nb-more{font-size:12px;font-weight:500;color:#3A57E8;margin-top:8px}
.gc-nb-acts{display:flex;gap:8px;margin-top:12px}
.gc-nb-acts button{flex:1;height:34px;border-radius:9px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid #EEF0F5;background:#fff;color:#232D42}
.gc-nb-acts .gc-nb-go{background:#3A57E8;border-color:#3A57E8;color:#fff}
.gc-nb-acts .gc-nb-go:hover{background:#2138B0}
.gc-nb-acts .gc-nb-later:hover{border-color:#3A57E8;color:#3A57E8}
@keyframes gcNbPop{from{transform:scale(0)}to{transform:scale(1)}}
@keyframes gcNbRing{0%,100%{transform:rotate(0)}10%{transform:rotate(16deg)}20%{transform:rotate(-14deg)}30%{transform:rotate(10deg)}40%{transform:rotate(-8deg)}50%{transform:rotate(4deg)}60%{transform:rotate(0)}}
@keyframes gcNbPulse{0%{opacity:.8;transform:scale(1)}100%{opacity:0;transform:scale(1.9)}}
@keyframes gcNbSlide{to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.gc-nb-fab,.gc-nb-count,.gc-nb-panel{animation:none;transform:none;opacity:1}.gc-nb-bell,.gc-nb-pulse{animation:none}}
@media (max-width:560px){.gc-nb{right:12px;left:12px;justify-content:flex-end}.gc-nb-panel{max-width:none;flex:1}}
html[data-theme="dark"] .gc-nb-panel{background:var(--d-card);border-color:var(--d-line)}
html[data-theme="dark"] .gc-nb-title{color:var(--d-ink)}
html[data-theme="dark"] .gc-nb-sub,html[data-theme="dark"] .gc-nb-meta{color:var(--d-muted)}
html[data-theme="dark"] .gc-nb-acts .gc-nb-later{background:var(--d-raised);border-color:var(--d-line);color:var(--d-ink)}
html[data-theme="dark"] .gc-nb-count{border-color:var(--d-card)}
`;
