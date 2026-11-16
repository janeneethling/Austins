-- =====================================================================
--  Ons Twee – push notifications
--  Run AFTER 01_setup.sql and AFTER deploying the Edge Function.
--  Replace the two placeholders in the "private.config" insert below:
--    YOUR-FUNCTION-URL  -> the function's URL (Edge Functions → your function → shown on its page)
--    YOUR-CRON-SECRET   -> the CRON_SECRET you saved in Edge Function secrets
--  Safe to run more than once.
-- =====================================================================

-- Phones that want notifications
create table if not exists public.push_subscriptions (
  endpoint     text primary key,
  user_id      uuid not null default auth.uid(),
  subscription jsonb not null,
  prefs        jsonb not null default '{"events": true, "digest": true, "budget": true}'::jsonb,
  created_at   timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions for all to authenticated
  using (public.is_partner() and user_id = auth.uid()) with check (public.is_partner() and user_id = auth.uid());

-- Events: exact start moment (South African time) + "reminder sent" flag
alter table public.events add column if not exists start_at timestamptz;
alter table public.events add column if not exists reminder_sent boolean not null default false;

create or replace function public.events_set_start()
returns trigger language plpgsql as $$
begin
  new.start_at := case when new.start_time is null then null
                       else (new.date + new.start_time) at time zone 'Africa/Johannesburg' end;
  if tg_op = 'INSERT' then
    new.reminder_sent := false;
  elsif new.date is distinct from old.date or new.start_time is distinct from old.start_time then
    new.reminder_sent := false;                       -- time changed: remind again
  elsif current_user in ('authenticated', 'anon') then
    new.reminder_sent := old.reminder_sent;           -- the app can't fiddle with this flag
  end if;
  return new;
end $$;
drop trigger if exists events_set_start on public.events;
create trigger events_set_start before insert or update on public.events
  for each row execute function public.events_set_start();
update public.events set start_time = start_time;     -- fill start_at for existing events

-- Where the Edge Function lives (nobody can read this from the app)
create extension if not exists pg_net;
create extension if not exists pg_cron;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.config (key text primary key, value text not null);
alter table private.config enable row level security;

insert into private.config(key, value) values
  ('push_url',    'YOUR-FUNCTION-URL'),
  ('cron_secret', 'YOUR-CRON-SECRET')
on conflict (key) do update set value = excluded.value;

create or replace function private.call_push(p_body jsonb)
returns void language plpgsql security definer set search_path = public, private as $$
declare v_url text; v_secret text;
begin
  select value into v_url    from private.config where key = 'push_url';
  select value into v_secret from private.config where key = 'cron_secret';
  if v_url is null or v_url like '%YOUR-%' then return; end if;   -- not configured yet
  perform net.http_post(url := v_url, body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret));
end $$;

-- Budget alert: check after every new/changed expense
create or replace function private.on_transaction()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.type = 'expense' then
    perform private.call_push(jsonb_build_object('type', 'budget', 'transaction_id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists transactions_budget_alert on public.transactions;
create trigger transactions_budget_alert after insert on public.transactions
  for each row execute function private.on_transaction();

-- Schedules: event reminders every 5 minutes; morning summary at 07:00 South African time (05:00 UTC)
select cron.unschedule(jobname) from cron.job where jobname in ('onstwee-reminders', 'onstwee-digest');
select cron.schedule('onstwee-reminders', '*/5 * * * *', $$ select private.call_push('{"type":"reminders"}'::jsonb) $$);
select cron.schedule('onstwee-digest',    '0 5 * * *',   $$ select private.call_push('{"type":"digest"}'::jsonb) $$);
