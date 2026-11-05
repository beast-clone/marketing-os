import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
// Linking and unlinking the WhatsApp account behind Community Broadcast.
//
// The dashboard cannot talk to WAHA. WAHA publishes no port and sits on the VPS's
// private Docker network — that is deliberate, and it is what keeps a "send as us"
// API off the internet. So reading the account, linking a new number and unlinking
// all go through the same n8n relay the sender uses: n8n is on that network, makes
// the real WAHA call, and hands back the answer.
//
// Linking uses a PAIRING CODE, not a QR. A QR is only valid for ~20 seconds and
// WhatsApp gives up after six refreshes, which is not enough time for someone to
// walk to the phone. The code lasts minutes and needs no camera.

export type WaSessionStatus =
  | "WORKING"        // linked and able to send
  | "SCAN_QR_CODE"   // waiting for the code to be entered on the phone
  | "STARTING"
  | "STOPPED"        // nothing linked
  | "FAILED"
  | "UNKNOWN";

export type WaSession = {
  status: WaSessionStatus;
  /** Digits only, e.g. 917483800702. Null when nothing is linked. */
  phone: string | null;
  /** The WhatsApp profile name of the linked account. */
  name: string | null;
};

const HOOK =
  process.env.WAHA_SESSION_WEBHOOK ||
  "https://n8n.srv1046538.hstgr.cloud/webhook/waha-session";

/**
 * The first account, and the fallback everywhere.
 *
 * A WAHA "session" IS a linked WhatsApp number. This one is literally named
 * "default", and every message queued before multi-account has no account on it,
 * so it resolves here. Renaming it would strand all of those and force a re-pair.
 */
export const DEFAULT_ACCOUNT = "default";

const READ_HOOK =
  process.env.WAHA_READ_WEBHOOK ||
  "https://n8n.srv1046538.hstgr.cloud/webhook/waha-read";

async function relay<T>(action: string, extra: Record<string, unknown> = {}, hook = HOOK): Promise<T> {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not configured");

  let res: Response;
  try {
    res = await fetchWithTimeout(hook, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": secret },
      body: JSON.stringify({ action, ...extra }),
      cache: "no-store",
    });
  } catch {
    // n8n unreachable is the common failure here, and "fetch failed" tells the
    // person nothing. Say which hop broke.
    throw new Error("Could not reach the WhatsApp relay (n8n). Is the workflow published?");
  }

  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON, keep the raw text */ }

  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error || text.slice(0, 200);
    throw new Error(msg || `The relay returned ${res.status}`);
  }
  return body as T;
}

export const readSession = (session = DEFAULT_ACCOUNT) => relay<WaSession>("status", { session });
export const requestPairingCode = (phone: string, session = DEFAULT_ACCOUNT) =>
  relay<{ code: string }>("connect", { phone, session });
export const disconnectSession = (session = DEFAULT_ACCOUNT) => relay<{ ok: true }>("disconnect", { session });

/** One synced chat from WhatsApp. `label` is null when the contact has no saved name. */
export type SyncedChat = { id: string; label: string | null; kind: "contact" | "group" | "channel" };
export type WaAccount = { name: string; status: string; phone: string | null; label: string | null };

/**
 * The live contact / group / channel list, and every linked account.
 *
 * Read-only, and it goes to its own relay rather than the session one — that
 * workflow returns the lists as TEXT on purpose. WAHA replies with arrays, and
 * n8n turns an array into one item per element and stores each as execution
 * data; ~2000 items ran n8n out of heap and took it down. Keep it that way.
 */
export const readChats = (session = "default") =>
  relay<{ session: string; recipients: SyncedChat[]; accounts: WaAccount[]; quota?: WaQuota }>("chats", { session }, READ_HOOK);

/**
 * What WhatsApp itself says about this number's headroom — the only numbers in
 * any of this that are not guesswork.
 *
 * `capping` is a quota on messaging people you have no chat with: it warns
 * twice and then refuses (WAHA surfaces that as error 475). `timelock` is a
 * temporary shadow-restriction with a real end time (error 463). Neither is
 * reset by restarting or re-pairing — waiting is the only cure.
 *
 * Both endpoints are new (WAHA 2026.8+) and may be missing, so everything here
 * is optional and absence means "nothing to report", never "blocked".
 */
export type WaQuota = {
  capping?: {
    cappingStatus?: "NONE" | "FIRST_WARNING" | "SECOND_WARNING" | "CAPPED";
    totalQuota?: number;    // -1 = no cap in force
    usedQuota?: number;
    cycleStart?: number;    // unix seconds
    cycleEnd?: number;
  } | null;
  timelock?: {
    isActive?: boolean;
    timeEnforcementEnds?: number | null;   // unix seconds
    enforcementType?: string;
  } | null;
};

