
-- Clinicorp is the only operational source of patient, plan, installment, payment
-- and invoice truth. Spreadsheet imports remain only as historical test evidence.

-- 1) Retire all spreadsheet-derived operational work.
update public.financial_tasks ft
set status = 'cancelled', updated_at = now()
where ft.status in ('pending','in_progress')
  and exists (
    select 1
    from public.installments i
    join public.payment_plans pp on pp.id = i.payment_plan_id
    where i.id = ft.installment_id
      and pp.source = 'import'
  );

update public.collection_cases cc
set status = 'closed',
    outcome = 'cancelled',
    closed_at = coalesce(cc.closed_at, now()),
    next_action_at = null,
    notes = concat_ws(E'\n', cc.notes, 'Encerrado: planilhas desativadas; Clinicorp é a fonte oficial.'),
    updated_at = now()
where cc.status not in ('paid','closed')
  and exists (
    select 1
    from public.installments i
    join public.payment_plans pp on pp.id = i.payment_plan_id
    where i.id = cc.installment_id
      and pp.source = 'import'
  );

update public.installments i
set status = 'cancelled',
    metadata = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
      'retired_test_spreadsheet', true,
      'retired_at', now()
    ),
    updated_at = now()
where i.source = 'import'
  and i.status not in ('cancelled','refunded');

update public.payment_plans pp
set status = 'cancelled',
    archived_at = coalesce(pp.archived_at, now()),
    metadata = coalesce(pp.metadata, '{}'::jsonb) || jsonb_build_object(
      'retired_test_spreadsheet', true,
      'retired_at', now()
    ),
    updated_at = now()
where pp.source = 'import'
  and (pp.status <> 'cancelled' or pp.archived_at is null);

update public.invoice_obligations io
set status = 'cancelled',
    metadata = coalesce(io.metadata, '{}'::jsonb) || jsonb_build_object(
      'retired_test_spreadsheet', true,
      'retired_at', now()
    ),
    updated_at = now()
where io.status <> 'cancelled'
  and (
    io.source_type = 'workbook'
    or exists (
      select 1
      from public.payment_plans pp
      where pp.id = io.payment_plan_id
        and pp.source = 'import'
    )
  );

update public.patient_units pu
set is_active = false,
    updated_at = now()
where pu.is_active
  and pu.source = 'import'
  and pu.clinicorp_patient_id is null;

update public.integration_source_records r
set link_status = 'invalid',
    last_error = 'Fonte de teste desativada. Clinicorp é a fonte operacional oficial.',
    updated_at = now()
where r.provider in ('nf_workbook','collections_workbook')
  and r.link_status <> 'invalid';

-- 2) Block stale clients from importing spreadsheet data again.
revoke all on function public.import_patients(text,text,jsonb) from public, anon, authenticated;
revoke all on function public.import_patient_directory(text,text,jsonb) from public, anon, authenticated;
revoke all on function public.import_invoice_workbook_records(text,text,jsonb) from public, anon, authenticated;
revoke all on function public.prepare_collection_import_targets(text,jsonb) from public, anon, authenticated;

grant execute on function public.import_patients(text,text,jsonb) to service_role;
grant execute on function public.import_patient_directory(text,text,jsonb) to service_role;
grant execute on function public.import_invoice_workbook_records(text,text,jsonb) to service_role;
grant execute on function public.prepare_collection_import_targets(text,jsonb) to service_role;

-- 3) Any real Clinicorp link automatically reactivates/promotes that unit link.
create or replace function private.promote_clinicorp_patient_unit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.clinicorp_patient_id is not null then
    new.is_active := true;
    new.source := 'clinicorp';
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      || jsonb_build_object('clinicorp_canonical', true);
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists promote_clinicorp_patient_unit on public.patient_units;
create trigger promote_clinicorp_patient_unit
before insert or update of clinicorp_patient_id on public.patient_units
for each row execute function private.promote_clinicorp_patient_unit();

