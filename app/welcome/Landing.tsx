"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  IconArrowRight, IconRadar, IconSparkles, IconSun, IconCalendarEvent, IconChartBar,
  IconMessageCircle, IconRobot, IconPlus, IconMinus,
} from "@tabler/icons-react";

// GooCampus Marketing OS — public landing page (offline draft, 28 Sep).
//
// Our own page: the section order and pace were chosen with a Framer template as a
// reference (headline → card fan → curved band → what's inside → numbers → process →
// FAQ → sign in), but the design, code and every word here are GooCampus's. Colours
// are the dashboard's own (Hope UI blue, the GooCampus orange as the one accent).

const SIGN_IN = "/login";

const FEATURES = [
  { icon: IconRadar, name: "Content Radar", line: "News, rising searches and what people say about you — each one a click from a draft." },
  { icon: IconSparkles, name: "Content Studio", line: "Posts, carousels and reel scripts written from your playbooks, ready for the team to edit." },
  { icon: IconSun, name: "My Day & Workload", line: "Everyone's day laid out hour by hour, with a clock on the task in hand and nothing lost between people." },
  { icon: IconCalendarEvent, name: "Scheduler & Calendar", line: "Approved work queues itself onto Instagram, Facebook and LinkedIn at the time you pick." },
  { icon: IconChartBar, name: "Analytics", line: "Reach, engagement and followers across every channel, measured — never estimated." },
  { icon: IconMessageCircle, name: "Marketing Leads", line: "DMs and paid leads in one place, counted only once a contact is shared." },
  { icon: IconRobot, name: "Automations", line: "Who owns a task and who helps on it — set once, applied to every new task." },
];

const STEPS = [
  { n: "01", t: "Plan", d: "Pick the brand, the format and the date. The Radar suggests what's worth saying this week." },
  { n: "02", t: "Write", d: "Draft in the Studio, approve the content, and the task hands itself to the right maker." },
  { n: "03", t: "Produce", d: "Designers and editors claim their work, track their time and send it back for review." },
  { n: "04", t: "Publish & measure", d: "It goes out on schedule, and the numbers come back to the same board." },
];

const FAQ = [
  { q: "Who is this for?", a: "The GooCampus marketing team — writers, designers, video editors and the people who approve their work. Access is by invitation." },
  { q: "Does it replace Airtable?", a: "It reads your Airtable content calendar every hour and keeps the dashboard in step. Whichever side changed a task last wins." },
  { q: "Which channels does it publish to?", a: "Instagram (posts, carousels, reels and stories), Facebook and LinkedIn." },
  { q: "Can I see only my own work?", a: "Yes. My Day shows your tasks, your plan and your reminders; managers can switch to anyone's day." },
  { q: "How do I get access?", a: "Ask an admin to add you on the Team page, then sign in with your GooCampus Google account." },
];

// Fanned task cards in the hero — what a task looks like on the board.
const CARDS = [
  { brand: "12thPlus.com", type: "Carousel", status: "Content - Approved", tone: "#1AA053", title: "After 12th PCB, if not MBBS", tilt: -9, x: -150, y: 26 },
  { brand: "India NEET UG", type: "YouTube Long-Form", status: "Output - Ready", tone: "#3A57E8", title: "Round 3 result: what to do next", tilt: 0, x: 0, y: 0 },
  { brand: "Australia-PGCP", type: "Reel", status: "Scheduled · 6:30 PM", tone: "#E0791F", title: "AMC batch — reel cut", tilt: 9, x: 150, y: 26 },
];

const BAND = "153 tasks on the board  •  46 published  •  24 brands  •  13 content formats  •  one team  •  ";

