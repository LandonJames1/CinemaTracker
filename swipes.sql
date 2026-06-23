-- swipes.sql
-- Run once (idempotent). Backs the Discover swipe deck (21-swipe-deck.js).
--
-- One row per (user, movie) the user has swiped on. Keyed by tmdb_id (not our
-- Movies.id) because most deck candidates aren't in our catalog yet — only
-- RIGHT-swiped movies get added to the catalog (via the Bucket List add flow).
--   direction 'right' = "I'd watch this" -> added to Bucket List (permanent skip in deck)
--   direction 'left'  = "not now"        -> soft-skip; eligible to resurface after 30 days
-- Re-swiping the same movie updates the row (so an old left can flip to right).
--
-- RLS: users only ever see/write their own swipes, so the client inserts directly
-- (no edge function needed for recording).

create table if not exists public."swipes" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tmdb_id bigint not null,
  direction text not null check (direction in ('left', 'right')),
  unique (user_id, tmdb_id)
);

create index if not exists swipes_user_idx on public."swipes"(user_id);

alter table public."swipes" enable row level security;

drop policy if exists "swipes_select_own" on public."swipes";
create policy "swipes_select_own" on public."swipes"
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "swipes_insert_own" on public."swipes";
create policy "swipes_insert_own" on public."swipes"
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "swipes_update_own" on public."swipes";
create policy "swipes_update_own" on public."swipes"
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "swipes_delete_own" on public."swipes";
create policy "swipes_delete_own" on public."swipes"
  for delete to authenticated using (auth.uid() = user_id);
