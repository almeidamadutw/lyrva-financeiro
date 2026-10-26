-- Use the canonical confirmed title state for paid-title analytics. No financial records are changed.
create or replace function private.collection_analytics_data(
  p_unit_code text default null,
  p_date_from date default null,
  p_date_to date default null
)
returns jsonb
language plpgsql
stable security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_from date := coalesce(p_date_from, (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '5 months')::date);
  v_to date := least(coalesce(p_date_to, v_today), v_today);
  v_unit_ids bigint[];
  v_result jsonb;
begin
  if auth.uid() is null or not private.current_user_active() then
    raise exception using errcode = '42501', message = 'Entre no LYVRA para consultar os gráficos.';
  end if;
  if p_unit_code is not null and p_unit_code not in ('', 'todas', 'sorocaba', 'salto_de_pirapora') then
    raise exception using errcode = '22023', message = 'Unidade inválida.';
  end if;
  if v_from > v_to or v_to - v_from > 366 or v_from < date '2015-01-01' then
    raise exception using errcode = '22023', message = 'Selecione um período válido de até 12 meses.';
  end if;

  select array_agg(u.id) into v_unit_ids
  from public.units u
  where u.is_active and private.has_unit_access(u.id)
    and (p_unit_code is null or p_unit_code in ('', 'todas') or u.code = p_unit_code);
  if coalesce(cardinality(v_unit_ids), 0) = 0 then
    raise exception using errcode = '42501', message = 'Seu acesso não permite consultar esta unidade.';
  end if;

  with
  -- Same eligibility and source verification as get_collection_queue_filtered,
  -- aggregated in the database, with no UI pagination truncating the totals.
  queue as materialized (
    select cc.id, cc.status, i.due_date,
      greatest(i.expected_amount - i.paid_amount, 0) as amount,
      case when s.source_presence = 'present'
        and s.source_presence_checked_at >= (select seeded_at from private.clinicorp_sync_control where singleton)
        and s.amount = i.expected_amount and i.paid_amount = 0
        and s.due_date = i.due_date and s.clinicorp_patient_id = pu.clinicorp_patient_id
        and not s.payment_received and not s.payment_confirmed and not s.cancelled
        then s.source_presence_checked_at end as verified_at
    from public.collection_cases cc
    join public.installments i on i.id = cc.installment_id and i.unit_id = cc.unit_id
    join public.payment_plans pp on pp.id = i.payment_plan_id and pp.unit_id = i.unit_id
    join public.patient_units pu on pu.id = cc.patient_unit_id and pu.unit_id = cc.unit_id
    left join public.clinicorp_payment_snapshot s
      on s.unit_id = i.unit_id and s.clinicorp_payment_id = i.clinicorp_installment_id
    where cc.unit_id = any(v_unit_ids)
      and pu.settled_at is null and pu.is_active and pu.clinicorp_patient_id is not null
      and pp.source = 'clinicorp'
      and (pp.payment_method = 'boleto' or private.clinicorp_verified_open_boleto_installment(i.id))
      and pp.archived_at is null and pp.status = 'active'
      and cc.status not in ('paid', 'closed') and cc.eligible_at <= v_today
      and i.source = 'clinicorp' and i.clinicorp_source_state = 'open'
      and i.status not in ('paid', 'cancelled', 'refunded')
      and greatest(i.expected_amount - i.paid_amount, 0) > 0
      and i.due_date between v_from and v_to
  ),
  first_renegotiations as materialized (
    -- One original title can contribute only once, even if its history repeats.
    select distinct on (ci.unit_id, ci.collection_case_id)
      ci.unit_id, ci.collection_case_id, ci.occurred_at, ci.renegotiated_debt_amount
    from public.collection_interactions ci
    where ci.unit_id = any(v_unit_ids) and ci.outcome = 'renegotiated'
    order by ci.unit_id, ci.collection_case_id, ci.occurred_at, ci.id
  ),
  renegotiations as materialized (
    select r.collection_case_id,
      (r.occurred_at at time zone 'America/Sao_Paulo')::date as event_date,
      coalesce(r.renegotiated_debt_amount, i.expected_amount) as amount,
      r.renegotiated_debt_amount is null as historical
    from first_renegotiations r
    join public.collection_cases cc on cc.id = r.collection_case_id and cc.unit_id = r.unit_id
    join public.installments i on i.id = cc.installment_id and i.unit_id = cc.unit_id
    where r.occurred_at >= (v_from::timestamp at time zone 'America/Sao_Paulo')
      and r.occurred_at < ((v_to + 1)::timestamp at time zone 'America/Sao_Paulo')
  ),
  receipt_candidates as materialized (
    -- Canonical installment + matching confirmed source snapshot. The auxiliary
    -- payments ledger can lack recent links, so it must not turn paid titles
    -- into a misleading zero. Count each settled title once, on its paid date.
    select i.id, (i.paid_at at time zone 'America/Sao_Paulo')::date as event_date,
      i.paid_amount as amount,
      coalesce(s.source_presence = 'present'
        and s.source_presence_checked_at >= (select seeded_at from private.clinicorp_sync_control where singleton)
        and s.payment_confirmed and not s.cancelled
        and s.amount = i.expected_amount and s.due_date = i.due_date
        and s.clinicorp_patient_id = pu.clinicorp_patient_id, false) as verified
    from public.installments i
    join public.collection_cases cc on cc.installment_id = i.id and cc.unit_id = i.unit_id
    join public.payment_plans pp on pp.id = i.payment_plan_id and pp.unit_id = i.unit_id
    join public.patient_units pu on pu.id = pp.patient_unit_id and pu.unit_id = pp.unit_id
    left join public.clinicorp_payment_snapshot s
      on s.unit_id = i.unit_id and s.clinicorp_payment_id = i.clinicorp_installment_id
    where i.unit_id = any(v_unit_ids)
      and i.source = 'clinicorp' and i.clinicorp_source_state = 'paid' and i.status = 'paid'
      and i.confirmed_at is not null and i.paid_amount > 0
      and (lower(s.payment_form) like '%boleto%'
        or (s.clinicorp_payment_id is null and pp.payment_method = 'boleto'))
      and i.paid_at >= (cc.eligible_at::timestamp at time zone 'America/Sao_Paulo')
      and i.paid_at >= (v_from::timestamp at time zone 'America/Sao_Paulo')
      and i.paid_at < ((v_to + 1)::timestamp at time zone 'America/Sao_Paulo')
  ),
  receipts as materialized (
    select id, event_date, amount from receipt_candidates where verified
  ),
  month_keys as (
    select to_char(m, 'YYYY-MM') as month
    from generate_series(date_trunc('month', v_from::timestamp), date_trunc('month', v_to::timestamp), interval '1 month') m
  ),
  pending_months as (
    select to_char(due_date, 'YYYY-MM') as month, sum(amount) as amount, count(*) as count
    from queue where verified_at is not null group by 1
  ),
  renegotiated_months as (
    select to_char(event_date, 'YYYY-MM') as month, sum(amount) as amount, count(*) as count
    from renegotiations group by 1
  ),
  receipt_months as (
    select to_char(event_date, 'YYYY-MM') as month, sum(amount) as amount, count(*) as count
    from receipts group by 1
  ),
  aging_groups as (
    select bucket, sum(amount) as amount, count(*) as count from (
      select amount, case when v_today - due_date <= 30 then 0 when v_today - due_date <= 60 then 1
        when v_today - due_date <= 90 then 2 else 3 end as bucket
      from queue where verified_at is not null
    ) q group by bucket
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'generatedAt', now(),
    'pending', (select jsonb_build_object(
      'amount', coalesce(sum(amount) filter (where verified_at is not null), 0),
      'count', count(*) filter (where verified_at is not null),
      'unverifiedCount', count(*) filter (where verified_at is null),
      'oldestVerifiedAt', min(verified_at)) from queue),
    'renegotiated', (select jsonb_build_object('amount', coalesce(sum(amount), 0),
      'count', count(*), 'historicalCount', count(*) filter (where historical)) from renegotiations),
    'received', (select jsonb_build_object('amount', coalesce(sum(amount), 0), 'count', count(*),
      'unverifiedCount', (select count(*) from receipt_candidates where not verified)) from receipts),
    'monthly', (select jsonb_agg(jsonb_build_object('month', m.month,
      'pending', coalesce(q.amount, 0), 'pendingCount', coalesce(q.count, 0),
      'renegotiated', coalesce(r.amount, 0), 'renegotiatedCount', coalesce(r.count, 0),
      'received', coalesce(p.amount, 0), 'receivedCount', coalesce(p.count, 0)) order by m.month)
      from month_keys m left join pending_months q using(month)
      left join renegotiated_months r using(month) left join receipt_months p using(month)),
    'aging', (select jsonb_agg(jsonb_build_object('label', b.label,
      'amount', coalesce(a.amount, 0), 'count', coalesce(a.count, 0)) order by b.bucket)
      from (values (0, 'Até 30 dias'), (1, '31 a 60 dias'), (2, '61 a 90 dias'), (3, 'Mais de 90 dias')) b(bucket,label)
      left join aging_groups a using(bucket))
  ) into v_result;
  return v_result;
end;
$$;