export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(0);

  // Sections rise in as they scroll into view (skipped under reduced motion).
  useEffect(() => {
    const els = root.current?.querySelectorAll<HTMLElement>("[data-rise]") || [];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.15 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  return (
    <div className="gcl" ref={root}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <header className="gcl-nav">
        <a href="#top" className="gcl-logo" aria-label="GooCampus">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/goocampus-logo.png" alt="GooCampus" height={34} loading="lazy" decoding="async" />
          <span>Marketing OS</span>
        </a>
        <nav>
          <a href="#inside">What&apos;s inside</a>
          <a href="#how">How it works</a>
          <a href="#faq">FAQ</a>
        </nav>
        <Link href={SIGN_IN} className="gcl-btn gcl-btn-sm">Sign in</Link>
      </header>

      {/* HERO */}
      <section id="top" className="gcl-hero">
        <p className="gcl-eyebrow" data-rise>GooCampus Marketing OS</p>
        <h1 data-rise>Every post, from idea<br />to <em>published</em>.</h1>
        <p className="gcl-lede" data-rise>One board for the whole content team — plan it, write it, make it, publish it, and see how it did.</p>
        <div className="gcl-ctas" data-rise>
          <Link href={SIGN_IN} className="gcl-btn">Sign in <IconArrowRight size={17} stroke={2} /></Link>
          <a href="#inside" className="gcl-btn gcl-btn-ghost">See what&apos;s inside</a>
        </div>

        <div className="gcl-fan" aria-hidden="true">
          {CARDS.map((c, i) => (
            <div key={i} className="gcl-card" style={{ ["--tilt" as string]: `${c.tilt}deg`, ["--x" as string]: `${c.x}px`, ["--y" as string]: `${c.y}px`, ["--d" as string]: `${i * 90}ms` }}>
              <div className="gcl-card-top"><span>{c.brand}</span><span>{c.type}</span></div>
              <div className="gcl-card-art" style={{ background: `linear-gradient(150deg, ${c.tone}, ${c.tone}AA 55%, #232D42)` }}>
                <span className="gcl-card-title">{c.title}</span>
              </div>
              <div className="gcl-card-foot"><span className="gcl-dot" style={{ background: c.tone }} />{c.status}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CURVED BAND — our numbers, riding a gentle wave */}
      <div className="gcl-band" aria-label="153 tasks on the board, 46 published, 24 brands, 13 content formats">
        <svg viewBox="0 0 1440 160" preserveAspectRatio="none" aria-hidden="true">
          <path id="gcl-wave" d="M-40 118 C 300 30, 620 150, 900 78 S 1320 20, 1480 70" fill="none" stroke="#E0791F" strokeWidth="54" strokeLinecap="round" />
          <text className="gcl-band-text" dy="7">
            <textPath href="#gcl-wave" startOffset="0">
              {BAND.repeat(6)}
              <animate attributeName="startOffset" from="0" to="-1100" dur="26s" repeatCount="indefinite" />
            </textPath>
          </text>
        </svg>
      </div>

      {/* WHAT'S INSIDE */}
      <section id="inside" className="gcl-sec">
        <div className="gcl-sec-head" data-rise>
          <p className="gcl-eyebrow">What&apos;s inside</p>
          <h2>Seven tools. One place to work.</h2>
        </div>
        <div className="gcl-grid">
          {FEATURES.map((f, i) => (
            <article key={f.name} className="gcl-feat" data-rise style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
              <span className="gcl-feat-ic"><f.icon size={22} stroke={1.8} /></span>
              <h3>{f.name}</h3>
              <p>{f.line}</p>
            </article>
          ))}
          <article className="gcl-feat gcl-feat-cta" data-rise>
            <h3>Already on the team?</h3>
            <p>Everything above is waiting behind one sign-in.</p>
            <Link href={SIGN_IN} className="gcl-btn gcl-btn-sm">Sign in <IconArrowRight size={15} stroke={2} /></Link>
          </article>
        </div>
      </section>

      {/* NUMBERS */}
      <section className="gcl-nums" data-rise>
        {[["153", "tasks on the board"], ["46", "published"], ["24", "brands"], ["13", "content formats"]].map(([n, l]) => (
          <div key={l}><b>{n}</b><span>{l}</span></div>
        ))}
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="gcl-sec">
        <div className="gcl-sec-head" data-rise>
          <p className="gcl-eyebrow">How it works</p>
          <h2>From a brief to a live post, without the chasing.</h2>
        </div>
        <ol className="gcl-steps">
          {STEPS.map((s, i) => (
            <li key={s.n} data-rise style={{ transitionDelay: `${i * 80}ms` }}>
              <span className="gcl-step-n">{s.n}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* FAQ */}
      <section id="faq" className="gcl-sec gcl-faq-wrap">
        <div className="gcl-sec-head" data-rise>
          <p className="gcl-eyebrow">FAQ</p>
          <h2>Before you sign in.</h2>
        </div>
        <div className="gcl-faq" data-rise>
          {FAQ.map((f, i) => (
            <div key={f.q} className={`gcl-q ${open === i ? "on" : ""}`}>
              <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                <span>{f.q}</span>{open === i ? <IconMinus size={18} stroke={2} /> : <IconPlus size={18} stroke={2} />}
              </button>
              <div className="gcl-a"><p>{f.a}</p></div>
            </div>
          ))}
        </div>
      </section>

      {/* CLOSING */}
      <section className="gcl-end" data-rise>
        <h2>Your team&apos;s next post is already on the board.</h2>
        <p>Sign in with your GooCampus Google account.</p>
        <div className="gcl-ctas">
          <Link href={SIGN_IN} className="gcl-btn gcl-btn-light">Sign in <IconArrowRight size={17} stroke={2} /></Link>
          <a href="mailto:info@goocampus.in?subject=Access%20to%20GooCampus%20Marketing%20OS" className="gcl-btn gcl-btn-outline">Request access</a>
        </div>
      </section>

      <footer className="gcl-foot">
        <span>© {new Date().getFullYear()} GooCampus</span>
        <span>Marketing OS · for the GooCampus team</span>
      </footer>
    </div>
  );
}

const CSS = `
.gcl{--ink:#232D42;--soft:#4A5468;--muted:#8A92A6;--line:#E6E9F2;--canvas:#F6F7FB;--brand:#3A57E8;--brand-dark:#2138B0;--accent:#E0791F;
  background:var(--canvas);color:var(--ink);min-height:100vh;overflow-x:hidden;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
.gcl a{color:inherit;text-decoration:none}
.gcl [data-rise]{opacity:0;transform:translateY(18px);transition:opacity .7s ease,transform .7s cubic-bezier(.2,.7,.2,1)}
.gcl [data-rise].in{opacity:1;transform:none}

.gcl-nav{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:24px;padding:14px clamp(16px,4vw,48px);
  background:rgba(246,247,251,.82);backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid transparent}
.gcl-logo{display:flex;align-items:center;gap:10px;font-weight:600;font-size:14px;color:var(--soft)}
.gcl-logo img{height:34px;width:auto}
.gcl-nav nav{display:flex;gap:26px;margin:0 auto;font-size:14px;color:var(--soft)}
.gcl-nav nav a:hover{color:var(--brand)}
@media(max-width:720px){.gcl-nav nav{display:none}.gcl-nav .gcl-btn-sm{margin-left:auto}}

.gcl-btn{display:inline-flex;align-items:center;gap:8px;height:46px;padding:0 22px;border-radius:999px;background:var(--brand);color:#fff!important;
  font-weight:600;font-size:15px;transition:background .15s,transform .15s}
.gcl-btn:hover{background:var(--brand-dark);transform:translateY(-1px)}
.gcl-btn-sm{height:38px;padding:0 16px;font-size:14px}
.gcl-btn-ghost{background:transparent;color:var(--ink)!important;border:1px solid var(--line)}
.gcl-btn-ghost:hover{background:#fff}
.gcl-btn-light{background:#fff;color:var(--brand)!important}
.gcl-btn-light:hover{background:#EEF1FE}
.gcl-btn-outline{background:transparent;border:1px solid rgba(255,255,255,.55)}
.gcl-btn-outline:hover{background:rgba(255,255,255,.12)}

.gcl-eyebrow{font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:0 0 14px}
.gcl-hero{text-align:center;padding:clamp(56px,9vw,110px) 16px 0;max-width:1100px;margin:0 auto}
.gcl-hero h1{font-size:clamp(40px,7vw,84px);line-height:1.02;letter-spacing:-.035em;font-weight:600;margin:0}
.gcl-hero h1 em{font-style:normal;color:var(--brand)}
.gcl-lede{max-width:560px;margin:22px auto 0;font-size:clamp(16px,1.6vw,19px);line-height:1.55;color:var(--soft)}
.gcl-ctas{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:30px}

.gcl-fan{position:relative;height:360px;margin-top:56px}
.gcl-card{position:absolute;left:50%;top:0;width:230px;margin-left:-115px;border-radius:18px;background:#fff;border:1px solid var(--line);
  padding:12px;
  transform:translate(var(--x),var(--y)) rotate(var(--tilt));animation:gclDeal .9s cubic-bezier(.2,.8,.2,1) both;animation-delay:var(--d)}
.gcl-card:nth-child(2){z-index:2}
.gcl-card-top{display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-bottom:10px}
.gcl-card-art{height:200px;border-radius:12px;display:flex;align-items:flex-end;padding:14px}
.gcl-card-title{color:#fff;font-weight:600;font-size:17px;line-height:1.2;text-align:left}
.gcl-card-foot{display:flex;align-items:center;gap:7px;margin-top:10px;font-size:12.5px;font-weight:600;color:var(--soft)}
.gcl-dot{width:8px;height:8px;border-radius:50%}
@keyframes gclDeal{from{opacity:0;transform:translate(0,40px) rotate(0)}to{opacity:1;transform:translate(var(--x),var(--y)) rotate(var(--tilt))}}
@media(max-width:640px){.gcl-card{width:180px;margin-left:-90px}.gcl-card-art{height:150px}.gcl-card:nth-child(1){--x:-95px}.gcl-card:nth-child(3){--x:95px}.gcl-fan{height:290px}}

.gcl-band{margin:-40px 0 10px;height:170px;position:relative;z-index:3}
.gcl-band svg{width:100%;height:100%;overflow:visible}
.gcl-band-text{fill:#fff;font-size:22px;font-weight:600;letter-spacing:.01em}

.gcl-sec{max-width:1160px;margin:0 auto;padding:clamp(64px,8vw,110px) 16px 0}
.gcl-sec-head{max-width:640px}
.gcl-sec h2{font-size:clamp(30px,4.2vw,50px);line-height:1.08;letter-spacing:-.03em;margin:0;font-weight:600}
.gcl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-top:40px}
.gcl-feat{background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px;transition:transform .2s,border-color .2s}
.gcl-feat:hover{transform:translateY(-3px);border-color:#C7D0F5}
.gcl-feat-ic{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:12px;background:#EEF1FE;color:var(--brand)}
.gcl-feat h3{font-size:18px;margin:16px 0 6px;letter-spacing:-.01em;font-weight:600}
.gcl-feat p{margin:0;font-size:14.5px;line-height:1.55;color:var(--soft)}
.gcl-feat-cta{background:var(--ink);border-color:var(--ink);color:#fff}
.gcl-feat-cta p{color:#C2C8D6;margin-bottom:18px}

.gcl-nums{max-width:1160px;margin:clamp(64px,8vw,100px) auto 0;padding:0 16px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.gcl-nums div{border-top:2px solid var(--ink);padding-top:16px}
.gcl-nums b{display:block;font-size:clamp(40px,5vw,64px);letter-spacing:-.04em;line-height:1}
.gcl-nums span{font-size:14px;color:var(--soft)}
@media(max-width:720px){.gcl-nums{grid-template-columns:repeat(2,1fr);row-gap:28px}}

.gcl-steps{list-style:none;padding:0;margin:40px 0 0;display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.gcl-steps li{background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px}
.gcl-step-n{font-size:13px;font-weight:600;color:var(--accent)}
.gcl-steps h3{font-size:20px;margin:22px 0 8px;font-weight:600}
.gcl-steps p{margin:0;font-size:14.5px;line-height:1.55;color:var(--soft)}
@media(max-width:900px){.gcl-steps{grid-template-columns:repeat(2,1fr)}}
@media(max-width:520px){.gcl-steps{grid-template-columns:1fr}}

.gcl-faq-wrap{display:grid;grid-template-columns:1fr 1.4fr;gap:40px;align-items:start}
@media(max-width:860px){.gcl-faq-wrap{grid-template-columns:1fr}}
.gcl-faq{border-top:1px solid var(--line)}
.gcl-q{border-bottom:1px solid var(--line)}
.gcl-q button{width:100%;display:flex;justify-content:space-between;align-items:center;gap:16px;background:none;border:0;padding:20px 0;
  font:inherit;font-size:17px;font-weight:600;color:var(--ink);cursor:pointer;text-align:left}
.gcl-a{display:grid;grid-template-rows:0fr;transition:grid-template-rows .3s ease}
.gcl-q.on .gcl-a{grid-template-rows:1fr}
.gcl-a p{overflow:hidden;margin:0;color:var(--soft);font-size:15px;line-height:1.6}
.gcl-q.on .gcl-a p{padding-bottom:20px}

.gcl-end{max-width:1160px;margin:clamp(72px,9vw,120px) auto 0;border-radius:28px;padding:clamp(48px,7vw,90px) 24px;text-align:center;
  background:radial-gradient(120% 140% at 0% 0%,#6B7CF2 0%,var(--brand) 45%,var(--brand-dark) 100%);color:#fff}
.gcl-end h2{font-size:clamp(30px,4.4vw,54px);letter-spacing:-.03em;line-height:1.08;margin:0 auto;max-width:760px;font-weight:600}
.gcl-end p{color:rgba(255,255,255,.85);margin:16px 0 0;font-size:16px}
@media(max-width:1190px){.gcl-end{margin-left:16px;margin-right:16px}}

.gcl-foot{max-width:1160px;margin:0 auto;padding:40px 16px 48px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:13px;color:var(--muted)}

@media (prefers-reduced-motion: reduce){.gcl-card{animation:none}.gcl *{transition:none!important}}
`;
