-- demo_account_seed.sql
-- Seeds the DEDICATED demo/guest account so the guest experience is populated
-- (instead of pointing DEMO_USER_ID at the owner's real account).
--
-- ORDER OF OPERATIONS:
--   1) Create the demo account FIRST — either:
--        • in the app: Log out → Sign up (e.g. username "demo",
--          email demo@cinematracker.app), which auto-provisions its Users row +
--          Bucket List + Recs lists; OR
--        • Supabase dashboard → Authentication → Users → Add user.
--   2) Set v_demo_email below to that account's email.
--   3) Run this whole file in the Supabase SQL editor (service role).
--   4) Copy the printed demo_user_id and send it over so DEMO_USER_ID gets updated
--      in assets/js/13-auth-guest.js.
--
-- What it does: makes the demo account FOLLOW the most active OTHER accounts so the
-- guest's Feed is full of real activity. (It copies NO personal reviews/notes, so no
-- one's private data leaks into the demo.) For the demo's own My Movies / Data Dash,
-- log a handful of movies while signed in as the demo account.

do $$
declare
  v_demo_email text := 'demo@cinematracker.app';  -- <-- EDIT to the demo account's email
  v_demo_id    uuid;
begin
  select id into v_demo_id
  from auth.users
  where lower(email) = lower(v_demo_email)
  limit 1;

  if v_demo_id is null then
    raise exception 'No auth user found for %, create the demo account first.', v_demo_email;
  end if;

  -- Demo follows the 5 most active OTHER accounts → a lively Feed for guests.
  insert into public."Follows" (follower_id, followed_id)
  select v_demo_id, top.user_id
  from (
    select user_id, count(*) AS c
    from public."Movie Ratings"
    where user_id <> v_demo_id
    group by user_id
    order by c desc
    limit 5
  ) top
  on conflict do nothing;

  raise notice 'Demo user id = %', v_demo_id;
end $$;

-- Returns the id (+ username/email) as a result row for easy copying.
-- EDIT the email here to match v_demo_email above.
select pu.id AS demo_user_id, pu.username, au.email
from public."Users" pu
join auth.users au on au.id = pu.id
where lower(au.email) = lower('demo@cinematracker.app');
