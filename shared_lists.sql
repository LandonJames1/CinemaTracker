-- CinemaTracker: Shared (group) lists
-- Apply in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- WHAT THIS ADDS
--   A list can be SHARED with other users. Any member (the creator + everyone
--   added) can add/remove movies, rename, delete the list, and add/remove other
--   members ("any member" admin model). The list is still OWNED by its creator
--   (Lists.user_id) — every "Movie Lists" row for the list keeps user_id = owner
--   so the existing user_list_items_v1 view + the owner-keyed read paths keep
--   working unchanged; we just add an `added_by` column to record who added each
--   movie.
--
--   Membership lives in a new "List Members" table. A user is a "member" of a list
--   if they are the owner (Lists.user_id) OR they have a row in "List Members".
--
-- HOW THE APP USES IT
--   - Lists the user can see  = lists they own UNION lists they're a member of.
--   - Reading a shared list's items: query user_list_items_v1 / "Movie Lists"
--     filtered by user_id = <list owner> (NOT the viewer), which the new RLS
--     policies below allow for any member.
--   - Adding a movie to a shared list: insert with user_id = <owner>, added_by = me.

-- 1) Columns ----------------------------------------------------------------
alter table public."Lists"
  add column if not exists is_shared boolean not null default false;

alter table public."Movie Lists"
  add column if not exists added_by uuid;

-- 2) Membership table -------------------------------------------------------
create table if not exists public."List Members" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  list_id uuid not null references public."Lists"(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_by uuid,
  role text not null default 'editor'
);

create unique index if not exists list_members_list_user_unique
  on public."List Members" (list_id, user_id);
create index if not exists list_members_user_idx
  on public."List Members" (user_id);

alter table public."List Members" enable row level security;

-- 3) Membership helper ------------------------------------------------------
-- SECURITY DEFINER so it bypasses RLS on Lists / List Members (avoids the policy
-- recursion you'd get if a List Members policy queried List Members directly).
create or replace function public.is_list_member(p_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public."Lists" l
    where l.id = p_list_id and l.user_id = auth.uid()
  ) or exists (
    select 1 from public."List Members" m
    where m.list_id = p_list_id and m.user_id = auth.uid()
  );
$$;

grant execute on function public.is_list_member(uuid) to authenticated;

-- 4) Policies: Lists — members can read/update/delete a shared list -----------
-- (Permissive policies are OR-ed with the existing owner-only ones.)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='Lists' and policyname='lists_select_member') then
    create policy lists_select_member on public."Lists"
      for select to authenticated using (public.is_list_member(id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='Lists' and policyname='lists_update_member') then
    create policy lists_update_member on public."Lists"
      for update to authenticated using (public.is_list_member(id)) with check (public.is_list_member(id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='Lists' and policyname='lists_delete_member') then
    create policy lists_delete_member on public."Lists"
      for delete to authenticated using (public.is_list_member(id));
  end if;
end $$;

-- 5) Policies: Movie Lists — members can read/add/remove movies --------------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='Movie Lists' and policyname='movie_lists_select_member') then
    create policy movie_lists_select_member on public."Movie Lists"
      for select to authenticated using (public.is_list_member(list_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='Movie Lists' and policyname='movie_lists_insert_member') then
    create policy movie_lists_insert_member on public."Movie Lists"
      for insert to authenticated with check (public.is_list_member(list_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='Movie Lists' and policyname='movie_lists_delete_member') then
    create policy movie_lists_delete_member on public."Movie Lists"
      for delete to authenticated using (public.is_list_member(list_id));
  end if;
end $$;

-- 6) Policies: List Members — any member manages membership ------------------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='List Members' and policyname='list_members_select') then
    create policy list_members_select on public."List Members"
      for select to authenticated using (public.is_list_member(list_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='List Members' and policyname='list_members_insert') then
    create policy list_members_insert on public."List Members"
      for insert to authenticated with check (public.is_list_member(list_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='List Members' and policyname='list_members_delete') then
    -- Any member can remove a membership row, AND a user may always remove
    -- themselves (leave a list).
    create policy list_members_delete on public."List Members"
      for delete to authenticated using (public.is_list_member(list_id) or user_id = auth.uid());
  end if;
end $$;
