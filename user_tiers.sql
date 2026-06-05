-- User tiers: seed data, Users columns, triggers, and backfill.

-- 0) Ensure name is unique so ON CONFLICT works
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_tiers_name_unique'
      and conrelid = 'public."User Tiers"'::regclass
  ) then
    alter table public."User Tiers"
      add constraint user_tiers_name_unique unique (name);
  end if;
end
$$;

-- 1) Seed tiers (min points thresholds)
insert into public."User Tiers" (name, tier_icon_url, points_needed)
values
  ('Extra', null, 0),
  ('Supporting Cast', null, 100),
  ('Co-Star', null, 250),
  ('Lead', null, 500),
  ('Box Office Icon', null, 750),
  ('Oscar Nominee', null, 1000),
  ('Oscar Winner', null, 1500)
on conflict (name) do update
set
  tier_icon_url = excluded.tier_icon_url,
  points_needed = excluded.points_needed;

-- 2) Users columns
alter table public."Users"
  add column if not exists achievement_points int not null default 0,
  add column if not exists tier_id uuid references public."User Tiers"(id);

-- 3) Recalc function
create or replace function public.recalc_user_achievement_totals(p_user_id uuid)
returns void
language plpgsql
as $$
declare
  total_points int := 0;
  target_tier_id uuid := null;
begin
  if p_user_id is null then
    return;
  end if;

  select coalesce(sum(a.points), 0)
    into total_points
  from public."User Achievements" ua
  join public."Achievements" a on a.id = ua.achievement_id
  where ua.user_id = p_user_id;

  select ut.id
    into target_tier_id
  from public."User Tiers" ut
  where ut.points_needed <= total_points
  order by ut.points_needed desc
  limit 1;

  update public."Users"
  set achievement_points = total_points,
      tier_id = target_tier_id
  where id = p_user_id;
end;
$$;

-- 4) Trigger to keep totals in sync
create or replace function public.trg_recalc_user_achievement_totals()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalc_user_achievement_totals(old.user_id);
  elsif tg_op = 'UPDATE' then
    perform public.recalc_user_achievement_totals(new.user_id);
    if old.user_id is distinct from new.user_id then
      perform public.recalc_user_achievement_totals(old.user_id);
    end if;
  else
    perform public.recalc_user_achievement_totals(new.user_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_recalc_user_achievement_totals on public."User Achievements";
create trigger trg_recalc_user_achievement_totals
after insert or update or delete on public."User Achievements"
for each row execute function public.trg_recalc_user_achievement_totals();

-- 5) Backfill all users
with totals as (
  select u.id as user_id, coalesce(sum(a.points), 0)::int as total_points
  from public."Users" u
  left join public."User Achievements" ua on ua.user_id = u.id
  left join public."Achievements" a on a.id = ua.achievement_id
  group by u.id
), tiers as (
  select
    t.user_id,
    t.total_points,
    (
      select ut.id
      from public."User Tiers" ut
      where ut.points_needed <= t.total_points
      order by ut.points_needed desc
      limit 1
    ) as tier_id
  from totals t
)
update public."Users" u
set achievement_points = t.total_points,
    tier_id = t.tier_id
from tiers t
where u.id = t.user_id;
