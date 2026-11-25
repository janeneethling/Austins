-- Ons Twee: Telegram bot settings (applied 25 Nov 2026)
-- The bot token is added separately (never commit it):
--   select public.set_config_value('telegram_token', '<token from BotFather>');
create or replace function public.set_config_value(p_key text, p_value text)
returns void language sql security definer set search_path to 'private' as $$
  insert into private.config(key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value
$$;
revoke all on function public.set_config_value(text, text) from public, anon, authenticated;
grant execute on function public.set_config_value(text, text) to service_role;

create extension if not exists pgcrypto;
-- webhook secret and one-time pairing code (random)
insert into private.config(key, value) values ('telegram_secret', encode(extensions.gen_random_bytes(24), 'hex')) on conflict (key) do nothing;
insert into private.config(key, value) values ('telegram_code', upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6))) on conflict (key) do nothing;
insert into private.config(key, value) values ('telegram_users', '{}') on conflict (key) do nothing;
