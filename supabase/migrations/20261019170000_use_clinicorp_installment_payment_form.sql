-- 2026-10-19: Source-verified installment-level boleto classification.
-- Contract card/transfer classification is kept unchanged; no artificial payment or settlement.
BEGIN;


-- A contract may contain card AND boleto installments. The exact source installment,
-- not the contract's historic default method, authorizes entry to the collection flow.
CREATE OR REPLACE FUNCTION private.clinicorp_verified_open_boleto_installment(p_installment_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' SET statement_timeout = '2s'
AS $fn$
  SELECT EXISTS(
    SELECT 1
    FROM public.installments i
    JOIN public.payment_plans pp ON pp.id = i.payment_plan_id AND pp.unit_id = i.unit_id
    JOIN public.patient_units pu ON pu.id = pp.patient_unit_id AND pu.unit_id = i.unit_id
    JOIN public.clinicorp_payment_snapshot s
      ON s.unit_id = i.unit_id AND s.clinicorp_payment_id = i.clinicorp_installment_id
    WHERE i.id = p_installment_id
      AND i.source = 'clinicorp' AND pp.source = 'clinicorp'
      AND i.clinicorp_source_state = 'open'
      AND i.status NOT IN ('paid','cancelled','refunded') AND i.paid_amount = 0
      AND i.expected_amount > 0
      AND s.source_presence = 'present'
      AND s.source_presence_checked_at >= (
        SELECT seeded_at FROM private.clinicorp_sync_control WHERE singleton
      )
      AND lower(s.payment_form) LIKE '%boleto%'
      AND NOT s.payment_received AND NOT s.payment_confirmed AND NOT s.cancelled
      AND s.amount = i.expected_amount AND s.due_date = i.due_date
      AND s.clinicorp_patient_id = pu.clinicorp_patient_id
  );
$fn$;
REVOKE ALL ON FUNCTION private.clinicorp_verified_open_boleto_installment(bigint) FROM public, anon, authenticated;


-- private.refresh_collection_current_state_installment
CREATE OR REPLACE FUNCTION private.refresh_collection_current_state_installment(p_installment_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '5s'
AS $function$
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
    and (pp.payment_method = 'boleto' OR private.clinicorp_verified_open_boleto_installment(i.id))
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
$function$



-- private.sync_installment_collection_schedule
CREATE OR REPLACE FUNCTION private.sync_installment_collection_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  if v_payment_method is distinct from 'boleto'
     and not private.clinicorp_verified_open_boleto_installment(new.id) then
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
        notes = case
          when public.collection_cases.status = 'closed'
            and public.collection_cases.outcome = 'cancelled'
            then concat_ws(E'\n', public.collection_cases.notes,
              'Reaberto automaticamente: parcela de boleto confirmada por ID exato no Clinicorp.')
          else public.collection_cases.notes end,
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
$function$



-- public.get_clinicorp_collection_reconciliation
CREATE OR REPLACE FUNCTION public.get_clinicorp_collection_reconciliation(p_unit_code text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_month integer DEFAULT NULL::integer, p_year integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_from date;
  v_to date;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT private.current_user_active() THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Acesso financeiro não autorizado.';
  END IF;
  IF (p_month IS NOT NULL AND (p_month < 1 OR p_month > 12))
    OR (p_year IS NOT NULL AND (p_year < 2015 OR p_year > 2100)) THEN
    RAISE EXCEPTION 'Filtro de competência inválido.';
  END IF;

  v_from := COALESCE(p_date_from,
    CASE WHEN p_year IS NOT NULL THEN make_date(p_year, COALESCE(p_month, 1), 1) END);
  v_to := COALESCE(p_date_to,
    CASE WHEN p_year IS NOT NULL THEN
      (make_date(p_year, COALESCE(p_month, 12), 1) + INTERVAL '1 month - 1 day')::date END);

  IF v_from IS NULL OR v_to IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'Selecione um ano ou um intervalo completo para conciliar.');
  END IF;
  IF v_from > v_to OR v_to - v_from > 366 THEN
    RETURN jsonb_build_object('available', false, 'reason', 'A conciliação aceita períodos de até 366 dias.');
  END IF;

  WITH allowed_units AS (
    SELECT u.id
    FROM public.units u
    WHERE u.is_active AND private.has_unit_access(u.id)
      AND (p_unit_code IS NULL OR p_unit_code IN ('', 'todas') OR u.code = p_unit_code)
  ),
  source AS (
    SELECT s.unit_id, s.clinicorp_payment_id, s.clinicorp_patient_id,
      s.due_date, s.amount, s.source_presence, s.source_presence_checked_at
    FROM public.clinicorp_payment_snapshot s
    JOIN allowed_units u ON u.id = s.unit_id
    WHERE s.due_date >= v_from
      AND s.due_date <= LEAST(v_to, v_today - 1)
      AND (p_month IS NULL OR EXTRACT(month FROM s.due_date) = p_month)
      AND (p_year IS NULL OR EXTRACT(year FROM s.due_date) = p_year)
      AND LOWER(s.payment_form) LIKE '%boleto%'
      AND NOT s.payment_received AND NOT s.payment_confirmed AND NOT s.cancelled
      AND s.amount > 0
  ),
  classified AS (
    SELECT s.amount, s.source_presence, s.source_presence_checked_at,
      CASE
        WHEN s.source_presence IS DISTINCT FROM 'present' THEN 'not_confirmed'
        WHEN i.id IS NULL OR i.source IS DISTINCT FROM 'clinicorp'
          OR i.clinicorp_source_state IS DISTINCT FROM 'open'
          OR i.status IN ('paid','cancelled','refunded')
          OR i.expected_amount IS DISTINCT FROM s.amount
          OR i.due_date IS DISTINCT FROM s.due_date
          OR i.paid_amount <> 0
          OR pp.source IS DISTINCT FROM 'clinicorp'
          OR (pp.payment_method IS DISTINCT FROM 'boleto'
            AND NOT private.clinicorp_verified_open_boleto_installment(i.id))
          OR pp.status IS DISTINCT FROM 'active'
          OR pp.archived_at IS NOT NULL
          OR pu.is_active IS DISTINCT FROM true
          OR pu.settled_at IS NOT NULL
          OR pu.clinicorp_patient_id IS DISTINCT FROM s.clinicorp_patient_id
          OR cc.id IS NULL OR cc.status IN ('paid','closed')
          THEN 'divergent'
        WHEN cc.eligible_at > v_today THEN 'waiting'
        ELSE 'in_collection'
      END AS bucket
    FROM source s
    LEFT JOIN public.installments i
      ON i.unit_id = s.unit_id AND i.clinicorp_installment_id = s.clinicorp_payment_id
    LEFT JOIN public.payment_plans pp ON pp.id = i.payment_plan_id AND pp.unit_id = i.unit_id
    LEFT JOIN public.patient_units pu ON pu.id = pp.patient_unit_id AND pu.unit_id = pp.unit_id
    LEFT JOIN public.collection_cases cc ON cc.installment_id = i.id AND cc.unit_id = i.unit_id
  )
  SELECT jsonb_build_object(
    'available', true,
    'from', v_from,
    'to', LEAST(v_to, v_today - 1),
    'clinicorpCount', COUNT(*) FILTER (WHERE source_presence = 'present'),
    'clinicorpAmount', COALESCE(SUM(amount) FILTER (WHERE source_presence = 'present'), 0),
    'inCollectionCount', COUNT(*) FILTER (WHERE bucket = 'in_collection'),
    'inCollectionAmount', COALESCE(SUM(amount) FILTER (WHERE bucket = 'in_collection'), 0),
    'waitingCount', COUNT(*) FILTER (WHERE bucket = 'waiting'),
    'waitingAmount', COALESCE(SUM(amount) FILTER (WHERE bucket = 'waiting'), 0),
    'divergentCount', COUNT(*) FILTER (WHERE bucket = 'divergent'),
    'divergentAmount', COALESCE(SUM(amount) FILTER (WHERE bucket = 'divergent'), 0),
    'notConfirmedCount', COUNT(*) FILTER (WHERE bucket = 'not_confirmed'),
    'notConfirmedAmount', COALESCE(SUM(amount) FILTER (WHERE bucket = 'not_confirmed'), 0),
    'oldestCheckedAt', MIN(source_presence_checked_at) FILTER (WHERE source_presence = 'present'),
    'lastCheckedAt', MAX(source_presence_checked_at) FILTER (WHERE source_presence = 'present')
  ) INTO v_result
  FROM classified;

  RETURN v_result;
END;
$function$



-- public.get_collection_postdate_active_ids
CREATE OR REPLACE FUNCTION public.get_collection_postdate_active_ids(p_unit_id bigint, p_post_date date)
 RETURNS TABLE(clinicorp_installment_id text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select distinct i.clinicorp_installment_id
  from public.collection_cases cc
  join public.installments i on i.id=cc.installment_id and i.unit_id=cc.unit_id
  join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
  join public.clinicorp_payment_snapshot s
    on s.unit_id=i.unit_id and s.clinicorp_payment_id=i.clinicorp_installment_id
  where cc.unit_id=p_unit_id
    and cc.status not in ('paid','closed')
    and i.source='clinicorp'
    and i.clinicorp_source_state='open'
    and i.status not in ('paid','cancelled','refunded')
    and pp.source='clinicorp'
    and (pp.payment_method = 'boleto' OR private.clinicorp_verified_open_boleto_installment(i.id))
    and pp.archived_at is null
    and pp.status='active'
    and substring(coalesce(s.raw->>'PostDate','') from 1 for 10)=p_post_date::text
    and i.clinicorp_installment_id is not null;
$function$



-- public.get_collection_postdate_reconciliation_days
CREATE OR REPLACE FUNCTION public.get_collection_postdate_reconciliation_days(p_unit_id bigint, p_limit integer DEFAULT 12)
 RETURNS TABLE(post_date date, active_cases bigint, pending_absence bigint, max_due_date date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare
  v_limit integer:=least(greatest(coalesce(p_limit,12),1),20);
begin
  return query
  with active as materialized (
    select i.clinicorp_installment_id,i.due_date,
      case
        when coalesce(i.metadata->>'clinicorp_absence_count','') ~ '^[0-9]+$'
          then (i.metadata->>'clinicorp_absence_count')::integer
        else 0
      end as absence_count,
      nullif(i.metadata->>'clinicorp_postdate_checked_at','')::timestamptz as checked_at,
      (cc.eligible_at <= (now() at time zone 'America/Sao_Paulo')::date
        and greatest(i.expected_amount-i.paid_amount,0::numeric)>0) as due_for_collection
    from public.collection_cases cc
    join public.installments i on i.id=cc.installment_id and i.unit_id=cc.unit_id
    join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
    where cc.unit_id=p_unit_id
      and cc.status not in ('paid','closed')
      and i.source='clinicorp'
      and i.clinicorp_source_state='open'
      and i.status not in ('paid','cancelled','refunded')
      and i.clinicorp_installment_id is not null
      and pp.source='clinicorp'
      and (pp.payment_method = 'boleto' OR private.clinicorp_verified_open_boleto_installment(i.id))
      and pp.archived_at is null
      and pp.status='active'
  ), candidates as materialized (
    select a.* from active a
    order by (a.absence_count>=1) desc,
      (a.due_for_collection and (a.checked_at is null or a.checked_at < now()-interval '1 day')) desc,
      a.checked_at asc nulls first,
      a.due_date desc,a.clinicorp_installment_id
    limit greatest(128,v_limit*32)
  ), dates as materialized (
    select substring(coalesce(s.raw->>'PostDate','') from 1 for 10) as post_day,
      bool_or(c.absence_count>=1) as pending,
      bool_or(c.checked_at is null) as unchecked,
      bool_or(c.due_for_collection and (c.checked_at is null or c.checked_at < now()-interval '1 day')) as due_for_review,
      min(c.checked_at) as checked_at,
      max(c.due_date) as due_date
    from candidates c
    join public.clinicorp_payment_snapshot s
      on s.unit_id=p_unit_id and s.clinicorp_payment_id=c.clinicorp_installment_id
    where substring(coalesce(s.raw->>'PostDate','') from 1 for 10)
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    group by 1
    order by pending desc,due_for_review desc,unchecked desc,checked_at asc nulls first,
      due_date desc,post_day desc
    limit v_limit
  )
  select d.post_day::date,count(*)::bigint,
    count(*) filter(where a.absence_count>=1)::bigint,max(a.due_date)
  from dates d
  join public.clinicorp_payment_snapshot s
    on s.unit_id=p_unit_id
   and substring(coalesce(s.raw->>'PostDate','') from 1 for 10)=d.post_day
  join active a on a.clinicorp_installment_id=s.clinicorp_payment_id
  group by d.post_day
  order by (count(*) filter(where a.absence_count>=1)>0) desc,
    bool_or(a.due_for_collection and (a.checked_at is null or a.checked_at < now()-interval '1 day')) desc,
    (count(*) filter(where a.checked_at is null)>0) desc,
    min(a.checked_at) asc nulls first,max(a.due_date) desc,d.post_day desc;
end;
$function$



-- public.get_collection_queue_filtered
CREATE OR REPLACE FUNCTION public.get_collection_queue_filtered(p_unit_code text DEFAULT NULL::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 300, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_month integer DEFAULT NULL::integer, p_year integer DEFAULT NULL::integer)
 RETURNS TABLE(id bigint, unit_id bigint, unit_name text, unit_code text, patient_id bigint, patient_name text, phone text, installment_id bigint, installment_number integer, due_date date, open_amount numeric, eligible_at date, status text, responsible_user_id uuid, responsible_name text, next_action_at timestamp with time zone, protested_at timestamp with time zone, notes text, installment_status text, updated_at timestamp with time zone, source_verified_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with allowed_units as (
    select u.id,u.code,u.name
    from public.units u
    where u.is_active
      and private.has_unit_access(u.id)
      and (p_unit_code is null or p_unit_code='' or p_unit_code='todas' or u.code=p_unit_code)
  )
  select
    cc.id,cc.unit_id,u.name,u.code,p.id,p.full_name,p.phone,cc.installment_id,
    i.installment_number,i.due_date,greatest(i.expected_amount-i.paid_amount,0::numeric),
    cc.eligible_at,cc.status,cc.responsible_user_id,coalesce(pr.full_name,'Sem responsável'::text),
    cc.next_action_at,cc.protested_at,cc.notes,i.status,cc.updated_at,case when s.source_presence='present' and s.source_presence_checked_at>=(select seeded_at from private.clinicorp_sync_control where singleton) and s.amount=i.expected_amount and i.paid_amount=0 and s.due_date=i.due_date and s.clinicorp_patient_id=pu.clinicorp_patient_id and not s.payment_received and not s.payment_confirmed and not s.cancelled then s.source_presence_checked_at else null end
  from public.collection_cases cc
  join allowed_units u on u.id=cc.unit_id
  join public.installments i on i.id=cc.installment_id and i.unit_id=cc.unit_id
  join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
  join public.patient_units pu on pu.id=cc.patient_unit_id and pu.unit_id=cc.unit_id
  join public.patients p on p.id=pu.patient_id
  left join public.clinicorp_payment_snapshot s on s.unit_id=i.unit_id and s.clinicorp_payment_id=i.clinicorp_installment_id
  left join public.profiles pr on pr.user_id=cc.responsible_user_id
  where pu.settled_at is null
    and pu.is_active
    and pu.clinicorp_patient_id is not null
    and pp.source='clinicorp'
    and (pp.payment_method = 'boleto' OR private.clinicorp_verified_open_boleto_installment(i.id))
    and pp.archived_at is null
    and pp.status='active'
    and cc.status not in ('paid','closed')
    and i.source='clinicorp'
    and i.clinicorp_source_state='open'
    and i.status not in ('paid','cancelled','refunded')
    and greatest(i.expected_amount-i.paid_amount,0::numeric)>0
    and cc.eligible_at <= (now() at time zone 'America/Sao_Paulo')::date
    and (p_date_from is null or i.due_date>=p_date_from)
    and (p_date_to is null or i.due_date<=p_date_to)
    and (p_month is null or extract(month from i.due_date)=p_month)
    and (p_year is null or extract(year from i.due_date)=p_year)
  order by cc.eligible_at asc,cc.id asc
  offset greatest(coalesce(p_offset,0),0)
  limit least(greatest(coalesce(p_limit,500),1),1000);
$function$



-- public.get_collection_queue_page
CREATE OR REPLACE FUNCTION public.get_collection_queue_page(p_unit_code text DEFAULT NULL::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 500)
 RETURNS TABLE(id bigint, unit_id bigint, unit_name text, unit_code text, patient_id bigint, patient_name text, phone text, installment_id bigint, installment_number integer, due_date date, open_amount numeric, eligible_at date, status text, responsible_user_id uuid, responsible_name text, next_action_at timestamp with time zone, protested_at timestamp with time zone, notes text, installment_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with allowed_units as (
    select u.id,u.code,u.name
    from public.units u
    where u.is_active
      and private.has_unit_access(u.id)
      and (p_unit_code is null or p_unit_code='' or p_unit_code='todas' or u.code=p_unit_code)
  )
  select
    cc.id,cc.unit_id,u.name,u.code,p.id,p.full_name,p.phone,cc.installment_id,
    i.installment_number,i.due_date,greatest(i.expected_amount-i.paid_amount,0::numeric),
    cc.eligible_at,cc.status,cc.responsible_user_id,coalesce(pr.full_name,'Sem responsável'::text),
    cc.next_action_at,cc.protested_at,cc.notes,i.status
  from public.collection_cases cc
  join allowed_units u on u.id=cc.unit_id
  join public.installments i on i.id=cc.installment_id and i.unit_id=cc.unit_id
  join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
  join public.patient_units pu on pu.id=cc.patient_unit_id and pu.unit_id=cc.unit_id
  join public.patients p on p.id=pu.patient_id
  left join public.profiles pr on pr.user_id=cc.responsible_user_id
  where pu.settled_at is null
    and pu.is_active
    and pu.clinicorp_patient_id is not null
    and pp.source='clinicorp'
    and (pp.payment_method = 'boleto' OR private.clinicorp_verified_open_boleto_installment(i.id))
    and pp.archived_at is null
    and pp.status='active'
    and cc.status not in ('paid','closed')
    and i.source='clinicorp'
    and i.clinicorp_source_state='open'
    and i.status not in ('paid','cancelled','refunded')
    and greatest(i.expected_amount-i.paid_amount,0::numeric)>0
    and cc.eligible_at <= (now() at time zone 'America/Sao_Paulo')::date
  order by cc.eligible_at asc,cc.id asc
  offset greatest(coalesce(p_offset,0),0)
  limit least(greatest(coalesce(p_limit,500),1),1000);
$function$



-- public.get_overdue_boleto_counts
CREATE OR REPLACE FUNCTION public.get_overdue_boleto_counts(p_unit_code text DEFAULT NULL::text)
 RETURNS TABLE(unit_id bigint, patient_id bigint, overdue_count bigint, overdue_amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '10s'
AS $function$
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
    count(cc.id)::bigint as overdue_count,
    coalesce(sum(greatest(i.expected_amount - i.paid_amount, 0::numeric)),0::numeric) as overdue_amount
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
   and (pp.payment_method = 'boleto' OR private.clinicorp_verified_open_boleto_installment(i.id))
   and pp.archived_at is null
   and pp.status = 'active'
  group by pu.unit_id, pu.patient_id;
$function$



-- public.reconcile_clinicorp_postdate_day
CREATE OR REPLACE FUNCTION public.reconcile_clinicorp_postdate_day(p_unit_id bigint, p_post_date date, p_rows jsonb)
 RETURNS TABLE(local_active_before integer, returned_rows integer, live_open_rows integer, terminal_rows integer, missing_rows integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '10s'
AS $function$
declare
  v_item jsonb;
  v_id text;
  v_present boolean;
  v_paid boolean;
  v_cancelled boolean;
  v_method text;
  v_installment_id bigint;
  v_metadata jsonb;
  v_absence_count integer;
  v_checked integer:=0;
  v_returned integer:=0;
  v_live integer:=0;
  v_terminal integer:=0;
  v_missing integer:=0;
begin
  if coalesce((select auth.jwt()->>'role'),'') <> 'service_role' then
    raise exception using errcode='42501', message='Esta rotina é exclusiva da integração segura do LYVRA.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception using errcode='22023', message='A reconciliação precisa receber uma lista JSON.';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    v_id:=nullif(btrim(coalesce(v_item->>'id','')),'');
    if v_id is null then continue; end if;

    select i.id,i.metadata
      into v_installment_id,v_metadata
    from public.collection_cases cc
    join public.installments i on i.id=cc.installment_id and i.unit_id=cc.unit_id
    join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
    join public.clinicorp_payment_snapshot cps
      on cps.unit_id=i.unit_id
     and cps.clinicorp_payment_id=i.clinicorp_installment_id
    where cc.unit_id=p_unit_id
      and cc.status not in ('paid','closed')
      and i.source='clinicorp'
      and i.clinicorp_source_state='open'
      and i.status not in ('paid','cancelled','refunded')
      and pp.source='clinicorp'
      and (pp.payment_method = 'boleto' OR private.clinicorp_verified_open_boleto_installment(i.id))
      and pp.archived_at is null
      and pp.status='active'
      and i.clinicorp_installment_id=v_id
      and substring(coalesce(cps.raw->>'PostDate','') from 1 for 10)=p_post_date::text
    limit 1;

    if v_installment_id is null then continue; end if;
    v_checked:=v_checked+1;
    v_present:=coalesce((v_item->>'present')::boolean,false);

    if v_present then
      v_returned:=v_returned+1;
      v_paid:=coalesce((v_item->>'paid')::boolean,false);
      v_cancelled:=coalesce((v_item->>'cancelled')::boolean,false);
      v_method:=private.normalize_match_text(coalesce(v_item->>'payment_form',''));

      update public.clinicorp_payment_snapshot
      set source_presence='present',source_presence_checked_at=now()
      where unit_id=p_unit_id and clinicorp_payment_id=v_id;

      if v_paid then
        update public.installments
        set paid_amount=greatest(coalesce(paid_amount,0),expected_amount),
            status='paid',
            clinicorp_source_state='paid',
            last_synced_at=now(),
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'clinicorp_postdate_checked_at',now(),
              'clinicorp_absence_count',0,
              'clinicorp_absence_reason',null
            ),
            updated_at=now()
        where id=v_installment_id;
        v_terminal:=v_terminal+1;
      elsif v_cancelled then
        update public.installments
        set status='cancelled',
            clinicorp_source_state='cancelled',
            last_synced_at=now(),
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'clinicorp_postdate_checked_at',now(),
              'clinicorp_absence_count',0,
              'clinicorp_absence_reason',null
            ),
            updated_at=now()
        where id=v_installment_id;
        v_terminal:=v_terminal+1;
      elsif v_method not like '%boleto%' then
        update public.installments
        set clinicorp_source_state='missing',
            last_synced_at=now(),
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'clinicorp_postdate_checked_at',now(),
              'clinicorp_absence_count',0,
              'clinicorp_absence_reason','payment_form_changed',
              'clinicorp_current_payment_form',coalesce(v_item->>'payment_form','')
            ),
            updated_at=now()
        where id=v_installment_id;
        v_missing:=v_missing+1;
      else
        update public.installments
        set clinicorp_source_state='open',
            last_synced_at=now(),
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'clinicorp_postdate_checked_at',now(),
              'clinicorp_absence_count',0,
              'clinicorp_absence_reason',null
            ),
            updated_at=now()
        where id=v_installment_id;
        v_live:=v_live+1;
      end if;
    else
      v_absence_count:=case
        when coalesce(v_metadata->>'clinicorp_absence_count','') ~ '^[0-9]+$'
          then (v_metadata->>'clinicorp_absence_count')::integer
        else 0
      end;

      if v_absence_count>=1 then
        update public.installments
        set clinicorp_source_state='missing',
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'clinicorp_postdate_checked_at',now(),
              'clinicorp_absence_count',v_absence_count+1,
              'clinicorp_absence_reason','absent_from_exact_postdate_recheck',
              'clinicorp_absence_confirmed_at',now()
            ),
            updated_at=now()
        where id=v_installment_id;

        update public.clinicorp_payment_snapshot
        set source_presence='missing',source_presence_checked_at=now()
        where unit_id=p_unit_id and clinicorp_payment_id=v_id;
        v_missing:=v_missing+1;
      else
        update public.installments
        set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'clinicorp_postdate_checked_at',now(),
              'clinicorp_absence_count',1,
              'clinicorp_absence_reason','first_absence_from_exact_postdate_recheck'
            ),
            updated_at=now()
        where id=v_installment_id;
      end if;
    end if;

    v_installment_id:=null;
    v_metadata:=null;
  end loop;

  return query select v_checked,v_returned,v_live,v_terminal,v_missing;
end;
$function$



COMMIT;
