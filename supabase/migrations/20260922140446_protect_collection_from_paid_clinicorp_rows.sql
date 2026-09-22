
-- Clinicorp source state is authoritative for collection eligibility.
-- A row marked received/confirmed by Clinicorp must never enter the collection workflow.

create index if not exists integration_source_records_clinicorp_payload_id_idx
  on public.integration_source_records(unit_id, ((payload ->> 'id')))
  where provider = 'clinicorp';

alter table public.installments
  add column if not exists clinicorp_source_state text not null default 'unknown';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'installments_clinicorp_source_state_check'
      and conrelid = 'public.installments'::regclass
  ) then
    alter table public.installments
      add constraint installments_clinicorp_source_state_check
      check (clinicorp_source_state in ('unknown','open','paid','cancelled'));
  end if;
end;
$$;

create index if not exists installments_collection_source_state_idx
  on public.installments(unit_id, clinicorp_source_state, due_date, status)
  where source = 'clinicorp';

update public.installments i
set clinicorp_source_state = case
  when i.status = 'paid' then 'paid'
  when i.status in ('cancelled','refunded') then 'cancelled'
  when exists (
    select 1
    from public.integration_source_records r
    where r.provider = 'clinicorp'
      and r.unit_id = i.unit_id
      and r.payload ->> 'id' = i.clinicorp_installment_id
      and (
        upper(coalesce(r.payload ->> 'PaymentConfirmed','')) = 'X'
        or upper(coalesce(r.payload ->> 'PaymentReceived','')) = 'X'
      )
  ) then 'paid'
  when exists (
    select 1
    from public.integration_source_records r
    where r.provider = 'clinicorp'
      and r.unit_id = i.unit_id
      and r.payload ->> 'id' = i.clinicorp_installment_id
      and (
        upper(coalesce(r.payload ->> 'Canceled','')) = 'X'
        or upper(coalesce(r.payload ->> 'CancelInstallment','')) = 'X'
      )
  ) then 'cancelled'
  when exists (
    select 1
    from public.integration_source_records r
    where r.provider = 'clinicorp'
      and r.unit_id = i.unit_id
      and r.payload ->> 'id' = i.clinicorp_installment_id
  ) then 'open'
  else 'unknown'
end,
updated_at = now()
where i.source = 'clinicorp';

create or replace function private.set_clinicorp_installment_source_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if new.source is distinct from 'clinicorp' then
    new.clinicorp_source_state := 'unknown';
    return new;
  end if;

  if new.status = 'paid' then
    new.clinicorp_source_state := 'paid';
    return new;
  end if;

  if new.status in ('cancelled','refunded') then
    new.clinicorp_source_state := 'cancelled';
    return new;
  end if;

  v_state := null;

  if new.clinicorp_installment_id is not null then
    select case
      when (
        upper(coalesce(r.payload ->> 'PaymentConfirmed','')) = 'X'
        or upper(coalesce(r.payload ->> 'PaymentReceived','')) = 'X'
      ) then 'paid'
      when (
        upper(coalesce(r.payload ->> 'Canceled','')) = 'X'
        or upper(coalesce(r.payload ->> 'CancelInstallment','')) = 'X'
      ) then 'cancelled'
      else 'open'
    end
    into v_state
    from public.integration_source_records r
    where r.provider = 'clinicorp'
      and r.unit_id = new.unit_id
      and r.payload ->> 'id' = new.clinicorp_installment_id
    order by r.last_seen_at desc, r.id desc
    limit 1;
  end if;

  new.clinicorp_source_state := coalesce(v_state, 'unknown');
  return new;
end;
$$;

drop trigger if exists set_clinicorp_installment_source_state on public.installments;
create trigger set_clinicorp_installment_source_state
before insert or update of source, status, clinicorp_installment_id, unit_id
on public.installments
for each row execute function private.set_clinicorp_installment_source_state();

create or replace function private.sync_installment_collection_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_payment_method text;
  v_plan_source text;
  v_patient_unit_id bigint;
  v_patient_id bigint;
  v_patient_name text;
  v_assignee uuid;
  v_days integer := 3;
  v_eligible_at date;
  v_case_id bigint;
