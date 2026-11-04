// Publish-date change approvals.
//
// Changing a post's PUBLISHING DATE (only that — content/type/etc. still save
// normally) is held for approval by Maheen instead of applying immediately. The
// request is parked in `discover_cache` (no migration), and Maheen is pinged on
// every available channel: team chat, the My Day bell (an mh_activity event), and
// email. She approves → the date is written; rejects → the old date stays.

import { getSupabase } from "@/lib/supabase";
import { keysWithRole } from "@/lib/team-roles";
import { postTeamMessage, MH_NAME } from "@/lib/mh-chat";
import { sendMail, hasEmail } from "@/lib/email";
import { emailLayout, esc, datePill } from "@/lib/email-layout";
import { postSlack } from "@/lib/slack";
import { fetchRoster } from "@/lib/team-db";
import { todayIST } from "@/lib/date";

type SB = NonNullable<ReturnType<typeof getSupabase>>;

// Who approves a date: everyone with the Manager role on the Team page (was "maheen").
export const approverKeys = () => keysWithRole("manager");
const APPROVER_EMAIL = process.env.APPROVER_EMAIL || "info@goocampus.in";

export type DateChangeRequest = {
  postId: string;
  title: string;
  type?: string;          // content type (Reel / Carousel / …)
  owner?: string;         // assignee (owner_key)
  createdAt?: string;     // when the task was created
  creator?: string;       // who created it (best-effort, from the activity log)
  from: string | null;    // old publishing_date
  to: string | null;      // requested publishing_date
  reason?: string;        // why they want it moved (from the requester)
  requestedBy: string;    // who is asking for the change
  requestedAt: string;
  status: "pending" | "approved" | "rejected" | "superseded";
  resolvedBy?: string;
  resolvedAt?: string;
  resolvedNote?: string;   // the approver's note/reason on approve or reject
  emailedAt?: string;      // when the approvers were emailed about it (straight away if urgent, else the round-up)
  earlier?: EarlierAsk[];  // the same task's earlier requests this one replaced, oldest first
};
type EarlierAsk = { from: string | null; to: string | null; reason?: string; requestedBy: string; requestedAt: string };

// Emails to approvers (Praveen, 4 Nov 2026): one round-up at 12:30 PM and 4 PM IST
// (sendDateChangeRoundup, run by n8n), not one email per request. A request is
// URGENT — emailed the moment it's asked, at any hour — when the post's current or
// new date is today or tomorrow, so it can't miss its date waiting for a round-up.
function isUrgent(from: string | null, to: string | null): boolean {
  const today = todayIST();
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return [from, to].some((d) => !!d && (String(d).slice(0, 10) === today || String(d).slice(0, 10) === tomorrow));
}

const KEY = (postId: string) => `datechg:${postId}`;
// The Approvals history (Praveen, 30 Oct: "how many tasks have I approved"). KEY holds
// only a task's latest request, so a second date change on the same task would write
// over the first decision — every approve/reject is also kept under its own key.
const LOG_KEY = (postId: string, at: string) => `datechg-log:${postId}:${at}`;
const LOG_SOURCE = "mh_date_change_log";
// Deep link straight to the task's detail modal (?open=<id>) on the live site.
// Netlify injects `URL` = the site's primary URL in prod; APP_URL overrides it.
const APP_URL = (process.env.APP_URL || process.env.URL || "https://goocampus-ig-dashboard.netlify.app").replace(/\/+$/, "");
const taskLink = (postId: string) => `${APP_URL}/dashboard/preview/marketing-hub?open=${postId}`;
const approvalsLink = `${APP_URL}/dashboard/preview/approvals`;

