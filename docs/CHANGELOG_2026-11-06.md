# 6 November 2026

Branch `feat/dashboard-reskin`. Everything below is **pushed to GitHub and deployed**. The live site runs commit `245bfd0` (deploy `6aedc939535328bd93b288f0`, locked). Later commits are docs only.

## On the home machine

```bash
git pull
npm install
npm run dev
```

No new settings since 5 Nov. If `.env.local` there lacks `WA_BUSINESS_ACCOUNT_ID=1400461001694967` and `WA_INBOX_SEND_SECRET`, see the 5 Nov changelog for where to get them. Both are now on Netlify.

**Database:** three changes were applied today, and both machines share the one database (Beast Clone), so there is nothing to run:
- `sql/051_wa_template_status.sql`
- `sql/052_youtube_shorts.sql`
- the `mh_posts.youtube_url` column (part of 052).

---

## What changed

### WhatsApp Templates
- **"i" next to the buttons on a template preview.** Hover it to read what the buttons do: a tap sends that word back into Chats as the student's reply, and reopens the 24-hour window. "Call me" doesn't ring anyone; it means they want a call back.
- **Template status alerts.** When Meta approves, rejects, pauses or disables a template, or moves it between Utility and Marketing:
  - a bell notification under **Notifications → WhatsApp**, for everyone with WhatsApp inbox access; **Open** goes straight to the template (`?open=<name>`);
  - one Slack post.
  Each change is announced once. Code: `app/api/cron/wa-templates/route.ts`, `lib/wa-templates.ts`.
- **n8n timer is on:** **"GC Dashboard — WhatsApp unread + template alerts"** (`eKKVCM63C205yrCo`) runs every 15 min, **10:00–17:45 IST**. It calls `/api/cron/wa-unread` (Slack when a reply has waited 10+ min) and `/api/cron/wa-templates`. It uses the n8n login "GC Dashboard Cron", so no secret is typed.
  - Its hours were 9 AM–9 PM; changed to office hours.
  - The first scheduled run (4:45 PM) worked.

### YouTube Shorts from the Scheduler (built; not posting yet)
- **The tick:** a **YouTube Shorts** tick next to Instagram / Facebook / LinkedIn on a Reel.
  - Only square (1:1) or vertical (9:16) videos, up to 3 minutes. A 16:9 video gets the tick greyed out with the reason.
  - A Title field (empty = the caption's first line). The caption is the description.
- **The upload:** worker `/api/cron/youtube-shorts`.
  - Uploads 90 minutes before the post time, private, with YouTube's own publish time set to the post time.
  - Sends the video in pieces, so big files don't time out.
  - Moves the time, replaces the video, or takes it down if the post changes.
  - Saves the link on the task (`youtube_url`), with a bell notice and Slack.
- **The post's preview** shows a "YouTube Shorts:" status line.
- **Not live yet:**
  - no channel is connected for uploads (the Brands page Reconnect for GooCampus picked the personal "Praveen L" channel and was refused);
  - Google's audit is pending;
  - the n8n timer isn't added.
  See **`docs/YOUTUBE_SHORTS_MONDAY.md`**; full design in `docs/YOUTUBE_SHORTS_SPEC.md`.

### Also in today's deploy (built earlier this week)
- Recycle bin for WhatsApp chats; clickable stat cards and the Chats / Templates folder in the sidebar.
- Marketing Hub status-change preview (`sql/050`).
- My Day On-camera fix.

---

## Incidents today

### Task uploads broken 4:50–6:30 PM (fixed)
- **What happened:** every task upload showed **"Didn't upload"** after the 4:50 PM deploy, e.g. GCC GP Ad Post 1, slides 3–5.
- **Cause:** the build ran on the Mac, so it only included the Mac version of the native image library `@napi-rs/canvas`, which makes upload thumbnails. Netlify runs Linux, so `/api/marketing-hub/attach/complete` crashed (500).
- **Fix:** redeployed with the Linux binary (`@napi-rs/canvas-linux-x64-gnu@1.1.0`) added. The deploy procedure now includes this step.
- **Check after any deploy:** POST `{}` to `/api/marketing-hub/attach/complete` from a live page must give **400**, not 500.
- **Note:** the files from the failed attempts are in storage but not on the task. Re-upload them.

### AIQ reel didn't reach Facebook (open — Monday)
- **What happened:** "You can't hold an AIQ seat and wait for a state seat - reel" (12thPlus) **is live on Instagram** (1:03 PM), but not on Facebook.
- **Cause:** the n8n publisher's Facebook reel upload stopped answering, and n8n killed the run at its 5-minute limit. This happened twice (1:03 PM and the 5:37 PM retry).
- **Record now:** published, with the Instagram link and the Facebook failure noted.
- **The Story with it:** marked failed. Check 12thPlus stories; use Try again if it's missing.
- **Root cause:** no time limits on the publisher's Facebook requests. The fix plan is in `docs/YOUTUBE_SHORTS_MONDAY.md` (last section).
- **Today:** post the reel on Facebook by hand from Meta Business Suite.

### Still open from before
- **Samvaya posts reach Instagram only.** Facebook refuses them (403): the page connection has no posting permission. Unchanged; see the 5 Nov notes.

---

## Commits
- `245bfd0` feat: WhatsApp templates + alerts, chat bin, YouTube Shorts scheduling
- `ddebf22` docs: n8n timer for WhatsApp alerts is on; Shorts timer left for Monday
- `e1e940d` docs: Monday — Facebook reel hang in the n8n publisher
