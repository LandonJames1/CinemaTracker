-- Supabase SQL: fast Lists page.
-- Run this in the Supabase SQL editor (safe to re-run).
--
-- WHY: the Lists page used to fetch genre + IMDb for EVERY movie in a list via a
-- live per-movie Edge Function/TMDB call, blocking render on N round-trips (slow,
-- and "sometimes never loads"). This view pre-joins everything in the DB so the
-- page can read a whole list in ONE query, exactly like My Movies does with
-- user_library_items_v2.
--
-- It mirrors user_library_items_v2 (library_views.sql) but is keyed on
-- "Movie Lists" instead of watched/rated movies, so it ALSO covers movies that are
-- only in a list (Recs / Bucket List) and have never been watched. One row per
-- (user_id, list_id, movie_id) with all the metadata the list cards render.
--
-- SECURITY NOTE: like user_library_items_v2 this view runs with the owner's rights
-- (it must, so the movie-metadata join tables resolve for the client). The app
-- always queries it filtered to `user_id = <the current user>`. If you want to make
-- list membership strictly unreadable cross-user via the REST API, convert this to
-- a SECURITY DEFINER function that filters on auth.uid() and revoke direct select
-- on the view — ask and I'll provide that variant.
create or replace view public.user_list_items_v1 as
select
  ml.user_id,
  ml.list_id,
  ml.movie_id,
  ml.created_at as added_at,
  m.title,
  m.release_year,
  m.tmdb_id,
  m.poster_path,
  m.mpa_rating,
  m.runtime_minutes,
  m.is_series,
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
  (
    select string_agg(distinct p.name, ', ' order by p.name)
    from public."Movie Cast" mc
    join public."People" p on p.id = mc.person_id
    where mc.movie_id = m.id
  ) as actors,
  (
    select count(*)::int
    from public."Watch Logs" wl
    where wl.user_id = ml.user_id
      and wl.movie_id = m.id
  ) as watch_count,
  (
    select wl.watch_method
    from public."Watch Logs" wl
    where wl.user_id = ml.user_id
      and wl.movie_id = m.id
    order by wl.watch_date desc nulls last
    limit 1
  ) as watch_method,
  (
    select max(wl.watch_date)
    from public."Watch Logs" wl
    where wl.user_id = ml.user_id
      and wl.movie_id = m.id
  ) as latest_watch_date
from public."Movie Lists" ml
join public."Movies" m on m.id = ml.movie_id
left join public."Movie Ratings" r
  on r.user_id = ml.user_id and r.movie_id = ml.movie_id;

-- Let the app (authenticated role) read the view via PostgREST.
grant select on public.user_list_items_v1 to authenticated;

-- Make "all items in a list, newest first" fast.
create index if not exists movie_lists_user_list_created_idx
  on public."Movie Lists" (user_id, list_id, created_at desc);
