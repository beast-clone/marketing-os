"use client";
import type { Icon } from "@tabler/icons-react";
import {
  IconBell, IconAlarm, IconSpeakerphone, IconRadar, IconCalendarEvent, IconMovie, IconHourglass, IconInbox, IconArrowBackUp,
  IconArrowsExchange, IconPin, IconCircleCheck, IconPalette, IconPackage, IconSend,
  IconUserCheck, IconNews, IconClockPlus, IconBrandWhatsapp,
} from "@tabler/icons-react";

// The dashboard's own line icons for notifications — the rows used to show emojis,
// which don't belong beside Tabler icons everywhere else (Praveen, 23 Sep).
// Stored rows still carry the emoji they were created with, so it stays the key.
const BY_EMOJI: Record<string, Icon> = {
  "📅": IconCalendarEvent,   // a date moved, or work reached the Scheduler
  "⏰": IconAlarm,           // a My Day reminder the person dismissed (kept here)
  "📣": IconSpeakerphone,    // a competitor announced a webinar / event
  "🔎": IconRadar,           // a competitor posted something new
  "📰": IconNews,            // a Watcher found a new notice (KEA / MCC counselling…)
  "✓": IconUserCheck,        // someone claimed a video — a person took it
  "🎬": IconMovie,           // a video is up for grabs
  "⏳": IconHourglass,        // waiting in your pipeline
  "📥": IconInbox,           // handed to you
  "↩️": IconArrowBackUp,      // sent back for changes, or time taken back
  "⏱️": IconClockPlus,       // task extended
  "🔁": IconArrowsExchange,  // swap request
  "📌": IconPin,             // assigned to you
  "✅": IconCircleCheck,      // approved
  "🎨": IconPalette,         // being made
  "📦": IconPackage,         // ready for review
  "🎉": IconSend,            // published — it has gone out, not confetti
  "💬": IconBrandWhatsapp,  // somebody replied on WhatsApp and nobody has opened it
};

/**
 * Just the line icon, with no tile around it — for places that already draw their
 * own coloured square (My Day's notification rows). Nesting NotifIcon inside one of
 * those gave a pale box inside a brand box, and an icon you could barely see.
 */
export function notifIconFor(emoji?: string | null): Icon {
  return (emoji && BY_EMOJI[emoji]) || IconBell;
}

/** Tint per category: action items amber, everything else the brand blue. */
export function notifTone(actionNeeded: boolean) {
  return actionNeeded
    ? { box: "bg-[#FDF3E7] text-[#C2410C]", ring: "border-[#F3D3BE]" }
    : { box: "bg-brand-light text-brand", ring: "border-gray-100" };
}

export function NotifIcon({ emoji, actionNeeded, size = 17 }: { emoji?: string | null; actionNeeded?: boolean; size?: number }) {
  const Icon = (emoji && BY_EMOJI[emoji]) || IconBell;
  const tone = notifTone(!!actionNeeded);
  return (
    <span className={`w-8 h-8 rounded-lg grid place-items-center flex-shrink-0 ${tone.box}`}>
      <Icon size={size} stroke={1.8} />
    </span>
  );
}
