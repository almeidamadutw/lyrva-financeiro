
create index if not exists clinicorp_payment_snapshot_paid_match_idx
  on public.clinicorp_payment_snapshot(unit_id, clinicorp_patient_id, due_date, amount)
  where (payment_received or payment_confirmed) and not cancelled;

create or replace function public.reconcile_paid_collection_cases_from_snapshot(p_unit_id bigint default null)
returns table(
  matched_count integer,
  updated_installments integer,
  closed_cases integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_installment_ids bigint[];
  v_matched integer := 0;
  v_updated integer := 0;
  v_closed integer := 0;
begin
  if coalesce((select auth.jwt()->>'role'),'') <> 'service_role' then
    raise exception using errcode='42501', message='Esta rotina é exclusiva da integração segura do LYVRA.';
  end if;

  select coalesce(array_agg(distinct i.id), '{}'::bigint[])
  into v_installment_ids
  from public.collection_cases cc
  join public.installments i
    on i.id = cc.installment_id
   and i.unit_id = cc.unit_id
  join public.payment_plans pp
    on pp.id = i.payment_plan_id
   and pp.unit_id = i.unit_id
  join public.patient_units pu
    on pu.id = pp.patient_unit_id
   and pu.unit_id = pp.unit_id
  where cc.status not in ('paid','closed')
    and (p_unit_id is null or cc.unit_id = p_unit_id)
    and i.source = 'clinicorp'
    and pu.clinicorp_patient_id is not null
    and exists (
      select 1
      from public.clinicorp_payment_snapshot cps
      where cps.unit_id = cc.unit_id
        and cps.clinicorp_patient_id = pu.clinicorp_patient_id
        and cps.due_date = i.due_date
        and abs(cps.amount - i.expected_amount) < 0.02
        and (cps.payment_received or cps.payment_confirmed)
        and not cps.cancelled
    );

  v_matched := coalesce(array_length(v_installment_ids, 1), 0);

  if v_matched = 0 then
    return query select 0, 0, 0;
    return;
  end if;

  update public.installments i
  set paid_amount = greatest(coalesce(i.paid_amount, 0), i.expected_amount),
      status = 'paid',
      clinicorp_source_state = 'paid',
      last_synced_at = now(),
      metadata = coalesce(i.metadata, '{}'::jsonb)
        || jsonb_build_object('payment_snapshot_reconciled_at', now()),
      updated_at = now()
  where i.id = any(v_installment_ids);

  get diagnostics v_updated = row_count;

  select count(*)::integer
  into v_closed
  from public.collection_cases cc
  where cc.installment_id = any(v_installment_ids)
    and cc.status in ('paid','closed');

  return query select v_matched, v_updated, v_closed;
end;
$function$;

revoke all on function public.reconcile_paid_collection_cases_from_snapshot(bigint) from public;
revoke all on function public.reconcile_paid_collection_cases_from_snapshot(bigint) from anon;
revoke all on function public.reconcile_paid_collection_cases_from_snapshot(bigint) from authenticated;
grant execute on function public.reconcile_paid_collection_cases_from_snapshot(bigint) to service_role;
