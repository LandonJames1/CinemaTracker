-- CinemaTracker: per-PUZZLE Games comparison (the LinkedIn-style "how your circle
-- did on today's game" board shown right after you finish a daily game).
--
-- This is DIFFERENT from get_games_leaderboard() (games_schema.sql), which ranks
-- cumulative points/wins/streak over all-time or a month. This RPC returns, for a
-- SPECIFIC (date, game), how the current user + their social circle performed on
-- THAT one puzzle — so the front end can rank "you solved it in 6, @jane in 7…".
--
-- Scope = YOU  +  everyone you FOLLOW  +  everyone who FOLLOWS you (your full
-- two-way network), mirroring how the rest of the app frames "your people". Only
-- users who actually PLAYED that puzzle (have a "Game Results" row) appear.
--
-- Security: SECURITY DEFINER so it can read other users' "Game Results" (which RLS
-- hides), but it returns ONLY that day's solved/attempts/score + safe public
-- profile columns for people in your network — never puzzle answers, and never
-- anyone outside your follow graph. Same safe-columns model as
-- get_follow_leaderboard / get_games_leaderboard.
--
-- Run once in the Supabase SQL Editor. Idempotent (create or replace). No edge
-- redeploy needed — the front end calls this RPC directly via supabaseClient.rpc.

begin;

create or replace function public.get_game_day_leaderboard(
  p_game text,
  p_date date
)
returns table (
  user_id       uuid,
  username      text,
  icon          text,
  tier_name     text,
  tier_icon_url text,
  solved        boolean,
  attempts      int,
  score         int,
  completed_at  timestamptz,
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
    select f.followed_id from public."Follows" f, me where f.follower_id = me.uid
    union
    select f.follower_id from public."Follows" f, me where f.followed_id = me.uid
  )
  select
    gr.user_id,
    u.username::text,
    u.icon::text,
    t.name::text          as tier_name,
    t.tier_icon_url::text as tier_icon_url,
    gr.solved,
    gr.attempts,
    gr.score,
    gr.completed_at,
    (gr.user_id = (select uid from me)) as is_self
  from scope s
  join public."Game Results" gr
    on gr.user_id = s.id
   and gr.game = p_game
   and gr.puzzle_date = p_date
  left join public."Users" u      on u.id = gr.user_id
  left join public."User Tiers" t on t.id = u.tier_id
  -- Best result first: solvers above non-solvers, then higher score (fewer
  -- guesses ⇒ higher score already), then fewer attempts, then who finished first.
  order by gr.solved desc, gr.score desc, gr.attempts asc, gr.completed_at asc nulls last;
$$;

grant execute on function public.get_game_day_leaderboard(text, date) to authenticated;

commit;
