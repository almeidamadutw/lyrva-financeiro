
-- Re-run the already-tested unit-repair block after late Clinicorp links arrive.
-- Keep the current schema/view behavior; only reuse the repair DO block.

alter table public.patient_units disable trigger guard_collection_import_unit;
alter table public.patients disable trigger preserve_settled_patient;

do $outer$
declare
  v_migration text;
  v_start integer;
  v_end integer;
  v_do text;
begin
  select statements[1]
    into v_migration
  from supabase_migrations.schema_migrations
  where version = '20260918184551';

  if v_migration is null then
    raise exception 'Base unit-repair migration not found';
  end if;

  v_start := position('do $$' in lower(v_migration));
  v_end := position('alter table public.patients enable trigger preserve_settled_patient' in lower(v_migration));

  if v_start = 0 or v_end = 0 or v_end <= v_start then
    raise exception 'Could not isolate the prior unit-repair block';
  end if;

  v_do := substring(v_migration from v_start for v_end - v_start);
  execute v_do;
end;
$outer$;

alter table public.patients enable trigger preserve_settled_patient;
alter table public.patient_units enable trigger guard_collection_import_unit;

create or replace view public.unit_assignment_conflicts
with (security_invoker=true)
as
select
  pu.id as patient_unit_id,
  pu.patient_id,
  p.full_name,
  pu.unit_id as imported_unit_id,
  u_import.code as imported_unit_code,
  u_import.name as imported_unit_name,
  canonical.unit_id as clinicorp_unit_id,
  u_canonical.code as clinicorp_unit_code,
  u_canonical.name as clinicorp_unit_name,
  pu.source,
  pu.metadata,
  pu.created_at,
  pu.updated_at
from public.patient_units pu
join public.patients p on p.id = pu.patient_id
join public.units u_import on u_import.id = pu.unit_id
join lateral (
  select min(x.unit_id) as unit_id, count(distinct x.unit_id) as unit_count
  from public.patient_units x
  where x.patient_id = pu.patient_id
    and x.clinicorp_patient_id is not null
) canonical on canonical.unit_count = 1 and canonical.unit_id <> pu.unit_id
join public.units u_canonical on u_canonical.id = canonical.unit_id
where pu.is_active
  and pu.source = 'import'
  and coalesce((pu.metadata ->> 'collection_workbook')::boolean, false)
  and not exists (
    select 1
    from public.patient_units same_unit
    where same_unit.patient_id = pu.patient_id
      and same_unit.unit_id = pu.unit_id
      and same_unit.clinicorp_patient_id is not null
  );

grant select on public.unit_assignment_conflicts to authenticated;

create or replace view public.patient_directory
with (security_invoker=true)
as
select
  pu.id as patient_unit_id, p.id as patient_id, pu.clinicorp_patient_id, p.full_name, p.cpf, p.phone, p.email,
  u.id as unit_id, u.code as unit_code, u.name as unit_name, coalesce(ap.treatment, pu.treatment) as treatment,
  ap.payment_method, ap.total_amount as plan_amount, ap.installment_count, ap.due_day, ap.start_date,
  coalesce(ap.issue_invoice_for_ir, p.tax_receipt_ir) as tax_receipt_ir, ap.invoice_frequency_override as invoice_frequency,
  p.notes, pu.is_active, p.created_at, p.updated_at, ap.installment_amount, ap.end_date, ap.first_invoice_date,
  ap.invoice_interval_months, ap.invoice_schedule_mode, ap.invoice_recipient_name, ap.invoice_disabled, ap.invoice_disabled_reason,
  pu.settled_at, pu.settled_reason,
  (coalesce(pu.reminder_opt_out, false) or coalesce(p.reminder_opt_out, false)) as reminder_opt_out,
  coalesce(pu.reminder_opt_out_reason, p.reminder_opt_out_reason) as reminder_opt_out_reason
from public.patient_units pu
join public.patients p on p.id = pu.patient_id
join public.units u on u.id = pu.unit_id
left join lateral (
  select pp.*
  from public.payment_plans pp
  where pp.patient_unit_id = pu.id
    and pp.status = 'active'
    and pp.archived_at is null
  order by pp.created_at desc, pp.id desc
  limit 1
) ap on true
where pu.is_active
  and not (
    pu.source = 'import'
    and coalesce((pu.metadata ->> 'collection_workbook')::boolean, false)
    and exists (
      select 1 from public.patient_units other_clinicorp
      where other_clinicorp.patient_id = pu.patient_id
        and other_clinicorp.unit_id <> pu.unit_id
        and other_clinicorp.clinicorp_patient_id is not null
    )
    and not exists (
      select 1 from public.patient_units same_clinicorp
      where same_clinicorp.patient_id = pu.patient_id
        and same_clinicorp.unit_id = pu.unit_id
        and same_clinicorp.clinicorp_patient_id is not null
    )
  );

