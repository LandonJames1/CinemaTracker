-- Supabase SQL: friends Leaderboard (Leaderboard page → "Leaderboard" sub-tab).
-- Run this in the Supabase SQL editor (safe to re-run).
--
-- Each user's leaderboard is scoped to THEMSELVES + the people they FOLLOW, so no
-- global stats are exposed and privacy_level never has to be consulted (you only
-- ever see aggregate counts for people you already follow). The function runs as
-- SECURITY DEFINER so it can count other users' Movie Ratings / Watch Logs rows
-- (which RLS would otherwise hide) but returns ONLY aggregate scores + safe public
-- profile columns — never any review content.
--
-- p_metric:    'movies_rated' | 'achievement_points' | 'watches'
-- p_timeframe: 'all_time' | 'month'  (honored for ALL metrics — for
--              'achievement_points', all_time = the running total on
--              Users.achievement_points, month = points from achievements
--              EARNED this calendar month via User Achievements.earned_at)
create or replace function public.get_follow_leaderboard(
  p_metric text default 'movies_rated',
  p_timeframe text default 'all_time'
)
returns table (
  user_id uuid,
  username text,
  icon text,
  tier_name text,
  tier_icon_url text,
  score numeric,
  is_self boolean
)
language sql
security definer
set search_path = public, auth
as $$
  with me as (
    select auth.uid() as uid
  ),
  scope as (
    -- you + everyone you follow
    select uid as id from me
    union
    select f.followed_id
    from public."Follows" f, me
    where f.follower_id = me.uid
  ),
  bounds as (
    select case when p_timeframe = 'month'
                then date_trunc('month', now())
                else null end as start_ts
  ),
  scored as (
    select
      s.id as user_id,
      case
        when p_metric = 'achievement_points'
          then case
                 when p_timeframe = 'month' then (
                   -- points from achievements EARNED this calendar month
                   select coalesce(sum(a.points), 0)
                   from public."User Achievements" ua
                   join public."Achievements" a on a.id = ua.achievement_id
                   cross join bounds b
                   where ua.user_id = s.id
                     and b.start_ts is not null
                     and ua.earned_at >= b.start_ts
                 )::numeric
                 else coalesce(u.achievement_points, 0)::numeric
               end
        when p_metric = 'watches'
          then (
            select count(*)
            from public."Watch Logs" wl, bounds b
            where wl.user_id = s.id
              and (b.start_ts is null or wl.watch_date >= b.start_ts)
          )::numeric
        else  -- 'movies_rated' (default)
          (
            select count(*)
            from public."Movie Ratings" mr, bounds b
            where mr.user_id = s.id
              and (b.start_ts is null or mr.watch_date >= b.start_ts)
          )::numeric
      end as score
    from scope s
    left join public."Users" u on u.id = s.id
  )
  select
    sc.user_id,
    u.username::text,
    u.icon::text,
    t.name::text          as tier_name,
    t.tier_icon_url::text as tier_icon_url,
    sc.score,
    (sc.user_id = (select uid from me)) as is_self
  from scored sc
  left join public."Users" u on u.id = sc.user_id
  left join public."User Tiers" t on t.id = u.tier_id
  order by sc.score desc, u.username asc nulls last;
$$;

grant execute on function public.get_follow_leaderboard(text, text) to authenticated;
