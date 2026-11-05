// Telegram bot — used by Watchers (docs/WATCHERS_SPEC.md) to message people.
//
// The token comes from @BotFather. It is kept in mh_integration_tokens under
// provider "telegram" (pasted once on the Watchers tab) and falls back to
// TELEGRAM_BOT_TOKEN, so swapping bots needs no redeploy — the same arrangement
// Gmail and the Diagnostics Reconnect flow use.
//
// A bot can only message someone who has pressed Start on it, or a group it has
// been added to — so the list of people you can pick comes from the bot's own
// updates (syncTelegramChats), not from a directory.
import { getSupabase } from "@/lib/supabase";
import { getIntegrationToken } from "@/lib/integration-tokens";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const TOKEN = async () => ((await getIntegrationToken("telegram")) || "").trim();
export const hasTelegram = async () => !!(await TOKEN());

async function call<T>(method: string, body?: Record<string, unknown>, withToken?: string): Promise<T> {
  // withToken lets a token be tried before it is saved, so a bad paste is rejected
  // at the point of pasting rather than silently at the next notice.
  const token = withToken ?? (await TOKEN());
  const r = await fetchWithTimeout(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description || `HTTP ${r.status}`}`);
  return j.result as T;
}

// The bot's username, so the page can say "open @xyz_bot and press Start".
export async function botUsername(): Promise<string | null> {
  if (!(await hasTelegram())) return null;
  try { return (await call<{ username?: string }>("getMe")).username || null; } catch { return null; }
}

// Check a pasted token before trusting it, and report who it belongs to.
export async function verifyBotToken(token: string): Promise<{ username: string; name: string }> {
  const me = await call<{ username?: string; first_name?: string }>("getMe", undefined, token.trim());
  if (!me.username) throw new Error("That token answered, but not as a bot.");
  return { username: me.username, name: me.first_name || me.username };
}

type Chat = { id: number; type: string; title?: string; first_name?: string; last_name?: string; username?: string };
type Update = { update_id: number; message?: { chat: Chat }; my_chat_member?: { chat: Chat }; channel_post?: { chat: Chat } };

// Read who has started the bot (or added it to a group) and remember them. Telegram
// keeps updates for 24 hours, so this runs on every watcher check and every time the
// Watchers page lists recipients — nobody gets missed as long as either happens daily.
export async function syncTelegramChats(): Promise<void> {
  const sb = getSupabase();
  if (!sb || !(await hasTelegram())) return;
  const ups = await call<Update[]>("getUpdates", { allowed_updates: ["message", "my_chat_member", "channel_post"] });
  const chats = new Map<string, Chat>();
  for (const u of ups) { const c = u.message?.chat || u.my_chat_member?.chat || u.channel_post?.chat; if (c) chats.set(String(c.id), c); }
  if (!chats.size) return;
  const rows = [...chats.values()].map((c) => ({
    chat_id: String(c.id),
    name: c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || String(c.id),
    username: c.username || null,
    kind: c.type,
  }));
  await sb.from("mh_telegram_chats").upsert(rows, { onConflict: "chat_id" });
  // Confirm what was read, so Telegram doesn't hand the same updates back forever.
  const last = Math.max(...ups.map((u) => u.update_id));
  await call("getUpdates", { offset: last + 1, limit: 1 }).catch(() => {});
}

export async function sendTelegram(chatId: string, html: string): Promise<void> {
  await call("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true });
}
