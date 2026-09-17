create or replace function private.reconcile_invoice_workbook_source_key()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_existing_key text;
begin
  if new.source_type <> 'workbook' or new.source_key is null then
    return new;
  end if;

  select o.source_key
    into v_existing_key
  from public.invoice_obligations o
  where o.unit_id = new.unit_id
    and o.patient_unit_id = new.patient_unit_id
    and o.period_start = new.period_start
    and o.source_type = 'workbook'
    and o.source_key is not null
    and (
      lower(coalesce(o.metadata ->> 'payment_origin','')) = lower(coalesce(new.metadata ->> 'payment_origin',''))
      or o.rule_code = 'legacy_workbook_backfill'
    )
  order by
    case
      when lower(coalesce(o.metadata ->> 'payment_origin','')) = lower(coalesce(new.metadata ->> 'payment_origin','')) then 0
      else 1
    end,
    o.id
  limit 1;

  if v_existing_key is not null then
    new.source_key := v_existing_key;
  end if;

  return new;
end;
$$;

drop trigger if exists reconcile_invoice_workbook_source_key on public.invoice_obligations;
create trigger reconcile_invoice_workbook_source_key
before insert on public.invoice_obligations
for each row execute function private.reconcile_invoice_workbook_source_key();