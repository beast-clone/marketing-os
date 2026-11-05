# Cron jobs — moved off Netlify

The seven Netlify Scheduled Functions under `netlify/functions/*-cron.mts` were
deleted on 2 October 2026. Netlify bills their run time against the team's credit
allowance, and one of them (`competitor-watch`) was timing out on every single run
and retrying three times — about 7 hours of wasted compute a day.

**No application logic was lost.** Those files were ~20-line shims. Every one of
them did the same thing: call a Next.js API route with a shared secret. All the
real work still lives in `app/api/cron/*/route.ts` and `lib/`.

## Rebuilt in n8n — created 2 October 2026, all INACTIVE

Six replacements exist in n8n (`n8n.srv1046538.hstgr.cloud`), each a Schedule
trigger into an HTTP Request carrying `x-cron-secret`. **None of them is switched
on.** Activating is a deliberate step — they start hitting production the moment
they are enabled.

| Workflow | ID | Schedule |
| --- | --- | --- |
| GC Dashboard — Watchers | `u0Wh2FCfuUPlc0BI` | every 15 min |
| GC Dashboard — Import Airtable | `jSJDzpkK5trV0J1B` | hourly |
| GC Dashboard — Radar Refresh | `pgwHISeTcdEltX6S` | hourly |
| GC Dashboard — Snapshot Stories | `VBPWyH2nhHzYgtZO` | hourly |
| GC Dashboard — Link Published | `pGJ8C8vTl6CJmk2R` | daily 02:00 |
| GC Dashboard — Radar Rolloff | `m7outQ1x5BjPAedf` | daily 23:59 |

`competitor-watch` was deliberately **not** rebuilt — see the warning further down.

### Status as of 2 October 2026, 11:10 pm IST

All nine dashboard workflows are **active**. Seven carry an explicit
`Asia/Kolkata` timezone; two still run on the Europe/Berlin default.

| Workflow | Set to | Timezone | Actually fires |
| --- | --- | --- | --- |
| Watchers | every 15 min | Asia/Kolkata | correct |
| Import Airtable | hourly | Asia/Kolkata | correct |
| Radar Refresh | hourly | Asia/Kolkata | correct |
| Snapshot Stories | hourly | Asia/Kolkata | correct |
| Link Published | 02:00 | Asia/Kolkata | 02:00 IST |
| Radar Rolloff | 23:59 | Asia/Kolkata | 23:59 IST |
| Daily Comment Digest | 21:00 | Asia/Kolkata | 21:00 IST |
| Daily Metrics Snapshot | 06:30 | Asia/Kolkata | 06:30 IST |
| Nightly Lead-Status Snapshot | 01:00 | Asia/Kolkata | 01:00 IST |

**All nine carry an explicit `Asia/Kolkata` timezone and all nine are active.**
No trigger hour was changed, and none should be: the numbers were always right,
they were simply being read in Europe/Berlin. Editing the hours now would move
every job off its intended time.

`GENERIC_TIMEZONE=Asia/Kolkata` on the n8n host is still worth setting. It is no
longer needed for these nine, but without it the next workflow anyone creates
silently inherits Europe/Berlin again — which is exactly how this started.

`Import Airtable` was test-run on 2 Oct (execution `2958838`, success in 4s). The
endpoint returned OK and no rows changed, which is consistent with nothing new in
Airtable at that moment rather than a failure.

### The n8n instance is NOT on IST — fix this before trusting any daily job

Measured, not assumed. "GC Dashboard — Daily Metrics Snapshot" is configured for
**06:30** and its last two runs started at **04:30 UTC** (1 and 2 October 2026).
That is a +2 offset, so the instance is running **Europe/Berlin**, n8n's default —
not Asia/Kolkata.

What that means:

- That existing snapshot, labelled 06:30, actually fires at **10:00 IST**.
- The two new daily workflows, entered as 02:00 and 23:59, would fire at
  **05:30 IST** and **03:29 IST**.
- The four hourly / 15-minute workflows are unaffected — interval schedules do
  not care about the zone.

**The fix:** set the timezone to `Asia/Kolkata`, either per workflow (open the
workflow → three-dot menu → Settings → Timezone) or instance-wide via the
`GENERIC_TIMEZONE` environment variable on the n8n host. Do not compensate by
shifting the configured hours: Europe/Berlin leaves summer time on 25 October
2026, which would silently move every "corrected" job by an hour.

