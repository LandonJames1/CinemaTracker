-- Auto-create a "Bucket List" for every new user.
--
-- Assumptions (matches current app usage in index.html):
-- - "Users" has primary key column: id (uuid)
-- - "Lists" has columns: user_id (uuid), list_name (text)
-- - "Lists" has (or should have) a UNIQUE constraint on (user_id, list_name)
--   (your app already upserts using onConflict: 'user_id,list_name')
--
-- Run this in Supabase SQL Editor.

begin;

-- (Optional but recommended) Ensure uniqueness so we never create duplicates.
-- If you already have this, the statement will fail; you can skip it.
-- create unique index if not exists lists_user_id_list_name_unique on "Lists" (user_id, list_name);

create or replace function public.create_bucket_list_for_new_user()
returns trigger
language plpgsql
as $$
begin
  insert into "Lists" (user_id, list_name)
  values (new.id, 'Bucket List')
  on conflict (user_id, list_name) do nothing;

  return new;
end;
$$;

-- Create trigger on your app profile table.
drop trigger if exists trg_users_create_bucket_list on "Users";
create trigger trg_users_create_bucket_list
after insert on "Users"
for each row
execute function public.create_bucket_list_for_new_user();

-- Backfill (safe): create missing bucket lists for any existing users.
insert into "Lists" (user_id, list_name)
select u.id as user_id, 'Bucket List' as list_name
from "Users" u
left join "Lists" l
  on l.user_id = u.id
 and l.list_name = 'Bucket List'
where l.id is null;

commit;
