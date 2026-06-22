-- taste_genre_affinity.sql
-- Run once (idempotent). Adds the genre-affinity column to Taste Profiles.
--
-- The taste-profile computer (taste_profile_edge.js, deployed as `swift-responder`)
-- now learns a per-genre affinity for each user: how much they rate each genre
-- ABOVE/BELOW their personal baseline, with Bayesian shrinkage toward the user's
-- mean so a single 95-rated film in a genre doesn't create a fake "favorite".
--
-- Shape of genre_affinity_json (keyed by genre NAME so the AI Picks predictor can
-- match TMDB candidate genres directly):
--   { "Science Fiction": { "avg": 88.0, "count": 12, "shrunk": 86.4, "aff": 7.2 }, ... }
--     avg    = raw mean of the user's overall ratings for movies in this genre
--     count  = how many rated movies in this genre
--     shrunk = avg pulled toward the user's mean_overall by SHRINK_K pseudo-counts
--     aff    = shrunk - mean_overall  (positive = likes more than baseline)
--
-- Nothing else changes; existing rows get NULL until the profile is recomputed
-- (which happens automatically on the next AI Picks run / taste recompute).

alter table public."Taste Profiles"
  add column if not exists genre_affinity_json jsonb;
