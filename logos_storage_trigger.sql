-- Auto-create a Logos row for every new upload in the Logos storage bucket.
-- Assumes a public "Logos" table with columns: id (uuid), created_at, theme_id, url.

create or replace function public.handle_logo_upload()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bucket_id <> 'Logos' then
    return new;
  end if;

  insert into public."Logos" (id, created_at, url)
  values (
    new.id,
    new.created_at,
    concat('https://dbxhaseoxpnmzdxbzdpj.supabase.co/storage/v1/object/public/Logos/', new.name)
  )
  on conflict (id) do update
    set url = excluded.url,
        created_at = excluded.created_at;

  return new;
end;
$$;

drop trigger if exists trg_logos_on_upload on storage.objects;
create trigger trg_logos_on_upload
after insert on storage.objects
for each row
execute function public.handle_logo_upload();
