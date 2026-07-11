-- home_recommendations.sql — precomputed "You Might Like" home strip decks.
-- Run ONCE (idempotent). Backs the Home page "You Might Like" strip (08-search-trending.js):
-- instead of computing the taste-ranked deck LIVE on every first Home visit (7+ sequential
-- TMDB round trips in the swift-api `swipe_deck` action — slow), a daily cron
-- (`build_home_recs` → .github/workflows/refresh-home-recs.yml) precomputes each user's deck
-- into this table, and the client just READS one row (fast). One row per user.
--
-- After running this: redeploy `swift-api` (ships the `build_home_recs` action + the
-- `computeSwipeDeck` refactor) and add/run .github/workflows/refresh-home-recs.yml once to
-- backfill existing users.

create table if not exists public."Home Recommendations" (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  computed_at timestamptz not null default now(),
  cards       jsonb       not null default '[]'::jsonb
);

alter table public."Home Recommendations" enable row level security;

-- A user may READ only their own precomputed deck. Writes are done server-side by the
-- `build_home_recs` cron with the service role (which bypasses RLS), so there is
-- deliberately NO client insert/update/delete policy.
drop policy if exists "home_recs_select_own" on public."Home Recommendations";
create policy "home_recs_select_own"
  on public."Home Recommendations"
  for select
  using (auth.uid() = user_id);
