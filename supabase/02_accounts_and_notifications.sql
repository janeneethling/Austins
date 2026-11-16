-- =====================================================================
--  Ons Twee – accounts + push notifications (already applied to the 'ons-twee' project)
--  Secrets are NOT stored in this file. When re-creating the project, put real values into
--  private.config (push_url, cron_secret, vapid_public, vapid_private, vapid_subject).
-- =====================================================================

-- Accounts: first sign-up becomes owner; afterwards only invited emails (max 2 people) can sign up.
create or replace function public.handle_signup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.allowed_users) then
    insert into public.allowed_users(email) values (lower(new.email));
  elsif not exists (select 1 from public.allowed_users where lower(email) = lower(new.email)) then
    raise exception 'ONS_TWEE_NOT_INVITED';
  end if;
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end $$;
drop trigger if exists ons_twee_signup on auth.users;
create trigger ons_twee_signup before insert on auth.users for each row execute function public.handle_signup();
revoke execute on function public.handle_signup() from public, anon, authenticated;

drop policy if exists allowed_read on public.allowed_users;
drop policy if exists allowed_invite on public.allowed_users;
drop policy if exists allowed_remove on public.allowed_users;
create policy allowed_read on public.allowed_users for select to authenticated using (public.is_partner());
create policy allowed_invite on public.allowed_users for insert to authenticated
  with check (public.is_partner() and (select count(*) from public.allowed_users) < 2);
create policy allowed_remove on public.allowed_users for delete to authenticated
  using (public.is_partner() and lower(email) <> lower(coalesce(auth.jwt() ->> 'email', '')));
grant select, insert, delete on public.allowed_users to authenticated;
revoke execute on function public.is_partner() from public, anon;
grant execute on function public.is_partner() to authenticated;

-- Push subscriptions
create table if not exists public.push_subscriptions (
  endpoint text primary key, user_id uuid not null default auth.uid(), subscription jsonb not null,
  prefs jsonb not null default '{"events": true, "digest": true, "budget": true}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions for all to authenticated
  using (public.is_partner() and user_id = auth.uid()) with check (public.is_partner() and user_id = auth.uid());

-- Events: exact start time in SA time + reminder flag
alter table public.events add column if not exists start_at timestamptz;
alter table public.events add column if not exists reminder_sent boolean not null default false;
create or replace function public.events_set_start()
returns trigger language plpgsql set search_path = public as $$
begin
  new.start_at := case when new.start_time is null then null else (new.date + new.start_time) at time zone 'Africa/Johannesburg' end;
  if tg_op = 'INSERT' then new.reminder_sent := false;
  elsif new.date is distinct from old.date or new.start_time is distinct from old.start_time then new.reminder_sent := false;
  elsif current_user in ('authenticated', 'anon') then new.reminder_sent := old.reminder_sent;
  end if;
  return new;
end $$;
drop trigger if exists events_set_start on public.events;
create trigger events_set_start before insert or update on public.events for each row execute function public.events_set_start();

-- Private config, readable only by the server
create extension if not exists pg_net;
create extension if not exists pg_cron;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.config (key text primary key, value text not null);
alter table private.config enable row level security;
-- insert into private.config(key, value) values ('push_url', 'https://<project-ref>.supabase.co/functions/v1/push'),
--   ('cron_secret', '<random>'), ('vapid_public', '<key>'), ('vapid_private', '<key>'), ('vapid_subject', 'mailto:...')
--   on conflict (key) do update set value = excluded.value;

create or replace function public.push_config()
returns table(key text, value text) language sql stable security definer set search_path = private as $$
  select key, value from private.config $$;
revoke all on function public.push_config() from public, anon, authenticated;
grant execute on function public.push_config() to service_role;

create or replace function private.call_push(p_body jsonb)
returns void language plpgsql security definer set search_path = public, private as $$
declare v_url text; v_secret text;
begin
  select value into v_url from private.config where key = 'push_url';
  select value into v_secret from private.config where key = 'cron_secret';
  if v_url is null then return; end if;
  perform net.http_post(url := v_url, body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret));
end $$;

create or replace function private.on_transaction()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.type = 'expense' then perform private.call_push(jsonb_build_object('type', 'budget', 'transaction_id', new.id)); end if;
  return new;
end $$;
drop trigger if exists transactions_budget_alert on public.transactions;
create trigger transactions_budget_alert after insert on public.transactions for each row execute function private.on_transaction();

select cron.unschedule(jobname) from cron.job where jobname in ('onstwee-reminders', 'onstwee-digest');
select cron.schedule('onstwee-reminders', '*/5 * * * *', $$ select private.call_push('{"type":"reminders"}'::jsonb) $$);
select cron.schedule('onstwee-digest',    '0 5 * * *',   $$ select private.call_push('{"type":"digest"}'::jsonb) $$);
