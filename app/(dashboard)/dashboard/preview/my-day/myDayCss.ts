// The My Day stylesheet, lifted out of PreviewMyDay so more than one screen can
// use it.
//
// Every rule is scoped under `.hmd` (the only exceptions are @media blocks whose
// contents are .hmd-scoped, @keyframes named hmd*, and the dark-theme override,
// which is also .hmd-scoped). Nothing here can style anything outside a .hmd
// element, so injecting it on a page that is not My Day is safe: the new-task
// form renders inside its own .hmd wrapper and picks up exactly the My Day look.
export const MY_DAY_CSS = `
.hmd{
  --bg:#F5F6FA;--panel:#FFFFFF;--panel-2:#F7F8FC;
  --ink:#232D42;--ink-soft:#4A5468;--muted:#8A92A6;--faint:#A6ACBE;
  --line:#EEF0F4;--line-2:#F3F5F9;
  --brand:#3A57E8;--brand-soft:#E9ECFB;--brand-ink:#2138B0;
  --brand-rgb:58 87 232;--brand-dark-rgb:33 56 176;--brand-light-rgb:233 236 251;
  --good:#1AA053;--good-soft:#E3F5EA;--warn:#D97706;--warn-soft:#FEF3E2;--rose:#E11D48;
  --shadow:0 10px 30px rgba(35,45,66,0.06);
  --cD9DEEA:#D9DEEA;--cEAEDF5:#EAEDF5;--cDFE3EE:#DFE3EE;--cF3F5F9:#F3F5F9;--cE9ECF2:#E9ECF2;--cE3E6EE:#E3E6EE;--cEDEFF4:#EDEFF4;--cFDECEA:#FDECEA;--cFFF7F6:#FFF7F6;--cF1C4BD:#F1C4BD;--cEAA99F:#EAA99F;--cFCEBEA:#FCEBEA;--cE9ECFB:#E9ECFB;--cFAFBFF:#FAFBFF;--c232D42:#232D42;--cB9C2E0:#B9C2E0;--c3B4457:#3B4457;--cEEF1FD:#EEF1FD;--cFCEBEC:#FCEBEC;--cC0201F:#C0201F;--cF3C6CE:#F3C6CE;--cF9DADE:#F9DADE;--cD5DCF8:#D5DCF8;--cF3D9AE:#F3D9AE;--c8A5A00:#8A5A00;--cDCE1FA:#DCE1FA;--cC7CEDD:#C7CEDD;--cEEF1FB:#EEF1FB;--cFBE7E4:#FBE7E4;--cF3F1FE:#F3F1FE;--cF4C4C9:#F4C4C9;--cFEF3F4:#FEF3F4;--cF3DCB4:#F3DCB4;--c7A4E0B:#7A4E0B;--cBFE6CD:#BFE6CD;--c155E37:#155E37;--c5A3906:#5A3906;--c0E4A2A:#0E4A2A;--cEEF0F5:#EEF0F5;--c7A8296:#7A8296;--cFEF6F0:#FEF6F0;--cFEE9D6:#FEE9D6;--cD5DCFB:#D5DCFB;--c0F6E3C:#0F6E3C;--cB0203A:#B0203A;--cE7A9B3:#E7A9B3;--cCBD5FA:#CBD5FA;--cEDEEF2:#EDEEF2;--cCBD2E0:#CBD2E0;
  --mono:ui-monospace,"SF Mono",Menlo,monospace;
  color:var(--ink);background:var(--bg);min-height:100vh;font-size:14.5px;
}
.hmd *{box-sizing:border-box}
.hmd .shell{display:flex;align-items:stretch;min-height:100vh}
.hmd .sidebar{width:228px;flex-shrink:0;position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--panel);border-right:1px solid var(--line);padding:0 11px 16px}
@media(max-width:980px){.hmd .sidebar{display:none}}
.hmd .sidebar-brand{display:flex;align-items:center;gap:10px;padding:20px 8px 16px}
.hmd .sidebar-brand .logo{width:32px;height:32px;border-radius:9px;background:var(--brand);display:grid;place-items:center;color:#fff;transform:rotate(45deg);flex:0 0 32px}
.hmd .sidebar-brand .logo svg{color:#fff}
.hmd .sidebar-brand .brandname{font-weight:500;font-size:16px;color:var(--ink)}
.hmd .navgroup{font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:var(--faint);font-weight:500;padding:13px 10px 5px}
.hmd .navitem{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;font-size:14px;font-weight:500;color:var(--ink-soft);cursor:pointer;margin-bottom:1px;text-decoration:none}
.hmd .navitem:hover{background:var(--panel-2)}
.hmd .navitem.active{background:var(--brand);color:#fff;box-shadow:0 6px 14px rgba(58,87,232,.24)}
.hmd .main{flex:1;min-width:0;padding:clamp(.75rem,1.2vw,1.25rem);transition:padding-right .28s ease}
@media(min-width:1100px){.hmd .main.chatpad{padding-right:calc(clamp(296px,19vw,348px) + 1.6rem)}}
.hmd .banner{font-size:14px;color:var(--muted);margin:0;display:flex;gap:.6rem;flex-wrap:wrap;align-items:center}
.hmd .banner b{color:var(--ink-soft)}
.hmd .tagchg{font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--brand-ink);background:var(--brand-soft);border-radius:5px;padding:.15em .5em;font-weight:500}
.hmd .topbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:.55rem}
.hmd .icons{display:flex;align-items:center;gap:.5rem;position:relative}
.hmd .topdivider{width:1px;height:22px;background:var(--line);margin:0 .35rem;flex:none}
.hmd .iconbtn{position:relative;width:33px;height:33px;border-radius:10px;border:1px solid var(--line);background:var(--panel);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--ink-soft);box-shadow:var(--shadow);transition:all .12s}
.hmd .iconbtn:hover{border-color:var(--cD9DEEA);color:var(--brand-ink)}
.hmd .iconbtn.on{background:var(--brand-soft);border-color:var(--brand);color:var(--brand-ink)}
.hmd .iconbtn:disabled{opacity:.32;cursor:default;box-shadow:none}
.hmd .iconbtn:disabled:hover{border-color:var(--line);color:var(--ink-soft)}
.hmd .badge{position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:var(--brand);color:#fff;font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:center;border:2px solid var(--panel)}
.hmd .badge.rose{background:var(--rose)}
.hmd .backdrop{position:fixed;inset:0;z-index:30}
.hmd .popover{position:absolute;top:46px;right:0;width:300px;background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 46px rgba(20,22,40,.16);padding:.9rem;z-index:50}
.hmd .popover.pop-wide{width:340px}
.hmd .pop-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem}
.hmd .empty{font-size:14px;color:var(--muted);padding:.6rem 0;text-align:center}
.hmd .claim-row{display:flex;align-items:center;gap:.6rem;padding:.55rem .1rem;border-bottom:1px solid var(--line-2)}
.hmd .claim-row:last-child{border-bottom:0}
.hmd .claim-title{font-size:14px;font-weight:500;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hmd .claim-meta{font-size:12px;color:var(--muted);margin-top:.1rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hmd .claim-row .btn{margin-left:auto;flex-shrink:0}
.hmd .task.just-claimed{border-color:var(--brand);box-shadow:0 0 0 2px var(--brand-soft)}
.hmd .card{background:var(--panel);border:1px solid var(--line);border-radius:4px;box-shadow:var(--shadow)}
.hmd .pad{padding:.75rem .9rem}
.hmd .muted{color:var(--muted)}
.hmd .lbl{font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);font-weight:500}
.hmd .pill{display:inline-flex;align-items:center;gap:.3em;font-size:12px;font-weight:500;padding:.16em .5em;border-radius:6px;white-space:nowrap}
.hmd .dot{width:8px;height:8px;border-radius:3px;display:inline-block}
.hmd .btn{display:inline-flex;align-items:center;justify-content:center;gap:.35em;white-space:nowrap;font-size:14px;font-weight:500;border-radius:9px;padding:.5em .9em;border:1px solid var(--line);background:var(--panel);color:var(--ink-soft);cursor:pointer;transition:all .12s}
.hmd .btn:hover{border-color:var(--cD9DEEA)}
.hmd .btn.primary{background:var(--brand);color:#fff;border-color:transparent;box-shadow:0 6px 14px rgba(58,87,232,.24)}
.hmd .btn.primary:hover{background:var(--brand-ink)}
.hmd .btn.sm{font-size:12px;padding:.35em .7em}
.hmd .headband{display:grid;grid-template-columns:1.1fr auto 1.6fr;gap:.9rem;align-items:center}
@media(max-width:900px){.hmd .headband{grid-template-columns:1fr;gap:.9rem}}
/* Day control (Start day + Pipeline) sits WITH the stats — clear gap between. */
.hmd .stats-wrap{display:flex;align-items:center;justify-content:flex-end;gap:1.6rem;flex-wrap:wrap}
.hmd .dayctl{display:flex;align-items:center;gap:.5rem;padding-right:1.2rem;border-right:1px solid var(--line)}
@media(max-width:900px){.hmd .dayctl{border-right:none;padding-right:0}}
.hmd .who .hi{font-size:1.25rem;font-weight:500;letter-spacing:-.01em;line-height:1.2}
.hmd .who .sub{font-size:14px;color:var(--muted);margin-top:.2rem}
.hmd .switch{display:inline-flex;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:.2rem;gap:.15rem}
.hmd .switch button{border:0;background:transparent;font:inherit;font-size:12px;font-weight:500;color:var(--muted);padding:.32em .7em;border-radius:7px;cursor:pointer}
.hmd .switch button.on{background:var(--panel);color:var(--brand-ink);box-shadow:var(--shadow)}
.hmd .stats{display:flex;gap:1.4rem;justify-content:flex-end;flex-wrap:wrap}
@media(max-width:900px){.hmd .stats{justify-content:flex-start}}
.hmd .stat .n{font-size:1.15rem;font-weight:500;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1}
.hmd .stat .n.g{color:var(--good)}.hmd .stat .n.w{color:var(--warn)}.hmd .stat .n.b{color:var(--brand)}
.hmd .stat .k{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:.1rem}
.hmd .hero{margin-top:.6rem}
.hmd .hero-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:.45rem}
.hmd .hero-head h2{margin:0;font-size:14.5px}
.hmd .hero-head .prog{font-size:12px;color:var(--muted)}
.hmd .qmark{cursor:help;font-size:12px;border:1px solid var(--line);border-radius:50%;width:17px;height:17px;display:inline-flex;align-items:center;justify-content:center;color:var(--muted)}
.hmd .legend{display:flex;gap:.8rem;font-size:12px;color:var(--muted);align-items:center}
.hmd .legend span{display:inline-flex;gap:.3em;align-items:center}
.hmd .timeline{display:flex;gap:.4rem;height:74px}
.hmd .blk{flex:1;border-radius:10px;padding:.5rem .6rem;font-size:12px;color:#fff;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}
.hmd .blk .t{font-weight:500;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hmd .blk .m{font-size:12px;opacity:.85}
.hmd .blk.reel{background:linear-gradient(135deg,#5A6FF0,#3A57E8)}
.hmd .blk.reel2{background:linear-gradient(135deg,#7385F2,#4C63E8)}
.hmd .blk.gap{background:repeating-linear-gradient(45deg,var(--panel-2),var(--panel-2) 6px,var(--line-2) 6px,var(--line-2) 12px);color:var(--muted);border:1px dashed var(--line);flex:.5}
.hmd .blk.clickable{cursor:pointer;transition:transform .12s,box-shadow .12s}
.hmd .blk.clickable:hover{transform:translateY(-2px);box-shadow:0 8px 18px rgba(58,87,232,.28)}
.hmd .hours{display:flex;gap:.4rem;margin-top:.25rem}
.hmd .hours span{flex:1;font-size:12px;color:var(--faint);font-family:var(--mono)}
.hmd .hours span.g{flex:.5}
/* time-proportional timeline with drag-reorder + red now-line */
.hmd .tl-wrap{margin-top:0}
.hmd .tl-ticks{display:flex;margin-bottom:.2rem;padding:0 1px}
.hmd .tl-ticks span{flex:1;font-size:12px;color:var(--faint);font-family:var(--mono)}
.hmd .tl-track{position:relative;height:58px;border-radius:11px;border:1px solid var(--line);background:var(--panel-2);overflow:hidden}
.hmd .tl-blk{position:absolute;top:0;height:100%;border-radius:0;padding:.35rem .6rem;overflow:hidden;display:flex;flex-direction:column;justify-content:center;color:#fff;font-size:12px;transition:filter .12s;border-right:1px solid rgba(255,255,255,.16)}
/* Time added after planning: a small solid badge on the block's right edge. Amber
   on blue so it is obviously not part of the original plan, and small enough that the
   task name underneath stays readable. */
/* Keep the title clear of the badge instead of letting it run underneath. */
.hmd .tl-blk.has-ext .tl-t,.hmd .tl-blk.has-ext .tl-m{padding-right:52px}
.hmd .tl-ext{position:absolute;top:50%;right:5px;transform:translateY(-50%);z-index:2;pointer-events:none;
  background:#FFC24D;color:#4A3000;border:1px solid rgba(255,255,255,.65);border-radius:6px;
  font-size:11px;font-weight:500;line-height:1;padding:.22em .42em;white-space:nowrap;font-variant-numeric:tabular-nums;
  box-shadow:0 1px 2px rgba(20,22,40,.22)}
.hmd .tl-blk:last-child{border-right:0}
.hmd .tl-blk.reel{background:linear-gradient(135deg,#5A6FF0,#3A57E8);cursor:grab}
.hmd .tl-blk.reel:hover{filter:brightness(1.05)}
.hmd .tl-blk.reel:active{cursor:grabbing}
.hmd .tl-blk.reel.high{background:linear-gradient(135deg,#F4565B,#E11D48)}
.hmd .tl-blk.reel.high:hover{filter:brightness(1.06)}
.hmd .tl-blk.lunch{background:repeating-linear-gradient(45deg,var(--cEAEDF5),var(--cEAEDF5) 6px,var(--cDFE3EE) 6px,var(--cDFE3EE) 12px);color:var(--muted);border-right:1px solid rgba(255,255,255,.5)}
/* Work done earlier today: greyed out, before the now line; click opens it. */
.hmd .tl-blk.done{background:var(--cDFE3EE);color:var(--muted);cursor:pointer;border-right:1px solid rgba(255,255,255,.7)}
.hmd .tl-blk.done:hover{filter:brightness(.96)}
.hmd .tl-blk.buffer{background:repeating-linear-gradient(45deg,var(--cF3F5F9),var(--cF3F5F9) 6px,var(--cE9ECF2) 6px,var(--cE9ECF2) 12px);color:var(--faint)}
/* Samvaya / other-platform work — a distinct teal so it never reads as GooCampus work. */
.hmd .tl-blk.reel.samvaya{background:linear-gradient(135deg,#12B3A6,#0E8E86)}
.hmd .tl-blk.reel.samvaya:hover{filter:brightness(1.06)}
.hmd .tl-tag{display:inline-block;background:rgba(255,255,255,.24);font-size:12px;font-weight:500;letter-spacing:.03em;padding:1px 5px;border-radius:5px;margin-right:.35rem;vertical-align:middle;text-transform:uppercase}
.hmd .tl-t{font-weight:500;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hmd .tl-m{font-size:12px;opacity:.85;margin-top:.1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hmd .tl-nudge{position:absolute;top:50%;transform:translateY(-50%);width:18px;height:40px;border:none;border-radius:6px;background:rgba(255,255,255,.26);color:#fff;font-size:16px;line-height:1;cursor:pointer;opacity:0;transition:opacity .12s;display:flex;align-items:center;justify-content:center;z-index:3;padding:0}
.hmd .tl-blk.reel:hover .tl-nudge{opacity:1}
.hmd .tl-nudge:hover{background:rgba(255,255,255,.5)}
.hmd .tl-nudge.l{left:3px}
.hmd .tl-nudge.r{right:3px}
.hmd .now-line{position:absolute;top:0;bottom:0;width:2px;background:#DC2E2E;z-index:5;pointer-events:none}
.hmd .now-dot{position:absolute;top:3px;left:-3px;width:8px;height:8px;border-radius:50%;background:#DC2E2E}
.hmd .now-tag{position:absolute;top:2px;left:4px;background:#DC2E2E;color:#fff;font-size:12px;font-weight:500;letter-spacing:.03em;padding:1px 5px;border-radius:5px;white-space:nowrap;z-index:6;pointer-events:none}
.hmd .tl-guide{position:absolute;top:0;bottom:0;width:2px;background:#3A57E8;z-index:8;pointer-events:none;box-shadow:0 0 0 1px rgba(58,87,232,.25)}
.hmd .tl-guide-tag{position:absolute;top:4px;left:4px;background:#3A57E8;color:#fff;font-size:12px;font-weight:500;padding:2px 6px;border-radius:6px;white-space:nowrap}
.hmd .work{display:grid;grid-template-columns:minmax(300px,.72fr) 2fr;gap:.75rem;margin-top:.6rem;align-items:stretch}
@media(max-width:980px){.hmd .work{grid-template-columns:1fr}}
/* The task-detail card scrolls INSIDE itself so a long brief/creatives list can
   never push the page into a mile of whitespace — My tasks stays visible. */
.hmd .work .detail{position:sticky;top:.8rem;max-height:calc(100vh - 1.6rem);overflow-y:auto}
.hmd .work .detail::-webkit-scrollbar{width:6px}
.hmd .work .detail::-webkit-scrollbar-thumb{background:var(--cE3E6EE);border-radius:3px}
.hmd .colhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem}
/* "Tasks I created" header: range picker + the status tabs, wrapping to their own
   line on a narrow card rather than crushing the heading. */
.hmd .created-head{gap:.75rem;flex-wrap:wrap;margin-bottom:.75rem}
/* Filter bar: its own line, with room between each control. */
.hmd .created-filters{display:flex;align-items:flex-end;gap:.9rem;flex-wrap:wrap;padding:.75rem .85rem;margin-bottom:.9rem;background:var(--panel-2);border:1px solid var(--line);border-radius:10px}
.hmd .created-f{display:flex;flex-direction:column;gap:.3rem;min-width:0}
.hmd .created-f-lbl{font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;color:var(--faint)}
.hmd .created-custom{flex-direction:row;align-items:center;gap:.4rem}
.hmd .created-custom .created-f-lbl{align-self:center}
.hmd .created-range{min-width:150px}
.hmd .created-type{min-width:170px}
.hmd .created-sbu{min-width:210px}
.hmd .created-unit{min-width:95px}
.hmd .created-amt{width:84px;padding:.38rem .5rem}
.hmd .created-clear{margin-left:auto;align-self:center}
.hmd .created-cap{font-size:12px;color:var(--warn);background:var(--warn-soft);border-radius:8px;padding:.4rem .6rem;margin-bottom:.6rem}
@media(max-width:760px){
  .hmd .created-filters{gap:.7rem}
  .hmd .created-f{flex:1 1 100%}
  .hmd .created-range,.hmd .created-type,.hmd .created-sbu{min-width:0;width:100%}
  .hmd .created-clear{margin-left:0;width:100%}
}
.hmd .colhead h3{margin:0;font-size:14.5px}
/* Left "My tasks" card fills the column height (mirrors the sticky detail) so the
   list uses the whole screen instead of a fixed 460px box with dead space below.
   The header + tabs stay pinned; only the list scrolls. */
.hmd .work > .card:not(.detail){position:sticky;top:.8rem;max-height:calc(100vh - 1.6rem);display:flex;flex-direction:column;overflow:visible;z-index:5}
.hmd .tasklist{display:flex;flex-direction:column;gap:.4rem;flex:1;min-height:0;overflow:auto}
.hmd .tasklist::-webkit-scrollbar{width:6px}
.hmd .tasklist::-webkit-scrollbar-thumb{background:var(--cE3E6EE);border-radius:3px}
/* View picker (prototype D, 22 Oct) — replaces the row of status pills. */
.hmd .vpick{position:relative;margin-bottom:.8rem}
.hmd .vpick-btn{width:100%;display:flex;align-items:center;gap:.5rem;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:.55rem .75rem;font:inherit;font-size:13px;color:var(--ink);cursor:pointer;text-align:left}
.hmd .vpick-btn:hover{border-color:#C9CEDA}
.hmd .vpick-btn b{font-weight:500}
.hmd .vpick-n{margin-left:auto;font-size:12px;color:var(--muted);font-weight:500}
.hmd .vpick-car{width:7px;height:7px;border-right:1.6px solid var(--muted);border-bottom:1.6px solid var(--muted);transform:rotate(45deg) translateY(-2px);margin-left:.5rem}
.hmd .vpick-menu{position:absolute;z-index:40;left:0;right:0;top:calc(100% + 5px);background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:.35rem;max-height:420px;overflow:auto}
.hmd .vpick-h{font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);padding:.5rem .6rem .25rem;font-weight:500}
.hmd .vpick-i{width:100%;display:flex;align-items:center;gap:.5rem;padding:.5rem .6rem;border-radius:8px;font:inherit;font-size:13px;color:var(--ink);background:none;border:none;cursor:pointer;text-align:left}
.hmd .vpick-i:hover{background:var(--panel-2)}
.hmd .vpick-i.on{background:var(--brand-soft);color:var(--brand-ink);font-weight:500}
.hmd .vpick-x{border:none;background:none;color:var(--faint);font-size:11px;cursor:pointer;padding:0 .2rem}
.hmd .vpick-x:hover{color:#C0392B}
.hmd .vpick-add{color:var(--brand-ink);font-weight:500;border-top:1px solid var(--line);border-radius:0 0 8px 8px;margin-top:.25rem}
.hmd .vpick-empty{font-size:12px;color:var(--muted);padding:.25rem .6rem .45rem}
.hmd .vpick-form{padding:.6rem .6rem .5rem;font-size:13px}
.hmd .vpick-form .lbl{display:block;margin:.55rem 0 .3rem}
.hmd .vpick-chips{display:flex;flex-wrap:wrap;gap:.3rem}
.hmd .vpick-chips button{font:inherit;font-size:12px;padding:.3rem .6rem;border-radius:99px;border:1px solid var(--line);background:var(--panel);color:var(--ink-soft);cursor:pointer}
.hmd .vpick-chips button.on{background:var(--brand);border-color:var(--brand);color:#fff}
.hmd .vpick-name{width:100%;font:inherit;font-size:13px;border:1px solid var(--line);border-radius:8px;padding:.45rem .6rem;background:var(--panel);color:var(--ink)}
.hmd .vpick-acts{display:flex;justify-content:flex-end;gap:.4rem;margin-top:.7rem}
.hmd .task-tabs{display:flex;gap:.25rem;background:var(--panel-2);border:1px solid var(--line);border-radius:9px;padding:.2rem;margin-bottom:.7rem}
.hmd .task-tab{flex:1;border:none;background:transparent;font:inherit;font-size:12px;font-weight:500;color:var(--muted);padding:.35em .3em;white-space:nowrap;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:.3rem}
.hmd .task-tab.on{background:var(--panel);color:var(--brand-ink);box-shadow:var(--shadow)}
.hmd .task-tab-n{font-size:12px;background:var(--cEDEFF4);color:var(--muted);border-radius:7px;padding:0 .35em;min-width:15px;text-align:center}
.hmd .task-tab.on .task-tab-n{background:var(--brand-soft);color:var(--brand-ink)}
.hmd .task{border:1px solid var(--line);border-radius:11px;padding:.6rem .7rem;cursor:pointer;background:var(--panel);transition:all .12s}
.hmd .task:hover{border-color:var(--cD9DEEA);background:var(--panel-2)}
.hmd .task.overdue{background:linear-gradient(180deg,var(--cFDECEA),var(--cFFF7F6));border-color:var(--cF1C4BD)}
.hmd .task.high{border-left:3px solid #E11D48}
.hmd .task.overdue:hover{border-color:var(--cEAA99F)}
.hmd .task.sel{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.hmd .task.overdue.sel{border-color:var(--brand)}
.hmd .task-top{display:flex;align-items:baseline;justify-content:space-between;gap:.5rem}
.hmd .av-xs{width:20px;height:20px;font-size:12px}
.hmd .profwrap{position:relative}
.hmd .profchip{display:inline-flex;align-items:center;gap:.4rem;height:34px;padding:0 .55rem 0 .35rem;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--ink-soft);cursor:pointer}
.hmd .profchip:hover,.hmd .profchip.on{border-color:var(--brand);color:var(--brand)}
.hmd .profchip .profname{font-size:12px;font-weight:500}
.hmd .profmenu{position:absolute;top:calc(100% + 6px);right:0;z-index:40;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:.4rem;min-width:190px;box-shadow:0 10px 28px rgba(23,43,77,.14)}
.hmd .profhead{display:flex;align-items:center;gap:.55rem;padding:.4rem .5rem .6rem;border-bottom:1px solid var(--line-2);margin-bottom:.35rem}
.hmd .profhead-n{font-size:14px;font-weight:500;color:var(--ink)}
.hmd .profhead-r{font-size:12px;color:var(--muted)}
.hmd .profitem{display:flex;align-items:center;gap:.5rem;width:100%;padding:.5rem .55rem;border:none;background:transparent;border-radius:8px;font-size:14px;color:#C03221;cursor:pointer;text-align:left}
.hmd .profitem:hover{background:var(--cFCEBEA)}
.hmd .logout-screen{position:fixed;inset:0;z-index:120;background:rgba(246,247,251,.86);backdrop-filter:blur(3px);display:grid;place-items:center}
.hmd .logout-card{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:2.4rem 2.6rem;text-align:center;max-width:380px;box-shadow:0 18px 50px rgba(23,43,77,.16)}
.hmd .logout-badge{display:inline-grid;place-items:center;width:52px;height:52px;border-radius:50%;background:var(--brand);color:#fff;font-size:1.1rem;font-weight:500;margin-bottom:1rem}
.hmd .logout-h{font-size:1.15rem;font-weight:500;color:var(--ink);margin-bottom:.4rem}
.hmd .logout-p{font-size:14px;color:var(--muted);line-height:1.55;margin-bottom:1.4rem}
.hmd .logout-card .btn{width:100%;justify-content:center}
.hmd .logout-note{font-size:12px;color:var(--faint);margin-top:.9rem}
.hmd .due-chip{display:inline-flex;align-items:center;gap:.25rem;font-size:12px;font-weight:500;color:var(--muted);flex-shrink:0;white-space:nowrap}
.hmd .due-chip svg{width:11px;height:11px;flex:none;opacity:.9}
.hmd .due-chip.od{color:#C03221}
.hmd .task .tt{font-weight:500;font-size:14px;line-height:1.25}
.hmd .task .mm{font-size:12px;color:var(--muted);margin:.2rem 0 .35rem}
/* One line for "Carousel · owned by Praveen" + the status pill, so each card is a
   row shorter and more tasks fit without scrolling. */
.hmd .task .task-row{display:flex;align-items:flex-start;gap:.6rem}
.hmd .task .task-main{flex:1;min-width:0}
.hmd .task .task-main .mm{margin:.15rem 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Dates and state, right-aligned in their own column so they line up row to row. */
.hmd .task .task-side{display:flex;flex-direction:column;align-items:flex-end;gap:.25rem;flex:none}
/* A quieter pill for the list — the status is context here, not the headline. */
.hmd .pill.xs{font-size:11px;font-weight:500;padding:.1em .42em;border-radius:5px}
.hmd .detail .d-title{font-size:1.1rem;font-weight:500;letter-spacing:-.01em}
.hmd .d-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}
.hmd .d-head-main{min-width:0}
.hmd .status-box{flex-shrink:0;text-align:right}
.hmd .status-box .mlbl{margin-bottom:.35rem}
/* task duration control (next to the status dropdown) */
.hmd .dur-ctl{display:inline-flex;align-items:center;gap:.3rem;margin-top:.5rem;margin-left:.5rem;border:1px solid var(--line);border-radius:8px;padding:.25rem .4rem;background:var(--panel-2)}
.hmd .dur-ic{font-size:14px}
.hmd .dur-select{border:none;background:transparent;font:inherit;font-size:12px;font-weight:500;color:var(--ink-soft);cursor:pointer;outline:none}
/* claim-pool modal + claim-pool button badge */
.hmd .teamcap-n{background:var(--brand);color:#fff;font-size:12px;font-weight:500;border-radius:8px;min-width:16px;height:16px;padding:0 4px;display:inline-flex;align-items:center;justify-content:center;margin-left:.1rem}
.hmd .claim-list{display:flex;flex-direction:column;gap:.5rem;max-height:52vh;overflow:auto}
.hmd .claim-card{display:flex;align-items:center;gap:.7rem;border:1px solid var(--line);border-radius:11px;padding:.7rem .85rem}
.hmd .claim-card:hover{border-color:var(--cD9DEEA);background:var(--panel-2)}
.hmd .claim-card .btn{margin-left:auto;flex-shrink:0}
/* "Move one of his not-started tasks" rows. The title is the only elastic part, and
   the action pair is a FIXED width pushed to the right edge — so the buttons and date
   fields line up in two straight columns however long the task names are. */
.hmd .claim-card.move-row{gap:.85rem}
.hmd .claim-card.move-row .move-main{flex:1;min-width:0}
.hmd .claim-card.move-row .move-act{display:flex;align-items:center;gap:.45rem;margin-left:auto;flex-shrink:0}
.hmd .claim-card.move-row .move-act .btn{margin-left:0;width:150px;text-align:center;justify-content:center}
.hmd .claim-card.move-row .move-act .nt-input{width:148px;padding:.3rem .5rem;flex:none}
@media(max-width:620px){
  .hmd .claim-card.move-row{flex-wrap:wrap}
  .hmd .claim-card.move-row .move-main{flex:1 1 100%}
  .hmd .claim-card.move-row .move-act{margin-left:0;width:100%}
  .hmd .claim-card.move-row .move-act .btn,.hmd .claim-card.move-row .move-act .nt-input{flex:1 1 0;width:auto}
}
.hmd .apprstrip{width:100%;margin-top:1rem;display:flex;align-items:center;justify-content:space-between;gap:.8rem;border:1px solid var(--cE9ECFB);border-left:3px solid var(--brand);background:var(--panel);border-radius:12px;padding:.7rem .95rem;cursor:pointer;transition:all .12s;text-align:left}
.hmd .apprstrip:hover{background:var(--cFAFBFF);border-color:var(--cD9DEEA)}
.hmd .apprstrip-l{display:flex;align-items:center;gap:.55rem;color:var(--c232D42);font-size:14px}
.hmd .apprstrip-l b{font-weight:500}
.hmd .apprstrip-l svg{color:var(--brand);flex-shrink:0}
.hmd .apprstrip-cta{display:inline-flex;align-items:center;gap:.3rem;color:var(--brand);font-weight:500;font-size:12px;flex-shrink:0}

/* Yesterday's radar, one line. Deliberately lighter than .apprstrip — an approval is
   waiting ON you, where this is a thing that already happened. The only colour is one
   dot; the bordered-banner version of this was rejected for shouting. */
.hmd .rcrumb-wrap{margin-top:1rem}
.hmd .rcrumb{width:100%;display:flex;align-items:center;gap:.55rem;background:var(--panel);
  border:1px solid var(--line);border-radius:11px;padding:.62rem 1rem;text-align:left;
  font:inherit;cursor:pointer;transition:border-color .12s;margin-top:1rem}
.hmd .rcrumb-wrap .rcrumb{margin-top:0}
.hmd .rcrumb:hover{border-color:var(--cD9DEEA)}
.hmd .rcrumb.open{border-radius:11px 11px 0 0;border-bottom-color:transparent}
.hmd .rcrumb-dot{width:7px;height:7px;border-radius:50%;background:#C03221;flex:none}
.hmd .rcrumb-dot.ok{background:#1AA053}
.hmd .rcrumb-txt{flex:1;font-size:13.8px;color:var(--c232D42)}
.hmd .rcrumb-txt b{font-weight:500}
.hmd .rcrumb-sep{color:var(--faint);font-size:13px}
.hmd .rcrumb-when{font-size:12.5px;color:var(--faint)}
.hmd .rcrumb-chev{color:var(--muted);font-size:12px;transition:transform .15s}
.hmd .rcrumb.open .rcrumb-chev{transform:rotate(90deg)}
.hmd .rcrumb-list{padding:0 0 .45rem 1.05rem;border-bottom:1px solid var(--line-2)}
/* width:0 + flex-basis 0 so a long title truncates instead of widening the whole page */
.hmd .rcrumb-list .rcrumb-t{flex:1 1 0;width:0}
.hmd .rcrumb-drop{background:var(--panel);border:1px solid var(--line);border-top:0;
  border-radius:0 0 11px 11px;padding:.1rem 1rem .75rem}
.hmd .rcrumb-item{display:flex;align-items:baseline;gap:.7rem;padding:.5rem 0;
  border-top:1px solid var(--line-2);font-size:14px}
.hmd .rcrumb-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--c232D42)}
.hmd .rcrumb-src{font-size:12px;color:var(--faint);white-space:nowrap}
.hmd .rcrumb-write{font-size:13px;font-weight:500;color:var(--brand);white-space:nowrap;text-decoration:none}
.hmd .rcrumb-write:hover{text-decoration:underline}
.hmd .rcrumb-foot{padding-top:.6rem;margin-top:.15rem;border-top:1px solid var(--line-2);
  font-size:12.5px;color:var(--faint)}
.hmd .rcrumb-foot a{color:var(--brand);text-decoration:none}
.hmd .appr-card{display:flex;flex-direction:column;gap:.4rem;border:1px solid var(--line);border-radius:11px;padding:.8rem .9rem}
.hmd .appr-head{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.hmd .appr-title{font-size:14px;font-weight:500;color:var(--c232D42);text-decoration:none;border-bottom:1px dashed var(--cB9C2E0)}
.hmd .appr-title:hover{color:var(--brand)}
.hmd .appr-type{font-size:12px;background:var(--panel-2);color:var(--c3B4457);border-radius:99px;padding:1px 8px;font-weight:500}
.hmd .appr-move{font-size:14px;color:var(--c232D42);display:flex;align-items:center;gap:.35rem}
.hmd .appr-move svg{color:var(--brand)}
.hmd .appr-move .to{color:var(--brand)}
.hmd .appr-move .arw{color:#8A92A6}
.hmd .appr-meta{font-size:12px;color:#8A92A6;line-height:1.55}
.hmd .appr-meta b{color:var(--c3B4457);font-weight:500}
.hmd .appr-reason{font-size:12px;color:var(--c3B4457);background:var(--cFAFBFF);border:1px solid var(--cEEF1FD);border-radius:8px;padding:.4rem .6rem}
.hmd .appr-reason .muted{color:#8A92A6}
.hmd .appr-actions{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.15rem}
.hmd .status-dot{width:8px;height:8px;border-radius:50%;flex:0 0 8px}
.hmd .status-caret{position:absolute;right:.65rem;top:50%;width:0;height:0;margin-top:-2px;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;pointer-events:none}
.hmd .status-dd{position:relative;display:inline-block}
.hmd .status-dd-btn{position:relative;display:inline-flex;align-items:center;gap:.45rem;border:1px solid rgba(35,45,66,.08);border-radius:9px;padding:.42rem 1.55rem .42rem .65rem;font:inherit;font-size:14px;font-weight:500;cursor:pointer}
.hmd .status-dd-val{white-space:nowrap}
.hmd .status-dd-back{position:fixed;inset:0;z-index:40}
.hmd .status-dd-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:50;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:0 18px 46px rgba(20,22,40,.16);padding:.35rem;min-width:238px;max-height:344px;overflow:auto}
.hmd .status-dd-item{display:flex;align-items:center;gap:.55rem;width:100%;text-align:left;border:none;background:transparent;font:inherit;font-size:14px;font-weight:500;color:var(--ink);padding:.5rem .6rem;border-radius:8px;cursor:pointer}
.hmd .status-dd-item:hover{background:var(--panel-2)}
.hmd .status-dd-item.on{font-weight:500;background:var(--panel-2)}
.hmd .status-dd-item-lbl{flex:1;white-space:nowrap}
.hmd .status-dd-check{color:var(--brand);font-weight:800}
/* header capsule row — In Progress · duration · live countdown, all equal height */
.hmd .status-row{display:flex;align-items:center;justify-content:flex-end;gap:.4rem;flex-wrap:wrap}
.hmd .cap,.hmd .status-dd-btn,.hmd .ui-dd-btn,.hmd .cap-timer{height:32px;box-sizing:border-box}
.hmd .status-box .pill.cap{display:inline-flex;align-items:center}
/* generic themed dropdown — swaps the off-brand native <select> everywhere */
.hmd .ui-dd{position:relative;display:inline-block}
.hmd .ui-dd.wide{display:block;width:100%}
.hmd .ui-dd-btn{position:relative;display:inline-flex;align-items:center;gap:.4rem;border:1px solid var(--line);border-radius:9px;background:var(--panel);padding:.42rem 1.55rem .42rem .7rem;font:inherit;font-size:14px;font-weight:500;color:var(--ink-soft);cursor:pointer}
.hmd .ui-dd.wide .ui-dd-btn{width:100%;justify-content:flex-start}
.hmd .ui-dd-btn:hover{border-color:var(--brand)}
.hmd .ui-dd-val{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hmd .ui-dd-ic{font-size:14px;line-height:1}
.hmd .ui-dd-caret{position:absolute;right:.6rem;top:50%;width:0;height:0;margin-top:-2px;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--faint);pointer-events:none}
.hmd .ui-dd-back{position:fixed;inset:0;z-index:40}
.hmd .ui-dd-menu{position:absolute;top:calc(100% + 6px);z-index:50;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:0 18px 46px rgba(20,22,40,.16);padding:.35rem;min-width:180px;max-height:300px;overflow:auto}
.hmd .ui-dd-item{display:flex;align-items:center;gap:.55rem;width:100%;text-align:left;border:none;background:transparent;font:inherit;font-size:14px;font-weight:500;color:var(--ink);padding:.5rem .6rem;border-radius:8px;cursor:pointer}
.hmd .ui-dd-item:hover{background:var(--panel-2)}
.hmd .ui-dd-item.on{font-weight:500;background:var(--panel-2)}
.hmd .ui-dd-item-lbl{flex:1;white-space:nowrap}
.hmd .ui-dd-check{color:var(--brand);font-weight:800}
/* live countdown capsule in the task header (brand → amber when over) */
.hmd .sw-btn{display:inline-flex;align-items:center;gap:.35rem;border-radius:9px;padding:0 .8rem;font-size:14px;font-weight:500;white-space:nowrap;cursor:pointer;border:1px solid transparent}
.hmd .sw-btn.start{background:var(--brand);color:#fff}
.hmd .sw-btn.start:hover{background:#2138B0}
.hmd .sw-btn.stop{background:var(--cFCEBEC);color:var(--cC0201F);border-color:var(--cF3C6CE)}
.hmd .sw-btn.stop:hover{background:var(--cF9DADE)}
/* Cancel is the quiet one of the three: it undoes a mistake, it isn't a step forward. */
.hmd .sw-btn.cancel{background:var(--panel);color:var(--muted);border-color:var(--line)}
.hmd .sw-btn.cancel:hover{background:var(--panel-2);color:var(--ink-soft);border-color:var(--cD9DEEA)}
/* The planned time while the clock runs: shown, not editable. */
.hmd .dur-locked{display:inline-flex;align-items:center;gap:.35rem;background:var(--panel-2);border:1px solid var(--line);color:var(--muted);border-radius:9px;padding:0 .7rem;font-size:13px;font-weight:500;white-space:nowrap;cursor:default}
.hmd .cap-timer{display:inline-flex;align-items:center;border:1px solid var(--cD5DCF8);border-radius:9px;background:var(--brand-soft);color:var(--brand-ink);padding:0 .7rem;font-size:14px;font-weight:500;white-space:nowrap}
.hmd .cap-timer.over{background:var(--warn-soft);border-color:var(--cF3D9AE);color:var(--c8A5A00)}
.hmd .collab-cell{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
/* Each collaborator is its own chip so it can carry a remove control. The × only
   shows on hover/focus, keeping the row calm when you are just reading it. */
.hmd .collab-chip{display:inline-flex;align-items:center;gap:.3rem;padding:.1rem .1rem .1rem 0;border-radius:999px}
.hmd .collab-del{border:0;background:transparent;color:var(--faint);cursor:pointer;font-size:15px;line-height:1;padding:0 .2rem;border-radius:999px;opacity:0;transition:opacity .12s,color .12s,background .12s}
.hmd .collab-chip:hover .collab-del,.hmd .collab-del:focus-visible{opacity:1}
.hmd .collab-del:hover{color:#C03221;background:rgba(192,50,33,.1)}
.hmd .collab-del:disabled{cursor:default;opacity:.35}
.hmd .detail .d-sub{font-size:12px;color:var(--muted);margin-top:.3rem}
.hmd .detail .d-meta{font-size:12px;color:var(--muted);margin:.25rem 0 .8rem;display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
.hmd .meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.9rem;padding:.8rem 0;border-top:1px solid var(--line-2)}
.hmd .mlbl{font-size:12px;color:var(--faint);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.35rem;font-weight:500}
.hmd .mval{font-size:14px;color:var(--ink-soft);font-weight:500}
.hmd .collab{display:flex;align-items:center;gap:.4rem;margin-top:.9rem;flex-wrap:wrap}
.hmd .collab .mlbl{margin:0 .3rem 0 0}
.hmd .av-sm{width:24px;height:24px;font-size:12px}
.hmd .collab-names{font-size:12px;color:var(--ink-soft);margin-left:.3rem}
.hmd .collab-add{width:24px;height:24px;border-radius:50%;border:1px dashed var(--line);background:transparent;color:var(--muted);font-size:16px;line-height:1;display:grid;place-items:center;cursor:pointer;flex:none}
.hmd .collab-add:hover{border-color:var(--brand);color:var(--brand);border-style:solid}
.hmd .collab-add:disabled{opacity:.4;cursor:default}
.hmd .collab-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:20;background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:.3rem;min-width:150px;box-shadow:0 6px 20px rgba(23,43,77,.12)}
.hmd .collab-opt{display:flex;align-items:center;gap:.45rem;width:100%;padding:.4rem .5rem;border:none;background:transparent;border-radius:8px;font-size:14px;color:var(--ink-soft);cursor:pointer;text-align:left}
.hmd .collab-opt:hover{background:var(--panel-2)}
.hmd .collab-opt:disabled{opacity:.5;cursor:default}
.hmd .section-lbl{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;font-weight:500;margin:1.15rem 0 .5rem}
.hmd .brief{background:var(--panel-2);border:1px solid var(--line);border-radius:11px;padding:.8rem .9rem;font-size:14px;color:var(--ink-soft);line-height:1.6}
.hmd .brief-full{white-space:pre-wrap;word-break:break-word}
.hmd .section-head{display:flex;align-items:center;justify-content:space-between;margin:1.15rem 0 .5rem}
.hmd .section-head .section-lbl{margin:0}
.hmd .copy-btn{font-size:12px;font-weight:500;color:var(--brand-ink);background:var(--brand-soft);border:1px solid transparent;border-radius:7px;padding:.3em .65em;cursor:pointer;transition:background .12s}
.hmd .copy-btn:hover{background:var(--cDCE1FA)}
.hmd .brief .para{margin:0 0 .7rem}
.hmd .brief .para:last-child{margin-bottom:0}
.hmd .thumbs{display:flex;flex-wrap:wrap;gap:.7rem;align-items:flex-start}
.hmd .thumb{width:104px;cursor:pointer}
.hmd .thumb-img{position:relative;width:104px;height:132px;border-radius:10px;border:1px solid var(--line);overflow:hidden;display:flex;align-items:center;justify-content:center;transition:transform .12s,box-shadow .12s}
.hmd .thumb:hover .thumb-img{transform:translateY(-2px);box-shadow:0 8px 18px rgba(20,22,40,.16)}
.hmd .thumb-play{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.92);color:var(--c232D42);display:flex;align-items:center;justify-content:center;font-size:12px;padding-left:3px}
.hmd .thumb-doc{font-size:1.6rem}
.hmd .thumb-name{font-size:12px;color:var(--ink-soft);margin-top:.35rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.hmd .thumb-add{width:104px;height:132px;border:1.5px dashed var(--cC7CEDD);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.15rem;color:var(--muted);cursor:pointer;background:var(--panel-2);transition:all .12s}
.hmd .thumb-add:hover{border-color:var(--brand);color:var(--brand-ink)}
.hmd .thumb-add-plus{font-size:1.25rem;line-height:1}
.hmd .thumb-add-lbl{font-size:12px;font-weight:500}
.hmd .upload-drop{display:flex;align-items:center;gap:.7rem;border:1px dashed var(--cC7CEDD);border-radius:4px;padding:.55rem .75rem;cursor:pointer;background:var(--panel-2);transition:border-color .12s}
.hmd .upload-drop:hover{border-color:var(--brand)}
.hmd .fld-pen{margin-left:.35rem;border:1px solid var(--line);background:var(--panel);border-radius:4px;padding:1px 3px;cursor:pointer;color:var(--muted);vertical-align:middle;line-height:0}
.hmd .fld-pen:hover{border-color:var(--brand);color:var(--brand)}
.hmd .fld-hint{margin-left:.3rem;color:var(--brand);font-weight:500}
.hmd .fld-edit{display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.35rem;padding:.4rem;border:1px solid var(--line);border-radius:4px;background:var(--panel-2)}
.hmd .fld-dd{position:absolute;z-index:30;margin-top:.3rem;min-width:150px;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:4px;box-shadow:0 12px 32px rgba(35,45,66,.16);overflow:hidden}
.hmd .fld-dd-item{display:flex;align-items:center;gap:.4rem;border:none;background:none;padding:.4rem .55rem;cursor:pointer;text-align:left;font:inherit}
.hmd .fld-dd-item:hover{background:var(--panel-2)}
.hmd .fld-dd-item.on{background:var(--cEEF1FB)}
.hmd .upload-ic{font-size:1rem;color:var(--muted)}
.hmd .upload-drop b{color:var(--ink);font-size:14px}
.hmd .upload-sub{display:block;font-size:12px;color:var(--muted);margin-top:.15rem}
.hmd .thumb-img.clk{cursor:zoom-in}
.hmd .thumb-img.clk:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(35,45,66,.12)}
/* creative preview overlay */
.hmd .cv-bg{position:fixed;inset:0;z-index:80;background:rgba(12,14,26,.72);display:flex;align-items:center;justify-content:center;padding:2rem}
.hmd .cv-box{position:relative;max-width:min(560px,92vw);width:100%}
.hmd .cv-x{position:absolute;top:-34px;right:0;border:none;background:none;color:#fff;font-size:1.8rem;line-height:1;cursor:pointer;opacity:.85}
.hmd .cv-x:hover{opacity:1}
.hmd .cv-stage{position:relative;background:#0F1222;border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center;max-height:74vh;width:fit-content;max-width:100%;margin:0 auto}
.hmd .cv-el{width:auto;max-width:100%;max-height:74vh;object-fit:contain;display:block}
.hmd .cv-nav{position:absolute;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;border:none;font-size:1.3rem;display:flex;align-items:center;justify-content:center;cursor:pointer;line-height:1}
.hmd .cv-nav.prev{left:10px}.hmd .cv-nav.next{right:10px}
.hmd .cv-nav:hover{background:rgba(0,0,0,.68)}
.hmd .cv-count{position:absolute;top:10px;right:10px;background:rgba(0,0,0,.5);color:#fff;font-size:12px;font-weight:500;padding:.15rem .5rem;border-radius:20px}
.hmd .cv-name{display:flex;align-items:center;justify-content:space-between;gap:1rem;color:#fff;font-size:14px;padding:.6rem .2rem 0}
.hmd .cv-fname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.9}
.hmd .cv-dots{display:flex;gap:5px;flex:0 0 auto}
.hmd .cv-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.45);border:none;padding:0;cursor:pointer}
.hmd .cv-dot.on{background:#fff;width:18px;border-radius:4px}
.hmd .activity{display:flex;flex-direction:column;gap:.4rem}
.hmd .act-row{font-size:12px;color:var(--muted);line-height:1.4}
.hmd .act-row b{color:var(--ink-soft);font-weight:500}
.hmd .act-time{color:var(--faint)}
.hmd .mini-tl{display:flex;gap:.3rem;margin-top:.9rem}
.hmd .step{flex:1;text-align:center;font-size:12px;color:var(--muted)}
.hmd .step .bar{height:5px;border-radius:4px;background:var(--line);margin-bottom:.35rem}
.hmd .step.done .bar{background:var(--good)}.hmd .step.now .bar{background:var(--brand)}
.hmd .step.done{color:var(--good)}.hmd .step.now{color:var(--brand-ink);font-weight:500}
.hmd .d-actions{display:flex;gap:.5rem;margin-top:1.1rem;flex-wrap:wrap}
.hmd .note{display:flex;gap:.5rem;align-items:flex-start;font-size:14px;padding:.42rem 0;border-bottom:1px solid var(--line-2);cursor:pointer}
.hmd .note:last-of-type{border-bottom:0}
.hmd .note .cb{width:15px;height:15px;border-radius:4px;border:1.5px solid var(--cD9DEEA);margin-top:.15rem;flex:0 0 15px}
.hmd .note.done{color:var(--faint);text-decoration:line-through}
.hmd .note.done .cb{background:var(--good);border-color:var(--good)}
.hmd .compose{display:flex;gap:.4rem;margin-top:.6rem}
.hmd .compose input{flex:1;font:inherit;font-size:12px;border:1px solid var(--line);border-radius:8px;padding:.4em .6em;background:var(--panel-2);color:var(--ink);outline:none}
.hmd .compose input:focus{border-color:var(--brand)}
.hmd .notif{display:flex;align-items:flex-start;gap:.7rem;padding:.2rem}
.hmd .notif .bell{width:32px;height:32px;border-radius:9px;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 32px}
.hmd .notif .txt{flex:1;min-width:0;font-size:14px;color:var(--ink)}
.hmd .notif .txt b{color:var(--brand-ink)}
.hmd .notif .cap{display:block;font-size:12px;color:var(--muted);margin-top:.15rem}
.hmd .notif .acts{display:flex;gap:.4rem;margin-top:.55rem}
/* collapsible chat panel */
.hmd .chatpanel{position:fixed;top:0;right:0;height:100vh;width:clamp(296px,19vw,348px);background:var(--panel);border-left:1px solid var(--line);box-shadow:-14px 0 44px rgba(20,22,40,.10);display:flex;flex-direction:column;transform:translateX(101%);transition:transform .28s cubic-bezier(.4,0,.2,1);z-index:40}
.hmd .chatpanel.open{transform:translateX(0)}
.hmd .chat-head{display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.1rem .75rem;border-bottom:1px solid var(--line)}
.hmd .chat-head h3{margin:0;font-size:14.5px;display:flex;align-items:center;gap:.5rem}
.hmd .chat-head-acts{display:flex;align-items:center;gap:.4rem;flex-shrink:0}
.hmd .pinbtn{font-size:12px;font-weight:500;border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:7px;padding:.3em .55em;cursor:pointer;display:inline-flex;align-items:center;gap:.3em;white-space:nowrap;flex-shrink:0}
.hmd .pinbtn.on{background:var(--brand-soft);border-color:var(--brand);color:var(--brand-ink)}
.hmd .closebtn{width:26px;height:26px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--muted);cursor:pointer;display:inline-grid;place-items:center;flex-shrink:0}
.hmd .closebtn:hover{color:var(--ink);border-color:var(--cD9DEEA)}
.hmd .online{font-size:12px;color:var(--good);font-weight:500}
.hmd .chat-scroll{flex:1;min-height:0;overflow:auto;padding:.3rem 1.1rem}
.hmd .chat-foot{padding:.7rem 1.1rem;border-top:1px solid var(--line)}
.hmd .chat-day{text-align:center;font-size:12px;color:var(--faint);margin:.7rem 0 .3rem;font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em}
.hmd .chat-sys{display:flex;align-items:center;justify-content:center;gap:.4rem;margin:.45rem 0;text-align:center}
/* System events as chat bubbles: same shape as a person's message, tinted and with a
   left rail so it still reads as the system rather than a teammate. */
.hmd .bubble-row.sys{justify-content:flex-start}
.hmd .bubble.sys{background:var(--cFAFBFF);border:1px solid var(--line);border-left:3px solid var(--brand);color:var(--ink-soft);border-radius:13px 13px 13px 5px;max-width:88%}
.hmd .chat-mins{font-variant-numeric:tabular-nums;border-radius:5px;padding:0 .25em}
.hmd .chat-mins.up{color:var(--c8A5A00);background:var(--warn-soft)}
.hmd .chat-mins.down{color:var(--c0F6E3C);background:var(--good-soft)}
.hmd .chat-sys span:first-child{background:var(--panel-2);border:1px solid var(--line);border-radius:99px;padding:.28rem .7rem;font-size:12px;color:var(--ink-soft);max-width:86%}
.hmd .chat-sys-tm{font-size:12px;color:var(--faint)}
.hmd .chat-msg{display:flex;gap:.5rem;padding:.28rem 0;font-size:14px;border-bottom:1px solid var(--line-2)}
.hmd .chat-msg:last-child{border-bottom:0}
.hmd .chat-msg.me .body{color:var(--brand-ink)}
.hmd .chat-scroll{padding:.2rem 1rem}
.hmd .av{width:26px;height:26px;border-radius:50%;flex:0 0 26px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:#fff}
.hmd .chat-msg .who2{font-weight:500;font-size:12px}.hmd .chat-msg .tm{color:var(--faint);font-size:12px;margin-left:.35rem}
.hmd .chat-msg .body{color:var(--ink-soft);line-height:1.35}
/* WhatsApp-style thread bubbles — mine right (blue), theirs left (white) */
.hmd .chat-scroll.thread{background:var(--bg);padding:.5rem .8rem}
.hmd .bubble-row{display:flex;align-items:flex-end;gap:.35rem;margin:.3rem 0}
.hmd .bubble-row.me{justify-content:flex-end}
.hmd .bubble-av{flex:0 0 22px;width:22px;height:22px;font-size:12px;margin-bottom:1px}
.hmd .bubble{max-width:78%;padding:.4rem .55rem .3rem;border-radius:13px;font-size:14px;line-height:1.35;box-shadow:0 1px 1px rgba(20,22,40,.05)}
.hmd .bubble-row:not(.me) .bubble{background:var(--panel);border:1px solid var(--line);border-bottom-left-radius:4px;color:var(--ink)}
.hmd .bubble-row.me .bubble{background:var(--brand);color:#fff;border-bottom-right-radius:4px}
.hmd .bubble-who{font-size:12px;font-weight:500;margin-bottom:.05rem}
.hmd .bubble-body{white-space:pre-wrap;word-break:break-word}
.hmd .bubble-tm{display:block;text-align:right;font-size:12px;margin-top:.1rem}
.hmd .bubble-row.me .bubble-tm{color:rgba(255,255,255,.8)}
.hmd .bubble-row:not(.me) .bubble-tm{color:var(--faint)}
/* WhatsApp-style conversation list */
.hmd .chat-back{border:none;background:transparent;font-size:1.4rem;line-height:1;color:var(--muted);cursor:pointer;padding:0 .2rem 0 0;margin-right:.1rem}
.hmd .chat-back:hover{color:var(--ink)}
.hmd .chat-head h3 .av-sm{width:26px;height:26px;font-size:12px}
.hmd .chat-list{flex:1;min-height:0;overflow:auto;padding:.3rem .4rem}
.hmd .chat-list-row{display:flex;align-items:center;gap:.65rem;width:100%;text-align:left;border:none;background:transparent;padding:.6rem .55rem;border-radius:10px;cursor:pointer}
.hmd .chat-list-row:hover{background:var(--panel-2)}
.hmd .chat-list-row .av{width:38px;height:38px;font-size:14px;flex:0 0 38px}
.hmd .cl-mid{flex:1;min-width:0}
.hmd .cl-name{font-size:14px;font-weight:500;color:var(--ink);display:flex;align-items:center;gap:.35rem}
.hmd .cl-dot{width:7px;height:7px;border-radius:50%;background:var(--good);flex:0 0 7px}
.hmd .cl-last{font-size:12px;color:var(--muted);margin-top:.1rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hmd .cl-right{display:flex;flex-direction:column;align-items:flex-end;gap:.3rem;flex-shrink:0}
.hmd .cl-time{font-size:12px;color:var(--faint)}
.hmd .cl-unread{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--brand);color:#fff;font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:center}
/* toast */
.hmd .toast{position:fixed;bottom:22px;right:22px;width:308px;background:var(--panel);border:1px solid var(--line);border-radius:13px;box-shadow:0 18px 48px rgba(20,22,40,.18);padding:.7rem .85rem;display:flex;gap:.6rem;align-items:center;z-index:60;cursor:pointer;animation:hmdslide .3s ease}
@keyframes hmdslide{from{transform:translateY(14px);opacity:0}to{transform:translateY(0);opacity:1}}
.hmd .toast .who2{font-weight:500;font-size:12px;color:var(--ink)}
.hmd .toast .body{font-size:12px;color:var(--ink-soft);line-height:1.3}
.hmd .toast-cta{margin-left:auto;font-size:12px;font-weight:500;color:var(--brand-ink)}
/* prominent handoff card (right side, before demoting to the bell) */
.hmd .handoff-card{position:fixed;top:74px;right:22px;width:320px;background:var(--panel);border:1px solid var(--brand);border-radius:14px;box-shadow:0 20px 50px rgba(58,87,232,.20);padding:.9rem 1rem;z-index:55;animation:hmdslide .3s ease}
/* task popup */
.hmd .modal{position:fixed;inset:0;background:rgba(20,22,40,.42);display:flex;align-items:flex-start;justify-content:center;padding:clamp(2rem,7vh,5rem) 1rem;z-index:70;animation:hmdfade .16s ease;overflow-y:auto}
@keyframes hmdfade{from{opacity:0}to{opacity:1}}
.hmd .modal-card{position:relative;width:100%;max-width:640px;background:var(--panel);border:1px solid var(--line);border-radius:18px;box-shadow:0 30px 80px rgba(20,22,40,.3);padding:1.5rem 1.6rem;animation:hmdslide .22s ease}
.hmd .modal-head{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}
.hmd .modal-close{position:absolute;top:1.1rem;right:1.1rem;width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--muted);cursor:pointer;font-size:14px;z-index:2}
.hmd .modal-close:hover{color:var(--ink);border-color:var(--cD9DEEA)}
.hmd .modal-card .d-title{padding-right:2rem}
.hmd .modal-foot{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-top:1.4rem;padding-top:1.1rem;border-top:1px solid var(--line)}
.hmd .modal-foot-note{font-size:12px;color:var(--muted)}
.hmd .modal-foot-acts{display:flex;gap:.5rem}
.hmd .nt-card{max-width:520px}
.hmd .nt-field{margin-bottom:.9rem}
.hmd .nt-row{display:grid;grid-template-columns:1fr 1fr;gap:.9rem}
.hmd .nt-label{display:block;font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:.35rem}
.hmd .nt-input{width:100%;font:inherit;font-size:14px;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:.55rem .65rem;outline:none}
.hmd .nt-input:focus{border-color:var(--brand)}
.hmd .nt-textarea{resize:vertical;min-height:98px;line-height:1.5}
.hmd .nt-hint{font-weight:400;font-size:12px;color:var(--faint);text-transform:none;letter-spacing:0;margin-left:.4rem}
.hmd .nt-req{font-weight:500;font-size:12px;color:#C03221;background:var(--cFBE7E4);border-radius:5px;padding:.05em .4em;text-transform:uppercase;letter-spacing:.03em;margin-left:.35rem}
.hmd .nt-thumb{border:1px solid var(--line);border-radius:12px;background:var(--panel-2);padding:.8rem .9rem;margin-bottom:.9rem}
.hmd .nt-thumb-ask{display:flex;align-items:center;gap:.5rem;cursor:pointer}
.hmd .nt-thumb-asktext{font-size:14px;font-weight:500;color:var(--ink)}
.hmd .nt-thumb-type{font-size:12px;font-weight:500;color:var(--brand-ink);background:var(--brand-soft);border-radius:6px;padding:.1em .45em}
.hmd .nt-thumb-body{margin-top:.85rem;padding-top:.85rem;border-top:1px solid var(--line)}
.hmd .nt-thumb-who{display:grid;gap:.45rem}
.hmd .nt-thumb-opt{display:block;width:100%;text-align:left;border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:.55rem .7rem;font:inherit;cursor:pointer;transition:border-color .12s,background .12s}
.hmd .nt-thumb-opt:hover{border-color:var(--cD9DEEA)}
.hmd .nt-thumb-opt.on{border-color:var(--brand);background:var(--brand-soft)}
.hmd .nt-thumb-opt-lbl{display:block;font-size:14px;font-weight:500;color:var(--ink)}
.hmd .nt-thumb-opt-sub{display:block;font-size:12px;color:var(--muted);margin-top:.15rem;line-height:1.45}
.hmd .nt-thumb-opt.on .nt-thumb-opt-sub{color:var(--brand-ink)}
.hmd .nt-thumb-note{font-size:12px;color:var(--muted);line-height:1.5}
.hmd .btn:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
/* custom Themed date picker */
.hmd .dp{position:relative}
.hmd .dp-field{width:100%;display:flex;align-items:center;justify-content:space-between;gap:.5rem;font:inherit;font-size:14px;border:1px solid var(--line);border-radius:9px;padding:.55rem .7rem;background:var(--panel-2);color:var(--ink);cursor:pointer;text-align:left}
.hmd .dp-field:hover{border-color:var(--cD9DEEA)}
.hmd .dp-ph{color:var(--faint)}
.hmd .dp-cal{color:var(--muted);flex-shrink:0}
.hmd .dp-backdrop{position:fixed;inset:0;z-index:80}
.hmd .dp-pop{position:absolute;top:calc(100% + 6px);left:0;z-index:81;width:266px;background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 46px rgba(20,22,40,.18);padding:.8rem;animation:hmdslide .16s ease}
.hmd .dp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:.6rem}
.hmd .dp-title{font-size:14px;font-weight:500;color:var(--ink)}
.hmd .dp-nav{display:flex;gap:.3rem}
.hmd .dp-nav button{width:26px;height:26px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--ink-soft);cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0}
.hmd .dp-nav button:hover{background:var(--panel-2);color:var(--brand-ink);border-color:var(--cD9DEEA)}
.hmd .dp-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.hmd .dp-dow{margin-bottom:2px}
.hmd .dp-dow span{text-align:center;font-size:12px;font-weight:500;color:var(--faint);text-transform:uppercase;padding:.25rem 0}
.hmd .dp-day{aspect-ratio:1;border:none;background:transparent;border-radius:8px;font:inherit;font-size:12px;color:var(--ink-soft);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .1s}
.hmd .dp-day:hover{background:var(--brand-soft);color:var(--brand-ink)}
.hmd .dp-day.today{color:var(--brand-ink);font-weight:500;box-shadow:inset 0 0 0 1.5px var(--brand-soft)}
.hmd .dp-day.sel{background:var(--brand);color:#fff;font-weight:500;box-shadow:0 4px 10px rgba(58,87,232,.3)}
.hmd .dp-empty{aspect-ratio:1}
.hmd .dp-foot{display:flex;justify-content:space-between;margin-top:.6rem;padding-top:.55rem;border-top:1px solid var(--line-2)}
.hmd .dp-link{border:none;background:transparent;font:inherit;font-size:12px;font-weight:500;color:var(--brand-ink);cursor:pointer}
.hmd .dp-link:hover{text-decoration:underline}
.hmd .nt-assign{display:flex;align-items:flex-start;gap:.5rem;font-size:14px;color:var(--ink-soft);line-height:1.4;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:.65rem .75rem;margin:.3rem 0 1.2rem}
.hmd .nt-assign .status-dot{margin-top:.35rem}
.hmd .nt-assign b{color:var(--ink)}
.hmd .nt-actions{display:flex;justify-content:flex-end;gap:.6rem}
/* ── Create form, now inside the right-hand panel ───────────────────────── */
.hmd .nt-head{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;margin-bottom:1.1rem}
.hmd .nt-x{width:26px;height:26px;flex:none;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--muted);display:grid;place-items:center;cursor:pointer}
.hmd .nt-x:hover{border-color:var(--cD9DEEA);color:var(--ink)}
/* Live routing card — what the task's Type + Status mean for who gets it. */
.hmd .nt-route{border:1px solid var(--line);border-radius:10px;background:var(--panel-2);padding:.75rem .8rem;margin:.2rem 0 1.1rem}
.hmd .nt-route-head{display:flex;align-items:center;gap:.5rem;margin-bottom:.7rem}
.hmd .nt-route-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--muted)}
.hmd .nt-route-dot.on{background:var(--good)}
.hmd .nt-route-dot.pool{background:var(--brand)}
.hmd .nt-route-dot.wait{background:var(--warn)}
.hmd .nt-route-headline{font-size:13.5px;font-weight:500;color:var(--ink)}
.hmd .nt-route-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.7rem .9rem}
.hmd .nt-route-why{font-size:12.5px;color:var(--muted);line-height:1.45;margin-top:.7rem;padding-top:.6rem;border-top:1px solid var(--line)}
.hmd .collab-chip.off{opacity:.45;filter:grayscale(1)}
.hmd .collab-auto{font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:500;color:var(--muted);background:var(--cEDEFF4);border-radius:5px;padding:.1em .35em;margin-left:.1rem}
/* The panel at rest — nothing open, so it offers the one thing you'd want next. */
.hmd .panel-rest{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;text-align:center;padding:3.2rem 1rem;min-height:220px}
.hmd .panel-rest-title{font-size:15px;font-weight:500;color:var(--ink-soft)}
.hmd .panel-rest-sub{font-size:13px;color:var(--muted);max-width:34ch;line-height:1.45}
.hmd .panel-rest .btn{margin-top:.5rem}
/* ── Grouped reminders ──────────────────────────────────────────────────── */
.hmd .rem-group{overflow:hidden}
.hmd .rem-head{display:flex;align-items:center;gap:.5rem;width:100%;border:0;background:transparent;font:inherit;text-align:left;padding:.7rem .9rem;cursor:pointer;color:var(--ink)}
.hmd .rem-head:hover{background:var(--panel-2)}
.hmd .rem-caret{display:inline-block;color:var(--faint);font-size:15px;line-height:1;transition:transform .15s ease;flex:none}
.hmd .rem-caret.on{transform:rotate(90deg)}
.hmd .rem-head-lbl{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);flex:none}
.hmd .rem-head-peek{font-size:13px;color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.hmd .rem-head-act{font-size:12px;font-weight:500;color:var(--brand);margin-left:auto;flex:none}
.hmd .rem-body{padding:0 .9rem .8rem;border-top:1px solid var(--line)}
.hmd .rem-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:.45rem 0;border-bottom:1px solid var(--line-2)}
.hmd .rem-row:last-child{border-bottom:0}
.hmd .rem-txt{font-size:13px;color:var(--ink);min-width:0}
.hmd .rem-why{color:var(--cB0203A)}
@media(prefers-reduced-motion:reduce){.hmd .rem-caret{transition:none}}
.hmd .refs{display:flex;flex-wrap:wrap;gap:.7rem;align-items:flex-start}
.hmd .refs .ref-thumb{position:relative}
.hmd .ref-thumb .thumb-img{background-color:var(--panel-2)}
.hmd .ref-link{display:inline-flex;align-items:center;gap:.4rem;max-width:230px;height:34px;background:var(--panel-2);border:1px solid var(--line);border-radius:9px;padding:0 .35rem 0 .6rem;font-size:12px;font-weight:500;color:var(--brand-ink);text-decoration:none}
.hmd .ref-link:hover{border-color:var(--brand)}
.hmd .ref-link-ic{flex:0 0 auto;font-size:12px}
.hmd .ref-link-lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Links show IN FULL, in their own box, and open on click — "it's getting cut; I
   need the full link visible, in a box" (Praveen, 21 Oct). One per row. */
.hmd .ref-link{display:flex;flex:1 1 100%;max-width:100%;height:auto;min-height:34px;align-items:flex-start;padding:.45rem .45rem .45rem .6rem}
.hmd .ref-link .ref-link-ic{margin-top:1px}
.hmd .ref-link .ref-link-lbl{flex:1;min-width:0;white-space:normal;overflow:visible;word-break:break-all;line-height:1.45}
.hmd .ref-link:hover .ref-link-lbl{text-decoration:underline}
.hmd .ref-link .ref-x{margin-top:1px}
.hmd .ref-x{border:none;background:rgba(20,22,40,.55);color:#fff;border-radius:50%;width:17px;height:17px;font-size:12px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 17px}
.hmd .ref-thumb .ref-x{position:absolute;top:5px;right:5px;opacity:0;transition:opacity .12s}
.hmd .ref-thumb:hover .ref-x{opacity:1}
.hmd .ref-link .ref-x{background:transparent;color:var(--faint);width:16px;height:16px}
.hmd .ref-link .ref-x:hover{color:var(--rose)}
.hmd .ref-url{display:flex;gap:.5rem;margin-top:.7rem;max-width:540px}
.hmd .ref-url .nt-input{flex:1}
/* notification stack — sits at the top of the chat panel, pushes chat down */
.hmd .notif-stack{flex:0 0 auto;max-height:44%;overflow:auto;border-bottom:1px solid var(--line);background:linear-gradient(180deg,var(--cF3F1FE),transparent);padding:.6rem .6rem .5rem}
.hmd .nstack-head{display:flex;align-items:center;justify-content:space-between;padding:0 .25rem .45rem;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:500}
.hmd .nstack-clear{border:none;background:transparent;font-size:12px;color:var(--brand-ink);cursor:pointer;font-weight:500;text-transform:none;letter-spacing:0}
.hmd .pnotif{display:flex;gap:.55rem;align-items:flex-start;background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:.55rem .6rem;margin-bottom:.45rem;box-shadow:0 3px 10px rgba(35,45,66,.05);animation:hmdslide .26s ease}
.hmd .pnotif:last-child{margin-bottom:0}
.hmd .pnotif.urgent{border-color:var(--cF4C4C9);background:linear-gradient(180deg,var(--cFEF3F4),var(--panel))}
.hmd .pn-ic{width:28px;height:28px;border-radius:8px;flex:0 0 28px;display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff}
.hmd .pn-ic.urgent{background:var(--rose)} .hmd .pn-ic.claim{background:var(--good)} .hmd .pn-ic.freed{background:var(--good)} .hmd .pn-ic.message{background:var(--brand)}
.hmd .pn-body{flex:1;min-width:0}
.hmd .pn-eyebrow{font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:var(--cC0201F)}
.hmd .pn-title{font-size:14px;font-weight:500;line-height:1.25;margin-top:.05rem}
.hmd .pn-sub{font-size:12px;color:var(--muted);margin-top:.12rem;line-height:1.35}
.hmd .pn-acts{display:flex;gap:.4rem;margin-top:.5rem}
.hmd .pn-x{border:none;background:transparent;color:var(--faint);cursor:pointer;font-size:14px;line-height:1;padding:.1rem .2rem;flex:0 0 auto}
.hmd .pn-x:hover{color:var(--ink)}
/* accept & work / ask-manya modals */
.hmd .aw-card{max-width:440px}
.hmd .aw-h{font-size:16px;font-weight:500}
.hmd .aw-p{font-size:14px;color:var(--muted);line-height:1.45;margin:.4rem 0 .9rem}
.hmd .aw-task{background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:.65rem .75rem;margin:.85rem 0}
.hmd .aw-task .tt{font-size:14px;font-weight:500}
.hmd .aw-task .tm{font-size:12px;color:var(--muted);margin-top:.12rem}
.hmd .impact{display:flex;gap:.55rem;align-items:flex-start;font-size:14px;line-height:1.45;background:var(--warn-soft);border:1px solid var(--cF3DCB4);border-radius:10px;padding:.65rem .75rem;color:var(--c7A4E0B)}
.hmd .impact.ok{background:var(--good-soft);border-color:var(--cBFE6CD);color:var(--c155E37)}
.hmd .impact b{color:var(--c5A3906)}.hmd .impact.ok b{color:var(--c0E4A2A)}.hmd .impact .over{color:var(--cC0201F)}
.hmd .aw-choice{display:flex;flex-direction:column;gap:.55rem;margin-top:1rem}
.hmd .aw-or{text-align:center;font-size:12px;color:var(--faint);text-transform:uppercase;letter-spacing:.08em}
.hmd .tchips{display:flex;flex-direction:column;gap:.5rem}
.hmd .tchip{display:flex;align-items:center;gap:.6rem;border:1px solid var(--line);border-radius:10px;padding:.55rem .65rem;background:var(--panel)}
.hmd .tchip.movable{border-style:dashed;border-color:var(--cC7CEDD)}
.hmd .tchip .cmid{flex:1;min-width:0}
.hmd .tchip .ct{font-size:14px;font-weight:500}
.hmd .tchip .cs{font-size:12px;color:var(--muted);margin-top:.1rem}
.hmd .pri{font-size:12px;font-weight:500;padding:.14em .5em;border-radius:6px;white-space:nowrap}
.hmd .pri.low{background:var(--cEEF0F5);color:var(--c7A8296)}
/* Manya reschedule card */
.hmd .manya-resched{border-color:var(--cF4C4C9);background:linear-gradient(180deg,var(--cFEF6F0),var(--panel))}
.hmd .mr-h{display:flex;gap:.7rem;align-items:flex-start}
.hmd .mr-ic{width:34px;height:34px;border-radius:9px;flex:0 0 34px;background:var(--cFEE9D6);display:flex;align-items:center;justify-content:center;font-size:16px}
.hmd .mr-t{font-size:16px;font-weight:500}
.hmd .mr-d{font-size:12px;color:var(--muted);margin-top:.15rem;line-height:1.45}
.hmd .mr-foot{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-top:1rem;padding-top:.9rem;border-top:1px solid var(--line)}
.hmd .mr-note{font-size:12px;color:var(--muted)}
.hmd .cap-badge{font-size:12px;font-weight:500;padding:.22em .55em;border-radius:7px;white-space:nowrap}
.hmd .cap-badge.full{background:var(--rose-soft,var(--cFCEBEC));color:var(--cC0201F)}
.hmd .cap-badge.some{background:var(--warn-soft);color:var(--c7A4E0B)}
.hmd .cap-badge.free{background:var(--good-soft);color:var(--good)}
/* team capacity board */
.hmd .tcb-head{font-size:16px;font-weight:500;margin-bottom:.6rem}
.hmd .tcb-sub{font-size:12px;font-weight:400;color:var(--muted);margin-left:.5rem}
.hmd .tcb-row{display:grid;grid-template-columns:158px 1fr auto;gap:.8rem;align-items:center;padding:.55rem 0;border-top:1px solid var(--line-2)}
.hmd .tcb-row:first-of-type{border-top:0}
.hmd .tcb-who{display:flex;align-items:center;gap:.55rem}
.hmd .tcb-who .av{width:30px;height:30px;font-size:12px;flex:0 0 30px}
.hmd .tcb-n{font-size:14px;font-weight:500}
.hmd .tcb-r{font-size:12px;color:var(--muted)}
.hmd .tcb-tl{display:flex;height:40px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--panel-2)}
.hmd .tcb-blk{color:#fff;font-size:12px;font-weight:500;padding:0 .5rem;display:flex;align-items:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;border-right:1px solid rgba(255,255,255,.16)}
.hmd .tcb-blk:last-child{border-right:0}
.hmd .tcb-blk.reel{background:linear-gradient(135deg,#5A6FF0,#3A57E8)}
.hmd .tcb-blk.design{background:linear-gradient(135deg,#8E7BF0,#6D5CE7)}
.hmd .tcb-blk.lunch{background:repeating-linear-gradient(45deg,var(--cEAEDF5),var(--cEAEDF5) 5px,var(--cDFE3EE) 5px,var(--cDFE3EE) 10px);color:var(--muted)}
.hmd .tcb-blk.free{background:repeating-linear-gradient(45deg,var(--cF3F5F9),var(--cF3F5F9) 5px,var(--cE9ECF2) 5px,var(--cE9ECF2) 10px);color:var(--faint)}
.hmd .tcb-note{font-size:12px;color:var(--ink-soft);background:var(--brand-soft);border:1px solid var(--cD5DCFB);border-radius:10px;padding:.6rem .75rem;margin-top:.85rem;line-height:1.45}
.hmd .tcb-note b{color:var(--brand-ink)}
/* Start / End day control */
.hmd .daybtn{display:inline-flex;align-items:center;gap:.4rem;font-size:12px;font-weight:500;border-radius:9px;padding:.5em .8em;border:1px solid transparent;background:var(--good);color:#fff;cursor:pointer}
.hmd .daybtn:hover{background:#158A46}
.hmd .daybar{display:inline-flex;align-items:center;gap:.4rem}
.hmd .daychip{display:inline-flex;align-items:center;gap:.4rem;font-size:12px;font-weight:500;border-radius:9px;padding:.45em .7em;background:var(--good-soft);color:var(--c0F6E3C);border:1px solid var(--cBFE6CD);white-space:nowrap}
.hmd .daychip .pulse{width:8px;height:8px;border-radius:50%;background:var(--good);animation:hmdpl 1.6s infinite}
@keyframes hmdpl{0%{box-shadow:0 0 0 0 rgba(26,160,83,.45)}70%{box-shadow:0 0 0 6px rgba(26,160,83,0)}100%{box-shadow:0 0 0 0 rgba(26,160,83,0)}}
.hmd .endbtn{display:inline-flex;align-items:center;gap:.35rem;white-space:nowrap;font-size:12px;font-weight:500;background:var(--cFCEBEC);border-color:var(--cF3C6CE);color:var(--cB0203A)}
.hmd .endbtn:hover{background:var(--cF9DADE);border-color:var(--cE7A9B3)}
.hmd .teamcapbtn{display:inline-flex;align-items:center;gap:.4rem;font-size:12px;font-weight:500;border-radius:9px;padding:.5em .8em;border:1px solid var(--cCBD5FA);background:var(--brand-soft);color:var(--brand-ink);cursor:pointer;white-space:nowrap}
.hmd .teamcapbtn:hover{border-color:var(--brand)}
.hmd .teamcapbtn.on{background:var(--brand);color:#fff;border-color:transparent}
/* Team-capacity page */
.hmd .tcp-head{display:flex;align-items:center;gap:.7rem;margin-bottom:1rem}
.hmd .tcp-span{margin-left:auto}
/* approve-gate mini timeline (reuses tcp-blk block styles, absolute layout) */
.hmd .ag-track{position:relative;height:104px;border:1px solid var(--line);border-radius:9px;overflow:hidden;background:var(--panel-2)}
/* live task timer strip + inline finished/extend prompt */
.hmd .timer-strip{display:flex;align-items:center;gap:.75rem;white-space:nowrap;background:var(--brand-soft);border:1px solid var(--cD5DCF8);border-radius:12px;padding:.4rem .45rem .4rem .85rem;margin:.7rem 0 .2rem;font-size:13.5px;color:var(--brand-ink)}
.hmd .timer-strip .timer-num{display:inline-flex;align-items:center;gap:.35rem}
.hmd .timer-strip .timer-num b{font-weight:500}
.hmd .timer-track{flex:1;min-width:48px;height:6px;border-radius:999px;background:rgba(58,87,232,.15);overflow:hidden}
.hmd .timer-fill{display:block;height:100%;background:var(--brand);border-radius:999px;transition:width .4s}
.hmd .timer-strip.over .timer-track{background:rgba(217,119,6,.18)}
.hmd .timer-strip.over .timer-fill{background:var(--warn)}
.hmd .timer-msg{color:var(--ink-soft)}
.hmd .timer-strip.over .timer-msg{color:var(--c8A5A00);font-weight:500}
@media (max-width:900px){.hmd .timer-strip{flex-wrap:wrap;white-space:normal}}
/* Start / Output ready moves (27 Oct) — the card shows where it goes. */
.hmd .task{position:relative}
.hmd .fx-badge{position:absolute;top:-9px;right:10px;font-size:11px;font-weight:500;color:#fff;background:var(--tone-info-fg,#079AA2);border-radius:999px;padding:2px 9px;animation:fxIn .25s ease;z-index:2}
.hmd .task.fx-output .fx-badge{background:var(--good)}
.hmd .task.fx-start.fx-lift{border-color:var(--tone-info-fg,#079AA2);transform:translateY(-2px);transition:all .3s}
.hmd .task.fx-output.fx-lift{border-color:var(--good);background:var(--good-soft);transition:all .3s}
.hmd .task.fx-output.fx-fold{border-color:var(--good);background:var(--good-soft);max-height:0;opacity:0;padding-top:0;padding-bottom:0;margin-top:0;margin-bottom:0;overflow:hidden;transform:translateX(30px);transition:all .4s ease}
.hmd .task.fx-start.fx-landed{animation:fxLand 1.6s ease}
.hmd .task.fx-now{animation:fxNow 1.8s ease}
.hmd .fx-pop{animation:fxPop .45s ease}
.hmd .fx-moved{display:flex;align-items:center;gap:.35rem;margin-top:.45rem;font-size:12px;color:var(--tone-info-fg,#079AA2);background:var(--tone-info-bg,#E1F4F5);border-radius:8px;padding:.3rem .5rem;animation:fxIn .35s ease}
.hmd .fx-now-tag{background:var(--brand-soft);color:var(--brand-ink)}
.hmd .fx-pane{animation:fxPane .35s ease}
.hmd .fx-switched{font-size:12px;color:var(--ink-soft);margin:-.2rem 0 .6rem;animation:fxIn .35s ease}
.hmd .fx-switched b{font-weight:500;color:var(--tone-info-fg,#079AA2)}
.hmd .fx-switched button,.hmd .fx-receipt button{border:0;background:none;padding:0;font:inherit;cursor:pointer;color:var(--brand);text-decoration:underline}
.hmd .fx-receipt{display:flex;align-items:center;gap:.5rem;border:1px dashed var(--good);background:var(--good-soft);color:var(--good);border-radius:11px;padding:.5rem .65rem;margin-bottom:.5rem;font-size:12.5px;animation:fxIn .35s ease}
.hmd .fx-receipt b{font-weight:500}
.hmd .fx-receipt-acts{margin-left:auto;display:flex;gap:.7rem}
.hmd .fx-receipt button{color:var(--good)}
.hmd .fx-note{display:flex;align-items:center;gap:.6rem;border:1px solid var(--cD5DCF8);background:var(--brand-soft);color:var(--brand-ink);border-radius:12px;padding:.55rem .75rem;margin-bottom:.8rem;font-size:13px;animation:fxIn .35s ease}
.hmd .fx-note b{font-weight:500}
.hmd .fx-x{margin-left:auto;border:0;background:none;cursor:pointer;color:var(--muted);display:flex;padding:2px}
@keyframes fxIn{from{opacity:0;transform:translateY(-4px)}}
@keyframes fxPop{0%{transform:scale(.6);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
@keyframes fxPane{from{opacity:0;transform:translateX(14px)}}
@keyframes fxLand{0%,55%{border-color:var(--tone-info-fg,#079AA2);background:var(--tone-info-bg,#E1F4F5)}}
@keyframes fxNow{0%,55%{border-color:var(--brand);background:var(--brand-soft)}}
@media (prefers-reduced-motion:reduce){.hmd .fx-pane,.hmd .fx-pop,.hmd .task.fx-start.fx-landed,.hmd .task.fx-now{animation:none}}
.hmd .timer-strip.over{background:var(--warn-soft);border-color:var(--cF3D9AE);color:var(--c8A5A00)}
.hmd .timer-strip.idle{background:var(--panel-2);border-color:var(--line);color:var(--ink-soft)}
.hmd .timer-acts{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;font-weight:500}
.hmd .ext-wrap{position:relative;display:inline-flex}
.hmd .ext-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:20;background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(35,45,66,.12);padding:.5rem;display:flex;flex-direction:column;gap:.4rem;min-width:214px}
.hmd .ext-row{display:flex;gap:.35rem;align-items:center;flex-wrap:wrap}
.hmd .ext-in{width:96px;padding:.3rem .5rem}
/* The "why" step of an extension, and the trail it leaves on the task. */
.hmd .ext-menu{min-width:260px}
.hmd .ext-reason{display:flex;flex-direction:column;gap:.35rem;border-top:1px solid var(--line);padding-top:.5rem;margin-top:.15rem}
.hmd .ext-reason .nt-textarea{min-height:52px;font-size:13px}
.hmd .ext-log{border:1px solid var(--line);border-radius:10px;background:var(--panel-2);padding:.65rem .8rem;margin:.7rem 0 .2rem}
.hmd .ext-log-row{display:flex;align-items:baseline;gap:.6rem;padding:.3rem 0;border-bottom:1px solid var(--line-2);font-size:13px;flex-wrap:wrap}
.hmd .ext-log-row:last-child{border-bottom:0}
.hmd .ext-log-amt{font-weight:500;color:var(--warn);font-variant-numeric:tabular-nums;flex:none}
.hmd .ext-log-amt.neg{color:var(--good)}
/* An entry that was taken back stays on the record, just quietened and struck through. */
.hmd .ext-log-row.undone .ext-log-amt,.hmd .ext-log-row.undone .ext-log-why{text-decoration:line-through;opacity:.55}
.hmd .ext-log-tag{font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:500;color:var(--good);background:var(--good-soft);border-radius:5px;padding:.1em .35em;margin-right:.4rem}
.hmd .ext-log-undone-tag{font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:500;color:var(--muted);background:var(--cEDEFF4);border-radius:5px;padding:.1em .35em;flex:none}
.hmd .ext-log-undo{border:1px solid var(--line);background:var(--panel);color:var(--ink-soft);font:inherit;font-size:11px;font-weight:500;border-radius:6px;padding:.12em .5em;cursor:pointer;flex:none}
.hmd .ext-log-undo:hover{border-color:var(--brand);color:var(--brand)}
.hmd .ext-log-why{color:var(--ink);flex:1;min-width:0}
.hmd .ext-log-who{font-size:12px;color:var(--muted);flex:none}
.hmd .tc-back{width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:var(--panel);cursor:pointer;font-size:1.1rem;color:var(--ink-soft)}
.hmd .tc-back:hover{border-color:var(--cD9DEEA)}
.hmd .tcp-title{font-size:1.2rem;font-weight:500}
.hmd .tcp-title span{font-size:14px;font-weight:500;color:var(--muted);margin-left:.4rem}
.hmd .tcp-card{margin-bottom:1rem}
.hmd .tcp-top{display:flex;align-items:center;gap:.7rem;margin-bottom:.7rem}
.hmd .tcp-n{font-size:14px;font-weight:500}
.hmd .tcp-r{font-size:12px;color:var(--muted)}
.hmd .tcp-status{margin-left:auto;display:flex;align-items:center;gap:.5rem}
.hmd .st-badge{font-size:12px;font-weight:500;padding:.22em .55em;border-radius:7px}
.hmd .st-badge.working{background:var(--good-soft);color:var(--c0F6E3C)}
.hmd .tcp-ticks{display:flex;padding:0 1px;margin-bottom:.3rem}
.hmd .tcp-track{position:relative;display:flex;height:56px;border:1px solid var(--line);border-radius:9px;overflow:hidden;background:var(--panel-2)}
.hmd .tcp-blk{color:#fff;font-size:12px;font-weight:500;padding:.35rem .5rem;display:flex;flex-direction:column;justify-content:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;border-right:1px solid rgba(255,255,255,.16);position:relative}
.hmd .tcp-blk:last-child{border-right:0}
.hmd .tcp-bm{font-size:12px;opacity:.85;font-weight:500}
.hmd .tcp-blk.reel{background:linear-gradient(135deg,#5A6FF0,#3A57E8)}
.hmd .tcp-blk.design{background:linear-gradient(135deg,#8E7BF0,#6D5CE7)}
.hmd .tcp-blk.done{opacity:.48}
.hmd .tcp-blk.now{outline:2px solid #fff;outline-offset:-3px}
.hmd .tcp-blk.lunch{background:repeating-linear-gradient(45deg,var(--cEAEDF5),var(--cEAEDF5) 5px,var(--cDFE3EE) 5px,var(--cDFE3EE) 10px);color:var(--muted)}
.hmd .tcp-blk.free{background:repeating-linear-gradient(45deg,var(--cF3F5F9),var(--cF3F5F9) 5px,var(--cE9ECF2) 5px,var(--cE9ECF2) 10px);color:var(--faint)}
.hmd .tcp-blk.past{background:var(--cEDEEF2);color:var(--faint);font-weight:500;opacity:.7}
.hmd .tcp-now-line{position:absolute;top:0;bottom:0;width:2px;background:#DC2E2E;z-index:3}
.hmd .tcp-week{display:flex;gap:.5rem}
.hmd .tcp-day{flex:1;display:flex;flex-direction:column;gap:.3rem;min-width:0}
.hmd .tcp-day-h{display:flex;align-items:center;justify-content:center;gap:.3rem;font-size:12px;color:var(--muted)}
.hmd .tcp-day.today .tcp-day-h{color:var(--ink);font-weight:500}
.hmd .tcp-day-now{color:#DC2E2E;font-size:12px;font-weight:500;letter-spacing:.02em}
.hmd .tcp-day-bar{height:64px;border:1px solid var(--line);border-radius:8px;background:var(--panel-2);display:flex;flex-direction:column-reverse;overflow:hidden}
.hmd .tcp-day.today .tcp-day-bar{border-color:#DC2E2E;box-shadow:inset 0 0 0 1px #DC2E2E}
.hmd .tcp-day.over .tcp-day-bar{border-color:#E11D48}
.hmd .tcp-day-seg{width:100%;border-bottom:1px solid rgba(255,255,255,.55)}
.hmd .tcp-day-seg.reel{background:linear-gradient(135deg,#5A6FF0,#3A57E8)}
.hmd .tcp-day-seg.design{background:linear-gradient(135deg,#8E7BF0,#6D5CE7)}
.hmd .tcp-day-f{text-align:center;font-size:12px;color:var(--ink-soft);font-variant-numeric:tabular-nums}
.hmd .tcp-now-line::before{content:"";position:absolute;top:-3px;left:-3px;width:8px;height:8px;border-radius:50%;background:#DC2E2E}
.hmd .tcp-now{display:flex;align-items:center;gap:.55rem;margin-top:.65rem;font-size:14px;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:.55rem .7rem}
.hmd .tcp-now .dot{width:8px;height:8px;border-radius:50%;background:#DC2E2E;flex:0 0 8px}
.hmd .tcp-now b{color:var(--ink)}.hmd .tcp-now .muted{color:var(--muted)}
/* End-today modal rows */
.hmd .eod-row{display:flex;align-items:center;gap:.6rem;padding:.5rem 0;border-bottom:1px solid var(--line-2);font-size:14px}
.hmd .eod-row:last-of-type{border-bottom:0}
.hmd .eod-row.roll{color:var(--muted)}
.hmd .eod-cb{width:18px;height:18px;border-radius:5px;border:1.6px solid var(--cCBD2E0);flex:0 0 18px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;color:#fff}
.hmd .eod-cb.on{background:var(--good);border-color:var(--good)}
.hmd .eod-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hmd .eod-tag{font-size:12px;font-weight:500;padding:.14em .5em;border-radius:6px;white-space:nowrap}
.hmd .eod-tag.done{background:var(--good-soft);color:var(--c0F6E3C)}.hmd .eod-tag.roll{background:var(--warn-soft);color:var(--c7A4E0B)}
.hmd .eod-reason{width:100%;margin:.1rem 0 .55rem 2rem;max-width:calc(100% - 2rem);border:1px solid var(--line);border-radius:8px;padding:.4rem .55rem;font-size:12px;color:var(--ink-soft);background:var(--panel-2)}
/* ── Wrap up your day: one task per line ─────────────────────────────────── */
.hmd .eod-card{max-width:1020px;width:min(1020px,95vw)}
/* A real table: column headers, aligned columns, one row per task. */
/* Fixed layout: the columns keep their widths and a long task name truncates,
   instead of one headline stretching the table into a sideways scroll. */
.hmd .eod-table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:13.5px}
.hmd .eod-table thead th{position:sticky;top:0;z-index:2;background:var(--panel);text-align:left;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);padding:.4rem .5rem;border-bottom:1px solid var(--line)}
.hmd .eod-table td{padding:.4rem .5rem;border-bottom:1px solid var(--line-2);vertical-align:middle;overflow:hidden}
.hmd .eod-table .c-cb{width:34px}
.hmd .eod-table .c-pub{width:130px;color:var(--ink-soft);white-space:nowrap}
.hmd .eod-table .c-pub.near{color:var(--c8A5A00);font-weight:500}
.hmd .eod-table .c-act{width:270px}
.hmd .eod-table th.c-pub,.hmd .eod-table th.c-act{text-align:left}
.hmd .eod-grouprow td{background:var(--panel-2);border-bottom:1px solid var(--line);padding:.35rem .5rem}
.hmd .eod-grouprow .eod-group-n{margin-left:.4rem}
.hmd .eod-table .eod-title{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:var(--ink)}
.hmd .eod-table tr.done .eod-title{color:var(--muted);font-weight:500}
.hmd .eod-table .eod-reason{margin:0;width:100%;max-width:100%;padding:.3rem .5rem;font-size:12px}
.hmd .eod-group{margin-bottom:.5rem}
.hmd .eod-group-head{display:flex;align-items:center;gap:.45rem;padding:.5rem .15rem .3rem;border-bottom:1px solid var(--line);margin-bottom:.15rem;position:sticky;top:0;background:var(--panel);z-index:1}
.hmd .eod-group-n{font-size:11px;font-weight:500;color:var(--muted);background:var(--cEDEFF4);border-radius:7px;padding:0 .4em}
.hmd .eod-group-note{font-size:11.5px;color:var(--faint);text-transform:uppercase;letter-spacing:.04em;font-weight:500;margin-left:auto}
/* The publishing date, in its own column so the eye can run down it. */
.hmd .eod-list{max-height:56vh;overflow-y:auto;overflow-x:hidden;margin:.2rem 0 .1rem}
/* Due TODAY is not the same as already late: amber, and the row is tinted so it reads
   as "today's problem" rather than sitting quietly among work due next week. */
.hmd .due-chip.today{color:var(--c8A5A00)}
.hmd .task.duetoday{background:linear-gradient(180deg,var(--cFEF6F0),var(--panel));border-color:var(--cF3DCB4)}
.hmd .task.duetoday:hover{border-color:var(--cF3C6CE)}
.hmd .task.duetoday.sel{border-color:var(--brand)}
.hmd .eod-reason:focus{outline:none;border-color:var(--brand);background:var(--panel)}
.hmd .btn.rose:disabled{opacity:.45;cursor:default}
.hmd .eod-foot{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-top:1.1rem;padding-top:.9rem;border-top:1px solid var(--line)}
.hmd .m-note{font-size:12px;color:var(--muted)}
.hmd .btn.rose{background:var(--rose);color:#fff;border-color:transparent}
/* Dark theme (components/Theme.tsx) — the shell tokens + every light colour above. */
html[data-theme="dark"] .hmd{
  --bg:#151824;--panel:#1F2332;--panel-2:#191D2A;
  --ink:#E8EBF3;--ink-soft:#C2C8D6;--muted:#959DB1;--faint:#858DA1;
  --line:#2C3246;--line-2:#262B3C;
  --brand-soft:#2C3666;--brand-ink:#93A3FF;
  --good-soft:rgba(26,160,83,.16);--warn-soft:rgba(217,119,6,.16);
  --shadow:none;
  --tone-good-bg:rgba(26,160,83,.18);--tone-good-fg:#61CE9C;--tone-info-bg:rgba(7,154,162,.2);--tone-info-fg:#4FD1D8;
  --tone-brand-bg:#2C3666;--tone-brand-fg:#93A3FF;--tone-warn-bg:rgba(217,119,6,.18);--tone-warn-fg:#E9A23B;
  --tone-bad-bg:rgba(192,50,33,.2);--tone-bad-fg:#F2907F;--tone-muted-bg:#272C3E;--tone-muted-fg:#959DB1;
  --tone-urgent-bg:rgba(176,32,58,.24);--tone-urgent-fg:#F58CA0;
  --cD9DEEA:#3A4159;--cEAEDF5:#272C3E;--cDFE3EE:#3A4159;--cF3F5F9:#272C3E;--cE9ECF2:#272C3E;--cE3E6EE:#3A4159;--cEDEFF4:#272C3E;--cFDECEA:rgba(220,46,46,.16);--cFFF7F6:rgba(220,46,46,.16);--cF1C4BD:rgba(220,46,46,.42);--cEAA99F:rgba(220,46,46,.42);--cFCEBEA:rgba(220,46,46,.16);--cE9ECFB:#2C3666;--cFAFBFF:#272C3E;--c232D42:#E8EBF3;--cB9C2E0:#3A4159;--c3B4457:#C2C8D6;--cEEF1FD:#2C3666;--cFCEBEC:rgba(220,46,46,.16);--cC0201F:#F2907F;--cF3C6CE:rgba(220,46,46,.42);--cF9DADE:rgba(220,46,46,.16);--cD5DCF8:#2C3666;--cF3D9AE:rgba(217,119,6,.42);--c8A5A00:#E2B366;--cDCE1FA:#2C3666;--cC7CEDD:#3A4159;--cEEF1FB:#2C3666;--cFBE7E4:rgba(220,46,46,.16);--cF3F1FE:#2C3666;--cF4C4C9:rgba(220,46,46,.42);--cFEF3F4:rgba(220,46,46,.16);--cF3DCB4:rgba(217,119,6,.42);--c7A4E0B:#E2B366;--cBFE6CD:rgba(26,160,83,.42);--c155E37:#61CE9C;--c5A3906:#E2B366;--c0E4A2A:#61CE9C;--cEEF0F5:#272C3E;--c7A8296:#959DB1;--cFEF6F0:rgba(217,119,6,.16);--cFEE9D6:rgba(217,119,6,.16);--cD5DCFB:#2C3666;--c0F6E3C:#61CE9C;--cB0203A:#F2907F;--cE7A9B3:rgba(220,46,46,.42);--cCBD5FA:#2C3666;--cEDEEF2:#272C3E;--cCBD2E0:#3A4159;
}


/* ── Compact (Praveen, 21 Oct) ───────────────────────────────────────────────
   "At 100% it's too big and cluttered; 90% feels right." Rather than zoom the page
   (which would throw off dragging on the timeline), the sizes come down: body 13px,
   headings one step smaller, ~15% less padding, and no heavy bold — weights 400/500
   only, as the dashboard theme says. History & comments is a quieter side column. */
.hmd{font-size:13.5px}
.hmd .who .hi{font-size:18px}
.hmd .who .sub,.hmd .banner,.hmd .claim-title,.hmd .mval,.hmd .task .tt{font-size:13px}
.hmd .stat .n{font-size:16px}
.hmd .hero-head h2,.hmd .colhead h3{font-size:14px}
.hmd .detail .d-title{font-size:16px}
.hmd .btn{font-size:13px;padding:.42em .8em}
.hmd .btn.sm{padding:.3em .62em}
.hmd .pad{padding:.62rem .78rem}
.hmd .task{padding:.5rem .6rem}
.hmd .work{gap:.6rem}
.hmd .colhead{margin-bottom:.7rem}
.hmd .meta-grid{gap:.7rem;padding:.65rem 0}
.hmd .section-lbl{margin:.9rem 0 .4rem}
.hmd .brief{padding:.65rem .75rem;font-size:13px;line-height:1.55}
.hmd .gc-rtf-body{font-size:13px;line-height:20px}
.hmd .gc-rtf-body p{min-height:20px}
.hmd .hist-side{font-size:12px;min-width:0;overflow-wrap:anywhere}
.hmd .hist-side a,.hmd .hist-side [class*="text-emerald"]{word-break:break-all}
.hmd .hist-side .section-lbl{font-size:11px}
.hmd .hist-side .btn{font-size:12px}
.hmd .hist-side textarea{font-size:12px}
.hmd .hist-side [class*="text-[14px]"],.hmd .hist-side [class*="text-[13px]"],.hmd .hist-side [class*="text-sm"]{font-size:12px!important;line-height:17px!important}
.hmd .hist-side [class*="text-[12px]"],.hmd .hist-side [class*="text-[11px]"],.hmd .hist-side [class*="text-xs"]{font-size:11px!important}

/* Header — prototype D (22 Oct) */
.hmd .topctl{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.hmd .headband.hb-d{display:flex;align-items:flex-end;justify-content:space-between;gap:1.5rem;flex-wrap:wrap;padding:1.4rem 1.6rem}
.hmd .hb-d .who .hi{font-size:24px;letter-spacing:-.01em}
.hmd .hb-d .who .sub{font-size:13px;margin-top:.35rem}
.hmd .hb-due{font-weight:500;color:#B7791F}
.hmd .hb-link{border:none;background:none;padding:0;font:inherit;color:var(--brand-ink);cursor:pointer}
.hmd .hb-link:hover{text-decoration:underline}
.hmd .hb-viewing{display:inline-block;margin-top:.5rem;font-size:12px;color:var(--brand-ink);background:var(--brand-soft);border-radius:8px;padding:.25rem .6rem;text-decoration:none}
.hmd .hb-nums{display:flex;align-items:flex-end;gap:2rem;flex-wrap:wrap}
.hmd .hb-nums .stat .n{font-size:24px;font-weight:500;line-height:1.1}
.hmd .hb-nums .stat .k{font-size:12px;color:var(--muted);margin-top:.2rem;text-transform:none;letter-spacing:0}
.hmd .hb-report{align-self:center}

/* Task list — prototype D: wider column, quiet rows, day groups */
.hmd .work{grid-template-columns:minmax(330px,.8fr) 2fr;gap:1.25rem;margin-top:1rem}
.hmd .tasklist{gap:.15rem}
.hmd .tgrp{font-size:11.5px;font-weight:500;color:var(--muted);padding:.8rem .7rem .3rem}
.hmd .tgrp:first-child{padding-top:.2rem}
.hmd .task,.hmd .task.duetoday,.hmd .task.overdue{border:1px solid transparent;background:transparent;border-radius:10px;padding:.65rem .75rem}
.hmd .task:hover,.hmd .task.duetoday:hover,.hmd .task.overdue:hover{background:var(--panel-2);border-color:transparent}
.hmd .task.sel,.hmd .task.duetoday.sel,.hmd .task.overdue.sel{background:var(--brand-soft);border-color:transparent;box-shadow:none}
.hmd .task .tt{font-size:13.5px}
.hmd .task .mm{margin:.15rem 0 0}
.hmd .task.high .tt::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:#E11D48;margin-right:6px;vertical-align:middle}

/* Wider page (Praveen, 22 Oct): My Day sat centred at its content width with ~245px
   empty on each side. It now fills the space, keeping about a quarter of that gap. */
.preview-scope.hmd{flex:1;min-width:0;margin-inline:0}
.hmd .main{padding-inline:clamp(1rem,3.2vw,3.75rem)}

/* Task panel — prototype D (22 Oct): one column, room to breathe */
.hmd .work .detail{padding:1.6rem 1.9rem}
.hmd .tb-d .d-head{align-items:flex-start}
.hmd .tb-d .d-sub{font-size:12.5px;color:var(--muted);margin:0 0 .35rem}
.hmd .tb-d .d-title{font-size:21px;font-weight:500;line-height:1.25;color:var(--ink)}
.hmd .hist-btn{flex-shrink:0;display:inline-flex;align-items:center;gap:.35rem}
.hmd .hist-btn.on{background:var(--brand-soft);border-color:#D5DBF8;color:var(--brand-ink)}
.hmd .d-actions{margin-top:1.1rem}
.hmd .d-actions .status-box{text-align:left}
.hmd .d-actions .status-row{justify-content:flex-start}
.hmd .d-tools{display:flex;gap:.15rem;flex-wrap:wrap;margin-top:.55rem;align-items:center}
.hmd .d-tools .btn.sm:not(.primary){border-color:transparent;background:transparent;color:var(--ink-soft);padding-left:.5rem;padding-right:.5rem}
.hmd .d-tools .btn.sm:not(.primary):hover{background:var(--panel-2)}
.hmd .tb-d .meta-grid{margin-top:1.4rem !important;padding:1.1rem 0;gap:1.2rem 1.6rem;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.hmd .tb-d .section-head,.hmd .tb-d .section-lbl{margin-top:1.7rem}
.hmd .tb-d .section-lbl{font-size:13px;text-transform:none;letter-spacing:0;color:var(--ink);font-weight:500}
.hmd .tb-d .brief{background:#FAFBFD;padding:1rem 1.1rem;font-size:13.5px;line-height:1.75}
/* History & comments drawer */
.hmd .hist-drawer{position:fixed;top:0;right:0;bottom:0;width:min(400px,92vw);background:var(--panel);border-left:1px solid var(--line);z-index:80;display:flex;flex-direction:column;animation:histIn .2s ease}
@keyframes histIn{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
.hmd .hist-drawer-h{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.2rem;border-bottom:1px solid var(--line);font-size:14px}
.hmd .hist-drawer-b{flex:1;overflow:auto;padding:1rem 1.2rem}
.hmd .d-tools .btn.sm:not(.primary){border-color:transparent !important}
.hmd .tb-d .meta-grid + *{margin-top:0}

/* Creatives & files / References cards — prototype D (22 Oct) */
.hmd .up-card{border:1px solid var(--line);border-radius:14px;margin-top:1.4rem;background:var(--panel)}
.hmd .up-h{display:flex;align-items:center;gap:.6rem;padding:.8rem 1rem;border-bottom:1px solid var(--line)}
.hmd .up-ico{width:30px;height:30px;border-radius:9px;background:var(--brand-soft);color:var(--brand);display:grid;place-items:center;flex:0 0 auto}
.hmd .up-h b{font-size:14px;font-weight:500;color:var(--ink)}
.hmd .up-cnt{font-size:12px;color:var(--muted)}
.hmd .up-btn{margin-left:auto;display:inline-flex;align-items:center;gap:.35rem;cursor:pointer}
.hmd .up-b{padding:.9rem 1rem 1rem;display:flex;flex-direction:column;gap:.8rem}
.hmd .up-drop{display:flex;align-items:center;gap:.8rem;border:1.5px dashed #C8D0F5;background:#F7F8FE;border-radius:12px;padding:.85rem 1rem;cursor:pointer}
.hmd .up-drop:hover{border-color:var(--brand)}
.hmd .up-ci{width:40px;height:40px;border-radius:50%;background:var(--panel);border:1px solid #DCE2FA;color:var(--brand);display:grid;place-items:center;flex:0 0 auto}
.hmd .up-dt{display:block;font-weight:500;font-size:13.5px;color:var(--ink)}
.hmd .up-browse{color:var(--brand)}
.hmd .up-ds{display:block;font-size:12px;color:var(--muted);margin-top:2px}
.hmd .up-tiles{display:flex;gap:.7rem;flex-wrap:wrap}
.hmd .up-tile{position:relative;width:118px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--panel)}
.hmd .up-im{display:block;height:118px;background-size:contain;background-repeat:no-repeat;background-position:center;background-color:#E3E6EE;position:relative}
.hmd .up-im.clk{cursor:zoom-in}
.hmd .up-doc{display:grid;place-items:center;height:100%;color:var(--muted)}
.hmd .up-play{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-size:20px;text-shadow:0 1px 6px rgba(0,0,0,.4)}
.hmd .up-nm{font-size:11.5px;padding:.4rem .5rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink-soft)}
.hmd .up-n{position:absolute;top:6px;left:6px;font-size:10.5px;background:rgba(35,45,66,.6);color:#fff;border-radius:5px;padding:0 5px}
.hmd .up-x{position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:6px;border:none;background:rgba(35,45,66,.6);color:#fff;font-size:11px;display:grid;place-items:center;cursor:pointer;opacity:0;transition:opacity .12s}
.hmd .up-tile:hover .up-x{opacity:1}
.hmd .up-add{width:118px;height:150px;border:1.5px dashed #C8D0F5;background:#F7F8FE;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;text-align:center}
.hmd .up-add:hover{border-color:var(--brand)}
.hmd .up-add-t{font-size:12.5px;font-weight:500;color:var(--brand)}
.hmd .up-add-s{font-size:11px;color:var(--muted)}
.hmd .up-linkin{display:flex;align-items:center;gap:.5rem;border:1px solid var(--line);border-radius:10px;padding:4px 4px 4px 12px;background:var(--panel)}
.hmd .up-linkin:focus-within{border-color:var(--brand)}
.hmd .up-linkic{color:var(--muted);flex:0 0 auto}
.hmd .up-linkin input{flex:1;min-width:0;border:none;outline:none;background:transparent;font:inherit;font-size:13px;color:var(--ink)}
.hmd .up-lrow{display:flex;align-items:center;gap:.6rem;border:1px solid var(--line);border-radius:10px;padding:.55rem .75rem;font-size:12.5px}
.hmd .up-host{font-size:11px;font-weight:500;color:var(--brand-ink);background:var(--brand-soft);border-radius:6px;padding:2px 7px;flex:0 0 auto}
.hmd .up-u{flex:1;min-width:0;color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none}
.hmd .up-u:hover{color:var(--brand-ink);text-decoration:underline}
.hmd .up-act{font-size:12px;font-weight:500;color:var(--ink-soft);background:none;border:none;cursor:pointer;text-decoration:none;padding:2px 4px}
.hmd .up-act:hover{color:var(--brand-ink)}
.hmd .up-act.red{color:#C0392B}

/* My report panel */
.hmd .rpt-bg{position:fixed;inset:0;background:rgba(35,45,66,.18);z-index:90}
.hmd .rpt-panel{position:absolute;top:0;right:0;bottom:0;width:min(440px,94vw);background:var(--panel);border-left:1px solid var(--line);padding:1.4rem 1.5rem;overflow:auto;animation:histIn .2s ease}
.hmd .rpt-h{display:flex;justify-content:space-between;align-items:flex-start}
.hmd .rpt-h b{font-size:18px;font-weight:500;color:var(--ink)}
.hmd .rpt-rng{display:flex;gap:.35rem;flex-wrap:wrap;margin-top:1rem}
.hmd .rpt-rng button{font:inherit;font-size:12px;font-weight:500;padding:.32rem .7rem;border-radius:99px;border:1px solid var(--line);background:var(--panel);color:var(--ink-soft);cursor:pointer}
.hmd .rpt-rng button.on{background:var(--brand);border-color:var(--brand);color:#fff}
.hmd .rpt-cust{display:flex;align-items:center;gap:.45rem;margin-top:.7rem;font-size:12.5px;color:var(--muted)}
.hmd .rpt-cust input{font:inherit;font-size:12.5px;border:1px solid var(--line);border-radius:8px;padding:.3rem .5rem;color:var(--ink);background:var(--panel)}
.hmd .rpt-tot{display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem;margin:1.1rem 0 1rem}
.hmd .rpt-tot>div{background:var(--panel-2);border-radius:10px;padding:.7rem .8rem}
.hmd .rpt-tot .n{font-size:19px;font-weight:500;white-space:nowrap}
.hmd .rpt-tot .n.g{color:#1AA053}.hmd .rpt-tot .n.w{color:#B7791F}
.hmd .rpt-tot .k{font-size:11.5px;color:var(--muted)}
.hmd .rpt-day{display:flex;justify-content:space-between;font-size:12px;font-weight:500;color:var(--ink);margin:1rem 0 .2rem}
.hmd .rpt-day span:last-child{color:var(--muted);font-weight:400}
.hmd .rpt-it{display:flex;gap:.8rem;padding:.65rem 0;border-bottom:1px solid var(--line)}
.hmd .rpt-tm{width:96px;flex:0 0 auto;font-size:11.5px;color:var(--muted);padding-top:2px}
.hmd .rpt-t{font-weight:500;font-size:13px;color:var(--ink)}
.hmd .rpt-s{font-size:12px;color:var(--muted);margin-top:2px}
.hmd .rpt-acts{display:flex;gap:.5rem;margin-top:1.2rem}

/* Compact sizes (Praveen, 22 Oct: "everything looks big") — match the rest of the
   dashboard: 18px greeting, 16px titles, 13px body. */
.hmd .headband.hb-d{padding:1rem 1.25rem;gap:1rem}
.hmd .hb-d .who .hi{font-size:18px}
.hmd .hb-d .who .sub{font-size:12.5px;margin-top:.2rem}
.hmd .hb-nums{gap:1.5rem}
.hmd .hb-nums .stat .n{font-size:18px}
.hmd .hb-nums .stat .k{font-size:11.5px}
.hmd .work{gap:1rem;margin-top:.8rem}
.hmd .vpick-btn{padding:.45rem .65rem;font-size:12.5px}
.hmd .task,.hmd .task.duetoday,.hmd .task.overdue{padding:.5rem .65rem}
.hmd .task .tt{font-size:13px}
.hmd .task .mm{font-size:11.5px}
.hmd .tgrp{font-size:11px;padding:.6rem .65rem .2rem}
.hmd .work .detail{padding:1.15rem 1.35rem}
.hmd .tb-d .d-title{font-size:16px}
.hmd .tb-d .d-sub{font-size:12px;margin-bottom:.2rem}
.hmd .d-actions{margin-top:.8rem}
.hmd .tb-d .meta-grid{margin-top:1rem !important;padding:.8rem 0;gap:.8rem 1.2rem}
.hmd .tb-d .section-head,.hmd .tb-d .section-lbl{margin-top:1.2rem}
.hmd .tb-d .section-lbl{font-size:12.5px}
.hmd .tb-d .brief{padding:.75rem .9rem;font-size:13px;line-height:1.6}
.hmd .up-card{margin-top:1rem;border-radius:12px}
.hmd .up-h{padding:.6rem .85rem}
.hmd .up-ico{width:26px;height:26px;border-radius:8px}
.hmd .up-h b{font-size:13px}
.hmd .up-b{padding:.7rem .85rem .8rem;gap:.6rem}
.hmd .up-drop{padding:.6rem .8rem;gap:.65rem}
.hmd .up-ci{width:32px;height:32px}
.hmd .up-dt{font-size:13px}
.hmd .up-tile{width:96px}
.hmd .up-im{height:96px}
.hmd .up-add{width:96px;height:126px}
.hmd .up-lrow{padding:.45rem .65rem}
.hmd .rpt-panel{padding:1.1rem 1.2rem}
.hmd .rpt-h b{font-size:16px}
.hmd .rpt-tot .n{font-size:16px}
.hmd .rpt-t{font-size:12.5px}
.hmd .hist-drawer-h{padding:.8rem 1rem;font-size:13px}

/* History & comments inside the task panel (Praveen, 22 Oct) — a right-hand column
   that appears when opened, instead of a drawer over the whole screen. */
.hmd .tb-d.hopen{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:1.2rem;align-items:start}
.hmd .tb-d .hist-drawer{position:sticky;top:0;bottom:auto;right:auto;width:auto;max-height:calc(100vh - 4rem);z-index:auto;border:1px solid var(--line);border-radius:12px;animation:none}

.hmd .hb-nums .stat .n.w{color:#B7791F}
.hmd .stat-btn{border:none;background:none;font:inherit;text-align:left;cursor:pointer;padding:0;border-radius:8px}
.hmd .stat-btn:disabled{cursor:default}
.hmd .stat-btn:not(:disabled):hover .k,.hmd .stat-btn.on .k{color:var(--brand-ink);text-decoration:underline}

/* Today's plan folded to a progress bar (Praveen, 22 Oct) */
.hmd .plan-mini{display:block;width:100%;text-align:left;font:inherit;cursor:pointer;border:1px solid var(--line)}
.hmd .plan-mini:hover{border-color:#C9CEDA}
.hmd .plan-mini-h{display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap;font-size:13px;color:var(--ink)}
.hmd .plan-mini-h b{font-weight:500}
.hmd .plan-mini-car{display:inline-block;color:var(--muted);transition:transform .15s;font-size:15px;line-height:1}
.hmd .plan-mini-car.open{transform:rotate(90deg);margin-right:.35rem}
.hmd .plan-mini-open{margin-left:auto;font-size:12px;font-weight:500;color:var(--brand-ink)}
.hmd .plan-bar{position:relative;height:8px;border-radius:99px;background:#EEF0F4;overflow:hidden;margin-top:.7rem}
.hmd .plan-bar i{position:absolute;top:0;bottom:0;display:block}
.hmd .plan-bar .pb-reel{background:var(--brand)}
.hmd .plan-bar .pb-reel.high{background:#E11D48}
.hmd .plan-bar .pb-done{background:#C9CEDA}
.hmd .plan-bar .pb-lunch{background:repeating-linear-gradient(45deg,#E3E6EE,#E3E6EE 4px,#D5DAE5 4px,#D5DAE5 8px)}
.hmd .plan-bar .pb-buffer{background:#E9ECF2}
.hmd .plan-bar .pb-now{width:2px;background:#E11D48}
.hmd .plan-mini-ticks{display:flex;justify-content:space-between;font-size:10.5px;color:var(--faint);margin-top:.3rem}
.hmd .plan-fold{display:inline-flex;align-items:center;border:none;background:none;padding:0;font:inherit;cursor:pointer;color:inherit}

/* Header: big greeting, date + IST time lines, report button with icon (22 Oct) */
.hmd .hb-d .who .hi{font-size:26px}
.hmd .hb-d .who .sub{font-size:13px;margin-top:.25rem}
.hmd .headband.hb-d{align-items:center}
.hmd .hb-nums{align-items:center}
.hmd .hb-report{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;align-self:center}

/* Task panel (Praveen, 22 Oct): one line of controls on top, all the size of the
   History & comments button; the title under it is the heading. */
.hmd .d-bar{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;padding-bottom:.9rem;margin-bottom:1rem;border-bottom:1px solid var(--line)}
.hmd .d-bar .status-row{justify-content:flex-start;gap:.4rem;flex-wrap:wrap}
.hmd .d-bar .d-tools{margin:0;gap:.4rem}
.hmd .d-bar .hist-btn{margin-left:auto}
.hmd .d-bar .btn.sm,.hmd .d-bar .cap,.hmd .d-bar .sw-btn,.hmd .d-bar .status-dd-btn{height:34px;font-size:13px;padding:0 .8rem;border-radius:9px;line-height:1;box-sizing:border-box}
.hmd .d-bar .status-dd-btn,.hmd .d-bar .ui-dd-btn{padding-right:1.7rem}
.hmd .d-bar .ui-dd-btn,.hmd .d-bar .cap *{font-size:13px}
.hmd .d-bar .d-tools .btn.sm:not(.primary){border:1px solid var(--line) !important;background:var(--panel);color:var(--ink-soft)}
.hmd .d-bar .d-tools .btn.sm:not(.primary):hover{background:var(--panel-2)}
.hmd .tb-d .d-head-main .d-sub{font-size:13px;margin:0 0 .3rem}
.hmd .tb-d .d-head-main .d-title{font-size:24px;font-weight:500;line-height:1.25;letter-spacing:-.01em}

/* Due-date tint on the task list — a soft wash from the left, not a red row:
   overdue and due today in red, due tomorrow in amber (22 Oct). */
.hmd .task.overdue{background:linear-gradient(90deg,rgba(225,29,72,.13),rgba(225,29,72,0) 60%)}
.hmd .task.duetoday{background:linear-gradient(90deg,rgba(225,29,72,.08),rgba(225,29,72,0) 55%)}
.hmd .task.duetomorrow{background:linear-gradient(90deg,rgba(183,121,31,.10),rgba(183,121,31,0) 55%)}
.hmd .task.overdue:hover,.hmd .task.duetoday:hover,.hmd .task.duetomorrow:hover{background-color:var(--panel-2)}
.hmd .task.sel.overdue,.hmd .task.sel.duetoday,.hmd .task.sel.duetomorrow{background:var(--brand-soft)}

/* Dark theme for the newer pieces (Nikhil's screen, 22 Oct): they used fixed light
   colours, so the brief, the upload boxes and the plan bar stayed white in dark. */
html[data-theme="dark"] .hmd .tb-d .brief{background:var(--panel-2)}
html[data-theme="dark"] .hmd .up-drop,html[data-theme="dark"] .hmd .up-add{background:var(--panel-2);border-color:#3A4159}
html[data-theme="dark"] .hmd .up-im{background-color:#272C3E}
html[data-theme="dark"] .hmd .plan-mini:hover{border-color:#3A4159}
html[data-theme="dark"] .hmd .plan-bar{background:var(--line)}
html[data-theme="dark"] .hmd .plan-bar .pb-done{background:#4A5270}
html[data-theme="dark"] .hmd .plan-bar .pb-lunch{background:repeating-linear-gradient(45deg,#272C3E,#272C3E 4px,#323950 4px,#323950 8px)}
html[data-theme="dark"] .hmd .plan-bar .pb-buffer{background:#262B3C}
.hmd .plan-mini:focus{outline:none}
.hmd .plan-mini:focus-visible{outline:2px solid var(--brand);outline-offset:2px}

/* The status button now sits at the left edge, so its menu opens to the right. */
.hmd .d-bar .status-dd-menu{left:0;right:auto}

/* Completed by me as a table (22 Oct) */
.hmd .done-tbl{margin-top:.6rem;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.hmd .done-tr{display:grid;grid-template-columns:minmax(0,2.6fr) minmax(0,1fr) minmax(0,1.3fr) 96px 84px 96px;gap:1rem;align-items:center;padding:.6rem 1rem;font-size:13px;color:var(--ink-soft)}
.hmd .done-tr>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hmd .done-th{background:var(--panel-2);font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding-top:.5rem;padding-bottom:.5rem}
.hmd .done-row{border-top:1px solid var(--line)}
.hmd .done-row>.done-tr{cursor:pointer}
.hmd .done-row>.done-tr:hover{background:var(--panel-2)}
.hmd .done-row.on>.done-tr{background:var(--brand-soft)}
.hmd .done-title{display:flex;flex-direction:column;gap:1px}
.hmd .done-title b{font-weight:500;color:var(--ink);overflow:hidden;text-overflow:ellipsis}
.hmd .done-title i{font-style:normal;font-size:11.5px;color:var(--muted)}
.hmd .done-st{font-style:normal;font-size:11.5px;font-weight:500;border-radius:99px;padding:.15rem .55rem}
.hmd .done-st.pub{background:var(--tone-good-bg,#E3F5EA);color:var(--tone-good-fg,#157F3C)}
.hmd .done-st.ready{background:var(--brand-soft);color:var(--brand-ink)}
.hmd .done-date{font-variant-numeric:tabular-nums;color:var(--muted)}
.hmd .done-tr a{color:var(--brand-ink);text-decoration:none;font-weight:500}
.hmd .done-tr a:hover{text-decoration:underline}
.hmd .done-none{color:var(--faint)}
.hmd .done-open{padding:.8rem 1rem 1rem;border-top:1px solid var(--line)}
@media(max-width:900px){.hmd .done-tr{grid-template-columns:minmax(0,1fr) 90px}.hmd .done-tr>span:not(:first-child):not(:nth-child(4)){display:none}}

/* Upload tiles in flight (22 Oct) */
.hmd .up-pend .up-im{background-color:var(--panel-2);background-size:contain;background-repeat:no-repeat;background-position:center;position:relative}
.hmd .up-pend .up-im::after{content:"";position:absolute;inset:0;background:rgba(20,24,40,.38)}
.hmd .up-pend.done .up-im::after{background:rgba(20,24,40,.15)}
.hmd .up-ring{position:absolute;inset:0;display:grid;place-items:center;z-index:1}
.hmd .up-ring-ok,.hmd .up-ring-x{width:30px;height:30px;border-radius:99px;display:grid;place-items:center;font-size:15px;color:#fff;background:var(--brand)}
.hmd .up-ring-x{background:#C0392B}
.hmd .up-pend.err{border-color:#F3C6CE}
.hmd .up-pend .up-nm{color:var(--muted)}

/* Shared files card (components/FilesCard) sits where the up-cards were */
.hmd .up-wrap{margin-top:1rem}

/* Brand (SBU) next to the task type — list rows and the task header (23 Oct). */
.hmd .sbu-chip,.hmd .type-chip{display:inline-block;padding:.05rem .45rem;border-radius:999px;background:var(--brand-light,#E9ECFB);color:#2138B0;font-size:11px;font-weight:500;line-height:1.5;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;min-width:0}
.hmd .type-chip{background:var(--tone-muted-bg,#F0F2F8);color:var(--ink-soft);flex:none}
.hmd .sbu-chip.lg,.hmd .type-chip.lg{font-size:12px;padding:.1rem .55rem}
.hmd .mm:has(.sbu-chip,.type-chip),.hmd .d-sub:has(.sbu-chip,.type-chip){display:flex;align-items:center;gap:.35rem;min-width:0}
.hmd .task > .mm{margin:.4rem 0 0}
/* Breathing room: title and New on one line, chips and date on the next, with air between (4 Nov). */
.hmd .task,.hmd .task.duetoday,.hmd .task.overdue{padding:.8rem .9rem}
.hmd .task > .mm{margin:.6rem 0 0}
.hmd .task > .mm:has(.mm-date){display:flex;align-items:center;gap:.35rem;min-width:0}
.hmd .task > .mm .mm-date{margin-left:auto;flex:none;padding-left:.5rem}
.hmd .reel-size{font-size:12px;color:var(--muted);margin:.35rem .15rem 0}
.hmd .reel-size.bad{color:#C03221}
html[data-theme="dark"] .hmd .sbu-chip{background:#2C3666;color:#93A3FF}
`;
