
alter table public.collection_interactions
  drop constraint if exists collection_interactions_outcome_check;

alter table public.collection_interactions
  add constraint collection_interactions_outcome_check
  check (outcome = any (array[
    'contact'::text,
    'no_contact'::text,
    'promise'::text,
    'negotiation'::text,
    'renegotiated'::text,
    'payment'::text,
    'protest'::text,
    'note'::text
  ]));

create or replace function public.register_collection_interaction(
  p_case_id bigint,
  p_outcome text,
  p_notes text,
  p_next_action_at timestamp with time zone default null::timestamp with time zone,
  p_channel text default 'call'::text
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_case public.collection_cases%rowtype;
  v_interaction_id bigint;
  v_new_status text;
  v_case_outcome text;
  v_task_kind text;
  v_task_key text;
  v_title text;
  v_patient_id bigint;
  v_patient_name text;
begin
  if v_user_id is null or not private.current_user_active() then
    raise exception using errcode='42501', message='Entre no LYVRA para registrar a cobrança.';
  end if;

  if p_outcome not in ('contact','no_contact','promise','negotiation','renegotiated','payment','protest','note') then
    raise exception using errcode='22023', message='Resultado da cobrança inválido.';
  end if;
  if p_channel not in ('call','whatsapp','in_person','email','system') then
    raise exception using errcode='22023', message='Canal de contato inválido.';
  end if;
  if length(btrim(coalesce(p_notes,''))) < 2 then
    raise exception using errcode='22023', message='Descreva o que aconteceu no contato.';
  end if;

  select * into v_case
  from public.collection_cases
  where id = p_case_id
  for update;

  if not found then
    raise exception using errcode='22023', message='Caso de cobrança não encontrado.';
  end if;

  if not private.current_user_can_manage_collections(v_case.unit_id) then
    raise exception using errcode='42501', message='Este acesso não possui permissão para operar a régua de cobrança desta unidade.';
  end if;

  if v_case.status in ('paid','closed') then
    raise exception using errcode='22023', message='Este caso já foi encerrado.';
  end if;

  insert into public.collection_interactions(
    unit_id, collection_case_id, performed_by, channel, outcome, notes, next_action_at
  ) values (
    v_case.unit_id, v_case.id, v_user_id, p_channel, p_outcome, btrim(p_notes),
    case when p_outcome in ('payment','renegotiated') then null else p_next_action_at end
  ) returning id into v_interaction_id;

  v_new_status := case
    when p_outcome = 'promise' then 'promise'
    when p_outcome = 'protest' then 'protested'
    when p_outcome = 'payment' then 'paid'
    when p_outcome = 'renegotiated' then 'closed'
    when p_outcome = 'no_contact' then 'pending_contact'
    else 'negotiating'
  end;

  v_case_outcome := case
    when p_outcome = 'payment' then 'paid'
    when p_outcome in ('promise','renegotiated') then 'agreement'
    when p_outcome = 'protest' then 'protested'
    else null
  end;

  update public.collection_cases cc
  set status = v_new_status,
      next_action_at = case when p_outcome in ('payment','renegotiated') then null else p_next_action_at end,
      protested_at = case when p_outcome='protest' then coalesce(cc.protested_at,now()) else cc.protested_at end,
      closed_at = case when p_outcome in ('payment','renegotiated') then coalesce(cc.closed_at,now()) else cc.closed_at end,
      outcome = coalesce(v_case_outcome,cc.outcome),
      updated_at = now()
  where cc.id = v_case.id;

  update public.financial_tasks ft
  set status = 'completed', completed_at = coalesce(ft.completed_at,now()), updated_at=now()
  where ft.collection_case_id = v_case.id
    and ft.status in ('pending','in_progress')
    and (
      p_outcome in ('payment','protest','renegotiated')
      or ft.due_at <= now() + interval '1 day'
    );

  if p_next_action_at is not null and p_outcome not in ('payment','protest','renegotiated') then
    select pu.patient_id,p.full_name into v_patient_id,v_patient_name
    from public.patient_units pu
    join public.patients p on p.id=pu.patient_id
    where pu.id=v_case.patient_unit_id and pu.unit_id=v_case.unit_id;

    v_task_kind := case when p_outcome='promise' then 'payment_promise' else 'collection_call' end;
    v_title := case when p_outcome='promise' then 'Confirmar promessa de pagamento' else 'Retomar cobrança' end;
    v_task_key := concat('collection_followup:',v_case.id,':',v_task_kind,':',to_char(p_next_action_at at time zone 'America/Sao_Paulo','YYYYMMDDHH24MI'));

    insert into public.financial_tasks(
      unit_id,patient_id,installment_id,collection_case_id,assigned_to,
      title,description,kind,status,due_at,created_by,task_key
    ) values (
      v_case.unit_id,v_patient_id,v_case.installment_id,v_case.id,
      coalesce(v_case.responsible_user_id,v_user_id),
      v_title,concat(coalesce(v_patient_name,'Paciente'),' • retorno da régua de cobrança'),
      v_task_kind,'pending',p_next_action_at,v_user_id,v_task_key
    )
    on conflict (task_key) where task_key is not null do update
      set assigned_to=excluded.assigned_to,
          due_at=excluded.due_at,
          description=excluded.description,
          status=case when public.financial_tasks.status='completed' then 'completed' else 'pending' end,
          updated_at=now();
  end if;

  return v_interaction_id;
end;
$function$;

create or replace function private.sync_installment_collection_schedule()
returns trigger
language plpgsql
set search_path to ''
as $function$
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
          when public.collection_cases.status = 'closed'
            and public.collection_cases.outcome = 'agreement' then 'closed'
          when public.collection_cases.status in ('paid','closed') then 'pending_contact'
          else public.collection_cases.status
        end,
        outcome = case
          when public.collection_cases.status = 'closed'
            and public.collection_cases.outcome = 'agreement' then public.collection_cases.outcome
          when public.collection_cases.status in ('paid','closed') then null
          else public.collection_cases.outcome
        end,
        closed_at = case
          when public.collection_cases.status = 'closed'
            and public.collection_cases.outcome = 'agreement' then public.collection_cases.closed_at
          when public.collection_cases.status in ('paid','closed') then null
          else public.collection_cases.closed_at
        end,
        next_action_at = case
          when public.collection_cases.status = 'closed'
            and public.collection_cases.outcome = 'agreement' then null
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
    count(i.id)::bigint as overdue_count,
    coalesce(sum(greatest(i.expected_amount - i.paid_amount, 0::numeric)), 0::numeric) as overdue_amount
  from public.patient_units pu
  join allowed_units au on au.id = pu.unit_id
  join public.payment_plans pp
    on pp.patient_unit_id = pu.id
   and pp.unit_id = pu.unit_id
  join public.installments i
    on i.payment_plan_id = pp.id
   and i.unit_id = pp.unit_id
  where pu.settled_at is null
    and pu.is_active
    and pu.clinicorp_patient_id is not null
    and pp.source = 'clinicorp'
    and pp.payment_method = 'boleto'
    and pp.archived_at is null
    and pp.status = 'active'
    and i.source = 'clinicorp'
    and i.clinicorp_source_state = 'open'
    and i.status not in ('paid', 'cancelled', 'refunded')
    and greatest(i.expected_amount - i.paid_amount, 0::numeric) > 0
    and i.due_date < (now() at time zone 'America/Sao_Paulo')::date
    and not exists (
      select 1
      from public.collection_cases cc
      where cc.installment_id = i.id
        and cc.unit_id = i.unit_id
        and cc.status = 'closed'
        and cc.outcome = 'agreement'
    )
  group by pu.unit_id, pu.patient_id;
$function$;
