"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_STATUS, TASK_STATUSES } from "@/lib/statuses";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  IconSparkles, IconCheck, IconAlertTriangle, IconCircleCheck, IconCopy, IconExternalLink,
  IconShieldCheck, IconRefresh, IconX,
} from "@tabler/icons-react";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { Overlay } from "@/app/(dashboard)/dashboard/preview/Overlay";
import { useSbus } from "@/lib/use-sbus";
import { CONTENT_TYPES } from "@/lib/mh-content-types";
import { useTeam } from "@/lib/use-team";

// Create — one thing from the Radar becoming one task on the board.
//
// The tab this replaces opened with six trending cards (a second, worse Content Radar),
// a research box that warned you it cost money, and a table of AI jobs with a Status
// column. The thing it did best — checking whether the headline was even true — was at
// the bottom of a modal, where it could not stop anyone writing the wrong post.
//
// Now it is one piece of work and five steps, in the order the work actually happens:
// check it, decide what it is, write it, read it, file it.

type FactCheck = { verdict: "ok" | "careful" | "wrong"; summary: string; facts: string[]; citations: string[] };
type Step = 1 | 2 | 3 | 4 | 5;

const VERDICT: Record<FactCheck["verdict"], { label: string; cls: string; ring: string }> = {
  ok:      { label: "Checks out",      cls: "bg-[#E3F5EA] text-[#0F6E3C]", ring: "border-[#BFE6CD] bg-[#F4FBF7]" },
  careful: { label: "Careful",         cls: "bg-[#FDF6E7] text-[#8A5A00]", ring: "border-[#F3DCB4] bg-[#FDFBF5]" },
  wrong:   { label: "Don't post this", cls: "bg-[#FBE7E4] text-[#C03221]", ring: "border-[#F1C4BD] bg-[#FFF9F8]" },
};

