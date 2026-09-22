
create or replace function private.set_clinicorp_installment_source_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if new.source is distinct from 'clinicorp' then
    new.clinicorp_source_state := 'unknown';
    return new;
  end if;

  if new.status = 'paid' then
    new.clinicorp_source_state := 'paid';
    return new;
  end if;

  if new.status in ('cancelled','refunded') then
    new.clinicorp_source_state := 'cancelled';
    return new;
  end if;

  -- Canonical ingestion may already have the live Clinicorp state in hand.
  -- Preserve that explicit state instead of downgrading it just because the
  -- audit/source record has not been persisted yet.
  if tg_op = 'INSERT' and new.clinicorp_source_state <> 'unknown' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.clinicorp_source_state is distinct from old.clinicorp_source_state
     and new.clinicorp_source_state <> 'unknown' then
    return new;
  end if;

  v_state := null;

  if new.clinicorp_installment_id is not null then
    select case
      when (
        upper(coalesce(r.payload ->> 'PaymentConfirmed','')) = 'X'
        or upper(coalesce(r.payload ->> 'PaymentReceived','')) = 'X'
      ) then 'paid'
      when (
        upper(coalesce(r.payload ->> 'Canceled','')) = 'X'
        or upper(coalesce(r.payload ->> 'CancelInstallment','')) = 'X'
      ) then 'cancelled'
      else 'open'
    end
    into v_state
    from public.integration_source_records r
    where r.provider = 'clinicorp'
      and r.unit_id = new.unit_id
      and r.payload ->> 'id' = new.clinicorp_installment_id
    order by r.last_seen_at desc, r.id desc
    limit 1;
  end if;

  new.clinicorp_source_state := coalesce(v_state, new.clinicorp_source_state, 'unknown');
  return new;
end;
$$;
