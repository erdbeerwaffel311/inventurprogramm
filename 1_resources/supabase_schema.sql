-- SQL-Einrichtungsskript für die kostenlose Supabase Cloud-Datenbank
-- Einfach in Supabase unter "SQL Editor" einfügen und auf "Run" klicken:

create table if not exists public.keller_items (
  id text primary key,
  name text not null,
  category text not null,
  quantity numeric not null default 0,
  updated_at timestamptz not null default now(),
  payload jsonb not null
);

create table if not exists public.keller_transactions (
  id text primary key,
  timestamp timestamptz not null default now(),
  type text not null,
  payload jsonb not null
);

alter table public.keller_items enable row level security;
alter table public.keller_transactions enable row level security;

grant usage on schema public to anon, authenticated;
grant all on table public.keller_items to anon, authenticated;
grant all on table public.keller_transactions to anon, authenticated;

drop policy if exists "Vereinskeller Items Vollzugriff" on public.keller_items;
create policy "Vereinskeller Items Vollzugriff"
  on public.keller_items for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Vereinskeller Buchungen Vollzugriff" on public.keller_transactions;
create policy "Vereinskeller Buchungen Vollzugriff"
  on public.keller_transactions for all
  to anon, authenticated
  using (true)
  with check (true);
