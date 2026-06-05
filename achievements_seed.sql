-- Seed rating milestone achievements.
-- Assumes Achievements.id has a default UUID (gen_random_uuid or uuid_generate_v4).

insert into public."Achievements" (name, description, icon_url, tier, points, is_active)
values
  ('Rated 10 Movies', 'You have rated 10 movies.', null, 'Bronze', 10, true),
  ('Rated 25 Movies', 'You have rated 25 movies.', null, 'Bronze', 25, true),
  ('Rated 50 Movies', 'You have rated 50 movies.', null, 'Silver', 50, true),
  ('Rated 100 Movies', 'You have rated 100 movies.', null, 'Gold', 100, true),
  ('Rated 150 Movies', 'You have rated 150 movies.', null, 'Gold', 150, true),
  ('Rated 250 Movies', 'You have rated 250 movies.', null, 'Platinum', 250, true),
  ('Rated 500 Movies', 'You have rated 500 movies.', null, 'Diamond', 500, true),
  ('Rated 1000 Movies', 'You have rated 1000 movies.', null, 'Legend', 1000, true)
;