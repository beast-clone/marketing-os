# WhatsApp Inbox — spec and notes

Tab: **Sales → WhatsApp Inbox** (`app/(dashboard)/dashboard/preview/wa-inbox/page.tsx`).
Number: **+91 74116 54951** (Meta Cloud API, phone number id `936263569566237`) — the number
the eBook auto-grant, lead-alert and Samvaya n8n workflows send from. Agreed with Praveen, 5 Nov 2026.

## How it works

```
Person replies on WhatsApp
  → Meta webhook → n8n "WA Inbox — receive" (UfMw48Bkdx0gNIWd, WhatsApp Trigger)
  → Supabase rpc wa_ingest() → table wa_messages (Beast Clone)
  → dashboard /api/wa-inbox reads it

Teammate replies in the dashboard
  → /api/wa-inbox/send (checks the 24h window)
  → n8n "WA Inbox — send reply" (XgwtmPExHM4LveCV, webhook wa-inbox-send, header secret)
  → WhatsApp node sends from +91 74116 54951 → saved in wa_messages
  → delivered / read ticks come back through the receive workflow
```

The WhatsApp key stays in n8n (credentials "WhatsApp account" and "GC - WhatsApp OAuth account").
The dashboard only holds `WA_INBOX_SEND_SECRET` (local `.env.local`; must be added to Netlify before going live).

**APIs / permissions:** nothing new from Meta. Sending and the webhook already work with the
existing app's WhatsApp permissions (`whatsapp_business_messaging`, `whatsapp_business_management`).
Template sending (below) uses the same permissions.

## WhatsApp's rules (shown in the side panel)

Source: Meta developer docs, checked 5 Nov 2026 — pricing, messaging limits, opt-in, policy enforcement.

1. **24-hour reply window** — opens when the person messages us; every new message from them restarts it.
2. **Outside the window: templates only** — Meta-approved templates (marketing / utility / authentication).
3. **Opt-in** — only message people who agreed to hear from GooCampus, with our name stated.
4. **Quality** — blocks and reports lower the number's quality; Meta can limit or pause the number.
5. **Limits** — business-initiated (template) messages to unique people are capped per 24h by tier
   (shared across the whole business portfolio); about one message every 6 seconds to the same person.
6. **Cost** — templates are charged per message; since 1 Oct 2026 Meta also charges non-template
   replies beyond a free monthly allowance. Check Meta's rate card for exact INR rates.

## Interakt inbox vs ours

| Interakt feature | Ours today | Can we build it? |
|---|---|---|
| Chat list, search, unread, last message | ✅ | — |
| Reply box, delivered/read ticks | ✅ (+ shows who replied) | — |
| "Customer hasn't spoken in 24h" + **Open Conversation** (send a template to restart) | Message only | ✅ Yes — list approved templates and send one through n8n (needs the WhatsApp Business Account id) |
| Assign chat to a teammate, Unassigned filter | ❌ | ✅ Yes — our own table |
| Labels / tags, Notes on a contact | ❌ | ✅ Yes |
| Filters: open/closed, reply status, read/unread, response window | Search only | ✅ Yes |
| Contact details panel (number, name, opted-in, history) | Rules panel | ✅ Yes — and link to the lead in Sales Hub |
| Receive photos, PDFs, voice notes | Shows the type + caption only | ✅ Yes — n8n downloads the file and stores it |
| Send photos / PDFs | ❌ | ✅ Yes, through n8n |
| Mark as spam / close chat | ❌ | ✅ Yes |
| Instagram DMs in the same inbox | ❌ | Partly — needs Instagram messaging access (Meta App Review) |
| WhatsApp calling, recordings | ❌ | Not now — separate Calling API, much bigger job |

## What we cannot do

- **Old chats** — Meta gives no history. The inbox only has messages from 5 Nov 2026 onwards.
- **Messages our other workflows send** (eBook, lead alerts, Samvaya) don't appear in the chat
  unless each of those ~15 n8n workflows also logs to `wa_messages`. Possible, but means editing every one.
- **Free-text after 24 hours** — Meta's rule; only templates.
- **Chats on Interakt's number** — that is a different WhatsApp number on Interakt; we can't read it here.
- **Know if someone blocked us** — WhatsApp never tells the sender.
- Samvaya users who reply to this number also appear here (agreed: show all).

## n8n workflows (5 Nov 2026)

| Workflow | ID | What it does |
| --- | --- | --- |
| WA Inbox — receive | `UfMw48Bkdx0gNIWd` | Meta webhook → `wa_ingest()` → `wa_messages` |
| WA Inbox — send reply | `XgwtmPExHM4LveCV` | free-text reply within the 24h window |
| WA Inbox — templates | `SzQZkodBWSN33f3t` | lists approved templates and sends one (published) |
| GC Dashboard — WhatsApp unread | `eKKVCM63C205yrCo` | 15-min Slack nudge (INACTIVE until deployed) |

All three webhooks share the header `x-wa-inbox-secret`, credential **WA Inbox send secret**.

