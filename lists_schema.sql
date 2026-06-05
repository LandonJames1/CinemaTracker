-- CinemaTracker: Lists + Movie Lists join table
-- Apply in Supabase SQL editor.

-- 1) Lists table
create table if not exists public."Lists" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  list_name text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  constraint lists_name_nonempty check (length(btrim(list_name)) > 0),
  constraint lists_name_len check (length(list_name) <= 80)
);

-- One list name per user (so Bucket List is unique per user)
create unique index if not exists lists_user_name_unique
  on public."Lists" (user_id, list_name);

alter table public."Lists" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'Lists' and policyname = 'lists_select_own'
  ) then
    create policy lists_select_own on public."Lists"
      for select to authenticated
      using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'Lists' and policyname = 'lists_insert_own'
  ) then
    create policy lists_insert_own on public."Lists"
      for insert to authenticated
      with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'Lists' and policyname = 'lists_update_own'
  ) then
    create policy lists_update_own on public."Lists"
      for update to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'Lists' and policyname = 'lists_delete_own'
  ) then
    create policy lists_delete_own on public."Lists"
      for delete to authenticated
      using (user_id = auth.uid());
  end if;
end
$$;


-- 2) Movie Lists join table
create table if not exists public."Movie Lists" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null references public."Lists"(id) on delete cascade,
  movie_id uuid not null references public."Movies"(id) on delete cascade
);

-- Prevent duplicates
create unique index if not exists movie_lists_list_movie_unique
  on public."Movie Lists" (list_id, movie_id);

-- Helpful for list browsing
create index if not exists movie_lists_user_list_idx
  on public."Movie Lists" (user_id, list_id);

alter table public."Movie Lists" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'Movie Lists' and policyname = 'movie_lists_select_own'
  ) then
    create policy movie_lists_select_own on public."Movie Lists"
      for select to authenticated
      using (
        user_id = auth.uid()
        and exists (
          select 1 from public."Lists" l
          where l.id = "Movie Lists".list_id
            and l.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'Movie Lists' and policyname = 'movie_lists_insert_own'
  ) then
    create policy movie_lists_insert_own on public."Movie Lists"
      for insert to authenticated
      with check (
        user_id = auth.uid()
        and exists (
          select 1 from public."Lists" l
          where l.id = list_id
            and l.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'Movie Lists' and policyname = 'movie_lists_delete_own'
  ) then
    create policy movie_lists_delete_own on public."Movie Lists"
      for delete to authenticated
      using (
        user_id = auth.uid()
        and exists (
          select 1 from public."Lists" l
          where l.id = "Movie Lists".list_id
            and l.user_id = auth.uid()
        )
      );
  end if;
end
$$;


-- 3) Optional helper: bucket list name constant
-- (No trigger here; the app will ensure "Bucket List" exists on login.)
