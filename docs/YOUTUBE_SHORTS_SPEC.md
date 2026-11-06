# YouTube Shorts from the Scheduler — spec (DRAFT, 6 Nov 2026)

Status: **agreed 6 Nov 2026** (answers in §6). Building waits only on the Google audit (§2) for real posts.
Ask (Praveen, 6 Nov 2026): "Schedule and post YouTube Shorts from the dashboard itself."

## 1. What exists today

| Piece | State |
|---|---|
| YouTube connection | **Read-only.** Scopes `youtube.readonly` + `yt-analytics.readonly` (`lib/youtube-connect.ts:10`). One refresh token per channel (`youtube:<key>` in `mh_integration_tokens`). Cannot upload. |
| Channels | GooCampus, 12thplus, Samvaya (`lib/youtube-channels.ts`). Study Abroad removed 8 Oct. |
| Scheduler | Post channels are only `instagram` / `facebook` (`scheduler/page.tsx:1074`). Media lives in Supabase Storage (`post-media`), URLs on `mh_posts.media_urls`. |
| Publisher | n8n "publisher-v3": every minute, PREPARE (sends the file to Meta 30 min early) then PUBLISH at the time (`n8n/publisher-v3/`). Meta only. |
| LinkedIn | Separate dashboard cron (`/api/cron/publish-linkedin`). |

## 2. The blocker to solve first — Google's audit

YouTube's rule: videos uploaded through the API by an **unverified Google Cloud project created after 28 Jul 2020 are locked to private**, whatever privacy we ask for. Lifting it needs the project to pass Google's **YouTube API Services audit** (form: "YouTube API Services — Audit and Quota Extension"). It takes days to weeks, and the owner of the Google Cloud project has to submit it.

Second sources disagree on whether videos locked *before* the audit unlock afterwards. Assume they don't, so **post nothing real until the audit passes.** Test only with videos that are meant to stay private.

The same form also raises the daily upload quota. The default is 10,000 units/day, and one upload costs about 1,600, so roughly **6 uploads a day per project**.

## 3. How it works (built 6 Nov 2026)

1. **Composer** (`scheduler/page.tsx`): on a Reel with one video, a **YouTube Shorts** tick appears next to Instagram, Facebook and LinkedIn when a ticked page has a channel (`YT_CHANNEL` in `lib/brand-platforms.ts`).
   - Greyed out, with the reason, when:
     - the video is landscape. A Short is **square 1:1 or vertical 9:16** (Praveen, 6 Nov); 16:9 isn't one.
     - it's over 3 minutes (read from the file's own metadata);
     - the channel isn't connected for uploading (`/api/scheduler/youtube-ready`).
   - Ticked: a **Title** field (empty means the caption's first line, max 100 characters). The caption is the description.
   - Saved as `mh_posts.custom.youtube = {title, description}` through `lib/scheduler-enqueue.ts`. It is null when unticked; a caller that doesn't send it leaves it as it was.
2. **Worker** `/api/cron/youtube-shorts` (x-cron-secret, every minute):
   - **90 minutes before the post time:** opens a resumable upload. The video is **private with `publishAt` = the post time**, or public at once when the time is under 3 minutes away.
   - **Each run:** sends 4 MB pieces for up to 6 s (`lib/youtube-upload.ts`). The run first asks YouTube how much it already has, so a run that dies costs nothing.
   - **After the upload:** YouTube makes it public on time by itself.
   - **About a minute after the time:** checks it's public, writes `youtube_url` on the task (`writeBackLink`), and sends a bell notice to the creator and owner, plus Slack.
   - **Still private 10 minutes after:** marked failed. The message names the audit (§2), which is the cause until the audit passes.
3. **Changes:**
   - New time: YouTube's publish time is moved.
   - New video, title, description or channel: the uploaded video is deleted and the upload starts again.
   - Post unscheduled, sent back or deleted: the uploaded video is deleted (status `cancelled`).
   - A failed try starts again when the post is changed or moved.
4. **State:** `yt_uploads` (sql/052), one row per post. It's not kept in `custom`, because the n8n Meta publisher writes `custom` back whole and would wipe it.
5. **Shown:** the post's preview pane has a "YouTube Shorts:" line (waiting / uploading % / uploaded, private / live link / failed reason / taken off).
6. **Several pages:** each page's row uploads to its own channel. A page with no channel (GooCampus World) is skipped.

## 4. Where it runs: the dashboard, not n8n (changed from the draft)

The draft said n8n. It was built in the dashboard instead, like the LinkedIn worker:
- the YouTube logins already live there (one per channel), so no second login is kept in n8n;
- n8n's connection to this app was down.

Netlify's ~10 s limit is handled by uploading in pieces across runs.

The connect flow (`YT_SCOPES` in `lib/youtube-connect.ts`) now also asks for `youtube` (manage videos). Each channel needs **Reconnect** once on its YouTube card on the Brands page. Uploads use only that per-channel grant (`channelAccessToken`), never an env token that could belong to another channel.

## 5. Left to do

0. **Google audit**, submitted by Praveen (§2). Until it passes, uploads stay private and the worker reports that.
1. **Reconnect** GooCampus, 12thplus and Samvaya on the Brands page. Readiness on 6 Nov:
   - GooCampus and 12thplus: not connected from the dashboard (env tokens);
   - Samvaya: read-only.
2. **A private end-to-end test** on one channel after its Reconnect. Delete the test video after.
3. **At deploy:** an n8n schedule calling `GET /api/cron/youtube-shorts` every minute with `x-cron-secret`.
4. **Quota:** about 6 uploads a day by default (1,600 units each); the audit form also asks for more.

## 6. Decisions (Praveen, 6 Nov 2026)

1. **Channels:** GooCampus, Samvaya Matrimony, and 12thplus — all three in the registry (`lib/youtube-channels.ts`). Samvaya is a YouTube channel only; the "never touch Samvaya" rule is about its Supabase projects, which this doesn't touch.
2. **Same post:** a YouTube Shorts tick box on the same Reel that goes to Instagram/Facebook.
3. **Title:** its own field, starting as the first line of the caption.
4. **Cover:** a frame chosen by YouTube is fine.
5. **Google Cloud project:** `gc-dashboard-analytics` (number 227161816049), OAuth client "GC YT Token" (`…q2fm`) — the one YouTube, Sign in with Google and Gmail already use. External app, In production (CHANGELOG_2026-10-02). The Console is signed in as praveen@goocampus.in, so Praveen submits the audit. Owner not re-checked in IAM: Google asked for a password.
6. **Who can tick YouTube:** the same people who can publish today (`approve_content`).
7. **Shape:** square 1:1 or vertical 9:16 only; 16:9 landscape can't go as a Short.

Channel ↔ account mapping (the post's account decides): GooCampus Main → GooCampus channel · 12thplus → 12thplus channel · Samvaya → Samvaya channel. Confirm how a Samvaya post is chosen in the composer when building — the Meta publisher has no Samvaya destination today (`destFor` in `n8n/publisher-v3/publish.js`).
