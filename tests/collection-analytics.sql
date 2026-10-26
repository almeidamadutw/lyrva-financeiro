-- Rollback-only integration checks. No financial/history rows are changed.
begin isolation level repeatable read;
set local statement_timeout = '30s';

create temporary table analytics_snapshot_probe (
  unit_id bigint, collection_case_id bigint, outcome text, renegotiated_debt_amount numeric
) on commit drop;
create trigger analytics_snapshot_probe before insert on analytics_snapshot_probe
for each row execute function private.capture_renegotiated_debt_amount();
grant select, insert on analytics_snapshot_probe to authenticated;

select set_config('request.jwt.claims', (
  select jsonb_build_object('sub', p.user_id, 'role', 'authenticated')::text
  from public.profiles p where p.is_active and p.operational_area = 'collections' limit 1
), true);
select set_config('analytics.test_support_user', (
  select p.user_id::text from public.profiles p where p.is_active and p.role = 'suporte' limit 1
), true);
select set_config('analytics.test_expected_received', (
select coalesce(sum(i.paid_amount),0)::text
  from public.installments i
  join public.collection_cases cc on cc.installment_id=i.id and cc.unit_id=i.unit_id
  join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
  join public.patient_units pu on pu.id=pp.patient_unit_id and pu.unit_id=pp.unit_id
  join public.clinicorp_payment_snapshot s on s.unit_id=i.unit_id and s.clinicorp_payment_id=i.clinicorp_installment_id
  where i.unit_id = any(array(select u.id from public.units u where u.is_active and private.has_unit_access(u.id)))
    and i.source='clinicorp' and i.clinicorp_source_state='paid' and i.status='paid'
    and i.confirmed_at is not null and i.paid_amount>0
    and lower(s.payment_form) like '%boleto%'
    and s.source_presence='present' and s.payment_confirmed and not s.cancelled
    and s.source_presence_checked_at >= (select seeded_at from private.clinicorp_sync_control where singleton)
    and s.amount=i.expected_amount and s.due_date=i.due_date and s.clinicorp_patient_id=pu.clinicorp_patient_id
    and i.paid_at >= (cc.eligible_at::timestamp at time zone 'America/Sao_Paulo')
    and i.paid_at >= ((date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '5 months')::timestamp at time zone 'America/Sao_Paulo')
    and i.paid_at < ((((now() at time zone 'America/Sao_Paulo')::date)+1)::timestamp at time zone 'America/Sao_Paulo')
), true);
set local role authenticated;

do $$
declare
  v_from date := (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '5 months')::date;
  v_to date := (now() at time zone 'America/Sao_Paulo')::date;
  v_all jsonb;
  v_unit jsonb;
  v_code text;
  v_pending numeric := 0;
  v_renegotiated numeric := 0;
  v_received numeric := 0;
  v_queue_amount numeric := 0;
  v_queue_count bigint := 0;
  v_unverified_count bigint := 0;
  v_page_count bigint;
  v_page_amount numeric;
  v_page_verified bigint;
  v_offset integer := 0;
  v_claims text := current_setting('request.jwt.claims');
  v_case_id bigint;
  v_unit_id bigint;
  v_expected numeric;
  v_snapshot numeric;
  v_source_paid numeric;
