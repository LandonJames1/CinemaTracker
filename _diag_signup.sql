-- DIAGNOSTIC ONLY — read-only. Run this whole thing, paste the single result.
select jsonb_pretty(jsonb_build_object(
  'settings', (
    select jsonb_agg(jsonb_build_object('value', allow_signups::text,
                                         'type',  pg_typeof(allow_signups)::text))
    from public."Settings"
  ),
  'start_tier', (
    select jsonb_build_object('id', id::text, 'points_needed', points_needed)
    from public."User Tiers" order by points_needed asc limit 1
  ),
  'users_columns', (
    select jsonb_agg(jsonb_build_object(
             'col', column_name, 'type', udt_name,
             'nullable', is_nullable, 'default', column_default))
    from information_schema.columns
    where table_schema='public' and table_name='Users'
  ),
  'privacy_enum_values', (
    select jsonb_agg(e.enumlabel)
    from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = (
      select udt_name from information_schema.columns
      where table_schema='public' and table_name='Users' and column_name='privacy_level')
  )
)) as diag;