begin
  select
    pp.payment_method,
    pp.source,
    pp.patient_unit_id,
    u.collection_assignee_user_id,
    coalesce(u.collection_start_business_days, 3),
    pu.patient_id,
    p.full_name
  into
    v_payment_method,
    v_plan_source,
    v_patient_unit_id,
    v_assignee,
    v_days,
    v_patient_id,
    v_patient_name
  from public.payment_plans pp
  join public.units u on u.id = pp.unit_id
  join public.patient_units pu on pu.id = pp.patient_unit_id and pu.unit_id = pp.unit_id
  join public.patients p on p.id = pu.patient_id
  where pp.id = new.payment_plan_id
    and pp.unit_id = new.unit_id
    and pp.archived_at is null;

  if not found then
    return new;
  end if;

  if new.status in ('paid','cancelled','refunded')
     or new.source is distinct from 'clinicorp'
     or v_plan_source is distinct from 'clinicorp'
     or new.clinicorp_source_state is distinct from 'open' then

    update public.collection_cases cc
    set status = case
          when new.status = 'paid' or new.clinicorp_source_state = 'paid' then 'paid'
          else 'closed'
        end,
        outcome = case
          when new.status = 'paid' or new.clinicorp_source_state = 'paid' then 'paid'
          else 'cancelled'
        end,
        closed_at = coalesce(cc.closed_at, now()),
        next_action_at = null,
        updated_at = now()
    where cc.installment_id = new.id
      and cc.unit_id = new.unit_id
      and cc.status not in ('paid','closed');

    update public.financial_tasks ft
    set status = 'cancelled', updated_at = now()
    where ft.installment_id = new.id
      and ft.kind in ('payment_reminder','collection_call','payment_promise')
      and ft.status in ('pending','in_progress');

    return new;
  end if;

  if v_payment_method is distinct from 'boleto' then
    update public.collection_cases cc
    set status = 'closed',
        outcome = 'cancelled',
        closed_at = coalesce(cc.closed_at, now()),
        next_action_at = null,
        updated_at = now()
    where cc.installment_id = new.id
      and cc.unit_id = new.unit_id
      and cc.status not in ('paid','closed');

    update public.financial_tasks ft
    set status = 'cancelled', updated_at = now()
    where ft.installment_id = new.id
      and ft.kind in ('payment_reminder','collection_call','payment_promise')
      and ft.status in ('pending','in_progress');

    return new;
  end if;

  if new.status not in ('pending','overdue') or v_assignee is null then
    return new;
  end if;

  v_eligible_at := private.add_business_days(new.due_date, v_days);

  insert into public.collection_cases (
    unit_id, patient_unit_id, installment_id, responsible_user_id,
    eligible_at, status, next_action_at, notes
  ) values (
    new.unit_id, v_patient_unit_id, new.id, v_assignee,
    v_eligible_at, 'pending_contact',
    (v_eligible_at::timestamp at time zone 'America/Sao_Paulo'),
    concat('Entrada automática na régua após ', v_days, ' dias úteis do vencimento.')
  )
  on conflict (installment_id) do update
    set responsible_user_id = excluded.responsible_user_id,
        eligible_at = excluded.eligible_at,
        status = case
          when public.collection_cases.status in ('paid','closed') then 'pending_contact'
          else public.collection_cases.status
        end,
        outcome = case
          when public.collection_cases.status in ('paid','closed') then null
          else public.collection_cases.outcome
        end,
        closed_at = case
          when public.collection_cases.status in ('paid','closed') then null
          else public.collection_cases.closed_at
        end,
        next_action_at = case
          when public.collection_cases.status in ('pending_contact','paid','closed') then excluded.next_action_at
          else public.collection_cases.next_action_at
        end,
        updated_at = now()
  returning id into v_case_id;

  insert into public.financial_tasks (
    unit_id, patient_id, installment_id, collection_case_id, assigned_to,
    title, description, kind, status, due_at, task_key
  ) values (
    new.unit_id, v_patient_id, new.id, v_case_id, v_assignee,
    'Iniciar régua de cobrança',
    concat(coalesce(v_patient_name, 'Paciente'), ' • parcela ',
      coalesce(new.installment_number::text, '—'), ' • venceu em ',
      to_char(new.due_date, 'DD/MM/YYYY')),
    'collection_call', 'pending',
    (v_eligible_at::timestamp at time zone 'America/Sao_Paulo'),
    concat('collection_call:', new.id)
  )
  on conflict (task_key) where task_key is not null do update
    set assigned_to = excluded.assigned_to,
        collection_case_id = excluded.collection_case_id,
        patient_id = excluded.patient_id,
        installment_id = excluded.installment_id,
        description = excluded.description,
        due_at = excluded.due_at,
        status = case
          when public.financial_tasks.status = 'completed' then public.financial_tasks.status
          else 'pending'
        end,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists sync_collection_schedule on public.installments;