// Who gets the request email: the list set on the Approvals page (mh_settings
// approvalEmails — teammates or outside addresses); until one is saved, the same
// people the dashboard notifies (Team page role "Manager") plus APPROVER_EMAIL.
// It used to go to that one address only (Praveen, 4 Nov 2026).
export async function defaultApproverEmails(): Promise<string[]> {
  const roster = await fetchRoster();
  const keys = new Set(approverKeys());
  const list = roster.filter((u) => u.active && keys.has(u.id) && u.email).map((u) => u.email.toLowerCase());
  return [...new Set([...list, APPROVER_EMAIL.toLowerCase()])];
}
async function approverEmails(): Promise<string> {
  const sb = getSupabase();
  const { data } = sb ? await sb.from("mh_settings").select("value").eq("key", "approvalEmails").maybeSingle() : { data: null };
  const saved = Array.isArray(data?.value) ? (data!.value as string[]).filter(Boolean) : [];
  return (saved.length ? saved : await defaultApproverEmails()).join(", ");
}
const nameOf = (k: string) => (k ? (MH_NAME[k] || k.charAt(0).toUpperCase() + k.slice(1)) : "Someone");
const fmt = (d: string | null | undefined) => (d ? new Date(String(d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "unset");
const fmtDT = (d: string | null | undefined) => (d ? new Date(String(d)).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

// Raise (or replace) the pending request for a post + notify the approver.
export async function requestDateChange(sb: SB, r: { postId: string; title: string; type?: string; owner?: string; createdAt?: string; from: string | null; to: string | null; reason?: string; requestedBy: string }): Promise<DateChangeRequest> {
  await fetchRoster();   // fills the shared id → name map (lib/team-names.ts) for anyone new
  // Best-effort "who created it": the earliest actor in the task's activity log.
  let creator: string | undefined;
  try {
    const { data } = await sb.from("mh_activity").select("actor_key").eq("post_id", r.postId).order("created_at", { ascending: true }).limit(1);
    creator = (data?.[0]?.actor_key as string) || undefined;
  } catch { /* leave undefined */ }

  // Asked again before a decision: keep what was asked before, so the approver sees
  // the whole story once instead of one email per change.
  const prev = await getDateChange(sb, r.postId);
  const earlier = prev?.status === "pending"
    ? [...(prev.earlier || []), { from: prev.from, to: prev.to, reason: prev.reason, requestedBy: prev.requestedBy, requestedAt: prev.requestedAt }].slice(-10)
    : undefined;
  const urgent = isUrgent(r.from, r.to);
  const payload: DateChangeRequest = { ...r, creator, requestedAt: new Date().toISOString(), status: "pending", ...(earlier ? { earlier } : {}), ...(urgent ? { emailedAt: new Date().toISOString() } : {}) };
  await sb.from("discover_cache").upsert(
    { cache_key: KEY(r.postId), source: "mh_date_change_request", last_fetched: new Date().toISOString(), payload },
    { onConflict: "cache_key" },
  );

  const who = nameOf(r.requestedBy);
  const reason = r.reason?.trim() || "—";
  const link = taskLink(r.postId);

  // 1) team chat
  await postTeamMessage(sb, r.requestedBy, `📅 ${who} asked to move “${r.title}” from ${fmt(r.from)} → ${fmt(r.to)} — reason: ${reason}. Needs your approval, Maheen. Open the task: ${link}`);
  // 1b) Slack (#creative_marketing) — full, clearly-laid-out card
  await postSlack(
    `📅 *Publish-date change — needs your approval*\n` +
    `*Task:* <${link}|${r.title}>   _(${r.type || "—"})_\n` +
    `*Assigned to:* ${nameOf(r.owner || "")}\n` +
    `*Created:* ${fmtDT(r.createdAt)}${creator ? ` by *${nameOf(creator)}*` : ""}\n` +
    `*Move publish date:* ${fmt(r.from)} → *${fmt(r.to)}*\n` +
    `*Requested by:* ${who}\n` +
    `*Reason:* ${reason}\n` +
    `➡️ <${link}|Open the task> — then approve or reject it in *My Day → Publish-date approvals*.`,
  );
  // 2) My Day bell — an mh_activity event the notifications route surfaces to Maheen
  try {
    await sb.from("mh_activity").insert({ post_id: r.postId, actor_key: r.requestedBy, action: "date_change_requested", from_value: fmt(r.from), to_value: fmt(r.to), detail: reason });
  } catch { /* activity is best-effort */ }
  // 3) email — urgent ones now; the rest wait for the 12:30 PM / 4 PM round-up
  if (urgent && (await hasEmail())) {
    try {
      await sendMail({
        to: await approverEmails(),
        subject: `Urgent: approve publish-date change — “${r.title}”`,
        text: `${who} requested to move the publish date of “${r.title}”.\n\nTask: ${r.title} (${r.type || "—"})\nAssigned to: ${nameOf(r.owner || "")}\nCreated: ${fmtDT(r.createdAt)}${creator ? ` by ${nameOf(creator)}` : ""}\nMove date: ${fmt(r.from)} -> ${fmt(r.to)}\nRequested by: ${who}\nReason: ${reason}\n\nOpen the task: ${link}\nApprove or reject: ${approvalsLink}`,
        html: emailLayout({
          preheader: `${who} wants to move “${r.title}” to ${fmt(r.to)}.`,
          tag: "Urgent · needs your approval", title: "Publish-date change request",
          intro: `<b style="color:#232D42">${esc(who)}</b> asked to move a publish date. Approve or reject it in Approvals.`,
          rows: [
            ["Task", `<a href="${link}" style="color:#3A57E8;text-decoration:none;font-weight:600">${esc(r.title)}</a>${r.type ? ` <span style="color:#8A92A6">· ${esc(r.type)}</span>` : ""}`],
            ["Move date", `${datePill(fmt(r.from))} <span style="color:#8A92A6">&nbsp;→&nbsp;</span> ${datePill(fmt(r.to), true)}`],
            ["Assigned to", esc(nameOf(r.owner || ""))],
            ["Requested by", esc(who)],
            ["Created", `${esc(fmtDT(r.createdAt))}${creator ? ` by ${esc(nameOf(creator))}` : ""}`],
          ],
          quote: { label: "Reason", text: reason },
          buttons: [{ label: "Review in Approvals", href: approvalsLink, primary: true }, { label: "Open the task", href: link }],
        }),
      });
    } catch { /* email is best-effort */ }
  }
  return payload;
}

// The 12:30 PM / 4 PM round-up: every request still waiting that hasn't been emailed
// yet, one row per task (a task asked about several times shows its latest ask, with
// the earlier ones under it). Nothing waiting → no email. `to` overrides the
// recipients (for a test); `dryRun` builds it without sending or marking anything.
export async function sendDateChangeRoundup(sb: SB, opts: { to?: string; dryRun?: boolean; items?: DateChangeRequest[] } = {}): Promise<{ sent: boolean; count: number; html?: string }> {
  const waiting = opts.items || (await listPendingDateChanges(sb)).filter((r) => !r.emailedAt);
  if (!waiting.length) return { sent: false, count: 0 };
  await fetchRoster();
  const rows = waiting
    .map((r) => ({ r, urgent: isUrgent(r.from, r.to) }))
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || String(a.r.to || a.r.from).localeCompare(String(b.r.to || b.r.from)));
  const at = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const block = rows.map(({ r, urgent }) => {
    const link = taskLink(r.postId);
    const earlier = (r.earlier || []).map((e) => `<div style="font-size:12px;color:#8A92A6;margin-top:3px">Earlier: ${esc(fmt(e.from))} → ${esc(fmt(e.to))} · ${esc(nameOf(e.requestedBy))}, ${esc(at(e.requestedAt))}${e.reason ? ` · “${esc(e.reason)}”` : ""}</div>`).join("");
    return `<div style="border:1px solid #E9ECF2;border-radius:10px;padding:12px 14px;margin:0 0 10px">`
      + `<div style="font-size:14px;font-weight:600"><a href="${link}" style="color:#3A57E8;text-decoration:none">${esc(r.title)}</a>`
      + (urgent ? ` <span style="display:inline-block;background:#FDECEA;color:#C03221;border-radius:6px;padding:1px 7px;font-size:11px;font-weight:600;vertical-align:middle">Urgent</span>` : "")
      + (r.earlier?.length ? ` <span style="font-size:12px;color:#8A92A6;font-weight:400">· asked ${r.earlier.length + 1} times</span>` : "") + `</div>`
      + `<div style="margin:8px 0 6px">${datePill(fmt(r.from))} <span style="color:#8A92A6">&nbsp;→&nbsp;</span> ${datePill(fmt(r.to), true)}</div>`
      + `<div style="font-size:13px;color:#4A5468">${esc(nameOf(r.requestedBy))} · ${esc(at(r.requestedAt))}${r.type ? ` · ${esc(r.type)}` : ""}</div>`
      + `<div style="font-size:13px;color:#232D42;margin-top:4px">Reason: ${esc(r.reason?.trim() || "—")}</div>`
      + earlier + `</div>`;
  }).join("");
  const n = rows.length, nu = rows.filter((x) => x.urgent).length;
  const html = emailLayout({
    preheader: `${n} publish-date change${n === 1 ? "" : "s"} waiting for your approval${nu ? ` — ${nu} urgent` : ""}.`,
    tag: "Needs your approval", title: `${n} date change${n === 1 ? "" : "s"} to approve`,
    intro: `These are waiting on the Approvals page${nu ? ` — <b style="color:#C03221">${nu} urgent</b> first` : ""}.<div style="margin-top:14px">${block}</div>`,
    rows: [],
    buttons: [{ label: "Open Approvals", href: approvalsLink, primary: true }],
  });
  if (opts.dryRun) return { sent: false, count: n, html };
  if (!(await hasEmail())) return { sent: false, count: n };
  await sendMail({
    to: opts.to || (await approverEmails()),
    subject: `${nu ? "Urgent · " : ""}${n} publish-date change${n === 1 ? "" : "s"} to approve`,
    text: rows.map(({ r, urgent }) => `${urgent ? "[URGENT] " : ""}${r.title}: ${fmt(r.from)} -> ${fmt(r.to)} (${nameOf(r.requestedBy)}) — ${r.reason || "—"}\n${taskLink(r.postId)}`).join("\n\n") + `\n\nApprove or reject: ${approvalsLink}`,
    html,
  });
  if (!opts.to && !opts.items) {
    const now = new Date().toISOString();
    for (const { r } of rows) {
      await sb.from("discover_cache").update({ payload: { ...r, emailedAt: now } })
        .eq("cache_key", KEY(r.postId)).eq("payload->>requestedAt", r.requestedAt);
    }
  }
  return { sent: true, count: n };
}

// The date was changed directly after a request was parked (the person's approval
// switch was turned off, or an admin moved it). The old request would otherwise sit
// as "waiting for admin approval" under the real date — and approving it later would
// move the date BACK (Karnataka NEET PG Cut Off, 22 Oct). Close it quietly.
export async function supersedeDateChange(sb: SB, postId: string, by: string): Promise<void> {
  const req = await getDateChange(sb, postId);
  if (!req || req.status !== "pending") return;
  const closed: DateChangeRequest = { ...req, status: "superseded", resolvedBy: by, resolvedAt: new Date().toISOString(), resolvedNote: "The date was changed directly." };
  await sb.from("discover_cache").upsert(
    { cache_key: KEY(postId), source: "mh_date_change_request", last_fetched: new Date().toISOString(), payload: closed },
    { onConflict: "cache_key" },
  );
}

export async function listPendingDateChanges(sb: SB): Promise<DateChangeRequest[]> {
  const { data } = await sb
    .from("discover_cache")
    .select("payload")
    .eq("source", "mh_date_change_request")
    .eq("payload->>status", "pending")
    .order("last_fetched", { ascending: false })
    .limit(100);
  return (data ?? []).map((r) => r.payload as DateChangeRequest);
}

/** Every approved / rejected date change, newest first. */
export async function listDateChangeHistory(sb: SB): Promise<DateChangeRequest[]> {
  const { data } = await sb.from("discover_cache").select("payload").eq("source", LOG_SOURCE)
    .order("last_fetched", { ascending: false }).limit(1000);
  return (data ?? []).map((r) => r.payload as DateChangeRequest);
}

export async function getDateChange(sb: SB, postId: string): Promise<DateChangeRequest | null> {
  const { data } = await sb.from("discover_cache").select("payload").eq("cache_key", KEY(postId)).maybeSingle();
  return (data?.payload as DateChangeRequest) ?? null;
}

// Approve → write the date; reject → discard. Either way notify the requester —
// and carry the approver's own note/reason (instructions on approve, why on reject)
// through team chat, Slack, the bell (mh_activity) and the stored record.
export async function resolveDateChange(sb: SB, opts: { postId: string; action: "approve" | "reject"; approverKey: string; note?: string }): Promise<{ ok: boolean; error?: string; request?: DateChangeRequest }> {
  await fetchRoster();   // fills the shared id → name map (lib/team-names.ts) for anyone new
  const req = await getDateChange(sb, opts.postId);
  if (!req || req.status !== "pending") return { ok: false, error: "No pending date-change request for this task." };

  const who = nameOf(opts.approverKey);
  const note = opts.note?.trim() || "";
  const noteLine = note ? ` — note from ${who}: “${note}”` : "";
  const noteSlack = note ? `\n*Note from ${who}:* ${note}` : "";

  if (opts.action === "approve") {
    const { error } = await sb.from("mh_posts").update({ publishing_date: req.to, due_date: req.to }).eq("id", opts.postId);
    if (error) return { ok: false, error: error.message };
    await sb.from("mh_activity").insert({ post_id: opts.postId, actor_key: opts.approverKey, action: "date_change_approved", from_value: fmt(req.from), to_value: fmt(req.to), detail: note || undefined });
    await postTeamMessage(sb, opts.approverKey, `✅ ${who} approved the publish-date change on “${req.title}” → ${fmt(req.to)}${noteLine}.`);
    await postSlack(`✅ *${who}* approved the publish-date change on *“${req.title}”* → *${fmt(req.to)}*.${noteSlack}`);
  } else {
    // A rejection now leaves an audit event too, so the requester is told why.
    await sb.from("mh_activity").insert({ post_id: opts.postId, actor_key: opts.approverKey, action: "date_change_rejected", from_value: fmt(req.from), to_value: fmt(req.to), detail: note || undefined });
    await postTeamMessage(sb, opts.approverKey, `⛔ ${who} declined the publish-date change on “${req.title}” — it stays on ${fmt(req.from)}${noteLine || " — no reason given"}.`);
    await postSlack(`⛔ *${who}* declined the publish-date change on *“${req.title}”* — stays on *${fmt(req.from)}*.${noteSlack || "\n*Note:* (no reason given)"}`);
  }

  // Email the person who asked, with the task link (4 Nov 2026) — the bell and chat
  // already told them; email reaches them when they're not on the dashboard.
  try {
    const requester = (await fetchRoster()).find((u) => u.id === (req.requestedBy || "").toLowerCase());
    if (requester?.email && requester.id !== opts.approverKey && (await hasEmail())) {
      const ok = opts.action === "approve";
      const link = taskLink(opts.postId);
      await sendMail({
        to: requester.email,
        subject: `${ok ? "Approved" : "Not approved"}: publish-date change — “${req.title}”`,
        text: `${who} ${ok ? "approved" : "did not approve"} your request to move “${req.title}” from ${fmt(req.from)} to ${fmt(req.to)}.\n${ok ? `It now publishes on ${fmt(req.to)}.` : `It stays on ${fmt(req.from)}.`}${note ? `\nNote from ${who}: ${note}` : ""}\n\nOpen the task: ${link}`,
        html: emailLayout({
          preheader: ok ? `Approved — “${req.title}” now publishes on ${fmt(req.to)}.` : `Not approved — “${req.title}” stays on ${fmt(req.from)}.`,
          tag: ok ? "Approved" : "Not approved", tone: ok ? "green" : "red",
          title: ok ? `Your date change was approved` : `Your date change was not approved`,
          intro: `<b style="color:#232D42">${esc(who)}</b> ${ok ? "approved" : "did not approve"} your request to move a publish date.`,
          rows: [
            ["Task", `<a href="${link}" style="color:#3A57E8;text-decoration:none;font-weight:600">${esc(req.title)}</a>`],
            ["You asked", `${datePill(fmt(req.from))} <span style="color:#8A92A6">&nbsp;→&nbsp;</span> ${datePill(fmt(req.to), true)}`],
            ["Result", ok ? `<b style="color:#0F6E3C">Publishes on ${esc(fmt(req.to))}</b>` : `<b style="color:#C03221">Stays on ${esc(fmt(req.from))}</b>`],
          ],
          ...(note ? { quote: { label: `Note from ${who}`, text: note } } : {}),
          buttons: [{ label: "Open the task", href: link, primary: true }],
        }),
      });
    }
  } catch { /* email is best-effort */ }

  const resolved: DateChangeRequest = { ...req, status: opts.action === "approve" ? "approved" : "rejected", resolvedBy: opts.approverKey, resolvedAt: new Date().toISOString(), resolvedNote: note || undefined };
  await sb.from("discover_cache").upsert(
    { cache_key: KEY(opts.postId), source: "mh_date_change_request", last_fetched: new Date().toISOString(), payload: resolved },
    { onConflict: "cache_key" },
  );
  await sb.from("discover_cache").upsert(
    { cache_key: LOG_KEY(opts.postId, resolved.resolvedAt!), source: LOG_SOURCE, last_fetched: resolved.resolvedAt!, payload: resolved },
    { onConflict: "cache_key" },
  );
  return { ok: true, request: resolved };
}
