-- Supabase SQL: user search by username OR email (Feed → "Search people you follow…").
-- Run this in the Supabase SQL editor (safe to re-run).
--
-- Email lives in auth.users (not client-readable), so the search runs in a
-- SECURITY DEFINER function that can join auth.users. It matches username OR email
-- but returns ONLY safe columns (id/username/display_name/privacy_level/icon) — the
-- email is used for matching and is NEVER returned to the client, so emails can't be
-- enumerated.
create or replace function public.search_users(p_query text)
returns table (
  id uuid,
  username text,
  display_name text,
  privacy_level text,
  icon text
)
language sql
security definer
set search_path = public, auth
as $$
  select
    u.id,
    u.username::text,
    u.display_name::text,
    u.privacy_level::text,
    u.icon::text
  from public."Users" u
  left join auth.users au on au.id = u.id
  where p_query is not null
    and length(btrim(p_query)) > 0
    and (
      coalesce(u.username, '') ilike '%' || p_query || '%'
      or coalesce(au.email, '') ilike '%' || p_query || '%'
    )
  order by u.username nulls last
  limit 20;
$$;

grant execute on function public.search_users(text) to authenticated;
