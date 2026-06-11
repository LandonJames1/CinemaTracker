-- CinemaTracker: Web Push subscriptions.
--
-- One row per device/browser a user has opted into push on. The front end writes
-- these (RLS: a user manages only their own); the swift-api edge function reads
-- them with the service role to send pushes, and deletes dead ones (HTTP 404/410).
--
-- Run this in the Supabase SQL Editor.

begin;

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='push_subscriptions' and policyname='push_subs_select_own') then
    create policy push_subs_select_own on public.push_subscriptions
      for select to authenticated using (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='push_subscriptions' and policyname='push_subs_insert_own') then
    create policy push_subs_insert_own on public.push_subscriptions
      for insert to authenticated with check (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='push_subscriptions' and policyname='push_subs_update_own') then
    create policy push_subs_update_own on public.push_subscriptions
      for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='push_subscriptions' and policyname='push_subs_delete_own') then
    create policy push_subs_delete_own on public.push_subscriptions
      for delete to authenticated using (user_id = auth.uid());
  end if;
end
$$;

commit;
