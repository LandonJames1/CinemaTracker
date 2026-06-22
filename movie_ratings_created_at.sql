-- Original-post timestamp on Movie Ratings.
--
-- The Feed (and the unseen-feed badges) are about "new reviews from people you
-- follow". Until now the only timestamp was updated_at, which is bumped on EVERY
-- edit (handleFormSubmit's update path in 10-logging-form.js) — so going back and
-- tweaking the rating on a movie you watched long ago resurfaced it to the top of
-- every follower's feed and re-pinged their unseen badge.
--
-- created_at freezes the moment a review was FIRST written. Edits still update the
-- content in place (and still bump updated_at), but no longer move the feed card,
-- count toward the unseen badge, or glow as "new". The feed sort + the badge
-- counters now order/filter by created_at:
--   * loadFeedItems / refreshNavBadges  (05-feed-library.js)
--   * computeUnseenBadge                (EdgeFunc / swift-api  -> REDEPLOY needed)
-- updated_at is kept (it still records the last-edit time).
--
-- Backfill: the best retroactive estimate of the original post time is updated_at
-- — EXACT for any row that was never edited, and the last-edit time otherwise
-- (slightly newer than reality, but every historical row is in the past so the
-- ordering among them is immaterial going forward). watch_date is the fallback for
-- the rare row with a NULL updated_at. The id is a random UUIDv4, so it carries no
-- chronological ordering we could have used instead.
--
-- Idempotent: safe to run repeatedly.

-- 1) Add the column NULLABLE with NO default, so existing rows stay NULL and we
--    backfill them deliberately instead of stamping them all "now()".
alter table public."Movie Ratings" add column if not exists created_at timestamptz;

-- 2) Backfill historical rows to their best original-post estimate.
update public."Movie Ratings"
set created_at = coalesce(updated_at, watch_date::timestamptz, now())
where created_at is null;

-- 3) New rows default to their insert time and the column is never null going forward.
alter table public."Movie Ratings" alter column created_at set default now();
alter table public."Movie Ratings" alter column created_at set not null;

-- 4) The feed + badges filter/sort on this column for everyone you follow, so index it.
create index if not exists movie_ratings_created_at_idx
  on public."Movie Ratings" (created_at desc);
