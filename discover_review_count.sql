-- IMDb vote COUNT (number of ratings) + the Discover review-count threshold.
--
-- 1) "Movie External Ratings".votes — the number of IMDb votes a film has, pulled
--    from OMDb's `imdbVotes` in the SAME call that already fetches the IMDb rating
--    (EdgeFunc fetchOmdbImdbRatingPercent). Stored on the existing imdb row, so the
--    daily refresh_imdb_ratings cron refreshes it for free (oldest-first rotation).
--    No RLS change — this table is shared (no user_id); the existing read policy
--    covers the new column.
--
-- 2) Settings.discover_min_imdb_votes — admin-tunable threshold (default 25,000).
--    The swift-api `swipe_deck` action gives catalog movies with at least this many
--    stored IMDb votes a moderate ranking boost; the Settings-page admin panel
--    edits it. The existing Settings RLS already lets the admin UPDATE it.
--
-- Idempotent: safe to run more than once.

alter table public."Movie External Ratings"
  add column if not exists votes bigint;

alter table public."Settings"
  add column if not exists discover_min_imdb_votes integer;

update public."Settings"
  set discover_min_imdb_votes = 25000
  where discover_min_imdb_votes is null;
