-- Analytics is read-only. Capture the debt balance for future renegotiations
-- without changing the existing registration or Clinicorp settlement workflow.
alter table public.collection_interactions
  add column renegotiated_debt_amount numeric(14,2)
  check (renegotiated_debt_amount is null or renegotiated_debt_amount >= 0);

comment on column public.collection_interactions.renegotiated_debt_amount is
  'Outstanding original-title balance at renegotiation; not the new agreement value or cash received. NULL on legacy records.';

create function private.capture_renegotiated_debt_amount()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.outcome = 'renegotiated' then
    select greatest(i.expected_amount - i.paid_amount, 0)
      into new.renegotiated_debt_amount
    from public.collection_cases cc
    join public.installments i on i.id = cc.installment_id and i.unit_id = cc.unit_id
    where cc.id = new.collection_case_id and cc.unit_id = new.unit_id;
  else
    new.renegotiated_debt_amount := null;
  end if;
  return new;
end;
$$;

revoke all on function private.capture_renegotiated_debt_amount() from public, anon, authenticated;

create trigger capture_renegotiated_debt_amount
before insert on public.collection_interactions
for each row execute function private.capture_renegotiated_debt_amount();

-- The private definer can read the sync checkpoint without exposing that table.
-- Every branch below is scoped to the authenticated user's permitted units.
create function private.collection_analytics_data(
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
  receipts as materialized (
    -- Actual confirmed source payments from D+3 business days onward. Use the
    -- eligibility date, not import/open timestamps (historic cases are imported
    -- after payment). A promise cannot enter this total. Not attributed to an agent.
    select p.id, (p.paid_at at time zone 'America/Sao_Paulo')::date as event_date, p.amount
    from public.payments p
    join public.installments i on i.id = p.installment_id and i.unit_id = p.unit_id
    join public.collection_cases cc on cc.installment_id = i.id and cc.unit_id = i.unit_id
    where p.unit_id = any(v_unit_ids) and p.source = 'clinicorp' and p.payment_method = 'boleto'
      and p.status = 'confirmed' and p.confirmed_at is not null and p.reversed_at is null
      and i.source = 'clinicorp' and i.clinicorp_source_state = 'paid' and i.status = 'paid'
      and p.paid_at >= (cc.eligible_at::timestamp at time zone 'America/Sao_Paulo')
      and p.paid_at >= (v_from::timestamp at time zone 'America/Sao_Paulo')
      and p.paid_at < ((v_to + 1)::timestamp at time zone 'America/Sao_Paulo')
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
    'received', (select jsonb_build_object('amount', coalesce(sum(amount), 0), 'count', count(*)) from receipts),
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

revoke all on function private.collection_analytics_data(text,date,date) from public, anon;
grant execute on function private.collection_analytics_data(text,date,date) to authenticated;

create function public.get_collection_analytics(
  p_unit_code text default null, p_date_from date default null, p_date_to date default null
)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.collection_analytics_data(p_unit_code, p_date_from, p_date_to); $$;

revoke all on function public.get_collection_analytics(text,date,date) from public, anon;
grant execute on function public.get_collection_analytics(text,date,date) to authenticated;
