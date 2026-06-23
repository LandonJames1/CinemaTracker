-- user_bio_column.sql
-- Run once (idempotent). Adds a free-text "bio" to each user's profile.
--
-- The new fun Account page (assets/js/22-account-fun.js) shows a customizable
-- open-text bio that the user can edit. Stored directly on the Users row.
--
-- RLS: no new policy needed — the existing Users self-update policy
-- (signup_system.sql) already lets a user UPDATE their own row.
--
-- Idempotent: safe to run more than once.

alter table public."Users"
  add column if not exists bio text;
