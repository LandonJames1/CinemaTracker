-- Spottle guess-card extras: box office + studio logo.
--
-- The Spottle guess card now shows a BOX OFFICE tile and a STUDIO tile with the
-- production company's LOGO image (matching the redesigned layout). Both live on
-- "Game Pool" (the server-only cached movie set) so the swift-api game actions can
-- read them for both the guess and the secret answer.
--
--   * box_office        — TMDB `revenue` (US$), captured by build_game_pool /
--                         backfill_game_pool_meta. Shown as e.g. "$710M" with a
--                         higher/lower ▲▼ arrow toward the answer.
--   * studio_logo_path  — TMDB production_companies[].logo_path for the primary
--                         studio, rendered from image.tmdb.org. Studio match is
--                         still by NAME (green tile); the logo is just the visual.
--
-- Existing pool rows are backfilled by the swift-api `backfill_game_pool_meta`
-- action (run backfill-game-pool-meta.yml). New rows get them on the normal
-- build_game_pool path. "Game Pool" is server-only (RLS, no client select), so no
-- policy change is needed.
--
-- Idempotent: safe to run more than once. Redeploy `swift-api` after running.

alter table public."Game Pool"
  add column if not exists box_office bigint;

alter table public."Game Pool"
  add column if not exists studio_logo_path text;
