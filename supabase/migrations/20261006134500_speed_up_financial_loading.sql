create index if not exists payment_plans_patient_unit_active_order_idx
  on public.payment_plans (
    patient_unit_id,
    (case when status = 'active' then 0 else 1 end),
    updated_at desc,
    id desc
  )
  where source = 'clinicorp' and archived_at is null;

create index if not exists collection_cases_open_patient_unit_idx
  on public.collection_cases(unit_id, patient_unit_id, installment_id)
  where status not in ('paid','closed');

create or replace function public.get_clinicorp_pending_total(
  p_unit_code text default null,
  p_ranges jsonb default '[]'::jsonb
)
returns table(pending_amount numeric, pending_count bigint)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $function$
  with allowed_units as (
    select u.id
    from public.units u
    where u.is_active
      and private.has_unit_access(u.id)
      and (
        p_unit_code is null
        or p_unit_code = ''
        or p_unit_code = 'todas'
        or u.code = p_unit_code
      )
  ),
  ranges as (
    select x.from_date::date as from_date, x.to_date::date as to_date
    from jsonb_to_recordset(
      case
        when jsonb_typeof(coalesce(p_ranges,'[]'::jsonb))='array'
          then coalesce(p_ranges,'[]'::jsonb)
        else '[]'::jsonb
      end
    ) as x(from_date text, to_date text)
    where x.from_date ~ '^\d{4}-\d{2}-\d{2}$'
      and x.to_date ~ '^\d{4}-\d{2}-\d{2}$'
      and x.from_date <= x.to_date
  )
  select coalesce(sum(s.amount),0)::numeric, count(*)::bigint
  from allowed_units au
  join public.clinicorp_payment_snapshot s
    on s.unit_id = au.id
   and s.amount > 0
   and s.due_date is not null
   and not s.payment_received
   and not s.payment_confirmed
   and not s.cancelled
  join ranges r on s.due_date between r.from_date and r.to_date;
$function$;

create or replace function public.get_overdue_boleto_counts(p_unit_code text default null)
returns table(
  unit_id bigint,
  patient_id bigint,
  overdue_count bigint,
  overdue_amount numeric
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $function$
  with allowed_units as (
    select u.id
    from public.units u
    where u.is_active
      and private.has_unit_access(u.id)
      and (
        p_unit_code is null
        or p_unit_code = ''
        or p_unit_code = 'todas'
        or u.code = p_unit_code
      )
  )
  select
    pu.unit_id,
    pu.patient_id,
    count(cc.id)::bigint,
    coalesce(sum(greatest(i.expected_amount - i.paid_amount,0::numeric)),0::numeric)
  from allowed_units au
  join public.collection_cases cc
    on cc.unit_id = au.id
   and cc.status not in ('paid','closed')
  join public.patient_units pu
    on pu.id = cc.patient_unit_id
   and pu.unit_id = cc.unit_id
   and pu.settled_at is null
   and pu.is_active
   and pu.clinicorp_patient_id is not null
  join public.installments i
    on i.id = cc.installment_id
   and i.unit_id = cc.unit_id
   and i.source = 'clinicorp'
   and i.clinicorp_source_state = 'open'
   and i.status not in ('paid','cancelled','refunded')
   and i.due_date < (now() at time zone 'America/Sao_Paulo')::date
   and greatest(i.expected_amount - i.paid_amount,0::numeric) > 0
  join public.payment_plans pp
    on pp.id = i.payment_plan_id
   and pp.unit_id = i.unit_id
   and pp.source = 'clinicorp'
   and pp.payment_method = 'boleto'
   and pp.archived_at is null
   and pp.status = 'active'
  group by pu.unit_id, pu.patient_id;
$function$;

grant execute on function public.get_clinicorp_pending_total(text,jsonb) to authenticated;
grant execute on function public.get_overdue_boleto_counts(text) to authenticated;
