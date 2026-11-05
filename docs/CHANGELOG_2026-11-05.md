# 5 November 2026

Branch `feat/dashboard-reskin`. Everything below is **pushed to GitHub but not deployed** —
the live site is still the 8 October build. On the Mac:

```bash
git pull
npm install        # a new dependency was added today, see "Thumbnails"
npm run dev
```

---

## Do this first on the Mac

Two lines in `.env.local`. Neither is in git, so the Mac does not have them:

| Setting | What it is for | Where to get it |
|---|---|---|
| `WA_BUSINESS_ACCOUNT_ID=193332033867367` | Listing the Meta-approved WhatsApp templates | Here in this file |
| `WA_INBOX_SEND_SECRET=…` | Sending a WhatsApp reply or template | n8n → workflow **WA Inbox — templates and media** → the webhook's header-auth credential (`x-wa-inbox-secret`) |

`WA_INBOX_SEND_SECRET` is **not set on Windows either**, so sending has never actually been
run from a laptop. Without it the dashboard answers *"WhatsApp sending isn't configured"*.
Reading the inbox works without it.

## Does the WhatsApp Inbox need a deploy to test? **No.**

It works from `localhost` on the Mac, because of how it is wired:

- The dashboard **never talks to Meta directly.** It posts to two public n8n webhooks
  (`n8n.srv1046538.hstgr.cloud/webhook/wa-inbox-send` and `…/wa-inbox-templates`), which hold
  the WhatsApp credentials. A public URL is reachable from a laptop.
- **Incoming** messages are not received by the dashboard at all — n8n writes them straight
  into Supabase, and the dashboard reads them. Localhost reads the same database as the live
  site, so the Mac sees the real chats.

A deploy is only needed for the two things that have to run **without a laptop open**:

- `/api/cron/wa-unread` — the 15-minute Slack nudge for a reply left waiting.
  n8n workflow **GC Dashboard — WhatsApp unread** (`eKKVCM63C205yrCo`) is deliberately
  **inactive** until that route is live. Leave it off.
- Anyone other than you using the inbox.

When you do deploy, Netlify needs the same two settings added there — it has neither.

---

## WhatsApp Inbox (new tab, `/dashboard/preview/wa-inbox`)

For the number **+91 74116 54951**.

- Chat list, conversation view, and replies within WhatsApp's 24-hour window.
- **Templates any time** — outside the 24-hour window the composer offers the approved
  templates instead of refusing to send.
- **Write a new template** from the inbox and submit it to Meta for approval.
- **Open Conversation** — a utility template for restarting a chat that has gone cold.
- **Block** and **Delete** on a chat.
- Photos and PDFs people send are readable in the thread.
- Saved replies (quick replies).
- Who is handling a chat, what it is about, and who the person is (matched to the Sales Hub).
- A reply left waiting posts to Slack, and the dashboard bell.
- Chat-list column rebuilt — the name first, the phone number under it, and the controls
  given room instead of being crammed into one strip (option A of the prototype at
  `public/mockups/wa-inbox-sidebar.html`).

Database added live and recorded in `sql/`: `046_wa_contacts.sql`, `047_wa_quick_replies.sql`,
`048_wa_conversations.sql`.

---

## Speed

Measured, not guessed. The numbers below are from this machine against the real endpoints.

**Thumbnails.** The grids were loading the full-size original into every tile — a 2 MB poster
drawn 44px square in History, 112px in My Day. Opening one carousel task downloaded 13 MB to
draw eight thumbnails. A 480px WebP is now written beside the original when a file is
uploaded, and the tiles use that.

- One task measured: **13,394 KB of tiles → 354 KB.**
- The whole back catalogue was backfilled: **399 thumbnails, 0 failures, 191 MB → 9.7 MB.**
- New dependency: `@napi-rs/canvas`. It was already present as a transitive dependency of
  `pdfjs-dist`, which would have broken the upload routes the moment that changed — hence
  `npm install` on the Mac.
