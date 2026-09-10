-- LYVRA: entrada automática de boletos na régua da Daiane em D+3 dias úteis.

alter table public.units
  add column if not exists collection_assignee_user_id uuid references auth.users(id) on delete set null,
  add column if not exists collection_start_business_days smallint not null default 3;

alter table public.units drop constraint if exists units_collection_start_business_days_check;
alter table public.units add constraint units_collection_start_business_days_check
  check (collection_start_business_days between 1 and 30);

create index if not exists units_collection_assignee_user_id_idx
  on public.units(collection_assignee_user_id);

update public.units u
set collection_assignee_user_id = p.user_id,
    collection_start_business_days = 3
from public.profiles p
where p.username = 'daiane' and p.is_active = true;

create or replace function private.add_business_days(p_date date, p_days integer)
returns date language plpgsql immutable set search_path = '' as $$
declare v_date date := p_date; v_added integer := 0;
begin
  if p_days is null or p_days <= 0 then return p_date; end if;
  while v_added < p_days loop
    v_date := v_date + 1;
    if extract(isodow from v_date) between 1 and 5 then v_added := v_added + 1; end if;
  end loop;
  return v_date;
end;
$$;

create or replace function private.sync_installment_collection_schedule()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_payment_method text; v_patient_unit_id bigint; v_patient_id bigint; v_patient_name text;
  v_assignee uuid; v_days integer := 3; v_eligible_at date; v_case_id bigint;
begin
  select pp.payment_method, pp.patient_unit_id, u.collection_assignee_user_id,
         coalesce(u.collection_start_business_days, 3), pu.patient_id, p.full_name
  into v_payment_method, v_patient_unit_id, v_assignee, v_days, v_patient_id, v_patient_name
  from public.payment_plans pp
  join public.units u on u.id = pp.unit_id
  join public.patient_units pu on pu.id = pp.patient_unit_id and pu.unit_id = pp.unit_id
  join public.patients p on p.id = pu.patient_id
  where pp.id = new.payment_plan_id and pp.unit_id = new.unit_id and pp.archived_at is null;

  if v_payment_method is distinct from 'boleto' then
    update public.collection_cases set status='closed', outcome='cancelled',
      closed_at=coalesce(closed_at,now()), updated_at=now()
    where installment_id=new.id and unit_id=new.unit_id and status not in ('paid','closed');
    update public.financial_tasks set status='cancelled', updated_at=now()
    where task_key=concat('collection_call:',new.id) and status in ('pending','in_progress');
    return new;
  end if;

  if new.status in ('paid','cancelled','refunded') then
    update public.collection_cases set
      status=case when new.status='paid' then 'paid' else 'closed' end,
      outcome=case when new.status='paid' then 'paid' else 'cancelled' end,
      closed_at=coalesce(closed_at,now()), updated_at=now()
    where installment_id=new.id and unit_id=new.unit_id and status not in ('paid','closed');
    update public.financial_tasks set status='cancelled', updated_at=now()
    where task_key=concat('collection_call:',new.id) and status in ('pending','in_progress');
    return new;
  end if;

  if new.status not in ('pending','overdue') or v_assignee is null then return new; end if;
  v_eligible_at := private.add_business_days(new.due_date, v_days);

  insert into public.collection_cases(unit_id,patient_unit_id,installment_id,responsible_user_id,eligible_at,status,next_action_at,notes)
  values(new.unit_id,v_patient_unit_id,new.id,v_assignee,v_eligible_at,'pending_contact',
    (v_eligible_at::timestamp at time zone 'America/Sao_Paulo'),
    concat('Entrada automática na régua após ',v_days,' dias úteis do vencimento.'))
  on conflict (installment_id) do update set
    responsible_user_id=excluded.responsible_user_id, eligible_at=excluded.eligible_at,
    next_action_at=case when public.collection_cases.status='pending_contact' then excluded.next_action_at else public.collection_cases.next_action_at end,
    updated_at=now()
  returning id into v_case_id;

  insert into public.financial_tasks(unit_id,patient_id,installment_id,collection_case_id,assigned_to,title,description,kind,status,due_at,task_key)
  values(new.unit_id,v_patient_id,new.id,v_case_id,v_assignee,'Iniciar régua de cobrança',
    concat(coalesce(v_patient_name,'Paciente'),' • parcela ',coalesce(new.installment_number::text,'—'),' • venceu em ',to_char(new.due_date,'DD/MM/YYYY')),
    'collection_call','pending',(v_eligible_at::timestamp at time zone 'America/Sao_Paulo'),concat('collection_call:',new.id))
  on conflict (task_key) where task_key is not null do update set
    assigned_to=excluded.assigned_to, collection_case_id=excluded.collection_case_id,
    patient_id=excluded.patient_id, installment_id=excluded.installment_id,
    description=excluded.description, due_at=excluded.due_at,
    status=case when public.financial_tasks.status='completed' then public.financial_tasks.status else 'pending' end,
    updated_at=now();
  return new;
end;
$$;

drop trigger if exists sync_collection_schedule on public.installments;
create trigger sync_collection_schedule
after insert or update of status, due_date, expected_amount on public.installments
for each row execute function private.sync_installment_collection_schedule();
