-- Ons Twee: "something was added" notifications + event colours (applied 25 Nov 2026)

-- Event colour (hex, e.g. '#2fb36d'). Empty = default colour.
alter table public.events add column if not exists color text;

-- Tell the push function whenever a row is added; it notifies the OTHER partner.
create or replace function private.on_added()
returns trigger language plpgsql security definer set search_path to 'public','private' as $$
begin
  perform private.call_push(jsonb_build_object('type','added','table',TG_TABLE_NAME,'id',NEW.id,'by',NEW.created_by));
  return NEW;
end $$;

do $$ declare t text; begin
  foreach t in array array['events','tasks','list_items','ideas','trips','people','goals'] loop
    execute format('drop trigger if exists %I on public.%I', t||'_notify_added', t);
    execute format('create trigger %I after insert on public.%I for each row execute function private.on_added()', t||'_notify_added', t);
  end loop;
end $$;

alter table public.push_subscriptions alter column prefs set default '{"budget": true, "digest": true, "events": true, "added": true}'::jsonb;
