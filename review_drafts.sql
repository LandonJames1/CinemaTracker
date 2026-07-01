-- review_drafts.sql
-- Run once (idempotent). Backs the "Rate Later" / To Rate feature — a server-side,
-- cross-device store for IN-PROGRESS reviews (the front end's old localStorage
-- draft, promoted to the server). One row per (user, movie); every rating/watch
-- field is OPTIONAL because a draft can be at ANY stage of being filled out:
--   • only watch_date + watch_method (the quick "Rate Later" capture), OR
--   • only tier / overall / notes / etc. (started the form, not the watch info), OR
--   • any mix.
--
-- These rows are DELIBERATELY separate from "Movie Ratings" so a draft NEVER leaks
-- into the feed / My Movies / dashboard / achievements / taste / leaderboard — all
-- of those read only real (posted) ratings. When the user finishes a review, the
-- normal save writes the real "Movie Ratings" (+ "Watch Logs") row and DELETES the
-- matching draft here.
--
-- Keyed by tmdb_id (unique per user) since that's the stable movie identity the
-- form always has; movie_id (our catalog uuid) is stored when known but is not the
-- key (a movie may not be in the catalog yet). Display columns (title/year/poster)
-- are denormalized so the To Rate tab renders without any extra joins.
--
-- RLS: users only ever see/write their OWN drafts, so the client reads/writes
-- directly. The swift-api `notify_pending_reviews` cron action reads this table
-- with the service role to send the once-daily "you have N to rate" reminder.

create table if not exists public."Review Drafts" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tmdb_id bigint not null,
  movie_id uuid references public."Movies"(id) on delete set null,
  title text,
  release_year integer,
  poster_path text,
  watch_date date,
  watch_method text,
  tier text,
  overall_rating numeric,
  acting_rating numeric,
  pacing_rating numeric,
  sound_rating numeric,
  imagery_rating numeric,
  plot_rating numeric,
  dialogue_rating numeric,
  notes text,
  fav_quote text,
  last_reminded_at timestamptz,
  unique (user_id, tmdb_id)
);

create index if not exists review_drafts_user_idx on public."Review Drafts"(user_id);
create index if not exists review_drafts_updated_idx on public."Review Drafts"(updated_at);

alter table public."Review Drafts" enable row level security;

drop policy if exists "review_drafts_select_own" on public."Review Drafts";
create policy "review_drafts_select_own" on public."Review Drafts"
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "review_drafts_insert_own" on public."Review Drafts";
create policy "review_drafts_insert_own" on public."Review Drafts"
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "review_drafts_update_own" on public."Review Drafts";
create policy "review_drafts_update_own" on public."Review Drafts"
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "review_drafts_delete_own" on public."Review Drafts";
create policy "review_drafts_delete_own" on public."Review Drafts"
  for delete to authenticated using (auth.uid() = user_id);
