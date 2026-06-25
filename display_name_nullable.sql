-- display_name_nullable.sql  (run once, idempotent)
--
-- Display names were removed from the app: signup collects a username only, and
-- display_name is no longer editable anywhere in the UI. But the Users.display_name
-- column was left as NOT NULL from before that change, so saving a profile (which
-- sends only the username) failed with:
--   "null value in column \"display_name\" of relation \"Users\" violates not-null constraint"
--
-- This makes display_name OPTIONAL so the schema matches the app's design. The column
-- is KEPT (it still serves as a legacy nav-name fallback when a value happens to exist);
-- it may simply be null now. The signup trigger's coalesce(display_name, username) keeps
-- working unchanged.

alter table public."Users" alter column display_name drop not null;
