-- A mesma pessoa pode ter tratamentos em mais de uma unidade.
-- Quitação e bloqueios operacionais pertencem ao vínculo paciente/unidade.

-- As views dependem de patient_units. Travá-las primeiro mantém a mesma ordem
-- de locks usada pelas leituras do app e evita deadlock durante o ALTER TABLE.
lock table public.collection_queue, public.patient_directory, public.patient_settlement_status
  in access exclusive mode;

create temporary table unit_settlement_repair_patients on commit drop as
select p.id as patient_id, p.settled_at
from public.patients p
where p.settled_at is not null;

alter table public.patient_units
  add column if not exists settled_at timestamptz,
  add column if not exists settled_reason text,
  add column if not exists settled_by uuid references auth.users(id) on delete set null,
  add column if not exists reminder_opt_out boolean not null default false,
  add column if not exists reminder_opt_out_reason text,
  add column if not exists reminder_opt_out_at timestamptz;

create index if not exists patient_units_unit_settled_idx
  on public.patient_units(unit_id, settled_at);

comment on column public.patient_units.settled_at is
  'Data da quitação deste vínculo com a unidade; não encerra tratamentos em outras unidades.';
comment on column public.patient_units.reminder_opt_out is
  'Bloqueia lembretes somente para este vínculo paciente/unidade.';

-- Migra somente baixas com evidência financeira concluída na própria unidade.
update public.patient_units pu
set settled_at = p.settled_at,
    settled_reason = coalesce(p.settled_reason, 'Quitação confirmada pelo Clinicorp'),
    settled_by = p.settled_by,
    reminder_opt_out = true,
    reminder_opt_out_reason = 'Paciente quitado',
    reminder_opt_out_at = coalesce(p.reminder_opt_out_at, p.settled_at),
    updated_at = now()
from public.patients p
where p.id = pu.patient_id
  and p.settled_at is not null
  and exists (
    select 1
    from public.payment_plans proof
    where proof.patient_unit_id = pu.id
      and proof.unit_id = pu.unit_id
      and proof.archived_at is null
      and proof.status = 'completed'
  )
  and not exists (
    select 1
    from public.payment_plans active_plan
    where active_plan.patient_unit_id = pu.id
      and active_plan.unit_id = pu.unit_id
      and active_plan.archived_at is null
      and active_plan.status = 'active'
  )
  and not exists (
    select 1
    from public.payment_plans pp
    join public.installments i
      on i.payment_plan_id = pp.id
     and i.unit_id = pp.unit_id
    where pp.patient_unit_id = pu.id
      and pp.unit_id = pu.unit_id
      and pp.archived_at is null
      and i.status not in ('cancelled', 'refunded')
      and (i.status <> 'paid' or coalesce(i.paid_amount, 0) + 0.01 < coalesce(i.expected_amount, 0))
  );

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
        reminder_opt_out = case
          when p.reminder_opt_out_reason = 'Paciente quitado' then false
          else p.reminder_opt_out
        end,
        reminder_opt_out_reason = case
          when p.reminder_opt_out_reason = 'Paciente quitado' then null
          else p.reminder_opt_out_reason
        end,
        reminder_opt_out_at = case
          when p.reminder_opt_out_reason = 'Paciente quitado' then null
          else p.reminder_opt_out_at
        end,
        updated_at = now()
    where p.id = p_patient_id;
  end if;
end;
$$;

revoke all on function private.sync_global_patient_settlement(bigint) from public;

create or replace function private.sync_patient_unit_parent_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_global_patient_settlement(new.patient_id);
  return new;
end;
$$;

drop trigger if exists sync_patient_unit_parent_state on public.patient_units;
create trigger sync_patient_unit_parent_state
after insert or update of is_active, settled_at, settled_reason on public.patient_units
for each row execute function private.sync_patient_unit_parent_state();

do $$
declare
  v_patient_id bigint;
begin
  for v_patient_id in
    select distinct patient_id from unit_settlement_repair_patients
  loop
    perform private.sync_global_patient_settlement(v_patient_id);
  end loop;
end;
$$;

create or replace function private.guard_settled_financial_task()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.patient_id is not null and exists (
    select 1
    from public.patient_units pu
    where pu.patient_id = new.patient_id
      and pu.unit_id = new.unit_id
      and pu.settled_at is not null
  ) then
    new.status := 'cancelled';
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function private.guard_settled_message_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.patient_id is not null and exists (
    select 1
    from public.patient_units pu
    where pu.patient_id = new.patient_id
      and pu.unit_id = new.unit_id
      and pu.settled_at is not null
  ) then
    new.status := 'cancelled';
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function private.guard_settled_collection_case()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.patient_units pu
    where pu.id = new.patient_unit_id
      and pu.unit_id = new.unit_id
      and pu.settled_at is not null
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

create or replace view public.collection_queue with (security_invoker=true) as
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
where pu.settled_at is null;

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
          or (coalesce(p.reminder_opt_out, false)
              and p.reminder_opt_out_reason is distinct from 'Paciente quitado'))
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
        reminder_opt_out = true,
        reminder_opt_out_reason = 'Paciente quitado',
        reminder_opt_out_at = coalesce(pu.reminder_opt_out_at, v_now),
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
        reminder_opt_out = case
          when pu.reminder_opt_out_reason = 'Paciente quitado' then false
          else pu.reminder_opt_out
        end,
        reminder_opt_out_reason = case
          when pu.reminder_opt_out_reason = 'Paciente quitado' then null
          else pu.reminder_opt_out_reason
        end,
        reminder_opt_out_at = case
          when pu.reminder_opt_out_reason = 'Paciente quitado' then null
          else pu.reminder_opt_out_at
        end,
        is_active = true,
        updated_at = now()
    where pu.id = new.patient_unit_id
      and pu.unit_id = new.unit_id
      and pu.settled_at is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists reopen_patient_unit_for_active_plan on public.payment_plans;
