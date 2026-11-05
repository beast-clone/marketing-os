-- One row per WhatsApp chat, worked out in the database.
--
-- The inbox read 3,000 message rows on every poll and grouped them in
-- JavaScript — every fifteen seconds, to show a list of a handful of chats. The
-- cost grew with the message history rather than with the number of
-- conversations, so it would have got slower every week.
--
-- security_invoker matters: without it a view over an RLS-protected table is
-- read with the owner's rights, which would hand anyone holding the publishable
-- key the entire message history.
--
-- Run once in the Supabase SQL editor (project wlhbmzaernchwebapszq).

create or replace view wa_conversations
with (security_invoker = true) as
select
  m.contact,
  max(m.created_at) as last_at,
  (array_agg(m.contact_name order by m.created_at desc) filter (where m.contact_name is not null))[1] as contact_name,
  (array_agg(coalesce(nullif(m.body, ''), '[' || m.kind || ']') order by m.created_at desc))[1] as last_body,
  (array_agg(m.direction order by m.created_at desc))[1] as last_direction,
  count(*) filter (where m.direction = 'in' and m.read_at is null) as unread,
  max(m.created_at) filter (where m.direction = 'in') as last_in_at
from wa_messages m
group by m.contact;

-- The grouping and the unread filter both lean on these.
create index if not exists wa_messages_contact_created_idx on wa_messages (contact, created_at desc);
create index if not exists wa_messages_unread_in_idx on wa_messages (contact) where direction = 'in' and read_at is null;
