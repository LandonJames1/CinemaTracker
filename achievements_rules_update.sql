-- Full data-driven achievement rules + triggers (single file).
-- Run this in Supabase SQL editor.

-- 1) Add rule column if missing.
alter table "Achievements"
    add column if not exists rule jsonb;

-- 2) Populate rules based on existing names (safe to run multiple times).
update "Achievements"
set rule = case name
    when 'First Screening' then '{"type":"rating_count","threshold":10,"source":"ratings"}'::jsonb
    when 'Film Buff' then '{"type":"rating_count","threshold":50,"source":"ratings"}'::jsonb
    when 'Dedicated Critic' then '{"type":"rating_count","threshold":250,"source":"ratings"}'::jsonb
    when 'Cinema Archivist' then '{"type":"rating_count","threshold":750,"source":"ratings"}'::jsonb
    when 'Screen Authority' then '{"type":"rating_count","threshold":1000,"source":"ratings"}'::jsonb
    when 'Screen Legend' then '{"type":"rating_count","threshold":1250,"source":"ratings"}'::jsonb
    when 'Master of Cinema' then '{"type":"rating_count","threshold":1500,"source":"ratings"}'::jsonb

    when 'Encore' then '{"type":"rewatch_count","threshold":2,"source":"watch_logs"}'::jsonb
    when 'Comfort Classic' then '{"type":"rewatch_count","threshold":3,"source":"watch_logs"}'::jsonb
    when 'Repeat Viewer' then '{"type":"rewatch_count","threshold":5,"source":"watch_logs"}'::jsonb
    when 'Cult Favorite' then '{"type":"rewatch_count","threshold":7,"source":"watch_logs"}'::jsonb
    when 'Devoted Fan' then '{"type":"rewatch_count","threshold":10,"source":"watch_logs"}'::jsonb
    when 'Legendary Obsession' then '{"type":"rewatch_count","threshold":15,"source":"watch_logs"}'::jsonb
    when 'Timeless Classic' then '{"type":"rewatch_count","threshold":25,"source":"watch_logs"}'::jsonb

    when 'Director Devotee' then '{"type":"director_count","threshold":4,"source":"ratings"}'::jsonb
    when 'Director Loyalist' then '{"type":"director_count","threshold":6,"source":"ratings"}'::jsonb
    when 'Director Disciple' then '{"type":"director_count","threshold":8,"source":"ratings"}'::jsonb
    when 'Director Specialist' then '{"type":"director_count","threshold":10,"source":"ratings"}'::jsonb
    when 'Director Scholar' then '{"type":"director_count","threshold":12,"source":"ratings"}'::jsonb
    when 'Director Archivist' then '{"type":"director_count","threshold":15,"source":"ratings"}'::jsonb
    when 'Director Master' then '{"type":"director_count","threshold":20,"source":"ratings"}'::jsonb

    when 'Genre Explorer' then '{"type":"genre_count","threshold":4,"source":"ratings"}'::jsonb
    when 'Genre Hopper' then '{"type":"genre_count","threshold":6,"source":"ratings"}'::jsonb
    when 'Genre Connoisseur' then '{"type":"genre_count","threshold":8,"source":"ratings"}'::jsonb
    when 'Genre Specialist' then '{"type":"genre_count","threshold":10,"source":"ratings"}'::jsonb
    when 'Genre Authority' then '{"type":"genre_count","threshold":12,"source":"ratings"}'::jsonb
    when 'Genre Virtuoso' then '{"type":"genre_count","threshold":14,"source":"ratings"}'::jsonb
    when 'Genre Completionist' then '{"type":"genre_count","threshold":16,"source":"ratings"}'::jsonb

    when 'Time Traveler' then '{"type":"decade_count","threshold":3,"source":"ratings"}'::jsonb
    when 'Decade Explorer' then '{"type":"decade_count","threshold":5,"source":"ratings"}'::jsonb
    when 'Era Enthusiast' then '{"type":"decade_count","threshold":7,"source":"ratings"}'::jsonb
    when 'Decade Specialist' then '{"type":"decade_count","threshold":9,"source":"ratings"}'::jsonb
    when 'Century Wanderer' then '{"type":"decade_count","threshold":11,"source":"ratings"}'::jsonb
    when 'Historical Archivist' then '{"type":"decade_count","threshold":13,"source":"ratings"}'::jsonb
    when 'Timeline Master' then '{"type":"decade_count","threshold":14,"source":"ratings"}'::jsonb

    when 'Double Feature' then '{"type":"daily_count","threshold":2,"source":"watch_logs"}'::jsonb
    when 'Opening Weekend' then '{"type":"daily_count","threshold":5,"source":"watch_logs"}'::jsonb
    when 'Marathon Critic' then '{"type":"rolling_week_count","threshold":10,"source":"watch_logs"}'::jsonb
    when 'Festival Run' then '{"type":"daily_streak","threshold":7,"source":"watch_logs"}'::jsonb
    when 'Premiere Season' then '{"type":"daily_streak","threshold":30,"source":"watch_logs"}'::jsonb
    when 'Endurance Champion' then '{"type":"daily_streak","threshold":365,"source":"watch_logs"}'::jsonb
    when 'Year-Long Viewer' then '{"type":"weekly_streak","threshold":52,"source":"watch_logs"}'::jsonb
    else rule
