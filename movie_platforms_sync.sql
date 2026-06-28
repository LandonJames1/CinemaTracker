-- Movies.platforms_synced_at — staleness marker for the daily watch-options refresh.
--
-- "Watch options" (streaming platforms) live in the "Movie Platforms" join table,
-- which has NO trustworthy per-movie timestamp: a movie with zero providers has no
-- rows there at all, so we can't tell when it was last checked. This column on the
-- shared "Movies" record is the marker instead.
--
-- Written `now()` by EdgeFunc's syncMovieWatchPlatforms on every successful provider
-- sync (the normal log/save path + the new cron), so freshly-touched movies read as
-- "fresh" and the cron always rotates to the genuinely stalest ones.
--
-- The swift-api `refresh_list_watch_platforms` cron action selects the movies in users'
-- lists ORDER BY platforms_synced_at asc NULLS FIRST, a batch per day, so the whole set
-- of list movies rotates through over time without blowing the TMDB rate limit.
--
-- No RLS change — "Movies" is shared (no user_id); the existing read policy covers it.
-- Idempotent: safe to run more than once.

alter table public."Movies"
  add column if not exists platforms_synced_at timestamptz;

-- Speeds up the cron's "stalest list movies first" ordering.
create index if not exists movies_platforms_synced_at_idx
  on public."Movies" (platforms_synced_at nulls first);
