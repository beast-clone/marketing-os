-- 6 Nov 2026 (Praveen). Applied live to wlhbmzaernchwebapszq.
--
-- 1. Rule "12thPlus / Samvaya → Nandu" fires only when a task moves FORWARD to
--    Content - Approved. "You can't hold an AIQ seat…" was sent back from
--    Output - Ready to Content - Approved on 4 Nov and the rule took it off Nikhil,
--    who was doing the work. A task sent back from production now keeps its editor.
--    (Written as "previous status is none of the production stages", so a task
--    created straight into Content - Approved still goes to Nandu.)
update mh_rules set
  conditions = jsonb_build_object('conjunction','and','conditions', jsonb_build_array(
     jsonb_build_object('op','isAnyOf','field','sbu','value', jsonb_build_array('12thPlus.com','Samvaya Matrimony')),
     jsonb_build_object('op','isNoneOf','field','previous_status','value', jsonb_build_array('Output - In Progress','Incorporating Feedback','Output - Ready','Ready to Publish','Published/Scheduled','Rejected/Not Published','Failed')))),
  name = 'When a task for 12thPlus.com or Samvaya Matrimony moves forward to Content - Approved, it goes to Nandu. A task sent back from production keeps its editor.',
  updated_by = 'praveen', updated_at = now()
where engine and position = 5 and name like 'When a task for 12thPlus.com or Samvaya Matrimony moves to Content - Approved%';

-- 2. What a status change WOULD do, without doing it — for the confirm dialog shown
--    before a status change that moves the task to someone else or adds people.
--    Runs the real update in a sub-transaction so every trigger and rule fires
--    exactly as on a save, reads the result, then rolls it back.
create or replace function public.mh_status_preview(p_id uuid, p_status text, p_owner text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b_owner text; b_status text; b_collabs text[];
  a_owner text; a_status text; a_collabs text[];
begin
  select owner_key, status::text into b_owner, b_status from mh_posts where id = p_id;
  if not found then return null; end if;
  select coalesce(array_agg(member_key order by member_key), '{}') into b_collabs from mh_post_collaborators where post_id = p_id;
  begin
    update mh_posts set status = p_status::mh_status, owner_key = case when p_owner is null then owner_key else nullif(p_owner, '') end
     where id = p_id;
    select owner_key, status::text into a_owner, a_status from mh_posts where id = p_id;
    select coalesce(array_agg(member_key order by member_key), '{}') into a_collabs from mh_post_collaborators where post_id = p_id;
    raise exception using errcode = 'P0001', message = '__mh_status_preview__';
  exception when sqlstate 'P0001' then
    null;  -- everything above is rolled back; the variables keep what was read
  end;
  return jsonb_build_object(
    'before', jsonb_build_object('status', b_status, 'owner', b_owner, 'collaborators', to_jsonb(b_collabs)),
    'after',  jsonb_build_object('status', a_status, 'owner', a_owner, 'collaborators', to_jsonb(a_collabs)));
end $$;
revoke all on function public.mh_status_preview(uuid, text, text) from public, anon, authenticated;
