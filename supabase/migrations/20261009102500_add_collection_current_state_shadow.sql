-- Parte 1: espelho leve do estado atual da Régua.
-- Não substitui nenhuma tela ainda. Primeiro validamos paridade 1:1.

create table if not exists private.collection_current_state_shadow (
  collection_case_id bigint primary key,
  unit_id bigint not null,
  unit_code text not null,
  patient_unit_id bigint not null,
  patient_id bigint not null,
  patient_name text not null,
  phone text,
  installment_id bigint not null unique,
  installment_number integer,
  due_date date not null,
  open_amount numeric(14,2) not null,
  eligible_at date not null,
  collection_status text not null,
  installment_status text not null,
  responsible_user_id uuid,
  responsible_name text not null,
  next_action_at timestamptz,
  protested_at timestamptz,
  notes text,
  source_state text not null,
  refreshed_at timestamptz not null default now()
);

create index if not exists collection_current_state_shadow_unit_due_idx
  on private.collection_current_state_shadow(unit_id, due_date);

create index if not exists collection_current_state_shadow_unit_queue_idx
  on private.collection_current_state_shadow(unit_id, eligible_at, collection_case_id);

create index if not exists collection_current_state_shadow_patient_idx
  on private.collection_current_state_shadow(unit_id, patient_id);

create or replace function private.refresh_collection_current_state_shadow(
  p_unit_code text,
  p_due_from date,
  p_due_to date
)
returns table(inserted_count bigint, inserted_amount numeric)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $function$
declare
  v_unit_id bigint;
begin
  if p_unit_code is null or p_due_from is null or p_due_to is null or p_due_from > p_due_to then
    raise exception using errcode='22023', message='Unidade e intervalo de vencimento válidos são obrigatórios.';
  end if;

  select u.id
    into v_unit_id
  from public.units u
  where u.code = p_unit_code
    and u.is_active
  limit 1;

  if v_unit_id is null then
    raise exception using errcode='22023', message='Unidade não encontrada.';
  end if;

  delete from private.collection_current_state_shadow s
  where s.unit_id = v_unit_id
    and s.due_date between p_due_from and p_due_to;

  insert into private.collection_current_state_shadow (
    collection_case_id,
    unit_id,
    unit_code,
    patient_unit_id,
    patient_id,
    patient_name,
    phone,
    installment_id,
    installment_number,
    due_date,
    open_amount,
    eligible_at,
    collection_status,
    installment_status,
    responsible_user_id,
    responsible_name,
    next_action_at,
    protested_at,
    notes,
    source_state,
    refreshed_at
  )
  select
    cc.id,
    cc.unit_id,
    u.code,
    pu.id,
    p.id,
    p.full_name,
    p.phone,
    i.id,
    i.installment_number,
    i.due_date,
    greatest(i.expected_amount - i.paid_amount, 0::numeric),
    cc.eligible_at,
    cc.status,
    i.status,
    cc.responsible_user_id,
    coalesce(pr.full_name, 'Sem responsável'::text),
    cc.next_action_at,
    cc.protested_at,
    cc.notes,
    i.clinicorp_source_state,
    now()
  from public.installments i
  join public.units u
    on u.id = i.unit_id
   and u.code = p_unit_code
   and u.is_active
  join public.payment_plans pp
    on pp.id = i.payment_plan_id
   and pp.unit_id = i.unit_id
  join public.collection_cases cc
    on cc.installment_id = i.id
   and cc.unit_id = i.unit_id
  join public.patient_units pu
    on pu.id = cc.patient_unit_id
   and pu.unit_id = cc.unit_id
  join public.patients p
    on p.id = pu.patient_id
  left join public.profiles pr
    on pr.user_id = cc.responsible_user_id
  where i.due_date between p_due_from and p_due_to
    and pu.settled_at is null
    and pu.is_active
    and pu.clinicorp_patient_id is not null
    and pp.source = 'clinicorp'
    and pp.payment_method = 'boleto'
    and pp.archived_at is null
    and pp.status = 'active'
    and cc.status not in ('paid','closed')
    and i.source = 'clinicorp'
    and i.clinicorp_source_state = 'open'
    and i.status not in ('paid','cancelled','refunded')
    and greatest(i.expected_amount - i.paid_amount, 0::numeric) > 0
    and cc.eligible_at <= (now() at time zone 'America/Sao_Paulo')::date
  on conflict (collection_case_id) do update
  set unit_id = excluded.unit_id,
      unit_code = excluded.unit_code,
      patient_unit_id = excluded.patient_unit_id,
      patient_id = excluded.patient_id,
      patient_name = excluded.patient_name,
      phone = excluded.phone,
      installment_id = excluded.installment_id,
      installment_number = excluded.installment_number,
      due_date = excluded.due_date,
      open_amount = excluded.open_amount,
      eligible_at = excluded.eligible_at,
      collection_status = excluded.collection_status,
      installment_status = excluded.installment_status,
      responsible_user_id = excluded.responsible_user_id,
      responsible_name = excluded.responsible_name,
      next_action_at = excluded.next_action_at,
      protested_at = excluded.protested_at,
      notes = excluded.notes,
      source_state = excluded.source_state,
      refreshed_at = excluded.refreshed_at;

  return query
  select count(*)::bigint, coalesce(sum(s.open_amount),0::numeric)
  from private.collection_current_state_shadow s
  where s.unit_id = v_unit_id
    and s.due_date between p_due_from and p_due_to;
end;
$function$;

revoke all on function private.refresh_collection_current_state_shadow(text,date,date) from public;
revoke all on function private.refresh_collection_current_state_shadow(text,date,date) from anon;
revoke all on function private.refresh_collection_current_state_shadow(text,date,date) from authenticated;
grant execute on function private.refresh_collection_current_state_shadow(text,date,date) to service_role;
