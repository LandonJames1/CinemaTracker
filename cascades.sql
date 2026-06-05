-- CinemaTracker: Cascading delete rules
-- Apply in Supabase SQL editor.

-- Goal: If a user deletes a Movie Ratings row, also delete all Watch Logs
-- for that same (user_id, movie_id) pair.
--
-- Recommended approach: FK from "Watch Logs" -> "Movie Ratings" on (user_id, movie_id)
-- with ON DELETE CASCADE.
--
-- Important behavior change:
-- This will also prevent inserting Watch Logs for a (user_id, movie_id)
-- unless a Movie Ratings row exists for that (user_id, movie_id).

-- 0) Ensure Movie Ratings has the unique key needed for the FK.
create unique index if not exists movie_ratings_user_movie_unique
  on public."Movie Ratings" (user_id, movie_id);

-- 1) Preflight: find watch logs that would violate the FK (watch logs without a rating).
-- If this returns rows, you must delete/fix them before validating the constraint.
select wl.user_id, wl.movie_id, count(*) as watch_logs
from public."Watch Logs" wl
left join public."Movie Ratings" mr
  on mr.user_id = wl.user_id
 and mr.movie_id = wl.movie_id
where mr.user_id is null
group by wl.user_id, wl.movie_id
order by watch_logs desc;

-- 2) Optional cleanup: delete orphan watch logs (ONLY run if you're sure).
-- delete from public."Watch Logs" wl
-- where not exists (
--   select 1
--   from public."Movie Ratings" mr
--   where mr.user_id = wl.user_id
--     and mr.movie_id = wl.movie_id
-- );

-- 3) Add the FK (NOT VALID first, so you can clean up then validate).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'watch_logs_requires_rating'
      and conrelid = 'public."Watch Logs"'::regclass
  ) then
    alter table public."Watch Logs"
      add constraint watch_logs_requires_rating
      foreign key (user_id, movie_id)
      references public."Movie Ratings" (user_id, movie_id)
      on delete cascade
      not valid;
  end if;
end
$$;

-- 4) Validate (run after preflight is clean).
-- alter table public."Watch Logs" validate constraint watch_logs_requires_rating;
