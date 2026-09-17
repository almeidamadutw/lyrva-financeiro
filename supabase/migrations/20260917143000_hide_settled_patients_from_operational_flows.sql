create or replace function private.guard_settled_financial_task()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.patient_id is not null and exists (
    select 1 from public.patients p
    where p.id = new.patient_id and p.settled_at is not null
  ) then
    new.status := 'cancelled';
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists guard_settled_financial_task on public.financial_tasks;
create trigger guard_settled_financial_task
before insert or update on public.financial_tasks
for each row execute function private.guard_settled_financial_task();

create or replace function private.guard_settled_message_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.patient_id is not null and exists (
    select 1 from public.patients p
    where p.id = new.patient_id and p.settled_at is not null
  ) then
    new.status := 'cancelled';
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists guard_settled_message_event on public.message_events;
create trigger guard_settled_message_event
before insert or update on public.message_events
for each row execute function private.guard_settled_message_event();

create or replace function private.guard_settled_collection_case()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.patient_units pu
    join public.patients p on p.id = pu.patient_id
    where pu.id = new.patient_unit_id
      and p.settled_at is not null
  ) then
    new.status := 'closed';
    new.outcome := 'paid';
    new.closed_at := coalesce(new.closed_at, now());
    new.next_action_at := null;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists guard_settled_collection_case on public.collection_cases;
create trigger guard_settled_collection_case
before insert or update on public.collection_cases
for each row execute function private.guard_settled_collection_case();

create or replace view public.collection_queue as
select
  cc.id,
  cc.unit_id,
  u.name as unit_name,
  p.id as patient_id,
  p.full_name as patient_name,
  p.phone,
  pu.clinicorp_patient_id,
  cc.installment_id,
  i.due_date,
  greatest(i.expected_amount - i.paid_amount, 0::numeric) as open_amount,
  cc.eligible_at,
  cc.status,
  cc.responsible_user_id,
  cc.next_action_at,
  cc.protested_at,
  cc.notes,
  cc.updated_at,
  u.code as unit_code,
  i.installment_number,
  i.expected_amount,
  i.paid_amount,
  i.status as installment_status,
  cc.outcome,
  coalesce(pr.full_name, 'Sem responsável'::text) as responsible_name,
  cc.opened_at
from public.collection_cases cc
join public.installments i on i.id = cc.installment_id and i.unit_id = cc.unit_id
join public.patient_units pu on pu.id = cc.patient_unit_id and pu.unit_id = cc.unit_id
join public.patients p on p.id = pu.patient_id
join public.units u on u.id = cc.unit_id
left join public.profiles pr on pr.user_id = cc.responsible_user_id
where p.settled_at is null;

update public.financial_tasks ft
set status = 'cancelled', updated_at = now()
where ft.status in ('pending','in_progress')
  and exists (select 1 from public.patients p where p.id = ft.patient_id and p.settled_at is not null);

update public.message_events me
set status = 'cancelled', updated_at = now()
where me.status in ('scheduled','processing')
  and exists (select 1 from public.patients p where p.id = me.patient_id and p.settled_at is not null);

update public.collection_cases cc
set status = 'closed', outcome = 'paid', closed_at = coalesce(cc.closed_at, now()), next_action_at = null, updated_at = now()
where cc.status not in ('paid','closed')
  and exists (
    select 1 from public.patient_units pu
    join public.patients p on p.id = pu.patient_id
    where pu.id = cc.patient_unit_id and p.settled_at is not null
  );