**WhatsApp Business Account id: `1400461001694967`** — the account named **"Samvaya Matrimony"**
in Business Settings → WhatsApp accounts (business portfolio GooCampus Edu Solutions Private Limited).
Meta gives no way to find it from a phone number, so it is configuration: `WA_BUSINESS_ACCOUNT_ID`.

**Corrected 6 Nov 2026.** The 5 Nov notes said `193332033867367` ("GooCampus Edu Solutions Pvt Ltd.").
That is a different account: it has only `enquiry_followup` and `test_campaign`, and sending either from
+91 74116 54951 fails with Meta error **#132001 "Template name does not exist in the translation"**.
Proof of the right one: `1400461001694967` holds the 51 templates the live n8n senders use
(`india_payment_successful_v2`, `als_enquiry_callback_v2`, …), and `hello_world` sent from the inbox
with it was delivered. `enquiry_followup` therefore lives in the wrong account and has to be written
again from the inbox form before Open Conversation can use it.

The phone number also reports `code_verification_status: EXPIRED` — worth re-verifying in WhatsApp
Manager before it bites.

## Attachments (5 Nov 2026)

Incoming photos, PDFs and voice notes are readable in the dashboard. Nothing had to change in the
receive workflow: it already stores Metas whole message object in `wa_messages.raw`, and a media
message carries its file id there (`raw.image.id`, `raw.document.id`, and so on).

Fetching: `/api/wa-inbox/media?message=<id>` asks **WA Inbox — templates and media**
(`SzQZkodBWSN33f3t`, action `media`) for the bytes, because the WhatsApp token lives in n8n. n8n
asks Meta for the one-time URL, downloads it and returns it as binary — no base64 round trip.

**Kept in a PRIVATE bucket, `wa-media`.** This is mark sheets, certificates and ID photos belonging
to other people. Every other bucket in this project is public-read, and none of them would do. The
route is behind the Sales section guard, so an `img src` works for the team and for nobody else.

Kept rather than linked because **Meta deletes attachments after about 30 days** — a link straight
to WhatsApp would rot. The first person to open one fetches it; everybody after reads the copy.

Limit 25 MB. WhatsApp allows documents far larger, but those come back through a webhook response;
anything bigger says so and points at WhatsApp.

**Not built: sending files back.** That needs an upload to Meta and a place to put the file first,
and is a separate job from reading what arrives.

## Templates tab (6 Nov 2026)

WhatsApp Inbox (sidebar folder) → **Templates**, its own page at `/dashboard/preview/wa-inbox/templates` (`?new=1` opens the form), built from the approved prototype
`public/mockups/wa-templates.html`. Component: `app/(dashboard)/dashboard/preview/wa-inbox/TemplatesTab.tsx`.

- **All templates** — every template on the number with Meta's live status (Approved / Waiting for
  Meta / Rejected with Meta's reason / Paused), from `GET /api/wa-inbox/templates?all=1`, refreshed
  every two minutes. Nothing is stored by us; Meta is the record.
- **Default templates** — GooCampus's 18-template set for after the 24-hour window, in 7 groups,
  defined once in `lib/wa-default-templates.ts` and matched to Meta's list by name. "Send for
  approval" / "Send all" submit through `POST /api/wa-inbox/templates/new`.
- **New template** drawer — name, Utility/Marketing, message with blanks + examples, footer, up to 3
  quick-reply buttons, live preview. A rejected template reopens pre-named `<name>_v2`.
- **Typed messages** — `gc_message_from_team`, `gc_next_steps`, `gc_application_status` and
  `gc_important_update` have a blank that holds a whole message; the chat composer shows a big
  "Your message" box for those (`typed` in the catalog). Meta forbids line breaks inside a blank
  (error 132018), so they are sent as " · ".
- Meta rules enforced before submitting: name `a-z0-9_`, an example per blank, blanks numbered
  1..n, the message can't start or end with a blank, ≤ 3 buttons of ≤ 25 characters.
- n8n `SzQZkodBWSN33f3t` → "Approved templates" now also asks Meta for `rejected_reason`, limit 250.

## Template status alerts (6 Nov 2026)

When Meta changes a template's verdict (approved, rejected, paused, disabled) or moves
it between Utility and Marketing, everyone who can open the WhatsApp inbox gets a bell
notification (Notifications → WhatsApp; Open goes to the template) and one Slack post
goes to the dashboard's Slack channel.

- `GET /api/cron/wa-templates` (header `x-cron-secret`) compares Meta's live list with
  `wa_template_status` (sql/051), the last verdict seen per template. The first run
  only records; each change is announced once (`source_id` = name, status, category).
- A brand-new template that is only "waiting for Meta" is not announced (we just sent it).
- Template listing is shared with the Templates page via `lib/wa-templates.ts`.
- **At deploy:** add an n8n schedule that calls the endpoint every 15 minutes,
  10:00–17:45 IST (team hours; overnight changes are reported at 10 AM). Not created
  yet: n8n can't reach localhost, and the n8n connector needed reconnecting.
