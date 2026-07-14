-- ============================================================================
-- Rec Pool — the SHARED candidate pool behind "You Might Like" + Discover.
--
-- WHY THIS EXISTS
-- The recommendation deck used to be built by crawling TMDB /discover *per user,
-- at request time* (6 sequential TMDB calls per batch, up to 5-6 batches deep).
-- But the candidate set is essentially the SAME for everybody — only the SCORING
-- and the EXCLUSIONS are personal. So we were paying a per-user TMDB crawl for a
-- shared result: the nightly build_home_recs cron did ~36 TMDB calls x 150 users
-- in ONE edge invocation (it timed out), and any user it missed fell through to a
-- slow, failure-prone live crawl on every Home visit.
--
-- Now ONE cron (`build_rec_pool`, .github/workflows/build-rec-pool.yml) crawls
-- TMDB once a day for EVERYONE into this table, and a user's deck becomes a pure
-- DB read + in-memory scoring with ZERO external API calls on the read path.
--
-- Every column here comes FREE in the TMDB /discover response — no OMDb call, no
-- per-movie TMDB lookup. That's what makes a ~3-5k movie pool cost only ~150 TMDB
-- calls per day in total.
--
-- Idempotent: safe to re-run.
-- Run once, then REDEPLOY `swift-api`, then run build-rec-pool.yml to fill it.
-- ============================================================================

create table if not exists public."Rec Pool" (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  tmdb_id           bigint not null unique,
  title             text   not null,
  release_year      integer,
  release_date      date,
  poster_path       text,
  genres            text[] not null default '{}',   -- genre NAMES (predictTasteScore keys on names)
  original_language text,
  vote_average      numeric,                        -- TMDB crowd score → predictTasteScore's crowd anchor
  vote_count        bigint,
  popularity        numeric,
  overview          text
);

-- Ranked reads (the deck pulls the pool ordered by vote_count) + genre filtering.
create index if not exists rec_pool_vote_count_idx on public."Rec Pool" (vote_count desc nulls last);
create index if not exists rec_pool_genres_idx     on public."Rec Pool" using gin (genres);
create index if not exists rec_pool_year_idx       on public."Rec Pool" (release_year);

-- SERVER-ONLY, exactly like "Game Pool": RLS on with NO policies, so no client can
-- read it. The service role bypasses RLS, so the swift-api edge function (which is
-- the only thing that touches this table) still works.
alter table public."Rec Pool" enable row level security;
