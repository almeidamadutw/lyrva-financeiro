-- Read access is evaluated once for the small set of allowed units.
alter policy financial_tasks_select_for_financial_staff
on public.financial_tasks
using (
  unit_id in (
    select u.id from public.units u where private.has_unit_access(u.id)
  )
);

-- Notifications read pending tasks in due-date order for one assignee.
create index financial_tasks_assignee_open_due_idx
on public.financial_tasks (assigned_to, due_at, id)
where status in ('pending', 'in_progress');

-- Match each eligible case to its plan by the existing primary key.
CREATE OR REPLACE FUNCTION public.get_collection_queue_filtered(p_unit_code text DEFAULT NULL::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 300, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_month integer DEFAULT NULL::integer, p_year integer DEFAULT NULL::integer)
 RETURNS TABLE(id bigint, unit_id bigint, unit_name text, unit_code text, patient_id bigint, patient_name text, phone text, installment_id bigint, installment_number integer, due_date date, open_amount numeric, eligible_at date, status text, responsible_user_id uuid, responsible_name text, next_action_at timestamp with time zone, protested_at timestamp with time zone, notes text, installment_status text, updated_at timestamp with time zone, source_verified_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- Resolve access and active patient links before looking up installments.
with active_patients as materialized (
  select pu.id, pu.unit_id, pu.patient_id, pu.clinicorp_patient_id,
    u.name as unit_name, u.code as unit_code
  from public.units u
  join public.patient_units pu on pu.unit_id = u.id
  where u.is_active
    and private.has_unit_access(u.id)
    and (p_unit_code is null or p_unit_code in ('', 'todas') or u.code = p_unit_code)
    and pu.settled_at is null and pu.is_active and pu.clinicorp_patient_id is not null
), eligible_cases as materialized (
  select cc.id, cc.unit_id, pu.unit_name, pu.unit_code,
    pu.patient_id, pu.clinicorp_patient_id, cc.installment_id, cc.eligible_at, cc.status,
    cc.responsible_user_id, cc.next_action_at, cc.protested_at, cc.notes, cc.updated_at
  from public.collection_cases cc
  join active_patients pu on pu.id = cc.patient_unit_id and pu.unit_id = cc.unit_id
  where cc.status not in ('paid', 'closed')
    and cc.eligible_at <= (now() at time zone 'America/Sao_Paulo')::date
), queue_page as materialized (
  select cc.*, i.installment_number, i.due_date, i.clinicorp_installment_id,
    i.expected_amount, i.paid_amount, i.expected_amount - i.paid_amount as open_amount,
    i.status as installment_status
  from eligible_cases cc
  -- The primary key bounds this lookup to the installment linked to the case.
  join lateral (
    select i.id, i.unit_id, i.payment_plan_id, i.installment_number, i.due_date,
      i.clinicorp_installment_id, i.expected_amount, i.paid_amount, i.status
    from public.installments i
    where i.id = cc.installment_id and i.unit_id = cc.unit_id
      and i.source = 'clinicorp' and i.clinicorp_source_state = 'open'
      and i.status not in ('paid', 'cancelled', 'refunded')
      and i.expected_amount > i.paid_amount
      and (p_date_from is null or i.due_date >= p_date_from)
      and (p_date_to is null or i.due_date <= p_date_to)
      and (p_month is null or extract(month from i.due_date) = p_month)
      and (p_year is null or extract(year from i.due_date) = p_year)
    limit 1
  ) i on true
  join lateral (
    select pp.id
    from public.payment_plans pp
    where pp.id = i.payment_plan_id and pp.unit_id = i.unit_id
      and pp.source = 'clinicorp' and pp.archived_at is null and pp.status = 'active'
      and (pp.payment_method = 'boleto' or private.clinicorp_verified_open_boleto_installment(i.id))
    limit 1
  ) pp on true
  order by cc.eligible_at, cc.id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 500), 1), 1000)
)
select q.id, q.unit_id, q.unit_name, q.unit_code, q.patient_id, p.full_name, p.phone,
  q.installment_id, q.installment_number, q.due_date, q.open_amount,
  q.eligible_at, q.status, q.responsible_user_id, coalesce(pr.full_name, 'Sem responsável') as responsible_name,
  q.next_action_at, q.protested_at, q.notes, q.installment_status, q.updated_at,
  case when s.source_presence = 'present'
    and s.source_presence_checked_at >= (select seeded_at from private.clinicorp_sync_control where singleton)
    and s.amount = q.expected_amount and q.paid_amount = 0 and s.due_date = q.due_date
    and s.clinicorp_patient_id = q.clinicorp_patient_id
    and not s.payment_received and not s.payment_confirmed and not s.cancelled
  then s.source_presence_checked_at end as source_verified_at
from queue_page q
join public.patients p on p.id = q.patient_id
left join public.clinicorp_payment_snapshot s
  on s.unit_id = q.unit_id and s.clinicorp_payment_id = q.clinicorp_installment_id
left join public.profiles pr on pr.user_id = q.responsible_user_id
order by q.eligible_at, q.id;
$function$;