/** Plain-English read of the quota, or null when there is nothing worth saying. */
export function quotaNote(q?: WaQuota | null): { tone: "ok" | "warn" | "stop"; text: string } | null {
  if (!q) return null;
  const lock = q.timelock;
  if (lock?.isActive) {
    const until = lock.timeEnforcementEnds
      ? new Date(lock.timeEnforcementEnds * 1000).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
      : null;
    return { tone: "stop", text: `WhatsApp has paused new conversations from this number${until ? ` until ${until}` : ""}. Messages to existing chats still go. Don't unlink or re-pair — it doesn't help.` };
  }
  const cap = q.capping;
  const status = cap?.cappingStatus;
  if (status === "CAPPED") return { tone: "stop", text: "WhatsApp has stopped this number messaging new contacts for now. Groups and existing chats still work." };
  if (status === "SECOND_WARNING") return { tone: "warn", text: "Second warning from WhatsApp about messaging new contacts. Ease off, or send to groups instead." };
  if (status === "FIRST_WARNING") return { tone: "warn", text: "WhatsApp has warned this number about messaging new contacts." };
  if (cap && typeof cap.totalQuota === "number" && cap.totalQuota > 0) {
    const used = cap.usedQuota ?? 0;
    return { tone: used / cap.totalQuota > 0.8 ? "warn" : "ok", text: `${used} of ${cap.totalQuota} new contacts used this cycle.` };
  }
  return null;
}

/**
 * Is this number actually on WhatsApp?
 *
 * Without this the picker would happily offer any digits someone typed, and the
 * message would sit in the queue, "send", and arrive nowhere — you'd only find
 * out by checking your phone and seeing WhatsApp offer to invite them.
 *
 * `exists: null` means we could not ask (relay down, WAHA older). Unknown must
 * never read as "not on WhatsApp": telling someone a real number is unreachable
 * is worse than saying nothing.
 */
export const checkNumber = (phone: string, session = "default") =>
  relay<{ phone: string; exists: boolean | null; chatId: string | null }>("check", { phone, session }, READ_HOOK);

/** One group: who is in it, its invite link, and what happened to anyone added. */
export type WaGroupRead = {
  groupId: string | null;
  participants: { id: string; phone: string | null; admin: boolean }[];
  count: number;
  inviteCode: string | null;
  results: { id: string; code: string; inviteSent?: boolean; message?: string | null }[];
};

/**
 * Read a group, and optionally add people to it in the same call.
 *
 * Adding is the part to be careful with. WhatsApp lets someone refuse being
 * added to groups; when they have, the add comes back 403 and WhatsApp sends
 * them a private invite instead. That is a normal outcome, not a failure — and
 * bulk-adding people who never asked is one of the documented ways to lose the
 * number, which is why the UI checks each number first and spaces the adds out.
 */
export const readGroup = (groupId: string, session = "default", participants: string[] = []) =>
  relay<WaGroupRead>("group", { groupId, session, participants }, READ_HOOK);

/** chat.whatsapp.com link for an invite code. */
export const inviteLink = (code?: string | null) => (code ? `https://chat.whatsapp.com/${code}` : null);

/**
 * Does the n8n relay actually honour the account we ask for?
 *
 * The session-control workflow hardcoded "default" until multi-account, and a
 * published n8n workflow only changes when someone clicks Publish. If we asked
 * an old one to link a NEW account it would cheerfully relink the LIVE one
 * instead — unlinking the number that is currently sending.
 *
 * So probe first: ask for a session name that cannot exist. A session-aware
 * relay reports nothing linked; an old one hands back the default account.
 */
export async function relayHonoursAccount(): Promise<boolean> {
  try {
    const probe = await readSession("__probe_does_not_exist__");
    return !probe?.phone;
  } catch {
    return false;   // cannot tell — treat as unsafe
  }
}

/** A name for a new account's session: safe characters only, and never blank. */
export function accountSlug(label: string, taken: string[] = []): string {
  const base = (label || "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "account";
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

/**
 * Digits only, no "+" — the form WhatsApp wants.
 *
 * A bare 10-digit number is treated as Indian, because that is how everyone here
 * types their own number. Anything else must carry its own country code: silently
 * prefixing 91 to a foreign number produces a real Indian number belonging to a
 * stranger, and we have shipped that bug once already. The caller shows the
 * resolved number back to the person before anything is linked.
 */
export function normalisePhone(raw: string): string | null {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

/** 917483800702 -> +91 74838 00702, for display only. */
export function prettyPhone(digits: string | null): string {
  if (!digits) return "";
  if (digits.startsWith("91") && digits.length === 12) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}
