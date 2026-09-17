create or replace function private.sync_invoice_obligations_from_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source='clinicorp' and not coalesce(new.issue_invoice_for_ir,false) then
    return new;
  end if;
  perform private.sync_invoice_obligations_for_plan(new.id);
  return new;
end;
$$;

create or replace function private.sync_invoice_obligations_from_installment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_skip boolean := false;
begin
  select (pp.source='clinicorp' and not coalesce(pp.issue_invoice_for_ir,false))
    into v_skip
  from public.payment_plans pp
  where pp.id=new.payment_plan_id;

  if coalesce(v_skip,false) then
    return new;
  end if;

  perform private.sync_invoice_obligations_for_plan(new.payment_plan_id);
  return new;
end;
$$;