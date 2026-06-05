-- Backfill achievements for all users based on inferred rules.
-- Uses:
--   - "Movie Ratings" for ratings-based counts (movies watched, genres, decades, directors)
--   - "Watch Logs" for rewatch counts and streaks (per your preference)
-- Run in Supabase SQL Editor.

with
ach as (
  select id, name
  from public."Achievements"
  where is_active is true
),
ratings as (
  select user_id, movie_id, watch_date::date as watch_date
  from public."Movie Ratings"
),
watch_logs as (
  select user_id, movie_id, watch_date::date as watch_date
  from public."Watch Logs"
),
ratings_per_user as (
  select user_id, count(distinct movie_id) as rated_count
  from ratings
  group by user_id
),
rewatch_counts as (
  select user_id, movie_id, count(*) as watch_count
  from watch_logs
  group by user_id, movie_id
),
rewatch_max as (
  select user_id, max(watch_count) as max_watch_count
  from rewatch_counts
  group by user_id
),
director_movies as (
  select r.user_id, mc.person_id, count(distinct r.movie_id) as movie_count
  from ratings r
  join public."Movie Crew" mc
    on mc.movie_id = r.movie_id
   and mc.job = 'Director'
  group by r.user_id, mc.person_id
),
director_max as (
  select user_id, max(movie_count) as max_director_movies
  from director_movies
  group by user_id
),
genre_counts as (
  select r.user_id, count(distinct mg.genre_id) as genre_count
  from ratings r
  join public."Movie Genres" mg
    on mg.movie_id = r.movie_id
  group by r.user_id
),
decade_counts as (
  select r.user_id,
         count(distinct (m.release_year / 10) * 10) as decade_count
  from ratings r
  join public."Movies" m
    on m.id = r.movie_id
  where m.release_year is not null
  group by r.user_id
),
daily_counts as (
  select user_id, watch_date, count(*) as day_count
  from watch_logs
  group by user_id, watch_date
),
daily_max as (
  select user_id, max(day_count) as max_day
  from daily_counts
  group by user_id
),
rolling_week_counts as (
  select user_id,
         watch_date,
         sum(day_count) over (
           partition by user_id
           order by watch_date
           range between interval '6 days' preceding and current row
         ) as week_count
  from daily_counts
),
rolling_week_max as (
  select user_id, max(week_count) as max_week
  from rolling_week_counts
  group by user_id
),
daily_active as (
  select distinct user_id, watch_date
  from watch_logs
),
daily_streaks as (
  select user_id, count(*) as streak_len
  from (
    select user_id,
           watch_date,
           watch_date - (row_number() over (partition by user_id order by watch_date)) * interval '1 day' as grp
    from daily_active
  ) s
  group by user_id, grp
),
daily_streak_max as (
  select user_id, max(streak_len) as max_streak
  from daily_streaks
  group by user_id
),
weekly_active as (
  select distinct user_id, date_trunc('week', watch_date)::date as week_start
  from watch_logs
),
weekly_streaks as (
  select user_id, count(*) as streak_len
  from (
    select user_id,
           week_start,
           week_start - (row_number() over (partition by user_id order by week_start)) * interval '7 days' as grp
    from weekly_active
  ) s
  group by user_id, grp
),
weekly_streak_max as (
  select user_id, max(streak_len) as max_week_streak
  from weekly_streaks
  group by user_id
),
movies_watched_earned as (
  select r.user_id, a.id as achievement_id
  from ratings_per_user r
  join ach a on (
    (a.name = 'First Screening' and r.rated_count >= 10) or
    (a.name = 'Film Buff' and r.rated_count >= 50) or
    (a.name = 'Dedicated Critic' and r.rated_count >= 250) or
    (a.name = 'Cinema Archivist' and r.rated_count >= 750) or
    (a.name = 'Screen Authority' and r.rated_count >= 1000) or
    (a.name = 'Screen Legend' and r.rated_count >= 1250) or
    (a.name = 'Master of Cinema' and r.rated_count >= 1500)
  )
),
rewatches_earned as (
  select r.user_id, a.id as achievement_id
  from rewatch_max r
  join ach a on (
    (a.name = 'Encore' and r.max_watch_count >= 2) or
    (a.name = 'Comfort Classic' and r.max_watch_count >= 3) or
    (a.name = 'Repeat Viewer' and r.max_watch_count >= 5) or
    (a.name = 'Cult Favorite' and r.max_watch_count >= 7) or
    (a.name = 'Devoted Fan' and r.max_watch_count >= 10) or
    (a.name = 'Legendary Obsession' and r.max_watch_count >= 15) or
    (a.name = 'Timeless Classic' and r.max_watch_count >= 25)
  )
),
director_earned as (
  select d.user_id, a.id as achievement_id
  from director_max d
  join ach a on (
    (a.name = 'Director Devotee' and d.max_director_movies >= 4) or
    (a.name = 'Director Loyalist' and d.max_director_movies >= 6) or
    (a.name = 'Director Disciple' and d.max_director_movies >= 8) or
    (a.name = 'Director Specialist' and d.max_director_movies >= 10) or
    (a.name = 'Director Scholar' and d.max_director_movies >= 12) or
    (a.name = 'Director Archivist' and d.max_director_movies >= 15) or
    (a.name = 'Director Master' and d.max_director_movies >= 20)
  )
),
genre_earned as (
  select g.user_id, a.id as achievement_id
  from genre_counts g
  join ach a on (
    (a.name = 'Genre Explorer' and g.genre_count >= 4) or
    (a.name = 'Genre Hopper' and g.genre_count >= 6) or
    (a.name = 'Genre Connoisseur' and g.genre_count >= 8) or
    (a.name = 'Genre Specialist' and g.genre_count >= 10) or
    (a.name = 'Genre Authority' and g.genre_count >= 12) or
    (a.name = 'Genre Virtuoso' and g.genre_count >= 14) or
    (a.name = 'Genre Completionist' and g.genre_count >= 16)
  )
),
decade_earned as (
  select d.user_id, a.id as achievement_id
  from decade_counts d
  join ach a on (
    (a.name = 'Time Traveler' and d.decade_count >= 3) or
    (a.name = 'Decade Explorer' and d.decade_count >= 5) or
    (a.name = 'Era Enthusiast' and d.decade_count >= 7) or
    (a.name = 'Decade Specialist' and d.decade_count >= 9) or
    (a.name = 'Century Wanderer' and d.decade_count >= 11) or
    (a.name = 'Historical Archivist' and d.decade_count >= 13) or
    (a.name = 'Timeline Master' and d.decade_count >= 14)
  )
),
streaks_earned as (
  select d.user_id, a.id as achievement_id
  from daily_max d
  join ach a on (
    (a.name = 'Double Feature' and d.max_day >= 2) or
    (a.name = 'Opening Weekend' and d.max_day >= 5)
  )
  union all
  select w.user_id, a.id as achievement_id
  from rolling_week_max w
  join ach a on (a.name = 'Marathon Critic' and w.max_week >= 10)
  union all
  select s.user_id, a.id as achievement_id
  from daily_streak_max s
  join ach a on (
    (a.name = 'Festival Run' and s.max_streak >= 7) or
    (a.name = 'Premiere Season' and s.max_streak >= 30) or
    (a.name = 'Endurance Champion' and s.max_streak >= 365)
  )
  union all
  select ws.user_id, a.id as achievement_id
  from weekly_streak_max ws
  join ach a on (a.name = 'Year-Long Viewer' and ws.max_week_streak >= 52)
),
all_earned as (
  select * from movies_watched_earned
  union all select * from rewatches_earned
  union all select * from director_earned
  union all select * from genre_earned
  union all select * from decade_earned
  union all select * from streaks_earned
)
insert into public."User Achievements" (user_id, achievement_id, earned_at)
select user_id, achievement_id, now()
from all_earned
on conflict (user_id, achievement_id) do nothing;
