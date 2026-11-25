-- Ons Twee: recipes & recipe ideas (applied 25 Nov 2026)
create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  emoji text default '🍽️',
  status text not null default 'idea' check (status in ('idea','tried','favourite')),
  category text,
  link text,
  servings text,
  time text,
  ingredients text,
  method text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.recipes enable row level security;
drop policy if exists partners on public.recipes;
create policy partners on public.recipes for all to authenticated using (public.is_partner()) with check (public.is_partner());
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='recipes') then
    alter publication supabase_realtime add table public.recipes;
  end if;
end $$;
