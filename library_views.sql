-- Supabase SQL: fast, paged My Movies queries
-- Run this in Supabase SQL editor.
--
-- Base view used by My Movies queries (safe to re-run).
create or replace view public.user_movie_latest_watch as
select user_id, movie_id, max(watch_date) as latest_watch_date
from public."Watch Logs"
group by user_id, movie_id;

-- 1) A flattened view that the app can page/sort/filter directly.
--    This avoids pulling tons of Watch Logs rows into the browser.
create or replace view public.user_library_items_v2 as
with base as (
  select user_id, movie_id
  from public.user_movie_latest_watch
  union
  select user_id, movie_id
  from public."Movie Ratings"
)
select
  b.user_id,
  b.movie_id,
  lwm.latest_watch_date,
  m.title,
  m.release_year,
  m.tmdb_id,
  m.poster_path,
  m.mpa_rating,
  m.runtime_minutes,
  (
    select string_agg(distinct p.name, ', ' order by p.name)
    from public."Movie Crew" cr
    join public."People" p on p.id = cr.person_id
    where cr.movie_id = m.id
      and lower(coalesce(cr.job, '')) = 'director'
  ) as director,
  (
    select coalesce(array_agg(distinct g.name order by g.name), '{}'::text[])
    from public."Movie Genres" mg
    join public."Genres" g on g.id = mg.genre_id
    where mg.movie_id = m.id
  ) as genres,
  (
    select string_agg(distinct g.name, ', ' order by g.name)
    from public."Movie Genres" mg
    join public."Genres" g on g.id = mg.genre_id
    where mg.movie_id = m.id
  ) as genre,
  (
    select mer.rating
    from public."Movie External Ratings" mer
    where mer.movie_id = m.id
      and lower(coalesce(mer.source, '')) = 'imdb'
    order by mer.fetched_at desc nulls last
    limit 1
  ) as imdb_rating_pct,
  (
    select mer.rating
    from public."Movie External Ratings" mer
    where mer.movie_id = m.id
      and lower(coalesce(mer.source, '')) = 'imdb'
    order by mer.fetched_at desc nulls last
    limit 1
  ) as imdb_pct,
  (
    select round((mer.rating / 10.0)::numeric, 1)
    from public."Movie External Ratings" mer
    where mer.movie_id = m.id
      and lower(coalesce(mer.source, '')) = 'imdb'
      and mer.rating is not null
    order by mer.fetched_at desc nulls last
    limit 1
  ) as imdb_rating,
  r.overall_rating,
  r.sound_rating,
  r.pacing_rating,
  r.imagery_rating,
  r.acting_rating,
  r.plot_rating,
  r.dialogue_rating,
  r.tier,
  r.fav_quote,
  r.notes,
  (
    select string_agg(distinct p.name, ', ' order by p.name)
    from public."Movie Cast" mc
    join public."People" p on p.id = mc.person_id
    where mc.movie_id = m.id
  ) as actors,
  (
    select count(*)::int
    from public."Watch Logs" wl
    where wl.user_id = b.user_id
      and wl.movie_id = m.id
  ) as watch_count
  ,(
    select wl.watch_method
    from public."Watch Logs" wl
    where wl.user_id = b.user_id
      and wl.movie_id = m.id
    order by wl.watch_date desc nulls last
    limit 1
  ) as watch_method
from base b
join public."Movies" m
  on m.id = b.movie_id
left join public.user_movie_latest_watch lwm
  on lwm.user_id = b.user_id
 and lwm.movie_id = b.movie_id
left join public."Movie Ratings" r
  on r.user_id = b.user_id
 and r.movie_id = b.movie_id;

-- 2) Suggested indexes (optional but strongly recommended).
--    These make `user_movie_latest_watch` and the join inputs fast.
create index if not exists watch_logs_user_date_movie_idx
  on public."Watch Logs" (user_id, watch_date desc, movie_id);

create index if not exists movie_ratings_user_movie_idx
  on public."Movie Ratings" (user_id, movie_id);

create index if not exists movies_tmdb_id_idx
  on public."Movies" (tmdb_id);
