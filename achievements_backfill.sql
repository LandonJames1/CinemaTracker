-- Backfill rating milestone achievements for all users based on existing ratings.
-- Assumes:
--   - "Movie Ratings" has columns: user_id, movie_id
--   - "Achievements" has unique names matching the milestone names
--   - "User Achievements" has unique (user_id, achievement_id)

with rating_counts as (
  select user_id, count(*) as rated_count
  from public."Movie Ratings"
  group by user_id
),
milestones as (
  select 10 as threshold, 'Rated 10 Movies' as name
  union all select 25, 'Rated 25 Movies'
  union all select 50, 'Rated 50 Movies'
  union all select 100, 'Rated 100 Movies'
  union all select 150, 'Rated 150 Movies'
  union all select 250, 'Rated 250 Movies'
  union all select 500, 'Rated 500 Movies'
  union all select 1000, 'Rated 1000 Movies'
),
eligible as (
  select rc.user_id, a.id as achievement_id
  from rating_counts rc
  join milestones m on rc.rated_count >= m.threshold
  join public."Achievements" a on a.name = m.name
)
insert into public."User Achievements" (user_id, achievement_id)
select user_id, achievement_id
from eligible
on conflict (user_id, achievement_id) do nothing;
