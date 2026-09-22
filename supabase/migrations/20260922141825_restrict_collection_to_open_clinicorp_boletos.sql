
update public.collection_cases cc
set status='closed',
    outcome='cancelled',
    closed_at=coalesce(cc.closed_at,now()),
    next_action_at=null,
    notes=concat_ws(E'\n',cc.notes,'Encerrado automaticamente: a Régua de Cobrança opera somente boletos em aberto no Clinicorp.'),
    updated_at=now()
where cc.status not in ('paid','closed')
  and exists (
    select 1
    from public.installments i
    join public.payment_plans pp on pp.id=i.payment_plan_id
    where i.id=cc.installment_id
      and pp.source='clinicorp'
      and pp.payment_method <> 'boleto'
  );

update public.financial_tasks ft
set status='cancelled',updated_at=now()
where ft.status in ('pending','in_progress')
  and ft.kind in ('collection_call','payment_promise','payment_reminder')
  and exists (
    select 1
    from public.installments i
    join public.payment_plans pp on pp.id=i.payment_plan_id
    where i.id=ft.installment_id
      and pp.source='clinicorp'
      and pp.payment_method <> 'boleto'
  );

create or replace view public.collection_queue
with (security_invoker=true)
as
select
  cc.id,cc.unit_id,u.name as unit_name,p.id as patient_id,p.full_name as patient_name,p.phone,
  pu.clinicorp_patient_id,cc.installment_id,i.due_date,
  greatest(i.expected_amount-i.paid_amount,0::numeric) as open_amount,
  cc.eligible_at,cc.status,cc.responsible_user_id,cc.next_action_at,cc.protested_at,cc.notes,cc.updated_at,
  u.code as unit_code,i.installment_number,i.expected_amount,i.paid_amount,i.status as installment_status,
  cc.outcome,coalesce(pr.full_name,'Sem responsável'::text) as responsible_name,cc.opened_at
from public.collection_cases cc
join public.installments i on i.id=cc.installment_id and i.unit_id=cc.unit_id
join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
join public.patient_units pu on pu.id=cc.patient_unit_id and pu.unit_id=cc.unit_id
join public.patients p on p.id=pu.patient_id
join public.units u on u.id=cc.unit_id
left join public.profiles pr on pr.user_id=cc.responsible_user_id
where pu.settled_at is null
  and pu.is_active
  and pu.clinicorp_patient_id is not null
  and pp.source='clinicorp'
  and pp.payment_method='boleto'
  and pp.archived_at is null
  and pp.status='active'
  and cc.status not in ('paid','closed')
  and i.source='clinicorp'
  and i.clinicorp_source_state='open'
  and i.status not in ('paid','cancelled','refunded')
  and greatest(i.expected_amount-i.paid_amount,0::numeric)>0
  and cc.eligible_at <= (now() at time zone 'America/Sao_Paulo')::date;

grant select on public.collection_queue to authenticated;

create or replace function public.get_collection_queue_page(
  p_unit_code text default null,
  p_offset integer default 0,
  p_limit integer default 500
)
returns table(
  id bigint,unit_id bigint,unit_name text,unit_code text,patient_id bigint,patient_name text,
  phone text,installment_id bigint,installment_number integer,due_date date,open_amount numeric,
  eligible_at date,status text,responsible_user_id uuid,responsible_name text,next_action_at timestamptz,
  protested_at timestamptz,notes text,installment_status text
)
language sql
stable
security definer
set search_path=''
as $$
  with allowed_units as (
    select u.id,u.code,u.name
    from public.units u
    where u.is_active
      and private.has_unit_access(u.id)
      and (p_unit_code is null or p_unit_code='' or p_unit_code='todas' or u.code=p_unit_code)
  )
  select
    cc.id,cc.unit_id,u.name,u.code,p.id,p.full_name,p.phone,cc.installment_id,
    i.installment_number,i.due_date,greatest(i.expected_amount-i.paid_amount,0::numeric),
    cc.eligible_at,cc.status,cc.responsible_user_id,coalesce(pr.full_name,'Sem responsável'::text),
    cc.next_action_at,cc.protested_at,cc.notes,i.status
  from public.collection_cases cc
  join allowed_units u on u.id=cc.unit_id
  join public.installments i on i.id=cc.installment_id and i.unit_id=cc.unit_id
  join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
  join public.patient_units pu on pu.id=cc.patient_unit_id and pu.unit_id=cc.unit_id
  join public.patients p on p.id=pu.patient_id
  left join public.profiles pr on pr.user_id=cc.responsible_user_id
  where pu.settled_at is null
    and pu.is_active
    and pu.clinicorp_patient_id is not null
    and pp.source='clinicorp'
    and pp.payment_method='boleto'
    and pp.archived_at is null
    and pp.status='active'
    and cc.status not in ('paid','closed')
    and i.source='clinicorp'
    and i.clinicorp_source_state='open'
    and i.status not in ('paid','cancelled','refunded')
    and greatest(i.expected_amount-i.paid_amount,0::numeric)>0
    and cc.eligible_at <= (now() at time zone 'America/Sao_Paulo')::date
  order by cc.eligible_at asc,cc.id asc
  offset greatest(coalesce(p_offset,0),0)
  limit least(greatest(coalesce(p_limit,500),1),1000);
$$;

revoke all on function public.get_collection_queue_page(text,integer,integer) from public,anon;
grant execute on function public.get_collection_queue_page(text,integer,integer) to authenticated;
