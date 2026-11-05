-- Saved WhatsApp replies — the answers the team types over and over.
--
-- Office address, fee structure, timings. Today each person retypes them, so the
-- same question gets four slightly different answers depending who is at the
-- desk.
--
-- Deliberately just the text. An earlier plan had a short title beside it, but a
-- quick reply IS its text, and naming each one is a second thing to invent before
-- the feature is useful; the list shows the first line instead. Anyone can add
-- one by typing a reply and saving it, so nobody has to supply wording up front.
--
-- Run once in the Supabase SQL editor (project wlhbmzaernchwebapszq).

create table if not exists wa_quick_replies (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  created_by text,
  created_at timestamptz not null default now()
);

alter table wa_quick_replies enable row level security;
