-- Quitação impede cobranças e lembretes pelo estado settled_at.
-- reminder_opt_out fica reservado às exceções escolhidas manualmente pela equipe.

update public.patient_units
set reminder_opt_out = false,
    reminder_opt_out_reason = null,
    reminder_opt_out_at = null,
    updated_at = now()
where reminder_opt_out_reason = 'Paciente quitado';

update public.patients
set reminder_opt_out = false,
    reminder_opt_out_reason = null,
    reminder_opt_out_at = null,
    reminder_opt_out_by = null,
    updated_at = now()
where reminder_opt_out_reason = 'Paciente quitado';

comment on column public.patients.reminder_opt_out is
  'Exceção manual aos lembretes de pagamento, definida pela equipe na lista de aprovação.';
comment on column public.patient_units.reminder_opt_out is
  'Exceção manual aos lembretes deste vínculo; quitação é controlada separadamente por settled_at.';

create or replace function private.sync_global_patient_settlement(p_patient_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_active_unit boolean;
  v_all_active_units_settled boolean;
  v_settled_at timestamptz;
begin
  select
    exists(
      select 1 from public.patient_units pu
      where pu.patient_id = p_patient_id and pu.is_active
    ),
    not exists(
      select 1 from public.patient_units pu
      where pu.patient_id = p_patient_id and pu.is_active and pu.settled_at is null
    ),
    max(pu.settled_at)
  into v_has_active_unit, v_all_active_units_settled, v_settled_at
  from public.patient_units pu
  where pu.patient_id = p_patient_id and pu.is_active;

  if v_has_active_unit and v_all_active_units_settled then
    update public.patients p
    set status = 'inactive',
        settled_at = coalesce(p.settled_at, v_settled_at, now()),
        settled_reason = coalesce(p.settled_reason, 'Quitação confirmada em todas as unidades'),
        updated_at = now()
    where p.id = p_patient_id;
  else
    update public.patients p
    set status = 'active',
        settled_at = null,
        settled_by = null,
        settled_reason = null,
        updated_at = now()
    where p.id = p_patient_id;
  end if;
end;
$$;

revoke all on function private.sync_global_patient_settlement(bigint) from public;

create or replace function private.sync_installment_payment_reminder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.payment_plans%rowtype;
  v_patient_id bigint;
  v_patient_name text;
  v_assignee uuid;
  v_days integer := 1;
  v_patient_blocked boolean := false;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select pp.* into v_plan
  from public.payment_plans pp
  where pp.id = new.payment_plan_id and pp.unit_id = new.unit_id;
  if not found then return new; end if;

  select p.id, p.full_name,
         (pu.settled_at is not null
          or coalesce(pu.reminder_opt_out, false)
          or coalesce(p.reminder_opt_out, false))
    into v_patient_id, v_patient_name, v_patient_blocked
  from public.patient_units pu
  join public.patients p on p.id = pu.patient_id
  where pu.id = v_plan.patient_unit_id and pu.unit_id = new.unit_id;

  select u.payment_reminder_assignee_user_id, coalesce(u.payment_reminder_days_before, 1)
    into v_assignee, v_days
  from public.units u where u.id = new.unit_id;

  if v_plan.status = 'active'
     and v_plan.archived_at is null
     and v_plan.payment_method = 'boleto'
     and not coalesce(v_patient_blocked, false)
     and v_assignee is not null
     and new.status in ('pending', 'processing', 'overdue')
     and new.due_date > v_today then
    insert into public.financial_tasks(
      unit_id, patient_id, installment_id, assigned_to, title, description,
      kind, status, due_at, created_by, task_key
    ) values (
      new.unit_id, v_patient_id, new.id, v_assignee,
      'Lembrete D-1 do boleto',
      concat(coalesce(v_patient_name, 'Paciente'), ' • parcela ', coalesce(new.installment_number::text, '?'), ' • vencimento ', to_char(new.due_date, 'DD/MM/YYYY')),
      'payment_reminder', 'pending',
      ((new.due_date - v_days)::timestamp at time zone 'America/Sao_Paulo'),
      coalesce(v_plan.updated_by, v_plan.created_by),
      concat('payment_reminder:', new.id)
    )
    on conflict (task_key) where task_key is not null do update
    set assigned_to = excluded.assigned_to,
        patient_id = excluded.patient_id,
        installment_id = excluded.installment_id,
        title = excluded.title,
        description = excluded.description,
        due_at = excluded.due_at,
        status = case when public.financial_tasks.status = 'completed' then 'completed' else 'pending' end;
  else
    update public.financial_tasks ft
    set status = 'cancelled'
    where ft.task_key = concat('payment_reminder:', new.id)
      and ft.status in ('pending', 'in_progress');
  end if;

  return new;
end;
$$;

create or replace function private.reconcile_clinicorp_plan_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.payment_plans%rowtype;
  v_patient_id bigint;
  v_has_open_installment boolean;
  v_has_other_active_plan boolean;
  v_now timestamptz := now();
begin
  if new.payment_plan_id is null then return new; end if;

  if new.confirmed_at is null
     or (new.clinicorp_installment_id is null and coalesce(new.metadata ->> 'clinicorp_patient_id', '') = '') then
    return new;
  end if;

  select pp.* into v_plan
  from public.payment_plans pp
  where pp.id = new.payment_plan_id;
  if not found then return new; end if;

  if v_plan.source = 'clinicorp'
     and coalesce(v_plan.metadata ->> 'clinicorp_schedule_complete', 'false') <> 'true' then
    return new;
  end if;

  select exists(
    select 1
    from public.installments i
    where i.payment_plan_id = v_plan.id
      and i.status not in ('cancelled', 'refunded')
      and (i.status <> 'paid' or coalesce(i.paid_amount, 0) + 0.01 < coalesce(i.expected_amount, 0))
  ) into v_has_open_installment;

  if v_has_open_installment then return new; end if;

  update public.payment_plans
  set status = 'completed', updated_at = v_now
  where id = v_plan.id and status = 'active';

  update public.clinicorp_settlement_requests
  set status = 'confirmed',
      confirmed_at = coalesce(confirmed_at, v_now),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'confirmed_by', 'clinicorp_sync',
        'confirmed_installment_id', new.id
      )
  where payment_plan_id = v_plan.id and status = 'requested';

  select pu.patient_id into v_patient_id
  from public.patient_units pu
  where pu.id = v_plan.patient_unit_id and pu.unit_id = v_plan.unit_id;
  if v_patient_id is null then return new; end if;

  select exists(
    select 1
    from public.payment_plans pp
    where pp.patient_unit_id = v_plan.patient_unit_id
      and pp.unit_id = v_plan.unit_id
      and pp.archived_at is null
      and pp.status = 'active'
  ) into v_has_other_active_plan;

  if not v_has_other_active_plan then
    update public.patient_units pu
    set settled_at = coalesce(pu.settled_at, v_now),
        settled_reason = coalesce(pu.settled_reason, 'Quitação confirmada pelo Clinicorp'),
        updated_at = v_now
    where pu.id = v_plan.patient_unit_id and pu.unit_id = v_plan.unit_id;

    update public.financial_tasks ft
    set status = 'cancelled', updated_at = v_now
    where ft.patient_id = v_patient_id
      and ft.unit_id = v_plan.unit_id
      and ft.status in ('pending', 'in_progress');

    update public.message_events me
    set status = 'cancelled', updated_at = v_now
    where me.patient_id = v_patient_id
      and me.unit_id = v_plan.unit_id
      and me.status in ('scheduled', 'processing');

    update public.collection_cases cc
    set status = 'closed', outcome = 'paid', closed_at = coalesce(cc.closed_at, v_now),
        next_action_at = null, updated_at = v_now
    where cc.patient_unit_id = v_plan.patient_unit_id
      and cc.unit_id = v_plan.unit_id
      and cc.status not in ('paid', 'closed');
  end if;

  return new;
end;
$$;

create or replace function private.reopen_patient_unit_for_active_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and new.archived_at is null then
    update public.patient_units pu
    set settled_at = null,
        settled_reason = null,
        settled_by = null,
        is_active = true,
        updated_at = now()
    where pu.id = new.patient_unit_id
      and pu.unit_id = new.unit_id
      and pu.settled_at is not null;
  end if;
  return new;
end;
$$;

create or replace view public.patient_directory with (security_invoker=true) as
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
  where pp.patient_unit_id = pu.id and pp.status = 'active' and pp.archived_at is null
  order by pp.created_at desc, pp.id desc
  limit 1
) ap on true
where pu.is_active;

grant select on public.patient_directory to authenticated;
