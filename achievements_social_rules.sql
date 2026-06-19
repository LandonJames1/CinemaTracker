-- More achievement categories: social (recommend/follow), curation (lists),
-- viewing habits (theater, runtime, series), taste (high ratings, quotes), and
-- per-actor filmography. Run once in the Supabase SQL editor AFTER
-- achievements_overhaul.sql. Idempotent (re-runnable).
--
-- This `create or replace`s award_achievements_for_user with the full menu
-- (all prior rule types + the new ones) and adds triggers on Recommendations /
-- Follows / Lists so those achievements award promptly (the old triggers only
-- fired on Movie Ratings / Watch Logs).
--
-- NEW rule types (rule JSON `type`):
--   recommend_count    movies you've recommended to others   (Recommendations.from_user_id)
--   follow_count       people you follow                     (Follows.follower_id)
--   follower_count     people who follow you                 (Follows.followed_id)
--   list_count         custom lists you've made (excl. auto) (Lists.user_id)
--   theater_count      movies watched in theaters            (Watch Logs.watch_method)
--   actor_count        max movies sharing one actor          (Movie Cast)
--   quote_count        favourite quotes saved                (Movie Ratings.fav_quote)
--   series_count       series watched                        (Movies.is_series)
--   runtime_hours      total hours watched (threshold = hrs) (sum Movies.runtime_minutes)
--   high_rating_count  movies rated >= min_overall (default 90); rule may set "min_overall"

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
             from "Movie Ratings" where user_id = p_user_id) as rating_count,
            (select count(distinct mg.genre_id)
             from "Movie Ratings" mr
             join "Movie Genres" mg on mg.movie_id = mr.movie_id
             where mr.user_id = p_user_id) as genre_count,
            (select count(distinct (floor(m.release_year / 10) * 10))
             from "Movie Ratings" mr
             join "Movies" m on m.id = mr.movie_id
             where mr.user_id = p_user_id and m.release_year is not null) as decade_count,
            (select coalesce(max(cnt), 0) from (
                 select mc.person_id, count(distinct mr.movie_id) as cnt
                 from "Movie Ratings" mr
                 join "Movie Crew" mc on mc.movie_id = mr.movie_id
                 where mr.user_id = p_user_id and mc.job = 'Director'
                 group by mc.person_id) t) as director_count,
            (select coalesce(max(cnt), 0) from (
                 select movie_id, count(*) as cnt
                 from "Watch Logs" where user_id = p_user_id
                 group by movie_id) t) as rewatch_count,
            (select coalesce(max(cnt), 0) from (
                 select watch_date::date as d, count(*) as cnt
                 from "Watch Logs" where user_id = p_user_id
                 group by watch_date::date) t) as daily_count,
            (select coalesce(max(total), 0) from (
                 select d, sum(cnt) over (order by d range between interval '6 days' preceding and current row) as total
                 from (select watch_date::date as d, count(*) as cnt
                       from "Watch Logs" where user_id = p_user_id
                       group by watch_date::date) s) w) as rolling_week_count,
            (select coalesce(max(streak), 0) from (
                 select count(*) as streak from (
                     select d, d - (row_number() over (order by d))::int * interval '1 day' as grp
                     from (select distinct watch_date::date as d
                           from "Watch Logs" where user_id = p_user_id) days) g
                 group by grp) s) as daily_streak,
            (select coalesce(max(streak), 0) from (
                 select count(*) as streak from (
                     select w, w - (row_number() over (order by w))::int * interval '1 week' as grp
                     from (select distinct date_trunc('week', watch_date::date)::date as w
                           from "Watch Logs" where user_id = p_user_id) weeks) g
                 group by grp) s) as weekly_streak,
            -- new metrics
            (select count(*) from "Recommendations" where from_user_id = p_user_id) as recommend_count,
            (select count(*) from "Follows" where follower_id = p_user_id) as follow_count,
            (select count(*) from "Follows" where followed_id = p_user_id) as follower_count,
            (select count(*) from "Lists"
             where user_id = p_user_id and list_name not in ('Bucket List', 'Recs')) as list_count,
            (select count(*) from "Watch Logs"
             where user_id = p_user_id
               and (lower(watch_method) like '%theater%' or lower(watch_method) like '%theatre%')) as theater_count,
            (select coalesce(max(cnt), 0) from (
                 select mc.person_id, count(distinct mr.movie_id) as cnt
                 from "Movie Ratings" mr
                 join "Movie Cast" mc on mc.movie_id = mr.movie_id
                 where mr.user_id = p_user_id
                 group by mc.person_id) t) as actor_count,
            (select count(*) from "Movie Ratings"
             where user_id = p_user_id and fav_quote is not null and btrim(fav_quote) <> '') as quote_count,
            (select count(distinct mr.movie_id)
             from "Movie Ratings" mr join "Movies" m on m.id = mr.movie_id
             where mr.user_id = p_user_id and m.is_series = true) as series_count,
            (select coalesce(floor(sum(m.runtime_minutes) / 60.0), 0)
             from "Movie Ratings" mr join "Movies" m on m.id = mr.movie_id
             where mr.user_id = p_user_id and m.runtime_minutes is not null) as runtime_hours
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
            when 'recommend_count' then m.recommend_count >= (a.rule->>'threshold')::int
            when 'follow_count' then m.follow_count >= (a.rule->>'threshold')::int
            when 'follower_count' then m.follower_count >= (a.rule->>'threshold')::int
            when 'list_count' then m.list_count >= (a.rule->>'threshold')::int
            when 'theater_count' then m.theater_count >= (a.rule->>'threshold')::int
            when 'actor_count' then m.actor_count >= (a.rule->>'threshold')::int
            when 'quote_count' then m.quote_count >= (a.rule->>'threshold')::int
            when 'series_count' then m.series_count >= (a.rule->>'threshold')::int
            when 'runtime_hours' then m.runtime_hours >= (a.rule->>'threshold')::int
            when 'high_rating_count' then (
                select count(*) from "Movie Ratings" mr3
                where mr3.user_id = p_user_id
                  and mr3.overall_rating >= coalesce(nullif(a.rule->>'min_overall','')::int, 90)
            ) >= (a.rule->>'threshold')::int
            when 'movie_set' then (
                (select count(distinct m2.id)
                   from "Movie Ratings" mr2
                   join "Movies" m2 on m2.id = mr2.movie_id
                   where mr2.user_id = p_user_id
                     and m2.tmdb_id in (select (jsonb_array_elements_text(a.rule->'tmdb_ids'))::int)
                ) >= coalesce(nullif(a.rule->>'require_count','')::int, jsonb_array_length(a.rule->'tmdb_ids'))
            )
            else false
        end
      )
    on conflict do nothing;

    get diagnostics inserted_count = row_count;
    return inserted_count;
