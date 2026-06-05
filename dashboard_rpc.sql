create or replace function public.get_dashboard_summary()
returns jsonb
language plpgsql
as $$
declare
  uid uuid := auth.uid();
  year_start_date date := date_trunc('year', now())::date;
  year_end_date date := (year_start_date + interval '1 year')::date;

  unique_movies_this_year int := 0;
  total_watch_events_this_year int := 0;
  total_watch_events_all_time int := 0;
  total_watch_minutes_all_time numeric := 0;
  total_watch_hours_all_time numeric := 0;
  avg_overall_rating numeric := 0;

  highest_rated_movie_title text := '';
  highest_rated_movie_rating numeric := 0;

  top_genre text := '';
  top_genre_count int := 0;
  top_genre_avg_rating numeric := 0;

  most_watched_decade int := null;
  most_watched_decade_watches int := 0;

  most_watched_actor text := '';
  most_watched_actor_watches int := 0;

  most_watched_director text := '';
  most_watched_director_watches int := 0;

  highest_rated_director text := '';
  highest_rated_director_avg numeric := 0;
  highest_rated_director_n int := 0;

  watched_at_home int := 0;
  watched_in_theater int := 0;
  watched_unknown int := 0;

  tier_distribution jsonb := '[]'::jsonb;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Movies watched this year: UNIQUE movies per user (based on Watch Logs).
  select count(distinct wl.movie_id)
    into unique_movies_this_year
  from "Watch Logs" wl
  where wl.user_id = uid
    and wl.watch_date >= year_start_date
    and wl.watch_date < year_end_date;

  select count(*)
    into total_watch_events_this_year
  from "Watch Logs" wl
  where wl.user_id = uid
    and wl.watch_date >= year_start_date
    and wl.watch_date < year_end_date;

  select count(*)
    into total_watch_events_all_time
  from "Watch Logs" wl
  where wl.user_id = uid;

  -- Total hours watched: sum of ALL watch log events (rewatches count), all-time.
  select coalesce(sum(m.runtime_minutes), 0)
    into total_watch_minutes_all_time
  from "Watch Logs" wl
  join "Movies" m on m.id = wl.movie_id
  where wl.user_id = uid;

  total_watch_hours_all_time := round((total_watch_minutes_all_time / 60.0)::numeric, 1);

  -- Average overall rating (all-time).
  select coalesce(round(avg(mr.overall_rating)::numeric, 1), 0)
    into avg_overall_rating
  from "Movie Ratings" mr
  where mr.user_id = uid;

  -- Highest rated movie overall.
  select m.title, mr.overall_rating
    into highest_rated_movie_title, highest_rated_movie_rating
  from "Movie Ratings" mr
  join "Movies" m on m.id = mr.movie_id
  where mr.user_id = uid
  order by mr.overall_rating desc nulls last, mr.updated_at desc nulls last, mr.watch_date desc
  limit 1;

  -- Top genre by average rating (min sample size = 3 movies).
  select g.name, count(*)::int, round(avg(mr.overall_rating)::numeric, 1)
    into top_genre, top_genre_count, top_genre_avg_rating
  from "Movie Ratings" mr
  join "Movie Genres" mg on mg.movie_id = mr.movie_id
  join "Genres" g on g.id = mg.genre_id
  where mr.user_id = uid
  group by g.name
  having count(*) >= 3
  order by avg(mr.overall_rating) desc, count(*) desc
  limit 1;

  -- Tier distribution (percent of rated movies).
  with tier_counts as (
    select mr.tier as tier, count(*)::numeric as n
    from "Movie Ratings" mr
    where mr.user_id = uid
    group by mr.tier
  ), total as (
    select coalesce(sum(n), 0) as t from tier_counts
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'tier', tier_counts.tier,
        'count', tier_counts.n::int,
        'pct', round(100.0 * tier_counts.n / nullif(total.t, 0), 1)
      )
      order by round(100.0 * tier_counts.n / nullif(total.t, 0), 1) desc
    ),
    '[]'::jsonb
  )
  into tier_distribution
  from tier_counts cross join total;

  -- Most watched decade (based on release_year; counts watch events).
  with decade_counts as (
    select (floor(m.release_year / 10.0) * 10)::int as decade, count(*)::int as watches
    from "Watch Logs" wl
    join "Movies" m on m.id = wl.movie_id
    where wl.user_id = uid
      and m.release_year is not null
    group by (floor(m.release_year / 10.0) * 10)::int
  )
  select decade, watches
    into most_watched_decade, most_watched_decade_watches
  from decade_counts
  order by watches desc
  limit 1;

  -- Most watched actor (counts watch events; uses Movie Cast).
  with actor_counts as (
    select p.name as name, count(*)::int as watches
    from "Watch Logs" wl
    join "Movie Cast" mc on mc.movie_id = wl.movie_id
    join "People" p on p.id = mc.person_id
    where wl.user_id = uid
    group by p.name
  )
  select name, watches
    into most_watched_actor, most_watched_actor_watches
  from actor_counts
  order by watches desc
  limit 1;

  -- Most watched director (counts watch events; uses Movie Crew).
  with director_counts as (
    select p.name as name, count(*)::int as watches
    from "Watch Logs" wl
    join "Movie Crew" cr on cr.movie_id = wl.movie_id
    join "People" p on p.id = cr.person_id
    where wl.user_id = uid
      and lower(cr.job) = 'director'
    group by p.name
  )
  select name, watches
    into most_watched_director, most_watched_director_watches
  from director_counts
  order by watches desc
  limit 1;

  -- Highest rated director (average overall rating; min 2 rated movies).
  with rated_directors as (
    select p.name as name, avg(mr.overall_rating)::numeric as avg_rating, count(*)::int as n
    from "Movie Ratings" mr
    join "Movie Crew" cr on cr.movie_id = mr.movie_id
    join "People" p on p.id = cr.person_id
    where mr.user_id = uid
      and lower(cr.job) = 'director'
      and mr.overall_rating is not null
    group by p.name
    having count(*) >= 2
  )
  select name, round(avg_rating, 1), n
    into highest_rated_director, highest_rated_director_avg, highest_rated_director_n
  from rated_directors
  order by avg_rating desc, n desc
  limit 1;

  -- Watch method breakdown (all-time; counts watch events).
  select
    sum(case when lower(coalesce(watch_method, '')) like '%home%' then 1 else 0 end)::int,
    sum(case when lower(coalesce(watch_method, '')) like '%theater%' or lower(coalesce(watch_method, '')) like '%theatre%' then 1 else 0 end)::int,
    sum(case when coalesce(watch_method, '') = '' then 1 else 0 end)::int
  into watched_at_home, watched_in_theater, watched_unknown
  from "Watch Logs" wl
  where wl.user_id = uid;

  return jsonb_build_object(
    'unique_movies_this_year', coalesce(unique_movies_this_year, 0),
    'total_watch_events_this_year', coalesce(total_watch_events_this_year, 0),
    'total_watch_events_all_time', coalesce(total_watch_events_all_time, 0),
    'total_watch_hours_all_time', coalesce(total_watch_hours_all_time, 0),
    'avg_overall_rating', coalesce(avg_overall_rating, 0),
    'highest_rated_movie', jsonb_build_object(
      'title', coalesce(highest_rated_movie_title, ''),
      'overall_rating', coalesce(round(highest_rated_movie_rating::numeric, 1), 0)
    ),
    'top_genre', coalesce(top_genre, ''),
    'top_genre_count', coalesce(top_genre_count, 0),
    'top_genre_avg_overall', coalesce(top_genre_avg_rating, 0),
    'tier_distribution', coalesce(tier_distribution, '[]'::jsonb),
    'most_watched_decade', jsonb_build_object(
      'decade', most_watched_decade,
      'watches', coalesce(most_watched_decade_watches, 0)
    ),
    'most_watched_actor', jsonb_build_object(
      'name', coalesce(most_watched_actor, ''),
      'watches', coalesce(most_watched_actor_watches, 0)
    ),
    'most_watched_director', jsonb_build_object(
      'name', coalesce(most_watched_director, ''),
      'watches', coalesce(most_watched_director_watches, 0)
    ),
    'highest_rated_director', jsonb_build_object(
      'name', coalesce(highest_rated_director, ''),
      'avg_overall', coalesce(highest_rated_director_avg, 0),
      'n', coalesce(highest_rated_director_n, 0)
    ),
    'watch_method_breakdown', jsonb_build_object(
      'at_home', coalesce(watched_at_home, 0),
      'in_theater', coalesce(watched_in_theater, 0),
      'unknown', coalesce(watched_unknown, 0)
    )
  );
end;
$$;

-- Allow logged-in users to call it.
grant execute on function public.get_dashboard_summary() to authenticated;


