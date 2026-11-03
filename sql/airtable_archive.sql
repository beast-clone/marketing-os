-- Airtable archive (Praveen, 3 Nov 2026): a read-only backup of Airtable's Content
-- Calendar from April 2026, so nothing is lost once the team stops using Airtable.
-- Kept apart from mh_posts on purpose: nothing here is live work, so the Rules
-- engine, My Day, notifications and the scheduler never see it. Used for browsing
-- (Archive tab) and for yearly counts by primary interest.
-- Files are copied into storage (scheduler-media/archive/…): Airtable's links expire.
-- Read and written only by the server (service key); RLS on with no policies.

create table if not exists mh_archive (
  airtable_id text primary key,          -- the Airtable record id (re-running the copy is safe)
  title text,                            -- Particulars; null when Airtable had none
  type text, status text, sbu text, priority text,
  owner text, collaborators text[] not null default '{}', created_by text,   -- names as Airtable shows them
  publishing_date date, due_date date, completion_time timestamptz,
  platforms text[] not null default '{}',
  content text, caption text, additional_info text,
  files jsonb not null default '[]',     -- [{url, name, mime, size}]
  fields jsonb not null default '{}',    -- every other Airtable field, as it was
  created_at timestamptz,                -- Airtable's created time
  modified_at timestamptz,               -- Airtable's last modified time
  archived_at timestamptz not null default now()
);
create index if not exists mh_archive_publishing_date on mh_archive (publishing_date);
create index if not exists mh_archive_sbu on mh_archive (sbu);
alter table mh_archive enable row level security;
