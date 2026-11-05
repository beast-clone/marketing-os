"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconX, IconMessage, IconCircleDashed, IconChartBar, IconBold, IconItalic, IconStrikethrough,
  IconCode, IconList, IconListNumbers, IconQuote, IconMoodSmile, IconPaperclip, IconTemplate,
  IconCalendarEvent, IconClock, IconSend, IconUsers, IconInfoCircle, IconPlus, IconTrash, IconDeviceFloppy, IconChecks, IconRepeat, IconBrandWhatsapp, IconFileTypePdf, IconBolt, IconAlertTriangle, IconSparkles,
} from "@tabler/icons-react";
import { Overlay } from "@/app/(dashboard)/dashboard/preview/Overlay";
import { PreviewSelect } from "@/app/(dashboard)/dashboard/preview/PreviewSelect";
import { RecipientPicker, type Recipient } from "./RecipientPicker";
import { ReviewModal, type ReviewRow } from "./ReviewModal";
import { prettyPhone, type WaAccount } from "@/lib/whatsapp-session";
import { resolveSendFrom, setSendFrom } from "./sendFrom";
import { confirmDialog, promptDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";
import { REPEAT_LABEL, type WaKind, type WaRepeatRule } from "@/lib/whatsapp";
import { checkBatch, spreadLabel, spreadSchedule, WA_SAFETY, type WaWarning } from "@/lib/whatsapp-safety";
import { quotaNote, type WaQuota } from "@/lib/whatsapp-session";
import { compressImage } from "@/lib/compress-image";

// The compose popup, built to match the tool this replaces: tabs across the top,
// recipients, the message, when to send, and a live WhatsApp preview beside it.

const IST = "en-IN";
type Template = { id: string; name: string; body: string; imageUrl: string | null };

const fmtLong = (d: Date) =>
  d.toLocaleDateString(IST, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) +
  " at " + d.toLocaleTimeString(IST, { hour: "numeric", minute: "2-digit", hour12: true });

/** WhatsApp's markup, as far as the preview needs it. */
export function renderWa(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```|https?:\/\/\S+)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("http")) out.push(<a key={k++} href={t} target="_blank" rel="noreferrer" className="text-[#027eb5] underline break-all">{t}</a>);
    else if (t.startsWith("```")) out.push(<code key={k++} className="font-mono text-[12px]">{t.slice(3, -3)}</code>);
    else if (t.startsWith("*")) out.push(<b key={k++} className="font-semibold">{t.slice(1, -1)}</b>);
    else if (t.startsWith("_")) out.push(<i key={k++}>{t.slice(1, -1)}</i>);
    else out.push(<s key={k++}>{t.slice(1, -1)}</s>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// WhatsApp gets a harder squeeze than a feed post: it is read on a phone, and a
// WebP must become a JPEG or WhatsApp shows it as a sticker. A video or a PDF is
// passed through untouched — compressImage returns anything it can't re-encode.
const compressForWhatsApp = (f: File) => compressImage(f, { maxEdge: 1600, quality: 0.7 });

// What kind of attachment a stored URL is. WhatsApp needs a different send call
// for each, so the preview shows each one the way WhatsApp itself would.
const isVideoUrl = (u: string) => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(u);
const isPdfUrl = (u: string) => /\.pdf(\?|$)/i.test(u);
const isVideoFile = (u: string, mime: string) => /^video\//i.test(mime) || (!mime && isVideoUrl(u));
const isDocFile = (u: string, mime: string) => /pdf|officedocument|msword|excel|zip/i.test(mime) || (!mime && isPdfUrl(u));
const fileNameOf = (u: string) => decodeURIComponent((u.split("?")[0].split("/").pop() || "file"))
  .replace(/^\d+-[a-z0-9]{6}-/i, "");

/** A message being sent again: the same content, waiting for a new time. */
export type ComposeSeed = {
  kind: WaKind;
  chats: Recipient[];
  body: string;
  imageUrl: string;
  poll?: { name: string; options: string[]; multipleAnswers: boolean } | null;
  session?: string;
};

/**
 * Is this number in this group? Cached per number+group for the life of the
 * page — the answer changes only when someone joins or leaves, and the read
 * costs a relay call. A read that fails answers "yes": never block a send on a
 * question we could not ask.
 */
const inGroupCache = new Map<string, boolean>();
async function inGroup(session: string, groupId: string): Promise<boolean> {
  const key = `${session}|${groupId}`;
  const known = inGroupCache.get(key);
  if (known !== undefined) return known;
  let yes = true;
  try {
    const d = await fetch(
      `/api/scheduler/whatsapp/group?groupId=${encodeURIComponent(groupId)}&session=${encodeURIComponent(session)}`,
      { cache: "no-store" },
    ).then((r) => r.json());
    if (!d.error) yes = ((d.participants || []) as unknown[]).length > 0;
  } catch { /* leave it as yes */ }
  inGroupCache.set(key, yes);
  return yes;
}

export function ComposeModal({ initialDate, seed, onClose, onSaved }: {
  initialDate?: string;                 // yyyy-mm-dd, when opened from a day in the calendar
  seed?: ComposeSeed;                   // "Send again" — everything except the time
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<WaKind>(seed?.kind || "message");
  const [chats, setChats] = useState<Recipient[]>(seed?.chats || []);
  const [body, setBody] = useState(seed?.body || "");
  const [imageUrl, setImageUrl] = useState(seed?.imageUrl || "");
  // What the upload said it was. The name is a weak signal — a long one used to
  // lose its extension entirely — so the mime decides, and the name is only the
  // fallback for a URL somebody typed or a template brought back.
  const [mediaMime, setMediaMime] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pollName, setPollName] = useState(seed?.poll?.name || "");
  const [pollOptions, setPollOptions] = useState<string[]>(seed?.poll?.options?.length ? seed.poll.options : ["", ""]);
  const [pollMulti, setPollMulti] = useState(!!seed?.poll?.multipleAnswers);
  const [date, setDate] = useState(initialDate || new Date().toLocaleDateString("en-CA"));
  const [time, setTime] = useState(() => { const d = new Date(Date.now() + 30 * 60000); return d.toTimeString().slice(0, 5); });
  const [accounts, setAccounts] = useState<WaAccount[]>([]);
  const [session, setSession] = useState<string>(seed?.session || "");
  const [repeatRule, setRepeatRule] = useState<WaRepeatRule>("none");
  const [repeatUntil, setRepeatUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  // How far apart the individual sends go. "" = the random 5-10 minutes; a
  // number is a hand-set gap, and the API floors it at 5 whatever is typed here.
  const [gap, setGap] = useState("");
  // Re-word the message per person, so forty identical texts don't go out.
  const [vary, setVary] = useState(false);
  const [varying, setVarying] = useState(false);
  // The last look before anything is queued. Null until Schedule send is pressed
  // on a batch; a single message needs no list.
  const [review, setReview] = useState<{ rows: ReviewRow[]; sendNow: boolean } | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/scheduler/whatsapp/templates", { cache: "no-store" })
      .then((r) => r.json()).then((d) => setTemplates(d.templates || [])).catch(() => setTemplates([]));
  }, []);

  const at = useMemo(() => (date && time ? new Date(`${date}T${time}`) : null), [date, time]);
  const inPast = !!at && !isNaN(at.getTime()) && at.getTime() < Date.now() - 60_000;
  const setToNow = () => { const n = new Date(); setDate(n.toLocaleDateString("en-CA")); setTime(n.toTimeString().slice(0, 5)); };

  // Wrap the selection in WhatsApp's markers, the way the toolbar buttons read.
  const wrap = (mark: string) => {
    const el = textRef.current; if (!el) return;
    const [a, b] = [el.selectionStart, el.selectionEnd];
    const sel = body.slice(a, b) || "text";
    const next = body.slice(0, a) + mark + sel + mark + body.slice(b);
    setBody(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + mark.length, a + mark.length + sel.length); });
  };
  const prefixLines = (prefix: string | ((i: number) => string)) => {
    const el = textRef.current; if (!el) return;
    const [a, b] = [el.selectionStart, el.selectionEnd];
    const lines = (body.slice(a, b) || "item").split("\n");
    const next = body.slice(0, a) + lines.map((l, i) => (typeof prefix === "string" ? prefix : prefix(i)) + l).join("\n") + body.slice(b);
    setBody(next);
    requestAnimationFrame(() => el.focus());
  };

  const upload = async (f: File) => {
    setUploading(true); setErr(null);
    try {
      const file = await compressForWhatsApp(f);
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/scheduler/upload-media", { method: "POST", body: fd, credentials: "same-origin" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setImageUrl(d.url);
      setMediaMime(d.mime || file.type || "");
    } catch (e) { setErr((e as Error).message); }
    finally { setUploading(false); }
  };

  const saveTemplate = async () => {
    const name = await promptDialog({ title: "Save as a template", body: "You can reuse it from the Templates button.", placeholder: "e.g. Cut-offs — Tamil Nadu", action: "Save" });
    if (!name) return;
    const res = await fetch("/api/scheduler/whatsapp/templates", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ name, body, imageUrl }),
    });
    const d = await res.json();
    if (!res.ok) { setErr(d.error || "Couldn't save the template."); return; }
    setTemplates((t) => [...(t || []).filter((x) => x.id !== d.template.id), d.template]);
  };

  const removeTemplate = async (t: Template) => {
    if (!await confirmDialog({ title: `Delete "${t.name}"?`, action: "Delete", danger: true })) return;
    await fetch(`/api/scheduler/whatsapp/templates?id=${encodeURIComponent(t.id)}`, { method: "DELETE", credentials: "same-origin" });
    setTemplates((list) => (list || []).filter((x) => x.id !== t.id));
  };

  // A recipient that IS the sending number lands in that account's own
  // "Message yourself" chat, not in someone else's. It looks like a failed send —
  // it cost an evening of testing on 23 Sep — so say it before the send, not after.
  const sendingFrom = accounts.find((a) => a.name === session) || accounts[0] || null;
  const selfChats = sendingFrom?.phone
    ? chats.filter((c) => c.id === `${sendingFrom.phone}@c.us`)
    : [];
  // Another connected number to send from instead, if there is one.
  const otherAccount = accounts.find((a) => a.name !== sendingFrom?.name && a.status === "WORKING") || null;

  // Can this number actually post to the groups chosen?
  //
  // WhatsApp refuses with a bare 403 when you post to a group you are not in,
  // and the only sign is a failed row afterwards (Test Group, 24 Sep). Reading
  // the group from a number returns nothing when it is not a member, so that is
  // the question asked here — while the number can still be changed.
  //
  // One read per number per group, remembered for the life of the page: the
  // answer only changes when someone is added to or removed from a group.
  const [blocked, setBlocked] = useState<{ chat: Recipient; useInstead: WaAccount | null }[]>([]);
  useEffect(() => {
    const picked = chats.filter((c) => c.id.endsWith("@g.us"));
    if (!picked.length || !accounts.length || !sendingFrom) { setBlocked([]); return; }
    let dropped = false;
    const t = setTimeout(async () => {
      const out: { chat: Recipient; useInstead: WaAccount | null }[] = [];
      for (const g of picked) {
        if (await inGroup(sendingFrom.name, g.id)) continue;
        // Not a member. Is the other linked number? Worth one more read — it
        // turns "this won't work" into "press here".
        let alt: WaAccount | null = null;
        for (const a of accounts) {
          if (a.name === sendingFrom.name || a.status !== "WORKING") continue;
          if (await inGroup(a.name, g.id)) { alt = a; break; }
        }
        out.push({ chat: g, useInstead: alt });
      }
      if (!dropped) setBlocked(out);
    }, 500);
    return () => { dropped = true; clearTimeout(t); };
  }, [chats, accounts, sendingFrom]);

  // What the footer says, in the same order the old tool said it.
  const recipientLine =
    kind === "status" ? "Posted to your WhatsApp Status — everyone in your contacts sees it."
    : chats.length === 0 ? "No recipients chosen yet"
    : chats.length === 1 ? `One ${kind === "poll" ? "poll" : "message"} to ${chats[0].label}`
    : `${chats.length} separate ${kind === "poll" ? "polls" : "messages"}, one to each recipient`;

  const statusPdf = kind === "status" && !!imageUrl && isDocFile(imageUrl, mediaMime);

  const problem =
    kind !== "status" && !chats.length ? "Please add at least one recipient"
    : kind === "poll" && !pollName.trim() ? "Please write the poll question"
    : kind === "poll" && pollOptions.filter((o) => o.trim()).length < 2 ? "A poll needs at least two options"
    : statusPdf ? "A status can't carry a PDF — post it as a message instead"
    : kind !== "poll" && !body.trim() && !imageUrl ? "Please enter a message or attach a file"
    : !at || isNaN(at.getTime()) ? "Please pick a date and a time"
    : null;

  // Which number this goes out from. Only worth showing when there is a choice.
  useEffect(() => {
    fetch("/api/scheduler/whatsapp/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list = (d.accounts || []) as WaAccount[];
        setAccounts(list);
        // The number chosen on the Connected numbers panel, so the two agree.
        setSession((cur) => cur || resolveSendFrom(list)?.name || "");
      })
      .catch(() => setAccounts([]));
  }, []);

  const submit = async (sendNow = false) => {
    if (problem) return;
    if (!sendNow && inPast) return;
    if (sendNow) {
      const who = kind === "status" ? "your WhatsApp Status" : chats.length === 1 ? chats[0].label : `${chats.length} recipients`;
      const ok = await confirmDialog({
        title: "Send this now?",
        body: <>It goes to {who} on the next check — within a minute. This can&apos;t be taken back.</>,
        action: "Send now",
      });
      if (!ok) return;
    }
    // Before anything is queued: is this the shape of batch that gets a number
    // banned? Warnings only — the decision stays with the person.
    const when = sendNow ? new Date() : at!;
    try {
      const d = await fetch("/api/scheduler/whatsapp", { cache: "no-store" }).then((r) => r.json());
      // WhatsApp's own verdict first — it is the only number here that isn't a
      // rule of thumb. A capped number can still post to groups and existing
      // chats, so this warns rather than blocks.
      const quotaWarnings: WaWarning[] = [];
      try {
        const q = await fetch(`/api/scheduler/whatsapp/session?session=${encodeURIComponent(session || "default")}`, { cache: "no-store" })
          .then((r) => r.json());
        const note = quotaNote(q?.quota as WaQuota);
        if (note && note.tone !== "ok") quotaWarnings.push({ key: "quota", text: note.text });
      } catch { /* the quota is a nicety; never block a send on it */ }

      const warnings: WaWarning[] = checkBatch({
        at: when,
        count: kind === "status" ? 1 : chats.length,
        existing: (d.messages || []) as { schedule_time: string; status: string }[],
        kind: kind === "poll" ? "poll" : kind === "status" ? "status" : "message",
        toGroups: chats.filter((c) => c.kind !== "contact").length,
      });
      warnings.unshift(...quotaWarnings);
      // The one warning here that is a certainty rather than a rule of thumb, so
      // it goes at the very top: WhatsApp will refuse these outright.
      for (const { chat, useInstead } of blocked) {
        warnings.unshift({
          key: `blocked:${chat.id}`,
          text: `WhatsApp will refuse the one to ${chat.label} — ${sendingFrom?.label || "this number"} isn't in that group.`
            + (useInstead ? ` Send from ${useInstead.label || prettyPhone(useInstead.phone)} instead.` : " No linked number is in it."),
        });
      }
      if (warnings.length) {
        const ok = await confirmDialog({
          title: warnings.length === 1 ? "One thing worth checking" : "A few things worth checking",
          body: (
            <>
              <ul className="list-disc pl-4 space-y-1.5">{warnings.map((w) => <li key={w.key}>{w.text}</li>)}</ul>
              <div className="mt-2">Nothing is queued yet — pick another time, or go ahead.</div>
            </>
          ),
          action: sendNow ? "Send anyway" : "Schedule anyway",
        });
        if (!ok) return;
      }
    } catch { /* the check is a courtesy — never block a send on it */ }

    // One wording per recipient, asked for only once the batch is going ahead —
    // it costs a Perplexity call, so it is not run on every keystroke.
    let bodies: Record<string, string> | undefined;
    if (vary && kind !== "poll" && body.trim() && chats.length > 1) {
      setVarying(true); setErr(null);
      try {
        const res = await fetch("/api/scheduler/whatsapp/vary", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
          body: JSON.stringify({
            body: body.trim(),
            // A label that is just a phone number is no one's name.
            recipients: chats.map((c) => ({ id: c.id, name: /[A-Za-z]/.test(c.label) ? c.label : undefined })),
          }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
        bodies = d.bodies;
      } catch (e) {
        const ok = await confirmDialog({
          title: "The wording couldn't be varied",
          body: <>{(e as Error).message}. The same text would go to all {chats.length} recipients, which is what WhatsApp looks for. You can send it anyway, or close this and try again.</>,
          action: "Send the same text",
        });
        setVarying(false);
        if (!ok) return;
      }
      setVarying(false);
    }

    // More than one recipient: show every line before any of it is queued.
    if (kind !== "status" && chats.length > 1) {
      const times = spreadSchedule(when.toISOString(), chats.map((c) => c.id), gap ? Number(gap) : undefined);
      setReview({
        sendNow,
        rows: chats.map((c, i) => ({ chat: c, body: (bodies && bodies[c.id]) || body.trim(), at: times[i] })),
      });
      return;
    }

    await queue({ sendNow, when, bodies });
  };

  /** The only thing that writes to the queue. Called straight for a single
   *  message, and from the review screen for a batch. */
  const queue = async ({ sendNow, when, bodies, rows }: {
    sendNow: boolean;
    when: Date;
    bodies?: Record<string, string>;
    /** Present when the review screen ran: what is on it is what goes. */
    rows?: ReviewRow[];
  }) => {
    const targets = rows ? rows.map((r) => r.chat) : chats;
    const texts = rows
      ? Object.fromEntries(rows.map((r) => [r.chat.id, r.body]))
      : bodies;
    const times = rows ? Object.fromEntries(rows.map((r) => [r.chat.id, r.at])) : undefined;

    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/scheduler/whatsapp", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({
          kind, chats: targets.map((c) => ({ id: c.id, label: c.label })),
          body: body.trim(), imageUrl: imageUrl.trim() || undefined, mime: mediaMime || undefined,
          poll: kind === "poll" ? { name: pollName.trim(), options: pollOptions.map((o) => o.trim()).filter(Boolean), multipleAnswers: pollMulti } : undefined,
          // "now" is a time like any other: the worker picks it up on its next tick.
          scheduleTimeISO: (sendNow ? new Date() : at!).toISOString(),
          repeat: repeatRule === "none" ? undefined : { rule: repeatRule, until: repeatUntil || null },
          session: session || undefined,
          gapMinutes: gap ? Number(gap) : undefined,
          bodies: texts,
          times,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      onSaved(); onClose();
    } catch (e) { setErr((e as Error).message); setReview(null); }
    finally { setBusy(false); }
  };

  const TABS: { key: WaKind; label: string; icon: typeof IconMessage }[] = [
    { key: "message", label: "Message", icon: IconMessage },
    { key: "poll", label: "Poll", icon: IconChartBar },
    { key: "status", label: "Status", icon: IconCircleDashed },
  ];

  return (
    <Overlay onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="preview-scope w-full max-w-[1120px] my-6 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        {/* Left — the composer */}
        <div className="bg-white rounded-2xl border border-gray-100 flex flex-col max-h-[86vh]">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100">
            <span className="text-[13px] text-[#8A92A6]">Schedule a</span>
            <div className="inline-flex bg-[#F6F7FB] border border-gray-100 rounded-lg p-0.5 gap-0.5">
              {TABS.map((t) => (
                <button key={t.key} onClick={() => setKind(t.key)}
                  className={`inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-md transition ${kind === t.key ? "bg-white text-brand border border-gray-100" : "text-[#8A92A6] hover:text-[#232D42]"}`}>
                  <t.icon size={14} /> {t.label}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="ml-auto text-gray-400 hover:text-[#232D42]" aria-label="Close"><IconX size={18} /></button>
          </div>

          <div className="overflow-y-auto px-5 py-4 flex-1">
            {kind === "status" ? (
              <div className="flex items-start gap-2 rounded-xl border border-gray-100 bg-[#F6F7FB] px-3 py-2.5 text-[12.5px] text-[#4A5468] mb-4">
                <IconInfoCircle size={15} className="mt-0.5 flex-shrink-0 text-[#8A92A6]" />
                A status goes to everyone in the account&apos;s contacts and disappears after 24 hours. Choosing who sees it isn&apos;t supported yet.
              </div>
            ) : (
              <>
              {accounts.length > 1 && (
                <div className="flex items-center gap-2 mb-3">
                  <label className="text-[11px] uppercase tracking-wide text-[#8A92A6] font-semibold">Send from</label>
                  <IconBrandWhatsapp size={17} className="text-[#25D366] flex-shrink-0" stroke={2} />
                  <PreviewSelect
                    value={session}
                    // Changing it here also moves the tick on Connected numbers and
                    // becomes the default for the next message — one choice, not two.
                    onChange={(v) => { setSession(v); setSendFrom(v); setChats([]); }}
                    className="h-8 text-[13px]"
                    options={accounts.map((a) => ({
                      value: a.name,
                      label: `${prettyPhone(a.phone) || a.name}${a.label ? ` — ${a.label}` : ""}${a.status === "WORKING" ? "" : " (not linked)"}`,
                    }))}
                  />
                  <span className="text-[11.5px] text-[#8A92A6]">Contacts and groups are this number&apos;s.</span>
                </div>
              )}
              <div className="mb-4"><RecipientPicker selected={chats} onChange={setChats} session={session || undefined} /></div>
              </>
            )}

            {kind === "poll" ? (
              <>
                <label className="text-[11px] uppercase tracking-wide text-[#8A92A6] font-semibold">Poll question</label>
                <input value={pollName} onChange={(e) => setPollName(e.target.value)} placeholder="e.g. Which session time suits you?"
                  className="w-full mt-1.5 mb-3 rounded-xl border border-gray-200 focus:border-brand outline-none p-2.5 text-[13.5px] text-[#232D42]" />
                <label className="text-[11px] uppercase tracking-wide text-[#8A92A6] font-semibold">Options</label>
                <div className="flex flex-col gap-2 mt-1.5 mb-2">
                  {pollOptions.map((o, i) => (
                    <div key={i} className="flex gap-2">
                      <input value={o} onChange={(e) => setPollOptions((s) => s.map((x, j) => (j === i ? e.target.value : x)))}
                        placeholder={`Option ${i + 1}`}
                        className="flex-1 rounded-xl border border-gray-200 focus:border-brand outline-none p-2.5 text-[13px] text-[#232D42]" />
                      {pollOptions.length > 2 && (
                        <button onClick={() => setPollOptions((s) => s.filter((_, j) => j !== i))}
                          className="px-2 rounded-xl border border-gray-200 text-[#8A92A6] hover:border-[#C03221] hover:text-[#C03221]"><IconTrash size={15} /></button>
                      )}
                    </div>
                  ))}
                </div>
                {pollOptions.length < 12 && (
                  <button onClick={() => setPollOptions((s) => [...s, ""])} className="text-[12.5px] text-brand hover:underline inline-flex items-center gap-1 mb-3"><IconPlus size={13} /> Add an option</button>
                )}
                <label className="flex items-center gap-2 text-[12.5px] text-[#4A5468] mb-1">
                  <input type="checkbox" checked={pollMulti} onChange={(e) => setPollMulti(e.target.checked)} /> Let people pick more than one
                </label>
              </>
            ) : (
              <>
                <label className="text-[11px] uppercase tracking-wide text-[#8A92A6] font-semibold">Message</label>
                <div className="mt-1.5 rounded-xl border border-gray-200 focus-within:border-brand">
                  <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 flex-wrap">
                    {([[IconBold, "*", "Bold"], [IconItalic, "_", "Italic"], [IconStrikethrough, "~", "Strikethrough"], [IconCode, "```", "Monospace"]] as const).map(([Icon, mark, title]) => (
                      <button key={title} title={title} onClick={() => wrap(mark)} className="w-7 h-7 grid place-items-center rounded text-[#4A5468] hover:bg-[#F6F7FB]"><Icon size={15} /></button>
                    ))}
                    <span className="w-px h-4 bg-gray-200 mx-1" />
                    <button title="Bulleted list" onClick={() => prefixLines("• ")} className="w-7 h-7 grid place-items-center rounded text-[#4A5468] hover:bg-[#F6F7FB]"><IconList size={15} /></button>
                    <button title="Numbered list" onClick={() => prefixLines((i) => `${i + 1}. `)} className="w-7 h-7 grid place-items-center rounded text-[#4A5468] hover:bg-[#F6F7FB]"><IconListNumbers size={15} /></button>
                    <button title="Quote" onClick={() => prefixLines("> ")} className="w-7 h-7 grid place-items-center rounded text-[#4A5468] hover:bg-[#F6F7FB]"><IconQuote size={15} /></button>
                    <button title="Emoji" onClick={() => setBody((b) => b + "🙂")} className="w-7 h-7 grid place-items-center rounded text-[#4A5468] hover:bg-[#F6F7FB]"><IconMoodSmile size={15} /></button>
                    <span className="ml-auto flex items-center gap-1.5">
                      <button onClick={() => fileRef.current?.click()} disabled={uploading}
                        className="inline-flex items-center gap-1 text-[12px] rounded-lg border border-gray-200 px-2 py-1 text-[#4A5468] hover:border-brand hover:text-brand disabled:opacity-50">
                        <IconPaperclip size={13} /> {uploading ? "Adding…" : "Add files"}
                      </button>
                      <button onClick={() => setShowTemplates((v) => !v)}
                        className={`inline-flex items-center gap-1 text-[12px] rounded-lg border px-2 py-1 ${showTemplates ? "bg-brand-light text-brand-dark border-brand" : "border-gray-200 text-[#4A5468] hover:border-brand hover:text-brand"}`}>
                        <IconTemplate size={13} /> Templates
                      </button>
                    </span>
                  </div>

                  {showTemplates && (
                    <div className="px-2 py-2 border-b border-gray-100 bg-[#F6F7FB]">
                      {templates === null ? <div className="text-[12.5px] text-[#8A92A6] px-1 py-1">Loading…</div>
                        : templates.length === 0 ? <div className="text-[12.5px] text-[#8A92A6] px-1 py-1">No templates yet — write a message and press “Save as template”.</div>
                        : (
                          <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                            {templates.map((t) => (
                              <div key={t.id} className="flex items-center gap-2">
                                <button onClick={() => { setBody(t.body); if (t.imageUrl) { setImageUrl(t.imageUrl); setMediaMime(""); } setShowTemplates(false); }}
                                  className="flex-1 text-left text-[12.5px] text-[#232D42] bg-white border border-gray-100 rounded px-2 py-1 hover:border-brand truncate">{t.name}</button>
                                <button onClick={() => removeTemplate(t)} className="text-gray-300 hover:text-[#C03221]"><IconTrash size={13} /></button>
                              </div>
                            ))}
                          </div>
                        )}
                      <button onClick={saveTemplate} disabled={!body.trim() && !imageUrl}
                        className="mt-2 inline-flex items-center gap-1 text-[12px] text-brand hover:underline disabled:opacity-40 disabled:no-underline">
                        <IconDeviceFloppy size={13} /> Save this message as a template
                      </button>
                    </div>
                  )}

                  <div className="flex gap-2 p-2">
                    <textarea ref={textRef} value={body} onChange={(e) => setBody(e.target.value)} rows={8}
                      placeholder="Type your message…"
                      className="flex-1 outline-none text-[13.5px] text-[#232D42] resize-y bg-transparent" />
                    {imageUrl && (
                      <div className="relative w-16 flex-shrink-0">
                        {isDocFile(imageUrl, mediaMime) ? (
                          <div className="w-16 h-16 rounded-lg border border-gray-100 bg-[#FDECEA] text-[#C0392B] grid place-items-center">
                            <IconFileTypePdf size={22} stroke={1.6} />
                          </div>
                        ) : isVideoFile(imageUrl, mediaMime) ? (
                          <video src={imageUrl} className="w-16 h-16 object-cover rounded-lg border border-gray-100 bg-black" muted />
                        ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={imageUrl} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-100"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} loading="lazy" decoding="async" />
                        )}
                        <button onClick={() => { setImageUrl(""); setMediaMime(""); }} title="Remove"
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-gray-200 text-[#8A92A6] grid place-items-center hover:text-[#C03221]"><IconX size={12} /></button>
                      </div>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,application/pdf" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
                </div>
                <div className="text-[11.5px] text-[#8A92A6] mt-1.5">Photo, video or PDF. Images are compressed before sending, so they arrive quickly; videos and PDFs go as they are.</div>
              </>
            )}

            <div className="mt-5">
              <label className="text-[11px] uppercase tracking-wide text-[#8A92A6] font-semibold">Schedule time</label>
              <div className="flex gap-2 mt-1.5 items-center">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-2">
                  <IconCalendarEvent size={14} className="text-[#8A92A6]" />
                  <input type="date" value={date} min={new Date().toLocaleDateString("en-CA")} onChange={(e) => setDate(e.target.value)}
                    className="outline-none text-[13px] text-[#232D42] bg-transparent" />
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-2">
                  <IconClock size={14} className="text-[#8A92A6]" />
                  <input type="time" value={time} step={300} onChange={(e) => setTime(e.target.value)}
                    className="outline-none text-[13px] text-[#232D42] bg-transparent" />
                </span>
                <span className="text-[11.5px] text-[#8A92A6]">IST</span>
              </div>

              {/* Repeat. The next run is queued only once this one has gone out, so a
                  daily message never fills the calendar months ahead. */}
              <div className="flex flex-wrap gap-2 mt-2 items-center">
                <IconRepeat size={15} className="text-[#8A92A6] flex-shrink-0" />
                <PreviewSelect
                  value={repeatRule}
                  onChange={(v) => setRepeatRule(v as WaRepeatRule)}
                  className="h-8 text-[13px]"
                  dropUp
                  options={(["none", "daily", "weekly", "monthly"] as WaRepeatRule[])
                    .map((r) => ({ value: r, label: REPEAT_LABEL[r] }))}
                />
                {repeatRule !== "none" && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-2">
                    <span className="text-[12.5px] text-[#8A92A6]">until</span>
                    <input type="date" value={repeatUntil} min={date || new Date().toLocaleDateString("en-CA")} onChange={(e) => setRepeatUntil(e.target.value)}
                      className="outline-none text-[13px] text-[#232D42] bg-transparent" />
                    {repeatUntil && (
                      <button type="button" onClick={() => setRepeatUntil("")}
                        className="text-[#8A92A6] hover:text-[#232D42]" title="No end date"><IconX size={13} /></button>
                    )}
                  </span>
                )}
                {repeatRule !== "none" && !repeatUntil && (
                  <span className="text-[11.5px] text-[#8A92A6]">Keeps going until you cancel it.</span>
                )}
              </div>
            </div>
          </div>

          {/* Footer — recipients, when it goes, what is missing */}
          <div className="border-t border-gray-100 px-5 py-3">
            <div className={`flex items-center gap-2 text-[12.5px] ${chats.length || kind === "status" ? "text-[#232D42] font-medium" : "text-[#8A92A6]"}`}>
              <IconUsers size={14} className={chats.length || kind === "status" ? "text-brand" : "text-[#8A92A6]"} /> {recipientLine}
            </div>
            {kind !== "status" && chats.length > 1 && (
              <div className="rounded-xl border border-gray-100 bg-[#F6F7FB] px-3 py-2.5 mt-2 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <IconClock size={14} className="text-[#8A92A6] shrink-0" />
                  <span className="text-[12.5px] text-[#4A5468]">Leave</span>
                  <PreviewSelect
                    value={gap} onChange={setGap} dropUp
                    options={[
                      { value: "", label: `${WA_SAFETY.gapMinMin}–${WA_SAFETY.gapMaxMin} minutes (recommended)` },
                      ...[5, 10, 15, 30, 60].map((m) => ({ value: String(m), label: `exactly ${m} minutes` })),
                    ]}
                  />
                  <span className="text-[12.5px] text-[#4A5468]">between each person.</span>
                </div>
                {spreadLabel(chats.map((c) => c.id), gap ? Number(gap) : undefined) && (
                  <div className="text-[12px] text-[#8A92A6] pl-[22px]">
                    {spreadLabel(chats.map((c) => c.id), gap ? Number(gap) : undefined)}. Groups go out at once —
                    {" "}a group post is one message however many people read it.
                  </div>
                )}
                {kind !== "poll" && (
                  <label className="flex items-start gap-2 cursor-pointer pt-0.5">
                    <input type="checkbox" checked={vary} onChange={(e) => setVary(e.target.checked)}
                      className="mt-[3px] accent-[#3A57E8]" />
                    <span className="text-[12.5px] text-[#4A5468]">
                      <span className="inline-flex items-center gap-1 font-medium text-[#232D42]">
                        <IconSparkles size={13} className="text-brand" /> Word it differently for each one
                      </span>
                      <span className="block text-[12px] text-[#8A92A6]">
                        The same text forty times over is what gets a number flagged. Every fact, link and
                        date stays exactly as you wrote it — only the wording changes.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            )}
            {at && !isNaN(at.getTime()) && !inPast && (
              <div className="flex items-center gap-2 text-[12.5px] text-[#4A5468] mt-1">
                <IconClock size={14} className="text-[#8A92A6] shrink-0" />
                {/* One flex item: the bold date was a second one, so the row gap
                    opened a space either side of it. */}
                <span>This message will be sent on <b className="font-medium text-[#232D42]">{fmtLong(at)}</b>.</span>
              </div>
            )}
            {blocked.map(({ chat, useInstead }) => (
              <div key={chat.id} className="flex items-start gap-2 flex-wrap rounded-lg bg-amber-50 border border-amber-100 text-amber-800 text-[12.5px] px-3 py-2 mt-2">
                <IconAlertTriangle size={15} className="mt-[1px] shrink-0" />
                <span className="min-w-0">
                  <b>{sendingFrom?.label || prettyPhone(sendingFrom?.phone || null)}</b> isn&apos;t in
                  {" "}<b>{chat.label}</b>
                  {chat.label !== chat.id && <span className="opacity-70"> ({chat.id})</span>}
                  , so WhatsApp will refuse this one.
                  {!useInstead && " Neither is your other number — someone in the group has to add it first."}
                </span>
                {useInstead && (
                  <button onClick={() => { setSession(useInstead.name); setSendFrom(useInstead.name); }}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg bg-white border border-amber-200 px-2.5 py-1 font-medium hover:border-amber-300 whitespace-nowrap">
                    Send from {useInstead.label || prettyPhone(useInstead.phone)} instead
                  </button>
                )}
              </div>
            ))}
            {selfChats.length > 0 && (
              <div className="flex items-start gap-2 flex-wrap rounded-lg bg-amber-50 border border-amber-100 text-amber-800 text-[12.5px] px-3 py-2 mt-2">
                <IconAlertTriangle size={15} className="mt-[1px] shrink-0" />
                <span>
                  {selfChats.length === 1 ? <><b>{selfChats[0].label}</b> is the number you&apos;re sending from</> : <><b>{selfChats.length} of these</b> are the number you&apos;re sending from</>}
                  {" "}({prettyPhone(sendingFrom?.phone || null)}), so it will arrive in that account&apos;s own
                  {" "}&ldquo;Message yourself&rdquo; chat rather than reaching anyone else.
                </span>
                {otherAccount && (
                  <button onClick={() => { setSession(otherAccount.name); setSendFrom(otherAccount.name); }}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg bg-white border border-amber-200 px-2.5 py-1 font-medium hover:border-amber-300 whitespace-nowrap">
                    Send from {otherAccount.label || prettyPhone(otherAccount.phone)} instead
                  </button>
                )}
              </div>
            )}
            {inPast && (
              <div className="flex items-center gap-2 flex-wrap rounded-lg bg-amber-50 border border-amber-100 text-amber-800 text-[12.5px] px-3 py-2 mt-2">
                That time has already passed. Pick a new time, or set it to now.
                <button onClick={setToNow} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-white border border-amber-200 px-2.5 py-1 font-medium hover:border-amber-300"><IconClock size={13} /> Set to now</button>
              </div>
            )}
            {problem && !inPast && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-100 text-amber-800 text-[12.5px] px-3 py-2 mt-2">
                <IconAlertTriangle size={15} className="shrink-0" /> {problem}
              </div>
            )}
            {err && <div className="text-[12.5px] rounded-lg px-3 py-2 mt-2 bg-rose-50 text-rose-700 border border-rose-100">{err}</div>}
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={onClose} className="text-[13px] text-[#4A5468] px-3 py-2 rounded-xl hover:bg-[#F6F7FB]">Cancel</button>
              <button onClick={() => submit(true)} disabled={busy || varying || !!problem}
                title="Skip the schedule and send it on the next check"
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 text-[13px] font-medium text-[#4A5468] px-4 py-2 hover:border-brand hover:text-brand disabled:opacity-50">
                <IconBolt size={15} /> Send now
              </button>
              <button onClick={() => submit(false)} disabled={busy || varying || !!problem || inPast}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand text-white text-[13px] font-medium px-4 py-2 hover:bg-brand-dark disabled:opacity-50">
                <IconSend size={15} /> {varying ? "Writing each one…" : busy ? "Scheduling…" : "Schedule send"}
              </button>
            </div>
          </div>
        </div>

        {/* Right — WhatsApp preview */}
        <div className="rounded-2xl border p-4 max-h-[86vh] overflow-y-auto" style={{ background: "var(--wa-bg)", borderColor: "var(--wa-border)" }}>
          <div className="text-[13.5px] font-semibold text-center mb-3" style={{ color: "var(--wa-title)" }}>WhatsApp preview</div>
          <div className="text-center mb-3">
            <span className="inline-block rounded-md text-[11px] px-2.5 py-1" style={{ background: "var(--wa-pill-bg)", color: "var(--wa-pill-ink)" }}>
              {at && !isNaN(at.getTime()) ? at.toLocaleDateString(IST, { day: "numeric", month: "long", year: "numeric" }) : "Today"}
            </span>
          </div>
          <div className="ml-auto max-w-[260px] rounded-xl rounded-tr-sm px-2 pt-2 pb-1.5" style={{ background: "var(--wa-bubble)" }}>
            {kind === "poll" ? (
              <div className="text-[13px]" style={{ color: "var(--wa-ink)" }}>
                <div className="font-medium mb-1.5">{pollName.trim() || "Your poll question"}</div>
                <div className="flex flex-col gap-1.5">
                  {pollOptions.map((o, i) => (
                    <div key={i} className="rounded-lg border px-2 py-1 text-[12.5px]" style={{ borderColor: "var(--wa-optline)", color: "var(--wa-ink)" }}>{o.trim() || `Option ${i + 1}`}</div>
                  ))}
                </div>
                <div className="text-[10.5px] mt-1.5" style={{ color: "var(--wa-meta)" }}>{pollMulti ? "Select one or more" : "Select one"}</div>
              </div>
            ) : (
              <>
                {imageUrl && (isDocFile(imageUrl, mediaMime) ? (
                  // WhatsApp shows a document as a strip with its name, not a picture.
                  <div className="flex items-center gap-2 rounded-lg bg-black/20 px-2 py-2 mb-1.5">
                    <IconFileTypePdf size={26} stroke={1.5} className="text-[#E9EDEF] flex-shrink-0" />
                    <span className="text-[11.5px] text-[#E9EDEF] truncate">{fileNameOf(imageUrl)}</span>
                  </div>
                ) : isVideoFile(imageUrl, mediaMime) ? (
                  <video src={imageUrl} className="w-full rounded-lg mb-1.5 block bg-black" controls playsInline />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl} alt="" className="w-full rounded-lg mb-1.5 block"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} loading="lazy" decoding="async" />
                ))}
                <div className="text-[13px] whitespace-pre-wrap break-words leading-snug" style={{ color: "var(--wa-ink)" }}>
                  {body.trim() ? renderWa(body) : <span className="italic" style={{ color: "var(--wa-meta)" }}>Your message will appear here</span>}
                </div>
              </>
            )}
            <div className="flex items-center justify-end gap-1 text-[10.5px] mt-0.5" style={{ color: "var(--wa-meta)" }}>
              {at && !isNaN(at.getTime()) ? at.toLocaleTimeString(IST, { hour: "numeric", minute: "2-digit", hour12: true }) : ""}
              <IconChecks size={13} style={{ color: "var(--wa-tick)" }} />
            </div>
          </div>
          <div className="text-[11px] mt-3 text-center" style={{ color: "var(--wa-foot)" }}>
            {kind === "status" ? "Posted as your Status" : kind === "poll" ? "Sent as a WhatsApp poll" : "Sent from the GooCampus WhatsApp Business number"}
          </div>
        </div>
      </div>

      {review && (
        <ReviewModal
          rows={review.rows}
          imageName={imageUrl ? decodeURIComponent(imageUrl.split("/").pop() || "") || null : null}
          busy={busy}
          onClose={() => setReview(null)}
          onConfirm={(rows) => queue({ sendNow: review.sendNow, when: review.sendNow ? new Date() : at!, rows })}
        />
      )}
    </Overlay>
  );
}
