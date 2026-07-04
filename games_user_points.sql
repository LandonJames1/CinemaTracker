-- games_user_points.sql — cumulative daily-games points, tracked on the user row.
-- Run ONCE (idempotent). Adds Users.game_points: a lifetime running total of the
-- points a user has earned across all daily games (spottle / rank / poster), so
-- points can be tracked over time independent of the per-day "Game Results" rows.
--
-- The swift-api game_guess / game_submit edge actions increment this on completion
-- (see addUserGamePoints in EdgeFunc). Scoring:
--   rank    : 2 points per movie placed in its correct slot.
--   spottle : 25 max, −2 per extra guess, −1 if the hint was used.
--   poster  : 12 max, −2 per extra guess.
--
-- REDEPLOY swift-api after running this so the edge actions that write the column
-- (and return it from game_today) ship.

alter table public."Users"
  add column if not exists game_points integer not null default 0;

-- One-time backfill from existing Game Results so returning players don't start at 0.
-- Uses the CURRENT scoring formulas (recomputed from attempts/solved/guesses) rather
-- than the historical stored score, so past plays count under the new point system.
update public."Users" u
set game_points = coalesce(sub.total, 0)
from (
  select
    gr.user_id,
    sum(
      case
        when gr.game = 'rank'
          then coalesce(gr.score, 0) * 2  -- old rank score was 1 per correct slot; now 2
        when gr.solved and gr.game = 'spottle'
          then greatest(1, 25 - 2 * (greatest(1, gr.attempts) - 1))
        when gr.solved and gr.game = 'poster'
          then greatest(1, 12 - 2 * (greatest(1, gr.attempts) - 1))
        else 0
      end
    ) as total
  from public."Game Results" gr
  group by gr.user_id
) sub
where u.id = sub.user_id;