-- 4) Clinicorp-only patient directory.
create or replace view public.patient_directory
with (security_invoker=true)
as
select
  pu.id as patient_unit_id,
  p.id as patient_id,
  pu.clinicorp_patient_id,
  p.full_name,
  p.cpf,
  p.phone,
  p.email,
  u.id as unit_id,
  u.code as unit_code,
  u.name as unit_name,
  coalesce(ap.treatment, pu.treatment) as treatment,
  ap.payment_method,
  ap.total_amount as plan_amount,
  ap.installment_count,
  ap.due_day,
  ap.start_date,
  coalesce(ap.issue_invoice_for_ir, p.tax_receipt_ir) as tax_receipt_ir,
  ap.invoice_frequency_override as invoice_frequency,
  p.notes,
  pu.is_active,
  p.created_at,
  p.updated_at,
  ap.installment_amount,
  ap.end_date,
  ap.first_invoice_date,
  ap.invoice_interval_months,
  ap.invoice_schedule_mode,
  ap.invoice_recipient_name,
  ap.invoice_disabled,
  ap.invoice_disabled_reason,
  pu.settled_at,
  pu.settled_reason,
  (coalesce(pu.reminder_opt_out, false) or coalesce(p.reminder_opt_out, false)) as reminder_opt_out,
  coalesce(pu.reminder_opt_out_reason, p.reminder_opt_out_reason) as reminder_opt_out_reason
from public.patient_units pu
join public.patients p on p.id = pu.patient_id
join public.units u on u.id = pu.unit_id
left join lateral (
  select pp.*
  from public.payment_plans pp
  where pp.patient_unit_id = pu.id
    and pp.source = 'clinicorp'
    and pp.archived_at is null
  order by
    case when pp.status = 'active' then 0 else 1 end,
    pp.updated_at desc,
    pp.id desc
  limit 1
) ap on true
where pu.is_active
  and pu.clinicorp_patient_id is not null;

grant select on public.patient_directory to authenticated;

-- 5) Clinicorp-only invoice queue.
create or replace view public.invoice_queue
with (security_invoker=true)
as
select
  obligation.id,
  obligation.unit_id,
  unit.name as unit_name,
  patient.id as patient_id,
  patient.full_name as patient_name,
  patient.cpf,
  patient_unit.clinicorp_patient_id,
  obligation.payment_plan_id,
  obligation.period_start,
  obligation.period_end,
  obligation.competence,
  obligation.frequency,
  obligation.status,
  obligation.expected_amount,
  obligation.paid_amount,
  obligation.invoice_number,
  obligation.invoice_issued_at,
  obligation.responsible_user_id,
  obligation.notes,
  obligation.updated_at,
  obligation.issued_amount,
  obligation.scheduled_issue_date,
  obligation.rule_code,
  plan.payment_method,
  plan.invoice_schedule_mode,
  plan.invoice_recipient_name,
  coalesce(plan.invoice_disabled, false) as invoice_disabled,
  plan.invoice_disabled_reason,
  obligation.source_type,
  obligation.source_key,
  obligation.metadata
from public.invoice_obligations obligation
join public.patient_units patient_unit on patient_unit.id = obligation.patient_unit_id
join public.patients patient on patient.id = patient_unit.patient_id
join public.units unit on unit.id = obligation.unit_id
join public.payment_plans plan
  on plan.id = obligation.payment_plan_id
 and plan.unit_id = obligation.unit_id
where patient_unit.clinicorp_patient_id is not null
  and obligation.source_type = 'plan'
  and plan.source = 'clinicorp'
  and obligation.status <> 'cancelled';

grant select on public.invoice_queue to authenticated;

-- 6) Clinicorp-only collection queue.
create or replace view public.collection_queue
with (security_invoker=true)
as
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
join public.installments i
  on i.id = cc.installment_id
 and i.unit_id = cc.unit_id
join public.payment_plans pp
  on pp.id = i.payment_plan_id
 and pp.unit_id = i.unit_id
join public.patient_units pu
  on pu.id = cc.patient_unit_id
 and pu.unit_id = cc.unit_id
