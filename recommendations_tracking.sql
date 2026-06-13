-- CinemaTracker: recommendation tracking + no-duplicate-movies-per-list
-- Run this in the Supabase SQL Editor (after recs_and_profile.sql).

begin;

-- 1) No duplicate movie in the same list (applies to ALL lists, incl. "Recs").
--    First remove any existing duplicates, keeping the earliest row, then enforce.
delete from public."Movie Lists" a
using public."Movie Lists" b
where a.list_id = b.list_id
  and a.movie_id = b.movie_id
  and a.ctid > b.ctid;

create unique index if not exists movie_lists_list_movie_unique
  on public."Movie Lists" (list_id, movie_id);

-- 2) Recommendations log: who recommended what to whom.
--    Used to (a) block a sender from re-recommending the same movie to the same
--    person, and (b) detect "Recommended Again" when a different sender repeats one.
create table if not exists public."Recommendations" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id   uuid not null references auth.users(id) on delete cascade,
  movie_id     uuid not null references public."Movies"(id) on delete cascade
);

-- One recommendation per (sender, recipient, movie).
create unique index if not exists recommendations_unique
  on public."Recommendations" (from_user_id, to_user_id, movie_id);

create index if not exists recommendations_to_movie_idx
  on public."Recommendations" (to_user_id, movie_id);

alter table public."Recommendations" enable row level security;

-- Writes happen only via the Edge Function (service role bypasses RLS).
-- Allow a user to read recommendations they sent or received.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'Recommendations' and policyname = 'recommendations_select_involved'
  ) then
    create policy recommendations_select_involved on public."Recommendations"
      for select to authenticated
      using (from_user_id = auth.uid() or to_user_id = auth.uid());
  end if;
end
$$;

-- Allow a recipient to delete recommendations they received. Removing a movie
-- from your "Recs" list clears its recommendation log (clearReceivedRecommendations
-- in 04-lists.js) so a sender can recommend it to you again later.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'Recommendations' and policyname = 'recommendations_delete_recipient'
  ) then
    create policy recommendations_delete_recipient on public."Recommendations"
      for delete to authenticated
      using (to_user_id = auth.uid());
  end if;
end
$$;

commit;
