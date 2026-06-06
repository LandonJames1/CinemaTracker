-- CinemaTracker: Movie Recommendations feature
-- Run this in the Supabase SQL Editor.
--
-- Adds:
--   1) An auto-created "Recs" list per user (mirrors the Bucket List pattern).
--      Every movie recommended TO a user is added to that user's "Recs" list.
--   2) phone + carrier columns on "Users" for email-to-SMS notifications.

begin;

-- 1) Auto-create a "Recs" list for every user -------------------------------

create or replace function public.create_recs_list_for_new_user()
returns trigger
language plpgsql
as $$
begin
  insert into "Lists" (user_id, list_name)
  values (new.id, 'Recs')
  on conflict (user_id, list_name) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_users_create_recs_list on "Users";
create trigger trg_users_create_recs_list
after insert on "Users"
for each row
execute function public.create_recs_list_for_new_user();

-- Backfill: create the "Recs" list for any existing users that don't have one.
insert into "Lists" (user_id, list_name)
select u.id as user_id, 'Recs' as list_name
from "Users" u
left join "Lists" l
  on l.user_id = u.id
 and l.list_name = 'Recs'
where l.id is null;

-- 2) Phone + carrier on Users ----------------------------------------------

alter table public."Users" add column if not exists phone   text;
alter table public."Users" add column if not exists carrier text;

commit;
