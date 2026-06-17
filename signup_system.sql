-- ============================================================================
-- CinemaTracker — COMPLETE SIGNUP PROVISIONING SYSTEM (authoritative)
-- ============================================================================
-- Run this once in the Supabase SQL Editor. It is idempotent (safe to re-run).
--
-- What it guarantees: the instant a new auth account is created, the user gets
-- a fully provisioned profile and immediate access to every feature:
--   • public."Users" row  (username, display_name, privacy_level, starting tier,
--                           achievement_points = 0)
--   • "Bucket List"  in public."Lists"
--   • "Recs"         in public."Lists"
-- (Help Pop-ups and Taste Profiles are created lazily by the app on first use,
--  so they are intentionally NOT provisioned here.)
--
-- It does this with ONE SECURITY DEFINER trigger on auth.users, so provisioning
-- runs server-side and does NOT depend on the browser, RLS, the client's auth
-- timing, or the email-confirmation setting. This supersedes the per-"Users"-
-- insert list triggers in bucket_list_auto.sql / recs_and_profile.sql (those can
-- stay; their on-conflict inserts simply no-op).
--
-- ADMIN GATE: self-service signups are gated on public."Settings".allow_signups.
-- The client passes self_signup='true' in the signup metadata; if signups are
-- disabled, the trigger aborts the account creation. Admin-created users (e.g.
-- from the Supabase dashboard, which carry no self_signup flag) are never gated.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) Preconditions: columns + unique constraints the provisioning relies on.
-- ---------------------------------------------------------------------------
alter table public."Users"
  add column if not exists achievement_points int  not null default 0,
  add column if not exists tier_id            uuid references public."User Tiers"(id),
  add column if not exists phone              text,
  add column if not exists carrier            text;

-- One list name per user (so "Bucket List"/"Recs" can't be duplicated).
create unique index if not exists lists_user_name_unique
  on public."Lists" (user_id, list_name);

-- Branded covers for the auto-managed lists live in this lookup table (the data
-- URLs are populated by lists_branded_covers.sql). Created empty-safe here so the
-- provisioning below can reference it even before that script runs (lookup → NULL
-- → list created with no cover, the old behavior). Run lists_branded_covers.sql
-- to fill it and backfill existing rows.
create table if not exists public.list_cover_defaults (
  list_name text primary key,
  cover     text not null
);

-- ---------------------------------------------------------------------------
-- 1) The provisioning function (runs as owner → bypasses RLS).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self       boolean;
  v_allow      boolean;
  v_username   text;
  v_display    text;
  v_start_tier uuid;
begin
  v_self := coalesce((new.raw_user_meta_data->>'self_signup') = 'true', false);

  -- Admin gate: block self-service signups when the admin has them turned off.
  if v_self then
    select s.allow_signups into v_allow
    from public."Settings" s
    order by s.created_at asc
    limit 1;

    if coalesce(v_allow, false) is not true then
      raise exception 'Sign-ups are currently disabled by the site administrator.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Resolve username/display_name from signup metadata.
  v_username := nullif(new.raw_user_meta_data->>'username', '');
  v_display  := nullif(new.raw_user_meta_data->>'display_name', '');

  -- Fallback username (e.g. admin-created users with no metadata): email local
  -- part + a short slice of the id to keep it unique.
  if v_username is null then
    v_username := regexp_replace(split_part(coalesce(new.email, ''), '@', 1),
                                 '[^a-zA-Z0-9_]', '', 'g')
                  || '_' || left(new.id::text, 4);
  end if;

  -- Starting tier = the lowest points threshold (e.g. "Extra" @ 0 points).
  select id into v_start_tier
  from public."User Tiers"
  order by points_needed asc
  limit 1;

  -- 1a) Profile row. display_name is NOT NULL, so fall back to the username when
  --     the signup form left it blank.
  insert into public."Users"
    (id, username, display_name, privacy_level, tier_id, achievement_points)
  values
    (new.id, v_username, coalesce(v_display, v_username), 'public', v_start_tier, 0)
  on conflict (id) do nothing;

  -- 1b) Default lists — immediate access to Bucket List + Recs, each with its
  --     branded cover (from list_cover_defaults; NULL if not yet populated).
  insert into public."Lists" (user_id, list_name, cover)
  select new.id, v.list_name,
         (select d.cover from public.list_cover_defaults d
          where lower(d.list_name) = lower(v.list_name))
  from (values ('Bucket List'), ('Recs')) as v(list_name)
  on conflict (user_id, list_name) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Fire it for every new auth account.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- 3) RLS policies on public."Users" (additive only).
--    Provisioning above is SECURITY DEFINER, so it needs no RLS changes. We do
--    NOT flip the RLS enable switch here (that could regress current behavior,
--    e.g. the pre-signup username check). We only ensure these policies exist so
--    that IF RLS is (or becomes) enabled, normal app operation still works:
--    authenticated users can read profiles and edit their own.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='Users' and policyname='users_select_all') then
    create policy users_select_all on public."Users"
      for select to authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='Users' and policyname='users_insert_self') then
    create policy users_insert_self on public."Users"
      for insert to authenticated with check (id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='Users' and policyname='users_update_self') then
    create policy users_update_self on public."Users"
      for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4) Backfill: provision any existing auth account that is missing pieces
--    (e.g. broken test signups created before this script).
-- ---------------------------------------------------------------------------

-- 4a) Missing profile rows. (display_name is NOT NULL → fall back to username.)
insert into public."Users"
  (id, username, display_name, privacy_level, tier_id, achievement_points)
select
  au.id,
  coalesce(
    nullif(au.raw_user_meta_data->>'username', ''),
    regexp_replace(split_part(coalesce(au.email,''), '@', 1), '[^a-zA-Z0-9_]', '', 'g')
      || '_' || left(au.id::text, 4)
  ) as uname,
  coalesce(
    nullif(au.raw_user_meta_data->>'display_name', ''),
    nullif(au.raw_user_meta_data->>'username', ''),
    regexp_replace(split_part(coalesce(au.email,''), '@', 1), '[^a-zA-Z0-9_]', '', 'g')
      || '_' || left(au.id::text, 4)
  ),
  'public',
  (select id from public."User Tiers" order by points_needed asc limit 1),
  0
from auth.users au
left join public."Users" u on u.id = au.id
where u.id is null;

-- 4b) Missing Bucket List / Recs for any existing profile (with branded cover).
insert into public."Lists" (user_id, list_name, cover)
select u.id, v.list_name,
       (select d.cover from public.list_cover_defaults d
        where lower(d.list_name) = lower(v.list_name))
from public."Users" u
cross join (values ('Bucket List'), ('Recs')) as v(list_name)
on conflict (user_id, list_name) do nothing;

commit;
