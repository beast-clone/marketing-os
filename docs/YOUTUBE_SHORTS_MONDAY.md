# YouTube Shorts — Monday checklist (written 6 Nov 2026)

What was built and why is in **[YOUTUBE_SHORTS_SPEC.md](YOUTUBE_SHORTS_SPEC.md)**. This file is only what's left, in order.

## Where it stands (Fri 6 Nov)

- **Built and deployed:**
  - the **YouTube Shorts** tick in the Scheduler (square 1:1 / vertical 9:16, up to 3 min);
  - the upload worker `/api/cron/youtube-shorts`;
  - the `yt_uploads` table and `mh_posts.youtube_url` (sql/052, applied);
  - YouTube's status line on the post;
  - link-back to the task, bell and Slack.
- **Nothing has been uploaded yet.** No channel can take uploads. Readiness on 6 Nov (`/api/scheduler/youtube-ready`):
  - **GooCampus:** not connected from the dashboard;
  - **12thplus:** not connected from the dashboard;
  - **Samvaya:** connected for reading only.
  Until a channel is ready, the tick stays greyed out with that reason. Safe to have live.

## 1. Reconnect GooCampus — what went wrong on Friday

Brands → GooCampus → YouTube → **Reconnect** reached Google, came back, and the dashboard refused it. Server log:

> That permission is for "Praveen L". Pick GooCampus on Google's channel list and try again.

**Cause:** at Google's account/channel step, the personal channel **Praveen L** was picked instead of the **GooCampus** brand channel. The dashboard checks the channel matches and refused it, correctly; nothing was saved.

**Second problem:** the YouTube tab never showed that reason. It landed on "GooCampus India · No YouTube channel" with no message, even though the address carried `yt=failed&why=…`.
- **Fix:** make `app/(dashboard)/dashboard/preview/youtube/page.tsx` show the `yt` / `why` flags clearly.
- **Also check:** after the redirect, the page should open on the channel that was being connected (`channel=goocampus`), not the GooCampus India brand.

**Retry Monday:**
1. Reconnect.
2. At Google, choose the **GooCampus** channel. It may be under "Switch account" or "Choose a channel", below "Praveen L".
3. Allow.
4. Check: `/api/scheduler/youtube-ready?channel=goocampus` → `ready: true` and the title "GooCampus".

**If GooCampus doesn't appear in Google's list:** the signed-in Google account isn't a manager of that brand channel. Use **Copy connect link** on the same card instead. Send it to whoever owns the GooCampus channel; they open it, pick GooCampus and click Allow.

## 2. Private end-to-end test (GooCampus)

The test post must never reach Instagram or Facebook:
- Use a **test row** in `mh_posts` with `publish_status = 'failed'`. The Meta publisher only picks up `scheduled`; the YouTube worker also accepts `failed`.
- Leave `owner_key` / `created_by` empty so no bell notifications go out.
- Set `custom.youtube = {title:"TEST — delete me", description:""}`.
- Set `publish_to_pages = ['GooCampus Main']`.
- Use one **vertical** mp4 (e.g. the 47 s NRI quota reel, 1080×1920).
- Set `schedule_time` = now + 60 min.

Steps:
1. Run the worker until `yt_uploads.status = 'scheduled'`. Locally: `curl -H "x-cron-secret: …" localhost:3000/api/cron/youtube-shorts`; it reports `% sent` each run.
2. In YouTube Studio, confirm the video is there, **private**, scheduled for the time.
3. Move the row's `schedule_time` → run → Studio shows the new time.
4. Set `publish_status = null` → run → `yt_uploads.status = 'cancelled'` and the video is **gone** from Studio.
5. Delete the test row and its `yt_uploads` row.

Don't let the test reach its post time. Until the audit passes it would stay private and the worker would post "didn't post" to Slack.

## 3. Then the other channels

Do the same Reconnect for **12thplus** and **Samvaya**, picking the right channel each time. The Samvaya owner may need the **Copy connect link**.

## 4. Google audit (Praveen)

- **Project:** `gc-dashboard-analytics` (227161816049), OAuth client "GC YT Token".
- **Submit:** the **YouTube API Services — Audit and Quota Extension** form. Until it passes, every upload stays private, and the worker says so on the post.
- **Also ask** for more quota there: the default is about 6 uploads a day.
- **In Google Cloud → OAuth consent screen → Data access:** add the scope `https://www.googleapis.com/auth/youtube`.

## 5. Turn the worker on in production

Add an n8n schedule: every minute, 10:00–18:00 IST, `GET https://goocampus-ig-dashboard.netlify.app/gc-dashboard/api/cron/youtube-shorts` with header `x-cron-secret`. Same as the LinkedIn worker.
- **Needs:** the n8n connection in this app reconnected first; it was down on 6 Nov.
- **While at it:** add the same kind of schedule for `/api/cron/wa-templates`, every 15 min.
