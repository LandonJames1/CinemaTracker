-- movie_keywords.sql
-- Run once (idempotent). Adds theme-level movie metadata: TMDB "keywords"
-- (e.g. "heist", "dystopia", "time travel", "slow burn") — the #2 taste predictor
-- after genre. Mirrors the Genres / Movie Genres structure.
--
-- Ingestion: EdgeFunc (swift-api) writes these with the service role —
--   * on every movie save (append_to_response=keywords on the TMDB details fetch), and
--   * via the cron-gated `backfill_movie_keywords` action for the existing catalog.
-- Consumption: taste_profile_edge.js learns per-keyword affinity (shrunk toward the
--   user's mean, keyed by keyword name) into Taste Profiles.keyword_affinity_json,
--   which feeds the AI Picks rerank context + the future per-movie predictor.

create table if not exists public."Keywords" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tmdb_keyword_id bigint not null unique,
  name text not null
);

create table if not exists public."Movie Keywords" (
  movie_id uuid not null references public."Movies"(id) on delete cascade,
  keyword_id uuid not null references public."Keywords"(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (movie_id, keyword_id)
);

create index if not exists movie_keywords_movie_id_idx on public."Movie Keywords"(movie_id);
create index if not exists movie_keywords_keyword_id_idx on public."Movie Keywords"(keyword_id);

-- Non-sensitive movie metadata: clients may read; only the service role writes
-- (it bypasses RLS, so no write policy is needed).
alter table public."Keywords" enable row level security;
alter table public."Movie Keywords" enable row level security;

drop policy if exists "Keywords read" on public."Keywords";
create policy "Keywords read" on public."Keywords"
  for select to anon, authenticated using (true);

drop policy if exists "Movie Keywords read" on public."Movie Keywords";
create policy "Movie Keywords read" on public."Movie Keywords"
  for select to anon, authenticated using (true);

-- Per-keyword affinity for each user (shrunk toward their mean; keyed by keyword
-- NAME). Same shape as genre_affinity_json: { "heist": { avg, count, shrunk, aff } }.
alter table public."Taste Profiles"
  add column if not exists keyword_affinity_json jsonb;
