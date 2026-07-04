-- CinemaTracker: Games feature schema (the daily-games hub).
--
-- Three tables + one leaderboard RPC power the Games page (assets/js/25-games.js):
--
--   "Game Pool"    — a fixed, cached ~1000-movie set built ONCE from TMDB /discover
--                    (3 buckets) + enriched with real IMDb rating/votes via OMDb, so
--                    the daily games never re-hit the external APIs. Denormalized
--                    (self-contained) so games need no joins; NOT a FK to "Movies"
--                    because pool films may not be in the user catalog.
--   "Game Daily"   — the seeded puzzle per (date, game). Its payload holds the ANSWER,
--                    so this table is SERVER-ONLY (no client read) — the browser only
--                    ever sees the answer-stripped payload via the swift-api edge
--                    actions (game_today / game_guess / game_submit).
--   "Game Results" — one row per (user, date, game): drives resume, streaks, points,
--                    and the leaderboard. Clients READ only their own rows; the edge
--                    actions WRITE them with the service role so scores can't be faked.
--
-- Cheat resistance: "Game Pool" and "Game Daily" have RLS enabled with NO select
-- policy for clients — a direct client `select` returns nothing. All puzzle data
-- reaches the browser through the edge actions, which strip ratings/answers.
--
-- Run this once in the Supabase SQL Editor. Idempotent (safe to re-run).
-- After running, REDEPLOY swift-api so the game_* edge actions ship.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Game Pool — the cached ~1000-movie set (server-only)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public."Game Pool" (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  tmdb_id         bigint not null unique,
  imdb_id         text,
  title           text,
  release_year    int,
  runtime_minutes int,
  mpa_rating      text,
  poster_path     text,
  genres          text[]  not null default '{}',
  director        text,
  top_cast        text[]  not null default '{}',
  imdb_rating     numeric,               -- 0-100 %, matching "Movie External Ratings"
  imdb_votes      bigint,
  bucket          text,                  -- 'rating' | 'most_voted' | 'trending'
  popularity      numeric,
  last_used_date  date                   -- last day this film was used in a puzzle
);

create index if not exists game_pool_bucket_idx    on public."Game Pool" (bucket);
create index if not exists game_pool_lastused_idx  on public."Game Pool" (last_used_date nulls first);
create index if not exists game_pool_votes_idx     on public."Game Pool" (imdb_votes desc nulls last);

alter table public."Game Pool" enable row level security;
-- Intentionally NO select policy: server-only (service role bypasses RLS).

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Game Daily — the seeded puzzle per (date, game); payload holds the ANSWER
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public."Game Daily" (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  puzzle_date date not null,
  game        text not null,             -- 'spottle' | 'rank' | 'poster'
  payload     jsonb not null default '{}',
  unique (puzzle_date, game)
);

create index if not exists game_daily_date_idx on public."Game Daily" (puzzle_date desc);

alter table public."Game Daily" enable row level security;
-- Intentionally NO select policy: server-only (served via edge actions).

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Game Results — per-user per-day per-game outcome (streaks / points / resume)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public."Game Results" (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  puzzle_date  date not null,
  game         text not null,            -- 'spottle' | 'rank' | 'poster'
  solved       boolean not null default false,
  attempts     int not null default 0,
  score        int not null default 0,
  guesses      jsonb not null default '[]',
  completed_at timestamptz,
  unique (user_id, puzzle_date, game)
);

create index if not exists game_results_user_date_idx on public."Game Results" (user_id, puzzle_date desc);
create index if not exists game_results_game_idx      on public."Game Results" (game, puzzle_date desc);

alter table public."Game Results" enable row level security;

do $$
begin
  -- clients read ONLY their own results (for resume + local streak display)
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='Game Results' and policyname='game_results_select_own') then
    create policy game_results_select_own on public."Game Results"
      for select to authenticated using (user_id = auth.uid());
  end if;
  -- NO client insert/update policy: the edge actions write results with the
  -- service role so scores/streaks can't be fabricated for the leaderboard.
end
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) get_games_leaderboard — friends ranking for a game (SECURITY DEFINER)
-- ─────────────────────────────────────────────────────────────────────────────
-- Mirrors get_follow_leaderboard: scoped to YOU + the people you FOLLOW, so no
-- global stats leak. Reads other users' "Game Results" (which RLS would hide) but
-- returns only aggregate score + safe public profile columns.
--
-- p_game:      'spottle' | 'rank' | 'poster' | 'all'  ('all' = across every game)
-- p_timeframe: 'all_time' | 'month'
-- p_metric:    'points' (sum of score) | 'wins' (count solved) | 'streak'
--              (current consecutive-day solve streak, all_time only)
create or replace function public.get_games_leaderboard(
  p_game text default 'all',
  p_timeframe text default 'all_time',
  p_metric text default 'points'
)
returns table (
  user_id       uuid,
  username      text,
  icon          text,
  tier_name     text,
  tier_icon_url text,
  score         numeric,
  is_self       boolean
)
language sql
security definer
set search_path = public, auth
as $$
  with me as (
    select auth.uid() as uid
  ),
  scope as (
    select uid as id from me
    union
    select f.followed_id
    from public."Follows" f, me
    where f.follower_id = me.uid
  ),
  bounds as (
    select case when p_timeframe = 'month'
                then date_trunc('month', now())::date
                else null end as start_d
  ),
  filtered as (
    select gr.user_id, gr.puzzle_date, gr.game, gr.solved, gr.score
    from public."Game Results" gr
    cross join bounds b
    where (p_game = 'all' or gr.game = p_game)
      and (b.start_d is null or gr.puzzle_date >= b.start_d)
  ),
  scored as (
    select
      s.id as user_id,
      case
        when p_metric = 'wins'
          then coalesce((select count(*) from filtered f
                          where f.user_id = s.id and f.solved), 0)::numeric
        when p_metric = 'streak'
          then coalesce((
                 -- current consecutive-day solve streak = size of the most recent
                 -- "island" of distinct solved days (gaps-and-islands).
                 with days as (
                   select distinct gr.puzzle_date as d
                   from public."Game Results" gr
                   where gr.user_id = s.id
                     and gr.solved
                     and (p_game = 'all' or gr.game = p_game)
                 ),
                 islands as (
                   select d, (d - (row_number() over (order by d))::int) as grp
                   from days
                 )
                 select count(*)
                 from islands
                 where grp = (select i2.grp from islands i2 order by i2.d desc limit 1)
               ), 0)::numeric
        else  -- 'points' (default): sum of score
          coalesce((select sum(f.score) from filtered f where f.user_id = s.id), 0)::numeric
      end as score
    from scope s
  )
  select
    sc.user_id,
    u.username::text,
    u.icon::text,
    t.name::text          as tier_name,
    t.tier_icon_url::text as tier_icon_url,
    sc.score,
    (sc.user_id = (select uid from me)) as is_self
  from scored sc
  left join public."Users" u on u.id = sc.user_id
  left join public."User Tiers" t on t.id = u.tier_id
  order by sc.score desc, u.username asc nulls last;
$$;

grant execute on function public.get_games_leaderboard(text, text, text) to authenticated;

commit;