-- Tab 4 (Favorites) RPC
-- Returns Top/Bottom movies by a chosen rating component, filtered by timeframe.
create or replace function public.get_dashboard_favorites(
  p_timeframe text default 'all_time',
  p_metric text default 'overall',
  p_limit int default 5
)
returns jsonb
language plpgsql
as $$
declare
  uid uuid := auth.uid();
  tf text := lower(btrim(coalesce(p_timeframe, 'all_time')));
  metric text := lower(btrim(coalesce(p_metric, 'overall')));
  limit_n int := case when p_limit in (5, 10) then p_limit else 5 end;
  start_ts timestamptz := null;
  end_ts timestamptz := null;
  start_date date := null;
  end_date date := null;

  top_list jsonb := '[]'::jsonb;
  bottom_list jsonb := '[]'::jsonb;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Normalize timeframe
  if tf = 'this_year' then
    start_ts := date_trunc('year', now());
    end_ts := (start_ts + interval '1 year');
  elsif tf = 'this_month' then
    start_ts := date_trunc('month', now());
    end_ts := (start_ts + interval '1 month');
  else
    tf := 'all_time';
  end if;

  if start_ts is not null then
    start_date := start_ts::date;
    end_date := end_ts::date;
  else
    start_date := null;
    end_date := null;
  end if;

  -- Top
  -- Select the rows first (ORDER + LIMIT), then aggregate them to JSON.
  with base as (
    select
      mr.movie_id,
      m.tmdb_id,
      m.poster_path,
      m.title,
      m.release_year,
      mr.updated_at,
      mr.watch_date,
      case metric
        when 'overall' then mr.overall_rating
        when 'sound' then mr.sound_rating
        when 'plot' then mr.plot_rating
        when 'pace' then mr.pacing_rating
        when 'acting' then mr.acting_rating
        when 'imagery' then mr.imagery_rating
        when 'dialogue' then mr.dialogue_rating
        else mr.overall_rating
      end as score,
      (
        select avg(v)
        from unnest(
          case metric
            when 'overall' then array[mr.sound_rating, mr.plot_rating, mr.pacing_rating, mr.acting_rating, mr.imagery_rating, mr.dialogue_rating]
            when 'sound' then array[mr.overall_rating, mr.plot_rating, mr.pacing_rating, mr.acting_rating, mr.imagery_rating, mr.dialogue_rating]
            when 'plot' then array[mr.overall_rating, mr.sound_rating, mr.pacing_rating, mr.acting_rating, mr.imagery_rating, mr.dialogue_rating]
            when 'pace' then array[mr.overall_rating, mr.sound_rating, mr.plot_rating, mr.acting_rating, mr.imagery_rating, mr.dialogue_rating]
            when 'acting' then array[mr.overall_rating, mr.sound_rating, mr.plot_rating, mr.pacing_rating, mr.imagery_rating, mr.dialogue_rating]
            when 'imagery' then array[mr.overall_rating, mr.sound_rating, mr.plot_rating, mr.pacing_rating, mr.acting_rating, mr.dialogue_rating]
            when 'dialogue' then array[mr.overall_rating, mr.sound_rating, mr.plot_rating, mr.pacing_rating, mr.acting_rating, mr.imagery_rating]
            else array[mr.sound_rating, mr.plot_rating, mr.pacing_rating, mr.acting_rating, mr.imagery_rating, mr.dialogue_rating]
          end
        ) as v
        where v is not null
      ) as tiebreak_avg
    from "Movie Ratings" mr
    join "Movies" m on m.id = mr.movie_id
    where mr.user_id = uid
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
  ), top_rows as (
    select *
    from base
    where score is not null
    order by score desc, tiebreak_avg desc nulls last, updated_at desc nulls last, watch_date desc, movie_id
    limit limit_n
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'movie_id', movie_id,
        'tmdb_id', tmdb_id,
        'poster_path', poster_path,
        'title', title,
        'release_year', release_year,
        'score', score
      )
      order by score desc, tiebreak_avg desc nulls last, updated_at desc nulls last, watch_date desc, movie_id
    ),
    '[]'::jsonb
  )
  into top_list
  from top_rows;

  -- Bottom
  with base as (
    select
      mr.movie_id,
      m.tmdb_id,
      m.poster_path,
      m.title,
      m.release_year,
      mr.updated_at,
      mr.watch_date,
      case metric
        when 'overall' then mr.overall_rating
        when 'sound' then mr.sound_rating
        when 'plot' then mr.plot_rating
        when 'pace' then mr.pacing_rating
        when 'acting' then mr.acting_rating
        when 'imagery' then mr.imagery_rating
        when 'dialogue' then mr.dialogue_rating
        else mr.overall_rating
      end as score,
      (
        select avg(v)
        from unnest(
          case metric
            when 'overall' then array[mr.sound_rating, mr.plot_rating, mr.pacing_rating, mr.acting_rating, mr.imagery_rating, mr.dialogue_rating]
            when 'sound' then array[mr.overall_rating, mr.plot_rating, mr.pacing_rating, mr.acting_rating, mr.imagery_rating, mr.dialogue_rating]
            when 'plot' then array[mr.overall_rating, mr.sound_rating, mr.pacing_rating, mr.acting_rating, mr.imagery_rating, mr.dialogue_rating]
            when 'pace' then array[mr.overall_rating, mr.sound_rating, mr.plot_rating, mr.acting_rating, mr.imagery_rating, mr.dialogue_rating]
            when 'acting' then array[mr.overall_rating, mr.sound_rating, mr.plot_rating, mr.pacing_rating, mr.imagery_rating, mr.dialogue_rating]
            when 'imagery' then array[mr.overall_rating, mr.sound_rating, mr.plot_rating, mr.pacing_rating, mr.acting_rating, mr.dialogue_rating]
            when 'dialogue' then array[mr.overall_rating, mr.sound_rating, mr.plot_rating, mr.pacing_rating, mr.acting_rating, mr.imagery_rating]
            else array[mr.sound_rating, mr.plot_rating, mr.pacing_rating, mr.acting_rating, mr.imagery_rating, mr.dialogue_rating]
          end
        ) as v
        where v is not null
      ) as tiebreak_avg
    from "Movie Ratings" mr
    join "Movies" m on m.id = mr.movie_id
    where mr.user_id = uid
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
  ), bottom_rows as (
    select *
    from base
    where score is not null
    order by score asc, tiebreak_avg asc nulls last, updated_at desc nulls last, watch_date desc, movie_id
    limit limit_n
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'movie_id', movie_id,
        'tmdb_id', tmdb_id,
        'poster_path', poster_path,
        'title', title,
        'release_year', release_year,
        'score', score
      )
      order by score asc, tiebreak_avg asc nulls last, updated_at desc nulls last, watch_date desc, movie_id
    ),
    '[]'::jsonb
  )
  into bottom_list
  from bottom_rows;

  return jsonb_build_object(
    'timeframe', tf,
    'metric', metric,
    'top', coalesce(top_list, '[]'::jsonb),
    'bottom', coalesce(bottom_list, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_dashboard_favorites(text, text, int) to authenticated;


-- Tab (Charts) RPC
-- Returns chart-ready aggregates for genres, decades, activity trend, and IMDb comparison.
create or replace function public.get_dashboard_charts(p_timeframe text default 'all_time')
returns jsonb
language plpgsql
as $$
declare
  uid uuid := auth.uid();
  tf text := lower(btrim(coalesce(p_timeframe, 'all_time')));
  start_ts timestamptz := null;
  end_ts timestamptz := null;
  start_date date := null;
  end_date date := null;
  activity_start date := null;
  activity_end date := null;
  activity_grain text := 'month';

  genres_json jsonb := '[]'::jsonb;
  decades_json jsonb := '[]'::jsonb;
  mpa_json jsonb := '[]'::jsonb;
  genre_counts_total_json jsonb := '[]'::jsonb;
  genre_counts_unique_json jsonb := '[]'::jsonb;
  decade_counts_total_json jsonb := '[]'::jsonb;
  decade_counts_unique_json jsonb := '[]'::jsonb;
  mpa_counts_total_json jsonb := '[]'::jsonb;
  mpa_counts_unique_json jsonb := '[]'::jsonb;
  genre_method_counts_total_json jsonb := '[]'::jsonb;
  genre_method_counts_unique_json jsonb := '[]'::jsonb;
  decade_method_counts_total_json jsonb := '[]'::jsonb;
  decade_method_counts_unique_json jsonb := '[]'::jsonb;
  mpa_method_counts_total_json jsonb := '[]'::jsonb;
  mpa_method_counts_unique_json jsonb := '[]'::jsonb;
  genre_heatmap_json jsonb := '[]'::jsonb;
  genre_mpa_heatmap_json jsonb := '[]'::jsonb;
  decade_mpa_heatmap_json jsonb := '[]'::jsonb;
  activity_json jsonb := '[]'::jsonb;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if tf = 'this_year' then
    start_ts := date_trunc('year', now());
    end_ts := start_ts + interval '1 year';
  elsif tf = 'this_month' then
    start_ts := date_trunc('month', now());
    end_ts := start_ts + interval '1 month';
  else
    tf := 'all_time';
    start_ts := null;
    end_ts := null;
  end if;

  if start_ts is not null then
    start_date := start_ts::date;
    end_date := end_ts::date;
  else
    start_date := null;
    end_date := null;
  end if;

  -- Average rating by genre
  with base as (
    select g.name as genre, mr.overall_rating, mr.movie_id
    from "Movie Ratings" mr
    join "Movie Genres" mg on mg.movie_id = mr.movie_id
    join "Genres" g on g.id = mg.genre_id
    where mr.user_id = uid
      and mr.overall_rating is not null
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
  ), ranked as (
    select genre,
           avg(overall_rating) as avg_rating,
           count(distinct movie_id) as n
    from base
    group by genre
    order by avg_rating desc, n desc, genre
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'genre', genre,
        'avg', avg_rating,
        'n', n
      )
      order by avg_rating desc, n desc, genre
    ),
    '[]'::jsonb
  )
  into genres_json
  from ranked;

  -- Genre share (watch events total vs unique movies)
  with base as (
    select g.name as genre, wl.movie_id
    from "Watch Logs" wl
    join "Movie Genres" mg on mg.movie_id = wl.movie_id
    join "Genres" g on g.id = mg.genre_id
    where wl.user_id = uid
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
  ), ranked as (
    select genre,
           count(*)::int as watches,
           count(distinct movie_id)::int as movies
    from base
    group by genre
    order by watches desc, movies desc, genre
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'genre', genre,
          'count', watches
        )
        order by watches desc, genre
      ),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'genre', genre,
          'count', movies
        )
        order by movies desc, genre
      ),
      '[]'::jsonb
    )
  into genre_counts_total_json, genre_counts_unique_json
  from ranked;

  -- Genre share by watch method (watch events total vs unique movies)
  with base as (
    select g.name as genre,
           wl.movie_id,
           case
             when lower(coalesce(wl.watch_method, '')) like '%home%' then 'At Home'
             when lower(coalesce(wl.watch_method, '')) like '%theater%'
               or lower(coalesce(wl.watch_method, '')) like '%theatre%' then 'In Theater'
             else null
           end as watch_method
    from "Watch Logs" wl
    join "Movie Genres" mg on mg.movie_id = wl.movie_id
    join "Genres" g on g.id = mg.genre_id
    where wl.user_id = uid
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
  ), ranked as (
    select genre,
           watch_method,
           count(*)::int as watches,
           count(distinct movie_id)::int as movies
    from base
    where watch_method is not null
    group by genre, watch_method
    order by genre, watch_method
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'genre', genre,
          'watch_method', watch_method,
          'count', watches
        )
        order by genre, watch_method
      ),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'genre', genre,
          'watch_method', watch_method,
          'count', movies
        )
        order by genre, watch_method
      ),
      '[]'::jsonb
    )
  into genre_method_counts_total_json, genre_method_counts_unique_json
  from ranked;

  -- Average rating by decade
  with base as (
    select (m.release_year / 10) * 10 as decade, mr.overall_rating, mr.movie_id
    from "Movie Ratings" mr
    join "Movies" m on m.id = mr.movie_id
    where mr.user_id = uid
      and mr.overall_rating is not null
      and m.release_year is not null
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
  ), ranked as (
    select decade,
           avg(overall_rating) as avg_rating,
           count(distinct movie_id) as n
    from base
    group by decade
    order by decade asc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'decade', decade,
        'avg', avg_rating,
        'n', n
      )
      order by decade asc
    ),
    '[]'::jsonb
  )
  into decades_json
  from ranked;

  -- Decade share (watch events total vs unique movies)
  with base as (
    select (m.release_year / 10) * 10 as decade, wl.movie_id
    from "Watch Logs" wl
    join "Movies" m on m.id = wl.movie_id
    where wl.user_id = uid
      and m.release_year is not null
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
  ), ranked as (
    select decade,
           count(*)::int as watches,
           count(distinct movie_id)::int as movies
    from base
    group by decade
    order by watches desc, movies desc, decade
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'decade', decade,
          'count', watches
        )
        order by watches desc, decade
      ),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'decade', decade,
          'count', movies
        )
        order by movies desc, decade
      ),
      '[]'::jsonb
    )
  into decade_counts_total_json, decade_counts_unique_json
  from ranked;

  -- Decade share by watch method (watch events total vs unique movies)
  with base as (
    select (m.release_year / 10) * 10 as decade,
           wl.movie_id,
           case
             when lower(coalesce(wl.watch_method, '')) like '%home%' then 'At Home'
             when lower(coalesce(wl.watch_method, '')) like '%theater%'
               or lower(coalesce(wl.watch_method, '')) like '%theatre%' then 'In Theater'
             else null
           end as watch_method
    from "Watch Logs" wl
    join "Movies" m on m.id = wl.movie_id
    where wl.user_id = uid
      and m.release_year is not null
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
  ), ranked as (
    select decade,
           watch_method,
           count(*)::int as watches,
           count(distinct movie_id)::int as movies
    from base
    where watch_method is not null
    group by decade, watch_method
    order by decade, watch_method
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'decade', decade,
          'watch_method', watch_method,
          'count', watches
        )
        order by decade, watch_method
      ),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'decade', decade,
          'watch_method', watch_method,
          'count', movies
        )
        order by decade, watch_method
      ),
      '[]'::jsonb
    )
  into decade_method_counts_total_json, decade_method_counts_unique_json
  from ranked;

  -- Average rating by MPA
  with base as (
    select coalesce(nullif(btrim(m.mpa_rating), ''), 'Unrated') as mpa,
           mr.overall_rating,
           mr.movie_id
    from "Movie Ratings" mr
    join "Movies" m on m.id = mr.movie_id
    where mr.user_id = uid
      and mr.overall_rating is not null
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
  ), ranked as (
    select mpa,
           avg(overall_rating) as avg_rating,
           count(distinct movie_id) as n
    from base
    group by mpa
    order by avg_rating desc, n desc, mpa
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'mpa', mpa,
        'avg', avg_rating,
        'n', n
      )
      order by avg_rating desc, n desc, mpa
    ),
    '[]'::jsonb
  )
  into mpa_json
  from ranked;

  -- MPA share (watch events total vs unique movies)
  with base as (
    select coalesce(nullif(btrim(m.mpa_rating), ''), 'Unrated') as mpa, wl.movie_id
    from "Watch Logs" wl
    join "Movies" m on m.id = wl.movie_id
    where wl.user_id = uid
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
  ), ranked as (
    select mpa,
           count(*)::int as watches,
           count(distinct movie_id)::int as movies
    from base
    group by mpa
    order by watches desc, movies desc, mpa
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'mpa', mpa,
          'count', watches
        )
        order by watches desc, mpa
      ),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'mpa', mpa,
          'count', movies
        )
        order by movies desc, mpa
      ),
      '[]'::jsonb
    )
  into mpa_counts_total_json, mpa_counts_unique_json
  from ranked;

  -- MPA share by watch method (watch events total vs unique movies)
  with base as (
    select coalesce(nullif(btrim(m.mpa_rating), ''), 'Unrated') as mpa,
           wl.movie_id,
           case
             when lower(coalesce(wl.watch_method, '')) like '%home%' then 'At Home'
             when lower(coalesce(wl.watch_method, '')) like '%theater%'
               or lower(coalesce(wl.watch_method, '')) like '%theatre%' then 'In Theater'
             else null
           end as watch_method
    from "Watch Logs" wl
    join "Movies" m on m.id = wl.movie_id
    where wl.user_id = uid
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
  ), ranked as (
    select mpa,
           watch_method,
           count(*)::int as watches,
           count(distinct movie_id)::int as movies
    from base
    where watch_method is not null
    group by mpa, watch_method
    order by mpa, watch_method
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'mpa', mpa,
          'watch_method', watch_method,
          'count', watches
        )
        order by mpa, watch_method
      ),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'mpa', mpa,
          'watch_method', watch_method,
          'count', movies
        )
        order by mpa, watch_method
      ),
      '[]'::jsonb
    )
  into mpa_method_counts_total_json, mpa_method_counts_unique_json
  from ranked;

  -- Genre heatmap (avg rating by genre and decade)
  with base as (
    select g.name as genre,
           (m.release_year / 10) * 10 as decade,
           mr.overall_rating,
           mr.movie_id
    from "Movie Ratings" mr
    join "Movie Genres" mg on mg.movie_id = mr.movie_id
    join "Genres" g on g.id = mg.genre_id
    join "Movies" m on m.id = mr.movie_id
    where mr.user_id = uid
      and mr.overall_rating is not null
      and m.release_year is not null
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
  ), ranked as (
    select genre,
           decade,
           avg(overall_rating) as avg_rating,
           count(distinct movie_id) as n
    from base
    group by genre, decade
    order by genre, decade
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'genre', genre,
        'decade', decade,
        'avg', avg_rating,
        'n', n
      )
      order by genre, decade
    ),
    '[]'::jsonb
  )
  into genre_heatmap_json
  from ranked;

  -- Genre x MPA heatmap (avg rating by genre and MPA)
  with base as (
    select g.name as genre,
           coalesce(nullif(btrim(m.mpa_rating), ''), 'Unrated') as mpa,
           mr.overall_rating,
           mr.movie_id
    from "Movie Ratings" mr
    join "Movie Genres" mg on mg.movie_id = mr.movie_id
    join "Genres" g on g.id = mg.genre_id
    join "Movies" m on m.id = mr.movie_id
    where mr.user_id = uid
      and mr.overall_rating is not null
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
  ), ranked as (
    select genre,
           mpa,
           avg(overall_rating) as avg_rating,
           count(distinct movie_id) as n
    from base
    group by genre, mpa
    order by genre, mpa
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'genre', genre,
        'mpa', mpa,
        'avg', avg_rating,
        'n', n
      )
      order by genre, mpa
    ),
    '[]'::jsonb
  )
  into genre_mpa_heatmap_json
  from ranked;

  -- Decade x MPA heatmap (avg rating by decade and MPA)
  with base as (
    select (m.release_year / 10) * 10 as decade,
           coalesce(nullif(btrim(m.mpa_rating), ''), 'Unrated') as mpa,
           mr.overall_rating,
           mr.movie_id
    from "Movie Ratings" mr
    join "Movies" m on m.id = mr.movie_id
    where mr.user_id = uid
      and mr.overall_rating is not null
      and m.release_year is not null
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
  ), ranked as (
    select decade,
           mpa,
           avg(overall_rating) as avg_rating,
           count(distinct movie_id) as n
    from base
    group by decade, mpa
    order by decade, mpa
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'decade', decade,
        'mpa', mpa,
        'avg', avg_rating,
        'n', n
      )
      order by decade, mpa
    ),
    '[]'::jsonb
  )
  into decade_mpa_heatmap_json
  from ranked;

  -- Watch activity trend (daily for calendar heatmap)
  activity_grain := 'day';

  if tf = 'this_month' then
    activity_start := start_date;
    activity_end := end_date;
  elsif tf = 'this_year' then
    activity_start := start_date;
    activity_end := end_date;
  else
    select
      date_trunc('year', min(wl.watch_date))::date,
      (date_trunc('year', max(wl.watch_date)) + interval '1 year')::date
      into activity_start, activity_end
    from "Watch Logs" wl
    where wl.user_id = uid;

    if activity_start is null or activity_end is null then
      activity_start := date_trunc('month', now())::date;
      activity_end := (date_trunc('month', now()) + interval '1 month')::date;
    end if;
  end if;

  with series as (
    select generate_series(activity_start, activity_end - interval '1 day', interval '1 day')::date as bucket
  ), counts as (
    select wl.watch_date::date as bucket, count(*) as cnt
    from "Watch Logs" wl
    where wl.user_id = uid
      and wl.watch_date >= activity_start
      and wl.watch_date < activity_end
    group by wl.watch_date::date
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'bucket', s.bucket,
        'label', to_char(s.bucket, 'YYYY-MM-DD'),
        'count', coalesce(c.cnt, 0)
      )
      order by s.bucket
    ),
    '[]'::jsonb
  )
  into activity_json
  from series s
  left join counts c on c.bucket = s.bucket;


  return jsonb_build_object(
    'timeframe', tf,
    'genres', coalesce(genres_json, '[]'::jsonb),
    'decades', coalesce(decades_json, '[]'::jsonb),
    'mpa', coalesce(mpa_json, '[]'::jsonb),
    'genre_counts_total', coalesce(genre_counts_total_json, '[]'::jsonb),
    'genre_counts_unique', coalesce(genre_counts_unique_json, '[]'::jsonb),
    'decade_counts_total', coalesce(decade_counts_total_json, '[]'::jsonb),
    'decade_counts_unique', coalesce(decade_counts_unique_json, '[]'::jsonb),
    'mpa_counts_total', coalesce(mpa_counts_total_json, '[]'::jsonb),
    'mpa_counts_unique', coalesce(mpa_counts_unique_json, '[]'::jsonb),
    'genre_method_counts_total', coalesce(genre_method_counts_total_json, '[]'::jsonb),
    'genre_method_counts_unique', coalesce(genre_method_counts_unique_json, '[]'::jsonb),
    'decade_method_counts_total', coalesce(decade_method_counts_total_json, '[]'::jsonb),
    'decade_method_counts_unique', coalesce(decade_method_counts_unique_json, '[]'::jsonb),
    'mpa_method_counts_total', coalesce(mpa_method_counts_total_json, '[]'::jsonb),
    'mpa_method_counts_unique', coalesce(mpa_method_counts_unique_json, '[]'::jsonb),
    'genre_heatmap', coalesce(genre_heatmap_json, '[]'::jsonb),
    'genre_mpa_heatmap', coalesce(genre_mpa_heatmap_json, '[]'::jsonb),
    'decade_mpa_heatmap', coalesce(decade_mpa_heatmap_json, '[]'::jsonb),
    'activity', coalesce(activity_json, '[]'::jsonb),
    'activity_grain', activity_grain
  );