create trigger sync_collection_schedule
after insert or update of status, due_date, expected_amount, clinicorp_source_state
on public.installments
for each row execute function private.sync_installment_collection_schedule();

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

  if not found then
    return new;
  end if;

  select
    p.id,
    p.full_name,
    (
      pu.settled_at is not null
      or coalesce(pu.reminder_opt_out, false)
      or coalesce(p.reminder_opt_out, false)
    )
  into v_patient_id, v_patient_name, v_patient_blocked
  from public.patient_units pu
  join public.patients p on p.id = pu.patient_id
  where pu.id = v_plan.patient_unit_id and pu.unit_id = new.unit_id;

  select
    u.payment_reminder_assignee_user_id,
    coalesce(u.payment_reminder_days_before, 1)
  into v_assignee, v_days
  from public.units u
  where u.id = new.unit_id;

  if v_plan.source = 'clinicorp'
     and new.source = 'clinicorp'
     and new.clinicorp_source_state = 'open'
     and v_plan.status = 'active'
     and v_plan.archived_at is null
     and v_plan.payment_method = 'boleto'
     and not coalesce(v_patient_blocked, false)
     and v_assignee is not null
     and new.status in ('pending','processing','overdue')
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
        status = case when public.financial_tasks.status = 'completed' then 'completed' else 'pending' end,
        updated_at = now();
  else
    update public.financial_tasks ft
    set status = 'cancelled', updated_at = now()
    where ft.task_key = concat('payment_reminder:', new.id)
      and ft.status in ('pending','in_progress');
  end if;

  return new;
end;
$$;

drop trigger if exists sync_installment_payment_reminder on public.installments;
create trigger sync_installment_payment_reminder
after insert or update of due_date, status, expected_amount, payment_plan_id, clinicorp_source_state
on public.installments
for each row execute function private.sync_installment_payment_reminder();

-- Clean already-created operational artifacts that Clinicorp says are not collectible.
update public.collection_cases cc
set status = case when i.clinicorp_source_state = 'paid' then 'paid' else 'closed' end,
    outcome = case when i.clinicorp_source_state = 'paid' then 'paid' else 'cancelled' end,
    closed_at = coalesce(cc.closed_at, now()),
    next_action_at = null,
    notes = concat_ws(E'\n', cc.notes,
      case
        when i.clinicorp_source_state = 'paid'
          then 'Encerrado automaticamente: Clinicorp informa pagamento recebido/confirmado.'
        else 'Suspenso automaticamente: parcela ainda não está confirmada como aberta pelo Clinicorp.'
      end),
    updated_at = now()
from public.installments i
join public.payment_plans pp on pp.id = i.payment_plan_id
where cc.installment_id = i.id
  and pp.source = 'clinicorp'
  and i.source = 'clinicorp'
  and i.clinicorp_source_state <> 'open'
  and cc.status not in ('paid','closed');

update public.financial_tasks ft
set status = 'cancelled', updated_at = now()
from public.installments i
join public.payment_plans pp on pp.id = i.payment_plan_id
where ft.installment_id = i.id
  and pp.source = 'clinicorp'
  and i.source = 'clinicorp'
  and i.clinicorp_source_state <> 'open'
  and ft.kind in ('payment_reminder','collection_call','payment_promise')
  and ft.status in ('pending','in_progress');

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
join public.installments i on i.id = cc.installment_id and i.unit_id = cc.unit_id
join public.payment_plans pp on pp.id = i.payment_plan_id and pp.unit_id = i.unit_id
join public.patient_units pu on pu.id = cc.patient_unit_id and pu.unit_id = cc.unit_id
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
  and i.clinicorp_source_state = 'open'
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
    and i.clinicorp_source_state = 'open'
    and i.status not in ('paid','cancelled','refunded')
    and greatest(i.expected_amount - i.paid_amount, 0::numeric) > 0
    and cc.eligible_at <= (now() at time zone 'America/Sao_Paulo')::date
  order by cc.eligible_at asc, cc.id asc
  offset greatest(coalesce(p_offset,0),0)
  limit least(greatest(coalesce(p_limit,500),1),1000);
$$;

revoke all on function public.get_collection_queue_page(text,integer,integer) from public,anon;
grant execute on function public.get_collection_queue_page(text,integer,integer) to authenticated;