create trigger reopen_patient_unit_for_active_plan
after insert or update of status, archived_at on public.payment_plans
for each row execute function private.reopen_patient_unit_for_active_plan();

create or replace view public.patient_settlement_status with (security_invoker=true) as
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
  where r.patient_unit_id = pu.id and r.status = 'requested'
  order by r.requested_at desc, r.id desc
  limit 1
) req on true;

create or replace view public.patient_directory with (security_invoker=true) as
select
  pu.id as patient_unit_id, p.id as patient_id, pu.clinicorp_patient_id, p.full_name, p.cpf, p.phone, p.email,
  u.id as unit_id, u.code as unit_code, u.name as unit_name, coalesce(ap.treatment, pu.treatment) as treatment,
  ap.payment_method, ap.total_amount as plan_amount, ap.installment_count, ap.due_day, ap.start_date,
  coalesce(ap.issue_invoice_for_ir, p.tax_receipt_ir) as tax_receipt_ir, ap.invoice_frequency_override as invoice_frequency,
  p.notes, pu.is_active, p.created_at, p.updated_at, ap.installment_amount, ap.end_date, ap.first_invoice_date,
  ap.invoice_interval_months, ap.invoice_schedule_mode, ap.invoice_recipient_name, ap.invoice_disabled, ap.invoice_disabled_reason,
  pu.settled_at, pu.settled_reason,
  (coalesce(pu.reminder_opt_out, false)
    or (coalesce(p.reminder_opt_out, false) and p.reminder_opt_out_reason is distinct from 'Paciente quitado')) as reminder_opt_out,
  coalesce(
    pu.reminder_opt_out_reason,
    case when p.reminder_opt_out_reason is distinct from 'Paciente quitado' then p.reminder_opt_out_reason end
  ) as reminder_opt_out_reason
from public.patient_units pu
join public.patients p on p.id = pu.patient_id
join public.units u on u.id = pu.unit_id
left join lateral (
  select pp.*
  from public.payment_plans pp
  where pp.patient_unit_id = pu.id and pp.status = 'active' and pp.archived_at is null
  order by pp.created_at desc, pp.id desc
  limit 1
) ap on true;

-- Encerra operações apenas onde a baixa foi comprovada.
update public.financial_tasks ft
set status = 'cancelled', updated_at = now()
where ft.status in ('pending', 'in_progress')
  and exists (
    select 1 from public.patient_units pu
    where pu.patient_id = ft.patient_id and pu.unit_id = ft.unit_id and pu.settled_at is not null
  );

update public.message_events me
set status = 'cancelled', updated_at = now()
where me.status in ('scheduled', 'processing')
  and exists (
    select 1 from public.patient_units pu
    where pu.patient_id = me.patient_id and pu.unit_id = me.unit_id and pu.settled_at is not null
  );

update public.collection_cases cc
set status = 'closed', outcome = 'paid', closed_at = coalesce(cc.closed_at, now()),
    next_action_at = null, updated_at = now()
where cc.status not in ('paid', 'closed')
  and exists (
    select 1 from public.patient_units pu
    where pu.id = cc.patient_unit_id and pu.unit_id = cc.unit_id and pu.settled_at is not null
  );

-- Reabre casos que foram encerrados apenas porque outra unidade quitou a pessoa.
create temporary table unit_settlement_reopened_cases on commit drop as
select cc.id
from public.collection_cases cc
join public.patient_units pu on pu.id = cc.patient_unit_id and pu.unit_id = cc.unit_id
join public.installments i on i.id = cc.installment_id and i.unit_id = cc.unit_id
join unit_settlement_repair_patients rp on rp.patient_id = pu.patient_id
where pu.settled_at is null
  and cc.status in ('paid', 'closed')
  and cc.outcome = 'paid'
  and i.status not in ('paid', 'cancelled', 'refunded')
  and coalesce(i.paid_amount, 0) + 0.01 < coalesce(i.expected_amount, 0);

update public.collection_cases cc
set status = case latest.outcome
      when 'promise' then 'promise'
      when 'protest' then 'protested'
      when 'no_contact' then 'pending_contact'
      else case when latest.outcome is null then 'pending_contact' else 'negotiating' end
    end,
    outcome = case latest.outcome
      when 'promise' then 'agreement'
      when 'protest' then 'protested'
      else null
    end,
    next_action_at = latest.next_action_at,
    closed_at = null,
    updated_at = now()
from unit_settlement_reopened_cases reopened
left join lateral (
  select ci.outcome, ci.next_action_at
  from public.collection_interactions ci
  where ci.collection_case_id = reopened.id
  order by ci.occurred_at desc, ci.id desc
  limit 1
) latest on true
where cc.id = reopened.id;

update public.financial_tasks ft
set status = 'pending', completed_at = null, updated_at = now()
where ft.status = 'cancelled'
  and ft.collection_case_id in (select id from unit_settlement_reopened_cases)
  and ft.kind in ('collection_call', 'payment_promise');

-- Reexecuta os agendadores com os guardas já corrigidos por unidade.
update public.installments i
set status = i.status
from public.payment_plans pp
join public.patient_units pu on pu.id = pp.patient_unit_id and pu.unit_id = pp.unit_id
join unit_settlement_repair_patients rp on rp.patient_id = pu.patient_id
where i.payment_plan_id = pp.id
  and i.unit_id = pp.unit_id
  and pu.settled_at is null
  and i.status in ('pending', 'processing', 'overdue');

grant select on public.patient_settlement_status to authenticated;
grant select on public.patient_directory to authenticated;
