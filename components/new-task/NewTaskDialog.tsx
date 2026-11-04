"use client";
import { useEffect, useState } from "react";
import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import { MY_DAY_CSS } from "@/app/(dashboard)/dashboard/preview/my-day/myDayCss";
import MissingFieldsModal from "@/app/(dashboard)/dashboard/preview/MissingFieldsModal";
import { NewTaskForm, type NewTaskDraft } from "./NewTaskForm";
import { CreateGateError, saveNewTask } from "./save";
import { copyTaskLink } from "@/lib/task-link";

// The create form as a dialog, for the screens that don't have My Day's right-hand
// panel to put it in — the Marketing Hub header button and the Content Calendar's
// "+" on a day.
//
// It renders the SAME <NewTaskForm/> My Day renders. The only reason a wrapper is
// needed at all is where the form is allowed to live: its styling comes from
// MY_DAY_CSS, every rule of which is scoped under `.hmd`, and inside that under
// `.detail` or `.modal-card` for the title. So the wrapper injects that stylesheet
// and reproduces the exact nesting My Day gives the form — .hmd > .modal >
// .modal-card — which is also why this looks like a My Day modal rather than a
// second modal style invented for the hub.
//
// The one thing `.hmd` does that a dialog must not inherit is paint a full-page
// background (it is normally the whole screen), so the wrapper neutralises that.
const SCOPE_CSS = `
.hmd.ntd-scope{min-height:0;background:transparent}
.hmd.ntd-scope .modal-card{max-width:560px}
.hmd.ntd-scope .ntd-end{text-align:center;padding:1.5rem .5rem .5rem}
.hmd.ntd-scope .ntd-end-title{font-size:1.05rem;font-weight:700;color:var(--ink);margin-top:.6rem}
.hmd.ntd-scope .ntd-end-sub{font-size:13.5px;color:var(--muted);margin-top:.35rem;line-height:1.5}
.hmd.ntd-scope .ntd-end-actions{display:flex;justify-content:center;gap:.6rem;margin-top:1.2rem}
.hmd.ntd-scope .ntd-warn{font-size:13px;color:var(--warn);background:var(--warn-soft);border-radius:9px;padding:.5rem .7rem;margin-top:.7rem}
`;

type Phase =
  | { k: "form" }
  | { k: "saving" }
  | { k: "done"; id: string; movedFailed: boolean }
  | { k: "error"; msg: string };

export function NewTaskDialog({ initial, onClose, onCreated }: {
  /** Pre-fills the form — the calendar's "+" on a date passes that date. */
  initial?: { publishDate?: string; sbu?: string };
  onClose: () => void;
  onCreated?: () => void;
}) {
  // Who is filing it. The form needs a writer key (the same lower-cased first name
  // PPL and the API use) to show the routing preview and to own the new row.
  const [writer, setWriter] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: "form" });
  const [copied, setCopied] = useState(false);
  const [gate, setGate] = useState<{ missing: string[]; title: string } | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (!cancel) setWriter(String(d?.user?.id || d?.user?.first || "").toLowerCase() || null); })
      .catch(() => { if (!cancel) setWriter(null); });
    return () => { cancel = true; };
  }, []);

  async function submit(draft: NewTaskDraft) {
    setPhase({ k: "saving" });
    try {
      const res = await saveNewTask(draft, writer || "");
      setPhase({ k: "done", id: res.id, movedFailed: res.statusMoveFailed });
      onCreated?.();
    } catch (e) {
      // The completeness gate names the fields, so it goes back to the form with the
      // shared popup rather than to a dead-end error screen.
      if (e instanceof CreateGateError) {
        setGate({ missing: e.missing, title: e.taskTitle });
        setPhase({ k: "form" });
        return;
      }
      setPhase({ k: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="hmd ntd-scope">
      <style dangerouslySetInnerHTML={{ __html: MY_DAY_CSS }} />
      <style dangerouslySetInnerHTML={{ __html: SCOPE_CSS }} />
      {/* Clicking the backdrop closes only while the form is untouched territory —
          during a save there is a request in flight, and after it the writer still
          needs to see what happened. */}
      <div className="modal" onClick={phase.k === "form" ? onClose : undefined}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          {phase.k === "form" && (
            writer
              ? <NewTaskForm writer={writer} initial={initial} onClose={onClose} onCreate={submit} />
              : <div className="ntd-end"><div className="ntd-end-sub">Loading…</div></div>
          )}

          {phase.k === "saving" && (
            <div className="ntd-end">
              <div className="ntd-end-title">Creating the task…</div>
              <div className="ntd-end-sub">Saving it, then attaching anything you added.</div>
            </div>
          )}

          {phase.k === "done" && (
            <div className="ntd-end">
              <IconCircleCheck size={42} stroke={1.5} style={{ color: "var(--good)" }} />
              <div className="ntd-end-title">Task created</div>
              <div className="ntd-end-sub">It is on the Content Calendar and in the owner&apos;s task list.</div>
              {/* Say it plainly when the row was created but could not be moved on —
                  claiming a clean save would leave it sitting somewhere unexpected. */}
              {phase.movedFailed && (
                <div className="ntd-warn">
                  It stayed at Content - Pending — the status move didn&apos;t go through. Move it on from the task itself.
                </div>
              )}
              <div className="ntd-end-actions">
                {/* Same link as the task window's Copy task link (4 Nov). */}
                <button className="btn" onClick={async () => { await copyTaskLink(phase.id); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? "Copied" : "Copy task link"}</button>
                <button className="btn" onClick={() => setPhase({ k: "form" })}>Create another</button>
                <button className="btn primary" onClick={onClose}>Done</button>
              </div>
            </div>
          )}

          {phase.k === "error" && (
            <div className="ntd-end">
              <IconAlertTriangle size={42} stroke={1.5} style={{ color: "var(--warn)" }} />
              <div className="ntd-end-title">Couldn&apos;t create the task</div>
              <div className="ntd-end-sub">{phase.msg}</div>
              <div className="ntd-end-actions">
                <button className="btn" onClick={onClose}>Close</button>
                <button className="btn primary" onClick={() => setPhase({ k: "form" })}>Back to the form</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {gate && (
        <div onClick={(e) => e.stopPropagation()}>
          <MissingFieldsModal gate="create" missing={gate.missing} title={gate.title} onClose={() => setGate(null)} />
        </div>
      )}
    </div>
  );
}
