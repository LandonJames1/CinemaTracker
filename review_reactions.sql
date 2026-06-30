-- CinemaTracker: Feed review reactions (emoji reactions on a user's review).
--
-- One row per (review, reactor, emoji). A user may react to a given review with
-- several DIFFERENT emojis, but not the same emoji twice (the unique constraint).
-- A "review" is a Movie Ratings row, so reactions key on its id.
--
-- RLS:
--   - SELECT: any authenticated user can read reactions (they're public social
--     signals — the front end shows counts + who reacted on every feed card).
--   - INSERT/DELETE: a user manages only their OWN reactions (toggle on/off).
--
-- The swift-api `notify_review_reaction` edge action reads the row with the
-- service role to push the review's author when someone reacts.
--
-- Run this once in the Supabase SQL Editor. Idempotent.

begin;

create table if not exists public."Review Reactions" (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  rating_id  uuid not null references public."Movie Ratings"(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  emoji      text not null,
  unique (rating_id, user_id, emoji)
);

create index if not exists review_reactions_rating_idx on public."Review Reactions" (rating_id);
create index if not exists review_reactions_user_idx on public."Review Reactions" (user_id);

alter table public."Review Reactions" enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='Review Reactions' and policyname='review_reactions_select_all') then
    create policy review_reactions_select_all on public."Review Reactions"
      for select to authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='Review Reactions' and policyname='review_reactions_insert_own') then
    create policy review_reactions_insert_own on public."Review Reactions"
      for insert to authenticated with check (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='Review Reactions' and policyname='review_reactions_delete_own') then
    create policy review_reactions_delete_own on public."Review Reactions"
      for delete to authenticated using (user_id = auth.uid());
  end if;
end
$$;

commit;