end;
$$;

grant execute on function public.get_dashboard_charts(text) to authenticated;


-- Tab 1 (General) RPC
-- Watch-behavior stats based on Watch Logs (rewatches count).
create or replace function public.get_dashboard_general(p_timeframe text default 'all_time')
returns jsonb
language plpgsql
as $$
declare
  uid uuid := auth.uid();
  tf text := lower(btrim(coalesce(p_timeframe, 'all_time')));
  start_ts timestamptz := null;
  end_ts timestamptz := null;
  start_date date := null;
  end_date date := null;

  watch_events_watches int := 0;
  watch_events_movies int := 0;

  total_watch_minutes numeric := 0;
  total_watch_hours numeric := 0;

  unique_watch_minutes numeric := 0;
  unique_watch_hours numeric := 0;

  watched_at_home int := 0;
  watched_at_home_movies int := 0;
  watched_in_theater int := 0;
  watched_in_theater_movies int := 0;
  watched_unknown int := 0;
  watched_unknown_movies int := 0;

  most_watched_genre_name text := '';
  most_watched_genre_watches int := 0;
  most_watched_genre_movies int := 0;

  most_watched_genre_unique_name text := '';
  most_watched_genre_unique_watches int := 0;
  most_watched_genre_unique_movies int := 0;

  most_watched_director_name text := '';
  most_watched_director_watches int := 0;
  most_watched_director_movies int := 0;
  most_watched_director_avg_overall numeric := 0;

  most_watched_director_unique_name text := '';
  most_watched_director_unique_watches int := 0;
  most_watched_director_unique_movies int := 0;
  most_watched_director_unique_avg_overall numeric := 0;
  most_watched_directors jsonb := '[]'::jsonb;
  most_watched_directors_unique jsonb := '[]'::jsonb;

  most_watched_actor_name text := '';
  most_watched_actor_watches int := 0;
  most_watched_actor_movies int := 0;
  most_watched_actor_avg_acting numeric := 0;

  most_watched_actor_unique_name text := '';
  most_watched_actor_unique_watches int := 0;
  most_watched_actor_unique_movies int := 0;
  most_watched_actor_unique_avg_acting numeric := 0;
  most_watched_actors jsonb := '[]'::jsonb;
  most_watched_actors_unique jsonb := '[]'::jsonb;

  most_watched_decade int := null;
  most_watched_decade_watches int := 0;
  most_watched_decade_movies int := 0;

  most_watched_decade_unique int := null;
  most_watched_decade_unique_watches int := 0;
  most_watched_decade_unique_movies int := 0;

  most_watched_movie_title text := '';
  most_watched_movie_year int := null;
  most_watched_movie_watches int := 0;
  most_watched_movies jsonb := '[]'::jsonb;

  most_watched_mpa_rating text := '';
  most_watched_mpa_watches int := 0;
  most_watched_mpa_movies int := 0;

  most_watched_mpa_unique_rating text := '';
  most_watched_mpa_unique_watches int := 0;
  most_watched_mpa_unique_movies int := 0;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if tf = 'this_year' then
    start_ts := date_trunc('year', now());
    end_ts := start_ts + interval '1 year';
  elsif tf = 'this_month' then
    start_ts := date_trunc('month', now());
    end_ts := start_ts + interval '1 month';
  else
    tf := 'all_time';
    start_ts := null;
    end_ts := null;
  end if;

  if start_ts is not null then
    start_date := start_ts::date;
    end_date := end_ts::date;
  else
    start_date := null;
    end_date := null;
  end if;

  -- Watch events (within timeframe)
  select count(*)::int,
         count(distinct wl.movie_id)::int
    into watch_events_watches, watch_events_movies
  from "Watch Logs" wl
  where wl.user_id = uid;

  if start_ts is not null then
    select count(*)::int,
           count(distinct wl.movie_id)::int
      into watch_events_watches, watch_events_movies
    from "Watch Logs" wl
    where wl.user_id = uid
      and wl.watch_date >= start_date
      and wl.watch_date < end_date;
  end if;

  -- Total watch time (within timeframe; rewatches count)
  select coalesce(sum(m.runtime_minutes), 0)
    into total_watch_minutes
  from "Watch Logs" wl
  join "Movies" m on m.id = wl.movie_id
  where wl.user_id = uid;

  if start_ts is not null then
    select coalesce(sum(m.runtime_minutes), 0)
      into total_watch_minutes
    from "Watch Logs" wl
    join "Movies" m on m.id = wl.movie_id
    where wl.user_id = uid
      and wl.watch_date >= start_date
      and wl.watch_date < end_date;
  end if;

  total_watch_hours := round((total_watch_minutes / 60.0)::numeric, 1);

  -- Unique watch time (within timeframe; distinct movies only)
  select coalesce(sum(m.runtime_minutes), 0)
    into unique_watch_minutes
  from (
    select distinct wl.movie_id
    from "Watch Logs" wl
    where wl.user_id = uid
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
  ) w
  join "Movies" m on m.id = w.movie_id;

  unique_watch_hours := round((unique_watch_minutes / 60.0)::numeric, 1);

  -- Watch method breakdown (within timeframe)
  select
    sum(case when lower(coalesce(watch_method, '')) like '%home%' then 1 else 0 end)::int,
    count(distinct case when lower(coalesce(watch_method, '')) like '%home%' then wl.movie_id else null end)::int,
    sum(case when lower(coalesce(watch_method, '')) like '%theater%' or lower(coalesce(watch_method, '')) like '%theatre%' then 1 else 0 end)::int,
    count(distinct case when lower(coalesce(watch_method, '')) like '%theater%' or lower(coalesce(watch_method, '')) like '%theatre%' then wl.movie_id else null end)::int,
    sum(case when coalesce(watch_method, '') = '' then 1 else 0 end)::int,
    count(distinct case when coalesce(watch_method, '') = '' then wl.movie_id else null end)::int
  into watched_at_home, watched_at_home_movies,
       watched_in_theater, watched_in_theater_movies,
       watched_unknown, watched_unknown_movies
  from "Watch Logs" wl
  where wl.user_id = uid
    and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date));

  -- Most watched genre (counts watch events; safe count via distinct watch-log id)
  with genre_counts as (
    select g.name as name,
           count(distinct wl.id)::int as watches,
           count(distinct wl.movie_id)::int as movies
    from "Watch Logs" wl
    join "Movie Genres" mg on mg.movie_id = wl.movie_id
    join "Genres" g on g.id = mg.genre_id
    where wl.user_id = uid
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by g.name
  )
  select name, watches, movies
    into most_watched_genre_name, most_watched_genre_watches, most_watched_genre_movies
  from genre_counts
  order by watches desc, movies desc
  limit 1;

  -- Most watched genre (UNIQUE movies leader; ranks by distinct movies, tie-break by watch events)
  with genre_counts as (
    select g.name as name,
           count(distinct wl.id)::int as watches,
           count(distinct wl.movie_id)::int as movies
    from "Watch Logs" wl
    join "Movie Genres" mg on mg.movie_id = wl.movie_id
    join "Genres" g on g.id = mg.genre_id
    where wl.user_id = uid
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by g.name
  )
  select name, watches, movies
    into most_watched_genre_unique_name, most_watched_genre_unique_watches, most_watched_genre_unique_movies
  from genre_counts
  order by movies desc, watches desc
  limit 1;

  -- Most watched director (counts watch events; avoid join multiplication via distinct wl.id)
  with director_counts as (
    select p.name as name,
           count(distinct wl.id)::int as watches,
           count(distinct wl.movie_id)::int as movies
    from "Watch Logs" wl
    join "Movie Crew" cr on cr.movie_id = wl.movie_id
    join "People" p on p.id = cr.person_id
    where wl.user_id = uid
      and lower(cr.job) = 'director'
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by p.name
  )
  select name, watches, movies
    into most_watched_director_name, most_watched_director_watches, most_watched_director_movies
  from director_counts
  order by watches desc, movies desc
  limit 1;

  with director_counts as (
    select p.name as name,
           count(distinct wl.id)::int as watches,
           count(distinct wl.movie_id)::int as movies
    from "Watch Logs" wl
    join "Movie Crew" cr on cr.movie_id = wl.movie_id
    join "People" p on p.id = cr.person_id
    where wl.user_id = uid
      and lower(cr.job) = 'director'
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by p.name
  ), max_counts as (
    select max(watches)::int as max_watches from director_counts
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', dc.name,
        'watches', dc.watches,
        'movies', dc.movies
      )
      order by dc.name asc
    ),
    '[]'::jsonb
  )
  into most_watched_directors
  from director_counts dc
  join max_counts mc on dc.watches = mc.max_watches;

  -- Most watched director (UNIQUE movies leader)
  with director_counts as (
    select p.name as name,
           count(distinct wl.id)::int as watches,
           count(distinct wl.movie_id)::int as movies
    from "Watch Logs" wl
    join "Movie Crew" cr on cr.movie_id = wl.movie_id
    join "People" p on p.id = cr.person_id
    where wl.user_id = uid
      and lower(cr.job) = 'director'
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by p.name
  )
  select name, watches, movies
    into most_watched_director_unique_name, most_watched_director_unique_watches, most_watched_director_unique_movies
  from director_counts
  order by movies desc, watches desc
  limit 1;

  with director_counts as (
    select p.name as name,
           count(distinct wl.id)::int as watches,
           count(distinct wl.movie_id)::int as movies
    from "Watch Logs" wl
    join "Movie Crew" cr on cr.movie_id = wl.movie_id
    join "People" p on p.id = cr.person_id
    where wl.user_id = uid
      and lower(cr.job) = 'director'
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by p.name
  ), max_counts as (
    select max(movies)::int as max_movies from director_counts
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', dc.name,
        'watches', dc.watches,
        'movies', dc.movies
      )
      order by dc.name asc
    ),
    '[]'::jsonb
  )
  into most_watched_directors_unique
  from director_counts dc
  join max_counts mc on dc.movies = mc.max_movies;

  if coalesce(nullif(btrim(most_watched_director_name), ''), '') <> '' then
    select coalesce(round(avg(mr.overall_rating)::numeric, 1), 0)
      into most_watched_director_avg_overall
    from "Movie Ratings" mr
    join "Movie Crew" cr on cr.movie_id = mr.movie_id
    join "People" p on p.id = cr.person_id
    where mr.user_id = uid
      and lower(cr.job) = 'director'
      and p.name = most_watched_director_name
      and mr.overall_rating is not null
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date));
  end if;

  if coalesce(nullif(btrim(most_watched_director_unique_name), ''), '') <> '' then
    select coalesce(round(avg(mr.overall_rating)::numeric, 1), 0)
      into most_watched_director_unique_avg_overall
    from "Movie Ratings" mr
    join "Movie Crew" cr on cr.movie_id = mr.movie_id
    join "People" p on p.id = cr.person_id
    where mr.user_id = uid
      and lower(cr.job) = 'director'
      and p.name = most_watched_director_unique_name
      and mr.overall_rating is not null
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date));
  end if;

  -- Most watched actor (counts watch events; avoid join multiplication via distinct wl.id)
  with actor_counts as (
    select p.name as name,
           count(distinct wl.id)::int as watches,
           count(distinct wl.movie_id)::int as movies
    from "Watch Logs" wl
    join "Movie Cast" mc on mc.movie_id = wl.movie_id
    join "People" p on p.id = mc.person_id
    where wl.user_id = uid
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by p.name
  )
  select name, watches, movies
    into most_watched_actor_name, most_watched_actor_watches, most_watched_actor_movies
  from actor_counts
  order by watches desc, movies desc
  limit 1;

  with actor_counts as (
    select p.name as name,
           count(distinct wl.id)::int as watches,
           count(distinct wl.movie_id)::int as movies
    from "Watch Logs" wl
    join "Movie Cast" mc on mc.movie_id = wl.movie_id
    join "People" p on p.id = mc.person_id
    where wl.user_id = uid
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by p.name
  ), max_counts as (
    select max(watches)::int as max_watches from actor_counts
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', ac.name,
        'watches', ac.watches,
        'movies', ac.movies
      )
      order by ac.name asc
    ),
    '[]'::jsonb
  )
  into most_watched_actors
  from actor_counts ac
  join max_counts mc on ac.watches = mc.max_watches;

  -- Most watched actor (UNIQUE movies leader)
  with actor_counts as (
    select p.name as name,
           count(distinct wl.id)::int as watches,
           count(distinct wl.movie_id)::int as movies
    from "Watch Logs" wl
    join "Movie Cast" mc on mc.movie_id = wl.movie_id
    join "People" p on p.id = mc.person_id
    where wl.user_id = uid
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by p.name
  )
  select name, watches, movies
    into most_watched_actor_unique_name, most_watched_actor_unique_watches, most_watched_actor_unique_movies
  from actor_counts
  order by movies desc, watches desc
  limit 1;

  with actor_counts as (
    select p.name as name,
           count(distinct wl.id)::int as watches,
           count(distinct wl.movie_id)::int as movies
    from "Watch Logs" wl
    join "Movie Cast" mc on mc.movie_id = wl.movie_id
    join "People" p on p.id = mc.person_id
    where wl.user_id = uid
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by p.name
  ), max_counts as (
    select max(movies)::int as max_movies from actor_counts
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', ac.name,
        'watches', ac.watches,
        'movies', ac.movies
      )
      order by ac.name asc
    ),
    '[]'::jsonb
  )
  into most_watched_actors_unique
  from actor_counts ac
  join max_counts mc on ac.movies = mc.max_movies;

  if coalesce(nullif(btrim(most_watched_actor_name), ''), '') <> '' then
    select coalesce(round(avg(mr.acting_rating)::numeric, 1), 0)
      into most_watched_actor_avg_acting
    from "Movie Ratings" mr
    join "Movie Cast" mc on mc.movie_id = mr.movie_id
    join "People" p on p.id = mc.person_id
    where mr.user_id = uid
      and p.name = most_watched_actor_name
      and mr.acting_rating is not null
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date));
  end if;

  if coalesce(nullif(btrim(most_watched_actor_unique_name), ''), '') <> '' then
    select coalesce(round(avg(mr.acting_rating)::numeric, 1), 0)
      into most_watched_actor_unique_avg_acting
    from "Movie Ratings" mr
    join "Movie Cast" mc on mc.movie_id = mr.movie_id
    join "People" p on p.id = mc.person_id
    where mr.user_id = uid
      and p.name = most_watched_actor_unique_name
      and mr.acting_rating is not null
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date));
  end if;

  -- Most watched decade (counts watch events)
  with decade_counts as (
    select (floor(m.release_year / 10.0) * 10)::int as decade,
           count(distinct wl.id)::int as watches,
           count(distinct wl.movie_id)::int as movies
    from "Watch Logs" wl
    join "Movies" m on m.id = wl.movie_id
    where wl.user_id = uid
      and m.release_year is not null
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by (floor(m.release_year / 10.0) * 10)::int
  )
  select decade, watches, movies
    into most_watched_decade, most_watched_decade_watches, most_watched_decade_movies
  from decade_counts
  order by watches desc, movies desc
  limit 1;

  -- Most watched decade (UNIQUE movies leader)
  with decade_counts as (
    select (floor(m.release_year / 10.0) * 10)::int as decade,
           count(distinct wl.id)::int as watches,
           count(distinct wl.movie_id)::int as movies
    from "Watch Logs" wl
    join "Movies" m on m.id = wl.movie_id
    where wl.user_id = uid
      and m.release_year is not null
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by (floor(m.release_year / 10.0) * 10)::int
  )
  select decade, watches, movies
    into most_watched_decade_unique, most_watched_decade_unique_watches, most_watched_decade_unique_movies
  from decade_counts
  order by movies desc, watches desc
  limit 1;

  -- Most watched movie(s) (within timeframe, include ties)
  with movie_counts as (
    select m.id as movie_id,
           m.tmdb_id as tmdb_id,
           m.poster_path as poster_path,
           m.title as title,
           m.release_year as release_year,
           count(distinct wl.id)::int as watches,
           mr.overall_rating as overall_rating,
           mr.tier as tier
    from "Watch Logs" wl
    join "Movies" m on m.id = wl.movie_id
    left join lateral (
      select mr2.overall_rating, mr2.tier
      from "Movie Ratings" mr2
      where mr2.user_id = uid
        and mr2.movie_id = m.id
      order by mr2.updated_at desc nulls last, mr2.watch_date desc nulls last
      limit 1
    ) mr on true
    where wl.user_id = uid
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by m.id, m.tmdb_id, m.poster_path, m.title, m.release_year, mr.overall_rating, mr.tier
  ), max_watch as (
    select max(watches) as max_watches from movie_counts
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'movie_id', mc.movie_id,
        'tmdb_id', mc.tmdb_id,
        'poster_path', mc.poster_path,
        'title', mc.title,
        'release_year', mc.release_year,
        'watches', mc.watches,
        'overall_rating', mc.overall_rating,
        'tier', mc.tier
      )
      order by mc.title asc
    ),
    '[]'::jsonb
  )
  into most_watched_movies
  from movie_counts mc
  join max_watch mw on mc.watches = mw.max_watches;

  with movie_counts as (
    select m.title as title,
           m.release_year as release_year,
           count(distinct wl.id)::int as watches
    from "Watch Logs" wl
    join "Movies" m on m.id = wl.movie_id
    where wl.user_id = uid
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by m.title, m.release_year
  ), max_watch as (
    select max(watches) as max_watches from movie_counts
  )
  select mc.title, mc.release_year, mc.watches
    into most_watched_movie_title, most_watched_movie_year, most_watched_movie_watches
  from movie_counts mc
  join max_watch mw on mc.watches = mw.max_watches
  order by mc.title asc
  limit 1;

  -- Most watched MPA rating (within timeframe)
  -- NOTE: uses "Movies"."mpa_rating" (text). Blank/NULL becomes "Unrated".
  with mpa_counts as (
    select coalesce(nullif(btrim(m.mpa_rating), ''), 'Unrated') as rating,
           count(distinct wl.id)::int as watches,
           count(distinct wl.movie_id)::int as movies
    from "Watch Logs" wl
    join "Movies" m on m.id = wl.movie_id
    where wl.user_id = uid
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by coalesce(nullif(btrim(m.mpa_rating), ''), 'Unrated')
  )
  select rating, watches, movies
    into most_watched_mpa_rating, most_watched_mpa_watches, most_watched_mpa_movies
  from mpa_counts
  order by watches desc, movies desc
  limit 1;

  -- Most watched MPA rating (UNIQUE movies leader)
  with mpa_counts as (
    select coalesce(nullif(btrim(m.mpa_rating), ''), 'Unrated') as rating,
           count(distinct wl.id)::int as watches,
           count(distinct wl.movie_id)::int as movies
    from "Watch Logs" wl
    join "Movies" m on m.id = wl.movie_id
    where wl.user_id = uid
      and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
    group by coalesce(nullif(btrim(m.mpa_rating), ''), 'Unrated')
  )
  select rating, watches, movies
    into most_watched_mpa_unique_rating, most_watched_mpa_unique_watches, most_watched_mpa_unique_movies
  from mpa_counts
  order by movies desc, watches desc
  limit 1;

  return jsonb_build_object(
    'timeframe', tf,
    'watch_events', jsonb_build_object(
      'watches', coalesce(watch_events_watches, 0),
      'movies', coalesce(watch_events_movies, 0)
    ),
    'hours_watched', coalesce(total_watch_hours, 0),
    'hours_watched_unique', coalesce(unique_watch_hours, 0),
    'watch_method_breakdown', jsonb_build_object(
      'at_home', jsonb_build_object(
        'watches', coalesce(watched_at_home, 0),
        'movies', coalesce(watched_at_home_movies, 0)
      ),
      'in_theater', jsonb_build_object(
        'watches', coalesce(watched_in_theater, 0),
        'movies', coalesce(watched_in_theater_movies, 0)
      ),
      'unknown', jsonb_build_object(
        'watches', coalesce(watched_unknown, 0),
        'movies', coalesce(watched_unknown_movies, 0)
      )
    ),
    'most_watched_genre', jsonb_build_object(
      'name', coalesce(most_watched_genre_name, ''),
      'watches', coalesce(most_watched_genre_watches, 0),
      'movies', coalesce(most_watched_genre_movies, 0)
    ),
    'most_watched_genre_unique', jsonb_build_object(
      'name', coalesce(most_watched_genre_unique_name, ''),
      'watches', coalesce(most_watched_genre_unique_watches, 0),
      'movies', coalesce(most_watched_genre_unique_movies, 0)
    ),
    'most_watched_director', jsonb_build_object(
      'name', coalesce(most_watched_director_name, ''),
      'watches', coalesce(most_watched_director_watches, 0),
      'movies', coalesce(most_watched_director_movies, 0),
      'avg_overall', coalesce(most_watched_director_avg_overall, 0)
    ),
    'most_watched_directors', coalesce(most_watched_directors, '[]'::jsonb),
    'most_watched_director_unique', jsonb_build_object(
      'name', coalesce(most_watched_director_unique_name, ''),
      'watches', coalesce(most_watched_director_unique_watches, 0),
      'movies', coalesce(most_watched_director_unique_movies, 0),
      'avg_overall', coalesce(most_watched_director_unique_avg_overall, 0)
    ),
    'most_watched_directors_unique', coalesce(most_watched_directors_unique, '[]'::jsonb),
    'most_watched_actor', jsonb_build_object(
      'name', coalesce(most_watched_actor_name, ''),
      'watches', coalesce(most_watched_actor_watches, 0),
      'movies', coalesce(most_watched_actor_movies, 0),
      'avg_acting', coalesce(most_watched_actor_avg_acting, 0)
    ),
    'most_watched_actors', coalesce(most_watched_actors, '[]'::jsonb),
    'most_watched_actor_unique', jsonb_build_object(
      'name', coalesce(most_watched_actor_unique_name, ''),
      'watches', coalesce(most_watched_actor_unique_watches, 0),
      'movies', coalesce(most_watched_actor_unique_movies, 0),
      'avg_acting', coalesce(most_watched_actor_unique_avg_acting, 0)
    ),
    'most_watched_actors_unique', coalesce(most_watched_actors_unique, '[]'::jsonb),
    'most_watched_decade', jsonb_build_object(
      'decade', most_watched_decade,
      'watches', coalesce(most_watched_decade_watches, 0),
      'movies', coalesce(most_watched_decade_movies, 0)
    ),
    'most_watched_decade_unique', jsonb_build_object(
      'decade', most_watched_decade_unique,
      'watches', coalesce(most_watched_decade_unique_watches, 0),
      'movies', coalesce(most_watched_decade_unique_movies, 0)
    ),
    'most_watched_movie', jsonb_build_object(
      'title', coalesce(most_watched_movie_title, ''),
      'release_year', most_watched_movie_year,
      'watches', coalesce(most_watched_movie_watches, 0)
    ),
    'most_watched_movies', coalesce(most_watched_movies, '[]'::jsonb),
    'most_watched_mpa', jsonb_build_object(
      'rating', coalesce(most_watched_mpa_rating, ''),
      'watches', coalesce(most_watched_mpa_watches, 0),
      'movies', coalesce(most_watched_mpa_movies, 0)
    ),
    'most_watched_mpa_unique', jsonb_build_object(
      'rating', coalesce(most_watched_mpa_unique_rating, ''),
      'watches', coalesce(most_watched_mpa_unique_watches, 0),
      'movies', coalesce(most_watched_mpa_unique_movies, 0)
    )
  );
