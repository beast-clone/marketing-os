# WhatsApp Inbox — what to build next

Number: **+91 74116 54951** · Tab: **Sales → WhatsApp Inbox** · Written 5 Nov 2026.
How the inbox works today and WhatsApp's rules: see [`WA_INBOX_SPEC.md`](WA_INBOX_SPEC.md).

**Done so far:** read replies, reply within 24 hours, delivered/read ticks, who replied, unread counts,
search, WhatsApp rules panel. n8n workflows "WA Inbox — receive" and "WA Inbox — send reply" are live.
Dashboard code is on localhost only (not committed, not deployed).

## The 9 features

| # | Feature | Why it helps | Time | Notes |
|---|---|---|---|---|
| 1 | **Open Conversation** — pick an approved template and send it | Restarts a chat after the 24-hour window closes, like Interakt | ~1.5 h | Fetch approved templates, fill their blanks, preview, send through n8n |
| 2 | **Show our sent messages** (eBook, lead alerts) inside each chat | See the whole conversation, not only their replies | ~2 h | Add a "save a copy" step to ~15 live n8n workflows — needs a yes first; try on one workflow before the rest |
| 3 | **Assign chat to a teammate** + Unassigned filter | Everyone knows who handles which chat | ~1 h | New field + teammate picker |
| 4 | **New-message alert** (dashboard bell / Slack) | Replies don't sit unseen | ~45 min | Bell and Slack already exist |
| 5 | **Photos and PDFs** — view what they send, send files back | Students send documents and screenshots | ~2 h | n8n downloads each file from WhatsApp and stores it |
| 6 | **Saved quick replies** (address, fees, office timings) | Common answers in one click | ~45 min | Needs the reply texts from Praveen |
| 7 | **Labels, notes, filters** (unread, window open, label) | Keeps many chats organised | ~1.5 h | |
| 8 | **Contact panel** with their Sales Hub lead | Context before replying | ~1.5 h | Match the WhatsApp number to the lead |
| 9 | **After-hours auto-reply** (outside 10 AM–6 PM IST) | "We'll reply tomorrow morning" | ~45 min | Needs the message wording from Praveen; Meta charges per reply |

**Total: about 11–12 hours — roughly 2 working days.**

## Suggested order

- **Day 1:** 1 → 4 → 3 → 2 (about 5 hours) — makes the inbox usable every day.
- **Day 2:** 5 → 6 → 7 → 8 → 9.

## Needed from Praveen

- A few test WhatsApp messages from a phone (for 2, 4, 5 and 9).
- A yes before editing the live n8n sender workflows (for 2).
- Wording for the quick replies (6) and the after-hours message (9).

## Not doing

- **WhatsApp calling** — not needed (Praveen, 5 Nov 2026).
- **Old chats from before 5 Nov 2026** — Meta gives no history; the inbox fills up from now on.
- **Free-text replies after 24 hours** — Meta's rule; #1 (templates) is the way to reach people then.
