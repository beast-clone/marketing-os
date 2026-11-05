"use client";
import { useEffect, useState } from "react";
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { Overlay } from "./Overlay";

// The dashboard's own popups, in place of the browser's grey window.confirm() /
// alert() / prompt() boxes. Same look as the Master sheet's delete popup.
// Callable from anywhere (no hook to thread through); <DialogHost/> is mounted once
// in app/(dashboard)/layout.tsx.
//
//   if (!(await confirmDialog({ title: "Delete topic?", body: "…", action: "Delete", danger: true }))) return;
//   alertDialog("Couldn't save", err.message);
//   const name = await promptDialog({ title: "Rename view", defaultValue: v.name });  // null = cancelled
export type DialogOpts = {
  title: string; body?: React.ReactNode; action?: string; danger?: boolean; cancel?: string;
  kind?: "confirm" | "notice" | "prompt"; defaultValue?: string; placeholder?: string;
  /** prompt only: the action stays off until something is typed (e.g. "why are you deleting it?"). */
  required?: boolean;
  /** prompt only: a label above the box. */
  label?: string;
  /** confirm only: the action stays locked until this exact text is typed, like
   *  GitHub's "type the repository name to delete it" (Remove brand, 5 Nov). */
  confirmText?: string;
};
type Pending = DialogOpts & { resolve: (v: boolean | string | null) => void };

let show: ((p: Pending) => void) | null = null;
const queue: Pending[] = []; // calls made before the host mounted

function open(o: DialogOpts) {
  return new Promise<boolean | string | null>((resolve) => {
    const p = { ...o, resolve };
    if (show) show(p); else queue.push(p);
  });
}
export const confirmDialog = (o: DialogOpts) => open({ ...o, kind: "confirm" }) as Promise<boolean>;
export const alertDialog = (title: string, body?: React.ReactNode) => open({ title, body, kind: "notice", danger: true }).then(() => undefined);
export const promptDialog = (o: DialogOpts) => open({ ...o, kind: "prompt" }) as Promise<string | null>;

export function DialogHost() {
  const [items, setItems] = useState<Pending[]>([]);
  const [value, setValue] = useState("");
  useEffect(() => {
    show = (p) => setItems((xs) => [...xs, p]);
    if (queue.length) setItems((xs) => [...xs, ...queue.splice(0)]);
    return () => { show = null; };
  }, []);
  const cur = items[0];
  useEffect(() => { setValue(cur?.defaultValue ?? ""); }, [cur]);
  if (!cur) return null;
  const typed = !cur.confirmText || value.trim() === cur.confirmText;
  const done = (ok: boolean) => {
    cur.resolve(cur.kind === "prompt" ? (ok ? value : null) : cur.kind === "notice" ? true : ok);
    setItems((xs) => xs.slice(1));
  };
  return (
    <Overlay onClose={() => done(false)} className="fixed inset-0 bg-black/40 z-[400] flex items-center justify-center p-6 preview-scope">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-start gap-3 px-5 pt-5">
          <span className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${cur.danger ? "bg-[#FDECEA] text-[#C0392B]" : "bg-brand-light text-brand"}`}>
            {cur.danger ? <IconAlertTriangle size={18} stroke={1.8} /> : <IconInfoCircle size={18} stroke={1.8} />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-medium text-[#232D42] break-words">{cur.title}</h2>
            {cur.body && <div className="text-[14px] text-[#8A92A6] mt-1 break-words">{cur.body}</div>}
            {cur.kind === "confirm" && cur.confirmText && (
              <>
                <div className="mt-4 text-[13px] text-[#4A5468]">Type <b className="font-medium text-[#232D42] select-all">{cur.confirmText}</b> to confirm.</div>
                <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={cur.confirmText} autoComplete="off" spellCheck={false}
                  onKeyDown={(e) => { if (e.key === "Enter" && typed) done(true); }}
                  className="mt-2 w-full h-9 px-2.5 rounded border border-gray-200 text-[14px] text-[#232D42] outline-none focus:border-[#C0392B]" />
              </>
            )}
            {cur.kind === "prompt" && (
              <>{cur.label && <div className="mt-3 -mb-1.5 text-[12px] text-[#8A92A6]">{cur.label}</div>}
              <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={cur.placeholder}
                onKeyDown={(e) => { if (e.key === "Enter" && !(cur.required && !value.trim())) done(true); }}
                className="mt-3 w-full h-9 px-2.5 rounded border border-gray-200 text-[14px] text-[#232D42] outline-none focus:border-brand" /></>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 mt-4 border-t border-gray-100">
          {cur.kind !== "notice" && <button onClick={() => done(false)} className="h-9 px-3 rounded text-[14px] font-medium text-gray-600 hover:text-gray-900">{cur.cancel || "Cancel"}</button>}
          <button autoFocus={cur.kind !== "prompt" && !cur.confirmText} onClick={() => done(true)} disabled={(cur.kind === "prompt" && cur.required && !value.trim()) || !typed}
            className={`h-9 px-4 rounded text-[14px] font-medium text-white hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed ${cur.danger && cur.kind !== "notice" ? "bg-[#C0392B]" : "bg-brand"}`}>
            {cur.action || (cur.kind === "notice" ? "OK" : cur.kind === "prompt" ? "Save" : "Confirm")}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
