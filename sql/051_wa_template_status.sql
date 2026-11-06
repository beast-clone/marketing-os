-- The last Meta verdict we saw for each WhatsApp template (Praveen, 6 Nov 2026).
--
-- /api/cron/wa-templates compares Meta's live list against this every 15 minutes in
-- office hours and announces what changed (approved, rejected, paused, moved to
-- marketing) in the dashboard bell and on Slack. Meta is the source of truth; this
-- is only the "what did it say last time" memory that makes a change visible.

create table if not exists wa_template_status (
  name       text not null,
  language   text not null,
  status     text not null,
  category   text not null,
  reason     text,
  updated_at timestamptz not null default now(),
  primary key (name, language)
);

alter table wa_template_status enable row level security;   -- service client only
