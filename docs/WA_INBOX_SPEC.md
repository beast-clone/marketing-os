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

**WhatsApp Business Account id: `193332033867367`** ("GooCampus Edu Solutions Pvt Ltd.", owned by
GooCampus Edu Solutions Private Limited). Meta gives no way to find it from a phone number — the
number returns only its own details — so it is configuration: `WA_BUSINESS_ACCOUNT_ID`.

That account currently has **one** approved template, `test_campaign`: a MARKETING blast about an
August event, image header, no variables. It sends, but it is not something to reopen a conversation
with. A short utility template that invites a reply is what Open Conversation actually needs.

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