end;

-- 3) Tier recalculation helpers.
create or replace function recalc_user_tier(p_user_id uuid)
returns void
language plpgsql
as $$
declare
    v_points integer := 0;
    v_tier_id uuid := null;
begin
    select coalesce(sum(a.points), 0)
    into v_points
    from "User Achievements" ua
    join "Achievements" a on a.id = ua.achievement_id
    where ua.user_id = p_user_id
      and coalesce(a.is_active, true) = true;

    select t.id
    into v_tier_id
    from "User Tiers" t
    where t.points_needed <= v_points
    order by t.points_needed desc
    limit 1;

    update "Users"
    set achievement_points = v_points,
        tier_id = v_tier_id
    where id = p_user_id;
end;
$$;

create or replace function recalc_all_user_tiers()
returns void
language plpgsql
as $$
begin
    with points_by_user as (
        select
            ua.user_id,
            coalesce(sum(a.points), 0) as points
        from "User Achievements" ua
        join "Achievements" a on a.id = ua.achievement_id
        where coalesce(a.is_active, true) = true
        group by ua.user_id
    ),
    tier_by_user as (
        select
            p.user_id,
            p.points,
            (
                select t.id
                from "User Tiers" t
                where t.points_needed <= p.points
                order by t.points_needed desc
                limit 1
            ) as tier_id
        from points_by_user p
    )
    update "Users" u
    set achievement_points = coalesce(t.points, 0),
        tier_id = t.tier_id
    from tier_by_user t
    where u.id = t.user_id;
end;
$$;

-- 4) Award achievements for a user based on rule JSON.
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
            else false
        end
      )
    on conflict do nothing;

    get diagnostics inserted_count = row_count;
    return inserted_count;
end;
$$;

-- 5) Triggers to award achievements when ratings/watch logs change.
create or replace function on_rating_change_award_achievements()
returns trigger
language plpgsql
as $$
begin
    perform award_achievements_for_user(coalesce(new.user_id, old.user_id));
    perform recalc_user_tier(coalesce(new.user_id, old.user_id));
    return null;
end;
$$;

drop trigger if exists rating_award_achievements on "Movie Ratings";
create trigger rating_award_achievements
after insert or update or delete on "Movie Ratings"
for each row execute function on_rating_change_award_achievements();

create or replace function on_watch_log_change_award_achievements()
returns trigger
language plpgsql
as $$
begin
    perform award_achievements_for_user(coalesce(new.user_id, old.user_id));
    perform recalc_user_tier(coalesce(new.user_id, old.user_id));
    return null;
end;
$$;

drop trigger if exists watch_log_award_achievements on "Watch Logs";
create trigger watch_log_award_achievements
after insert or update or delete on "Watch Logs"
for each row execute function on_watch_log_change_award_achievements();

-- 6) Recalc tiers if achievements/tiers are edited.
create or replace function on_user_achievement_change()
returns trigger
language plpgsql
as $$
begin
    perform recalc_user_tier(coalesce(new.user_id, old.user_id));
    return null;
end;
$$;

drop trigger if exists user_achievement_change on "User Achievements";
create trigger user_achievement_change
after insert or update or delete on "User Achievements"
for each row execute function on_user_achievement_change();

create or replace function on_achievements_change_recalc_all()
returns trigger
language plpgsql
as $$
begin
    perform recalc_all_user_tiers();
    return null;
end;
$$;

drop trigger if exists achievements_change_recalc_all on "Achievements";
create trigger achievements_change_recalc_all
after insert or update or delete on "Achievements"
for each statement execute function on_achievements_change_recalc_all();

create or replace function on_user_tiers_change_recalc_all()
returns trigger
language plpgsql
as $$
begin
    perform recalc_all_user_tiers();
    return null;
end;
$$;

drop trigger if exists user_tiers_change_recalc_all on "User Tiers";
create trigger user_tiers_change_recalc_all
after insert or update or delete on "User Tiers"
for each statement execute function on_user_tiers_change_recalc_all();

-- Optional: run this once after setup for a specific user.
-- select award_achievements_for_user('<user_uuid>');
