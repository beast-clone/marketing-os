// Pop-up styles for NotificationHost. Kept in a plain module, NOT the "use client"
// component file: the preview layout that injects them is a server component, and
// a value exported from a client module reaches a server component as a client
// reference rather than the actual string — the CSS silently never applied.
export const NOTIF_CSS = `
.gc-nb{position:fixed;z-index:70;width:360px;max-width:calc(100vw - 24px)}
.gc-nb-card{position:relative;background:#fff;border:1px solid #E6E9F2;border-radius:16px;padding:14px 16px 16px;box-shadow:0 24px 48px -20px rgba(35,45,66,.38),0 2px 6px rgba(35,45,66,.05);
  transform-origin:calc(100% - 22px) 0;opacity:0;transform:translateY(-8px) scale(.96);animation:gcNbDrop .42s cubic-bezier(.2,1.25,.35,1) .25s forwards}
/* the little caret that points up at the bell */
.gc-nb-card:before{content:"";position:absolute;top:-7px;right:18px;width:12px;height:12px;background:#fff;border-left:1px solid #E6E9F2;border-top:1px solid #E6E9F2;transform:rotate(45deg);border-radius:3px 0 0 0}
.gc-nb-head{display:flex;align-items:center;gap:9px;margin-bottom:6px}
.gc-nb-app{width:28px;height:28px;border-radius:8px;background:linear-gradient(145deg,#5C78F2,#2138B0);color:#fff;display:grid;place-items:center;font-size:13px;font-weight:600;flex:none}
.gc-nb-av{position:relative;width:32px;height:32px;border-radius:50%;background:linear-gradient(145deg,#F7B267,#E0732F);color:#fff;display:grid;place-items:center;font-size:13px;font-weight:600;flex:none;overflow:visible}
.gc-nb-av img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.gc-nb-av:after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid rgba(224,115,47,.55);opacity:0;animation:gcNbPulse 1.6s ease-out .6s 3}
.gc-nb-meta{font-size:12.5px;color:#8A92A6;min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gc-nb-meta b{font-weight:500;color:#4A5468}
.gc-nb-count{min-width:20px;height:20px;border-radius:10px;background:#E5484D;color:#fff;font-size:11px;font-weight:600;line-height:20px;text-align:center;padding:0 6px;flex:none}
.gc-nb-title{font-size:14px;font-weight:600;color:#232D42}
.gc-nb-sub{font-size:13px;color:#4A5468;margin-top:2px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.gc-nb-more{font-size:12px;font-weight:500;color:#3A57E8;margin-top:8px}
.gc-nb-acts{display:flex;gap:8px;margin-top:12px}
.gc-nb-acts button{flex:1;height:34px;border-radius:9px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid #EEF0F5;background:#fff;color:#232D42}
.gc-nb-acts .gc-nb-go{background:#3A57E8;border-color:#3A57E8;color:#fff}
.gc-nb-acts .gc-nb-go:hover{background:#2138B0}
.gc-nb-acts .gc-nb-later:hover{border-color:#3A57E8;color:#3A57E8}
/* several waiting: two cards peek out from under the front one */
.gc-nb-layer{position:absolute;left:0;right:0;bottom:0;height:60px;border-radius:16px;background:#F1F3FA;border:1px solid #E2E6F2;opacity:0}
.gc-nb-layer.l1{transform:translateY(9px) scale(.95);animation:gcNbLayer1 .42s cubic-bezier(.2,1.2,.35,1) .45s forwards}
.gc-nb-layer.l2{background:#E8ECF6;transform:translateY(18px) scale(.9);animation:gcNbLayer2 .42s cubic-bezier(.2,1.2,.35,1) .55s forwards}
/* the bell in the top bar rings and pulses */
[data-notif-bell]{position:relative}
[data-notif-bell].gc-nb-ringing svg{transform-origin:50% 3px;animation:gcNbRing 1.2s cubic-bezier(.36,.07,.19,.97) 2}
[data-notif-bell].gc-nb-ringing:after{content:"";position:absolute;inset:-3px;border-radius:12px;border:2px solid rgba(58,87,232,.5);opacity:0;animation:gcNbPulse 1.3s ease-out 2;pointer-events:none}
@keyframes gcNbDrop{to{opacity:1;transform:none}}
@keyframes gcNbLayer1{from{opacity:0;transform:translateY(-6px) scale(.95)}to{opacity:1;transform:translateY(9px) scale(.95)}}
@keyframes gcNbLayer2{from{opacity:0;transform:translateY(-6px) scale(.9)}to{opacity:1;transform:translateY(18px) scale(.9)}}
@keyframes gcNbRing{0%,100%{transform:rotate(0)}10%{transform:rotate(16deg)}20%{transform:rotate(-14deg)}30%{transform:rotate(10deg)}40%{transform:rotate(-8deg)}50%{transform:rotate(4deg)}60%{transform:rotate(0)}}
@keyframes gcNbPulse{0%{opacity:.8;transform:scale(1)}100%{opacity:0;transform:scale(1.35)}}
@media (prefers-reduced-motion:reduce){.gc-nb-card,.gc-nb-layer{animation:none;opacity:1}.gc-nb-card{transform:none}[data-notif-bell].gc-nb-ringing svg,[data-notif-bell].gc-nb-ringing:after,.gc-nb-av:after{animation:none}}
html[data-theme="dark"] .gc-nb-card,html[data-theme="dark"] .gc-nb-card:before{background:var(--d-card);border-color:var(--d-line)}
html[data-theme="dark"] .gc-nb-layer{background:var(--d-raised);border-color:var(--d-line)}
html[data-theme="dark"] .gc-nb-title{color:var(--d-ink)}
html[data-theme="dark"] .gc-nb-sub,html[data-theme="dark"] .gc-nb-meta,html[data-theme="dark"] .gc-nb-meta b{color:var(--d-muted)}
html[data-theme="dark"] .gc-nb-acts .gc-nb-later{background:var(--d-raised);border-color:var(--d-line);color:var(--d-ink)}
`;
