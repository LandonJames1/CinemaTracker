-- Let deleting an Achievements row auto-delete ONLY its User Achievements rows.
-- Run once in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- How it works: a foreign key User Achievements.achievement_id -> Achievements.id
-- with ON DELETE CASCADE. When you delete an achievement, Postgres removes the
-- matching User Achievements rows and nothing else. Your existing triggers then
-- fire automatically:
--   * user_achievement_change  -> recalc_user_tier for each affected user
--   * achievements_change_recalc_all -> recalc_all_user_tiers
-- so everyone's achievement_points / tier_id are corrected after the delete.
-- It does NOT touch Movies, Ratings, Watch Logs, or any other table.

-- 1) Remove orphan User Achievements rows (point at a now-missing achievement),
--    otherwise adding the foreign key would fail. These are dead rows anyway.
delete from public."User Achievements" ua
where ua.achievement_id is not null
  and not exists (
    select 1 from public."Achievements" a where a.id = ua.achievement_id
  );

-- 2) Drop whatever foreign key currently links achievement_id -> Achievements
--    (it may exist without cascade, or under an auto-generated name).
do $$
declare
    c text;
begin
    for c in
        select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace ns on ns.oid = rel.relnamespace
        where con.contype = 'f'
          and ns.nspname = 'public'
          and rel.relname = 'User Achievements'
          and con.confrelid = 'public."Achievements"'::regclass
    loop
        execute format('alter table public.%I drop constraint %I', 'User Achievements', c);
    end loop;
end $$;

-- 3) Re-add it WITH on delete cascade.
alter table public."User Achievements"
    add constraint "User Achievements_achievement_id_fkey"
    foreign key (achievement_id)
    references public."Achievements"(id)
    on delete cascade;

-- After this, simply:  delete from "Achievements" where id = '<uuid>';
-- (or delete by name) and the User Achievements rows go with it; tiers recalc.