export function StudioCreate({ playbooks }: { playbooks: { slug: string; name: string }[] }) {
  const sbus = useSbus();   // live brand list (sql/027)
  const sp = useSearchParams();

  // The item under the knife. Arrives from a Radar "Write this", or typed here.
  const [title, setTitle] = useState(sp.get("title") || "");
  const [url, setUrl] = useState(sp.get("url") || "");
  const [source, setSource] = useState(sp.get("source") || "");
  const [started, setStarted] = useState(!!sp.get("title"));

  const [check, setCheck] = useState<FactCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [format, setFormat] = useState<string>("Carousel");
  const [brand, setBrand] = useState<string>(sp.get("sbu") || "General Content");
  const [playbook, setPlaybook] = useState<string>("");
  const [extra, setExtra] = useState("");

  const [draft, setDraft] = useState("");
  const [writing, setWriting] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [review, setReview] = useState(false);

  const brief = useMemo(() => ({
    title, url: url || null, source: source || null, format, brand,
    playbook: playbook || null, facts: check?.facts, factSummary: check?.summary,
    citations: check?.citations, extra: extra || null,
  }), [title, url, source, format, brand, playbook, check, extra]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch("/api/content/studio", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "same-origin", body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
    return d;
  }, []);

  const runCheck = useCallback(async () => {
    if (!title.trim()) return;
    setChecking(true); setErr(null);
    try { setCheck(await post({ step: "check", title, url: url || undefined })); }
    catch (e) { setErr((e as Error).message); }
    finally { setChecking(false); }
  }, [title, url, post]);

  // Checked automatically on arrival: the check is the reason to be on this page, and a
  // button labelled "check the facts" is one nobody presses when they are in a hurry —
  // which is exactly when a wrong headline gets published.
  useEffect(() => {
    if (started && title && !check && !checking) void runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  const runWrite = useCallback(async () => {
    setWriting(true); setErr(null);
    try { setDraft(((await post({ step: "write", brief })) as { text: string }).text); }
    catch (e) { setErr((e as Error).message); }
    finally { setWriting(false); }
  }, [brief, post]);

  const copyPrompt = useCallback(async (open: boolean) => {
    try {
      const p = prompt || ((await post({ step: "prompt", brief })) as { prompt: string }).prompt;
      setPrompt(p);
      await navigator.clipboard.writeText(p);
      setCopied(true); setTimeout(() => setCopied(false), 2500);
      if (open) window.open("https://claude.ai/new", "_blank", "noopener");
    } catch (e) { setErr((e as Error).message); }
  }, [prompt, brief, post]);

  const step: Step = !check ? 1 : !draft ? (format && brand ? 3 : 2) : 5;

  if (!started) return <StartHere title={title} setTitle={setTitle} onStart={() => setTitle((t) => (t.trim() ? (setStarted(true), t) : t))} />;

  return (
    <div className="space-y-3">
      <StartStrip onReset={() => { setStarted(false); setTitle(""); setUrl(""); setSource(""); setCheck(null); setDraft(""); }} />

      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        {/* What we're working on */}
        <div className="px-5 py-4 flex items-start gap-3">
          <span className="w-9 h-9 rounded-lg border border-gray-100 grid place-items-center shrink-0 bg-white">
            <IconSparkles size={17} className="text-brand" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[#232D42] leading-snug">{title}</h2>
            <div className="text-[12px] text-[#A6ACBE] mt-0.5">
              {source && <>{source} · </>}
              {url ? <a href={url} target="_blank" rel="noreferrer" className="hover:text-brand">open original</a> : "typed here"}
            </div>
          </div>
        </div>

        {/* 1 — the check */}
        <StepRow n={1} done={!!check} title="Checked the facts"
          sub="Perplexity reads the live sources before anybody writes a word.">
          {checking && <div className="text-[13px] text-[#8A92A6]">Reading the live sources…</div>}
          {!checking && check && (
            <>
              <div className={`rounded-xl border px-3.5 py-3 ${VERDICT[check.verdict].ring}`}>
                <span className={`inline-block text-[10px] font-semibold px-2 py-[2px] rounded-full mb-1.5 ${VERDICT[check.verdict].cls}`}>
                  {VERDICT[check.verdict].label}
                </span>
                <p className="text-[13px] text-[#3B4457] leading-relaxed">{check.summary}</p>
                {check.facts.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {check.facts.map((f, i) => (
                      <li key={i} className="text-[12.5px] text-[#4A5468] flex gap-1.5">
                        <IconCheck size={13} className="text-[#0F6E3C] shrink-0 mt-[3px]" /><span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2 text-[11.5px] text-[#A6ACBE]">
                {check.citations.length > 0 && <span>Read {check.citations.length} sources</span>}
                {check.citations.slice(0, 3).map((c) => (
                  <a key={c} href={c} target="_blank" rel="noreferrer" className="text-brand hover:underline truncate max-w-[16ch]">
                    {hostOf(c)}
                  </a>
                ))}
                <button onClick={runCheck} className="ml-auto inline-flex items-center gap-1 hover:text-brand">
                  <IconRefresh size={12} /> check again
                </button>
              </div>
            </>
          )}
          {!checking && !check && (
            <button onClick={runCheck} className="text-[13px] font-medium bg-brand text-white rounded-lg px-3.5 py-1.5 hover:bg-brand-dark">
              <IconShieldCheck size={14} className="inline -mt-0.5 mr-1" />Check the facts
            </button>
          )}
        </StepRow>

        {/* 2 — what are we making */}
        <StepRow n={2} done={step > 2} title="What are we making?"
          sub="Your own Content Calendar types — the same list the task will carry.">
          <div className="flex gap-2.5 flex-wrap">
            <Field label="Format">
              <PreviewSelect value={format} onChange={setFormat}
                options={CONTENT_TYPES.map((t) => ({ value: t, label: t }))} />
            </Field>
            <Field label="Primary Interest">
              <PreviewSelect value={brand} onChange={setBrand}
                options={sbus.map((s) => ({ value: s, label: s }))} />
            </Field>
            <Field label="Angle — from Playbooks">
              <PreviewSelect value={playbook} onChange={setPlaybook}
                options={[{ value: "", label: "No playbook — write it plain" },
                          ...playbooks.map((p) => ({ value: p.slug, label: p.name }))]} />
            </Field>
          </div>
          <input value={extra} onChange={(e) => setExtra(e.target.value)}
            placeholder="Anything to add in your own words — optional"
            className="w-full mt-2.5 text-[13px] px-3 py-2 rounded-lg border border-[#D9DEEA] bg-white focus:border-brand outline-none" />
        </StepRow>

        {/* 3 — write it */}
        <StepRow n={3} done={!!draft} title="Write it"
          sub="Claude writes from the brief and the checked facts. Or take the prompt and work in the Claude app.">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={runWrite} disabled={writing || !title}
              className="text-[13px] font-semibold bg-brand text-white rounded-lg px-4 py-2 hover:bg-brand-dark disabled:opacity-50">
              <IconSparkles size={14} className="inline -mt-0.5 mr-1" />
              {writing ? "Claude is writing…" : draft ? "Write it again" : "Write it with Claude"}
            </button>
            <button onClick={() => copyPrompt(true)}
              className="text-[12.5px] font-medium bg-white border border-gray-200 text-[#4A5468] rounded-lg px-3 py-2 hover:border-brand hover:text-brand">
              <IconExternalLink size={13} className="inline -mt-0.5 mr-1" />Open in Claude app
            </button>
            <button onClick={() => copyPrompt(false)}
              className="text-[12.5px] text-[#8A92A6] hover:text-brand px-1">
              <IconCopy size={13} className="inline -mt-0.5 mr-1" />{copied ? "Copied" : "Copy prompt"}
            </button>
          </div>
          {writing && <p className="text-[12px] text-[#A6ACBE] mt-2">Usually 10-20 seconds.</p>}
        </StepRow>

        {/* 4 — the copy */}
        <StepRow n={4} done={!!draft.trim()} title="The copy"
          sub="Edit it here. Whatever is in this box is what lands on the task.">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder="Claude's draft appears here — or paste your own."
            className="w-full min-h-[150px] text-[13px] leading-relaxed px-3 py-2.5 rounded-lg border border-[#D9DEEA] bg-white focus:border-brand outline-none font-mono" />
        </StepRow>

        {/* 5 — file it */}
        <StepRow n={5} done={false} title="Send it to the board" last
          sub="Creates the Content Calendar task with the copy, the source link and the fact-check on it.">
          <button onClick={() => setReview(true)} disabled={!draft.trim()}
            className="text-[13px] font-semibold bg-brand text-white rounded-lg px-4 py-2 hover:bg-brand-dark disabled:opacity-50">
            Review &amp; create task
          </button>
          <span className="text-[12px] text-[#A6ACBE] ml-2">Nothing is created until you have seen every field.</span>
        </StepRow>
      </div>

      {err && (
        <div className="flex items-start gap-2 bg-[#FBE7E4] border border-[#F1C4BD] rounded-xl px-3.5 py-2.5">
          <IconAlertTriangle size={15} className="text-[#C03221] shrink-0 mt-0.5" />
          <span className="text-[12.5px] text-[#C03221]">{err}</span>
        </div>
      )}

      {review && (
        <ReviewSheet brief={brief} draft={draft} check={check}
          onClose={() => setReview(false)} />
      )}
    </div>
  );
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex-1 min-w-[190px] block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-[#A6ACBE] mb-1">{label}</span>
      {children}
    </label>
  );
}

function StepRow({ n, done, title, sub, children, last }: {
  n: number; done: boolean; title: string; sub: string; children: React.ReactNode; last?: boolean;
}) {
  return (
    <div className={`flex gap-3 px-5 py-4 border-t border-gray-100 ${last ? "" : ""}`}>
      <span className={`w-[22px] h-[22px] rounded-full grid place-items-center text-[11.5px] font-bold shrink-0 mt-0.5 ${
        done ? "bg-[#E3F5EA] text-[#0F6E3C]" : "bg-brand-light text-[#2138B0]"}`}>
        {done ? <IconCheck size={13} stroke={2.5} /> : n}
      </span>
      <div className="flex-1 min-w-0">
        <h3 className="text-[13.5px] font-semibold text-[#232D42]">{title}</h3>
        <p className="text-[12.5px] text-[#8A92A6] mb-2.5">{sub}</p>
        {children}
      </div>
    </div>
  );
}

// Nothing from the Radar? Type it.
function StartHere({ title, setTitle, onStart }: { title: string; setTitle: (s: string) => void; onStart: () => void }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-8">
      <div className="max-w-lg mx-auto text-center">
        <IconSparkles size={34} stroke={1.4} className="mx-auto text-gray-300 mb-3" />
        <h2 className="text-base font-medium text-[#232D42] mb-1.5">What are we writing about?</h2>
        <p className="text-[13px] text-[#8A92A6] mb-5">
          Pick something from Content Radar and press <b className="font-medium">Write this</b> — it lands here with
          its source attached. Or type a topic and start from nothing.
        </p>
        <div className="flex gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onStart(); }}
            placeholder="e.g. NEET PG counselling dates 2026"
            className="flex-1 text-[13.5px] px-3 py-2.5 rounded-lg border border-[#D9DEEA] bg-white focus:border-brand outline-none" />
          <button onClick={onStart} disabled={!title.trim()}
            className="text-[13px] font-semibold bg-brand text-white rounded-lg px-4 hover:bg-brand-dark disabled:opacity-50 whitespace-nowrap">
            Start
          </button>
        </div>
        <Link href="/dashboard/preview/radar" className="inline-block mt-4 text-[12.5px] text-brand hover:underline">
          Open Content Radar
        </Link>
      </div>
    </div>
  );
}

function StartStrip({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex items-center gap-2 bg-white border border-dashed border-[#D9DEEA] rounded-xl px-4 py-2.5 text-[13px] text-[#8A92A6]">
      <span>Working on something else?</span>
      <button onClick={onReset} className="ml-auto text-[12.5px] font-semibold text-[#4A5468] border border-gray-100 rounded-lg px-3 py-1.5 hover:border-brand hover:text-brand">
        Start something new
      </button>
    </div>
  );
}

// Nothing reaches the board unseen. Every field editable, because a value that was
// filled in for you is a guess until a person has looked at it.
function ReviewSheet({ brief, draft, check, onClose }: {
  brief: { title: string; url: string | null; source: string | null; format: string; brand: string };
  draft: string; check: FactCheck | null; onClose: () => void;
}) {
  const team = useTeam();   // the Team page roster (was lib/users.ts)
  const sbus = useSbus();   // live brand list (sql/027)
  const [particulars, setParticulars] = useState(brief.title);
  const [type, setType] = useState(brief.format);
  const [status, setStatus] = useState<string>(DEFAULT_STATUS);
  const [sbu, setSbu] = useState(brief.brand);
  const [owner, setOwner] = useState("manya");
  const [date, setDate] = useState("");
  const [caption, setCaption] = useState(draft);
  const [link, setLink] = useState(brief.url || "");
  const [facts, setFacts] = useState(check?.summary || "");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const content = [
        `From Content Studio${brief.source ? ` — ${brief.source}` : ""}`,
        link, "",
        facts ? `CHECKED: ${facts}` : "",
      ].filter(Boolean).join("\n");
      const r = await fetch("/api/marketing-hub/create", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({
          title: particulars, sbu, owner, type, content, caption, status,
          publishingDate: date || undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      setMade(d?.id || null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (made) {
    return (
      <Overlay onClose={onClose}>
        <div className="bg-white rounded-2xl w-full max-w-md p-6 text-center" onClick={(e) => e.stopPropagation()}>
          <IconCircleCheck size={34} className="text-[#0F6E3C] mx-auto mb-2" />
          <h3 className="text-[15px] font-semibold text-[#232D42] mb-1">It&apos;s on the board</h3>
          <p className="text-[13px] text-[#8A92A6] mb-4">{particulars}</p>
          <div className="flex gap-2 justify-center">
            <Link href={`/dashboard/preview/marketing-hub?tab=master&open=${made}`}
              className="text-[13px] font-semibold bg-brand text-white rounded-lg px-4 py-2 hover:bg-brand-dark">Open the task</Link>
            <button onClick={onClose} className="text-[13px] text-[#8A92A6] px-3 hover:text-[#232D42]">Done</button>
          </div>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h3 className="text-[1.05rem] font-semibold text-[#232D42]">Check this before it goes on the board</h3>
            <p className="text-[12.5px] text-[#8A92A6] mt-0.5">
              Everything here is editable. Whatever you change is what gets saved.
            </p>
          </div>
          <button onClick={onClose} className="text-[#A6ACBE] hover:text-[#232D42] text-xl leading-none -mt-1">
            <IconX size={18} />
          </button>
        </div>

        <Row label="Particulars">
          <input value={particulars} onChange={(e) => setParticulars(e.target.value)} className={INPUT} />
        </Row>
        <Row label="Type">
          <PreviewSelect value={type} onChange={setType} options={CONTENT_TYPES.map((t) => ({ value: t, label: t }))} />
        </Row>
        <Row label="Primary Interest">
          <PreviewSelect value={sbu} onChange={setSbu} options={sbus.map((s) => ({ value: s, label: s }))} />
        </Row>
        <Row label="Status" why="Where it lands on the board.">
          <PreviewSelect value={status} onChange={setStatus} options={TASK_STATUSES.map((s) => ({ value: s, label: s }))} />
        </Row>
        <Row label="Owner">
          <PreviewSelect value={owner} onChange={setOwner}
            options={team.filter((u) => u.active).map((u) => ({ value: u.id, label: u.name }))} />
        </Row>
        <Row label="Publishing date" flag={!date}
          why={!date ? "Nothing filled this in. A piece with no date is how one gets forgotten." : undefined}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
        </Row>
        <Row label="Caption" why="This is the copy that lands on the task.">
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={6}
            className={`${INPUT} font-mono text-[12.5px] leading-relaxed`} />
        </Row>
        <Row label="Source link">
          <input value={link} onChange={(e) => setLink(e.target.value)} className={INPUT} />
        </Row>
        <Row label="Fact-check" why="Travels with the task, so whoever designs it knows what not to claim.">
          <textarea value={facts} onChange={(e) => setFacts(e.target.value)} rows={2} className={INPUT} />
        </Row>

        {error && <div className="px-5 py-2 text-[12.5px] text-[#C03221]">{error}</div>}

        <div className="flex items-center gap-2 px-5 py-3.5 bg-[#FAFBFF] border-t border-gray-100">
          <span className="text-[12px] text-[#A6ACBE] mr-auto">
            Lands as <b className="font-medium text-[#8A92A6]">Content&nbsp;-&nbsp;Pending</b>.
          </span>
          <button onClick={onClose} className="text-[13px] text-[#8A92A6] px-3 hover:text-[#232D42]">Cancel</button>
          <button onClick={create} disabled={busy || !particulars.trim()}
            className="text-[13px] font-semibold bg-brand text-white rounded-lg px-4 py-2 hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Creating…" : "Create task"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

const INPUT = "w-full text-[13.5px] px-2.5 py-1.5 rounded-lg border border-transparent hover:border-gray-100 focus:border-brand focus:bg-white outline-none bg-transparent text-[#232D42] resize-y";

function Row({ label, children, why, flag }: {
  label: string; children: React.ReactNode; why?: string; flag?: boolean;
}) {
  return (
    <div className={`flex gap-4 px-5 py-2.5 border-b border-[#F3F5F9] last:border-0 ${flag ? "bg-[#FFF9F8]" : ""}`}>
      <span className="w-[110px] shrink-0 text-[12px] text-[#8A92A6] pt-2">{label}</span>
      <div className="flex-1 min-w-0">
        {children}
        {why && <p className={`text-[11.5px] mt-0.5 ml-0.5 ${flag ? "text-[#C03221]" : "text-[#A6ACBE]"}`}>{why}</p>}
      </div>
    </div>
  );
}