begin
  v_all := public.get_collection_analytics(null, v_from, v_to);
  foreach v_code in array array['sorocaba', 'salto_de_pirapora'] loop
    v_unit := public.get_collection_analytics(v_code, v_from, v_to);
    v_pending := v_pending + (v_unit->'pending'->>'amount')::numeric;
    v_renegotiated := v_renegotiated + (v_unit->'renegotiated'->>'amount')::numeric;
    v_received := v_received + (v_unit->'received'->>'amount')::numeric;
  end loop;
  assert v_pending = (v_all->'pending'->>'amount')::numeric, 'Unit pending amounts do not reconcile';
  assert v_renegotiated = (v_all->'renegotiated'->>'amount')::numeric, 'Unit renegotiations do not reconcile';
  assert v_received = (v_all->'received'->>'amount')::numeric, 'Unit receipts do not reconcile';
  assert (select sum((m->>'pending')::numeric) from jsonb_array_elements(v_all->'monthly') m) = v_pending, 'Monthly pending mismatch';
  assert (select sum((m->>'renegotiated')::numeric) from jsonb_array_elements(v_all->'monthly') m) = v_renegotiated, 'Monthly renegotiation mismatch';
  assert (select sum((m->>'received')::numeric) from jsonb_array_elements(v_all->'monthly') m) = v_received, 'Monthly receipt mismatch';
  assert (select sum((m->>'amount')::numeric) from jsonb_array_elements(v_all->'aging') m) = v_pending, 'Aging mismatch';
  assert jsonb_array_length(v_all->'monthly') = 6, 'Zero months must be present';

  v_source_paid := current_setting('analytics.test_expected_received')::numeric;
  assert v_source_paid = v_received, 'Settled amount does not reconcile with confirmed source titles';

  loop
    select count(*), coalesce(sum(open_amount) filter(where source_verified_at is not null), 0),
      count(*) filter(where source_verified_at is not null)
    into v_page_count, v_page_amount, v_page_verified
    from public.get_collection_queue_filtered(null, v_offset, 1000, v_from, v_to);
    v_queue_amount := v_queue_amount + v_page_amount;
    v_queue_count := v_queue_count + v_page_verified;
    v_unverified_count := v_unverified_count + v_page_count - v_page_verified;
    exit when v_page_count < 1000;
    v_offset := v_offset + 1000;
  end loop;
  assert v_queue_amount = v_pending, 'Analytics differs from the full collection queue';
  assert v_queue_count = (v_all->'pending'->>'count')::bigint, 'Verified title count mismatch';
  assert v_unverified_count = (v_all->'pending'->>'unverifiedCount')::bigint, 'Unverified count mismatch';

  -- Exercise the snapshot trigger on a temporary table, not live history.
  select cc.id, cc.unit_id, greatest(i.expected_amount - i.paid_amount, 0)
  into v_case_id, v_unit_id, v_expected
  from public.collection_cases cc join public.installments i on i.id = cc.installment_id and i.unit_id = cc.unit_id
  where cc.status not in ('paid','closed') and i.expected_amount > i.paid_amount limit 1;
  assert v_case_id is not null, 'Snapshot test needs an accessible open title';
  insert into analytics_snapshot_probe values (v_unit_id, v_case_id, 'renegotiated', 999999);
  select renegotiated_debt_amount into v_snapshot from analytics_snapshot_probe where outcome = 'renegotiated';
  assert v_snapshot = v_expected, 'Snapshot must use the real balance, not a supplied amount';
  insert into analytics_snapshot_probe values (v_unit_id, v_case_id, 'promise', 999999);
  assert (select renegotiated_debt_amount is null from analytics_snapshot_probe where outcome = 'promise'), 'Promise must not record renegotiated debt';

  assert not has_function_privilege('anon', 'public.get_collection_analytics(text,date,date)', 'execute'), 'Anonymous API access';
  assert not has_function_privilege('anon', 'private.collection_analytics_data(text,date,date)', 'execute'), 'Anonymous private access';
  begin
    perform public.get_collection_analytics('unknown', v_from, v_to);
    raise exception 'Invalid unit was accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.get_collection_analytics(null, v_to, v_from);
    raise exception 'Reversed range was accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.get_collection_analytics(null, v_to - 400, v_to);
    raise exception 'Oversized range was accepted';
  exception when invalid_parameter_value then null; end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('analytics.test_support_user'), 'role', 'authenticated')::text, true);
  begin
    perform public.get_collection_analytics(null, v_from, v_to);
    raise exception 'Support user could access financial analytics';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.get_collection_analytics(null, v_from, v_to);
    raise exception 'Missing identity was accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', v_claims, true);
end;
$$;

rollback;
select 'Collection analytics: permissions, full-queue totals, monthly totals, aging, date validation and snapshot checks passed.' as result;
