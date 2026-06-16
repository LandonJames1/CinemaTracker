-- Lists cover images (optional, per-list square photo a user uploads).
--
-- Mirrors the Users.icon approach: the image is stored directly as a small
-- (~256px square) JPEG **data URL** in a text column — no Storage bucket. The
-- front end (04-lists.js) center-crops + downscales the chosen photo client-side
-- and upserts it here. When `cover` is null the app falls back to a 2x2 collage
-- of the list's movie posters, so this column is purely additive/optional.
--
-- RLS: no new policy needed — the existing `lists_update_own` policy
-- (lists_schema.sql) already lets a user UPDATE their own Lists rows.
--
-- Idempotent: safe to run more than once.

alter table public."Lists"
  add column if not exists cover text;