This cannot be done from here. The n8n SDK has no timezone field, the MCP
`update_workflow` tool rejects its own `operations` argument, and the n8n UI
requires a sign-in that only the account holder should perform.

### The secret

The workflows carry the same `x-cron-secret` value as the existing, working
"GC Dashboard — Daily Metrics Snapshot" workflow. That value was checked against
`CRON_SECRET` in `.env.local` and matches. If the secret is ever rotated, all of
these need updating too.

## The schedules that were removed

Recreate these in whatever scheduler you use. Each is a plain HTTP `GET`.

| Endpoint | Schedule (UTC) | In plain words |
| --- | --- | --- |
| `/api/cron/watchers` | `*/15 * * * *` | every 15 minutes |
| `/api/cron/competitor-watch` | `*/5 * * * *` | every 5 minutes — **see the warning below** |
| `/api/cron/import-airtable` | **OFF** since 8 Oct 2026 | tasks are created in the dashboard; set `AIRTABLE_IMPORT=on` to resume |
| `/api/cron/radar-refresh` | `@hourly` | on the hour |
| `/api/cron/snapshot-stories` | `@hourly` | on the hour |
| `/api/cron/link-published` | `30 20 * * *` | 20:30 UTC = 2:00 am IST |
| `/api/cron/radar-rolloff` | `29 18 * * *` | 18:29 UTC = 11:59 pm IST |

Netlify cron expressions were UTC. Keep that in mind if the new scheduler runs in
local time — `link-published` and `radar-rolloff` were deliberately offset so they
land at 2:00 am and 11:59 pm IST.

## How to call them

```
GET https://<the-dashboard-host>/api/cron/<name>
x-cron-secret: <value of CRON_SECRET>
```

The routes reject anything without a matching `x-cron-secret` header, so the
schedule can live anywhere — n8n, cron-job.org, GitHub Actions, a server crontab.

## Do not re-enable competitor-watch until it is fixed

`/api/cron/competitor-watch?ig=1` was returning **504 Inactivity Timeout** on every
invocation, taking the full 30 seconds and then being retried. That is a fault in
the route, not in the scheduler, so pointing a different scheduler at it will fail
in exactly the same way. Fix the slowness first, then schedule it — and hourly is
almost certainly enough for competitor snapshots. Every five minutes was 288 calls
a day to notice changes that move weekly.

## A caveat worth understanding

Moving the *trigger* off Netlify does not move the *work* off Netlify. These routes
are Next.js App Router handlers, so they still execute as Netlify functions and
still consume compute. What this change removes is the wrapper around each call —
and, in `competitor-watch`'s case, the three timed-out retries that were the bulk
of the waste.

`/api/cron/watchers` was taking 22–25 seconds per run. That is fine on its own, but
it is close enough to any 30-second ceiling that one slow notice board will tip it
over. Worth fetching the watched pages in parallel rather than one after another.

---

# The overnight stop zone (00:00–06:00 IST)

Nothing is to run between midnight and 6 am. Nobody is reading the dashboard and
no source publishes anything at that hour that cannot wait until morning, so
every call in that window is spend for nothing.

The browser side is already enforced in code — `lib/quiet-hours.ts`, which every
background poller now checks. Opening a page at 2 am still works and still loads
fresh data; only the self-firing timers stop.

The n8n side is **applied** (3 October 2026). It needed a write-scoped API key —
a read-only one returns 403 on `PUT` and `/deactivate`.

Diagnostics → Netlify usage shows the count of calls still landing in the window.
It reads 0. If it ever reads anything else, a schedule has drifted back in.

| Workflow | Was | Now | Why |
| --- | --- | --- | --- |
| Import Airtable | hourly | cron `0 6-23 * * *` | 6 runs a day were inside the window |
| Radar Refresh | hourly | cron `15 6-23 * * *` | same, and staggered off the hour |
| Snapshot Stories | hourly | cron `30 6-23 * * *` | same |
| Nightly Lead-Status Snapshot | daily 01:00 | daily **06:05** | still captures the previous day, just later |
| Link Published | daily 02:00 | daily **06:10** | filling in published URLs can wait |
| Diagnostics | daily 05:00 | daily **06:15** | and set its timezone — it is the only one still unset |

