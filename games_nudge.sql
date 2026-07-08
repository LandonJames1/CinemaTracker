-- CinemaTracker: "nudge" candidates for the daily Games full-leaderboard modal.
--
-- Returns the people the CURRENT user FOLLOWS who have NOT finished today's
-- puzzle for a given game — i.e. the folks worth nudging to go play. Used by the
-- "Nudge people who haven't played yet" section of the full-leaderboard pop-up
-- (25-games.js → loadGameNudgeCandidates). The actual nudge (push + Activity
-- inbox row) is sent by the swift-api `nudge_game` edge action.
--
-- Scope = ONLY people you follow (follower_id = auth.uid()), so it never leaks
-- anyone outside your follow graph. "Hasn't played" = no "Game Results" row for
-- (p_date, p_game) with completed_at set (someone mid-game still counts as not
-- finished, which is fine for a nudge).
--
-- Security: SECURITY DEFINER so it can see whether other users have a Game Results
-- row (RLS hides that), but it returns ONLY safe public profile columns for people
-- you already follow — never answers, scores, or anyone else.
--
-- Run once in the Supabase SQL Editor. Idempotent (create or replace). No edge
-- redeploy needed for THIS function — the front end calls it directly via
-- supabaseClient.rpc. (The `nudge_game` edge action, which sends the reminder, DOES
-- ship with the swift-api function — redeploy that.)

begin;

create or replace function public.get_game_nudge_candidates(
  p_game text,
  p_date date
)
returns table (
  user_id  uuid,
  username text,
  icon     text
)
language sql
security definer
set search_path = public, auth
as $$
  with me as (
    select auth.uid() as uid
  )
  select
    u.id            as user_id,
    u.username::text,
    u.icon::text
  from public."Follows" f
  join me on f.follower_id = me.uid
  join public."Users" u on u.id = f.followed_id
  where not exists (
    select 1
    from public."Game Results" gr
    where gr.user_id = f.followed_id
      and gr.game = p_game
      and gr.puzzle_date = p_date
      and gr.completed_at is not null
  )
  order by lower(u.username::text) asc nulls last;
$$;

grant execute on function public.get_game_nudge_candidates(text, date) to authenticated;

commit;
