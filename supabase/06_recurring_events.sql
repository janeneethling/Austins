-- Ons Twee: recurring events (applied 25 Nov 2026)
alter table public.events add column if not exists repeat text not null default 'none';
alter table public.events drop constraint if exists events_repeat_check;
alter table public.events add constraint events_repeat_check check (repeat in ('none','daily','weekly','fortnightly','monthly','yearly'));
alter table public.events add column if not exists repeat_until date;
alter table public.events add column if not exists last_reminded date;  -- reminder bookkeeping for recurring events