join public.patients p on p.id = pu.patient_id
join public.units u on u.id = cc.unit_id
left join public.profiles pr on pr.user_id = cc.responsible_user_id
where pu.settled_at is null
  and pu.is_active
  and pu.clinicorp_patient_id is not null
  and pp.source = 'clinicorp'
  and pp.archived_at is null
  and pp.status = 'active'
  and cc.status not in ('paid','closed')
  and i.source = 'clinicorp'
  and i.status not in ('paid','cancelled','refunded')
  and greatest(i.expected_amount - i.paid_amount, 0::numeric) > 0
  and cc.eligible_at <= (now() at time zone 'America/Sao_Paulo')::date;

grant select on public.collection_queue to authenticated;

create or replace function public.get_collection_queue_page(
  p_unit_code text default null,
  p_offset integer default 0,
  p_limit integer default 500
)
returns table(
  id bigint,
  unit_id bigint,
  unit_name text,
  unit_code text,
  patient_id bigint,
  patient_name text,
  phone text,
  installment_id bigint,
  installment_number integer,
  due_date date,
  open_amount numeric,
  eligible_at date,
  status text,
  responsible_user_id uuid,
  responsible_name text,
  next_action_at timestamptz,
  protested_at timestamptz,
  notes text,
  installment_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed_units as (
    select u.id, u.code, u.name
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
    cc.id,
    cc.unit_id,
    u.name,
    u.code,
    p.id,
    p.full_name,
    p.phone,
    cc.installment_id,
    i.installment_number,
    i.due_date,
    greatest(i.expected_amount - i.paid_amount, 0::numeric),
    cc.eligible_at,
    cc.status,
    cc.responsible_user_id,
    coalesce(pr.full_name, 'Sem responsável'::text),
    cc.next_action_at,
    cc.protested_at,
    cc.notes,
    i.status
  from public.collection_cases cc
  join allowed_units u on u.id = cc.unit_id
  join public.installments i on i.id = cc.installment_id and i.unit_id = cc.unit_id
  join public.payment_plans pp on pp.id = i.payment_plan_id and pp.unit_id = i.unit_id
  join public.patient_units pu on pu.id = cc.patient_unit_id and pu.unit_id = cc.unit_id
  join public.patients p on p.id = pu.patient_id
  left join public.profiles pr on pr.user_id = cc.responsible_user_id
  where pu.settled_at is null
    and pu.is_active
    and pu.clinicorp_patient_id is not null
    and pp.source = 'clinicorp'
    and pp.archived_at is null
    and pp.status = 'active'
    and cc.status not in ('paid','closed')
    and i.source = 'clinicorp'
    and i.status not in ('paid','cancelled','refunded')
    and greatest(i.expected_amount - i.paid_amount, 0::numeric) > 0
    and cc.eligible_at <= (now() at time zone 'America/Sao_Paulo')::date
  order by cc.eligible_at asc, cc.id asc
  offset greatest(coalesce(p_offset,0),0)
  limit least(greatest(coalesce(p_limit,500),1),1000);
$$;

revoke all on function public.get_collection_queue_page(text,integer,integer) from public,anon;
grant execute on function public.get_collection_queue_page(text,integer,integer) to authenticated;

-- 7) Settlement status must follow the same Clinicorp-only directory.
create or replace view public.patient_settlement_status
with (security_invoker=true)
as
select
  pu.patient_id,
  pu.id as patient_unit_id,
  pu.unit_id,
  u.code as unit_code,
  u.name as unit_name,
  case
    when pu.settled_at is not null then 'settled'
    when req.id is not null then 'requested'
    else 'open'
  end as settlement_state,
  req.id as settlement_request_id,
  req.payment_plan_id,
  req.requested_at,
  req.clinicorp_url,
  pu.settled_at,
  pu.settled_reason
from public.patient_units pu
join public.units u on u.id = pu.unit_id
left join lateral (
  select r.id, r.payment_plan_id, r.requested_at, r.clinicorp_url
  from public.clinicorp_settlement_requests r
  where r.patient_unit_id = pu.id
    and r.status = 'requested'
  order by r.requested_at desc, r.id desc
  limit 1
) req on true
where pu.is_active
  and pu.clinicorp_patient_id is not null;

grant select on public.patient_settlement_status to authenticated;
