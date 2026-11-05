# WhatsApp Inbox — what's left to make it work completely

Written 5 Nov 2026, end of day. Everything below is on branch `feat/dashboard-reskin`,
**12 commits, not pushed, not deployed.**

Two different goals, and they need different things:

- **A — working on the Mac tomorrow** (one env line, ~5 minutes)
- **B — working for the team** (deploy + two Netlify settings)

Then **C**, the three features still unbuilt, and **D**, things found today that need a decision.

---

## A. Working on the Mac tomorrow

- [ ] **Pull** — 12 commits on `feat/dashboard-reskin`.
- [ ] **Add one line to the Mac's `.env.local`:**
      ```
      WA_BUSINESS_ACCOUNT_ID=193332033867367
      ```
      That is the only new setting. The Mac already has `WA_INBOX_SEND_SECRET`,
      which is exactly what the Windows machine lacks — so everything that could
      not be demonstrated on 5 Nov should work on the Mac immediately.
- [ ] **Start it on port 3000**, not 4324, if you want Google sign-in. `launch.json`
      has an `ig-dashboard-3000` entry; only port 3000 is registered with Google.

No `npm install` (no new packages). No SQL to run — the tables and columns were
applied straight to the shared Supabase. No bucket to create.

### Then test the things Windows could never reach

Every one of these failed on Windows only because of the missing secret:

- [ ] Template picker lists **`enquiry_followup`** — check it says APPROVED, not PENDING
- [ ] Send that template to reopen a chat that has gone quiet
- [ ] Write a **new template** from the form and watch Meta's answer come back
- [ ] **Block** a number, confirm it stops arriving, then unblock
- [ ] Send a **photo and a PDF** from a phone to +91 74116 54951 and open them in the thread
- [ ] **Delete** a test chat

---

## B. Working for the team (needs a deploy)

Nothing below works for anyone but you until this is done. The live site is still
on **8 October**.

- [ ] **Run a production build first.** A lot of UI changed on 5 Nov and the build
      runs lint, which the dev server does not. Stop the dev server first —
      building while it runs corrupts `.next`.
- [ ] **Push** the 12 commits.
- [ ] **Add two environment variables on Netlify** — both are missing there:
      - `WA_BUSINESS_ACCOUNT_ID` = `193332033867367`
      - `WA_INBOX_SEND_SECRET` = the value from the Mac's `.env.local`.
        **Without this the live inbox cannot send, block, fetch an attachment or
        list a template** — it only reads what n8n has already stored.
- [ ] **Deploy.** `stop_builds` is on, so: turn it off, build, turn it back on.
      One deploy is about 15 credits.
- [ ] **Switch on the n8n nudge** — `eKKVCM63C205yrCo`, left inactive on purpose
      because its endpoint does not exist in production yet. Turning it on before
      the deploy means a 404 every 15 minutes.
- [ ] Check Slack gets a nudge, and the dashboard bell shows a **WhatsApp** item.

---

## C. Still unbuilt

| # | What | Needs |
| --- | --- | --- |
| 9 | After-hours auto-reply (outside 10–6 IST) | **The wording from Praveen.** Meta charges per reply, so it is worth agreeing the text before it goes out |
| 2 | The other ~14 senders logging what they send | A yes per workflow. The pattern is written up in `WA_INBOX_ROADMAP.md`; ALS Leads is done and is the worked example. Suggest AMC Razorpay next — eBook buyers are the likeliest to reply |
| 5 | **Sending** files back (reading them is done) | An upload to Meta first; a separate job from reading |

Also open, smaller:

- [ ] **#6 quick replies were built differently from the plan** — save-what-you-typed,
      rather than wording supplied by Praveen. Decide whether to keep it.

---

## D. Found on 5 Nov — needs a decision, not code

- [ ] **The number's `code_verification_status` reads EXPIRED.** Nothing is broken
      today. Worth re-verifying in WhatsApp Manager before it bites.
- [ ] **Only two templates exist**: the new `enquiry_followup` (utility), and
      `test_campaign` — a marketing blast about an August event, with a fixed image
      and no variables. If the team wants more ways to reopen a chat, write them
      from the dashboard now that the form exists.
- [ ] **The other three storage buckets are public-read** (`post-media`,
      `scheduler-media`, `story-snapshots`). The new `wa-media` is private because
      it holds mark sheets and ID documents. The older three predate today and are
      worth a look.
- [ ] **A stash is waiting on the Windows machine** — the 27 Oct Data-for-SEO draft,
      parked before the morning pull because the incoming commits touched the same
      three files. `git stash list`. It will conflict; say when and it can be merged
      properly rather than dropped on top.

---

## Where things live

| | |
| --- | --- |
| Tab | `app/(dashboard)/dashboard/preview/wa-inbox/page.tsx` |
| Server helpers | `lib/wa-inbox.ts` |
| APIs | `app/api/wa-inbox/*` — thread, contact, send, templates, templates/new, media, block, quick-replies |
| Nudge | `app/api/cron/wa-unread` |
| Tables | `wa_messages`, `wa_contacts`, `wa_quick_replies` · bucket `wa-media` (private) |
| n8n bridge | `SzQZkodBWSN33f3t` — templates, media, block/unblock, create-template |
| n8n nudge | `eKKVCM63C205yrCo` — **inactive** |
| n8n receive / send | `UfMw48Bkdx0gNIWd` / `XgwtmPExHM4LveCV` — untouched today |
| WhatsApp Business Account | `193332033867367` |
| Prototype for the redesign | `public/mockups/wa-inbox-sidebar.html` |

Background and Meta's rules: [`WA_INBOX_SPEC.md`](WA_INBOX_SPEC.md).
Feature list and the #2 pattern: [`WA_INBOX_ROADMAP.md`](WA_INBOX_ROADMAP.md).
