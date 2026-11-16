-- =====================================================================
--  Ons Twee – database setup
--  Already applied to the 'ons-twee' Supabase project. Kept here for reference / re-creating it.
--  Safe to run more than once.
-- =====================================================================

-- Who may use the app (only these emails can see or change anything)
create table if not exists public.allowed_users (email text primary key);

create or replace function public.is_partner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_users
                 where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;

-- ---------- Tables ----------------------------------------------------
create table if not exists public.profiles (
  user_id     uuid primary key default auth.uid(),
  name        text not null,
  color       text not null default '#e4572e',
  goal_weight numeric(5,1),
  height_cm   numeric(5,1),
  created_at  timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null, date date not null, end_date date,
  start_time time, end_time time, location text, notes text,
  who text not null default 'both',             -- 'both' or a user_id
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  constraint events_end_after_start check (end_date is null or end_date >= date)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  amount numeric(12,2) not null check (amount >= 0),
  type text not null default 'expense' check (type in ('expense','income')),
  category text not null default 'other',
  note text, paid_by uuid default auth.uid(),
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create index if not exists transactions_date_idx on public.transactions(date);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  category text not null unique,
  amount numeric(12,2) not null check (amount >= 0),
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  name text not null, emoji text default '🎯', target numeric(12,2) not null,
  target_date date, notes text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create table if not exists public.goal_deposits (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  date date not null default current_date, amount numeric(12,2) not null,
  user_id uuid default auth.uid(),
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);

create table if not exists public.body_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  date date not null default current_date,
  weight numeric(5,1), body_fat numeric(4,1),
  waist numeric(5,1), hips numeric(5,1), chest numeric(5,1), arm numeric(5,1), thigh numeric(5,1),
  notes text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);

create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  name text not null, emoji text default '📝', sort int not null default 100,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create table if not exists public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists(id) on delete cascade,
  text text not null, qty text, done boolean not null default false,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null, notes text, due date,
  assignee uuid,                                  -- null = either of us
  repeat text not null default 'none' check (repeat in ('none','daily','weekly','monthly')),
  done boolean not null default false, done_at timestamptz,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);

create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'date' check (kind in ('date','bucket')),
  title text not null, notes text, cost text,
  done boolean not null default false, done_on date,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'birthday' check (kind in ('birthday','anniversary','other')),
  month int not null check (month between 1 and 12),
  day int not null check (day between 1 and 31),
  year int, notes text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  idea text not null, price numeric(12,2), link text,
  status text not null default 'idea' check (status in ('idea','bought','given')),
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null, destination text, start_date date, end_date date,
  budget numeric(12,2), notes text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create table if not exists public.trip_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  kind text not null check (kind in ('pack','book','cost')),
  text text not null, amount numeric(12,2), done boolean not null default false,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);

-- ---------- Security: only the two of you ---------------------------
do $$
declare t text;
begin
  foreach t in array array['events','transactions','budgets','goals','goal_deposits','lists','list_items',
                           'tasks','ideas','people','gifts','trips','trip_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists partners on public.%I', t);
    execute format('create policy partners on public.%I for all to authenticated using (public.is_partner()) with check (public.is_partner())', t);
  end loop;
end $$;

alter table public.allowed_users enable row level security;   -- no policies: nobody can read/change it from the app

alter table public.profiles enable row level security;
drop policy if exists profiles_read on public.profiles;
drop policy if exists profiles_write on public.profiles;
create policy profiles_read  on public.profiles for select to authenticated using (public.is_partner());
create policy profiles_write on public.profiles for all to authenticated
  using (public.is_partner() and user_id = auth.uid()) with check (public.is_partner() and user_id = auth.uid());

-- Body logs: both can see both (shared), but each person only adds/edits their own.
alter table public.body_logs enable row level security;
drop policy if exists body_read on public.body_logs;
drop policy if exists body_write on public.body_logs;
create policy body_read  on public.body_logs for select to authenticated using (public.is_partner());
create policy body_write on public.body_logs for all to authenticated
  using (public.is_partner() and user_id = auth.uid()) with check (public.is_partner() and user_id = auth.uid());

-- ---------- Real-time updates ----------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['profiles','events','transactions','budgets','goals','goal_deposits','body_logs','lists',
                             'list_items','tasks','ideas','people','gifts','trips','trip_items'] loop
      if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------- Starter lists --------------------------------------------
insert into public.lists(name, emoji, sort, created_by)
select 'Groceries', '🛒', 1, null where not exists (select 1 from public.lists where name = 'Groceries');
insert into public.lists(name, emoji, sort, created_by)
select 'Pharmacy', '💊', 2, null where not exists (select 1 from public.lists where name = 'Pharmacy');

-- ---------- Who may sign up ---------------------------------------------
-- The first person to create an account becomes the owner; they invite their partner
-- in the app (Settings → Partner). See 02_accounts_and_notifications.sql.