grant select on public.patient_directory to authenticated;

create or replace view public.collection_queue
with (security_invoker=true)
as
select
  cc.id, cc.unit_id, u.name as unit_name, p.id as patient_id, p.full_name as patient_name, p.phone,
  pu.clinicorp_patient_id, cc.installment_id, i.due_date,
  greatest(i.expected_amount - i.paid_amount, 0::numeric) as open_amount,
  cc.eligible_at, cc.status, cc.responsible_user_id, cc.next_action_at, cc.protested_at, cc.notes, cc.updated_at,
  u.code as unit_code, i.installment_number, i.expected_amount, i.paid_amount, i.status as installment_status,
  cc.outcome, coalesce(pr.full_name, 'Sem responsável'::text) as responsible_name, cc.opened_at
from public.collection_cases cc
join public.installments i on i.id = cc.installment_id and i.unit_id = cc.unit_id
join public.patient_units pu on pu.id = cc.patient_unit_id and pu.unit_id = cc.unit_id
join public.patients p on p.id = pu.patient_id
join public.units u on u.id = cc.unit_id
left join public.profiles pr on pr.user_id = cc.responsible_user_id
where pu.settled_at is null
  and cc.status not in ('paid','closed')
  and i.status not in ('paid','cancelled','refunded')
  and greatest(i.expected_amount - i.paid_amount, 0::numeric) > 0
  and cc.eligible_at <= (now() at time zone 'America/Sao_Paulo')::date
  and not (
    pu.source = 'import'
    and coalesce((pu.metadata ->> 'collection_workbook')::boolean, false)
    and exists (
      select 1 from public.patient_units other_clinicorp
      where other_clinicorp.patient_id = pu.patient_id
        and other_clinicorp.unit_id <> pu.unit_id
        and other_clinicorp.clinicorp_patient_id is not null
    )
    and not exists (
      select 1 from public.patient_units same_clinicorp
      where same_clinicorp.patient_id = pu.patient_id
        and same_clinicorp.unit_id = pu.unit_id
        and same_clinicorp.clinicorp_patient_id is not null
    )
  );

grant select on public.collection_queue to authenticated;

create or replace function public.get_collection_queue_page(
  p_unit_code text default null,
  p_offset integer default 0,
  p_limit integer default 500
)
returns table(
  id bigint, unit_id bigint, unit_name text, unit_code text, patient_id bigint, patient_name text,
  phone text, installment_id bigint, installment_number integer, due_date date, open_amount numeric,
  eligible_at date, status text, responsible_user_id uuid, responsible_name text,
  next_action_at timestamptz, protested_at timestamptz, notes text, installment_status text
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
        p_unit_code is null or p_unit_code = '' or p_unit_code = 'todas' or u.code = p_unit_code
      )
  )
  select
    cc.id, cc.unit_id, u.name, u.code, p.id, p.full_name, p.phone, cc.installment_id,
    i.installment_number, i.due_date, greatest(i.expected_amount - i.paid_amount, 0::numeric),
    cc.eligible_at, cc.status, cc.responsible_user_id,
    coalesce(pr.full_name, 'Sem responsável'::text), cc.next_action_at, cc.protested_at, cc.notes, i.status
  from public.collection_cases cc
  join allowed_units u on u.id = cc.unit_id
  join public.installments i on i.id = cc.installment_id and i.unit_id = cc.unit_id
  join public.patient_units pu on pu.id = cc.patient_unit_id and pu.unit_id = cc.unit_id
  join public.patients p on p.id = pu.patient_id
  left join public.profiles pr on pr.user_id = cc.responsible_user_id
  where pu.settled_at is null
    and cc.status not in ('paid','closed')
    and i.status not in ('paid','cancelled','refunded')
    and greatest(i.expected_amount - i.paid_amount, 0::numeric) > 0
    and cc.eligible_at <= (now() at time zone 'America/Sao_Paulo')::date
    and not (
      pu.source = 'import'
      and coalesce((pu.metadata ->> 'collection_workbook')::boolean, false)
      and exists (
        select 1 from public.patient_units other_clinicorp
        where other_clinicorp.patient_id = pu.patient_id
          and other_clinicorp.unit_id <> pu.unit_id
          and other_clinicorp.clinicorp_patient_id is not null
      )
      and not exists (
        select 1 from public.patient_units same_clinicorp
        where same_clinicorp.patient_id = pu.patient_id
          and same_clinicorp.unit_id = pu.unit_id
          and same_clinicorp.clinicorp_patient_id is not null
      )
    )
  order by cc.eligible_at asc, cc.id asc
  offset greatest(coalesce(p_offset,0),0)
  limit least(greatest(coalesce(p_limit,500),1),1000);
$$;

revoke all on function public.get_collection_queue_page(text,integer,integer) from public,anon;
grant execute on function public.get_collection_queue_page(text,integer,integer) to authenticated;