end;
$$;

grant execute on function public.get_dashboard_general(text) to authenticated;

-- Back-compat wrapper (older clients may call the no-arg version)
create or replace function public.get_dashboard_general()
returns jsonb
language sql
as $$
  select public.get_dashboard_general('all_time');
$$;

grant execute on function public.get_dashboard_general() to authenticated;


-- General KPI drill-down (movies list)
-- Returns the movies associated with a specific General KPI (posters/title/overall/tier).
-- NOTE: This intentionally computes the "top" KPI value server-side to match what's shown on the General tab.
create or replace function public.get_dashboard_general_kpi_movies(
  p_timeframe text default 'all_time',
  p_kpi text default ''
)
returns jsonb
language plpgsql
as $$
declare
  uid uuid := auth.uid();
  tf text := lower(btrim(coalesce(p_timeframe, 'all_time')));
  kpi text := lower(btrim(coalesce(p_kpi, '')));
  start_ts timestamptz := null;
  end_ts timestamptz := null;
  start_date date := null;
  end_date date := null;

  leader_text text := null;
  leader_decade int := null;
  leader_movie_id uuid := null;
  movies_json jsonb := '[]'::jsonb;
  people_json jsonb := '[]'::jsonb;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if tf = 'this_year' then
    start_ts := date_trunc('year', now());
    end_ts := start_ts + interval '1 year';
  elsif tf = 'this_month' then
    start_ts := date_trunc('month', now());
    end_ts := start_ts + interval '1 month';
  else
    tf := 'all_time';
    start_ts := null;
    end_ts := null;
  end if;

  if start_ts is not null then
    start_date := start_ts::date;
    end_date := end_ts::date;
  else
    start_date := null;
    end_date := null;
  end if;

  if kpi in ('most_watched_genre', 'most_watched_genre_unique') then
    with genre_counts as (
      select g.name as name,
             count(distinct wl.id)::int as watches,
             count(distinct wl.movie_id)::int as movies
      from "Watch Logs" wl
      join "Movie Genres" mg on mg.movie_id = wl.movie_id
      join "Genres" g on g.id = mg.genre_id
      where wl.user_id = uid
        and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
      group by g.name
    )
    select name
      into leader_text
    from genre_counts gc
    order by
      case when kpi = 'most_watched_genre_unique' then gc.movies end desc,
      case when kpi = 'most_watched_genre_unique' then gc.watches end desc,
      case when kpi = 'most_watched_genre' then gc.watches end desc,
      case when kpi = 'most_watched_genre' then gc.movies end desc,
      name asc
    limit 1;

    with movie_rows as (
      select m.id as movie_id,
             m.tmdb_id as tmdb_id,
             m.poster_path as poster_path,
             m.title as title,
             m.release_year as release_year,
             mr.overall_rating as overall_rating,
             mr.tier as tier,
             count(distinct wl.id)::int as watch_count
      from "Watch Logs" wl
      join "Movies" m on m.id = wl.movie_id
      join "Movie Genres" mg on mg.movie_id = wl.movie_id
      join "Genres" g on g.id = mg.genre_id
      left join "Movie Ratings" mr on mr.user_id = uid and mr.movie_id = wl.movie_id
      where wl.user_id = uid
        and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
        and g.name = leader_text
      group by m.id, m.tmdb_id, m.poster_path, m.title, m.release_year, mr.overall_rating, mr.tier
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'movie_id', mrw.movie_id,
          'tmdb_id', mrw.tmdb_id,
          'poster_path', mrw.poster_path,
          'title', mrw.title,
          'release_year', mrw.release_year,
          'overall_rating', mrw.overall_rating,
          'tier', mrw.tier,
          'watch_count', mrw.watch_count
        )
        order by mrw.watch_count desc, mrw.title asc
      ),
      '[]'::jsonb
    )
    into movies_json
    from movie_rows mrw;

  elsif kpi in ('most_watched_director', 'most_watched_director_unique') then
    with director_counts as (
      select p.name as name,
             count(distinct wl.id)::int as watches,
             count(distinct wl.movie_id)::int as movies
      from "Watch Logs" wl
      join "Movie Crew" cr on cr.movie_id = wl.movie_id
      join "People" p on p.id = cr.person_id
      where wl.user_id = uid
        and lower(cr.job) = 'director'
        and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
      group by p.name
    )
    select name
      into leader_text
    from director_counts dc
    order by
      case when kpi = 'most_watched_director_unique' then dc.movies end desc,
      case when kpi = 'most_watched_director_unique' then dc.watches end desc,
      case when kpi = 'most_watched_director' then dc.watches end desc,
      case when kpi = 'most_watched_director' then dc.movies end desc,
      name asc
    limit 1;

    with director_counts as (
      select p.name as name,
             count(distinct wl.id)::int as watches,
             count(distinct wl.movie_id)::int as movies
      from "Watch Logs" wl
      join "Movie Crew" cr on cr.movie_id = wl.movie_id
      join "People" p on p.id = cr.person_id
      where wl.user_id = uid
        and lower(cr.job) = 'director'
        and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
      group by p.name
    ), max_counts as (
      select
        max(watches)::int as max_watches,
        max(movies)::int as max_movies
      from director_counts
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', dc.name,
          'watches', dc.watches,
          'movies', dc.movies
        )
        order by dc.name asc
      ),
      '[]'::jsonb
    )
    into people_json
    from director_counts dc
    cross join max_counts mc
    where (kpi = 'most_watched_director' and dc.watches = mc.max_watches)
       or (kpi = 'most_watched_director_unique' and dc.movies = mc.max_movies);

    if coalesce(jsonb_array_length(people_json), 0) <= 1 then
      with movie_rows as (
        select m.id as movie_id,
               m.tmdb_id as tmdb_id,
               m.poster_path as poster_path,
               m.title as title,
               m.release_year as release_year,
               mr.overall_rating as overall_rating,
               mr.tier as tier,
               count(distinct wl.id)::int as watch_count
        from "Watch Logs" wl
        join "Movies" m on m.id = wl.movie_id
        join "Movie Crew" cr on cr.movie_id = wl.movie_id
        join "People" p on p.id = cr.person_id
        left join "Movie Ratings" mr on mr.user_id = uid and mr.movie_id = wl.movie_id
        where wl.user_id = uid
          and lower(cr.job) = 'director'
          and p.name = leader_text
          and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
        group by m.id, m.tmdb_id, m.poster_path, m.title, m.release_year, mr.overall_rating, mr.tier
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'movie_id', mrw.movie_id,
            'tmdb_id', mrw.tmdb_id,
            'poster_path', mrw.poster_path,
            'title', mrw.title,
            'release_year', mrw.release_year,
            'overall_rating', mrw.overall_rating,
            'tier', mrw.tier,
            'watch_count', mrw.watch_count
          )
          order by mrw.watch_count desc, mrw.title asc
        ),
        '[]'::jsonb
      )
      into movies_json
      from movie_rows mrw;
    end if;

  elsif kpi in ('most_watched_actor', 'most_watched_actor_unique') then
    with actor_counts as (
      select p.name as name,
             count(distinct wl.id)::int as watches,
             count(distinct wl.movie_id)::int as movies
      from "Watch Logs" wl
      join "Movie Cast" mc on mc.movie_id = wl.movie_id
      join "People" p on p.id = mc.person_id
      where wl.user_id = uid
        and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
      group by p.name
    )
    select name
      into leader_text
    from actor_counts ac
    order by
      case when kpi = 'most_watched_actor_unique' then ac.movies end desc,
      case when kpi = 'most_watched_actor_unique' then ac.watches end desc,
      case when kpi = 'most_watched_actor' then ac.watches end desc,
      case when kpi = 'most_watched_actor' then ac.movies end desc,
      name asc
    limit 1;

    with actor_counts as (
      select p.name as name,
             count(distinct wl.id)::int as watches,
             count(distinct wl.movie_id)::int as movies
      from "Watch Logs" wl
      join "Movie Cast" mc on mc.movie_id = wl.movie_id
      join "People" p on p.id = mc.person_id
      where wl.user_id = uid
        and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
      group by p.name
    ), max_counts as (
      select
        max(watches)::int as max_watches,
        max(movies)::int as max_movies
      from actor_counts
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', ac.name,
          'watches', ac.watches,
          'movies', ac.movies
        )
        order by ac.name asc
      ),
      '[]'::jsonb
    )
    into people_json
    from actor_counts ac
    cross join max_counts mc
    where (kpi = 'most_watched_actor' and ac.watches = mc.max_watches)
       or (kpi = 'most_watched_actor_unique' and ac.movies = mc.max_movies);

    if coalesce(jsonb_array_length(people_json), 0) <= 1 then
      with movie_rows as (
        select m.id as movie_id,
               m.tmdb_id as tmdb_id,
               m.poster_path as poster_path,
               m.title as title,
               m.release_year as release_year,
               mr.overall_rating as overall_rating,
               mr.tier as tier,
               count(distinct wl.id)::int as watch_count
        from "Watch Logs" wl
        join "Movies" m on m.id = wl.movie_id
        join "Movie Cast" mc on mc.movie_id = wl.movie_id
        join "People" p on p.id = mc.person_id
        left join "Movie Ratings" mr on mr.user_id = uid and mr.movie_id = wl.movie_id
        where wl.user_id = uid
          and p.name = leader_text
          and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
        group by m.id, m.tmdb_id, m.poster_path, m.title, m.release_year, mr.overall_rating, mr.tier
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'movie_id', mrw.movie_id,
            'tmdb_id', mrw.tmdb_id,
            'poster_path', mrw.poster_path,
            'title', mrw.title,
            'release_year', mrw.release_year,
            'overall_rating', mrw.overall_rating,
            'tier', mrw.tier,
            'watch_count', mrw.watch_count
          )
          order by mrw.watch_count desc, mrw.title asc
        ),
        '[]'::jsonb
      )
      into movies_json
      from movie_rows mrw;
    end if;

  elsif kpi in ('most_watched_decade', 'most_watched_decade_unique') then
    with decade_counts as (
      select (floor(m.release_year / 10.0) * 10)::int as decade,
             count(distinct wl.id)::int as watches,
             count(distinct wl.movie_id)::int as movies
      from "Watch Logs" wl
      join "Movies" m on m.id = wl.movie_id
      where wl.user_id = uid
        and m.release_year is not null
        and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
      group by (floor(m.release_year / 10.0) * 10)::int
    )
    select decade
      into leader_decade
    from decade_counts dcc
    order by
      case when kpi = 'most_watched_decade_unique' then dcc.movies end desc,
      case when kpi = 'most_watched_decade_unique' then dcc.watches end desc,
      case when kpi = 'most_watched_decade' then dcc.watches end desc,
      case when kpi = 'most_watched_decade' then dcc.movies end desc,
      decade asc
    limit 1;

    with movie_rows as (
      select m.id as movie_id,
             m.tmdb_id as tmdb_id,
             m.poster_path as poster_path,
             m.title as title,
             m.release_year as release_year,
             mr.overall_rating as overall_rating,
             mr.tier as tier,
             count(distinct wl.id)::int as watch_count
      from "Watch Logs" wl
      join "Movies" m on m.id = wl.movie_id
      left join "Movie Ratings" mr on mr.user_id = uid and mr.movie_id = wl.movie_id
      where wl.user_id = uid
        and m.release_year is not null
        and (floor(m.release_year / 10.0) * 10)::int = leader_decade
        and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
      group by m.id, m.tmdb_id, m.poster_path, m.title, m.release_year, mr.overall_rating, mr.tier
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'movie_id', mrw.movie_id,
          'tmdb_id', mrw.tmdb_id,
          'poster_path', mrw.poster_path,
          'title', mrw.title,
          'release_year', mrw.release_year,
          'overall_rating', mrw.overall_rating,
          'tier', mrw.tier,
          'watch_count', mrw.watch_count
        )
        order by mrw.watch_count desc, mrw.title asc
      ),
      '[]'::jsonb
    )
    into movies_json
    from movie_rows mrw;

  elsif kpi = 'most_watched_movie' then
    with movie_counts as (
      select wl.movie_id as movie_id,
             count(distinct wl.id)::int as watches
      from "Watch Logs" wl
      where wl.user_id = uid
        and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
      group by wl.movie_id
    ), max_watch as (
      select max(watches) as max_watches from movie_counts
    ), tied_movies as (
      select mc.movie_id, mc.watches
      from movie_counts mc
      join max_watch mw on mc.watches = mw.max_watches
    )
    select tm.movie_id
      into leader_movie_id
    from tied_movies tm
    order by tm.movie_id asc
    limit 1;

    with movie_counts as (
      select wl.movie_id as movie_id,
             count(distinct wl.id)::int as watches
      from "Watch Logs" wl
      where wl.user_id = uid
        and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
      group by wl.movie_id
    ), max_watch as (
      select max(watches) as max_watches from movie_counts
    ), tied_movies as (
      select mc.movie_id, mc.watches
      from movie_counts mc
      join max_watch mw on mc.watches = mw.max_watches
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'movie_id', m.id,
          'tmdb_id', m.tmdb_id,
          'poster_path', m.poster_path,
          'title', m.title,
          'release_year', m.release_year,
          'overall_rating', mr.overall_rating,
          'tier', mr.tier,
          'watch_count', tm.watches
        )
        order by tm.watches desc, m.title asc
      ),
      '[]'::jsonb
    )
    into movies_json
    from tied_movies tm
    join "Movies" m on m.id = tm.movie_id
    left join "Movie Ratings" mr on mr.user_id = uid and mr.movie_id = m.id;

  elsif kpi in ('most_watched_mpa', 'most_watched_mpa_unique') then
    with mpa_counts as (
      select coalesce(nullif(btrim(m.mpa_rating), ''), 'Unrated') as rating,
             count(distinct wl.id)::int as watches,
             count(distinct wl.movie_id)::int as movies
      from "Watch Logs" wl
      join "Movies" m on m.id = wl.movie_id
      where wl.user_id = uid
        and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
      group by coalesce(nullif(btrim(m.mpa_rating), ''), 'Unrated')
    )
    select rating
      into leader_text
    from mpa_counts mpc
    order by
      case when kpi = 'most_watched_mpa_unique' then mpc.movies end desc,
      case when kpi = 'most_watched_mpa_unique' then mpc.watches end desc,
      case when kpi = 'most_watched_mpa' then mpc.watches end desc,
      case when kpi = 'most_watched_mpa' then mpc.movies end desc,
      rating asc
    limit 1;

    with movie_rows as (
      select m.id as movie_id,
             m.tmdb_id as tmdb_id,
             m.poster_path as poster_path,
             m.title as title,
             m.release_year as release_year,
             mr.overall_rating as overall_rating,
             mr.tier as tier,
             count(distinct wl.id)::int as watch_count
      from "Watch Logs" wl
      join "Movies" m on m.id = wl.movie_id
      left join "Movie Ratings" mr on mr.user_id = uid and mr.movie_id = wl.movie_id
      where wl.user_id = uid
        and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
        and coalesce(nullif(btrim(m.mpa_rating), ''), 'Unrated') = leader_text
      group by m.id, m.tmdb_id, m.poster_path, m.title, m.release_year, mr.overall_rating, mr.tier
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'movie_id', mrw.movie_id,
          'tmdb_id', mrw.tmdb_id,
          'poster_path', mrw.poster_path,
          'title', mrw.title,
          'release_year', mrw.release_year,
          'overall_rating', mrw.overall_rating,
          'tier', mrw.tier,
          'watch_count', mrw.watch_count
        )
        order by mrw.watch_count desc, mrw.title asc
      ),
      '[]'::jsonb
    )
    into movies_json
    from movie_rows mrw;

  elsif kpi in ('watch_method_at_home_events', 'watch_method_at_home_unique') then
    leader_text := 'At home';
    with movie_rows as (
      select m.id as movie_id,
             m.tmdb_id as tmdb_id,
             m.poster_path as poster_path,
             m.title as title,
             m.release_year as release_year,
             mr.overall_rating as overall_rating,
             mr.tier as tier,
             count(distinct wl.id)::int as watch_count
      from "Watch Logs" wl
      join "Movies" m on m.id = wl.movie_id
      left join "Movie Ratings" mr on mr.user_id = uid and mr.movie_id = wl.movie_id
      where wl.user_id = uid
        and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
        and lower(coalesce(wl.watch_method, '')) like '%home%'
      group by m.id, m.tmdb_id, m.poster_path, m.title, m.release_year, mr.overall_rating, mr.tier
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'movie_id', mrw.movie_id,
          'tmdb_id', mrw.tmdb_id,
          'poster_path', mrw.poster_path,
          'title', mrw.title,
          'release_year', mrw.release_year,
          'overall_rating', mrw.overall_rating,
          'tier', mrw.tier,
          'watch_count', mrw.watch_count
        )
        order by mrw.watch_count desc, mrw.title asc
      ),
      '[]'::jsonb
    )
    into movies_json
    from movie_rows mrw;

  elsif kpi = 'watch_method_in_theater' then
    leader_text := 'In theater';
    with movie_rows as (
      select m.id as movie_id,
             m.tmdb_id as tmdb_id,
             m.poster_path as poster_path,
             m.title as title,
             m.release_year as release_year,
             mr.overall_rating as overall_rating,
             mr.tier as tier,
             count(distinct wl.id)::int as watch_count
      from "Watch Logs" wl
      join "Movies" m on m.id = wl.movie_id
      left join "Movie Ratings" mr on mr.user_id = uid and mr.movie_id = wl.movie_id
      where wl.user_id = uid
        and (start_date is null or (wl.watch_date >= start_date and wl.watch_date < end_date))
        and (
          lower(coalesce(wl.watch_method, '')) like '%theater%'
          or lower(coalesce(wl.watch_method, '')) like '%theatre%'
        )
      group by m.id, m.tmdb_id, m.poster_path, m.title, m.release_year, mr.overall_rating, mr.tier
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'movie_id', mrw.movie_id,
          'tmdb_id', mrw.tmdb_id,
          'poster_path', mrw.poster_path,
          'title', mrw.title,
          'release_year', mrw.release_year,
          'overall_rating', mrw.overall_rating,
          'tier', mrw.tier,
          'watch_count', mrw.watch_count
        )
        order by mrw.watch_count desc, mrw.title asc
      ),
      '[]'::jsonb
    )
    into movies_json
    from movie_rows mrw;
  else
    movies_json := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'timeframe', tf,
    'kpi', kpi,
    'leader', coalesce(leader_text, case when leader_decade is null then null else (leader_decade::text || 's') end, leader_movie_id::text, ''),
    'movies', coalesce(movies_json, '[]'::jsonb),
    'people', coalesce(people_json, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_dashboard_general_kpi_movies(text, text) to authenticated;


-- Ratings KPI drill-down (movies list)
-- Returns the movies associated with a specific Ratings KPI.
create or replace function public.get_dashboard_ratings_kpi_movies(
  p_timeframe text default 'all_time',
  p_kpi text default ''
)
returns jsonb
language plpgsql
as $$
declare
  uid uuid := auth.uid();
  tf text := lower(btrim(coalesce(p_timeframe, 'all_time')));
  kpi text := lower(btrim(coalesce(p_kpi, '')));
  start_ts timestamptz := null;
  end_ts timestamptz := null;
  start_date date := null;
  end_date date := null;

  leader_text text := null;
  movies_json jsonb := '[]'::jsonb;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if tf = 'this_year' then
    start_ts := date_trunc('year', now());
    end_ts := start_ts + interval '1 year';
  elsif tf = 'this_month' then
    start_ts := date_trunc('month', now());
    end_ts := start_ts + interval '1 month';
  else
    tf := 'all_time';
    start_ts := null;
    end_ts := null;
  end if;

  if start_ts is not null then
    start_date := start_ts::date;
    end_date := end_ts::date;
  else
    start_date := null;
    end_date := null;
  end if;

  if kpi = 'ratings_avg_overall' then
    leader_text := 'All rated movies';

    with movie_rows as (
      select mr.movie_id as movie_id,
             m.tmdb_id as tmdb_id,
             m.poster_path as poster_path,
             m.title as title,
             m.release_year as release_year,
             mr.overall_rating as overall_rating,
             mr.tier as tier
      from "Movie Ratings" mr
      join "Movies" m on m.id = mr.movie_id
      where mr.user_id = uid
        and mr.overall_rating is not null
        and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'movie_id', mrw.movie_id,
          'tmdb_id', mrw.tmdb_id,
          'poster_path', mrw.poster_path,
          'title', mrw.title,
          'release_year', mrw.release_year,
          'overall_rating', mrw.overall_rating,
          'tier', mrw.tier
        )
        order by mrw.overall_rating desc nulls last, mrw.title asc
      ),
      '[]'::jsonb
    )
    into movies_json
    from movie_rows mrw;

  elsif kpi = 'ratings_avg_imdb_diff' then
    leader_text := 'Rated movies with IMDb scores';

    with movie_rows as (
      select mr.movie_id as movie_id,
             m.tmdb_id as tmdb_id,
             m.poster_path as poster_path,
             m.title as title,
             m.release_year as release_year,
             mr.overall_rating as overall_rating,
             mr.tier as tier,
             abs(mr.overall_rating - mer.rating)::numeric as abs_diff
      from "Movie Ratings" mr
      join "Movies" m on m.id = mr.movie_id
      join "Movie External Ratings" mer
        on mer.movie_id = mr.movie_id
       and lower(mer.source) = 'imdb'
      where mr.user_id = uid
        and mr.overall_rating is not null
        and mer.rating is not null
        and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'movie_id', mrw.movie_id,
          'tmdb_id', mrw.tmdb_id,
          'poster_path', mrw.poster_path,
          'title', mrw.title,
          'release_year', mrw.release_year,
          'overall_rating', mrw.overall_rating,
          'tier', mrw.tier
        )
        order by mrw.abs_diff desc, mrw.title asc
      ),
      '[]'::jsonb
    )
    into movies_json
    from movie_rows mrw;

  elsif kpi in ('ratings_highest_genre', 'ratings_lowest_genre') then
    with genre_watch_counts as (
      select g.name as name, count(distinct mr.movie_id)::int as movies
      from "Movie Ratings" mr
      join "Movie Genres" mg on mg.movie_id = mr.movie_id
      join "Genres" g on g.id = mg.genre_id
      where mr.user_id = uid
        and mr.overall_rating is not null
        and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
      group by g.name
      having count(distinct mr.movie_id) >= 2
    ),
    genre_avgs as (
      select g.name as name,
             avg(mr.overall_rating)::numeric as avg_overall,
             count(*)::int as n
      from "Movie Ratings" mr
      join "Movie Genres" mg on mg.movie_id = mr.movie_id
      join "Genres" g on g.id = mg.genre_id
      join genre_watch_counts gw on gw.name = g.name
      where mr.user_id = uid
        and mr.overall_rating is not null
        and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
      group by g.name
    )
    select name
      into leader_text
    from genre_avgs
    order by
      case when kpi = 'ratings_highest_genre' then avg_overall end desc,
      case when kpi = 'ratings_lowest_genre' then avg_overall end asc,
      n desc
    limit 1;

    with movie_rows as (
      select mr.movie_id as movie_id,
             m.tmdb_id as tmdb_id,
             m.poster_path as poster_path,
             m.title as title,
             m.release_year as release_year,
             mr.overall_rating as overall_rating,
             mr.tier as tier
      from "Movie Ratings" mr
      join "Movies" m on m.id = mr.movie_id
      join "Movie Genres" mg on mg.movie_id = mr.movie_id
      join "Genres" g on g.id = mg.genre_id
      where mr.user_id = uid
        and mr.overall_rating is not null
        and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
        and g.name = leader_text
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'movie_id', mrw.movie_id,
          'tmdb_id', mrw.tmdb_id,
          'poster_path', mrw.poster_path,
          'title', mrw.title,
          'release_year', mrw.release_year,
          'overall_rating', mrw.overall_rating,
          'tier', mrw.tier
        )
        order by mrw.overall_rating desc nulls last, mrw.title asc
      ),
      '[]'::jsonb
    )
    into movies_json
    from movie_rows mrw;

  elsif kpi in ('ratings_highest_director', 'ratings_lowest_director') then
    with director_watch_counts as (
      select p.name as name, count(distinct mr.movie_id)::int as movies
      from "Movie Ratings" mr
      join "Movie Crew" cr on cr.movie_id = mr.movie_id
      join "People" p on p.id = cr.person_id
      where mr.user_id = uid
        and mr.overall_rating is not null
        and lower(cr.job) = 'director'
        and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
      group by p.name
      having count(distinct mr.movie_id) >= 2
    ),
    director_avgs as (
      select p.name as name,
             avg(mr.overall_rating)::numeric as avg_overall,
             avg(
               (select avg(v) from unnest(array[
                 mr.sound_rating,
                 mr.plot_rating,
                 mr.pacing_rating,
                 mr.acting_rating,
                 mr.imagery_rating,
                 mr.dialogue_rating
               ]) as v where v is not null)
             )::numeric as avg_sub,
             count(*)::int as n
      from "Movie Ratings" mr
      join "Movie Crew" cr on cr.movie_id = mr.movie_id
      join "People" p on p.id = cr.person_id
      join director_watch_counts dw on dw.name = p.name
      where mr.user_id = uid
        and mr.overall_rating is not null
        and lower(cr.job) = 'director'
        and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
      group by p.name
    )
    select name
      into leader_text
    from director_avgs
    order by
      case when kpi = 'ratings_highest_director' then avg_overall end desc,
      case when kpi = 'ratings_lowest_director' then avg_overall end asc,
      case when kpi = 'ratings_highest_director' then avg_sub end desc,
      case when kpi = 'ratings_lowest_director' then avg_sub end asc,
      n desc,
      name asc
    limit 1;

    with movie_rows as (
      select mr.movie_id as movie_id,
             m.tmdb_id as tmdb_id,
             m.poster_path as poster_path,
             m.title as title,
             m.release_year as release_year,
             mr.overall_rating as overall_rating,
             mr.tier as tier
      from "Movie Ratings" mr
      join "Movies" m on m.id = mr.movie_id
      join "Movie Crew" cr on cr.movie_id = mr.movie_id
      join "People" p on p.id = cr.person_id
      where mr.user_id = uid
        and mr.overall_rating is not null
        and lower(cr.job) = 'director'
        and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
        and p.name = leader_text
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'movie_id', mrw.movie_id,
          'tmdb_id', mrw.tmdb_id,
          'poster_path', mrw.poster_path,
          'title', mrw.title,
          'release_year', mrw.release_year,
          'overall_rating', mrw.overall_rating,
          'tier', mrw.tier
        )
        order by mrw.overall_rating desc nulls last, mrw.title asc
      ),
      '[]'::jsonb
    )
    into movies_json
    from movie_rows mrw;
  else
    movies_json := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'timeframe', tf,
    'kpi', kpi,
    'leader', coalesce(leader_text, ''),
    'movies', coalesce(movies_json, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_dashboard_ratings_kpi_movies(text, text) to authenticated;


-- Tab 2 (Ratings) RPC
-- Rating analytics based on Movie Ratings (one per rated movie per user).
create or replace function public.get_dashboard_ratings(p_timeframe text default 'all_time')
returns jsonb
language plpgsql
as $$
declare
  uid uuid := auth.uid();

  tf text := lower(btrim(coalesce(p_timeframe, 'all_time')));
  start_ts timestamptz := null;
  end_ts timestamptz := null;
  start_date date := null;
  end_date date := null;

  rated_movies_count int := 0;
  avg_overall_rating numeric := 0;
  avg_sound_rating numeric := 0;
  avg_plot_rating numeric := 0;
  avg_pacing_rating numeric := 0;
  avg_acting_rating numeric := 0;
  avg_imagery_rating numeric := 0;
  avg_dialogue_rating numeric := 0;

  avg_abs_imdb_diff numeric := 0;

  highest_rated_genre_name text := '';
  highest_rated_genre_avg numeric := 0;
  highest_rated_genre_n int := 0;

  lowest_rated_genre_name text := '';
  lowest_rated_genre_avg numeric := 0;
  lowest_rated_genre_n int := 0;

  highest_rated_director_name text := '';
  highest_rated_director_avg numeric := 0;
  highest_rated_director_n int := 0;

  lowest_rated_director_name text := '';
  lowest_rated_director_avg numeric := 0;
  lowest_rated_director_n int := 0;

  avg_by_genre jsonb := '[]'::jsonb;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if tf = 'this_year' then
    start_ts := date_trunc('year', now());
    end_ts := start_ts + interval '1 year';
  elsif tf = 'this_month' then
    start_ts := date_trunc('month', now());
    end_ts := start_ts + interval '1 month';
  else
    tf := 'all_time';
    start_ts := null;
    end_ts := null;
  end if;

  if start_ts is not null then
    start_date := start_ts::date;
    end_date := end_ts::date;
  else
    start_date := null;
    end_date := null;
  end if;

  -- Timeframe-filtered ratings (based on watch_date).

  select count(*)::int
    into rated_movies_count
  from "Movie Ratings" mr
  where mr.user_id = uid;

  if start_ts is not null then
    select count(*)::int
      into rated_movies_count
    from "Movie Ratings" mr
    where mr.user_id = uid
      and mr.watch_date >= start_date
      and mr.watch_date < end_date;
  end if;

  select coalesce(round(avg(mr.overall_rating)::numeric, 1), 0)
    into avg_overall_rating
  from "Movie Ratings" mr
  where mr.user_id = uid
    and mr.overall_rating is not null;

  select
    coalesce(round(avg(mr.sound_rating)::numeric, 1), 0),
    coalesce(round(avg(mr.plot_rating)::numeric, 1), 0),
    coalesce(round(avg(mr.pacing_rating)::numeric, 1), 0),
    coalesce(round(avg(mr.acting_rating)::numeric, 1), 0),
    coalesce(round(avg(mr.imagery_rating)::numeric, 1), 0),
    coalesce(round(avg(mr.dialogue_rating)::numeric, 1), 0)
  into
    avg_sound_rating,
    avg_plot_rating,
    avg_pacing_rating,
    avg_acting_rating,
    avg_imagery_rating,
    avg_dialogue_rating
  from "Movie Ratings" mr
  where mr.user_id = uid;

  if start_ts is not null then
    select coalesce(round(avg(mr.overall_rating)::numeric, 1), 0)
      into avg_overall_rating
    from "Movie Ratings" mr
    where mr.user_id = uid
      and mr.watch_date >= start_date
      and mr.watch_date < end_date
      and mr.overall_rating is not null;

    select
      coalesce(round(avg(mr.sound_rating)::numeric, 1), 0),
      coalesce(round(avg(mr.plot_rating)::numeric, 1), 0),
      coalesce(round(avg(mr.pacing_rating)::numeric, 1), 0),
      coalesce(round(avg(mr.acting_rating)::numeric, 1), 0),
      coalesce(round(avg(mr.imagery_rating)::numeric, 1), 0),
      coalesce(round(avg(mr.dialogue_rating)::numeric, 1), 0)
    into
      avg_sound_rating,
      avg_plot_rating,
      avg_pacing_rating,
      avg_acting_rating,
      avg_imagery_rating,
      avg_dialogue_rating
    from "Movie Ratings" mr
    where mr.user_id = uid
      and mr.watch_date >= start_date
      and mr.watch_date < end_date;
  end if;

  -- Average absolute difference between IMDb rating (as percent) and user's overall rating.
  -- IMDb ratings are stored in "Movie External Ratings" with source = 'imdb' and rating in 0-100.
  select coalesce(round(avg(abs(mr.overall_rating - mer.rating))::numeric, 1), 0)
    into avg_abs_imdb_diff
  from "Movie Ratings" mr
  join "Movie External Ratings" mer
    on mer.movie_id = mr.movie_id
   and lower(mer.source) = 'imdb'
  where mr.user_id = uid
    and mr.overall_rating is not null
    and mer.rating is not null
    and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date));

  -- Highest rated genre (average overall rating)
  -- Only include genres that have at least 2 unique rated movies in the selected timeframe.
  with genre_watch_counts as (
    select g.name as name, count(distinct mr.movie_id)::int as movies
    from "Movie Ratings" mr
    join "Movie Genres" mg on mg.movie_id = mr.movie_id
    join "Genres" g on g.id = mg.genre_id
    where mr.user_id = uid
      and mr.overall_rating is not null
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
    group by g.name
    having count(distinct mr.movie_id) >= 2
  ),
  genre_avgs as (
    select g.name as name,
           avg(mr.overall_rating)::numeric as avg_overall,
           count(*)::int as n
    from "Movie Ratings" mr
    join "Movie Genres" mg on mg.movie_id = mr.movie_id
    join "Genres" g on g.id = mg.genre_id
    join genre_watch_counts gw on gw.name = g.name
    where mr.user_id = uid
      and mr.overall_rating is not null
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
    group by g.name
  )
  select name, round(avg_overall, 1), n
    into highest_rated_genre_name, highest_rated_genre_avg, highest_rated_genre_n
  from genre_avgs
  order by avg_overall desc, n desc
  limit 1;

  -- Lowest rated genre (average overall rating)
  -- Only include genres that have at least 2 unique rated movies in the selected timeframe.
  with genre_watch_counts as (
    select g.name as name, count(distinct mr.movie_id)::int as movies
    from "Movie Ratings" mr
    join "Movie Genres" mg on mg.movie_id = mr.movie_id
    join "Genres" g on g.id = mg.genre_id
    where mr.user_id = uid
      and mr.overall_rating is not null
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
    group by g.name
    having count(distinct mr.movie_id) >= 2
  ),
  genre_avgs as (
    select g.name as name,
           avg(mr.overall_rating)::numeric as avg_overall,
           count(*)::int as n
    from "Movie Ratings" mr
    join "Movie Genres" mg on mg.movie_id = mr.movie_id
    join "Genres" g on g.id = mg.genre_id
    join genre_watch_counts gw on gw.name = g.name
    where mr.user_id = uid
      and mr.overall_rating is not null
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
    group by g.name
  )
  select name, round(avg_overall, 1), n
    into lowest_rated_genre_name, lowest_rated_genre_avg, lowest_rated_genre_n
  from genre_avgs
  order by avg_overall asc, n desc
  limit 1;

  -- Average rating by genre (all genres with at least 1 rated movie)
  with genre_avgs as (
    select g.name as name,
           avg(mr.overall_rating)::numeric as avg_overall,
           count(distinct mr.movie_id)::int as n
    from "Movie Ratings" mr
    join "Movie Genres" mg on mg.movie_id = mr.movie_id
    join "Genres" g on g.id = mg.genre_id
    where mr.user_id = uid
      and mr.overall_rating is not null
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
    group by g.name
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'genre', name,
        'avg', round(avg_overall, 1),
        'n', n
      )
      order by avg_overall desc, n desc, name asc
    ),
    '[]'::jsonb
  )
  into avg_by_genre
  from genre_avgs;

  -- Highest rated director (average overall rating)
  -- Only include directors that have at least 2 unique rated movies in the selected timeframe.
  with director_watch_counts as (
    select p.name as name, count(distinct mr.movie_id)::int as movies
    from "Movie Ratings" mr
    join "Movie Crew" cr on cr.movie_id = mr.movie_id
    join "People" p on p.id = cr.person_id
    where mr.user_id = uid
      and mr.overall_rating is not null
      and lower(cr.job) = 'director'
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
    group by p.name
    having count(distinct mr.movie_id) >= 2
  ),
  director_avgs as (
    select p.name as name,
           avg(mr.overall_rating)::numeric as avg_overall,
           avg(
             (select avg(v) from unnest(array[
               mr.sound_rating,
               mr.plot_rating,
               mr.pacing_rating,
               mr.acting_rating,
               mr.imagery_rating,
               mr.dialogue_rating
             ]) as v where v is not null)
           )::numeric as avg_sub,
           count(*)::int as n
    from "Movie Ratings" mr
    join "Movie Crew" cr on cr.movie_id = mr.movie_id
    join "People" p on p.id = cr.person_id
    join director_watch_counts dw on dw.name = p.name
    where mr.user_id = uid
      and mr.overall_rating is not null
      and lower(cr.job) = 'director'
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
    group by p.name
  )
  select name, round(avg_overall, 1), n
    into highest_rated_director_name, highest_rated_director_avg, highest_rated_director_n
  from director_avgs
  order by avg_overall desc, avg_sub desc, n desc, name asc
  limit 1;

  -- Lowest rated director (average overall rating)
  -- Only include directors that have at least 2 unique rated movies in the selected timeframe.
  with director_watch_counts as (
    select p.name as name, count(distinct mr.movie_id)::int as movies
    from "Movie Ratings" mr
    join "Movie Crew" cr on cr.movie_id = mr.movie_id
    join "People" p on p.id = cr.person_id
    where mr.user_id = uid
      and mr.overall_rating is not null
      and lower(cr.job) = 'director'
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
    group by p.name
    having count(distinct mr.movie_id) >= 2
  ),
  director_avgs as (
    select p.name as name,
           avg(mr.overall_rating)::numeric as avg_overall,
           avg(
             (select avg(v) from unnest(array[
               mr.sound_rating,
               mr.plot_rating,
               mr.pacing_rating,
               mr.acting_rating,
               mr.imagery_rating,
               mr.dialogue_rating
             ]) as v where v is not null)
           )::numeric as avg_sub,
           count(*)::int as n
    from "Movie Ratings" mr
    join "Movie Crew" cr on cr.movie_id = mr.movie_id
    join "People" p on p.id = cr.person_id
    join director_watch_counts dw on dw.name = p.name
    where mr.user_id = uid
      and mr.overall_rating is not null
      and lower(cr.job) = 'director'
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
    group by p.name
  )
  select name, round(avg_overall, 1), n
    into lowest_rated_director_name, lowest_rated_director_avg, lowest_rated_director_n
  from director_avgs
  order by avg_overall asc, avg_sub asc, n desc, name asc
  limit 1;

  return jsonb_build_object(
    'timeframe', tf,
    'rated_movies_count', coalesce(rated_movies_count, 0),
    'avg_overall_rating', coalesce(avg_overall_rating, 0),
    'avg_sound_rating', coalesce(avg_sound_rating, 0),
    'avg_plot_rating', coalesce(avg_plot_rating, 0),
    'avg_pacing_rating', coalesce(avg_pacing_rating, 0),
    'avg_acting_rating', coalesce(avg_acting_rating, 0),
    'avg_imagery_rating', coalesce(avg_imagery_rating, 0),
    'avg_dialogue_rating', coalesce(avg_dialogue_rating, 0),
    'avg_abs_imdb_diff', coalesce(avg_abs_imdb_diff, 0),
    'avg_by_genre', coalesce(avg_by_genre, '[]'::jsonb),
    'highest_rated_genre', jsonb_build_object(
      'name', coalesce(highest_rated_genre_name, ''),
      'avg_overall', coalesce(highest_rated_genre_avg, 0),
      'n', coalesce(highest_rated_genre_n, 0)
    ),
    'lowest_rated_genre', jsonb_build_object(
      'name', coalesce(lowest_rated_genre_name, ''),
      'avg_overall', coalesce(lowest_rated_genre_avg, 0),
      'n', coalesce(lowest_rated_genre_n, 0)
    ),
    'highest_rated_director', jsonb_build_object(
      'name', coalesce(highest_rated_director_name, ''),
      'avg_overall', coalesce(highest_rated_director_avg, 0),
      'n', coalesce(highest_rated_director_n, 0)
    ),
    'lowest_rated_director', jsonb_build_object(
      'name', coalesce(lowest_rated_director_name, ''),
      'avg_overall', coalesce(lowest_rated_director_avg, 0),
      'n', coalesce(lowest_rated_director_n, 0)
    )
  );