- Not `next/image`, on purpose: nearly every image here is a Meta CDN URL or one of our own
  uploads, so Next's optimiser would re-encode each one through Netlify's image CDN on every
  request — a metered category. Paying per view to shrink something we can shrink once is the
  wrong trade.

**The chat list** was reading 3,000 message rows and grouping them in JavaScript on every
poll, every fifteen seconds, to show a handful of chats — and it grew with the message
history rather than the number of conversations. The database groups them now
(view `wa_conversations`).

**Saving a field** showed nothing until the save and a full task refetch had both finished.
A cold Netlify function takes about **2,403 ms** to answer the first save against **35 ms**
once warm, and nothing makes a cold start fast. The edited value is now shown immediately for
the fields whose outcome the server does not change (the published links, output link,
references), and put back if the save is refused. Status, owner and type are deliberately
excluded — the server applies the ownership and completeness rules and can save something
other than what was sent.

**Also:** a timeout on every server-side call to an outside service; slow upstream calls
logged with the keys redacted; three loops that were waiting on one round trip at a time now
run together; images lazy-load (and the PDF export no longer loses them).

---

## File names

403 of the 603 files on tasks were called things like `15.png`, `379.webp` or
`pasted-2026-10-26-125023.png` — Canva slide exports and clipboard pastes. You could not tell
an Australia carousel slide from a Karnataka one without opening it.

- **New uploads** are named after the task: `15.png` on *Aus batch - Carousel* is stored as
  `aus-batch-carousel-15.png`, object path included. A name someone chose deliberately is left
  exactly as it is.
- **The 404 existing files were renamed too.** Carousel slide numbers were kept — they are the
  order the slides go out in.

A rename here is not just a label: the History feed matches files **by name**, and 231 of
these URLs were copied into **35 posts** for scheduling and publishing. All three were moved
together — copy first, switch every reference, check all 404 new URLs resolve, and only then
stop. Verified afterwards: **0 numeric names left, 0 broken images, 0 dead links**, and 624 of
676 History "added" entries still match a live file (the other 52 name files that were removed
from their task, which History serves from the recycle bin exactly as before).

### ⚠️ One thing still to do

**The old copies were deliberately not deleted.** This ran at 22:30 with six posts marked
Ready to Publish today; if the n8n scheduler had been reading a file at the moment its URL
changed, deleting the old copy would have broken that post. Keeping both copies costs a couple
of hundred MB and removes the risk entirely.

Clear them during the quiet hours (00:00–06:00 IST, when nothing publishes):

```bash
npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/rename-attachments.ts --apply --delete-originals
```

It is safe to re-run: files already renamed are skipped, and it re-checks every URL before
removing anything.

---

## Earlier today

**Brands** — connect an Instagram-only brand (Instagram login, no Facebook Page needed);
remove a brand in one step with a warning listing everything it takes; type the brand's name
to confirm, GitHub-style; it now says plainly that deleting a brand does not touch the
Instagram or Facebook account itself; profile pictures rebuild after connect or delete; the
picker always sees newly added brands; Overview remembers which brand you were on.

**Scheduler** — Instagram-only brands appear as pages to post to; the footer names only the
ticked networks; waits for Instagram to finish processing a video before publishing instead of
failing.

**Sign-in** — returns you to the address you actually opened, rather than the canonical one.

**Posts** — never trust a month snapshot taken before the month ended.

---

## Still open

- **Not deployed.** The live site is the 8 October build. Netlify builds are stopped, so
  pushing does not spend credits or trigger a deploy.
- **Netlify is missing** `WA_INBOX_SEND_SECRET` and `WA_BUSINESS_ACCOUNT_ID` — add both before
  the inbox is useful on the live site.
- **n8n `eKKVCM63C205yrCo`** (WhatsApp unread → Slack) stays **inactive** until
  `/api/cron/wa-unread` is deployed.
- **n8n `lhOaZp9S755bhEvT`** (KEA watcher) stays **on** — the dashboard watchers are built and
  verified but still undeployed.
- Two items from the performance video were argued against and not done: streaming AI
  responses, and testing on a cheap phone. Your call.
- Next Netlify credit reading due ~10–11 Nov, to compare against **1,925.1**.
