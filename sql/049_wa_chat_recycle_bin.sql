-- WhatsApp chats go to the Recycle bin instead of being wiped (Praveen, 6 Nov 2026).
--
-- "Delete chat" in the WhatsApp Inbox now only stamps the chat as deleted: the
-- messages stay in wa_messages, the chat leaves the inbox and appears under
-- Recycle bin → WhatsApp chats, where it can be restored or deleted for good.
--
-- A deleted chat reappears in the inbox by itself if the person writes again
-- (deleted_at older than the newest message), the same as WhatsApp does.
--
-- Applied live to wlhbmzaernchwebapszq on 6 Nov 2026.

alter table wa_contacts add column if not exists deleted_at timestamptz;
alter table wa_contacts add column if not exists deleted_by text;
create index if not exists wa_contacts_deleted_idx on wa_contacts (deleted_at) where deleted_at is not null;
