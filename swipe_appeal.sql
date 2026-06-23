-- swipe_appeal.sql
-- Run once (idempotent). Phase 3 of the Discover swipe deck: turn swipes into a
-- WEAK "appeal" signal that nudges the taste profile (kept separate from the
-- ratings-based affinity, which measures post-watch quality — swipes measure
-- pre-watch interest and are mood-driven, so they stay a secondary input).
--
-- (1) swipes.genres — the card's genre names, stored at swipe time for BOTH
--     directions. We need left-swiped movies' genres to compute a genre's
--     right-swipe RATE (right / (right+left)), and left-swiped movies never enter
--     the catalog, so the genres can't be recovered later — hence we store them now.
-- (2) Taste Profiles.swipe_genre_affinity_json — per-genre appeal "lift" computed by
--     taste_profile_edge.js: how much more (or less) you right-swipe a genre vs your
--     overall right-swipe rate. Shape (keyed by lowercase genre name):
--       { "action": { name, right, total, rate, lift, aff } }
--       lift = shrunk right-rate − overall right-rate (clamped); aff = lift*100 (points)
--     Blended into predictTasteScore at a low weight (well under genre affinity).
--
-- Right-swipes are the signal; left-swipes only contribute to the denominator
-- (they're "not now", too noisy to read as dislike).

alter table public."swipes"
  add column if not exists genres text[];

alter table public."Taste Profiles"
  add column if not exists swipe_genre_affinity_json jsonb;
