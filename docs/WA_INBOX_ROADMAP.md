# WhatsApp Inbox — what to build next

Number: **+91 74116 54951** · Tab: **Sales → WhatsApp Inbox** · Written 5 Nov 2026.
How the inbox works today and WhatsApp's rules: see [`WA_INBOX_SPEC.md`](WA_INBOX_SPEC.md).

**Done so far:** read replies, reply within 24 hours, delivered/read ticks, who replied, unread counts,
search, WhatsApp rules panel. n8n workflows "WA Inbox — receive" and "WA Inbox — send reply" are live.

**Added 5 Nov (afternoon):** #3 assign a chat, #4 Slack nudge for an unanswered reply, #6 saved quick
replies, #7 labels / notes / filters / open-closed-spam, #8 the Sales Hub lead beside the chat, and #1
Open Conversation — the template picker, backed by the new n8n workflow "WA Inbox — templates"
(`SzQZkodBWSN33f3t`, published).

Dashboard code is committed on `feat/dashboard-reskin`, not deployed.

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

## #2 — logging what we send: the first workflow is done

**ALS Leads — WhatsApp** (`YT5xagkHunvFNmqw`) now saves a copy of the callback template it sends,
published 5 Nov. The pattern to copy into the other senders:

1. A **Filter** after the WhatsApp node — keep only items with `{{ $json.messages[0].id }}`.
   Those nodes are set to `continueRegularOutput`, so a failed send still produces an item; without
   this you log messages that were never delivered.
2. A **Supabase** node, create row in `wa_messages`, credential *Beast Clone Supabase account*:
   `wa_message_id` = `{{ $json.messages[0].id }}`, `contact` = `{{ $json.contacts[0].wa_id }}`
   (Meta hands back the normalised number, so there is no phone formatting to get wrong),
   `direction` = `out`, `kind` = `template`, `status` = `sent`, `sent_by` = the workflow in words,
   `body` = what was sent, in words.
3. Set the Supabase node to **continueRegularOutput**, and hang it off the WhatsApp node as a
   **parallel leaf** — never in the chain. Logging must never be able to break the real work.

**Do not log internal alerts.** This workflow also messages Jeswin; logging that would open a chat
for a colleague own number inside a customer inbox. Only log the message to the customer.

**Side effect, already handled:** every logged message creates a conversation, including for people
who never reply. The inbox now hides chats with no incoming message behind Show chats with no
reply, so the real conversations stay findable once all 15 senders are logging.

Remaining senders to do: AMC Razorpay auto-grant, Samvaya lead ads, round-robin assignment, NEET PG
Bijapur, Samvaya waitlist, and the rest — roughly 14.