end;
$$;

-- ── Triggers so social/curation achievements award promptly ──
create or replace function on_recommendation_change_award()
returns trigger language plpgsql as $$
begin
    perform award_achievements_for_user(coalesce(new.from_user_id, old.from_user_id));
    perform recalc_user_tier(coalesce(new.from_user_id, old.from_user_id));
    return null;
end; $$;
drop trigger if exists recommendation_award_achievements on "Recommendations";
create trigger recommendation_award_achievements
after insert or update or delete on "Recommendations"
for each row execute function on_recommendation_change_award();

create or replace function on_follow_change_award()
returns trigger language plpgsql as $$
begin
    perform award_achievements_for_user(coalesce(new.follower_id, old.follower_id));
    perform award_achievements_for_user(coalesce(new.followed_id, old.followed_id));
    perform recalc_user_tier(coalesce(new.follower_id, old.follower_id));
    perform recalc_user_tier(coalesce(new.followed_id, old.followed_id));
    return null;
end; $$;
drop trigger if exists follow_award_achievements on "Follows";
create trigger follow_award_achievements
after insert or update or delete on "Follows"
for each row execute function on_follow_change_award();

create or replace function on_list_change_award()
returns trigger language plpgsql as $$
begin
    perform award_achievements_for_user(coalesce(new.user_id, old.user_id));
    perform recalc_user_tier(coalesce(new.user_id, old.user_id));
    return null;
end; $$;
drop trigger if exists list_award_achievements on "Lists";
create trigger list_award_achievements
after insert or update or delete on "Lists"
for each row execute function on_list_change_award();
