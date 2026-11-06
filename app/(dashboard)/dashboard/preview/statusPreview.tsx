import { confirmDialog } from "./ConfirmDialog";

// Before a status change is saved, say what else it will do — and ask — when it
// moves the task to someone else or changes who is on it (Praveen, 6 Nov 2026).
// A plain status move with no side effects stays one click.
//
// On 4 Nov the AIQ reel went Output - Ready → Content - Approved and a rule quietly
// handed it from Nikhil to Nandu. This is what would have shown first.

type Side = { status: string; owner: string | null; collaborators: string[] };
const nm = (k: string | null) => (k ? k.charAt(0).toUpperCase() + k.slice(1) : "nobody (claim pool)");

/** True to go ahead. If the preview can't be fetched, it doesn't block the change. */
export async function confirmStatusMove(taskId: string, toStatus: string): Promise<boolean> {
  let p: { before: Side; after: Side } | null = null;
  try {
    const r = await fetch("/api/marketing-hub/status-preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId, status: toStatus }),
    });
    if (r.ok) p = await r.json();
  } catch { /* offline or slow — fall through and save as before */ }
  if (!p?.before || !p?.after) return true;

  const { before, after } = p;
  const added = after.collaborators.filter((c) => !before.collaborators.includes(c));
  const removed = before.collaborators.filter((c) => !after.collaborators.includes(c) && c !== after.owner);
  const ownerMoves = (before.owner || "") !== (after.owner || "");
  if (!ownerMoves && !added.length && !removed.length) return true;

  const rows: [string, string][] = [
    ["Status", `${before.status} → ${after.status}`],
    ...(ownerMoves ? [["Owner", `${nm(before.owner)} → ${nm(after.owner)}`] as [string, string]] : []),
    ...(added.length ? [["Added", added.map(nm).join(", ")] as [string, string]] : []),
    ...(removed.length ? [["Removed", removed.map(nm).join(", ")] as [string, string]] : []),
  ];
  const body = (
    <span className="block">
      {rows.map(([k, v]) => (
        <span key={k} className="flex gap-2 py-0.5">
          <span className="w-16 shrink-0 text-[#8A92A6]">{k}</span>
          <span className="font-medium text-[#232D42]">{v}</span>
        </span>
      ))}
      {ownerMoves && (
        <span className="block mt-2">
          A rule on the Rules page moves it. To keep it with {nm(before.owner)}, pick another status instead — e.g. Incorporating Feedback.
        </span>
      )}
    </span>
  );
  return confirmDialog({ title: "This status change also moves the task", body, action: "Change status" });
}