end;
$$;

grant execute on function public.get_dashboard_ratings(text) to authenticated;

-- Back-compat wrapper
create or replace function public.get_dashboard_ratings()
returns jsonb
language sql
as $$
  select public.get_dashboard_ratings('all_time');
$$;

grant execute on function public.get_dashboard_ratings() to authenticated;


-- Tab 3 (Tiers) RPC
-- Tier analytics + tier lists based on Movie Ratings.
create or replace function public.get_dashboard_tiers(p_timeframe text default 'all_time')
returns jsonb
language plpgsql
as $$
declare
  uid uuid := auth.uid();
  tf text := lower(btrim(coalesce(p_timeframe, 'all_time')));
  start_ts timestamptz := null;
  end_ts timestamptz := null;
  start_date date := null;
  end_date date := null;
  rated_total int := 0;
  tier_distribution jsonb := '[]'::jsonb;
  tier_movies jsonb := '[]'::jsonb;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if tf = 'this_year' then
    start_ts := date_trunc('year', now());
    end_ts := start_ts + interval '1 year';
  elsif tf = 'this_month' then
    start_ts := date_trunc('month', now());
    end_ts := start_ts + interval '1 month';
  else
    tf := 'all_time';
    start_ts := null;
    end_ts := null;
  end if;

  if start_ts is not null then
    start_date := start_ts::date;
    end_date := end_ts::date;
  else
    start_date := null;
    end_date := null;
  end if;

  select count(*)::int
    into rated_total
  from "Movie Ratings" mr
  where mr.user_id = uid
    and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date));

  -- Tier distribution (percent of rated movies).
  with tier_counts as (
    select
      case
        when mr.tier is null or btrim(mr.tier) = '' then 'Unranked'
        when upper(left(btrim(mr.tier), 1)) in ('S','A','B','C','D','F') then upper(left(btrim(mr.tier), 1))
        else btrim(mr.tier)
      end as tier,
      count(*)::numeric as n
    from "Movie Ratings" mr
    where mr.user_id = uid
      and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date))
    group by 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'tier', tier_counts.tier,
        'count', tier_counts.n::int,
        'pct', round(100.0 * tier_counts.n / nullif(rated_total::numeric, 0), 1)
      )
      order by round(100.0 * tier_counts.n / nullif(rated_total::numeric, 0), 1) desc
    ),
    '[]'::jsonb
  )
  into tier_distribution
  from tier_counts;

  -- Flat list of rated movies w/ tier (client groups into lists).
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'tier', case
          when mr.tier is null or btrim(mr.tier) = '' then 'Unranked'
          when upper(left(btrim(mr.tier), 1)) in ('S','A','B','C','D','F') then upper(left(btrim(mr.tier), 1))
          else btrim(mr.tier)
        end,
        'movie_id', mr.movie_id,
        'tmdb_id', m.tmdb_id,
        'poster_path', m.poster_path,
        'title', m.title,
        'release_year', m.release_year,
        'overall_rating', mr.overall_rating,
        'updated_at', mr.updated_at,
        'watch_date', mr.watch_date
      )
      order by
        case
          when mr.tier is null or btrim(mr.tier) = '' then 99
          when upper(left(btrim(mr.tier), 1)) = 'S' then 1
          when upper(left(btrim(mr.tier), 1)) = 'A' then 2
          when upper(left(btrim(mr.tier), 1)) = 'B' then 3
          when upper(left(btrim(mr.tier), 1)) = 'C' then 4
          when upper(left(btrim(mr.tier), 1)) = 'D' then 5
          when upper(left(btrim(mr.tier), 1)) = 'F' then 6
          else 50
        end asc,
        mr.overall_rating desc nulls last,
        mr.updated_at desc nulls last
    ),
    '[]'::jsonb
  )
  into tier_movies
  from "Movie Ratings" mr
  join "Movies" m on m.id = mr.movie_id
  where mr.user_id = uid
    and (start_date is null or (mr.watch_date >= start_date and mr.watch_date < end_date));

  return jsonb_build_object(
    'timeframe', tf,
    'rated_total', coalesce(rated_total, 0),
    'tier_distribution', coalesce(tier_distribution, '[]'::jsonb),
    'tier_movies', coalesce(tier_movies, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_dashboard_tiers(text) to authenticated;

-- Back-compat wrapper
create or replace function public.get_dashboard_tiers()
returns jsonb
language sql
as $$
  select public.get_dashboard_tiers('all_time');
$$;

grant execute on function public.get_dashboard_tiers() to authenticated;
