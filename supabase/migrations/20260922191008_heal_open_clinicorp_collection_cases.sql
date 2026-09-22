
create or replace function private.reactivate_clinicorp_plan_from_open_installment()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.source='clinicorp'
     and new.clinicorp_source_state='open'
     and new.status in ('pending','processing','overdue') then
    update public.payment_plans pp
    set status='active',
        archived_at=null,
        source='clinicorp',
        updated_at=now()
    where pp.id=new.payment_plan_id
      and (pp.status is distinct from 'active' or pp.archived_at is not null or pp.source is distinct from 'clinicorp');
  end if;
  return new;
end;
$$;

drop trigger if exists reactivate_clinicorp_plan_from_open_installment on public.installments;
create trigger reactivate_clinicorp_plan_from_open_installment
after insert or update of source,status,clinicorp_source_state,payment_plan_id
on public.installments
for each row
execute function private.reactivate_clinicorp_plan_from_open_installment();

update public.payment_plans pp
set status='active',
    archived_at=null,
    source='clinicorp',
    updated_at=now()
where pp.source='clinicorp'
  and exists (
    select 1
    from public.installments i
    where i.payment_plan_id=pp.id
      and i.source='clinicorp'
      and i.clinicorp_source_state='open'
      and i.status in ('pending','processing','overdue')
  )
  and (pp.status is distinct from 'active' or pp.archived_at is not null);

-- Force the collection scheduler to rebuild/reopen every currently open Clinicorp boleto.
update public.installments i
set status=case
      when i.due_date < (now() at time zone 'America/Sao_Paulo')::date then 'overdue'
      else 'pending'
    end,
    clinicorp_source_state='open',
    updated_at=now()
from public.payment_plans pp
where pp.id=i.payment_plan_id
  and pp.source='clinicorp'
  and pp.payment_method='boleto'
  and i.source='clinicorp'
  and i.clinicorp_source_state='open'
  and i.status not in ('paid','cancelled','refunded');
