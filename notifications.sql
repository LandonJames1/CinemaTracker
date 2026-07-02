-- notifications.sql — the in-app Activity inbox (bell icon + dropdown/sheet).
-- RUN ONCE, idempotent.
--
-- Backs 24-notifications.js. Every event that already sends a Web Push (new
-- review from a follow, new follower, recommendation received, review reaction,
-- shared-list add, "your rec got watched") now ALSO writes a row here from the
-- swift-api Edge Function (see recordNotifications() in EdgeFunc) — so the inbox
-- works even when push is disabled, and keeps a browsable history + per-item
-- read state.
--
-- After running this, REDEPLOY swift-api so the edge inserts ship.
--
-- Rows are inserted server-side with the service role (bypasses RLS). Clients
-- only READ their own rows and UPDATE read_at (mark read) on their own rows.

create table if not exists public."Notifications" (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id    uuid not null references auth.users(id) on delete cascade, -- recipient
  actor_id   uuid,        -- who caused it (null for system/reminder types)
  type       text not null, -- new_review | new_follower | recommendation | review_reaction | rec_reviewed | list_add
  title      text,        -- short heading (denormalized by the edge fn)
  body       text,        -- the human-readable line (denormalized)
  url        text,        -- deep-link hash, reuses handleNotificationRoute()
  meta       jsonb,       -- optional extras (movie_id / list_id / emoji …)
  read_at    timestamptz  -- null = unread
);

create index if not exists notifications_user_created_idx
  on public."Notifications" (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public."Notifications" (user_id) where read_at is null;

alter table public."Notifications" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'Notifications'
      and policyname = 'notifications_select_own'
  ) then
    create policy notifications_select_own on public."Notifications"
      for select to authenticated using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'Notifications'
      and policyname = 'notifications_update_own'
  ) then
    -- Lets a user flip read_at on their own rows (mark read / mark all read).
    create policy notifications_update_own on public."Notifications"
      for update to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- One-time backfill so the inbox isn't empty on first open. We can reconstruct
-- three event types from existing tables (follows, recommendations received,
-- reactions to your reviews). Backfilled rows are marked READ (read_at =
-- created_at) so they show as history without inflating the unread bell count.
-- Guarded on an empty table so re-running the migration never duplicates.
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public."Notifications") = 0 then

    -- New followers.
    insert into public."Notifications"
      (user_id, actor_id, type, title, body, url, read_at, created_at)
    select f.followed_id, f.follower_id, 'new_follower',
           'New follower',
           coalesce(nullif('@' || u.username, '@'), u.display_name, 'Someone')
             || ' started following you',
           '/#user=' || f.follower_id,
           f.created_at, f.created_at
    from public."Follows" f
    left join public."Users" u on u.id = f.follower_id
    where f.followed_id is not null and f.follower_id is not null
      and f.followed_id <> f.follower_id;

    -- Recommendations received.
    insert into public."Notifications"
      (user_id, actor_id, type, title, body, url, meta, read_at, created_at)
    select r.to_user_id, r.from_user_id, 'recommendation',
           'New recommendation',
           coalesce(nullif('@' || u.username, '@'), u.display_name, 'Someone')
             || ' recommended you '
             || coalesce('"' || m.title || '"', 'a movie'),
           '/#recs',
           jsonb_build_object('movie_id', r.movie_id),
           r.created_at, r.created_at
    from public."Recommendations" r
    left join public."Users" u  on u.id = r.from_user_id
    left join public."Movies" m on m.id = r.movie_id
    where r.to_user_id is not null and r.from_user_id is not null;

    -- Reactions to your reviews (only if the Review Reactions table exists).
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'Review Reactions'
    ) then
      insert into public."Notifications"
        (user_id, actor_id, type, title, body, url, meta, read_at, created_at)
      select mr.user_id, rr.user_id, 'review_reaction',
             'New reaction',
             coalesce(nullif('@' || u.username, '@'), u.display_name, 'Someone')
               || ' reacted ' || rr.emoji || ' to your review'
               || coalesce(' of "' || m.title || '"', ''),
             '/#review=' || mr.user_id || ':' || mr.movie_id,
             jsonb_build_object('emoji', rr.emoji, 'rating_id', rr.rating_id),
             rr.created_at, rr.created_at
      from public."Review Reactions" rr
      join public."Movie Ratings" mr on mr.id = rr.rating_id
      left join public."Users" u  on u.id = rr.user_id
      left join public."Movies" m on m.id = mr.movie_id
      where rr.user_id is not null and mr.user_id is not null
        and rr.user_id <> mr.user_id;
    end if;

  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Backfill "a person you follow posted a review" (type = new_review) from
-- recent reviews. This is its OWN guarded block (not part of the empty-table
-- guard above) so that if you already ran an earlier version of this migration,
-- re-running it now populates follow-review notifications. Guarded on "no
-- new_review rows exist yet" so it can't duplicate once the edge function (or a
-- prior run) has started writing them. Bounded to the last 120 days to stay
-- relevant + sane in size, and marked READ so old activity doesn't blow up the
-- unread bell count (genuinely new reviews going forward arrive unread).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public."Notifications" where type = 'new_review') then
    insert into public."Notifications"
      (user_id, actor_id, type, title, body, url, meta, read_at, created_at)
    select f.follower_id, mr.user_id, 'new_review',
           'New review',
           coalesce(nullif('@' || u.username, '@'), u.display_name, 'Someone')
             || ' reviewed '
             || coalesce('"' || m.title
                  || coalesce(' (' || m.release_year || ')', '') || '"', 'a movie'),
           '/#review=' || mr.user_id || ':' || mr.movie_id,
           jsonb_build_object('movie_id', mr.movie_id),
           mr.created_at, mr.created_at
    from public."Movie Ratings" mr
    join public."Follows" f on f.followed_id = mr.user_id
    left join public."Users" u  on u.id = mr.user_id
    left join public."Movies" m on m.id = mr.movie_id
    where mr.user_id is not null
      and f.follower_id is not null
      and f.follower_id <> mr.user_id
      and mr.created_at > now() - interval '120 days';
  end if;
end $$;
