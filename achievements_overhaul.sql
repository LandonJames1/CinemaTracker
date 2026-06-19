-- Achievements overhaul: icon "families" + franchise/filmography rule type.
-- Run once in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- This BUILDS ON the existing data-driven engine in achievements_rules_update.sql
-- (the rule jsonb column, award_achievements_for_user(), and the Movie Ratings /
-- Watch Logs triggers that award + recalc tiers automatically and retroactively).
-- Nothing here deletes or recreates achievements, so every earned User Achievements
-- row keeps its achievement_id and stays valid.

------------------------------------------------------------------------
-- 1) Family column.
--    A "family" groups the tiers of one progression (e.g. every "watch N
--    movies" tier) so they SHARE one base icon. The badge renderer applies
--    the tier color as a frame, so you only ever need one icon per family.
------------------------------------------------------------------------
alter table "Achievements"
    add column if not exists family text;

-- Backfill a sensible family for existing achievements: the rule type groups
-- each progression (all rating_count tiers -> one family, etc.). Data-driven,
-- so it doesn't depend on names. New franchise/person achievements get their
-- own family key written by the admin builder (e.g. 'star_wars_saga').
update "Achievements"
set family = coalesce(family, rule->>'type')
where family is null
  and rule is not null;

create index if not exists achievements_family_idx on "Achievements" (family);

------------------------------------------------------------------------
-- 2) New rule type: movie_set
--    Earned when the user has rated a specific SET of movies (matched by
--    TMDB id). Powers franchise / filmography achievements like
--    "Watch the 9 main Star Wars films" or "Complete Christopher Nolan".
--
--    rule shape:
--      {
--        "type": "movie_set",
--        "tmdb_ids": [11, 1891, 1892, 1893, 1894, 1895, 140607, 181808, 181812],
--        "require_count": 9   -- optional; defaults to all listed ids
--      }
--
--    require_count lets you say "any 5 of these" if you ever want partial sets.
------------------------------------------------------------------------
create or replace function award_achievements_for_user(p_user_id uuid)
returns integer
language plpgsql
as $$
declare
    inserted_count integer := 0;
begin
    with metrics as (
        select
            (select count(distinct movie_id)
             from "Movie Ratings"
             where user_id = p_user_id) as rating_count,
            (select count(distinct mg.genre_id)
             from "Movie Ratings" mr
             join "Movie Genres" mg on mg.movie_id = mr.movie_id
             where mr.user_id = p_user_id) as genre_count,
            (select count(distinct (floor(m.release_year / 10) * 10))
             from "Movie Ratings" mr
             join "Movies" m on m.id = mr.movie_id
             where mr.user_id = p_user_id
               and m.release_year is not null) as decade_count,
            (select coalesce(max(cnt), 0)
             from (
                 select mc.person_id, count(distinct mr.movie_id) as cnt
                 from "Movie Ratings" mr
                 join "Movie Crew" mc on mc.movie_id = mr.movie_id
                 where mr.user_id = p_user_id
                   and mc.job = 'Director'
                 group by mc.person_id
             ) t) as director_count,
            (select coalesce(max(cnt), 0)
             from (
                 select movie_id, count(*) as cnt
                 from "Watch Logs"
                 where user_id = p_user_id
                 group by movie_id
             ) t) as rewatch_count,
            (select coalesce(max(cnt), 0)
             from (
                 select watch_date::date as d, count(*) as cnt
                 from "Watch Logs"
                 where user_id = p_user_id
                 group by watch_date::date
             ) t) as daily_count,
            (select coalesce(max(total), 0)
             from (
                 select d,
                        sum(cnt) over (order by d range between interval '6 days' preceding and current row) as total
                 from (
                     select watch_date::date as d, count(*) as cnt
                     from "Watch Logs"
                     where user_id = p_user_id
                     group by watch_date::date
                 ) s
             ) w) as rolling_week_count,
            (select coalesce(max(streak), 0)
             from (
                 select count(*) as streak
                 from (
                     select d,
                            d - (row_number() over (order by d))::int * interval '1 day' as grp
                     from (
                         select distinct watch_date::date as d
                         from "Watch Logs"
                         where user_id = p_user_id
                     ) days
                 ) g
                 group by grp
             ) s) as daily_streak,
            (select coalesce(max(streak), 0)
             from (
                 select count(*) as streak
                 from (
                     select w,
                            w - (row_number() over (order by w))::int * interval '1 week' as grp
                     from (
                         select distinct date_trunc('week', watch_date::date)::date as w
                         from "Watch Logs"
                         where user_id = p_user_id
                     ) weeks
                 ) g
                 group by grp
             ) s) as weekly_streak
    )
    insert into "User Achievements" (user_id, achievement_id, earned_at)
    select p_user_id, a.id, now()
    from "Achievements" a
    cross join metrics m
    where coalesce(a.is_active, true) = true
      and a.rule is not null
      and (
        case a.rule->>'type'
            when 'rating_count' then m.rating_count >= (a.rule->>'threshold')::int
            when 'genre_count' then m.genre_count >= (a.rule->>'threshold')::int
            when 'decade_count' then m.decade_count >= (a.rule->>'threshold')::int
            when 'director_count' then m.director_count >= (a.rule->>'threshold')::int
            when 'rewatch_count' then m.rewatch_count >= (a.rule->>'threshold')::int
            when 'daily_count' then m.daily_count >= (a.rule->>'threshold')::int
            when 'rolling_week_count' then m.rolling_week_count >= (a.rule->>'threshold')::int
            when 'daily_streak' then m.daily_streak >= (a.rule->>'threshold')::int
            when 'weekly_streak' then m.weekly_streak >= (a.rule->>'threshold')::int
            when 'movie_set' then (
                (select count(distinct m2.id)
                   from "Movie Ratings" mr2
                   join "Movies" m2 on m2.id = mr2.movie_id
                   where mr2.user_id = p_user_id
                     and m2.tmdb_id in (
                         select (jsonb_array_elements_text(a.rule->'tmdb_ids'))::int
                     )
                ) >= coalesce(
                    nullif(a.rule->>'require_count', '')::int,
                    jsonb_array_length(a.rule->'tmdb_ids')
                )
            )
            else false
        end
      )
    on conflict do nothing;

    get diagnostics inserted_count = row_count;
    return inserted_count;
end;
$$;

-- The existing triggers already call award_achievements_for_user() on every
-- Movie Ratings / Watch Logs change, so movie_set achievements award (and
-- award retroactively) automatically once their rows exist.

------------------------------------------------------------------------
-- 3) Silent retroactive sweep for everyone.
--    Called by the admin "save_achievement" edge action right after a NEW
--    achievement is created, so every already-qualifying user is granted it
--    immediately and silently — that way it is NOT treated as "newly earned"
--    on their next diary save and no celebration animation fires for something
--    they had effectively already completed. Also runnable by hand after a
--    rule/backfill change. SECURITY DEFINER so the service role can sweep all.
------------------------------------------------------------------------
create or replace function award_all_users()
returns void
language plpgsql
security definer
as $$
declare
    u uuid;
begin
    for u in select id from "Users" loop
        perform award_achievements_for_user(u);
    end loop;
end;
$$;