They were renamed to match, since the Workflows tab shows the name:

- `GC Dashboard — Import Airtable (hourly, 6am–11pm IST)`
- `GC Dashboard — Radar Refresh (hourly, 6am–11pm IST)`
- `GC Dashboard — Snapshot Stories (hourly, 6am–11pm IST)`
- `GC Dashboard — Lead-Status Snapshot (daily 6:05 am IST)`
- `GC Dashboard — Link Published (daily 6:10 am IST)`
- `GC Dashboard — Diagnostics (daily 6:15 am IST)`

Three already sit outside the window and need no change: Daily Metrics Snapshot
(06:30), Daily Comment Digest (21:00), Radar Rolloff (23:59).

## The watchers job

`GC Dashboard — Watchers` (`u0Wh2FCfuUPlc0BI`) existed and was running all
along, every 15 minutes, round the clock. It was easy to miss — and was missed —
because **the n8n list API pages at 250 and this account is over that**, so a
single un-paged call silently drops whatever sits past the first page. Both
`/api/n8n/workflows` and `/api/netlify/usage` now follow the cursor to the end.
If a job you know exists is not on the Workflows tab, suspect paging first.

It was also by far the most expensive thing pointed at this site: 96 runs a day
at 22-25 seconds each, about 37 minutes of compute a day, which was 85% of the
total. It is now:

```
Schedule trigger: cron  0,30 6-23 * * *     (every 30 min, 6am-11:30pm IST)
Timezone:         Asia/Kolkata
```

Half-hourly rather than quarter-hourly: a notice board checked twice an hour is
plenty, and it takes the cost from ~37 minutes a day to ~14. Raise it again if
something is ever genuinely missed.

Note the standalone **KEA UGNEET 2026 Notification Watcher** is a separate n8n
workflow that watches the same KEA and MCC pages and sends its own Slack and
email alerts. It runs around the clock and is untouched by any of this. Worth
deciding whether both should exist.


## GEO SEO — added 28 October 2026, active

| Workflow | ID | Schedule |
| --- | --- | --- |
| GC Dashboard — GEO SEO weekly check | `IvdWsPVGfeg22nBM` | Mondays 09:00 IST → `/api/cron/geo?do=weekly` |
| GC Dashboard — GEO SEO collect answers | `1KPa0lvH0WsOIZMR` | every 10 min, 6:00–23:50 IST → `/api/cron/geo?do=collect` |


## Daily date-change email — added 4 November 2026, active

| Workflow | ID | Schedule |
| --- | --- | --- |
| GC Dashboard — Daily date changes | `gitA0h02Mm1rPlwP` | 21:00 IST, every day → `/api/cron/date-change-daily` (credential: GC Dashboard Cron) |

The admin doesn't approve date changes any more (approval switched off for everyone,
4 Nov) — they get one email at 9 PM listing every publish date moved that day, who moved
it and why. Anything still waiting for approval (if someone's switch is ever turned back
on) is listed too. Quiet day → no email. Copy the Daily Comment Digest workflow (same
`x-cron-secret` header).


## WhatsApp — unanswered replies — added 5 November 2026, NOT YET SCHEDULED

| Workflow | ID | Schedule |
| --- | --- | --- |
| *(to create)* GC Dashboard — WhatsApp unread | — | every 15 min, 9:00–21:00 IST → `/api/cron/wa-unread` (header `x-cron-secret`, credential: GC Dashboard Cron) |

Posts one Slack message when a WhatsApp reply has gone unanswered for more than
10 minutes. Worth interrupting someone over, because a free reply is only allowed
for 24 hours after the person writes — one left overnight costs an approved
template to reopen the conversation.

Says it once per chat, not every quarter of an hour: `wa_contacts.alerted_at`
records the last message announced, so a chat that sits unread all afternoon is
mentioned once, while a *new* message in that same chat is announced again.
Nothing waiting, or nothing new → no Slack message, so a quiet day is silent.

Office hours only on purpose. Outside them nobody is going to answer, and the
nudge would just train people to ignore it.

Needs `SLACK_WEBHOOK_URL` (already set on Netlify, not locally — the endpoint
still runs and still marks chats as announced without it, it just posts nothing).
