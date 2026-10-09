-- Parte 2: manter o espelho leve sincronizado incrementalmente.
-- A tela ainda não lê desta tabela.

create or replace function private.refresh_collection_current_state_installment(
  p_installment_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_row record;
begin
  if p_installment_id is null then
    return;
  end if;

  select
    cc.id as collection_case_id,
    cc.unit_id,
    u.code as unit_code,
    pu.id as patient_unit_id,
    p.id as patient_id,
    p.full_name as patient_name,
    p.phone,
    i.id as installment_id,
    i.installment_number,
    i.due_date,
    greatest(i.expected_amount - i.paid_amount, 0::numeric) as open_amount,
    cc.eligible_at,
    cc.status as collection_status,
    i.status as installment_status,
    cc.responsible_user_id,
    coalesce(pr.full_name, 'Sem responsável'::text) as responsible_name,
    cc.next_action_at,
    cc.protested_at,
    cc.notes,
    i.clinicorp_source_state as source_state
  into v_row
  from public.installments i
  join public.units u
    on u.id = i.unit_id
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
  where i.id = p_installment_id
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
  limit 1;

  if not found then
    delete from private.collection_current_state_shadow
    where installment_id = p_installment_id;
    return;
  end if;

  delete from private.collection_current_state_shadow
  where installment_id = p_installment_id
    and collection_case_id <> v_row.collection_case_id;

  insert into private.collection_current_state_shadow (
    collection_case_id, unit_id, unit_code, patient_unit_id, patient_id, patient_name,
    phone, installment_id, installment_number, due_date, open_amount, eligible_at,
    collection_status, installment_status, responsible_user_id, responsible_name,
    next_action_at, protested_at, notes, source_state, refreshed_at
  ) values (
    v_row.collection_case_id, v_row.unit_id, v_row.unit_code, v_row.patient_unit_id,
    v_row.patient_id, v_row.patient_name, v_row.phone, v_row.installment_id,
    v_row.installment_number, v_row.due_date, v_row.open_amount, v_row.eligible_at,
    v_row.collection_status, v_row.installment_status, v_row.responsible_user_id,
    v_row.responsible_name, v_row.next_action_at, v_row.protested_at, v_row.notes,
    v_row.source_state, now()
  )
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
end;
$function$;

create or replace function private.collection_state_from_installment_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    delete from private.collection_current_state_shadow where installment_id = old.id;
    return old;
  end if;

  perform private.refresh_collection_current_state_installment(new.id);

  if tg_op = 'UPDATE' and old.id is distinct from new.id then
    delete from private.collection_current_state_shadow where installment_id = old.id;
  end if;

  return new;
end;
$function$;

create or replace function private.collection_state_from_case_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    delete from private.collection_current_state_shadow where collection_case_id = old.id;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.installment_id is distinct from new.installment_id then
    perform private.refresh_collection_current_state_installment(old.installment_id);
  end if;

  perform private.refresh_collection_current_state_installment(new.installment_id);
  return new;
end;
$function$;

create or replace function private.collection_state_from_plan_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_installment_id bigint;
begin
  for v_installment_id in
    select i.id
    from public.installments i
    where i.payment_plan_id = new.id
       or (tg_op = 'UPDATE' and i.payment_plan_id = old.id)
  loop
    perform private.refresh_collection_current_state_installment(v_installment_id);
  end loop;

  return new;
end;
$function$;

create or replace function private.collection_state_from_patient_unit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_installment_id bigint;
begin
  for v_installment_id in
    select distinct cc.installment_id
    from public.collection_cases cc
    where cc.patient_unit_id = new.id
       or (tg_op = 'UPDATE' and cc.patient_unit_id = old.id)
  loop
    perform private.refresh_collection_current_state_installment(v_installment_id);
  end loop;

  return new;
end;
$function$;

create or replace function private.collection_state_from_patient_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update private.collection_current_state_shadow
  set patient_name = new.full_name,
      phone = new.phone,
      refreshed_at = now()
  where patient_id = new.id;
  return new;
end;
$function$;

create or replace function private.collection_state_from_profile_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update private.collection_current_state_shadow
  set responsible_name = coalesce(new.full_name, 'Sem responsável'),
      refreshed_at = now()
  where responsible_user_id = new.user_id;
  return new;
end;
$function$;

drop trigger if exists sync_collection_current_state_installment on public.installments;
create trigger sync_collection_current_state_installment
after insert or delete or update of
  unit_id, payment_plan_id, installment_number, due_date, expected_amount, paid_amount,
  status, source, clinicorp_source_state
on public.installments
for each row execute function private.collection_state_from_installment_trigger();

drop trigger if exists sync_collection_current_state_case on public.collection_cases;
create trigger sync_collection_current_state_case
after insert or delete or update of
  unit_id, patient_unit_id, installment_id, eligible_at, status, responsible_user_id,
  next_action_at, protested_at, notes
on public.collection_cases
for each row execute function private.collection_state_from_case_trigger();

drop trigger if exists sync_collection_current_state_plan on public.payment_plans;
create trigger sync_collection_current_state_plan
after update of
  unit_id, patient_unit_id, payment_method, archived_at, status, source
on public.payment_plans
for each row execute function private.collection_state_from_plan_trigger();

drop trigger if exists sync_collection_current_state_patient_unit on public.patient_units;
create trigger sync_collection_current_state_patient_unit
after update of
  unit_id, patient_id, clinicorp_patient_id, is_active, settled_at
on public.patient_units
for each row execute function private.collection_state_from_patient_unit_trigger();

drop trigger if exists sync_collection_current_state_patient on public.patients;
create trigger sync_collection_current_state_patient
after update of full_name, phone
on public.patients
for each row execute function private.collection_state_from_patient_trigger();

drop trigger if exists sync_collection_current_state_profile on public.profiles;
create trigger sync_collection_current_state_profile
after update of full_name
on public.profiles
for each row execute function private.collection_state_from_profile_trigger();

revoke all on function private.refresh_collection_current_state_installment(bigint) from public;
revoke all on function private.collection_state_from_installment_trigger() from public;
revoke all on function private.collection_state_from_case_trigger() from public;
revoke all on function private.collection_state_from_plan_trigger() from public;
revoke all on function private.collection_state_from_patient_unit_trigger() from public;
revoke all on function private.collection_state_from_patient_trigger() from public;
revoke all on function private.collection_state_from_profile_trigger() from public;
