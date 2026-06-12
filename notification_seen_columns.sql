-- Notification "last seen" timestamps on Users.
--
-- These power the unseen-count badges (in-app nav badges + the iOS PWA
-- home-screen icon badge). The front end stamps them when you view the Feed /
-- Recs (persistSeen() in 05-feed-library.js), and the Edge Function
-- (computeUnseenBadge() in EdgeFunc) reads them to compute the accurate unseen
-- count it ships in each push payload's `badge` field.
--
--   feed_seen_at  -> last time you opened the Feed tab
--   recs_seen_at  -> last time you opened the Recs list
--
-- Idempotent: safe to run repeatedly.
alter table public."Users" add column if not exists feed_seen_at timestamptz;
alter table public."Users" add column if not exists recs_seen_at timestamptz;
