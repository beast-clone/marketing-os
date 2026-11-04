# Reel thumbnail — spec

Agreed with Praveen on 4 Nov 2026.

## What

1. **A Thumbnail box on Reel tasks** (types matching `/reel/i`: Reel - Original, Reel - Cut)
   — in the New task form, My Day's task panel and the task window. One image: the reel's
   cover.
2. **The Scheduler uses it as the cover automatically** when the reel is scheduled from
   Ready to schedule (the Thumbnail picker there starts on it; it can still be changed).
3. **A linked thumbnail task fills it.** When the reel has a separate thumbnail task
   (`custom.thumbnail.taskId`, docs/THUMBNAIL_FLOW_SPEC.md), that task's latest image
   creative is used whenever the reel's own Thumbnail box is empty — read at the time,
   not copied, so a re-done thumbnail is picked up.
4. **300 MB on Reel creatives.** The Creatives box on a Reel task always says
   "Keep the video under 300 MB to post on Instagram and Facebook", and turns red,
   naming the file and its size, when an uploaded video is over 300 MB (Instagram
   doesn't take bigger videos from outside its app; the Scheduler would post it to
   Facebook only).

## How it is stored

A file in `mh_attachments` with `kind = 'thumbnail'` (no migration — the column has no
constraint). Every query that treated "not reference, not attachment" as a creative now
also skips `thumbnail`, so a cover is never published as a slide and never sends the
task back for review.

Cover order in the Scheduler: the reel's Thumbnail box → its thumbnail task's newest
image → the old rule (first picture among the reel's creatives).
