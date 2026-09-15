create or replace function private.dedupe_sync_event_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.external_id is null then
    return new;
  end if;

  update public.sync_events se
     set unit_id = coalesce(new.unit_id, se.unit_id),
         status = new.status,
         error_message = new.error_message,
         payload_hash = coalesce(new.payload_hash, se.payload_hash)
   where se.sync_run_id = new.sync_run_id
     and se.entity_type = new.entity_type
     and se.external_id = new.external_id
     and se.action = new.action;

  if found then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists dedupe_sync_event_before_insert on public.sync_events;
create trigger dedupe_sync_event_before_insert
before insert on public.sync_events
for each row
execute function private.dedupe_sync_event_insert();

comment on function private.dedupe_sync_event_insert() is
  'Torna o histórico de sincronização idempotente: eventos repetidos no mesmo sync_run atualizam o registro existente em vez de violar sync_events_idempotency_unique.';
