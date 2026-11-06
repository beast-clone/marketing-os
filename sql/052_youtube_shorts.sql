-- YouTube Shorts from the Scheduler (Praveen, 6 Nov 2026 — docs/YOUTUBE_SHORTS_SPEC.md).
--
-- One row per post that goes to YouTube: where its upload stands. Kept out of
-- mh_posts.custom on purpose — the Meta publisher (n8n) writes custom back whole
-- after every run, and would wipe progress written there by the YouTube worker
-- (/api/cron/youtube-shorts) in the same minute.
--
-- No foreign key: if a post is deleted while its Short sits on YouTube waiting to
-- go public, the worker must still find this row and take the video down.

create table if not exists yt_uploads (
  post_id     uuid primary key,
  channel     text not null,                 -- lib/youtube-channels.ts key
  fp          text not null,                 -- what was uploaded: video, title, description, channel
  status      text not null,                 -- uploading | scheduled | live | failed | cancelled
  session_url text,                          -- Google's resumable-upload address (valid a week)
  size        bigint,
  sent        bigint not null default 0,     -- bytes YouTube has so far
  video_id    text,
  publish_at  timestamptz,                   -- the post time it was uploaded for
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table yt_uploads enable row level security;   -- service client only

-- The Short's link on the task, next to instagram_url / facebook_url / linkedin_url.
alter table mh_posts add column if not exists youtube_url text;
