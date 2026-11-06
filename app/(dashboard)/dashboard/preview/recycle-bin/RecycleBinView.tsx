"use client";
import { useCallback, useEffect, useState } from "react";
import { IconTrash, IconRestore, IconArchive, IconAlertTriangle, IconPhoto, IconBrandWhatsapp } from "@tabler/icons-react";
import { CreativeThumb } from "@/components/CreativeThumb";
import { PreviewShell } from "../PreviewShell";
import { LoadingBlock } from "@/components/LoadingBlock";
import { confirmDialog } from "../ConfirmDialog";
import type { TrashItem } from "@/lib/task-trash";
import { useTeam } from "@/lib/use-team";

// Names for who deleted what; Team-page newcomers are added in RecycleBinView.
const TEAM_LABEL: Record<string, string> = {
  manya: "Manya", praveen: "Praveen", nikhil: "Nikhil", nandu: "Nandu", maheen: "Maheen",
};
const who = (k: string | null | undefined) => (k && TEAM_LABEL[k]) || k || "—";
const when = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

type Tab = "bin" | "files" | "chats" | "archive";

// A WhatsApp chat deleted from the inbox — app/api/wa-inbox/bin (6 Nov).
type ChatItem = { contact: string; name: string | null; lastBody: string | null; lastAt: string | null; messages: number; deletedAt: string; deletedBy: string | null };
const fmtNum = (d: string) => (d.startsWith("91") && d.length === 12 ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`);

// A task file in the bin (creative / reference / attachment) — lib/file-trash.ts.
type FileItem = { id: string; postId: string | null; postTitle: string | null; filename: string | null; kind: string | null; url: string | null; deletedAt: string; deletedBy: string | null };
const KIND_LABEL: Record<string, string> = { creative: "Creative", reference: "Reference", attachment: "Attachment" };
// Kept 30 days, then the team decides — nothing is removed automatically (22 Oct).
const daysAgo = (iso: string | null | undefined) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : 0);

type DeletedReport = {
  id: string; title: string; type: string | null; sbu: string | null; status: string | null;
  owner: string | null; priority: string | null; publishingDate: string | null;
  createdAt: string | null; createdBy: string | null; content: string | null;
  outputLink: string | null; platforms: string[]; collaborators: string[];
  counts: { attachments: number; comments: number; activity: number };
  lastActivity: { at: string | null; actor: string | null; action: string | null; from: string | null; to: string | null }[];
  deletedAt: string | null; deletedBy: string | null; purgedAt: string | null; purgedBy: string | null;
};


/**
 * The report as a file you can keep. Self-contained HTML — no stylesheet, no fonts to
 * fetch — so it opens the same in a year as it does today, and prints to PDF from any
 * browser. A deleted task's record outliving the dashboard is rather the point.
 */
function downloadReport(r: DeletedReport) {
  const esc = (v: unknown) => String(v ?? "—").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const row = (k: string, v: unknown) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
  const html = `<!doctype html><meta charset="utf-8"><title>Deleted task — ${esc(r.title)}</title>
<style>
  body{font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#232D42;max-width:760px;margin:40px auto;padding:0 20px}
  h1{font-size:20px;margin:.2em 0}
  .eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8A92A6;font-weight:700}
  .sub{color:#8A92A6;margin:0 0 20px}
  .cards{display:flex;gap:12px;margin:0 0 20px}
  .card{flex:1;border:1px solid #EEF0F4;border-radius:8px;padding:10px 12px}
  .card.del{border-color:#F1C4BD;background:#FFF7F6}
  .card .lbl{font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:#8A92A6}
  .card.del .lbl{color:#B0203A}
  h2{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8A92A6;margin:22px 0 8px}
  table{border-collapse:collapse;width:100%}
  th{text-align:left;font-weight:400;color:#8A92A6;padding:3px 12px 3px 0;vertical-align:top;width:150px}
  td{padding:3px 0}
  pre{white-space:pre-wrap;background:#F7F8FC;border:1px solid #EEF0F4;border-radius:8px;padding:10px 12px;font:13px/1.5 inherit;margin:0}
  ol{margin:0;padding-left:18px;color:#4A5468;font-size:13px}
  footer{margin-top:28px;border-top:1px solid #EEF0F4;padding-top:10px;color:#A6ACBE;font-size:12px}
</style>
<div class="eyebrow">Deleted task · report</div>
<h1>${esc(r.title)}</h1>
<p class="sub">${esc([r.type, r.sbu].filter(Boolean).join(" · ") || "No type or SBU recorded")}</p>
<div class="cards">
  <div class="card del"><div class="lbl">Deleted</div><div>${esc(when(r.deletedAt))}</div><div>by ${esc(who(r.deletedBy))}</div></div>
  <div class="card"><div class="lbl">Emptied from bin</div><div>${esc(when(r.purgedAt))}</div><div>by ${esc(who(r.purgedBy))}</div></div>
</div>
<h2>What it was</h2>
<table>
${row("Status when deleted", r.status)}
${row("Owner", who(r.owner))}
${row("Collaborators", r.collaborators.length ? r.collaborators.map(who).join(", ") : "—")}
${row("Priority", r.priority)}
${row("Publishing date", r.publishingDate)}
${row("Created", when(r.createdAt) + (r.createdBy ? ` · by ${who(r.createdBy)}` : ""))}
${row("Had attached", `${r.counts.attachments} file(s) · ${r.counts.comments} comment(s)`)}
${r.outputLink ? row("Output link", r.outputLink) : ""}
</table>
${r.content ? `<h2>The brief</h2><pre>${esc(r.content)}</pre>` : ""}
${r.lastActivity.length ? `<h2>What happened before it was deleted</h2><ol>${r.lastActivity.map((a) => `<li>${esc(when(a.at))} — <b>${esc(who(a.actor))}</b> ${esc((a.action || "").replace(/_/g, " "))}${a.to ? ` → ${esc(a.to)}` : ""}${a.from ? ` (was ${esc(a.from)})` : ""}</li>`).join("")}</ol>` : ""}
<footer>Task id ${esc(r.id)} · report generated ${esc(new Date().toLocaleString("en-GB"))} · GooCampus Marketing OS</footer>`;
  const slug = (r.title || "task").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const stamp = (r.deletedAt || new Date().toISOString()).slice(0, 10);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `deleted-task-${slug || "report"}-${stamp}.html`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The dashboard's recycle bin, with the archive behind it.
 *
 * Deleting a task snapshots the whole thing — row, collaborators, attachments,
 * activity and comments — so Restore puts it back exactly where it was, under the
 * same id. Emptying the bin no longer destroys that snapshot; it moves it to the
 * archive, which only an admin can open, and from there it can always come back.
 */
export function RecycleBinView({ isAdmin }: { isAdmin: boolean }) {
  const rosterTeam = useTeam();
  const [, bumpTeam] = useState(0);
  useEffect(() => {
    let added = false;
    for (const p of rosterTeam) if (!TEAM_LABEL[p.id]) { TEAM_LABEL[p.id] = p.first; added = true; }
    if (added) bumpTeam((n) => n + 1);
  }, [rosterTeam]);
  const [tab, setTab] = useState<Tab>("bin");
  const [bin, setBin] = useState<TrashItem[] | undefined>();
  const [archive, setArchive] = useState<TrashItem[] | undefined>();
  const [files, setFiles] = useState<FileItem[] | undefined>();
  // null = this person can't open the WhatsApp Inbox, so the tab isn't shown.
  const [chats, setChats] = useState<ChatItem[] | undefined | null>();
  // Admin: files emptied from the bin (kept anyway) — the way back for a file.
  const [showEmptied, setShowEmptied] = useState(false);
  const [emptied, setEmptied] = useState<FileItem[] | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // An archived task opens as a REPORT, not as a restore. An admin looking into why
  // something was deleted doesn't want it reappearing on everyone's board.
  const [report, setReport] = useState<DeletedReport | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const openReport = async (id: string) => {
    setReportBusy(true);
    try {
      const r = await fetch(`/api/marketing-hub/trash/archive/${id}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setNotice(j.error || "Couldn't open that report."); return; }
      setReport(j.report as DeletedReport);
    } finally { setReportBusy(false); }
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/marketing-hub/trash", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setBin(j.items || []);
      if (j.notReady) setNotice(j.error || null);
    } catch { setBin([]); }
    try {
      const r = await fetch("/api/marketing-hub/trash/files", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setFiles(r.ok ? (j.items || []) : []);
    } catch { setFiles([]); }
    try {
      const r = await fetch("/api/wa-inbox/bin", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setChats(r.status === 403 || r.status === 401 ? null : r.ok ? (j.items || []) : []);
    } catch { setChats([]); }
    if (!isAdmin) return;
    try {
      const r = await fetch("/api/marketing-hub/trash/files?emptied=1", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setEmptied(r.ok ? (j.items || []) : []);
    } catch { setEmptied([]); }
    try {
      const r = await fetch("/api/marketing-hub/trash/archive", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setArchive(r.ok ? (j.items || []) : []);
    } catch { setArchive([]); }
  }, [isAdmin]);
  useEffect(() => { load(); }, [load]);

  const list = (tab === "bin" ? bin : tab === "archive" ? archive : []) || [];
  const fileList = (showEmptied ? emptied : files) || [];
  const chosen = list.filter((t) => picked.has(t.id));
  const chosenFiles = fileList.filter((f) => picked.has(f.id));
  const chatList = chats || [];
  const chosenChats = chatList.filter((c) => picked.has(c.contact));

  const actChats = async (action: "restore" | "purge") => {
    const n = chosenChats.length;
    if (!(await confirmDialog(action === "restore"
      ? { title: `Restore ${n} chat${n === 1 ? "" : "s"}?`, body: "They go back to the WhatsApp Inbox with every message, label and note.", action: "Restore" }
      : { title: `Delete ${n} chat${n === 1 ? "" : "s"} for good?`, body: "Every message in them is wiped from the dashboard, with the labels and notes. This one cannot be undone. It does not reach WhatsApp — they keep their copy.", action: "Delete for good", danger: true }))) return;
    setBusy(true);
    try {
      let failed = 0;
      if (action === "restore") {
        const r = await fetch("/api/wa-inbox/bin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contacts: chosenChats.map((c) => c.contact) }) });
        if (!r.ok) failed = n;
      } else {
        for (const c of chosenChats) {
          const r = await fetch(`/api/wa-inbox/contact?contact=${c.contact}&forever=1`, { method: "DELETE" });
          if (!r.ok) failed++;
        }
      }
      setNotice(failed ? `${failed} chat${failed === 1 ? "" : "s"} couldn't be ${action === "restore" ? "restored" : "deleted"}.` : null);
      setPicked(new Set());
      await load();
    } finally { setBusy(false); }
  };
  const allOn = list.length > 0 && chosen.length === list.length;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const switchTab = (t: Tab) => { setTab(t); setPicked(new Set()); };

  const act = async (url: string, verb: string) => {
    setBusy(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: chosen.map((t) => t.id) }) });
      const j = await res.json().catch(() => ({}));
      setNotice(!res.ok ? (j.error || `${verb} failed.`) : j.failed?.length ? `${j.failed.length} couldn't be handled: ${j.failed[0].error}` : null);
      setPicked(new Set());
      await load();
    } finally { setBusy(false); }
  };

  const restore = async () => {
    if (!(await confirmDialog({ title: `Restore ${chosen.length} task${chosen.length === 1 ? "" : "s"}?`, body: "They go back exactly where they were, with their comments, attachments and history.", action: "Restore" }))) return;
    act("/api/marketing-hub/trash/restore", "Restore");
  };
  const empty = async () => {
    if (!(await confirmDialog({
      title: `Delete ${chosen.length} from the bin?`,
      body: "They leave the recycle bin, but they are NOT destroyed — an admin can still recover them from the deleted archive.",
      action: "Delete from bin", danger: true,
    }))) return;
    act("/api/marketing-hub/trash/purge", "Delete");
  };

  const actFiles = async (action: "restore" | "purge" | "recover") => {
    const n = chosenFiles.length;
    if (action !== "recover" && !(await confirmDialog(action === "restore"
      ? { title: `Restore ${n} file${n === 1 ? "" : "s"}?`, body: "They go back on their task. A creative put back on an approved post sends it to Content Review again.", action: "Restore" }
      : { title: `Delete ${n} from the bin?`, body: "They leave the recycle bin, but the files are NOT destroyed.", action: "Delete from bin", danger: true }))) return;
    setBusy(true);
    try {
      const res = await fetch("/api/marketing-hub/trash/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids: chosenFiles.map((f) => f.id) }) });
      const j = await res.json().catch(() => ({}));
      setNotice(!res.ok ? (j.error || "That didn't work.") : j.failed?.length ? `${j.failed.length} couldn't be restored: ${j.failed[0].error}` : null);
      setPicked(new Set());
      await load();
    } finally { setBusy(false); }
  };

  return (
    <PreviewShell active="marketing-hub" title="Recycle bin" subtitle="Deleted tasks and files for the whole dashboard — nothing here is gone for good">
      <div className="hpage">
        {notice && (
          <div className="flex items-start gap-2 mb-3 px-3 py-2.5 rounded-lg border border-[#F3DCB4] bg-[#FEF6F0] text-[13px] text-[#7A4E0B]">
            <IconAlertTriangle size={16} stroke={1.9} className="mt-0.5 flex-none" /><span>{notice}</span>
          </div>
        )}

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <button onClick={() => switchTab("bin")}
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13.5px] font-medium border transition ${tab === "bin" ? "bg-brand-light border-brand text-brand-dark" : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"}`}>
            <IconTrash size={16} stroke={1.8} />Tasks
            <span className="text-[11px] opacity-70">{bin?.length ?? ""}</span>
          </button>
          <button onClick={() => switchTab("files")}
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13.5px] font-medium border transition ${tab === "files" ? "bg-brand-light border-brand text-brand-dark" : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"}`}>
            <IconPhoto size={16} stroke={1.8} />Creatives &amp; files
            <span className="text-[11px] opacity-70">{files?.length ?? ""}</span>
          </button>
          {chats !== null && (
            <button onClick={() => switchTab("chats")}
              className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13.5px] font-medium border transition ${tab === "chats" ? "bg-brand-light border-brand text-brand-dark" : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"}`}>
              <IconBrandWhatsapp size={16} stroke={1.8} />WhatsApp chats
              <span className="text-[11px] opacity-70">{chats?.length ?? ""}</span>
            </button>
          )}
          {isAdmin && (
            <button onClick={() => switchTab("archive")}
              className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13.5px] font-medium border transition ${tab === "archive" ? "bg-brand-light border-brand text-brand-dark" : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"}`}>
              <IconArchive size={16} stroke={1.8} />Deleted archive
              <span className="text-[11px] opacity-70">{archive?.length ?? ""}</span>
            </button>
          )}
          {/* Bulk actions belong to the bin only. The archive has no toolbar action:
              putting a task back there is a decision you make AFTER reading the report,
              so the only route to it is through the report itself. */}
          {tab === "files" && isAdmin && (
            <button onClick={() => { setShowEmptied((v) => !v); setPicked(new Set()); }}
              className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] border transition ${showEmptied ? "bg-brand-light border-brand text-brand-dark" : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"}`}>
              <IconArchive size={15} stroke={1.8} />{showEmptied ? "Showing emptied files" : "Emptied files"} <span className="text-[11px] opacity-70">{emptied?.length ?? ""}</span>
            </button>
          )}
          {tab === "files" && showEmptied && chosenFiles.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <button disabled={busy} onClick={() => actFiles("recover")} className="inline-flex items-center gap-1.5 h-9 px-3 rounded text-[14px] font-medium text-white bg-brand hover:bg-brand-dark disabled:opacity-50">
                <IconRestore size={16} stroke={1.8} />Back to the bin ({chosenFiles.length})
              </button>
            </div>
          )}
          {tab === "files" && !showEmptied && chosenFiles.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <button disabled={busy} onClick={() => actFiles("restore")} className="inline-flex items-center gap-1.5 h-9 px-3 rounded text-[14px] font-medium text-white bg-brand hover:bg-brand-dark disabled:opacity-50">
                <IconRestore size={16} stroke={1.8} />Restore {chosenFiles.length}
              </button>
              <button disabled={busy} onClick={() => actFiles("purge")} className="inline-flex items-center gap-1.5 h-9 px-3 rounded text-[14px] font-medium text-[#C0392B] border border-[#F3C6CE] bg-white hover:bg-[#FDECEA] disabled:opacity-50">
                <IconTrash size={16} stroke={1.8} />Delete from bin
              </button>
            </div>
          )}
          {tab === "chats" && chosenChats.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <button disabled={busy} onClick={() => actChats("restore")} className="inline-flex items-center gap-1.5 h-9 px-3 rounded text-[14px] font-medium text-white bg-brand hover:bg-brand-dark disabled:opacity-50">
                <IconRestore size={16} stroke={1.8} />Restore {chosenChats.length}
              </button>
              <button disabled={busy} onClick={() => actChats("purge")} className="inline-flex items-center gap-1.5 h-9 px-3 rounded text-[14px] font-medium text-[#C0392B] border border-[#F3C6CE] bg-white hover:bg-[#FDECEA] disabled:opacity-50">
                <IconTrash size={16} stroke={1.8} />Delete for good
              </button>
            </div>
          )}
          {tab === "bin" && chosen.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <button disabled={busy} onClick={restore} className="inline-flex items-center gap-1.5 h-9 px-3 rounded text-[14px] font-medium text-white bg-brand hover:bg-brand-dark disabled:opacity-50">
                <IconRestore size={16} stroke={1.8} />Restore {chosen.length}
              </button>
              <button disabled={busy} onClick={empty} className="inline-flex items-center gap-1.5 h-9 px-3 rounded text-[14px] font-medium text-[#C0392B] border border-[#F3C6CE] bg-white hover:bg-[#FDECEA] disabled:opacity-50">
                <IconTrash size={16} stroke={1.8} />Delete from bin
              </button>
            </div>
          )}
        </div>

        {tab === "files" && (
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 text-[12.5px] text-gray-500">
              {showEmptied
                ? "Files emptied from the bin — kept anyway. Tick one and put it back into the bin, then restore it from there."
                : "Creatives, references and attachments removed from tasks. Restore puts one back on its task. Everything stays here at least 30 days — after that you decide; nothing is removed on its own."}
            </div>
            {(showEmptied ? emptied : files) === undefined ? <LoadingBlock /> : fileList.length === 0 ? (
              <div className="px-5 py-10 text-center text-[14px] text-[#8A92A6]">{showEmptied ? "No emptied files." : "No deleted files."}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="border-b border-gray-100 bg-gray-50">
                    <tr className="text-gray-500 text-left">
                      <th className="pl-4 pr-0 py-2.5 w-9 font-normal">
                        <input type="checkbox" checked={fileList.length > 0 && chosenFiles.length === fileList.length} onChange={() => setPicked(chosenFiles.length === fileList.length ? new Set() : new Set(fileList.map((f) => f.id)))} aria-label="Select all" />
                      </th>
                      <th className="px-4 py-2.5 font-normal">File</th>
                      <th className="px-4 py-2.5 font-normal">Kind</th>
                      <th className="px-4 py-2.5 font-normal">Task</th>
                      <th className="px-4 py-2.5 font-normal">Deleted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fileList.map((f) => (
                      <tr key={f.id} onClick={() => toggle(f.id)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="pl-4 pr-0 py-2.5 w-9">
                          <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${f.filename || "file"}`} />
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-2.5">
                            <span className="w-9 h-9 rounded-md bg-[#F6F7FB] overflow-hidden flex-shrink-0"><CreativeThumb thumbnailUrl={f.url && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(f.url) ? f.url : null} type={f.url && /\.(mp4|mov|webm)(\?|$)/i.test(f.url) ? "video" : null} title={f.filename} seed={f.id} /></span>
                            {f.url ? <a href={f.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-gray-800 max-w-[300px] truncate hover:text-brand">{f.filename || "(file)"}</a>
                              : <span className="text-gray-800 max-w-[300px] truncate">{f.filename || "(file)"}</span>}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{KIND_LABEL[f.kind || ""] || f.kind || "—"}</td>
                        <td className="px-4 py-2.5 text-gray-600"><span className="block max-w-[260px] truncate">{f.postTitle || "—"}</span></td>
                        <td className="px-4 py-2.5 text-gray-500">
                          {when(f.deletedAt)}<span className="text-gray-400"> · {who(f.deletedBy)}</span>
                          {daysAgo(f.deletedAt) >= 30 && <span className="ml-2 text-[11px] rounded-full px-2 py-0.5 bg-amber-50 text-amber-700">30+ days</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {tab === "chats" && (
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 text-[12.5px] text-gray-500">
              WhatsApp chats deleted from the inbox. Restore puts one back with every message, label and note. A chat also comes back by itself if the person writes again. Delete for good wipes the messages — that one cannot be undone.
            </div>
            {chats === undefined ? <LoadingBlock /> : chatList.length === 0 ? (
              <div className="px-5 py-10 text-center text-[14px] text-[#8A92A6]">No deleted chats.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="border-b border-gray-100 bg-gray-50">
                    <tr className="text-gray-500 text-left">
                      <th className="pl-4 pr-0 py-2.5 w-9 font-normal">
                        <input type="checkbox" checked={chatList.length > 0 && chosenChats.length === chatList.length} onChange={() => setPicked(chosenChats.length === chatList.length ? new Set() : new Set(chatList.map((c) => c.contact)))} aria-label="Select all" />
                      </th>
                      <th className="px-4 py-2.5 font-normal">Chat</th>
                      <th className="px-4 py-2.5 font-normal">Last message</th>
                      <th className="px-4 py-2.5 font-normal">Messages</th>
                      <th className="px-4 py-2.5 font-normal">Deleted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chatList.map((c) => (
                      <tr key={c.contact} onClick={() => toggle(c.contact)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="pl-4 pr-0 py-2.5 w-9">
                          <input type="checkbox" checked={picked.has(c.contact)} onChange={() => toggle(c.contact)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${c.name || c.contact}`} />
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="block text-gray-800">{c.name || fmtNum(c.contact)}</span>
                          {c.name && <span className="block text-[12px] text-gray-400">{fmtNum(c.contact)}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600"><span className="block max-w-[320px] truncate">{c.lastBody || "—"}</span></td>
                        <td className="px-4 py-2.5 text-gray-600">{c.messages}</td>
                        <td className="px-4 py-2.5 text-gray-500">{when(c.deletedAt)}<span className="text-gray-400"> · {who(c.deletedBy)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {(tab === "bin" || tab === "archive") && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 text-[12.5px] text-gray-500">
            {tab === "bin"
              ? "Deleted tasks. Restore puts one back with its comments, attachments and history. Everything stays here at least 30 days — after that you decide; deleting from here does not destroy it."
              : "Emptied from the recycle bin and kept anyway — only admins can see this. Open any row for a report of what the task was, who deleted it and when. Nothing goes back on the board unless you put it there."}
          </div>
          {list === undefined || (tab === "bin" ? bin : archive) === undefined ? (
            <LoadingBlock />
          ) : list.length === 0 ? (
            <div className="px-5 py-10 text-center text-[14px] text-[#8A92A6]">
              {tab === "bin" ? "The recycle bin is empty." : "Nothing has been deleted from the bin."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="border-b border-gray-100 bg-gray-50">
                  <tr className="text-gray-500 text-left">
                    {tab === "bin" && (
                      <th className="pl-4 pr-0 py-2.5 w-9 font-normal">
                        <input type="checkbox" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(list.map((t) => t.id)))} aria-label="Select all" />
                      </th>
                    )}
                    <th className={`py-2.5 pr-4 font-normal ${tab === "bin" ? "px-4" : "pl-4"}`}>Task</th>
                    <th className="px-4 py-2.5 font-normal">SBU</th>
                    <th className="px-4 py-2.5 font-normal">Type</th>
                    <th className="px-4 py-2.5 font-normal">Status</th>
                    <th className="px-4 py-2.5 font-normal">Owner</th>
                    <th className="px-4 py-2.5 font-normal">Deleted</th>
                    {tab === "archive" && <th className="px-4 py-2.5 font-normal">Emptied</th>}
                  </tr>
                </thead>
                <tbody>
                  {list.map((t) => (
                    <tr key={t.id} onClick={() => (tab === "archive" ? openReport(t.id) : toggle(t.id))} title={tab === "archive" ? "Open the report on this task" : undefined} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                      {tab === "bin" && (
                        <td className="pl-4 pr-0 py-2.5 w-9">
                          <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${t.particulars || "task"}`} />
                        </td>
                      )}
                      <td className={`py-2.5 pr-4 ${tab === "bin" ? "px-4" : "pl-4"}`}><span className="text-gray-800 block max-w-[340px] truncate">{t.particulars || "(untitled)"}</span></td>
                      <td className="px-4 py-2.5 text-gray-600">{t.sbu || "—"}</td>
                      <td className="px-4 py-2.5 text-gray-600">{t.type || "—"}</td>
                      <td className="px-4 py-2.5 text-gray-600">{t.status || "—"}</td>
                      <td className="px-4 py-2.5 text-gray-600">{who(t.owner)}</td>
                      <td className="px-4 py-2.5 text-gray-500">{when(t.deletedAt)}<span className="text-gray-400"> · {who(t.deletedBy)}</span>
                        {tab === "bin" && daysAgo(t.deletedAt) >= 30 && <span className="ml-2 text-[11px] rounded-full px-2 py-0.5 bg-amber-50 text-amber-700">30+ days</span>}</td>
                      {tab === "archive" && <td className="px-4 py-2.5 text-gray-500">{when(t.purgedAt)}<span className="text-gray-400"> · {who(t.purgedBy)}</span></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}
      </div>

      {/* The report. Everything is read from the snapshot, so it still works long after
          the task itself is gone — and reading it changes nothing on the board. */}
      {report && (
        <div className="report-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setReport(null)}>
          <div className="w-full max-w-[760px] my-8 bg-white rounded-xl shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 px-6 py-4 border-b border-gray-100">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#A6ACBE]">Deleted task · report</div>
                <h2 className="text-[17px] font-medium text-[#232D42] mt-0.5 break-words">{report.title}</h2>
                <div className="text-[12.5px] text-gray-500 mt-0.5">
                  {[report.type, report.sbu].filter(Boolean).join(" · ") || "No type or SBU recorded"}
                </div>
              </div>
              <button onClick={() => downloadReport(report)} className="h-8 px-3 rounded border border-gray-200 text-[13px] text-gray-600 hover:border-gray-300 flex-none" title="Save this report as a file">Download</button>
              <button onClick={() => window.print()} className="h-8 px-3 rounded border border-gray-200 text-[13px] text-gray-600 hover:border-gray-300 flex-none" title="Print just this report">Print</button>
              <button onClick={() => setReport(null)} className="h-8 w-8 rounded border border-gray-200 text-gray-500 hover:border-gray-300 flex-none" aria-label="Close">✕</button>
            </div>

            <div className="px-6 py-4 space-y-5">
              {/* The two questions an admin actually opens this for. */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-[#F1C4BD] bg-[#FFF7F6] px-3 py-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#B0203A]">Deleted</div>
                  <div className="text-[13.5px] text-[#232D42] mt-0.5">{when(report.deletedAt)}</div>
                  <div className="text-[12.5px] text-gray-600">by {who(report.deletedBy)}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8A92A6]">Emptied from bin</div>
                  <div className="text-[13.5px] text-[#232D42] mt-0.5">{when(report.purgedAt)}</div>
                  <div className="text-[12.5px] text-gray-600">by {who(report.purgedBy)}</div>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#A6ACBE] mb-2">What it was</div>
                <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">
                  <dt className="text-gray-500">Status when deleted</dt><dd className="text-[#232D42]">{report.status || "—"}</dd>
                  <dt className="text-gray-500">Owner</dt><dd className="text-[#232D42]">{who(report.owner)}</dd>
                  <dt className="text-gray-500">Collaborators</dt><dd className="text-[#232D42]">{report.collaborators.length ? report.collaborators.map(who).join(", ") : "—"}</dd>
                  <dt className="text-gray-500">Priority</dt><dd className="text-[#232D42]">{report.priority || "—"}</dd>
                  <dt className="text-gray-500">Publishing date</dt><dd className="text-[#232D42]">{report.publishingDate || "—"}</dd>
                  <dt className="text-gray-500">Created</dt><dd className="text-[#232D42]">{when(report.createdAt)}{report.createdBy ? ` · by ${who(report.createdBy)}` : ""}</dd>
                  <dt className="text-gray-500">Had attached</dt><dd className="text-[#232D42]">{report.counts.attachments} file{report.counts.attachments === 1 ? "" : "s"} · {report.counts.comments} comment{report.counts.comments === 1 ? "" : "s"}</dd>
                </dl>
              </div>

              {report.content && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#A6ACBE] mb-1.5">The brief</div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-[#3B4457] whitespace-pre-wrap max-h-64 overflow-y-auto">{report.content}</div>
                </div>
              )}

              {report.lastActivity.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#A6ACBE] mb-1.5">What happened before it was deleted</div>
                  <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {report.lastActivity.map((a, i) => (
                      <div key={i} className="flex items-baseline gap-2 px-3 py-1.5 text-[12.5px]">
                        <span className="text-gray-400 flex-none w-[128px]">{when(a.at)}</span>
                        <span className="text-[#232D42] font-medium flex-none">{who(a.actor)}</span>
                        <span className="text-gray-600 min-w-0">
                          {(a.action || "").replace(/_/g, " ")}{a.to ? ` → ${a.to}` : ""}{a.from ? ` (was ${a.from})` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 px-6 py-3.5 border-t border-gray-100">
              <span className="text-[12.5px] text-gray-500">Reading this changes nothing — the task stays deleted.</span>
              <button
                className="ml-auto h-9 px-3 rounded text-[13.5px] font-medium text-[#4A5468] border border-gray-200 bg-white hover:border-gray-300"
                onClick={async () => {
                  if (!(await confirmDialog({ title: "Put this back in the recycle bin?", body: `“${report.title}” returns to the bin, where it can be restored onto the board. It is not restored yet.`, action: "Put back in bin" }))) return;
                  setReport(null);
                  setBusy(true);
                  try {
                    await fetch("/api/marketing-hub/trash/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [report.id] }) });
                    await load();
                  } finally { setBusy(false); }
                }}>Put back in bin</button>
              <button onClick={() => setReport(null)} className="h-9 px-3 rounded text-[13.5px] font-medium text-white bg-brand hover:bg-brand-dark">Done</button>
            </div>
          </div>
        </div>
      )}
      {reportBusy && !report && <div className="fixed inset-0 z-50 bg-black/10" />}
    </PreviewShell>
  );
}
