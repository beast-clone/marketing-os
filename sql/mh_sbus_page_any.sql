-- 3 Nov 2026: a primary interest (mh_sbus) can post to a brand linked on the Brands page,
-- not only the three GooCampus pages — the app checks the value against the live page
-- list (lib/publish-pages.ts, lib/sbus-db.ts cleanPage). Applied as migration
-- mh_sbus_page_any_linked_brand. Samvaya was renamed "Samvaya Matrimony" with its own page.
alter table mh_sbus drop constraint if exists mh_sbus_page_check;
alter table mh_sbus add constraint mh_sbus_page_check check (page is not null and length(btrim(page)) between 1 and 80);
update mh_sbus set name = 'Samvaya Matrimony', page = 'Samvaya Matrimony' where name = 'Samvaya';
