-- Haru sync schema. Paste into Supabase: SQL Editor → New query → Run.
-- Safe to run more than once.

-- 1. One table holds every synced record (decks, notes, cards, review log, …) as JSON.
create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  tbl        text        not null,
  id         text        not null,
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, tbl, id)
);
create index if not exists records_user_updated on public.records (user_id, updated_at);

-- Server sets the timestamp, so devices with wrong clocks can't confuse sync.
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.touch_updated_at();

-- Each user can only see and change their own rows.
alter table public.records enable row level security;
drop policy if exists "own records" on public.records;
create policy "own records" on public.records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. Private storage bucket for audio and images, one folder per user.
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists "own media read" on storage.objects;
drop policy if exists "own media write" on storage.objects;
drop policy if exists "own media update" on storage.objects;
drop policy if exists "own media delete" on storage.objects;
create policy "own media read" on storage.objects for select
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own media write" on storage.objects for insert
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own media update" on storage.objects for update
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own media delete" on storage.objects for delete
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
