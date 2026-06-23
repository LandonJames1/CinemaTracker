-- follow_rated_movies.sql
-- Run once (idempotent). Powers the Discover swipe deck's Phase 2:
--   (1) a candidate source = movies the people you FOLLOW rated highly, and
--   (2) "social proof" on cards = which of your follows rated a movie 90+.
--
-- SECURITY DEFINER (like get_follow_leaderboard) so it can read other users'
-- Movie Ratings (which RLS hides) but ONLY for people the caller follows, and it
-- returns ONLY safe public profile columns + the overall score — no leakage of
-- anyone's full ratings/feed, and privacy_level never has to be consulted.
--
-- Returns one row per (movie, follower-you-follow) the caller follows who rated it
-- >= p_min_overall. The swift-api `swipe_deck` action groups these by tmdb_id.

create or replace function public.get_follow_rated_movies(p_min_overall int default 70)
returns table (
  tmdb_id bigint,
  title text,
  release_year int,
  poster_path text,
  genres text[],
  rater_id uuid,
  rater_username text,
  rater_icon text,
  overall_rating numeric
)
language sql
security definer
set search_path = public
as $$
  select
    m.tmdb_id,
    m.title,
    m.release_year,
    m.poster_path,
    coalesce(
      (select array_agg(g.name)
         from "Movie Genres" mg
         join "Genres" g on g.id = mg.genre_id
        where mg.movie_id = m.id),
      '{}'::text[]
    ) as genres,
    u.id as rater_id,
    u.username as rater_username,
    u.icon as rater_icon,
    r.overall_rating
  from "Follows" f
  join "Movie Ratings" r on r.user_id = f.followed_id
  join "Movies" m on m.id = r.movie_id
  join "Users" u on u.id = f.followed_id
  where f.follower_id = auth.uid()
    and r.overall_rating >= p_min_overall
    and m.tmdb_id is not null;
$$;

grant execute on function public.get_follow_rated_movies(int) to authenticated;
