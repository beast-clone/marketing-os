-- One row per WhatsApp contact: who is handling the chat, what it is about, and
-- whether it is still open.
--
-- wa_messages holds what was said; nothing held what we know ABOUT a chat. With
-- one number shared by the whole team, two people answer the same person and
-- nobody can tell which chats are already someone's. That is what this fixes.
--
-- Keyed by the phone number itself, not an id. The number IS the identity on
-- WhatsApp, it never changes, and every other table here already refers to a chat
-- by `contact` — a surrogate key would only add a join.
--
-- Run once in the Supabase SQL editor (project wlhbmzaernchwebapszq).

create table if not exists wa_contacts (
  contact      text primary key,
  -- A name somebody typed, which beats the WhatsApp profile name: students set
  -- those to nicknames. wa_messages.contact_name keeps Meta's version; this wins
  -- in the UI when it is set.
  display_name text,
  -- ind_users.id, or null for nobody yet. Deliberately not a foreign key: the
  -- roster lives in ind_users and people get deactivated, and a chat should not
  -- refuse to save because the person who had it has left.
  assigned_to  text,
  labels       text[] not null default '{}',
  note         text,
  -- open: needs an answer. closed: dealt with. spam: hide it.
  status       text not null default 'open' check (status in ('open', 'closed', 'spam')),
  updated_at   timestamptz not null default now(),
  updated_by   text
);

-- The inbox filters on these two constantly ("unassigned", "my chats", "open").
create index if not exists wa_contacts_assigned_idx on wa_contacts (assigned_to);
create index if not exists wa_contacts_status_idx   on wa_contacts (status);

-- Same posture as every other table here: RLS on, no policies. The dashboard
-- reaches Supabase with the service-role key, which bypasses RLS; anything
-- holding only the publishable key gets nothing. Do not add anon policies.
alter table wa_contacts enable row level security;

-- Added later the same day, as the inbox grew:
--   alerted_at — the last message announced for this chat, so the 15-minute
--                nudge says it once and not every quarter of an hour.
--   blocked    — mirrors Meta's own block list for the number, so the inbox can
--                show it without asking Meta on every load.
alter table wa_contacts add column if not exists alerted_at timestamptz;
alter table wa_contacts add column if not exists blocked boolean not null default false;

-- Storage, created through the API rather than here (buckets are not SQL):
--   bucket `wa-media`, PRIVATE, 25 MB limit — incoming photos and PDFs.
--   Private on purpose: these are mark sheets and ID documents belonging to
--   other people, and every other bucket in this project is public-read.
